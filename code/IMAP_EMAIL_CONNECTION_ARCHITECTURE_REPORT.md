# Email / IMAP Connection System — Architecture Report

**Purpose:** Map how the Electron app connects to email (IMAP, Microsoft 365 / OAuth, SMTP), where credentials live, and how sync pulls mail — to support debugging **IMAP pulling after a refactor**.

**Scope:** Primary codebase path `apps/electron-vite-project/` (Electron main + preload + renderer; shared wizard in `apps/extension-chromium/src/shared/`).

---

## 1. Project structure overview

### 1.1 High-level layout

| Area | Path | Role |
|------|------|------|
| Electron entry | `apps/electron-vite-project/electron/main.ts` | App lifecycle; dynamic-imports email IPC registration during startup |
| Email domain (main) | `apps/electron-vite-project/electron/main/email/` | Gateway, providers, sync, inbox IPC, secure storage |
| IMAP implementation | `apps/electron-vite-project/electron/main/email/providers/imap.ts` | `node-imap` client, folder logic, fetch/search |
| Preload bridge | `apps/electron-vite-project/electron/preload.ts` | Exposes `window.emailAccounts` with validated IPC payloads |
| Renderer inbox UI | `apps/electron-vite-project/src/components/EmailInboxView.tsx`, `EmailInboxBulkView.tsx` | Connect flow, pull, test connection |
| Shared connect wizard | `apps/extension-chromium/src/shared/email/connectEmailFlow.tsx`, `.../components/EmailConnectWizard.tsx` | “Connect Email” modal; calls preload APIs |
| Extension alias | Renderer imports `@ext/shared/email/...` (bundler resolves to extension-chromium shared tree) |

### 1.2 Boot sequence (email-related)

1. `main.ts` initializes services and **dynamically imports** `./main/email/ipc`.
2. `registerEmailHandlers(getInboxDb)` registers `email:*` channels (accounts, connect, test, sync status, etc.).
3. `registerInboxHandlers(...)` registers **`inbox:syncAccount`**, **`inbox:pullMore`**, and the rest of inbox operations; **actual mailbox pull** for the inbox UI goes through these, not only `email:syncAccount`.
4. The same block wires `emailGateway` into BEAP send/list helpers.

Relevant excerpt:

```3873:3887:apps/electron-vite-project/electron/main.ts
    // Register Email Gateway handlers
    try {
      const { registerEmailHandlers, registerInboxHandlers } = await import('./main/email/ipc')
      const getInboxDb = () => getLedgerDb() ?? (globalThis as any).__og_vault_service_ref?.getDb?.() ?? (globalThis as any).__og_vault_service_ref?.db ?? null
      registerEmailHandlers(getInboxDb)
      const getAnthropicApiKey = async () => {
        try {
          const { vaultService } = await import('./main/vault/rpc')
          return await vaultService.getAnthropicApiKeyForInbox()
        } catch {
          return null
        }
      }
      registerInboxHandlers(getInboxDb, null, getAnthropicApiKey)
      console.log('[MAIN] Email Gateway IPC handlers registered')
```

---

## 2. Email connection architecture

### 2.1 Central facade: `EmailGateway`

**File:** `apps/electron-vite-project/electron/main/email/gateway.ts`

- Holds in-memory `accounts: EmailAccountConfig[]` and a **`Map<accountId, IEmailProvider>`** for live sessions.
- **Persistence:** `userData/email-accounts.json` (see `getAccountsPath()`).
- **Provider factory:** `getProvider()` switches on `account.provider` → `GmailProvider`, `OutlookProvider`, `ZohoProvider`, or `ImapProvider`.

```1289:1334:apps/electron-vite-project/electron/main/email/gateway.ts
  private async getProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    switch (account.provider) {
      case 'gmail':
        return new GmailProvider()
      case 'microsoft365':
        return new OutlookProvider()
      case 'zoho':
        return new ZohoProvider()
      case 'imap':
        return new ImapProvider()
      default:
        throw new Error(`Unknown provider: ${account.provider}`)
    }
  }

  private async getConnectedProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    let provider = this.providers.get(account.id)

    if (!provider) {
      provider = await this.getProvider(account)
      // ... OAuth onTokenRefresh wiring ...
      await provider.connect(account)
      this.providers.set(account.id, provider)
    } else if (!provider.isConnected()) {
      await provider.connect(account)
    }

    return provider
  }
```

**Shared abstraction:** All providers implement `IEmailProvider` (`providers/base.ts`): `connect`, `disconnect`, `isConnected`, `testConnection`, `listFolders`, `fetchMessages`, `fetchMessage`, send path, etc.

### 2.2 Credentials: store, retrieve, encrypt, decrypt

**OAuth (Gmail / Microsoft 365 / Zoho):** Encrypted via `encryptOAuthTokens` / `decryptOAuthTokens` in `secure-storage.ts` (and related helpers), applied in `loadAccounts` / `saveAccounts`.

**IMAP + SMTP passwords:**

- On **load**, `decryptImapSmtpPasswords()` runs per account when `imap._encrypted === true` or `smtp._encrypted === true`, using `decryptValue()` from `secure-storage.ts`.
- On **save**, `encryptImapSmtpPasswordsForDisk()` uses `encryptValue()` and sets `_encrypted` to `isSecureStorageAvailable()`.

```90:155:apps/electron-vite-project/electron/main/email/gateway.ts
function decryptImapSmtpPasswords(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap') return account
  let next: EmailAccountConfig = { ...account }
  if (next.imap && next.imap._encrypted === true) {
    try {
      const plain = decryptValue(next.imap.password)
      // ...
      next = {
        ...next,
        imap: {
          host: next.imap.host,
          port: next.imap.port,
          security: next.imap.security,
          username: next.imap.username,
          password: plain,
          _encrypted: false,
        },
      }
    } catch (err) {
      // ... status: 'error', lastError: decrypt failure ...
    }
  }
  // ... analogous SMTP block ...
  return next
}
```

**Important:** If `safeStorage` is unavailable, `encryptValue` may **store plaintext** and `decryptValue` returns the string as-is — see `secure-storage.ts` warnings in logs.

**In-memory rule:** After decryption, `_encrypted: false` and `password` is plaintext for `ImapProvider.connect()`.

### 2.3 Flow: “Connect Email” → IMAP auth → persistence

**UI:** `useConnectEmailFlow` opens `EmailConnectWizard` (`extension-chromium/src/shared/email/connectEmailFlow.tsx`).

**Preferred path (custom IMAP + SMTP):** Wizard calls `window.emailAccounts.connectCustomMailbox(payload)` → preload validates → `ipcMain.handle('email:connectCustomMailbox')` → `emailGateway.connectCustomImapSmtpAccount(payload)`.

**Preload exposure:**

```580:599:apps/electron-vite-project/electron/preload.ts
contextBridge.exposeInMainWorld('emailAccounts', {
  testConnection: (accountId: string) => ipcRenderer.invoke('email:testConnection', accountId),
  connectCustomMailbox: (payload: unknown) =>
    ipcRenderer.invoke('email:connectCustomMailbox', assertCustomMailboxPayload(payload)),
```

**Gateway `connectCustomImapSmtpAccount`:**

1. Validates payload (`domain/customImapSmtpPayloadValidation.ts`).
2. Builds a **draft** `EmailAccountConfig` with plaintext IMAP/SMTP passwords (probe id `__custom_connect_probe__`).
3. **`new ImapProvider().testConnection(draft)`** — IMAP probe **without** adding to `accounts` first.
4. **`ImapProvider.testSmtpConnection(draft)`** — nodemailer `verify()`.
5. On success, assigns real id, `accounts.push`, `saveAccounts`.

**Legacy path:** `email:connectImap` → `connectImapAccount()` still exists; comment in gateway says prefer `connectCustomImapSmtpAccount` for full inbox+send.

**Microsoft 365 / Gmail / Zoho:** OAuth flows via `email:connectOutlook`, `email:connectGmail`, `email:connectZoho` → gateway `connect*Account` → `addAccount` with `authType: 'oauth2'`.

### 2.4 Flow: after connect — mailbox sync (pull)

**Not the same as `emailGateway.syncAccount`:** The inbox “Pull” uses **`inbox:syncAccount`** which runs `syncAccountEmails()` in `syncOrchestrator.ts` and calls `emailGateway.listMessages()` → `getConnectedProvider()` → `provider.fetchMessages(...)`.

**Separate API:** `email:syncAccount` calls `emailGateway.syncAccount()`, which currently **only** `getConnectedProvider` + `provider.testConnection(account)` and updates `lastSyncAt` / status — it does **not** run the Smart Sync list/fetch pipeline.

---

## 3. IMAP-specific implementation

### 3.1 Library

- **Package:** `"imap": "^0.8.19"` in `apps/electron-vite-project/package.json` (Node **node-imap**).
- **Import interop:** `ImapCtor = (ImapMod as any).default ?? ImapMod` to handle ESM/CJS bundling.

```7:37:apps/electron-vite-project/electron/main/email/providers/imap.ts
import * as ImapMod from 'imap'
// ...
const ImapCtor = (ImapMod as any).default ?? ImapMod
```

### 3.2 Host, port, TLS / SSL

Connection options passed to `ImapCtor`:

```234:244:apps/electron-vite-project/electron/main/email/providers/imap.ts
      const client = new ImapCtor({
        user: config.imap!.username,
        password: config.imap!.password,
        host: config.imap!.host,
        port: config.imap!.port,
        tls: config.imap!.security === 'ssl',
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      })
```

**Observations for investigations:**

- **`tls` is true only when `security === 'ssl'`** (typical port 993). For **`starttls`** or **`none`**, `tls` is `false`; behavior then depends on **node-imap** defaults for STARTTLS on plain IMAP (port 143). This is a common area for regressions if UI presets or user selections changed.
- **Certificate verification is disabled** (`rejectUnauthorized: false`) for both IMAP and SMTP transport in this provider.

**SMTP (outbound):** `createSmtpTransport` uses nodemailer with `secure: smtp.security === 'ssl'`, `requireTLS: smtp.security === 'starttls'`, same `tls: { rejectUnauthorized: false }`.

### 3.3 Authentication: where username/password are injected

- **From disk:** `loadAccounts` → `decryptImapSmtpPasswords` → `account.imap.password` plaintext in memory.
- **From connect wizard:** Payload fields `imapUsername` (optional; else email) and `imapPassword` map directly into `draft.imap` for probe and persisted account.
- **Connect:** `ImapProvider.connect(config)` reads `config.imap.username` / `password` / `host` / `port` / `security` only.

### 3.4 Pooling, retries, timeouts

- **No connection pool:** One `ImapProvider` instance per cached gateway session (`this.providers.set(account.id, provider)`).
- **Timeouts:** `connTimeout` and `authTimeout` **10000 ms** on the IMAP client constructor.
- **Additional gateway timeout:** `ensureConnectedForOrchestratorOperation` races `getConnectedProvider` against **15 s** and returns a generic auth-flavored error (see §5).
- **IMAP session liveness:** `pingImapSessionWithListFolders` runs `listFolders()` with optional timeout for drain / queue paths.
- **Reconnect:** `forceReconnect` disconnects cached provider and calls `getConnectedProvider` again.

**Post-ready errors:** Commented rationale — attach persistent `error` listener after `ready` to avoid main-process crash when node-imap emits later socket errors.

### 3.5 `testConnection` semantics (IMAP)

Despite the interface comment, IMAP `testConnection` **fully connects and disconnects**:

```315:322:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect(config)
      await this.disconnect()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection failed' }
    }
  }
```

### 3.6 “Pull & Classify” vs “Smart Sync”

These are **different layers**:

- **Smart Sync** is the **pull model** documented in `syncOrchestrator.ts`: first run (no `last_sync_at`) pulls up to `maxMessagesPerPull` within `syncWindowDays`; later pulls are incremental from `last_sync_at`; **Pull More** requests older mail. Helpers: `domain/smartSyncPrefs.ts` (`getEffectiveSyncWindowDays`, `getMaxMessagesPerPull`, `getRemoteSyncReceivedAtLowerBoundIso`).

```4:9:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
 * **Model (Smart Sync)**
 * - **First run** (no `last_sync_at`): pull up to `maxMessagesPerPull` (default 500) within `syncWindowDays` (default 30; **0** = all time, same cap).
 * - **Auto-sync / manual Pull** (after first sync): incremental from `last_sync_at` only (new mail).
 * - **Pull More** (`pullMore: true`): next batch older than `MIN(received_at)` in DB, capped at `maxMessagesPerPull`.
```

- **“Classify”** (Auto-Sort / AI triage) is **separate** from IMAP wire protocol: inbox IPC copy hints that after pull, user runs Auto-Sort to classify and enqueue lifecycle moves (`ipc.ts` pull hint string). IMAP pulling does not switch modes between “classify” and “sync”; **the same `syncAccountEmails` path** loads messages, then detection/routing ingests them.

**IMAP-specific pull folders:** `resolveImapPullFolders` + `emailGateway.resolveImapPullFoldersExpanded()` can expand INBOX/Spam and related paths before listing.

---

## 4. Recent refactor impact (git)

History was taken from repo root `code_clean` with paths under `code/apps/electron-vite-project/electron/main/email/`.

**Recent commits touching IMAP / gateway / sync (newest first):**

| Commit (short) | Message (summary) |
|----------------|-------------------|
| `f011d386` | Inbox attachments sync, sender display |
| `ed64e83a` | **feat(email): IMAP pipeline**, attachment storage, inbox UI |
| `d7881796` | **fix IMAP credential persist & reconnect** |
| `4b40b3d4` | IMAP auth/sync UI, inbox bulk |
| `2fe42baf` | **Smart Sync** email UX, Zoho, sync window on connect |
| `e19e88e2` | IMAP SimpleDrain reuse session, **LIST ping**, UI log |
| `af3a54bb` | IMAP drain diagnostics + verify timeout |
| `49857d93` | Drain fixes (pull locks, watchdog) |
| `84b82198` | IMAP lifecycle folders, spam/inbox pull expand |
| `d408fae4` | IMAP UID search, queue timeouts, **pre-drain connect check** |

**Regression hypotheses aligned with code:**

1. **Shared `getConnectedProvider` + cached `Map`** — Any change to disconnect timing, `isConnected()`, or password decryption affects **all** providers but surfaces first on **long-lived IMAP** sockets.
2. **`connectCustomImapSmtpAccount` probe** uses a **fresh** `ImapProvider` instance; **sync** uses the **cached** gateway provider — if one path decrypts credentials and the other reads stale/empty password, symptoms can differ between “connect works” and “pull fails”.
3. **Smart Sync** (`syncOrchestrator` + `smartSyncPrefs`) changed pull windows and incremental behavior — failures may look like “pull stopped” when the sync state or date filters no longer match expectations.
4. **Orchestrator / drain** commits (`e19e88e2`, `49857d93`, `d408fae4`) added **LIST ping**, timeouts, and **ensureConnectedForOrchestratorOperation** — auth errors may be **normalized** to generic messages (§5).

---

## 5. Error handling

### 5.1 IMAP errors → UI

- **Probe at connect:** `connectCustomImapSmtpAccount` throws an `Error` whose message includes **`IMAP check failed:`** plus the **`imapTest.error`** string from `ImapProvider.testConnection` (usually `err.message` from node-imap / Node).
- **Saved account test:** `email:testConnection` → `gateway.testConnection` → `provider.testConnection(account)`; on failure sets `account.status` to `auth_error` or `error` using **`isLikelyEmailAuthError`** (`emailAuthErrors.ts`).

```418:454:apps/electron-vite-project/electron/main/email/gateway.ts
  async testConnection(id: string): Promise<{ success: boolean; error?: string }> {
    // ...
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
    // ...
  }
```

- **Pull path:** If `syncAccountEmails` **throws**, `runInboxAccountPullKind` maps IMAP messages through `isLikelyEmailAuthError` and may set `auth_error` + `lastError: 'Authentication failed — check credentials'`.

### 5.2 Origin of “IMAP check failed: authentication failed”

- The **fixed prefix** **`IMAP check failed:`** is composed in **`gateway.ts`** inside `connectCustomImapSmtpAccount` when the IMAP probe fails.

```1138:1143:apps/electron-vite-project/electron/main/email/gateway.ts
    const imapProbe = new ImapProvider()
    const imapTest = await imapProbe.testConnection(draft)
    if (!imapTest.success) {
      throw new Error(
        `IMAP check failed: ${imapTest.error || 'Could not connect or log in.'} Check IMAP host, port, security (SSL/TLS on 993 vs STARTTLS on 143), username, and password or app password.`
      )
```

- The substring **`authentication failed`** is **not** hardcoded in that throw; it typically comes from **`imapTest.error`**, which is **`err.message`** from the **`imap` library** or Node (e.g. server text / TLS / socket errors that use that phrase).

### 5.3 Distinction between auth, network, and TLS

- **Partial:** `isLikelyEmailAuthError()` regexes treat many messages as auth-like (including `401`, `403`, “login failed”, etc.).
- **Not granular:** Raw IMAP `testConnection` returns a single string; TLS hostname mismatches or network resets may still surface as generic `Error` messages unless the server sends auth-specific text.
- **UI helper:** `src/utils/syncFailureUi.ts` parses warning lines for auth-like substrings for display — useful for sync warnings, not for connect probe formatting.

---

## 6. Configuration and environment

### 6.1 Env vars

No dedicated `.env` entries for IMAP host/port were found under `apps/electron-vite-project` for this report. IMAP settings are **per-account** in `email-accounts.json` and **wizard presets**.

### 6.2 Provider presets (including web.de)

**File:** `apps/electron-vite-project/electron/main/email/types.ts` — exported **`IMAP_PRESETS`**; served to renderer via **`email:getImapPresets`**.

```121:129:apps/electron-vite-project/electron/main/email/types.ts
export const IMAP_PRESETS: Record<string, ImapPreset> = {
  'web.de': {
    name: 'WEB.DE',
    host: 'imap.web.de',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.web.de',
    smtpPort: 587
  },
```

**Note:** Presets include `smtpPort` but **full SMTP security** for custom connect is chosen in the wizard; ensure UI maps web.de SMTP to **STARTTLS on 587** consistently with `createSmtpTransport` expectations.

### 6.3 Persistence location

- **Accounts file:** `app.getPath('userData')` + `email-accounts.json` (`gateway.getAccountsPath()`).

---

## 7. Quick reference — key files

| Concern | File |
|---------|------|
| Account CRUD, encrypt/decrypt, connect flows | `electron/main/email/gateway.ts` |
| IMAP wire + SMTP helper | `electron/main/email/providers/imap.ts` |
| Provider interface | `electron/main/email/providers/base.ts` |
| IPC: email + inbox pull | `electron/main/email/ipc.ts` |
| Smart Sync pull logic | `electron/main/email/syncOrchestrator.ts` |
| Sync window / batch caps | `electron/main/email/domain/smartSyncPrefs.ts` |
| Auth-like error detection | `electron/main/email/emailAuthErrors.ts` |
| Secure storage / DPAPI | `electron/main/email/secure-storage.ts` |
| Preload API surface | `electron/preload.ts` |
| Types + `IMAP_PRESETS` | `electron/main/email/types.ts` |
| Connect wizard | `extension-chromium/src/shared/components/EmailConnectWizard.tsx` |

---

*Generated for investigation of IMAP pull regressions; verify behavior against your failing branch and server logs (node-imap debug) for authoritative wire-level errors.*
