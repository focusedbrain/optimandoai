# IMAP, Syncing, and Depackaging Analysis

## Executive Summary

**Verified:** The app separates **account / transport** APIs (`window.emailAccounts`) from **inbox sync and SQLite-backed inbox** APIs (`window.emailInbox`). **Message pull** that writes to `inbox_messages` is **`window.emailInbox.syncAccount` → IPC `inbox:syncAccount` → `syncAccountEmails`**, not `window.emailAccounts.syncAccount` — the latter **does not exist** on the preload bridge. A legacy IPC handler **`email:syncAccount`** still calls **`emailGateway.syncAccount`**, which only runs **`provider.testConnection`** and updates JSON account status; it **does not** run the inbox orchestrator or fetch mail into the DB.

**Verified:** OAuth and IMAP **share** `syncOrchestrator.syncAccountEmails`, `emailGateway.listMessages` / `getMessage`, and `messageRouter.detectAndRouteMessage`. IMAP-specific pieces are **`ImapProvider`**, **`resolveImapPullFolders`**, **`resolveImapPullFoldersExpanded`**, and IMAP remote-queue behavior in `inboxOrchestratorRemoteQueue`.

**Inference (likely fault domains for “IMAP stopped, test still OK”):** (1) **API confusion** — debugging with `window.emailAccounts.syncAccount` (undefined) vs correct `window.emailInbox.syncAccount`; (2) **`email_sync_state`** — incremental `last_sync_at` advanced while **listed 0** can leave “nothing new” until **`inbox:resetSyncState`**; (3) **fetch vs test** — `testConnection` proves LOGIN/LIST-like reachability, not that **SEARCH + UID FETCH** for the sync window returns data or that **per-message `fetchMessage`** succeeds for every listed UID; (4) **auto-sync** — DB-driven loops require **`auto_sync_enabled`**; the separate **2-minute IMAP `setInterval`** only filters `provider === 'imap' && status === 'active'`.

**Top suspected breakpoints:** preload/API namespace mismatch; sync state / bootstrap vs incremental; IMAP folder path vs LIST-expanded path; post-pull **`processPendingPlainEmails` / `processPendingP2PBeapEmails`** or DB insert errors surfaced only in `SyncResult.errors`.

---

## Scope and Method

**Reviewed (primary):**

- `apps/electron-vite-project/electron/preload.ts` — `contextBridge` exposure
- `apps/electron-vite-project/electron/main/email/ipc.ts` — `registerEmailHandlers`, `registerInboxHandlers`, pull + inbox IPC
- `apps/electron-vite-project/electron/main/email/gateway.ts` — account lifecycle, `listMessages`, `getMessage`, `testConnection`, `syncAccount`, `getConnectedProvider`
- `apps/electron-vite-project/electron/main/email/syncOrchestrator.ts` — `syncAccountEmails`, `startAutoSync`, `updateSyncState`
- `apps/electron-vite-project/electron/main/email/providers/imap.ts` — connect, `fetchMessages`, `fetchMessage` / `simpleParser`
- `apps/electron-vite-project/electron/main/email/providers/gmail.ts`, `outlook.ts`, `zoho.ts` — pattern reference for OAuth list/fetch
- `apps/electron-vite-project/electron/main/email/messageRouter.ts` — `detectAndRouteMessage`, DB inserts, pending queues
- `apps/electron-vite-project/electron/main/email/plainEmailIngestion.ts`, `beapEmailIngestion.ts` — depackaging follow-up
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` — which bridge is used for Pull
- `apps/electron-vite-project/src/components/handshakeViewTypes.ts` — TypeScript `Window` typings

**Tracing method:** ripgrep for symbols (`syncAccount`, `resetSyncState`, `inbox:syncAccount`, `email:syncAccount`), then linear read of handlers and call chains.

---

## Architecture Overview

### Component map

| Layer | Path / symbol | Responsibility |
|--------|----------------|----------------|
| Preload | `preload.ts` → `emailAccounts`, `emailInbox` | Split bridges; validation for some payloads |
| Email account IPC | `ipc.ts` `registerEmailHandlers` | `email:*` — accounts, send, `testConnection`, `connectCustomMailbox`, legacy `email:syncAccount` |
| Inbox IPC | `ipc.ts` `registerInboxHandlers` | `inbox:*` — sync pull, list/get messages from **SQLite**, auto-sync resume, remote queue |
| Gateway | `emailGateway` singleton in `gateway.ts` | In-memory accounts JSON, provider cache, unified list/get/send |
| Sync orchestrator | `syncOrchestrator.ts` | Serialized `syncAccountEmails`, Smart Sync options, dedupe, calls gateway + `detectAndRouteMessage` |
| IMAP provider | `ImapProvider` in `imap.ts` | node-imap session, SEARCH/UID fetch, RFC822 parse via **mailparser `simpleParser`** on full fetch |
| OAuth providers | `gmail.ts`, `outlook.ts`, `zoho.ts` | REST/graph list + fetch |
| Routing / ingest | `messageRouter.ts` | Insert `inbox_messages` + `plain_email_inbox` or `p2p_pending_beap` |
| Depackage (async) | `plainEmailIngestion.ts`, `beapEmailIngestion.ts` | Update `depackaged_json` etc. after pull |
| Remote mirror | `inboxOrchestratorRemoteQueue.ts` | Queue mailbox moves; IMAP-specific throttling/ping |

### Pipeline diagram (text)

```
[Renderer Pull button / auto-sync timer]
    → window.emailInbox.syncAccount (NOT emailAccounts)
    → IPC inbox:syncAccount
    → runInboxAccountPullKind → syncAccountEmails(db, { accountId })
         → emailGateway.listMessages (per folder) → getConnectedProvider → ImapProvider.fetchMessages / OAuth fetchMessages
         → for each listed id: getMessage → fetch full body → sanitize
         → detectAndRouteMessage → INSERT inbox_messages (+ plain_email_inbox OR p2p_pending_beap)
    → processPendingPlainEmails / processPendingP2PBeapEmails
    → enqueue remote ops + scheduleOrchestratorRemoteDrain (bounded)
    → renderer refresh: store calls emailInbox.listMessages (SQLite), not gateway email:listMessages
```

**Verified:** Inbox UI reads **`inbox:listMessages`** (local DB). **`email:listMessages`** hits the live provider and is a separate code path (used by other features / IPC), not the main inbox list for WR Desk inbox tabs.

---

## OAuth Flow

1. **Account creation — Verified:** `preload.emailAccounts.connectGmail` / `connectOutlook` / `connectZoho` → IPC → `gateway.connectGmailAccount` etc. → OAuth flow → `addAccount` with tokens in `EmailAccountConfig`.
2. **Persistence — Verified:** `saveAccounts` writes encrypted/stored config (see `credentials` / gateway `loadAccounts`).
3. **Validation — Verified:** `addAccount` calls `testConnection`; failures set `status: 'error'`.
4. **Connection for sync — Verified:** `getConnectedProvider` creates provider, optional token refresh callback, `provider.connect(account)`.
5. **Sync trigger — Verified:** Same as IMAP for **inbox pull**: `emailInbox.syncAccount` → `syncAccountEmails`. **Additionally:** `startAutoSync` when `auto_sync_enabled` and resume IIFE; **no** IMAP-only 2-minute timer for OAuth.
6. **Message fetch — Verified:** `gateway.listMessages` → `provider.fetchMessages` (Gmail/Graph/Zoho APIs).
7. **Parsing — Verified:** Provider returns `RawEmailMessage`; full detail fetch uses provider-specific parsing (not necessarily `simpleParser` in main — depends on provider implementation).
8. **Storage — Verified:** `detectAndRouteMessage` → `inbox_messages` + pending queues.
9. **Inbox UI — Verified:** `useEmailInboxStore` / components call `window.emailInbox.listMessages` with filters → `inbox:listMessages` → SQL on `inbox_messages`.

---

## IMAP Flow

1. **Account creation — Verified:** `emailAccounts.connectCustomMailbox` → `email:connectCustomMailbox` → `emailGateway.connectCustomImapSmtpAccount` → tests IMAP (and SMTP) → saves account → `email:accountConnected` event → `mirrorGlobalAutoSyncToNewAccount`, `runPostEmailConnectFailedQueueCleanup`.
2. **Credential update — Verified:** `updateImapCredentials` → may `forceReconnect` after successful test.
3. **Connection test — Verified:** `email:testConnection` → `gateway.testConnection` → `getConnectedProvider` (or fail if no password) → `ImapProvider.testConnection`.
4. **Reconnect hints — Verified:** `getImapReconnectHints` for wizard UX (host/port/security guidance).
5. **Sync trigger — Verified:** Identical entry to OAuth: **`emailInbox.syncAccount`** → `inbox:syncAccount`. **Plus:** `registerInboxHandlers` ends with **`setInterval` every 2 minutes** calling `syncAccountEmails` for each **active IMAP** account (no `auto_sync_enabled` check on that path).
6. **Folder resolution — Verified:** `resolveImapPullFolders` (`domain/imapPullFolders.ts`) → base labels; for IMAP, `gateway.resolveImapPullFoldersExpanded` → `ImapProvider.expandPullFoldersForSync` (LIST + spam/junk discovery + INBOX children rules).
7. **List fetch — Verified:** `gateway.listMessages` → `getConnectedProvider` → `ImapProvider.fetchMessages` with `fromDate` / `toDate` / `syncMaxMessages` from orchestrator. **UID SEARCH + UID FETCH** used in `fetchMessagesSince` / `fetchMessagesBeforeExclusive` when dates apply; seq-range fallback when no valid `fromDate`.
8. **Per-message fetch — Verified:** `getMessage` → `ImapProvider.fetchMessage` → tries INBOX then lifecycle folders; **`simpleParser(buffer)`** on RFC822.
9. **Checkpoint — Verified:** SQLite `email_sync_state`: `last_sync_at`, `last_uid`, `sync_cursor`, `last_error`, `auto_sync_enabled`, `sync_interval_ms`. Bootstrap vs incremental decided in `syncOrchestrator` from **`last_sync_at` NULL vs set**.
10. **Dedup — Verified:** `getExistingEmailMessageIds` on `inbox_messages.email_message_id` vs listed `msg.id` (IMAP UID string).
11. **Depackaging pipeline — Verified:** Same `detectAndRouteMessage` as OAuth; plain path enqueues **`plain_email_inbox`**; BEAP path **`p2p_pending_beap`**. Post-sync **`processPendingPlainEmails`** / **`processPendingP2PBeapEmails`** fills **`depackaged_json`** etc.
12. **UI — Verified:** Same `emailInbox.listMessages` from SQLite.

**Verified:** Codebase search shows **no `UIDVALIDITY`** handling string in `electron-vite-project` — UIDs are treated as stable only insofar as the server and folder don’t reset; **Inference:** mailbox rebuild on server could theoretically desync UID semantics without explicit UIDVALIDITY storage (not implemented here).

---

## Flow Comparison: OAuth vs IMAP

| Stage | OAuth | IMAP |
|--------|--------|------|
| Preload connect | `connectGmail` / `connectOutlook` / `connectZoho` | `connectCustomMailbox`, `updateImapCredentials` |
| Account storage | `email-accounts.json` (+ vault for secrets) | Same file, `provider: 'imap'`, imap/smtp blocks |
| Inbox pull entry | `emailInbox.syncAccount` | **Same** |
| List messages | REST/Graph | `ImapProvider` IMAP SEARCH + fetch |
| Full message body | Provider-specific | **`simpleParser`** in `imap.ts` |
| Folder expansion | API folder IDs / well-known names | LIST + `expandPullFoldersForSync` |
| Extra auto-sync | DB `startAutoSync` only if enabled | **Same** + **2 min `setInterval`** for all active IMAP |
| Remote queue drain | Shared; IMAP rows throttled / ping | Stricter backoff (see `REMOTE_ORCHESTRATOR_SYNC.md`) |

**Divergent components:** `ImapProvider` vs Gmail/Outlook/Zoho providers; IMAP folder expansion; IMAP brute-force interval; orchestrator IMAP multi-folder merge and per-folder error collection.

**Likely regression points:** Assuming **`emailAccounts.syncAccount`** exists; assuming **`email:syncAccount`** pulls mail (it does not); IMAP-only **SEARCH returns 0** while **testConnection** still passes; **account `status`** not `active` (brute-force IMAP sync skips); **`auto_sync_enabled`** off (DB loop idle) while user expects global sync.

---

## Preload and IPC Surface Analysis

### Exposed renderer APIs (Verified)

**`window.emailAccounts`** (`preload.ts`): `listAccounts`, `getAccount`, `testConnection`, `getImapReconnectHints`, `updateImapCredentials`, `sendEmail`, `deleteAccount`, connect methods, `connectCustomMailbox`, **`resetSyncState`** (maps to `inbox:resetSyncState`), `validateImapLifecycleRemote`, OAuth credential helpers, `onAccountConnected`, dev-only `diagnoseImap`.

**`window.emailInbox`:** includes **`syncAccount`** → `inbox:syncAccount`, `pullMoreAccount`, `listMessages`, `getMessage`, sync preferences, auto-sync toggle, remote sync helpers, AI hooks, etc.

### Missing or stale APIs (Verified vs symptoms)

- **`window.emailAccounts.syncAccount`:** **Not exposed.** **Verified** — only `emailInbox.syncAccount` exists in `preload.ts`.
- **`email:syncAccount`:** **Registered** in `registerEmailHandlers` and calls **`emailGateway.syncAccount`** — **connection test only**. **Verified** in `gateway.ts` (comment: “Just test connection for now”). **Not** wired in preload to `emailAccounts`.

**Inference:** DevTools scripts or old docs that call `window.emailAccounts.syncAccount` will fail; the **intentional** pull API is **`window.emailInbox.syncAccount`**.

### Mismatches

- **TypeScript `Window` interface** in `handshakeViewTypes.ts` lists `resetSyncState` under **`emailAccounts`** (correct) and **`syncAccount` under `emailInbox`** — aligns with preload.
- **Inference:** Any UI copy or internal script that still references “sync” only under “accounts” without `emailInbox` is stale.

---

## Sync Pipeline Analysis

### Scheduling (Verified)

- **`startAutoSync`** (`syncOrchestrator.ts`): per-account `setTimeout` loop; each tick checks **`email_sync_state.auto_sync_enabled === 1`**, then `syncAccountEmails`, post-processing, bounded remote drain.
- **Resume on startup** (`ipc.ts` IIFE): if **any** row has `auto_sync_enabled = 1`, enable for **all** active gateway accounts and **`startStoredAutoSyncLoopIfMissing`**.
- **IMAP 2-minute interval** (`ipc.ts` end of `registerInboxHandlers`): loops `listAccounts`, for each **`imap` + `active`** calls **`syncAccountEmails`** (ignores `auto_sync_enabled`).

### State transitions (Verified)

- **`updateSyncState`:** upserts `email_sync_state` including `last_sync_at`, `last_error`, counters.
- **Bootstrap 0 messages:** orchestrator may **not** advance `last_sync_at` so next pull retries window (`skipAdvanceLastSyncAt` when `bootstrap && messages.length === 0 && newCount === 0`).
- **`inbox:resetSyncState`:** sets `last_sync_at`, `last_error`, `last_error_at` to NULL (with cooldown); **`clearConsecutiveZeroListingPulls`**.

### Retries / reconnect (Verified)

- **`getConnectedProvider`:** if cached provider **`!isConnected()`**, calls **`connect`** again.
- **Auth-like errors:** `syncAccountEmails` and `runInboxAccountPullKind` may set IMAP account to **`auth_error`** via `updateAccount`.
- **`forceReconnect`:** used after credential updates and in remote drain when needed.

### Background execution (Verified)

- **`syncChains` Map:** serializes `syncAccountEmails` per `accountId`.
- **`syncPullLock`:** marks pull active during list+fetch to coordinate with remote drain (see `REMOTE_ORCHESTRATOR_SYNC.md`).

---

## IMAP Fetch Analysis

### Connection (Verified)

- **`ImapProvider.connect`:** node-imap with TLS mode from `imapUsesImplicitTls` / `securityModeNormalize`.
- **Password required:** `getConnectedProvider` throws if IMAP password missing.

### Folder selection (Verified)

- **`resolveImapPullFolders`:** default `INBOX` + `Spam`, minus lifecycle names when resolvable.
- **`expandPullFoldersForSync`:** LIST-based path resolution; if empty expanded set, fallback `[config.folders?.inbox || 'INBOX']`.

### Fetch strategy (Verified)

- **Incremental:** `fromDate: last_sync_at` → **`fetchMessagesSince`** (SEARCH SINCE + UID FETCH).
- **Bootstrap:** `fromDate` = window start or omitted (full seq-range path when no `fromDate`).
- **Pull more:** `toDate` only → **`fetchMessagesBeforeExclusive`**.

### Cursor / checkpoint (Verified)

- **`last_sync_at`:** primary incremental boundary.
- **`last_uid` / `sync_cursor`:** updated from orchestrator (IMAP UID seen during ingest); not a substitute for UIDVALIDITY-aware resync in code (**Inference:** limited if server resets UIDs).

---

## Depackaging / Parsing Analysis

### Raw payload to app message (Verified)

1. **List phase:** Headers (and partial body in list fetch options) → `RawEmailMessage` with **`id` = UID** for IMAP.
2. **Detail phase:** `fetchMessage` loads RFC822 → **`simpleParser(buffer)`** (`mailparser`) → mapped to `RawEmailMessage` in `imap.ts`.
3. **Routing:** `detectAndRouteMessage` uses BEAP heuristics on attachments/body → **`email_beap`** vs **`email_plain`**.
4. **Plain path:** After `inbox_messages` insert, row queued in **`plain_email_inbox`** with JSON snapshot; **`processPendingPlainEmails`** runs **`convertPlainToBeapFormat`** → updates **`depackaged_json`**, **`embedding_status: 'pending'`**.
5. **BEAP path:** **`p2p_pending_beap`** → **`processPendingP2PBeapEmails`** / **`beapPackageToMainProcessDepackaged`** (main-process approximation; extension sandbox not used here).

### IMAP vs OAuth depackaging (Verified)

- **Same** `detectAndRouteMessage`, same SQLite schema, same pending queues.
- **Different** raw acquisition (IMAP `simpleParser` on main vs API provider body assembly).

### Parser errors (Verified)

- **`simpleParser`:** promise in IMAP fetch path; failures propagate as rejected `fetchMessage` → orchestrator records error for that message id.
- **`plainEmailIngestion`:** per-row try/catch logs and marks `plain_email_inbox` processed to avoid infinite loop.

---

## Persistence and Inbox Projection Analysis

### DB writes (Verified)

- **`inbox_messages`:** primary row from `messageRouter` INSERT.
- **`inbox_attachments`:** attachment files encrypted to disk + metadata rows.
- **`email_sync_state`:** per-account sync metadata.

### Projection refresh (Verified)

- **Not a separate CQRS projection table** for inbox list — UI queries **`inbox_messages`** via **`inbox:listMessages`** with `buildInboxMessagesWhereClause` filters (tabs, handshake, source_type, etc.).

### UI read path (Verified)

- **`useEmailInboxStore.refreshMessages` / load paths** use **`getBridge()` = `window.emailInbox`** and **`listMessages`** IPC.

---

## Failure Modes and Root Cause Candidates

| # | Hypothesis | Evidence | Likelihood |
|---|------------|----------|------------|
| 1 | **Wrong API in DevTools** — `emailAccounts.syncAccount` undefined | Preload only defines `syncAccount` on `emailInbox` | **High** (Verified) |
| 2 | **`email:syncAccount` mistaken for mail pull** | Gateway `syncAccount` = test only | **High** (Verified) |
| 3 | **Incremental sync window / SEARCH returns 0** | `fetchMessagesSince` resolves `[]` if no matches; testConnection does not run SEARCH | **High** |
| 4 | **`last_sync_at` advanced but 0 new mail** | Bootstrap special-case avoids advance on 0; incremental always advances on success path except errors | **Medium** |
| 5 | **IMAP account not `active`** | 2-minute sync skips; pull still runs if user triggers `inbox:syncAccount` | **Medium** |
| 6 | **`auto_sync_enabled` off** | `startAutoSync` tick returns early | **Medium** |
| 7 | **Folder OPEN fails** for expanded path | Per-folder catch in orchestrator; errors in `result.errors` | **Medium** |
| 8 | **Dedup** — all IDs already in `inbox_messages` | Silent 0 new | **Medium** |
| 9 | **`getMessage` null** | Pushes to errors, skips ingest | **Medium** |
| 10 | **Parser failure on specific messages** | Throws in loop; other messages may still ingest | **Lower** |
| 11 | **No UIDVALIDITY** | Cannot prove from code; **Inference** server-side UID change rare but unhandled | **Low–Medium** |

---

## Most Likely Root Cause

**Verified primary confusion:** Expecting **`window.emailAccounts.syncAccount`** for inbox pull — it is **not implemented** on that object; **`window.emailInbox.syncAccount`** is the real entry point.

**Secondary (Inference):** After that is cleared, the most common “connected but empty” pattern is **successful `testConnection`** combined with **incremental `fromDate: last_sync_at`** or **SEARCH** returning no UIDs (server date semantics, wrong folder, or already-synced window), or **dedupe** removing all candidates.

---

## Recommended Fixes

### Immediate

1. **Document in dev docs:** “Pull = `window.emailInbox.syncAccount(accountId)`; `emailAccounts` has no sync.”
2. **Optional preload alias (Inference):** `emailAccounts: { …, syncInbox: (id) => ipcRenderer.invoke('inbox:syncAccount', id) }` to reduce foot-guns — or **`console.warn`** if a deprecated name is ever added.
3. **Deprecate or rename `email:syncAccount`** to `email:verifyConnection` in a future refactor to avoid confusion with inbox sync.

### Safer architecture

- Single **“inboxSync”** namespace or one **`emailBridge.syncMailbox`** that internally dispatches to `inbox:syncAccount`.
- Persist **UIDVALIDITY** per folder if IMAP reliability becomes a requirement (**Inference**).

### Observability

- Structured log line when **`inbox:syncAccount`** starts/ends with `listed`, `new`, `provider`, `folderCount` (some exists via `[PULL]` / `[IMAP-PULL-TRACE]`).
- Surface **`result.errors`** in UI when Pull completes with **0 new** but **errors.length > 0**.

### Regression tests

- Preload contract test: assert **`emailInbox.syncAccount`** and **`emailAccounts.syncAccount`** undefined.
- Integration test: mock `ImapProvider.fetchMessages` / `fetchMessage` and assert **`inbox_messages`** row count after **`runInboxAccountPullKind`**.

---

## Appendix: Relevant Files and Symbols

| File | Symbols / handlers |
|------|---------------------|
| `electron/preload.ts` | `emailAccounts`, `emailInbox`, `syncAccount` on **emailInbox** only |
| `electron/main/email/ipc.ts` | `registerEmailHandlers`, `registerInboxHandlers`, `email:syncAccount`, `inbox:syncAccount`, `runInboxAccountPullKind`, `inbox:resetSyncState`, `inbox:listMessages` |
| `electron/main/email/gateway.ts` | `listMessages`, `getMessage`, `testConnection`, `syncAccount`, `getConnectedProvider`, `connectCustomImapSmtpAccount` |
| `electron/main/email/syncOrchestrator.ts` | `syncAccountEmails`, `syncAccountEmailsImpl`, `startAutoSync`, `updateSyncState` |
| `electron/main/email/providers/imap.ts` | `ImapProvider`, `fetchMessages`, `fetchMessagesSince`, `fetchMessage`, `simpleParser` |
| `electron/main/email/messageRouter.ts` | `detectAndRouteMessage`, `resolveStorageEmailMessageId` |
| `electron/main/email/domain/imapPullFolders.ts` | `resolveImapPullFolders` |
| `electron/main/email/plainEmailIngestion.ts` | `processPendingPlainEmails` |
| `electron/main/email/beapEmailIngestion.ts` | `processPendingP2PBeapEmails`, `beapPackageToMainProcessDepackaged` |
| `src/stores/useEmailInboxStore.ts` | `getBridge`, `syncAccount` → `emailInbox` |
| `src/components/handshakeViewTypes.ts` | `Window` typings for bridges |

---

*Labels: **Verified** = directly observed in repository source; **Inference** = reasonable conclusion not uniquely provable from a single code path.*
