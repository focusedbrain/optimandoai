# IMAP sync failure — final analysis (line-by-line) and fix

This document traces the **actual** execution path for IMAP auto-sync, explains why pull/sync could fail with **timeouts / “Connection issue”** while **`testConnection` succeeds**, and records the **code fix** applied in the repo.

---

## Step 1 — Entry: 2-minute IMAP auto-sync (`ipc.ts`)

**Location:** `apps/electron-vite-project/electron/main/email/ipc.ts` (registered IMAP brute-force interval).

Exact sequence when the interval fires:

1. `setInterval(callback, IMAP_AUTO_SYNC_INTERVAL_MS)` where `IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000`.
2. The callback runs: `void (async () => { ... })()` — a fire-and-forget async IIFE.
3. Inside the IIFE:
   - `const accounts = await emailGateway.listAccounts()`
   - `const db = await resolveDb()` — if falsy, **return**.
   - `for (const acc of accounts)`:
     - If `acc.provider !== 'imap' || acc.status !== 'active'` → **continue**.
     - `console.log('[IMAP-AUTO-SYNC] Triggering pull...')`
     - `await syncAccountEmails(db, { accountId: acc.id })` — imported from `syncOrchestrator`.
     - On success: log pull completed; on failure: `console.error` with error.

There is **no** additional IPC layer here: the **only** sync entry from this timer is `syncAccountEmails(db, { accountId })`.

---

## Step 2 — `syncChains`: does a stuck promise block forever?

**Code:** `syncAccountEmails` in `syncOrchestrator.ts`.

- `syncChains` is a `Map<string, Promise<unknown>>`.
- `syncChainTimestamps` stores when the current chain was started.
- If the chain timestamp is older than **60s**, the map entry is **cleared** (stale chain recovery).
- Each new call does `prev = syncChains.get(accountId) ?? Promise.resolve()` then  
  `current = prev.then(() => syncAccountEmailsImpl(...), () => syncAccountEmailsImpl(...))`  
  so the **next** run is scheduled even if **previous rejected**.
- The work is wrapped in `Promise.race([current, timeout-45s])`.
- **Important:**  
  `syncChains.set(accountId, withTimeout.then(() => undefined, () => undefined))`  
  The inner `.then` **swallows** both fulfillment and rejection and turns them into a **resolved** promise with `undefined`. So after a **45s timeout**, the stored chain promise **still settles successfully** — it does **not** stay rejected. The **following** `syncAccountEmails` sees `prev` as resolved and can run `syncAccountEmailsImpl` again.

**Conclusion:** A 45s timeout does **not** permanently brick the per-account queue. Stuck chains older than 60s are also cleared explicitly.

---

## Step 3 — `resolveImapPullFoldersExpanded`

**Gateway:** `EmailGateway.resolveImapPullFoldersExpanded` uses **`getProvider` + `connect` + `expandPullFoldersForSync` + `disconnect` in `finally`** — **ephemeral**, same style as `listMessages` / `getMessage` for IMAP.

**Orchestrator (after fix):** folder expansion is wrapped in **`Promise.race` with a 30s reject**. If expansion fails or times out, the code **falls back** to `basePullLabels` so sync can still proceed with the configured INBOX/Spam labels.

**Previous gap:** expansion had **no** dedicated timeout (only the outer **45s** on the whole sync). A hang in `connect`/`expand` could burn the entire sync budget without ever reaching `listMessages`.

---

## Step 4 — IMAP connection model: `getConnectedProvider` vs ephemeral

**Ephemeral (no cache entry left connected):**

- `listMessages` (IMAP branch)
- `getMessage` (IMAP branch)
- `resolveImapPullFoldersExpanded` (after success, **disconnect** in `finally`)

**`getConnectedProvider`:** creates a provider, **`connect`**, stores in **`this.providers`** map — connection **stays open** until something disconnects or `isConnected()` is false.

**Bug (before fix):** `listAttachments` and `fetchAttachmentBuffer` used **`getConnectedProvider` for IMAP** as well. That **cached** a live IMAP session while `getMessage` used a **separate** ephemeral `ImapProvider` + `connect` + `disconnect` in sequence.

Per message the orchestrator does:

1. `getMessage` → ephemeral connect → fetch → **disconnect**
2. `listAttachments` → **`getConnectedProvider`** → **cached connection remains open**
3. `fetchAttachmentBuffer` (per attachment) → **reuses cached** connection

**Next message** repeats step 1 with a **new** ephemeral connection while the **cached** connection from step 2 of the **previous** message may still be **connected** in `this.providers`.

That yields **two simultaneous TCP IMAP sessions** to the same account (different `ImapProvider` instances). Many hosts (including **web.de**-class shared hosting) enforce **one session per account** or behave badly with concurrent logins.

**`testConnection`** only uses a **short** ephemeral `provider.testConnection(account)` path and does **not** interleave cached + ephemeral like the sync loop did.

---

## Step 5 — Timeouts: `listMessages` vs `resolveImapPullFoldersExpanded`

| Stage | Timeout (orchestrator) |
|--------|-------------------------|
| Whole sync | **45s** (`Promise.race` in `syncAccountEmails`) |
| `resolveImapPullFoldersExpanded` | **30s** (`Promise.race`, **after fix**; fallback to base labels) |
| `listMessages` | **30s** (`Promise.race`) |

**Before fix:** expansion had no inner timeout; only the **45s** outer cap applied.

---

## Step 6 — Every IMAP connection in `syncAccountEmailsImpl`

| Call | Connection pattern | Timeout? |
|------|-------------------|------------|
| `maybeRunImapLegacyFolderConsolidation` | `new ImapProvider()` → connect → consolidate → **disconnect** in `finally` | No (only outer 45s) |
| `resolveImapPullFoldersExpanded` | Ephemeral connect/disconnect | **30s** after fix |
| `listMessages` | Ephemeral | **30s** |
| `getMessage` | Ephemeral | No (outer 45s) |
| `listAttachments` | **Was** `getConnectedProvider` (**cached)**; **now** ephemeral (`gateway.ts` fix) | No per call |
| `fetchAttachmentBuffer` | **Was** cached; **now** ephemeral | No per call |

**`detectAndRouteMessage`** / DB ingestion do not open IMAP.

---

## Step 7 — How many connections per sync (before vs after fix)

**Before fix (per new message after first attachment path):**

1. Ephemeral `getMessage` — 1 connection.
2. Cached `listAttachments` — **opens** cached session if missing; **keeps** it open.
3. Next message: ephemeral `getMessage` **while cached session still open** → **2 concurrent** sessions.

**After fix:**

- `listAttachments` / `fetchAttachmentBuffer` / `extractAttachmentText` for IMAP use **ephemeral** connect + `finally` disconnect, matching `listMessages` / `getMessage`.
- **At most one** IMAP TCP session at a time for the sync loop (sequential).

**Note:** Multiple folders still run **sequential** `listMessages` in a loop; each is ephemeral connect/disconnect — no overlap with the attachment fix.

---

## Step 8 — Diagnosis

| Question | Answer |
|----------|--------|
| **Where did it “hang”?** | User-visible **45s** sync timeout; slow or stuck IMAP calls anywhere in `syncAccountEmailsImpl` (including `resolveImapPullFoldersExpanded` before `listMessages`) could consume the budget. |
| **Primary structural bug** | **Mixed connection models:** `getMessage`/`listMessages` were **ephemeral (disconnect)** while **`listAttachments`/`fetchAttachmentBuffer` used `getConnectedProvider`**, leaving a **cached** IMAP connection **open** across messages. The **next** `getMessage` opened **another** connection → **concurrent** sessions. Many providers reject or stall the second session → **timeouts / generic connection errors** despite a successful `testConnection`. |
| **Secondary gap** | `resolveImapPullFoldersExpanded` had no **30s** race; only the **45s** outer timeout. |

---

## Step 9 — Fix (implemented in repo)

### 9.1 `apps/electron-vite-project/electron/main/email/gateway.ts`

IMAP branches for **`listAttachments`**, **`fetchAttachmentBuffer`**, and **`extractAttachmentText`** now mirror **`listMessages` / `getMessage`**: `getProvider` → `connect` → work → **`disconnect` in `finally`**.

See the live file for exact line numbers; the functions are:

- `listAttachments` … `extractAttachmentText` (attachment section)

### 9.2 `apps/electron-vite-project/electron/main/email/syncOrchestrator.ts`

- **`syncAccountEmails`** — unchanged logic except as documented above.
- **`syncAccountEmailsImpl`** — IMAP pull folder resolution now uses **`Promise.race([expandPromise, 30s timeout])`** with **fallback** to `basePullLabels` on failure/timeout.

---

## Copy-paste: full changed functions (source of truth = repo)

The following are **complete** copies of the updated functions as they exist in the codebase after this fix.

### `EmailGateway.listAttachments` / `fetchAttachmentBuffer` / `extractAttachmentText`

```typescript
  async listAttachments(accountId: string, messageId: string): Promise<AttachmentMeta[]> {
    const account = this.findAccount(accountId)
    if (account.provider === 'imap') {
      const provider = await this.getProvider(account)
      try {
        await provider.connect(account)
        const raw = await provider.listAttachments(messageId)
        return raw.map(att => ({
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          contentId: att.contentId,
          isInline: att.isInline,
          isTextExtractable: supportsTextExtraction(att.mimeType)
        }))
      } finally {
        try {
          await provider.disconnect()
        } catch {
          /* noop */
        }
      }
    }

    const provider = await this.getConnectedProvider(account)

    const raw = await provider.listAttachments(messageId)

    return raw.map(att => ({
      id: att.id,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      contentId: att.contentId,
      isInline: att.isInline,
      isTextExtractable: supportsTextExtraction(att.mimeType)
    }))
  }

  async fetchAttachmentBuffer(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer | null> {
    const account = this.findAccount(accountId)
    if (account.provider === 'imap') {
      const provider = await this.getProvider(account)
      try {
        await provider.connect(account)
        return provider.fetchAttachment(messageId, attachmentId)
      } finally {
        try {
          await provider.disconnect()
        } catch {
          /* noop */
        }
      }
    }

    const provider = await this.getConnectedProvider(account)
    return provider.fetchAttachment(messageId, attachmentId)
  }

  async extractAttachmentText(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<ExtractedAttachmentText> {
    const account = this.findAccount(accountId)

    if (account.provider === 'imap') {
      const provider = await this.getProvider(account)
      try {
        await provider.connect(account)
        const attachments = await provider.listAttachments(messageId)
        const attachment = attachments.find(a => a.id === attachmentId)

        if (!attachment) {
          throw new Error('Attachment not found')
        }

        if (!supportsTextExtraction(attachment.mimeType)) {
          throw new Error(`Text extraction not supported for ${attachment.mimeType}`)
        }

        const buffer = await provider.fetchAttachment(messageId, attachmentId)
        if (!buffer) {
          throw new Error('Could not fetch attachment content')
        }

        if (isPdfFile(attachment.mimeType, attachment.filename)) {
          const result = await extractPdfText(buffer)
          return {
            attachmentId,
            text: result.text,
            pageCount: result.pageCount,
            warnings: result.warnings,
          }
        }

        if (
          attachment.mimeType.startsWith('text/') ||
          attachment.mimeType === 'application/json' ||
          attachment.mimeType === 'application/vnd.beap+json'
        ) {
          return {
            attachmentId,
            text: buffer.toString('utf-8'),
          }
        }

        throw new Error(`Unsupported file type: ${attachment.mimeType}`)
      } finally {
        try {
          await provider.disconnect()
        } catch {
          /* noop */
        }
      }
    }

    const provider = await this.getConnectedProvider(account)

    const attachments = await provider.listAttachments(messageId)
    const attachment = attachments.find(a => a.id === attachmentId)

    if (!attachment) {
      throw new Error('Attachment not found')
    }

    if (!supportsTextExtraction(attachment.mimeType)) {
      throw new Error(`Text extraction not supported for ${attachment.mimeType}`)
    }

    const buffer = await provider.fetchAttachment(messageId, attachmentId)
    if (!buffer) {
      throw new Error('Could not fetch attachment content')
    }

    if (isPdfFile(attachment.mimeType, attachment.filename)) {
      const result = await extractPdfText(buffer)
      return {
        attachmentId,
        text: result.text,
        pageCount: result.pageCount,
        warnings: result.warnings,
      }
    }

    if (
      attachment.mimeType.startsWith('text/') ||
      attachment.mimeType === 'application/json' ||
      attachment.mimeType === 'application/vnd.beap+json'
    ) {
      return {
        attachmentId,
        text: buffer.toString('utf-8'),
      }
    }

    throw new Error(`Unsupported file type: ${attachment.mimeType}`)
  }
```

### `syncAccountEmails` (unchanged except context)

```typescript
export async function syncAccountEmails(db: any, options: SyncAccountOptions): Promise<SyncResult> {
  const accountId = options.accountId
  console.error('[SYNC] syncAccountEmails called:', accountId)

  // Clear any stuck chain older than 60 seconds
  const chainAge = syncChainTimestamps.get(accountId) ?? 0
  if (chainAge > 0 && Date.now() - chainAge > 60_000) {
    console.error('[SYNC] Clearing stuck syncChain for:', accountId)
    syncChains.delete(accountId)
    syncChainTimestamps.delete(accountId)
  }

  const prev = syncChains.get(accountId) ?? Promise.resolve()
  syncChainTimestamps.set(accountId, Date.now())

  const current = prev.then(
    () => syncAccountEmailsImpl(db, options),
    () => syncAccountEmailsImpl(db, options), // also run if previous REJECTED
  )

  // Wrap in a 45-second timeout so it can NEVER hang forever
  const withTimeout = Promise.race([
    current,
    new Promise<SyncResult>((_, reject) =>
      setTimeout(() => reject(new Error('syncAccountEmails timed out after 45s')), 45_000),
    ),
  ]).finally(() => {
    syncChainTimestamps.delete(accountId)
  })

  syncChains.set(accountId, withTimeout.then(() => undefined, () => undefined))
  return withTimeout
}
```

### `syncAccountEmailsImpl` — pull-folder block only (the part that changed)

The rest of `syncAccountEmailsImpl` is unchanged. The **new** IMAP folder resolution is:

```typescript
      const basePullLabels = accountCfg ? resolveImapPullFolders(accountCfg) : ['INBOX']
      let pullFolders: string[]
      if (accountCfg?.provider === 'imap') {
        const expandPromise = emailGateway.resolveImapPullFoldersExpanded(accountId, basePullLabels)
        const expandTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('resolveImapPullFoldersExpanded timed out after 30s')), 30_000),
        )
        try {
          pullFolders = await Promise.race([expandPromise, expandTimeout])
        } catch (e: any) {
          console.warn('[SyncOrchestrator] resolveImapPullFoldersExpanded failed or timed out:', e?.message ?? e)
          pullFolders = basePullLabels
        }
      } else {
        pullFolders = basePullLabels
      }
      pullFoldersResolved = pullFolders
```

---

## Optional follow-up (not in this change)

- **Performance:** `fetchAttachmentBuffer` per attachment now does connect/disconnect each time. **Correctness** first; a later optimization could reuse **one** ephemeral session for **all** attachments of one message in a single `try/finally`.
- **`Promise.race` + orphaned work:** If `listMessages` loses the 30s race, the underlying `listMessages` promise may still run until completion. Same as before; consider `AbortSignal` if the IMAP client exposes cancellation.
