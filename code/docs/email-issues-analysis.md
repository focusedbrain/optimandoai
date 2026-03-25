# Email Issues — Code & Architecture Analysis

This document is a **read-only** trace through the codebase as of the current tree. Commands were run from git root `code_clean`. Application source files were not modified.

---

## Issue 1: Gmail Instant Refresh

### 1.1 Recent Microsoft Fix

The task suggested searching git since `2025-03-10`; given the environment date (March 2025 / 2026 branch naming), logs were also taken for **`--since="2026-03-10"`** on branch history. Commits that clearly relate to **inbox UI refresh after sync** are:

| Commit | Short message | Files (from `git show --stat`) |
|--------|---------------|--------------------------------|
| `ad322ca2` | build1115: inbox sync UI refresh (broadcast + deferred fetch), output paths | `electron/main/email/ipc.ts`, `syncOrchestrator.ts`, `EmailInboxView.tsx`, `EmailInboxBulkView.tsx`, `useEmailInboxStore.ts`, docs |
| `4c6df42c` | build2225: inbox refresh on new messages, output paths, merge main | `EmailInboxView.tsx`, `EmailInboxBulkView.tsx`, docs (renderer: remove deferral on `inbox:newMessages`) |
| `57843690` | build9975: output paths, IMAP auto-sync inbox refresh broadcast, inbox UI analysis doc | `electron/main/email/ipc.ts`, `docs/inbox-ui-refresh-analysis.md` |

Full messages (excerpt):

- **`ad322ca2`**: “broadcastInboxSnapshotAfterSync… startAutoSync onSyncComplete… Manual pull sendToRenderer when result.ok…”
- **`4c6df42c`**: “Always refresh inbox list on inbox:newMessages (remove syncing deferral).”

Broader recent history (`git log --oneline --since="2026-03-10"` on `*.ts`/`*.tsx`) also lists many Gmail OAuth / build-output commits; those are orthogonal to the **IPC refresh mechanism** above.

---

### 1.2 Microsoft Refresh Chain

Tracing **Microsoft 365 (Outlook)** the same way as any API provider: there is **no separate “Microsoft push”** path in the analyzed code—the mail pull goes through `emailGateway.listMessages` inside `syncAccountEmails`, driven by timers when **DB `auto_sync_enabled`** is on for that account.

1. **Sync trigger**

   - **DB-backed auto-sync**: `startAutoSync` in `syncOrchestrator.ts` runs on a `setTimeout` loop. Each tick reads `email_sync_state.auto_sync_enabled`; if not `1`, it skips `syncAccountEmails` but still schedules the next tick.

```793:818:code/apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
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
      // ... remote queue drain ...
      if (onSyncComplete) onSyncComplete(result)
    } catch (err: any) {
      console.error('[SyncOrchestrator] Auto-sync tick error:', err?.message)
      if (onSyncComplete) onSyncComplete(null, err)
    }
    scheduleNext()
  }
```

   - **Loop registration**: `startStoredAutoSyncLoopIfMissing` in `ipc.ts` wires `startAutoSync` so `onSyncComplete` calls `broadcastInboxSnapshotAfterSync`.

```380:397:code/apps/electron-vite-project/electron/main/email/ipc.ts
function startStoredAutoSyncLoopIfMissing(
  db: any,
  accountId: string,
  getDbForRemoteDrain?: () => Promise<any> | any,
): void {
  if (activeAutoSyncLoops.has(accountId)) return
  const row = db
    .prepare('SELECT sync_interval_ms FROM email_sync_state WHERE account_id = ?')
    .get(accountId) as { sync_interval_ms?: number } | undefined
  const intervalMs = row?.sync_interval_ms ?? 300_000
  const loop = startAutoSync(
    db,
    accountId,
    intervalMs,
    (r, e) => broadcastInboxSnapshotAfterSync(r, e),
    getDbForRemoteDrain,
  )
  activeAutoSyncLoops.set(accountId, loop)
}
```

   - **Manual pull**: `inbox:syncAccount` eventually runs `runInboxAccountPullKind` → `syncAccountEmails` (see §1.3 for notification).

   - **On app startup**: If **any** row has `auto_sync_enabled = 1`, every **active** gateway account gets `auto_sync_enabled = 1` and a loop started (this is why “Microsoft already had Auto” can behave differently from a **new** account added later in the same session).

```2680:2703:code/apps/electron-vite-project/electron/main/email/ipc.ts
  /**
   * Resume auto-sync after restart: if **any** account has `auto_sync_enabled = 1`, treat that as global Auto
   * and enable + start loops for **every** gateway account with `status === 'active'`.
   * (Legacy DB rows often only had the primary/Microsoft account flagged; IMAP never got a loop.)
   */
  void (async () => {
    try {
      const db = await resolveDb()
      if (!db) return
      const anyAuto = db.prepare('SELECT 1 FROM email_sync_state WHERE auto_sync_enabled = 1 LIMIT 1').get()
      if (!anyAuto) return

      const list = await emailGateway.listAccounts()
      const activeIds = list.filter((a) => a.status === 'active').map((a) => a.id)

      for (const accountId of activeIds) {
        updateSyncState(db, accountId, { auto_sync_enabled: 1 })
        startStoredAutoSyncLoopIfMissing(db, accountId, resolveDb)
        // ...
      }
    } catch (e) {
      console.warn('[Inbox] Failed to resume auto-sync loops:', (e as Error)?.message)
    }
  })()
```

2. **Message storage**

   - New messages are written to the **SQLite inbox** (`inbox_messages`, etc.) inside `syncAccountEmailsImpl` (`syncOrchestrator.ts`) after `emailGateway.listMessages` / fetch. The same pipeline is used for **gmail / microsoft365 / zoho / imap** (provider chosen via gateway).

```379:386:code/apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
    const accountInfo = await emailGateway.getAccount(accountId)
    if (accountInfo?.provider === 'imap') {
      await maybeRunImapLegacyFolderConsolidation(db, accountId)
    }
    const accountCfg = emailGateway.getAccountConfig(accountId)
```

3. **Change notification**

   - After a successful auto-sync tick, `broadcastInboxSnapshotAfterSync` sends **`inbox:newMessages`** to **every** `BrowserWindow` (`webContents.send`). Payload is either the full `SyncResult` or an invalidate object on failure.

```351:375:code/apps/electron-vite-project/electron/main/email/ipc.ts
function broadcastInboxSnapshotAfterSync(result: SyncResult | null, error?: unknown): void {
  const useInvalidate = error != null || result == null || !result.ok
  const payload: unknown = useInvalidate
    ? {
        inboxInvalidate: true,
        reason:
          error != null
            ? String((error as Error)?.message ?? error)
            : result?.errors?.[0] ?? 'sync_failed',
      }
    : result
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      if (!w.isDestroyed() && w.webContents) w.webContents.send('inbox:newMessages', payload)
    } catch {
      /* ignore */
    }
  })
}
```

   - **Manual** successful pull uses `sendToRenderer` (may target only `mainWindow` when set):

```1432:1437:code/apps/electron-vite-project/electron/main/email/ipc.ts
  const sendToRenderer = (channel: string, data: any) => {
    const wins = mainWindow ? [mainWindow] : BrowserWindow.getAllWindows()
    wins.forEach((w) => {
      if (!w.isDestroyed() && w.webContents) w.webContents.send(channel, data)
    })
  }
```

```2447:2452:code/apps/electron-vite-project/electron/main/email/ipc.ts
    if (result.ok) {
      try {
        sendToRenderer('inbox:newMessages', result)
      } catch (e: any) {
        console.warn('[Inbox] sendToRenderer inbox:newMessages:', e?.message)
      }
    }
```

4. **Renderer reaction**

   - Preload exposes `onNewMessages` as a subscription to **`inbox:newMessages`** (no provider filter).

```695:698:code/apps/electron-vite-project/electron/preload.ts
  onNewMessages: (handler: (data: unknown) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, data: unknown) => handler(data)
    ipcRenderer.on('inbox:newMessages', fn)
    return () => { ipcRenderer.removeListener('inbox:newMessages', fn) }
  },
```

5. **UI update**

   - `EmailInboxView` and `EmailInboxBulkView` subscribe and call **`fetchMessages` / `refreshMessages`** on every event (post-`4c6df42c`, without deferral tied to a “syncing” flag—those lines were removed in that commit).

```1429:1434:code/apps/electron-vite-project/src/components/EmailInboxView.tsx
  useEffect(() => {
    const unsub = window.emailInbox?.onNewMessages?.(() => {
      void fetchMessages()
    })
    return () => unsub?.()
  }, [fetchMessages])
```

```1645:1650:code/apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
  useEffect(() => {
    const unsub = window.emailInbox?.onNewMessages?.(() => {
      void refreshMessages()
    })
    return () => unsub?.()
  }, [refreshMessages])
```

---

### 1.3 Gmail Sync Chain

1. **Sync trigger**

   - **Same as Microsoft** for API mailboxes: **no Gmail-specific timer**—Gmail is onboarded via `connectGmailAccount` → `addAccount`, provider `gmail`.

```1302:1318:code/apps/electron-vite-project/electron/main/email/gateway.ts
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: displayName || 'Gmail Account',
      email: emailFromProfile,
      provider: 'gmail',
      authType: 'oauth2',
      oauth,
      folders: {
        monitored: ['INBOX'],
        inbox: 'INBOX',
        sent: 'SENT'
      },
      sync: newAccountSyncBlock(syncWindowDays),
      status: 'active'
    }
    
    return this.addAccount(account)
```

   - Background sync still depends on **`startAutoSync`** + `auto_sync_enabled = 1` for that Gmail `account_id`, or on **manual** `inbox:syncAccount`.

2. **Message storage**

   - Identical pipeline: `syncAccountEmails` → `emailGateway.listMessages(accountId, …)` → SQLite inbox. Incremental window uses `last_sync_at` from `email_sync_state` for **all** non–pull-more paths (comment mentions Gmail `after:` overlap).

3. **Change notification**

   - **Same IPC channel** as Microsoft when the sync run finishes through paths that call `broadcastInboxSnapshotAfterSync` or `sendToRenderer('inbox:newMessages', …)`. There is **no** separate `gmail:*` IPC for inbox list refresh in this chain.

4. **Renderer reaction**

   - **No Gmail-specific listener** in preload or the cited components—only `inbox:newMessages`.

5. **UI update**

   - **Same components** handle all providers; `activeEmailAccountIdsForSync` only filters by account **status**, not provider.

```311:321:code/apps/electron-vite-project/src/stores/useEmailInboxStore.ts
export function activeEmailAccountIdsForSync(
  accounts: Array<{ id: string; status?: string }>,
): string[] {
  if (!accounts.length) return []
  const active = accounts.filter((a) => a.status === 'active')
  if (active.length) return [...new Set(active.map((a) => a.id))]
  // ...
}
```

---

### 1.4 Gap Analysis

| Step | Microsoft / API mailbox | Gmail | Divergence? |
|------|-------------------------|-------|-------------|
| IPC event name | `inbox:newMessages` | Same | **No** — not a naming split. |
| Renderer | Listens generically | Same | **No** |
| DB auto-sync flag | Loop runs only if `auto_sync_enabled === 1` | Same | **No** |
| After OAuth connect | **`mirrorGlobalAutoSyncToNewAccount` is NOT called** | Same | **Yes — shared gap for OAuth** |

Concrete divergence in **main-process wiring**:

- **IMAP** connect handlers call `mirrorGlobalAutoSyncToNewAccount(account.id)` so that if **any** account already has auto-sync on in SQLite, the **new** IMAP account gets `auto_sync_enabled = 1` and `startStoredAutoSyncLoopIfMissing` immediately.

```897:904:code/apps/electron-vite-project/electron/main/email/ipc.ts
      const account = await emailGateway.connectImapAccount(config)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'imap', email: account.email, accountId: account.id })
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
      return { ok: true, data: account }
```

```721:737:code/apps/electron-vite-project/electron/main/email/ipc.ts
  ipcMain.handle(
    'email:connectGmail',
    async (
      _e,
      displayName?: string,
      syncWindowDays?: number,
      gmailOAuthCredentialSource?: 'builtin_public' | 'developer_saved',
    ) => {
    try {
      const account = await emailGateway.connectGmailAccount(displayName, syncWindowDays, {
        gmailOAuthCredentialSource,
      })
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'gmail', email: account.email, accountId: account.id })
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      return { ok: true, data: account }
```

(Same pattern for `email:connectOutlook` / `email:connectZoho`: cleanup + `accountConnected`, **no** `mirrorGlobalAutoSyncToNewAccount` in the shown region—lines 804–815 and 849–860.)

```404:417:code/apps/electron-vite-project/electron/main/email/ipc.ts
function mirrorGlobalAutoSyncToNewAccount(accountId: string): void {
  void (async () => {
    try {
      if (!inboxDbGetterForEmailIpc) return
      const db =
        typeof inboxDbGetterForEmailIpc === 'function'
          ? await inboxDbGetterForEmailIpc()
          : inboxDbGetterForEmailIpc
      if (!db) return
      const anyAuto = db.prepare('SELECT 1 FROM email_sync_state WHERE auto_sync_enabled = 1 LIMIT 1').get()
      if (!anyAuto) return
      updateSyncState(db, accountId, { auto_sync_enabled: 1 })
      startStoredAutoSyncLoopIfMissing(db, accountId, inboxDbGetterForEmailIpc ?? undefined)
      console.log('[Email IPC] Mirrored global auto-sync to new account:', accountId)
    } catch (e: any) {
      console.warn('[Email IPC] mirrorGlobalAutoSyncToNewAccount:', e?.message)
    }
  })()
}
```

**Additional asymmetry:** **IMAP-only** brute-force polling every **2 minutes** always runs `syncAccountEmails` + `broadcastInboxSnapshotAfterSync`, independent of `auto_sync_enabled`:

```4897:4918:code/apps/electron-vite-project/electron/main/email/ipc.ts
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
            const result = await syncAccountEmails(db, { accountId: acc.id })
            broadcastInboxSnapshotAfterSync(result)
            console.log('[IMAP-AUTO-SYNC] Pull completed for:', acc.id)
          } catch (err) {
            console.error('[IMAP-AUTO-SYNC] Pull failed for:', acc.id, err)
            broadcastInboxSnapshotAfterSync(null, err)
          }
        }
```

**Net effect:** If the user already enabled Auto when only Microsoft had rows set, **new Gmail** may **not** get `auto_sync_enabled` flipped or a loop started until they **toggle Auto again**, **restart** (resume-all block), or run **manual Pull**. IMAP mailboxes can still get UI refresh via the 2-minute interval even when DB auto-sync rows are inconsistent.

**What this issue is not (from code):** Gmail vs Microsoft using different IPC channels or different React listeners—they share the same path once sync completes and broadcasts.

---

### 1.5 Proposed Fix

**Minimal, targeted alignment with IMAP behavior:** After successful OAuth connects, call `mirrorGlobalAutoSyncToNewAccount(account.id)` in the same way as `email:connectImap` / `email:connectCustomMailbox`.

- **Files / locations:** `code/apps/electron-vite-project/electron/main/email/ipc.ts`
  - `email:connectGmail` handler — after `runPostEmailConnectFailedQueueCleanup`, before `return` (~736–737).
  - `email:connectOutlook` handler — same (~814–815).
  - `email:connectZoho` handler — same (~859–860).

This preserves existing semantics: only mirrors when **some** account already has `auto_sync_enabled = 1`, and starts the per-account loop via `startStoredAutoSyncLoopIfMissing`.

Optional hardening (not in “minimal” scope): unify `sendToRenderer` and `broadcastInboxSnapshotAfterSync` so manual pull always targets the same window set as auto-sync (reduces edge cases if `mainWindow` is unset vs multi-window).

---

## Issue 2: IMAP Credential Persistence

### 2.1 Storage Architecture

1. **Initial storage**

   - IMAP + SMTP passwords are supplied at connect time on `EmailAccountConfig.imap` / `.smtp` as plaintext in memory, then persisted via `saveAccounts` → `encryptImapSmtpPasswordsForDisk` (when saving).

```1404:1422:code/apps/electron-vite-project/electron/main/email/gateway.ts
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: config.displayName || config.email,
      email: config.email,
      provider: 'imap',
      authType: 'password',
      imap: {
        host: config.host,
        port: config.port,
        security: imapSecurity,
        username: config.username,
        password: config.password
      },
      smtp: config.smtpHost ? {
        host: config.smtpHost,
        port: config.smtpPort || 587,
        security: smtpSecurityNorm,
        username: config.smtpUsername ?? config.username,
        password: config.smtpPassword ?? config.password
      } : undefined,
```

   - `saveAccounts` writes **`app.getPath('userData')/email-accounts.json`**.

```337:341:code/apps/electron-vite-project/electron/main/email/gateway.ts
function getAccountsPath(): string {
  const userData = app.getPath('userData')
  const accountsPath = path.join(userData, 'email-accounts.json')
  console.log('[EmailGateway] getAccountsPath() =', accountsPath)
  return accountsPath
}
```

```401:425:code/apps/electron-vite-project/electron/main/email/gateway.ts
function saveAccounts(accounts: EmailAccountConfig[]): void {
  try {
    const accountsPath = getAccountsPath()
    // ...
    const encryptedAccounts = accounts.map(account => {
      let next = account
      if (account.oauth) {
        next = {
          ...account,
          oauth: encryptOAuthTokens(account.oauth)
        }
      }
      return encryptImapSmtpPasswordsForDisk(next)
    })
    
    fs.writeFileSync(accountsPath, JSON.stringify({ accounts: encryptedAccounts }, null, 2), 'utf-8')
```

2. **Storage mechanism**

   - **Not `keytar` for email IMAP passwords.** Email encryption uses Electron **`safeStorage`** (`encryptValue` / `decryptValue`). If encryption is unavailable, values fall back to **plaintext** in JSON.

```38:51:code/apps/electron-vite-project/electron/main/email/secure-storage.ts
export function encryptValue(plaintext: string | undefined | null): string {
  const p = plaintext ?? ''
  if (!isSecureStorageAvailable()) {
    console.warn('[SecureStorage] Encryption not available, storing unencrypted')
    return p
  }

  try {
    const encrypted = safeStorage.encryptString(p)
    return encrypted.toString('base64')
  } catch (err) {
    console.error('[SecureStorage] Encryption failed:', err)
    return p
  }
}
```

```74:97:code/apps/electron-vite-project/electron/main/email/secure-storage.ts
export function decryptValue(encrypted: string | undefined | null): string {
  if (encrypted == null || encrypted === '') {
    return ''
  }
  if (!isSecureStorageAvailable()) {
    // If encryption wasn't available during save, data is unencrypted
    return encrypted
  }
  // ... legacy heuristic ...
  try {
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (err) {
    console.log('[SecureStorage] Decryption failed, treating as legacy unencrypted data')
    return encrypted
  }
}
```

   - **`keytar`** appears elsewhere (e.g. app auth refresh token in `src/auth/tokenStore.ts`), not in the IMAP gateway path.

3. **Credential retrieval**

   - On startup / load: `loadAccounts` → `decryptImapSmtpPasswords` for each **imap** row.

```347:387:code/apps/electron-vite-project/electron/main/email/gateway.ts
function loadAccounts(): EmailAccountConfig[] {
  try {
    const accountsPath = getAccountsPath()
    // ...
    if (fs.existsSync(accountsPath)) {
      const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      const accounts = data.accounts || []
      // Decrypt OAuth tokens and IMAP/SMTP passwords for each account
      return accounts.map((account: EmailAccountConfig) => {
        let next: EmailAccountConfig = account
        if (account.oauth) {
          try {
            const decrypted = decryptOAuthTokens(account.oauth as any)
            // ...
            next = { ...next, oauth }
          } catch (err) {
            console.error('[EmailGateway] Failed to decrypt tokens for account:', account.id, err)
            next = {
              ...account,
              oauth: undefined,
              status: 'error' as const,
              lastError: 'Failed to decrypt stored credentials. Please reconnect.'
            }
          }
        }
        return decryptImapSmtpPasswords(next)
      })
```

4. **Credential format (schema)**

```321:340:code/apps/electron-vite-project/electron/main/email/types.ts
  imap?: {
    host: string
    port: number
    security: SecurityMode
    username: string
    password: string  // Encrypted at rest when `_encrypted` is true
    /** When true, `password` was stored with OS secure storage (see gateway save/load). */
    _encrypted?: boolean
  }
  
  /** SMTP settings for sending (optional) */
  smtp?: {
    host: string
    port: number
    security: SecurityMode
    username: string
    password: string  // Encrypted at rest when `_encrypted` is true
    _encrypted?: boolean
  }
```

---

### 2.2 Credential Lifecycle

1. **TTL / expiry on stored passwords**

   - No timed deletion of IMAP passwords was found in the searched email main-process code. OAuth **access** tokens have `expiresAt` (Gmail provider refreshes), but that is separate from IMAP password fields.

2. **Migrations touching sync flags (not passwords)**

   - Schema migrations `v39`/`v40` **reset `auto_sync_enabled` to 0** for all rows — this affects **sync loops**, not `email-accounts.json`.

```785:797:code/apps/electron-vite-project/electron/main/handshake/db.ts
  {
    version: 39,
    description:
      'Schema v39: Reset forced auto-sync — clear auto_sync_enabled previously turned on by onAccountConnected (user opts in via Inbox)',
    sql: [
      `UPDATE email_sync_state SET auto_sync_enabled = 0 WHERE auto_sync_enabled = 1`,
    ],
  },
  {
    version: 40,
    description:
      'Schema v40: Auto-sync off by default — one-time reset of all email_sync_state rows (user opts in per account)',
    sql: [`UPDATE email_sync_state SET auto_sync_enabled = 0`],
  },
```

3. **Decrypt failures → account unusable, not silent “still works”**

   - If decryption yields **empty** plaintext while ciphertext was non-empty, the account is marked **`error`** with a reconnect message.

```136:152:code/apps/electron-vite-project/electron/main/email/gateway.ts
      const plain = decryptValue(rawImap)
      const rawLen = String(rawImap ?? '').trim().length
      if (rawLen > 0 && plain.length === 0) {
        console.error('[EmailGateway] IMAP decrypt produced empty plaintext (suspected decrypt failure)', {
          accountId: account.id,
          email: account.email,
          imapEncryptedFlag: next.imap._encrypted,
          rawLength: rawLen,
        })
        return {
          ...next,
          status: 'error',
          lastError: 'Failed to decrypt stored IMAP credentials. Please remove the account and connect again.',
        }
      }
```

4. **Persistence across restart**

   - Credentials are **on disk** in `email-accounts.json`, not memory-only, assuming `saveAccounts` succeeds.

---

### 2.3 Error Handling

1. **IMAP auth failures (gateway `testConnection`)**

   - Maps likely auth errors to **`auth_error`** and persists via `saveAccounts`.

```599:610:code/apps/electron-vite-project/electron/main/email/gateway.ts
      if (result.success) {
        account.status = 'active'
        account.lastError = undefined
      } else {
        const authFail =
          account.provider === 'imap' && result.error && isLikelyEmailAuthError(result.error)
        account.status = authFail ? 'auth_error' : 'error'
        account.lastError = authFail
          ? 'Authentication failed — check credentials'
          : result.error
      }
      account.updatedAt = Date.now()
      saveAccounts(this.accounts)
```

2. **Sync path (`syncAccountEmails`)**

   - On auth-like errors, **IMAP** → `auth_error`; other providers → `error` with “Reconnect” style messaging. **`updateAccount` is invoked** (does not delete the row).

```734:760:code/apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
    if (isLikelyEmailAuthError(errMsg)) {
      try {
        const accountCfg = emailGateway.getAccountConfig(accountId)
        const isImap = accountCfg?.provider === 'imap'
        await emailGateway.updateAccount(accountId, {
          status: isImap ? 'auth_error' : 'error',
          lastError: isImap
            ? 'Authentication failed — check credentials'
            : 'Not authenticated or session expired. Reconnect this account in Email settings.',
        })
      } catch (persistErr: any) {
        console.warn('[SyncOrchestrator] Could not persist account auth state:', persistErr?.message)
      }
    }
  }

  const anyAuthErr = result.errors.some((e) => isLikelyEmailAuthError(e))
  if (anyAuthErr) {
    try {
      const accountCfg = emailGateway.getAccountConfig(accountId)
      const isImap = accountCfg?.provider === 'imap'
      await emailGateway.updateAccount(accountId, {
        status: isImap ? 'auth_error' : 'error',
        lastError: isImap
          ? 'Authentication failed — check credentials'
          : 'Not authenticated or session expired. Reconnect this account in Email settings.',
      })
```

3. **Retries / auto-disconnect**

   - **No** loop counter that deletes credentials after N failures was identified in these paths; status flips to **`auth_error` / `error`** and `saveAccounts` persists the account with the **same** password fields unless something else overwrites them.

4. **UI surfacing**

   - Account **`status`** and **`lastError`** are part of `EmailAccountConfig` / `EmailAccountInfo` and sync store filters—exact UI copy depends on components not fully traced here. The main process **does** persist error states visibly distinguishable from `active`.

---

### 2.4 Failure Scenarios

| Scenario | Vulnerable? | Evidence |
|----------|-------------|----------|
| App restart + in-memory-only storage | **No** for normal path | `saveAccounts` writes JSON to `userData` |
| `safeStorage` unavailable at save → plaintext on disk | **Yes** | `encryptValue` returns plaintext with a warning |
| `safeStorage` decrypt fails / returns wrong legacy interpretation | **Partially** | `decryptValue` catch returns original string; separate IMAP path treats **empty** plaintext after non-empty ciphertext as hard failure |
| Migration drops credential columns | **Not for IMAP JSON** | IMAP creds live in `email-accounts.json`; DB migrations shown target `email_sync_state` / inbox tables |
| Error handler **clears** password on auth failure | **Not in cited paths** | `updateAccount` merges nested imap/smtp; sync sets **status**, not empty password |
| OAuth token expiry for IMAP OAuth | **N/A for classic IMAP password auth** | This product’s IMAP path uses `authType: 'password'` |
| `updateAccount` drops password on partial `{ imap: { host } }` patch | **Mitigated in code** | Explicit merge with comment |

```505:532:code/apps/electron-vite-project/electron/main/email/gateway.ts
  async updateAccount(id: string, updates: Partial<EmailAccountConfig>): Promise<EmailAccountInfo> {
    const index = this.accounts.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error('Account not found')
    }

    const prev = this.accounts[index]
    /** Pull nested creds out so we can merge — a bare `{ ...prev, ...updates }` replaces entire `imap`/`smtp`
     * and drops `password` whenever `updates.imap` omits it (partial spread from refactors / IPC). */
    const { imap: patchImap, smtp: patchSmtp, ...restUpdates } = updates
    const merged: EmailAccountConfig = {
      ...prev,
      ...restUpdates,
      id,
      updatedAt: Date.now(),
    }
    if (patchImap !== undefined) {
      merged.imap = prev.imap
        ? mergeImapSmtpCredentials(prev.imap as Record<string, unknown>, patchImap as Partial<Record<string, unknown>>) as
            NonNullable<EmailAccountConfig['imap']>
        : (patchImap as NonNullable<EmailAccountConfig['imap']>)
    }
```

   - **Empty password persisted**: `encryptImapSmtpPasswordsForDisk` logs an error if password empty before encrypt — risk if something strips password then saves.

```270:274:code/apps/electron-vite-project/electron/main/email/gateway.ts
    const imapPlain = String(account.imap.password ?? '')
    if (imapPlain.length === 0) {
      console.error('[Gateway] encryptImapSmtpPasswordsForDisk: IMAP password is empty for account', account.id)
    }
```

   - **Runtime connect** refuses sealed / missing passwords:

```117:130:code/apps/electron-vite-project/electron/main/email/gateway.ts
function assertImapCredentialsUsableForConnect(account: EmailAccountConfig): void {
  if (account.provider !== 'imap') return
  if (!account.imap) {
    throw new Error('IMAP password is missing — account may need to be reconnected.')
  }
  if (isImapSmtpPasswordStillSealedForDisk(account.imap)) {
    throw new Error(
      'Stored IMAP credentials could not be decrypted. Remove the account and connect again, or update credentials.',
    )
  }
  const pw = account.imap.password
  if (pw == null || String(pw).trim().length === 0) {
    throw new Error('IMAP password is missing — account may need to be reconnected.')
  }
}
```

**Cannot determine from code alone:** intermittent OS DPAPI/keychain issues on Windows after long idle, corporate policy resets, or dual-boot profile changes—would manifest similarly to decrypt failures or `safeStorage` unavailability.

---

### 2.5 Proposed Fix

1. **Observability:** Surface `lastError` / `status === 'auth_error'` prominently in inbox account UI and offer **Update credentials** (`updateImapCredentials` IPC already exists at `ipc.ts` ~596+ with gateway `updateImapCredentials`).

2. **Persist safety:** Consider refusing `saveAccounts` when `provider === 'imap'` and IMAP password is empty / sealed for disk (guard against silent bad snapshots after bugs).

3. **Encryption robustness:** When `encryptValue` falls back to plaintext, log a persistent user-visible warning once; optionally block IMAP connect in packaged builds if `!isSecureStorageAvailable()` (policy decision).

4. **Post-failure behavior:** After repeated `auth_error`, optionally prompt for re-entry instead of only logging—logic would go in renderer + existing `email:updateImapCredentials` / reconnect flows.

Exact touchpoints already identified: `gateway.ts` (`saveAccounts`, `encryptImapSmtpPasswordsForDisk`, `decryptImapSmtpPasswords`, `updateAccount`), `secure-storage.ts`, `syncOrchestrator.ts` (status updates), `ipc.ts` (IMAP reconnect handlers).

---

## Appendix: Command transcripts (representative)

```text
git show --stat --oneline ad322ca2
ad322ca2 build1115: inbox sync UI refresh ...
 code/apps/electron-vite-project/electron/main/email/ipc.ts | 28 ++++-
 code/apps/electron-vite-project/electron/main/email/syncOrchestrator.ts | 8 +-
 .../src/components/EmailInboxBulkView.tsx | 12 +-
 .../src/components/EmailInboxView.tsx | 12 +-
 .../src/stores/useEmailInboxStore.ts | 9 +++

git show --stat --oneline 4c6df42c
4c6df42c build2225: inbox refresh on new messages ...
 .../src/components/EmailInboxBulkView.tsx | 11 ---
 .../src/components/EmailInboxView.tsx | 11 ---
```

Paths in git output are relative to the `code/` subdirectory inside the monorepo; local workspace files cited in snippets use `code/apps/...` for clarity.
