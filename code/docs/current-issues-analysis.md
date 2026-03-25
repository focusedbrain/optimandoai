# Current Issues — Code & Architecture Analysis

This document is a **read-only** trace of the codebase as of the analysis date. Paths are relative to the repository tree under `code/` (e.g. `apps/electron-vite-project/...`). Line numbers refer to the current files in the workspace.

---

## Issue 1: Gmail Sync Pipeline

### 1.1 Sync entry point

**Auto-sync tick**

- `syncAccountEmails` is the public entry point. It serializes per `accountId`, wraps the inner implementation in a **300s** outer `Promise.race`, and returns that promise.

```350:397:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
export async function syncAccountEmails(db: any, options: SyncAccountOptions): Promise<SyncResult> {
  const accountId = options.accountId
  // ...
  const current = prev.then(
    () => syncAccountEmailsImpl(db, options),
    () => syncAccountEmailsImpl(db, options), // also run if previous REJECTED
  )

  const withTimeout = Promise.race([
    current,
    new Promise<SyncResult>((_, reject) =>
      setTimeout(() => {
        // ...
        reject(
          new Error(
            `syncAccountEmails timed out after ${Math.round(SYNC_ACCOUNT_EMAILS_MAX_MS / 1000)}s${inFlight}`,
          ),
        )
      }, SYNC_ACCOUNT_EMAILS_MAX_MS),
    ),
  ])
  // ...
  return withTimeout
}
```

- The DB-driven auto-sync loop calls `syncAccountEmails` on each tick when `auto_sync_enabled === 1`:

```981:1016:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
  const tick = async () => {
    try {
      console.log('[AUTO_SYNC] Tick fired for account:', accountId)
      const row = db.prepare('SELECT auto_sync_enabled FROM email_sync_state WHERE account_id = ?').get(accountId) as { auto_sync_enabled?: number } | undefined
      if (row?.auto_sync_enabled !== 1) {
        scheduleNext()
        return
      }

      const accCfg = emailGateway.getAccountConfig(accountId)
      if (accCfg?.processingPaused === true) {
        scheduleNext()
        return
      }

      const result = await syncAccountEmails(db, { accountId })
      // ... post-sync drain ...
      if (onSyncComplete) onSyncComplete(result)
    } catch (err: any) {
      console.error('[SyncOrchestrator] Auto-sync tick error:', err?.message)
      if (onSyncComplete) onSyncComplete(null, err)
    }
    scheduleNext()
  }
```

- That callback is wired in IPC to `broadcastInboxSnapshotAfterSync`:

```419:436:apps/electron-vite-project/electron/main/email/ipc.ts
function startStoredAutoSyncLoopIfMissing(
  db: any,
  accountId: string,
  getDbForRemoteDrain?: () => Promise<any> | any,
): void {
  if (activeAutoSyncLoops.has(accountId)) return
  // ...
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

**What runs for a Gmail `accountId` inside `syncAccountEmailsImpl`**

- The orchestrator loads config via `emailGateway.getAccountConfig(accountId)` and uses `accountCfg?.provider` for IMAP-only folder expansion and telemetry. For listing, it always calls `emailGateway.listMessages(accountId, { ...listOptions, folder })`.

```681:706:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
        const folder = pullFolders[0] || accountCfg?.folders?.inbox || accountInfo?.folders?.inbox || 'INBOX'
        // ...
        const listPromise = emailGateway.listMessages(accountId, { ...listOptions, folder })
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `listMessages timed out after ${IMAP_SYNC_LIST_MESSAGES_MS / 1000}s (phase=list_messages folder=${JSON.stringify(folder)})`,
                ),
              ),
            IMAP_SYNC_LIST_MESSAGES_MS,
          ),
        )
        messages = await Promise.race([listPromise, timeoutPromise])
```

**How the code selects Gmail vs other providers**

- `listMessages` branches on `account.provider`: **IMAP** uses an ephemeral provider session; **all other** providers (including Gmail) use `getConnectedProvider` and then `fetchMessages`.

```832:869:apps/electron-vite-project/electron/main/email/gateway.ts
  async listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]> {
    const account = this.findAccount(accountId)
    const effectiveFolders = getFoldersForAccountOperation(account, options?.mailboxId)
    const folder = options?.folder ?? effectiveFolders.inbox

    if (account.provider === 'imap') {
      // ... ephemeral ImapProvider connect + fetchMessages ...
    }

    // OAuth providers: use cached provider (stable, token-refreshing)
    const provider = await this.getConnectedProvider(account)
    const rawMessages = await provider.fetchMessages(folder, options)
    return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
  }
```

- `getProvider` instantiates `GmailProvider` when `account.provider === 'gmail'`.

```1825:1837:apps/electron-vite-project/electron/main/email/gateway.ts
  private async getProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    switch (account.provider) {
      case 'gmail':
        return new GmailProvider()
      case 'microsoft365':
        return new OutlookProvider()
      // ...
      default:
        throw new Error(`Unknown provider: ${account.provider}`)
    }
  }
```

**Actual Gmail message list HTTP call**

- `GmailProvider.fetchMessages` calls `apiRequest('GET', `/users/me/messages?${listParams.toString()}')` (Gmail API **messages.list**). The full URL path is built in `apiRequest` as `/gmail/v1` + endpoint (see §1.2).

```355:383:apps/electron-vite-project/electron/main/email/providers/gmail.ts
        const listParams = new URLSearchParams({
          maxResults: Math.min(listPageSize, remainingSlots).toString(),
          ...(query ? { q: query } : {}),
          ...(pageToken ? { pageToken } : {}),
        })

        const listResponse = await this.apiRequest('GET', `/users/me/messages?${listParams.toString()}`)
```

**Folder string for Gmail**

- Non-IMAP accounts resolve a single folder label from config (default `INBOX`):

```17:20:apps/electron-vite-project/electron/main/email/domain/imapPullFolders.ts
export function resolveImapPullFolders(account: EmailAccountConfig): string[] {
  if (account.provider !== 'imap') {
    return [account.folders?.inbox?.trim() || 'INBOX']
  }
```

That value is passed into `fetchMessages`, which adds `in:${folder}` to the Gmail search query when `folder` is set.

```297:300:apps/electron-vite-project/electron/main/email/providers/gmail.ts
    if (folder) {
      queryParts.push(`in:${folder}`)
    }
```

### 1.2 Gmail API call details

**Host and path**

- Requests use `https.request` to hostname `gmail.googleapis.com`, path `/gmail/v1` + `endpoint`, with `Authorization: Bearer ${this.accessToken}`.

```1225:1238:apps/electron-vite-project/electron/main/email/providers/gmail.ts
  private async apiRequest(method: string, endpoint: string, body?: any): Promise<any> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken()
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'gmail.googleapis.com',
        path: `/gmail/v1${endpoint}`,
        method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        }
      }
```

So a list call uses endpoint `/users/me/messages?...` → full path **`/gmail/v1/users/me/messages?...`** (REST resource is **`users.messages.list`**; there is no separate `/users/me/messages/list` path segment).

**Headers**

- As above: **`Authorization: Bearer …`** is set on every Gmail API request. Optional **`Content-Type: application/json`** only when `body` is passed.

**Scopes (requested vs stored)**

- The provider defines required scopes:

```135:139:apps/electron-vite-project/electron/main/email/providers/gmail.ts
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
]
```

- The granted scopes on the token are whatever Google returns at token exchange (`json.scope` stored in the OAuth connect flow around the token handling — see the same file near the `scope:` field in the token response handling). **This analysis does not compare a live token’s `scope` string to `GMAIL_SCOPES` in code**; that would require runtime inspection of the connected account’s stored OAuth payload.

**Access token before the call**

- `connect` assigns tokens from config and refreshes if expired (5-minute skew):

```190:203:apps/electron-vite-project/electron/main/email/providers/gmail.ts
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.oauth) {
      throw new Error('Gmail requires OAuth authentication')
    }

    this.config = config
    this.accessToken = config.oauth.accessToken
    this.refreshToken = config.oauth.refreshToken
    this.tokenExpiresAt = config.oauth.expiresAt

    // Refresh token if expired
    if (this.isTokenExpired()) {
      await this.refreshAccessToken()
    }

    this.connected = true
  }
```

- `apiRequest` again calls `refreshAccessToken()` if `isTokenExpired()` is true immediately before building the request.

### 1.3 Token refresh path

**Expiry detection**

```1096:1098:apps/electron-vite-project/electron/main/email/providers/gmail.ts
  private isTokenExpired(): boolean {
    return Date.now() > this.tokenExpiresAt - 300000 // 5 min buffer
  }
```

**Refresh implementation**

- POST to **`https://oauth2.googleapis.com/token`** with `application/x-www-form-urlencoded` body: `client_id`, `refresh_token`, `grant_type=refresh_token`, and **optionally** `client_secret`.

```1100:1145:apps/electron-vite-project/electron/main/email/providers/gmail.ts
  private async refreshAccessToken(): Promise<void> {
    const stored = this.config?.oauth
    const userCreds = await getCredentialsForOAuth('gmail')
    if (!this.refreshToken) {
      throw new Error('Cannot refresh token: missing credentials')
    }

    const clientId =
      stored?.oauthClientId && stored.oauthClientId.trim()
        ? stored.oauthClientId.trim()
        : userCreds && 'clientId' in userCreds
          ? userCreds.clientId
          : null
    if (!clientId) {
      throw new Error('Cannot refresh token: missing OAuth client id')
    }

    const legacyVaultSecret = stored?.gmailRefreshUsesSecret === true
    const secretFromVault =
      legacyVaultSecret && userCreds && 'clientSecret' in userCreds && userCreds.clientSecret
        ? String(userCreds.clientSecret).trim()
        : ''
    const secretFromAccount = stored?.gmailOAuthClientSecret?.trim() ?? ''
    const refreshClientSecret = secretFromVault || secretFromAccount || undefined

    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        client_id: clientId,
        refresh_token: this.refreshToken!,
        grant_type: 'refresh_token',
      })
      if (refreshClientSecret) {
        body.set('client_secret', refreshClientSecret)
      }

      const postData = body.toString()

      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }
```

**PKCE / initial exchange vs refresh**

- The **refresh** path explicitly supports `client_secret` when present on the account (`gmailOAuthClientSecret`) or legacy vault (`gmailRefreshUsesSecret` + `userCreds.clientSecret`). So the recent “add `client_secret` to PKCE” work is **not** limited to the initial exchange in principle: **refresh uses the same optional secret logic**.

**Availability of `client_secret` on the account**

- After decrypt, the gateway maps `gmailOAuthClientSecret` from secure storage into the in-memory account row:

```364:374:apps/electron-vite-project/electron/main/email/gateway.ts
            const oauth: NonNullable<EmailAccountConfig['oauth']> = {
              accessToken: decrypted.accessToken,
              refreshToken: decrypted.refreshToken,
              expiresAt: decrypted.expiresAt,
              scope: decrypted.scope ?? '',
              oauthClientId: decrypted.oauthClientId,
              gmailRefreshUsesSecret: decrypted.gmailRefreshUsesSecret,
              ...(decrypted.gmailOAuthClientSecret
                ? { gmailOAuthClientSecret: decrypted.gmailOAuthClientSecret }
                : {}),
            }
```

Whether a **specific** Gmail account row actually has `gmailOAuthClientSecret` populated depends on connect-time persistence (not fully traced here without the connect path’s write site). If it is missing and Google expects a confidential client on refresh, refresh fails with a Google error surfaced in `refreshAccessToken`’s `json.error` handling.

### 1.4 Error handling — silent failures

**Gmail-specific catches in `gmail.ts`**

- `grep` for `catch` in `gmail.ts` yields handlers at lines **157, 172, 261, 423, 452, 542, 567, 642, 718, 769, 774, 1041, 1192, 1289** (file: `apps/electron-vite-project/electron/main/email/providers/gmail.ts`). Notable behaviors:
  - `fetchMessage` **logs and returns `null`** instead of throwing:

```415:426:apps/electron-vite-project/electron/main/email/providers/gmail.ts
  async fetchMessage(messageId: string): Promise<RawEmailMessage | null> {
    try {
      const response = await this.apiRequest(
        'GET',
        `/users/me/messages/${messageId}?format=full`
      )

      return this.parseGmailMessage(response)
    } catch (err) {
      console.error('[Gmail] Error fetching message:', messageId, err)
      return null
    }
  }
```

  - For sync, `GmailProvider.fetchMessages` uses `Promise.allSettled` on batch fetches, so **failed individual message fetches are dropped** without failing the whole list (only fulfilled non-null results are pushed). That can yield **fewer messages than IDs** without throwing at the provider level.

**Orchestrator**

- Uncaught errors in `syncAccountEmailsImpl` set `result.ok = false`, append to `result.errors`, and update `email_sync_state.last_error`:

```891:911:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
  } catch (err: any) {
    result.ok = false
    const errMsg = err?.message ?? 'Sync failed'
    result.errors.push(errMsg)
    // ...
    console.error('[SyncOrchestrator] syncAccountEmails error:', err)
    updateSyncState(db, accountId, {
      last_error: errMsg,
      last_error_at: new Date().toISOString(),
    })
```

- A **successful** sync with **zero** listed and **zero** new messages does **not** set `ok: false` by itself; debug logging notes “silent empty” at the IPC layer for manual pull (see below).

**`syncAccountEmails` return vs throw**

- The outer `syncAccountEmails` **only rejects** on the **300s** timeout race. Inner implementation errors are caught and returned as `SyncResult` with `ok: false` (see catch above), not thrown.

**`broadcastInboxSnapshotAfterSync`**

```357:375:apps/electron-vite-project/electron/main/email/ipc.ts
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

- On failure or timeout, the renderer receives **`{ inboxInvalidate: true, reason }`**, not the full `SyncResult`.

**Why the UI may show no error (true “silence”)**

1. **`result.ok === true`** with **0 new messages** and **0 errors** — e.g. empty list from provider, or all duplicates. IPC pull logs this as a “silent empty” hint:

```2514:2518:apps/electron-vite-project/electron/main/email/ipc.ts
    if (result.newMessages === 0 && warnCount === 0 && result.ok) {
      emailDebugLog(
        '[SYNC-DEBUG] IPC pull finished ok with 0 new messages and 0 warnings (silent empty — see main logs for SEARCH/folder/last_sync_at)',
        { accountId, kind, pullStats },
      )
    }
```

2. **Background auto-sync** does not go through `inbox:syncAccount`’s return object; it only sends `inbox:newMessages`. The app-level subscriber **ignores the payload** and only debounces `refreshMessages()`:

```25:27:apps/electron-vite-project/src/utils/inboxNewMessagesBackgroundRefresh.ts
  const unsub = onNewMessages(() => {
    scheduleRefresh()
  })
```

So `inboxInvalidate` **`reason` is never applied to `lastSyncWarnings`** in the Zustand store from this path. **`SyncFailureBanner`** is fed from **`lastSyncWarnings`**, which is set on **manual** `syncAccount` / `syncAllAccounts` responses, not from `inbox:newMessages` invalidate reasons.

```1271:1281:apps/electron-vite-project/src/stores/useEmailInboxStore.ts
      if (!res.ok) {
        const failWarnings = res.syncWarnings?.length
          ? res.syncWarnings.map((w: string) => `[${accountId}] ${w}`)
          : [`[${accountId}] ${res.error ?? 'Sync failed'}`]
        set({
          syncing: false,
          // ...
          lastSyncWarnings: failWarnings,
        })
        return
      }
```

3. **Manual pull** does return `syncWarnings` when `!result.ok`:

```2491:2500:apps/electron-vite-project/electron/main/email/ipc.ts
    if (!result.ok) {
      return {
        ok: false,
        error: errors[0] ?? 'Sync failed',
        data: result,
        pullStats,
        pullHint,
        warningCount: warnCount,
        syncWarnings: errors,
      }
    }
```

**Summary:** Gmail API failures that throw out of `listMessages` / `connect` become `result.ok: false` and surface on **manual** sync. **Auto-sync** failures may **only** invalidate + refresh the list; the **banner may stay empty** unless the user runs a manual pull or unified sync that sets `lastSyncWarnings`.

### 1.5 Recent breakage (git history)

From repository root `code_clean`, `git log --oneline --since="2026-03-24" -- "**/gmail.ts" "**/gmail*.ts" "**/providers/gmail*"` returned (newest first):

- `e8dd4a02` chore(release): build0015 output; Gmail OAuth cleanup  
- `625b653a` feat(email): surface Gmail OAuth errors in connect UI; release output build005  
- `71bd9c21` chore(build): build143 output dirs; Gmail OAuth debug logging  
- `9c53a8a0` build2334: extension outDir build2334; Git-ignore OAuth secret, warn on missing  
- `6b0782fd` build554: Gmail Desktop PKCE client_secret, extension outDir build554, merge main  
- `88a46775` fix(email): OAuth callback race (beginOAuthFlow), Gmail diagnostics, build124 outputs  
- …(additional Gmail OAuth / build commits)  

**Interpretation:** Recent churn is concentrated on **Gmail OAuth** (PKCE, `client_secret`, diagnostics, connect UI). This analysis does not prove a specific regression without bisecting behavior; the commits are **candidates** for accidental interaction with token persistence, refresh, or connect vs sync paths.

### 1.6 Comparison with Microsoft 365 path

| Stage | Gmail | Microsoft 365 (`microsoft365`) |
|--------|--------|----------------------------------|
| Orchestrator | Same `syncAccountEmails` → `emailGateway.listMessages` | Same |
| Gateway branch | Not IMAP → `getConnectedProvider` → `GmailProvider.fetchMessages` | Not IMAP → `OutlookProvider.fetchMessages` |
| HTTP API | Gmail REST `gmail.googleapis.com/gmail/v1/...` via `apiRequest` | Microsoft Graph via `graphApiRequest` (separate implementation in `outlook.ts`) |
| List + fetch | `messages.list` + concurrent `messages.get` batches in provider | `fetchMessages` / `fetchAllMessagesTwoPhase` listing Graph then batch detail fetch |
| IMAP-only stages | **Skipped** (`resolveImapPullFoldersExpanded` only when `accountCfg?.provider === 'imap'`) | **Skipped** |

**Divergence:** IMAP path opens ephemeral connections and times **`listMessages`** with `IMAP_SYNC_LIST_MESSAGES_MS` (45s). Gmail uses the **cached** OAuth provider path—**no** per-folder expand, and **no** orchestrator `Promise.race` around `listMessages` for Gmail specifically (the 45s race still wraps `emailGateway.listMessages` for **all** providers in the single-folder branch). Gmail-specific failure modes include OAuth refresh, label query (`in:`), and per-message fetch swallowing (`null` / `allSettled`).

---

## Issue 2: IMAP Sync Pipeline

### 2.1 Sync timeout

**Outer sync cap (all providers)**

```297:302:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
/**
 * Hard cap for one full sync run (folder resolve + list + per-message fetch).
 * Must exceed inner races (e.g. 30s folder expand + 30s list) and allow slow IMAP bootstrap (web.de, large mailboxes).
 * A 45s cap caused false "timed out" failures while the server was still working.
 */
const SYNC_ACCOUNT_EMAILS_MAX_MS = 300_000
```

**Per-phase IMAP timeouts** (`imapSyncTelemetry.ts`):

```6:21:apps/electron-vite-project/electron/main/email/imapSyncTelemetry.ts
/** LIST/STATUS-driven folder expansion before pull (ephemeral IMAP session). */
export const IMAP_SYNC_FOLDER_EXPAND_MS = 45_000

/**
 * Orchestrator `Promise.race` around `emailGateway.listMessages` per folder.
 * Bumped from 30s: slow servers often exceed 30s on SEARCH + UID FETCH chunks without being dead.
 */
export const IMAP_SYNC_LIST_MESSAGES_MS = 45_000

/**
 * `ImapProvider.fetchMessages` (openBox + seq fetch headers) — must not exceed list race budget unnecessarily.
 */
export const IMAP_PROVIDER_FETCH_MESSAGES_MS = 45_000

/** Standalone reliable fetch path (fresh connection). */
export const IMAP_FETCH_RELIABLE_MS = 45_000
```

**What times out**

- **Folder expand:** `resolveImapPullFoldersExpanded` vs 45s race.  
- **List:** `emailGateway.listMessages` (which for IMAP does `connect` + `provider.fetchMessages`) vs **45s** `Promise.race` per folder.  
- **Entire sync:** outer **300s** on `syncAccountEmails`.  
- **Gateway connect:** separate **25s** handshake race for some connection paths in `gateway.ts` (e.g. `CONNECT_TIMEOUT_MS = 25_000` around line 976).

So timeouts can be **list/fetch**, **folder expand**, **handshake**, or **whole-run** depending on where the stall occurs.

### 2.2 Connection attempt

**Library**

- The IMAP provider is `ImapProvider` in `providers/imap.ts`; it imports the **`imap`** npm package (`import * as ImapMod from 'imap'`).

```8:10:apps/electron-vite-project/electron/main/email/providers/imap.ts
import * as ImapMod from 'imap'
import * as nodemailer from 'nodemailer'
import type ImapApi from 'imap'
```

**Gateway list path**

- For `account.provider === 'imap'`, `listMessages` creates a provider via `getProvider`, **`connect(account)`**, `fetchMessages`, **`disconnect`** in `finally`.

```837:863:apps/electron-vite-project/electron/main/email/gateway.ts
    if (account.provider === 'imap') {
      // ...
      const provider = await this.getProvider(account)
      const listStarted = Date.now()
      try {
        await provider.connect(account)
        const rawMessages = await provider.fetchMessages(folder, options)
        // ...
        return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
      } finally {
        try {
          await provider.disconnect()
        } catch {
          /* noop */
        }
      }
    }
```

**Credentials**

- Loaded from `email-accounts.json` under `app.getPath('userData')`, with IMAP passwords decrypted when `_encrypted` indicates disk encryption:

```337:341:apps/electron-vite-project/electron/main/email/gateway.ts
function getAccountsPath(): string {
  const userData = app.getPath('userData')
  const accountsPath = path.join(userData, 'email-accounts.json')
  console.log('[EmailGateway] getAccountsPath() =', accountsPath)
  return accountsPath
}
```

```117:131:apps/electron-vite-project/electron/main/email/gateway.ts
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

### 2.3 Credential state

**Cannot be asserted from this workspace**

- `email-accounts.json` lives in the user’s **Electron `userData`** directory, not in the repo. This analysis **did not read** that file on disk.

**What the code expects**

- After `loadAccounts`, IMAP accounts should have decryptable passwords unless `decryptValue` produced empty plaintext (then status is forced to error with a lastError message). See `decryptImapSmtpPasswords` in `gateway.ts` (continues after line 141 in the same function).

**`safeStorage` availability**

- `isSecureStorageAvailable()` wraps `safeStorage.isEncryptionAvailable()`:

```23:34:apps/electron-vite-project/electron/main/email/secure-storage.ts
export function isSecureStorageAvailable(): boolean {
  if (encryptionAvailable === null) {
    try {
      encryptionAvailable = safeStorage.isEncryptionAvailable()
      console.log('[SecureStorage] isSecureStorageAvailable() =>', encryptionAvailable)
    } catch (err) {
      console.error('[SecureStorage] Error checking encryption availability:', err)
      encryptionAvailable = false
      console.log('[SecureStorage] isSecureStorageAvailable() =>', false)
    }
  }
  return encryptionAvailable ?? false
}
```

Whether it is **true** on the user’s machine requires runtime logs or a live session.

### 2.4 “Live sync timed out” message

**Source**

```118:123:apps/electron-vite-project/src/components/SyncFailureBanner.tsx
            ) : r.kind === 'timeout' ? (
              <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                <strong>{r.email}</strong>: Live sync timed out. Messages you see may be from this device only until sync
                completes. Try again in a moment or reduce the sync window in settings.
              </div>
```

**Classification**

- `classifySyncFailureMessage` returns `'timeout'` when the message matches:

```24:28:apps/electron-vite-project/src/utils/syncFailureUi.ts
export function classifySyncFailureMessage(message: string): SyncFailureKind {
  const raw = message || ''
  if (isAuthSyncFailureMessage(raw)) return 'auth'
  const m = raw.toLowerCase()
  if (/timed out|timeout|etimedout|deadline exceeded|syncaccountemails timed out/i.test(m)) return 'timeout'
```

So the banner text is shown for **sync warning lines** that look like timeouts (including `syncAccountEmails timed out after 300s` and `listMessages timed out after 45s`), not exclusively for one specific timer.

**How warnings reach the banner**

- `lastSyncWarnings` from **`syncAccount` / `syncAllAccounts`** IPC responses (see §1.4). Bracketed account id + message format is parsed in `parseBracketedAccountSyncMessage`.

### 2.5 Recent changes (git history)

`git log --oneline --since="2026-03-24" -- "**/imap*" "**/gateway.ts" "**/syncOrchestrator.ts" "**/ipc.ts"` included, among others:

- `d8819047` chore(build): build975 outputs; clarify IMAP mail-sync pause UX  
- `f7c6b361` fix(inbox): IMAP brute-force sync registration + app-level newMessages refresh (build525 outputs)  
- `7facc174` feat(email): pause/resume sync, IMAP timeout telemetry, build15 outputs  
- `f5d2ab58` feat(inbox): AutoSort session review dates, post-sort navigation, charts; build995 outputs  
- Multiple Gmail/OAuth-related commits also touch `ipc.ts` / `gateway.ts` in the same window.

These are **candidates** for regression; no runtime bisect was performed.

### 2.6 IMAP brute-force polling (2-minute interval)

**Registration**

```381:413:apps/electron-vite-project/electron/main/email/ipc.ts
const IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000
let imapBruteForceAutoSyncIntervalHandle: ReturnType<typeof setInterval> | null = null

function ensureImapBruteForceAutoSyncIntervalRegistered(getDb: () => Promise<any> | any): void {
  if (imapBruteForceAutoSyncIntervalHandle != null) return

  imapBruteForceAutoSyncIntervalHandle = setInterval(() => {
    void (async () => {
      try {
        const accounts = await emailGateway.listAccounts()
        const db = typeof getDb === 'function' ? await getDb() : getDb
        if (!db) return

        for (const acc of accounts) {
          if (acc.provider !== 'imap' || acc.status !== 'active') continue
          if (acc.processingPaused === true) continue
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
      } catch (err) {
        console.error('[IMAP-AUTO-SYNC] Error:', err)
      }
    })()
  }, IMAP_AUTO_SYNC_INTERVAL_MS)

  console.log('[IMAP-AUTO-SYNC] Registered IMAP auto-sync interval (every 2 min)')
}
```

- Called when inbox IPC registers:

```1497:1497:apps/electron-vite-project/electron/main/email/ipc.ts
  ensureImapBruteForceAutoSyncIntervalRegistered(getDb)
```

**Behavior**

- **Still present in code:** interval **120s**, filters **IMAP + active + not processingPaused**, logs **`[IMAP-AUTO-SYNC] Triggering pull…`** and **`Pull completed`** or **`Pull failed`** with error.
- **Does it call `syncAccountEmails`?** Yes — `await syncAccountEmails(db, { accountId: acc.id })`.
- **UI:** same as other auto-sync: `broadcastInboxSnapshotAfterSync` → `inbox:newMessages`; **banner** only if warnings were set elsewhere (manual pull), not from invalidate `reason` (§1.4).

---

## Issue 3: Inbox Bulk View Layout

### 3.1 Current layout structure

**Outermost container**

```4205:4208:apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
  return (
    <div className={`bulk-view-root ${bulkCompactMode ? 'bulk-view--compact' : ''}`}>
      {/* Toolbar — row 1: status tabs; row 2: Type filter; row 3: selection + AI / sync */}
      <div className="bulk-view-toolbar bulk-view-toolbar--stacked">
```

**CSS for root**

```1802:1812:apps/electron-vite-project/src/App.css
.bulk-view-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
  background: #f1f3f5;
  color: #1e293b;
}
```

**Order of major blocks (simplified)**

```
<div className="bulk-view-root">           ← flex column, overflow: hidden, height 100%
  <div className="bulk-view-toolbar …">   ← flex-shrink: 0 (see App.css)
    … tabs, InboxMessageKindSelect, sync controls …
  </div>
  {remoteDebugOpen ? fixed debug panel : null}
  {lastSyncWarnings ? <SyncFailureBanner /> : null}
  <div className="bulk-view-provider-section"> … Email Accounts … </div>
  <div className="bulk-view-content" ref={bulkScrollContainerRef}>   ← flex: 1, overflow-y: auto
    … chrome (status dock, pagination) + .bulk-view-grid-scroll + message rows …
  </div>
</div>
```

Reference: toolbar + content regions:

```5124:5136:apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
      {/* Content — primary scrollport for list + chrome (IntersectionObserver root for infinite scroll) */}
      <div className="bulk-view-content" ref={bulkScrollContainerRef}>
        {error ? (
          <div className="bulk-view-content-message bulk-view-empty-state" style={{ color: '#ef4444' }}>
            {error}
          </div>
        ) : loading && displayMessages.length === 0 && !bulkBackgroundRefresh ? (
          <div className="bulk-view-content-message bulk-view-empty-state">Loading…</div>
        ) : !loading && !bulkBackgroundRefresh && messages.length === 0 ? (
          <div className="bulk-view-content-message bulk-view-empty-state">No messages in this batch.</div>
        ) : (
          <div className="bulk-view-content-body">
            <div className="bulk-view-content-chrome">
```

**Scrollable message list**

- The **vertical** scroll for the grid is on **`.bulk-view-content`** (`overflow-y: auto`), not on the root. The toolbar, banner, and provider section sit **above** that scrollport.

```2795:2806:apps/electron-vite-project/src/App.css
/* Primary vertical scroll: full inbox workspace under toolbar (chrome + message grid). */
.bulk-view-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 24px 28px;
}
```

**Layout model**

- **Flexbox** column: root → toolbar (fixed in flex sense) + provider strip + flex-growing scroll area.

### 3.2 Sticky header identification

- **`EmailInboxBulkView.tsx`**: `position: 'fixed'` appears for **modals/overlays** (e.g. WR Expert modal ~577, remote debug ~4373, other overlays ~5599) — **not** for the main toolbar.
- **Bulk toolbar** uses **`flex-shrink: 0`** (keeps it from shrinking), **not** `position: sticky`:

```2301:2310:apps/electron-vite-project/src/App.css
.bulk-view-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  gap: 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  flex-shrink: 0;
  background: #ffffff;
}
```

- **Provider section** also `flex-shrink: 0`:

```2763:2768:apps/electron-vite-project/src/App.css
.bulk-view-provider-section {
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
```

- **Chrome inside the scroll area** (`bulk-view-content-chrome`) is `flex-shrink: 0`, so pagination / status dock **scroll with** `.bulk-view-content` but **stay grouped at the top of that region**:

```2815:2827:apps/electron-vite-project/src/App.css
/* Natural height (chrome + grid); `.bulk-view-content` is the only outer vertical scrollport */
.bulk-view-content-body {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.bulk-view-content-chrome {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
```

- Repo-wide `position: sticky` in `App.css` exists at other lines (e.g. 1450, 1568, 5585) — **not** on `.bulk-view-toolbar` / `.bulk-view-root` (verified by grep). The bulk header behavior is **“pinned by flex + separate scrollport”**, not CSS sticky.

### 3.3 Desired behavior (restated)

- One continuous scroll: **toolbar + banner + provider + messages** move together; header scrolls away; message list can use full viewport after scrolling; **no** fixed/sticky header.

### 3.4 Proposed CSS/layout change (specific)

Based on the current structure:

1. **Move the single vertical scroll to the root** (or an outer wrapper that contains toolbar + banner + provider + content):
   - Set **`.bulk-view-root`** to `overflow-y: auto` (and likely remove `overflow: hidden`), keeping `min-height: 0` / `flex: 1` as required by the parent shell.
2. **Remove the inner scrollport** from **`.bulk-view-content`**:
   - Change `overflow-y: auto` → `visible` or `overflow: visible`, and drop `flex: 1 1 auto` / `min-height: 0` if the root now absorbs scrolling (or keep `flex: 1` without overflow so the root scrolls).
3. **No `position: sticky` / `fixed`** on the main toolbar is required for the desired behavior; the issue is **`flex-shrink: 0` toolbar + provider outside the scrolling element**. Those blocks should **live inside** the scrolling ancestor instead.
4. **`flex-shrink: 0`** on `.bulk-view-toolbar` and `.bulk-view-provider-section` is fine **inside** a common scroll parent — it only prevents compression, not “stickiness.” It does **not** by itself block scrolling away unless paired with **`overflow: hidden` on the root** and a **child-only** scroll (current pattern).

**IntersectionObserver / infinite scroll:** `bulkScrollContainerRef` is attached to `.bulk-view-content`. The observer explicitly uses that node as **`root`**:

```2415:2424:apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
  const bulkScrollContainerRef = useRef<HTMLDivElement>(null)

  /** Infinite scroll: sentinel vs IntersectionObserver root = `.bulk-view-content` (sole vertical scrollport for chrome + grid). */
  // ...
    const root = bulkScrollContainerRef.current
  // ...
    const observer = new IntersectionObserver(
```

If the scroll container moves to `.bulk-view-root` (or another ancestor), this **`root` must be updated** or infinite scroll may stop firing.

---

## Gaps / not verified in-repo

- Live **`email-accounts.json`** contents for `oscarschreyer@web.de` (path is userData; not read).
- Exact **Gmail connect** code path that persists `gmailOAuthClientSecret` (whether every Desktop PKCE connect stores it).
