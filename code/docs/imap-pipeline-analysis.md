# IMAP sync pipeline — code & architecture analysis

**Scope:** Current tree as of this document’s authoring. Traces **auto-sync / manual Pull** from timer or IPC through `syncAccountEmails` → `gateway.listMessages` → provider or simple-pull → ingestion into `inbox_messages`.

**Critical architectural fact:** For **IMAP accounts with a non-empty stored password**, `EmailGateway.listMessages` does **not** call `ImapProvider.fetchMessages`. It calls **`imapSimplePullListMessages`** (`imapSimplePull.ts`), which uses **`client.seq.fetch`** on a **sequence range** and applies **`fromDate` / `toDate` only in `postFilter` (client-side)**. The SEARCH + **`this.client!.fetch` (UID FETCH)** path lives in **`ImapProvider.fetchMessages` → `fetchMessagesSince`**, which runs only when listing goes through **`getConnectedProvider` → `provider.fetchMessages`** (e.g. IMAP without password on that branch, or non-IMAP providers).

---

## 1. Auto-Sync Trigger

### Where the interval/timer is defined

**Per-account loop** — `setTimeout` chain in `startAutoSync` (`syncOrchestrator.ts`):

```684:738:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\syncOrchestrator.ts
export function startAutoSync(
  db: any,
  accountId: string,
  intervalMs: number = 300_000,
  onNewMessages?: (result: SyncResult) => void,
  /** Resume background remote-queue drain when bounded inline drain does not finish. */
  getDbForRemoteDrain?: () => Promise<any> | any,
): { stop: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    try {
      console.log('[AUTO_SYNC] Tick fired for account:', accountId)
      const row = db.prepare('SELECT auto_sync_enabled FROM email_sync_state WHERE account_id = ?').get(accountId) as { auto_sync_enabled?: number } | undefined
      if (row?.auto_sync_enabled !== 1) {
        scheduleNext()
        return
      }

      const result = await syncAccountEmails(db, { accountId })
      processPendingPlainEmails(db)
      processPendingP2PBeapEmails(db)
      try {
        if (result.newInboxMessageIds.length > 0) {
          enqueueRemoteOpsForLocalLifecycleState(db, result.newInboxMessageIds)
        }
        await drainOrchestratorRemoteQueueBounded(
          db,
          getDbForRemoteDrain ? { getDbForDrainContinue: getDbForRemoteDrain } : undefined,
        )
        if (getDbForRemoteDrain) scheduleOrchestratorRemoteDrain(getDbForRemoteDrain)
      } catch (e: any) {
        console.warn('[SyncOrchestrator] Post-sync remote drain:', e?.message)
        if (getDbForRemoteDrain) scheduleOrchestratorRemoteDrain(getDbForRemoteDrain)
      }
      if (result.newMessages > 0 && onNewMessages) {
        onNewMessages(result)
      }
    } catch (err: any) {
      console.error('[SyncOrchestrator] Auto-sync tick error:', err?.message)
    }
    scheduleNext()
  }

  const scheduleNext = () => {
    timeoutId = setTimeout(tick, intervalMs)
  }

  tick()

  return {
    stop() {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
  }
}
```

**Registration / resume** — `ipc.ts` resumes loops for active accounts when any row has `auto_sync_enabled = 1`, and `inbox:toggleAutoSync` starts/stops `startStoredAutoSyncLoopIfMissing` (helper in same file). **Brute-force IMAP** `setInterval` (every 2 minutes) at end of `registerInboxHandlers`:

```4723:4750:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\ipc.ts
  // --- IMAP Auto-Sync (brute force) ---
  // Separate from DB-driven auto_sync loops: periodic pull for every active IMAP account.
  const IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000

  setInterval(() => {
    void (async () => {
      try {
        const accounts = await emailGateway.listAccounts()
        const db = await resolveDb()
        if (!db) return

        for (const acc of accounts) {
          if (acc.provider !== 'imap' || acc.status !== 'active') continue
          console.log('[IMAP-AUTO-SYNC] Triggering pull for IMAP account:', acc.id, acc.email)
          try {
            await syncAccountEmails(db, { accountId: acc.id })
            console.log('[IMAP-AUTO-SYNC] Pull completed for:', acc.id)
          } catch (err) {
            console.error('[IMAP-AUTO-SYNC] Pull failed for:', acc.id, err)
          }
        }
      } catch (err) {
        console.error('[IMAP-AUTO-SYNC] Error:', err)
      }
    })()
  }, IMAP_AUTO_SYNC_INTERVAL_MS)

  console.log('[IMAP-AUTO-SYNC] Registered IMAP auto-sync interval (every 2 min)')
```

### What accounts are iterated

- **DB-driven loop:** One timer **per `accountId`** that has a started loop; each tick only checks **that** account’s `email_sync_state.auto_sync_enabled === 1`. Resume logic loads **all `status === 'active'`** accounts from `emailGateway.listAccounts()` and sets `auto_sync_enabled = 1` + starts a loop for each when **any** row had auto on (see `ipc.ts` ~2506–2533).
- **Brute-force:** `emailGateway.listAccounts()` then `acc.provider === 'imap' && acc.status === 'active'`.

### Call path to `syncAccountEmails`

- **Direct:** `await syncAccountEmails(db, { accountId })` inside `startAutoSync` tick and inside brute-force `setInterval`.

### Conditions that skip IMAP (provider / syncMode / authType)

- **`startAutoSync` tick:** Skips pull if `auto_sync_enabled !== 1` for **that** account — **not** provider-specific (same for OAuth and IMAP).
- **No** `syncMode`, `authType`, or `provider === 'microsoft365'` check in `startAutoSync`.
- **Brute-force:** Only **non-IMAP** or **non-active** accounts are skipped.

---

## 2. `syncAccountEmails` entry (`syncOrchestrator.ts`)

### Signature and first ~50 lines (public + start of impl)

```314:384:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\syncOrchestrator.ts
export async function syncAccountEmails(db: any, options: SyncAccountOptions): Promise<SyncResult> {
  console.error('SYNC_ENTRY', options.accountId, new Date().toISOString())
  const accountId = options.accountId
  const accountEarly = emailGateway.getAccountConfig(accountId)
  console.log('[IMAP-PULL-TRACE] syncAccountEmails entry:', {
    accountId,
    provider: accountEarly?.provider,
    hasImapConfig: !!accountEarly?.imap,
    imapHost: accountEarly?.imap?.host,
    syncWindowDays: accountEarly?.sync?.syncWindowDays,
  })
  emailDebugLog(
    '[SYNC-DEBUG] syncAccountEmails invoked (serialized per account via syncChains; does not skip if pull lock active)',
    { accountId, pullMore: options.pullMore === true },
  )
  const prev = syncChains.get(accountId) ?? Promise.resolve()
  const current = prev.then(() => syncAccountEmailsImpl(db, options))
  syncChains.set(accountId, current.then(() => undefined, () => undefined))
  return current
}

async function syncAccountEmailsImpl(
  db: any,
  options: SyncAccountOptions,
): Promise<SyncResult> {
  const { accountId, pullMore = false } = options
  const result: SyncResult = {
    ok: true,
    newMessages: 0,
    beapMessages: 0,
    plainMessages: 0,
    errors: [],
    newInboxMessageIds: [],
  }

  try {
    const accountInfo = await emailGateway.getAccount(accountId)
    if (accountInfo?.provider === 'imap') {
      await maybeRunImapLegacyFolderConsolidation(db, accountId)
    }
    const accountCfg = emailGateway.getAccountConfig(accountId)
    const windowDays = getEffectiveSyncWindowDays(accountCfg?.sync)
    const maxPerPull = getMaxMessagesPerPull(accountCfg?.sync)

    let windowStartIso: string | undefined
    if (windowDays > 0) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - windowDays)
      windowStartIso = d.toISOString()
    }

    const stateRow = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
    const lastSyncAt = stateRow?.last_sync_at as string | undefined
    const lastUid = stateRow?.last_uid as string | undefined
    const syncCursor = stateRow?.sync_cursor as string | undefined

    const hasPriorSync = Boolean(lastSyncAt)
    const bootstrap = !hasPriorSync && !pullMore

    emailDebugLog('[SYNC-DEBUG] sync prefs + DB sync state', {
      accountId,
      provider: accountCfg?.provider,
      rawAccountSync: accountCfg?.sync ?? null,
      windowDays,
      windowStartIsoForBootstrap: windowStartIso ?? '(none — all time)',
      maxPerPull,
      last_sync_at: lastSyncAt ?? null,
      hasPriorSync,
      bootstrap,
      pullMore,
    })

    let listOptions: MessageSearchOptions
```

### Every early `return result` in `syncAccountEmailsImpl` (with conditions)

| Line | Condition | Effect |
|------|-----------|--------|
| **399** | `pullMore === true` and `getOldestInboxReceivedAtIso` is falsy | `result.ok = false`, error string, **`listedFromProvider = 0`**, return |
| **407** | `pullMore` and invalid `Date` from oldest local | same |
| **678** | Normal exit (success or prior catch) | `return result` |

There is **no** early return before `listMessages` for normal Pull / auto-sync / bootstrap. **Pull More** can return before list (lines 399, 407).

**Outer `try` catch (lines ~627–649):** sets `result.ok = false`, appends error, updates sync state — does **not** rethrow; execution continues to final `return result` at **678**.

### IMAP with `last_sync_at === null`

- `hasPriorSync === false`, `pullMore === false` ⇒ **`bootstrap === true`**.
- Uses branch `else if (bootstrap)` → `listOptions` with `syncFetchAllPages: true`, `syncMaxMessages: maxPerPull`, and **`fromDate: windowStartIso` only if `windowDays > 0`**.

### Typical bootstrap numbers (defaults)

From `smartSyncPrefs.ts` (see §10): **`getEffectiveSyncWindowDays`** default **30**; **`getMaxMessagesPerPull`** default **500**.

So for a **new account** with default sync prefs and `windowDays = 30`:

- **`syncWindowDays` (effective):** `30`
- **`maxMessagesPerPull`:** `500`
- **`fromDate` on bootstrap:** `windowStartIso` = **now − 30 days** (ISO string). If `sync.syncWindowDays === 0`, **`fromDate` is omitted** (full-window / all-time semantics per orchestrator comment, still capped by `syncMaxMessages`).

---

## 3. Folder resolution

### `resolveImapPullFolders` (domain)

```17:46:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\domain\imapPullFolders.ts
export function resolveImapPullFolders(account: EmailAccountConfig): string[] {
  if (account.provider !== 'imap') {
    return [account.folders?.inbox?.trim() || 'INBOX']
  }

  const monitored = account.folders?.monitored
  let base: string[]
  if (!monitored || monitored.length === 0) {
    base = ['INBOX', 'Spam']
  } else if (monitored.length === 1 && monitored[0]?.trim().toUpperCase() === 'INBOX') {
    /** Legacy single-INBOX accounts — add Spam so junk can be triaged without changing stored JSON. */
    base = ['INBOX', 'Spam']
  } else {
    base = monitored.map((f) => f.trim()).filter(Boolean)
  }

  try {
    const names = resolveOrchestratorRemoteNames(account)
    const im = names.imap
    const lifecycle = new Set(
      [im.archiveMailbox, im.pendingDeleteMailbox, im.pendingReviewMailbox, im.urgentMailbox, im.trashMailbox]
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    )
    const filtered = base.filter((f) => f && !lifecycle.has(f.trim().toLowerCase()))
    return filtered.length > 0 ? filtered : ['INBOX', 'Spam']
  } catch {
    return base.length > 0 ? base : ['INBOX', 'Spam']
  }
}
```

### `resolveImapPullFoldersExpanded` (gateway)

```1282:1308:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async resolveImapPullFoldersExpanded(accountId: string, baseLabels: string[]): Promise<string[]> {
    const account = this.accounts.find((a) => a.id === accountId)
    const fallback = baseLabels.length > 0 ? baseLabels : ['INBOX']
    if (!account || account.provider !== 'imap') {
      return fallback
    }
    try {
      const provider = await this.getConnectedProvider(account)
      const expand = (provider as ImapProvider).expandPullFoldersForSync
      if (typeof expand === 'function') {
        const expanded = await expand.call(provider, baseLabels.length > 0 ? baseLabels : ['INBOX'])
        emailDebugLog('[SYNC-DEBUG] resolveImapPullFoldersExpanded', {
          accountId,
          baseLabels,
          expanded,
        })
        return expanded
      }
    } catch (e: any) {
      console.warn('[EmailGateway] resolveImapPullFoldersExpanded failed, using base labels:', e?.message || e)
    }
    emailDebugLog('[SYNC-DEBUG] resolveImapPullFoldersExpanded fallback (non-IMAP or expand missing / error)', {
      accountId,
      baseLabels,
      fallback,
    })
    return fallback
  }
```

### web.de

There is **no** hard-coded “web.de” host branch. **web.de** uses the same logic: default base **`['INBOX','Spam']`** unless `folders.monitored` overrides; **expanded** paths come from **`ImapProvider.expandPullFoldersForSync`** (LIST-based) when `getConnectedProvider` succeeds.

### Empty folder list?

`resolveImapPullFolders` always returns a **non-empty** array (`['INBOX', 'Spam']` as last resort). `resolveImapPullFoldersExpanded` returns **`fallback`** which is **`baseLabels` if non-empty else `['INBOX']`**. So **orchestrator’s `pullFolders[0]`** is always defined when `basePullLabels` came from `resolveImapPullFolders`; the **multi-folder branch** runs when **`pullFolders.length > 1`**.

---

## 4. `gateway.listMessages` (full method)

```576:592:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]> {
    const account = this.findAccount(accountId)
    console.error('GATEWAY_LIST', account.id, account.provider)
    const effectiveFolders = getFoldersForAccountOperation(account, options?.mailboxId)
    const folder = options?.folder ?? effectiveFolders.inbox

    if (account.provider === 'imap' && account.imap?.password?.trim()) {
      console.error('GATEWAY_LIST_PATH', account.id, 'imapSimplePullListMessages')
      const rawMessages = await imapSimplePullListMessages(account, folder, options)
      return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
    }

    const provider = await this.getConnectedProvider(account)
    console.error('GATEWAY_LIST_PATH', account.id, 'provider.fetchMessages', account.provider)
    const rawMessages = await provider.fetchMessages(folder, options)
    return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
  }
```

### `getConnectedProvider` when listing without simple-pull

**Not used** when IMAP has password (branch above). **Used** for OAuth and for IMAP missing password on that check. **Cached provider disconnected:** `getConnectedProvider` reconnects if `!provider.isConnected()` (see excerpt below).

```1404:1470:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  private async getConnectedProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    if (account.provider === 'imap') {
      const pw = account.imap?.password
      if (pw == null || String(pw).trim().length === 0) {
        console.error(
          '[EmailGateway] IMAP password missing — refusing connect for account',
          account.id,
          account.email,
        )
        throw new Error('IMAP password is missing — account may need to be reconnected.')
      }
    }

    let provider = this.providers.get(account.id)
    
    if (!provider) {
      provider = await this.getProvider(account)
      // ... onTokenRefresh ...
      await provider.connect(account)
      // ...
      this.providers.set(account.id, provider)
    } else if (!provider.isConnected()) {
      // ...
      await provider.connect(account)
      // ...
    }
    
    return provider
  }
```

### Options passed to `provider.fetchMessages`

The **same** `options` object passed into `listMessages` (plus orchestrator merges `folder`). Orchestrator passes **`{ ...listOptions, folder }`** where `listOptions` includes `limit`, `syncFetchAllPages`, `syncMaxMessages`, and **`fromDate` / `toDate`** as built in `syncAccountEmailsImpl`.

---

## 5. `ImapProvider.fetchMessages` (full method)

**Note:** This runs **only** when `listMessages` does **not** take the `imapSimplePullListMessages` branch.

```813:1031:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\providers\imap.ts
  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    console.error('IMAP_FETCH_ENTRY', folder, options)
    console.error('IMAP_CLIENT_STATE', !!this.client, this.client?.state, this.isConnected())

    if (!this.client) {
      throw new Error('Not connected')
    }

    emailDebugLog('[SYNC-DEBUG] ImapProvider.fetchMessages entry', {
      folder,
      fromDate: options?.fromDate ?? null,
      toDate: options?.toDate ?? null,
      syncFetchAllPages: options?.syncFetchAllPages === true,
      syncMaxMessages: options?.syncMaxMessages ?? null,
    })

    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
    const chunkSize = 60

    if (options?.toDate && !options?.fromDate) {
      const before = new Date(options.toDate)
      if (!Number.isNaN(before.getTime())) {
        return this.fetchMessagesBeforeExclusive(folder, before, options)
      }
    }

    if (options?.fromDate) {
      const since = new Date(options.fromDate)
      if (!Number.isNaN(since.getTime())) {
        return this.fetchMessagesSince(folder, since, options)
      }
      emailDebugLog(
        '[SYNC-DEBUG] IMAP fetchMessages: fromDate present but invalid — falling through to seq-range path (no SINCE SEARCH)',
        { folder, fromDate: options.fromDate },
      )
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err, box) => {
        // ... seq.fetch paths for !syncAll and syncAll chunking via seq.fetch ...
      })
    })
  }
```

*(The `new Promise` body continues with `seq.fetch` for non-SINCE paths: lines ~856–1030.)*

### Branch selection

1. **`toDate` set, `fromDate` unset**, valid date → **`fetchMessagesBeforeExclusive`** (Pull More).
2. **`fromDate` set**, valid date → **`fetchMessagesSince`**.
3. **`fromDate` invalid string** → logs and falls through to **seq-range / openBox** path.
4. **No valid `fromDate`** → seq-range path.

### Bootstrap with `fromDate` set

Takes **`fetchMessagesSince(folder, since, options)`** (SEARCH SINCE + UID fetch chunks).

---

## 6. `fetchMessagesSince` (SEARCH + fetch)

### Full method (current)

```523:673:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\providers\imap.ts
  private fetchMessagesSince(folder: string, since: Date, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
    const chunkSize = 60

    const attachParser = (msg: ImapConnection.ImapMessage, msgData: Partial<RawEmailMessage>) => {
      // ... header + attributes ...
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err) => {
        if (err) {
          reject(err)
          return
        }
        let searchCriteria: any = ['SINCE', since]
        if (options?.toDate) {
          const before = new Date(options.toDate)
          if (!Number.isNaN(before.getTime())) {
            searchCriteria = ['AND', ['SINCE', since], ['BEFORE', before]]
          }
        }
        // ... emailDebugLog ...
        this.client!.search([searchCriteria], (sErr, uids: number[]) => {
          if (sErr) {
            reject(sErr)
            return
          }
          const n = uids?.length ?? 0
          // ...
          if (!uids?.length) {
            // ...
            resolve([])
            return
          }
          const sorted = [...uids].sort((a, b) => a - b)
          let pick = syncAll ? sorted : sorted.slice(Math.max(0, sorted.length - limit))
          if (pick.length > maxM) {
            pick = pick.slice(-maxM)
          }

          const all: RawEmailMessage[] = []
          let i = 0
          let imapChunkIdx = 0

          const nextChunk = () => {
            if (i >= pick.length) {
              // ...
              resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
              return
            }
            imapChunkIdx++
            const slice = pick.slice(i, i + chunkSize)
            i += chunkSize
            // ...
            const spec = slice.join(',')
            const batch: RawEmailMessage[] = []
            // connection.search() returns UIDs, not sequence numbers.
            // Use this.client!.fetch (UID-based) not seq.fetch (sequence-based).
            const fetch = this.client!.fetch(spec, {
              bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
              struct: true,
            })
            fetch.on('message', (msg) => {
              // ...
            })
            fetch.once('error', reject)
            fetch.once('end', () => {
              all.push(...batch)
              nextChunk()
            })
          }

          nextChunk()
        })
      })
    })
  }
```

### CRITICAL: after `search()` → which fetch?

**Current code uses `this.client!.fetch(spec, { ... })` — UID-based fetch** (not `seq.fetch` for the UID list). Comment in source explicitly states SEARCH returns UIDs.

### Was the `seq.fetch` → `fetch` fix applied?

**Yes, in `fetchMessagesSince` and `fetchMessagesBeforeExclusive`** (both use `this.client!.fetch` for UID slices). **`imapSimplePullListMessages` still uses `client.seq.fetch`** — by design for that path (sequence range of newest N), not SEARCH UIDs.

---

## 7. Message ingestion

### After list: orchestrator loop

For each listed `msg`:

1. **Dedup:** `existingIds.has(msg.id)` where `existingIds` = all `email_message_id` values in `inbox_messages` for that `account_id` (**`getExistingEmailMessageIds`**). Match is on **list row `id`** (IMAP UID string) vs DB **`email_message_id`**.

```127:137:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\syncOrchestrator.ts
function getExistingEmailMessageIds(db: any, accountId: string): Set<string> {
  if (!db) return new Set()
  try {
    const rows = db.prepare(
      'SELECT email_message_id FROM inbox_messages WHERE account_id = ? AND email_message_id IS NOT NULL'
    ).all(accountId) as Array<{ email_message_id: string }>
    return new Set(rows.map((r) => r.email_message_id))
  } catch {
    return new Set()
  }
}
```

2. **`getMessage` + `detectAndRouteMessage`:** Full detail fetch then router inserts **`inbox_messages`** (+ attachments, pending tables).

```512:557:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\syncOrchestrator.ts
      for (const msg of messages) {
        if (existingIds.has(msg.id)) {
          skippedDuplicate++
          continue
        }

        try {
          const detail = await emailGateway.getMessage(accountId, msg.id)
          if (!detail) {
            result.errors.push(`Could not fetch message ${msg.id}`)
            continue
          }
          // ... listAttachments ...
          const rawMsg = mapToRawEmailMessage(detail, attachments, { provider: accountInfo?.provider })
          const routeResult = await detectAndRouteMessage(db, accountId, rawMsg)
```

### Dedup “silent skip”

**Yes:** if **every** listed message’s `msg.id` is already in `existingIds`, **`newCount` stays 0** without error (unless `getMessage` fails). **`listedFromProvider`** can still be **> 0**.

### `detectAndRouteMessage` insert (core columns)

```283:313:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\messageRouter.ts
  const insertInbox = db.prepare(`
    INSERT INTO inbox_messages (
      id, source_type, handshake_id, account_id, email_message_id,
      from_address, from_name, to_addresses, cc_addresses,
      subject, body_text, body_html, beap_package_json,
      has_attachments, attachment_count, received_at, ingested_at,
      imap_remote_mailbox, imap_rfc_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertInbox.run(
    inboxMessageId,
    detectedType === 'beap' ? 'email_beap' : 'email_plain',
    handshakeId,
    accountId,
    messageId,
    fromAddr,
    fromName,
    JSON.stringify(toAddrs),
    JSON.stringify(ccAddrs),
    subject,
    bodyText,
    bodyHtml,
    beapPackageJson,
    hasAttachments ? 1 : 0,
    attachments.length,
    receivedAt,
    now,
    imapRemoteMailbox,
    imapRfcMessageId,
  )
```

**IMAP storage id:** `resolveStorageEmailMessageId` prefers **uid / id** for IMAP (RFC Message-ID separate column).

---

## 8. Auto-sync scheduling for IMAP

- **Next tick:** `startAutoSync` always calls **`scheduleNext()`** at end of `tick` (even on error in outer try), so the **same interval** repeats. **No** separate OAuth vs IMAP scheduler in `startAutoSync`.
- **Brute-force:** Fixed **`setInterval` 2 min** for all active IMAP accounts — **independent** of `auto_sync_enabled`.
- **Brute-force present:** Yes — see §1 paste from **`ipc.ts` ~4723–4750** and **`console.log('[IMAP-AUTO-SYNC] Registered...')`** at **4750**.

---

## 9. Error swallowing (non-rethrow highlights)

| Location | Behavior |
|----------|----------|
| `getExistingEmailMessageIds` | `catch { return new Set() }` — failed query ⇒ **empty dedup set** (could cause duplicate insert attempts / DB errors). |
| `syncOrchestrator` multi-folder loop | `catch (folderErr)` — **appends** to `result.errors`, **continues** other folders. |
| `syncOrchestrator` per-message | `catch` — appends error, **continues**. |
| `syncOrchestrator` attachment fetch | inner `catch { }` — non-fatal. |
| `syncOrchestrator` `listAttachments` | `catch` — **warn**, continues. |
| `startAutoSync` post-sync drain | `catch` — **warn**, still `scheduleNext()`. |
| `startAutoSync` tick outer | `catch` — **console.error**, still `scheduleNext()`. |
| `imapSimplePullListMessages` `finally` | `client.end()` in **`catch {}`** — ignores end errors. |
| `gateway.resolveImapPullFoldersExpanded` | `catch` — **warn**, returns **fallback** labels. |
| `messageRouter` / various JSON parses | `catch { /* ignore */ }` in detection helpers. |
| Brute-force `setInterval` | per-account **`catch`** logs, **continues** loop. |

**IMAP list** errors on one folder in multi-folder mode **do not abort** the whole sync; they only add to `result.errors`.

---

## 10. File stats (current workspace)

| File | Line count (approx.) | Last modified (mtime, local disk) |
|------|----------------------|-----------------------------------|
| `electron/main/email/ipc.ts` | 4753 | 2026-03-24 15:50:54 |
| `electron/main/email/syncOrchestrator.ts` | 743 | 2026-03-24 16:01:06 |
| `electron/main/email/gateway.ts` | 1579 | 2026-03-24 16:01:26 |
| `electron/main/email/providers/imap.ts` | 2184 | 2026-03-24 16:01:16 |
| `electron/main/email/emailDebug.ts` | 34 | 2026-03-24 15:04:02 |
| `electron/main/email/domain/smartSyncPrefs.ts` | 39 | 2026-03-24 13:51:54 |

*(Paths relative to `apps/electron-vite-project/`.)*

---

## 11. Diagnosis

### Where IMAP can “fail” or return 0 without a thrown error

1. **Password IMAP list path (`imapSimplePullListMessages`):**  
   - **`openBox`** fails → rejected (throws up to orchestrator).  
   - **`total === 0`** → `[]`.  
   - **`seq.fetch`** returns headers; **`postFilter`** applies **`fromDate` / `toDate` on `m.date` (header date)**. If server INTERNALDATE vs header **SINCE** window diverges, **all rows can be filtered out** ⇒ **0 messages** after list despite non-empty mailbox.  
   - **`n`** capped by `total`; `fromDate` forces **`n = Math.max(n, 400)`** then **`min(total, n)`** — only fetches up to **newest N** sequences, then filters — **older mail in window can be missed** if N < count of messages in folder.

2. **`ImapProvider.fetchMessages` path (no password branch):**  
   - **`search`** returns **[]** → resolve **[]** (incremental/bootstrap with SINCE).  
   - **Not connected** → **throws** `'Not connected'`.

3. **Dedup:** **`existingIds.has(msg.id)`** skips ingestion; **listed count can be positive**, **newMessages 0**.

4. **`getMessage` returns null:** Adds error string, **skips** that message.

### Exact fix candidates (illustrative — product decision required)

- **Unify or document dual paths:** Either route password IMAP through the same SEARCH/UID strategy as `fetchMessagesSince`, or make `imapSimplePull` use **UID SEARCH + `client.fetch`** when `fromDate` is set, and align date filtering with server criteria instead of only header `Date`.
- **`postFilter` vs bootstrap:** If keeping simple-pull, consider filtering with a field consistent with IMAP SEARCH (or widen fetched seq range when `fromDate` is set).
- **Dedup mismatch:** If list `id` and DB `email_message_id` ever diverge (format), fix **sanitized id** or **getExisting** keying.

### Previous fix “lost”?

The **UID SEARCH → `this.client!.fetch`** fix **is present** in **`fetchMessagesSince` / `fetchMessagesBeforeExclusive`** in the current `imap.ts`. It does **not** apply to **`imapSimplePullListMessages`**, which is the **actual** list path for typical password-based IMAP in `gateway.listMessages`. That split is **by current design**, not an overwritten lost patch in those methods.

---

## Appendix: `imapSimplePull.ts` (password IMAP list — full current file)

```typescript
/** IMAP list via seq.fetch on newest N by sequence number only (no SEARCH). fromDate filtered client-side. */
import * as ImapMod from 'imap'
import type { RawEmailMessage } from './base'
import type { EmailAccountConfig, MessageSearchOptions } from '../types'
import { imapUsesImplicitTls } from '../domain/securityModeNormalize'

const ImapCtor = (ImapMod as any).default ?? ImapMod

function parseOne(s: string): { email: string; name?: string } {
  if (!s) return { email: '' }
  const m = s.match(/^([^<]*)<([^>]+)>$/)
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, '')
    const email = m[2].trim().toLowerCase()
    return name ? { email, name } : { email }
  }
  return { email: s.trim().toLowerCase() }
}

function parseMany(h: string): Array<{ email: string; name?: string }> {
  if (!h) return []
  const parts: string[] = []
  let cur = ''
  let q = false
  for (const c of h) {
    if (c === '"') q = !q
    else if (c === ',' && !q) {
      if (cur.trim()) parts.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map(parseOne)
}
function postFilter(rows: RawEmailMessage[], o?: MessageSearchOptions): RawEmailMessage[] {
  let out = rows
  const ft = o?.fromDate ? new Date(o.fromDate).getTime() : NaN
  if (!Number.isNaN(ft)) out = out.filter((m) => m.date.getTime() >= ft)
  const tt = o?.toDate ? new Date(o.toDate).getTime() : NaN
  if (!Number.isNaN(tt)) out = out.filter((m) => m.date.getTime() < tt)
  if (o?.unreadOnly) out = out.filter((m) => !m.flags.seen)
  if (o?.flaggedOnly) out = out.filter((m) => m.flags.flagged)
  out.sort((a, b) => b.date.getTime() - a.date.getTime())
  let lim = o?.limit ?? 50
  if (o?.syncFetchAllPages) lim = o.syncMaxMessages != null ? Math.max(1, o.syncMaxMessages) : out.length
  return out.length > lim ? out.slice(0, lim) : out
}

export async function imapSimplePullListMessages(
  account: EmailAccountConfig,
  folder: string,
  options?: MessageSearchOptions,
): Promise<RawEmailMessage[]> {
  console.error('IMAP_SIMPLE_PULL_ENTRY', account.id, account.email, folder, {
    fromDate: options?.fromDate ?? null,
    toDate: options?.toDate ?? null,
  })
  const im = account.imap
  if (!im?.password?.trim()) throw new Error('IMAP password missing')
  if (typeof ImapCtor !== 'function') throw new Error('imap module did not load')
  const client = new ImapCtor({
    user: im.username,
    password: im.password,
    host: im.host,
    port: im.port,
    tls: imapUsesImplicitTls(im.security),
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 10000,
    authTimeout: 10000,
  })
  await new Promise<void>((resolve, reject) => {
    client.once('error', reject)
    client.once('ready', () => {
      client.removeAllListeners('error')
      client.on('error', () => {})
      resolve()
    })
    client.connect()
  })
  console.error('IMAP_SIMPLE_PULL_CONNECTED', account.id, !!client, (client as any)?.state)
  try {
    const rows = await new Promise<RawEmailMessage[]>((resolve, reject) => {
      client.openBox(folder, true, (err: Error | null, box?: { messages: { total: number } }) => {
        if (err) {
          reject(err)
          return
        }
        const total = box?.messages.total ?? 0
        if (total === 0) {
          resolve([])
          return
        }
        let n = Math.max(1, options?.limit ?? 50)
        if (options?.syncFetchAllPages && options.syncMaxMessages != null) {
          n = Math.max(n, Math.min(Math.max(1, options.syncMaxMessages), 50000))
        } else if (options?.syncFetchAllPages) n = Math.max(n, 500)
        if (options?.fromDate) n = Math.max(n, 400)
        n = Math.min(total, n)
        const start = Math.max(1, total - n + 1)
        const acc: RawEmailMessage[] = []
        const fetch = client.seq.fetch(`${start}:${total}`, {
          bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)'],
          struct: true,
        })
        const blank = { seen: false, flagged: false, answered: false, draft: false, deleted: false }
        fetch.on('message', (msg: any) => {
          const msgData: Partial<RawEmailMessage> = { id: '', folder, flags: { ...blank }, labels: [] }
          msg.on('body', (stream: NodeJS.ReadableStream, info: { which: string }) => {
            let buf = ''
            stream.on('data', (c: Buffer | string) => {
              buf += c.toString('utf8')
            })
            stream.once('end', () => {
              if (!info.which.includes('HEADER')) return
              const h = ImapCtor.parseHeader(buf)
              msgData.subject = h.subject?.[0] || '(No Subject)'
              msgData.from = parseOne(h.from?.[0] || '')
              msgData.to = parseMany(h.to?.[0] || '')
              msgData.cc = parseMany(h.cc?.[0] || '')
              msgData.date = new Date(h.date?.[0] || Date.now())
              msgData.headers = {
                messageId: h['message-id']?.[0],
                inReplyTo: h['in-reply-to']?.[0],
                references: h.references?.[0]?.split(/\s+/) || [],
              }
            })
          })
          msg.once('attributes', (attrs: { uid?: number; flags?: string[] }) => {
            msgData.id = String(attrs.uid ?? '')
            msgData.uid = msgData.id
            if (attrs.flags) {
              msgData.flags = {
                seen: attrs.flags.includes('\\Seen'),
                flagged: attrs.flags.includes('\\Flagged'),
                answered: attrs.flags.includes('\\Answered'),
                draft: attrs.flags.includes('\\Draft'),
                deleted: attrs.flags.includes('\\Deleted'),
              }
            }
          })
          msg.once('end', () => acc.push(msgData as RawEmailMessage))
        })
        fetch.once('error', reject)
        fetch.once('end', () => resolve(acc))
      })
    })
    return postFilter(rows, options)
  } finally {
    try {
      client.end()
    } catch {}
  }
}
```

*(Source: `apps/electron-vite-project/electron/main/email/providers/imapSimplePull.ts`.)*

---

## Register handler log (actual)

```1275:1281:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\ipc.ts
export function registerInboxHandlers(
  getDb: () => Promise<any> | any,
  mainWindow?: BrowserWindow | null,
  _getAnthropicApiKey?: GetAnthropicApiKey,
): void {
  console.log('[INBOX-IPC] registerInboxHandlers called')
```
