# IMAP manual pull: renderer → SQLite (call chain & failure points)

Scope: manual pull via **`window.emailInbox.syncAccount(accountId)`** → **`inbox:syncAccount`**. Code paths under `apps/electron-vite-project/electron/main/email/` unless noted.

---

## Call chain

### Step 0 — IPC entry

| | |
|--|--|
| **File** | `electron/main/email/ipc.ts` |
| **Symbol** | `ipcMain.handle('inbox:syncAccount', …)` (~2388–2402) |
| **Input** | `accountId` (string) |
| **Output** | Return value of `runInboxAccountPullKind(accountId, 'pull')` (`ok`, `data`, `pullStats`, `pullHint`, `syncWarnings`, …) |
| **Failure** | Top-level catch → `{ ok: false, error }`; inner throw logged as `[IMAP-PULL-TRACE] syncAccount CRASHED` |

---

### Step 1 — Pull orchestration wrapper

| | |
|--|--|
| **File** | `ipc.ts` |
| **Symbol** | `runInboxAccountPullKind(accountId, kind)` (~2257–2386), `kind === 'pull'` |
| **Input** | `accountId`; resolves DB via `resolveDb()` |
| **Output** | IPC result object with `syncAccountEmails` result folded in + `pullStats` |
| **Failure** | `db` missing → `{ ok: false, error: 'Database unavailable' }`; `syncAccountEmails` throw → `{ ok: false, error, syncWarnings: [msg] }` (IMAP auth heuristic may `updateAccount` to `auth_error`) |

**Calls:** `syncAccountEmails(db, { accountId })` from `syncOrchestrator.ts` (~2271).

**After successful pull:** `processPendingPlainEmails(db)`, `processPendingP2PBeapEmails(db)`, remote queue enqueue + `scheduleOrchestratorRemoteDrain(resolveDb)` (~2298–2314).

---

### Step 2 — Serialized sync core

| | |
|--|--|
| **File** | `electron/main/email/syncOrchestrator.ts` |
| **Symbol** | `syncAccountEmails` → `syncAccountEmailsImpl` (~314–333, 335+) |
| **Input** | `db`, `{ accountId, pullMore?, limit? }` |
| **Output** | `SyncResult` (`ok`, `newMessages`, `errors`, `newInboxMessageIds`, `listedFromProvider`, `skippedDuplicate`, …) |
| **Failure** | Outer catch (~627+): `result.ok = false`, `updateSyncState` `last_error`; per-message errors accumulate in `result.errors` without always setting `ok: false` |

**Key sub-steps inside `syncAccountEmailsImpl` (IMAP-relevant):**

1. **Sync prefs + DB state** (~355–384): `getEffectiveSyncWindowDays`, `getMaxMessagesPerPull`, `email_sync_state` row → builds `listOptions` (`fromDate` / `toDate`, `syncFetchAllPages`, `syncMaxMessages`) for bootstrap vs incremental vs pullMore.

2. **Folder list** (~457–461): `resolveImapPullFolders(accountCfg)` then `emailGateway.resolveImapPullFoldersExpanded(accountId, basePullLabels)` for IMAP.

3. **List messages** (~468–497 or ~493–496): `emailGateway.listMessages(accountId, { …listOptions, folder })` per folder (merge if multi-folder).

4. **Dedupe** (~499–516): `getExistingEmailMessageIds(db, accountId)` → skip if `existingIds.has(msg.id)`.

5. **Full body + attachments** (~518–554): `emailGateway.getMessage(accountId, msg.id)`; `listAttachments` / `fetchAttachmentBuffer` (IMAP: see Step 4b).

6. **Route + insert** (~556–557): `mapToRawEmailMessage(detail, attachments, …)` → `detectAndRouteMessage(db, accountId, rawMsg)`.

7. **Checkpoint** (~590–619): `updateSyncState` with `last_sync_at` (unless bootstrap zero-list skip), `last_uid`, `total_synced`.

---

### Step 3 — Gateway list / get (IMAP)

| | |
|--|--|
| **File** | `electron/main/email/gateway.ts` |
| **Symbol** | `listMessages` (~577–584), `getMessage` (~586–594) |
| **Input** | `accountId`, `MessageSearchOptions` (incl. `folder`, `fromDate`, …) / `messageId` (UID string for IMAP) |
| **Output** | `SanitizedMessage[]` / `SanitizedMessageDetail \| null` |
| **Failure** | `findAccount` throws if unknown id; `getConnectedProvider` throws (e.g. missing IMAP password); provider rejects → exception bubbles to orchestrator |

**Chain:** `getConnectedProvider(account)` → `ImapProvider` for `provider === 'imap'` → `fetchMessages` / `fetchMessage`.

---

### Step 4a — IMAP list (UID SEARCH path when `fromDate` valid)

| | |
|--|--|
| **File** | `electron/main/email/providers/imap.ts` |
| **Symbol** | `fetchMessages` (~813+), `fetchMessagesSince` (~523+), `fetchMessagesBeforeExclusive` (pullMore), or seq-range fallback |
| **Input** | `folder` (expanded path), `options` from orchestrator |
| **Output** | `RawEmailMessage[]` with `id`/`uid` set from IMAP UID |
| **Failure** | `openBox` / `search` / `fetch` errors → reject; **0 UIDs from SEARCH** → resolve `[]` (silent empty list, logged under `EMAIL_DEBUG`) |

---

### Step 4b — IMAP full message for ingest

| | |
|--|--|
| **File** | `imap.ts` |
| **Symbol** | `fetchMessage(messageId)` (~1154–1209), `fetchMessageFromFolder` (~1037+), **`simpleParser`** on RFC822 buffer (~1073 area) |
| **Input** | UID string |
| **Output** | `RawEmailMessage \| null` |
| **Failure** | **`Not connected`** throws; UID not in configured **`config.folders.inbox`** nor lifecycle try-paths → **`null`** → orchestrator pushes *`Could not fetch message ${msg.id}`* and **skips insert** (~519–522) |

**Verified:** `listAttachments` / `fetchAttachment` on `ImapProvider` are **stubs** returning `[]` / `null` (~1212–1219) — ingest still runs with **body from `fetchMessage`** but **no IMAP attachment bytes** in this path.

---

### Step 5 — SQLite insert + pending queues

| | |
|--|--|
| **File** | `electron/main/email/messageRouter.ts` |
| **Symbol** | `detectAndRouteMessage(db, accountId, rawMsg)` (~168+) |
| **Input** | `RawEmailMessage` (from gateway detail + attachment array) |
| **Output** | `{ type: 'beap' \| 'plain', inboxMessageId, … }` |
| **Failure** | DB/constraint errors throw → caught in orchestrator per-message loop (~571–573) |

**Writes:** `INSERT INTO inbox_messages` (~283–313); then either **`insertPendingP2PBeap`** or **`plain_email_inbox`** row with JSON snapshot (~429+).

---

### Step 6 — Post-processing / depackaging

| | |
|--|--|
| **File** | `ipc.ts` (`runInboxAccountPullKind`) |
| **Symbol** | `processPendingPlainEmails`, `processPendingP2PBeapEmails` (~2298–2306) |
| **Input** | same `db` |
| **Output** | Updates `inbox_messages.depackaged_json`, `embedding_status`, drains pending tables |
| **Failure** | Logged warnings; rows may stay pending if processing throws (`plainEmailIngestion` marks some rows processed to avoid loops) |

| | |
|--|--|
| **File** | `plainEmailIngestion.ts` |
| **Symbol** | `processPendingPlainEmails` (~22–71) |

| | |
|--|--|
| **File** | `beapEmailIngestion.ts` |
| **Symbol** | `processPendingP2PBeapEmails` (batch drain of `p2p_pending_beap`) |

**Note:** **`inbox_messages` row exists immediately after Step 5**; depackaging enriches columns used by some UI/analytics, not the raw existence of the row.

---

## Failure points (grouped)

| Stage | Symptom | Where |
|--------|---------|--------|
| IPC / DB | Pull never runs | `resolveDb()` null |
| List | 0 candidates | `ImapProvider.fetchMessages` / SEARCH / wrong `folder` / incremental `fromDate` |
| Dedupe | 0 **new** | `existingIds.has(msg.id)` for every listed UID |
| Fetch body | 0 inserts | `getMessage` → `fetchMessage` → **`null`** (UID not found in `config.folders.inbox` open vs listed folder mismatch, or mail moved) |
| Route | 0 or partial | `detectAndRouteMessage` throws (per-message) |
| Depackage | “Empty” rich fields | `processPendingPlainEmails` / BEAP drain errors — **row usually still present** |

---

## First 3 places: connection test OK, zero *new* visible inbox messages

1. **`emailGateway.listMessages` / `ImapProvider.fetchMessages`** — LOGIN succeeds in `testConnection`, but **SEARCH returns no UIDs** for the sync window, **`openBox(folder)`** fails for expanded path (caught per-folder in multi-folder mode with **partial** merge), or **incremental `fromDate: last_sync_at`** excludes all server mail. **Effect:** `messages.length === 0` → no calls to `getMessage` → **no inserts**. (`syncOrchestrator.ts` ~505–510.)

2. **`getExistingEmailMessageIds` dedupe** — List returns UIDs already stored as `email_message_id` for that `account_id`. **Effect:** `skippedDuplicate` only, **`newCount` stays 0**; UI shows no new mail. (`syncOrchestrator.ts` ~499–516.)

3. **`emailGateway.getMessage` → `ImapProvider.fetchMessage` returns `null`** — List used one mailbox path (e.g. expanded Spam/child), but **`fetchMessage` first opens `this.config?.folders.inbox || 'INBOX'`** and may not find the UID there if paths differ or message only existed in list folder. **Effect:** `Could not fetch message` errors, **no insert** for those IDs. (`syncOrchestrator.ts` ~519–522; `imap.ts` ~1164–1209.)

---

## Most suspicious breakpoint

**Mismatch between list folder and `fetchMessage`’s initial mailbox** (`ImapProvider.fetchMessage` hard-paths **`config.folders.inbox`** first, while `syncOrchestrator` lists from **`pullFolders`** which can differ after `resolveImapPullFoldersExpanded`). **Symptom:** non-zero **listed**, **errors** for each id, **zero ingested** — with **connection test still passing** because test does not simulate per-UID fetch from each listed folder.

---

*Code references: line numbers are approximate to current files; verify with repo.*
