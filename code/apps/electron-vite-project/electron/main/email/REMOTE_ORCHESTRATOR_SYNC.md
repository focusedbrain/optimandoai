# Remote orchestrator ↔ origin mailbox sync

## Responsibility split

| Layer | Role |
|--------|------|
| **SQLite `inbox_messages`** | Source of truth for WR Desk UI (archived, `sort_category`, `pending_delete`, deletion queue, etc.). |
| **`remote_orchestrator_mutation_queue`** | Outbox of **best-effort** remote mutations; idempotent per `(message_id, operation)`. |
| **Email providers** (`applyOrchestratorRemoteOperation`) | Provider-specific mapping to Gmail labels, Graph folder moves, or IMAP `MOVE`. |
| **`domain/remoteLifecycleAbstraction.ts`** | Shared lifecycle model: canonical bucket names, backend kind (`gmail_api_labels` / `microsoft_graph_mailfolder_move` / `imap_uid_move`), `resolveRemoteLifecycleSnapshot(account)`. |
| **`emailGateway.applyOrchestratorRemoteOperation`** | Connects account + provider; no inbox UI logic. |

Local IPC handlers **always** commit local state first, then enqueue remote work — either **`fireRemoteOrchestratorSync`** (direct op + drain) or **`enqueueRemoteOpsForLocalLifecycleState`** (DB columns as source of truth; skips when `imap_remote_mailbox` **exactly** matches the configured lifecycle mailbox/label name, case-insensitive — no substring / `includes` matching) — and **`scheduleOrchestratorRemoteDrain`**. **`enqueueRemoteOpsForLocalLifecycleState`** returns **`skipReasons: string[]`** (one line per skipped id: reason + `expected` / `observed` buckets + raw `imap_remote_mailbox`) for UI / IPC diagnostics. Empty or unknown `imap_remote_mailbox` is mapped to observed bucket **`inbox`**. Remote failures **do not** roll back local state.

## Lifecycle → remote mapping

| Local transition | Queue `operation` | Gmail | Microsoft 365 (Graph) | IMAP |
|------------------|---------------------|-------|------------------------|------|
| Archive | `archive` | Remove `INBOX` | Move → well-known `archive` | `MOVE` → `Archive` (mailbox created if needed) |
| Pending review | `pending_review` | Add user label `Pending Review`, remove `INBOX` + `Pending Delete` label | **Move** → root folder `Pending Review`: **GET** `/me/mailFolders?$top=100` + client-side name match, else **POST /me/mailFolders** (no OData `$filter`). **Never DELETE.** | `MOVE` → `Pending Review` (default mailbox; locate source via `imap_remote_mailbox` + RFC Message-ID search) |
| Pending delete | `pending_delete` | Add user label `Pending Delete`, remove `INBOX` + `Pending Review` label | Same list/create pattern for **`Pending Delete`**. | `MOVE` → `Pending Delete` (same locate rules) |
| **Final delete** (grace elapsed) | *(existing)* | `users.messages.trash` via `deleteMessage` | Move → `deleteditems` via `deleteMessage` | `\Deleted` + expunge |

AI classification enqueues `pending_review`, `pending_delete`, and **`archive`** (when the model chooses `archive`, local `archived = 1` and the `archive` remote op runs).

## Post-pull / auto-sync mirror

After **`inbox:syncAccount`** (Pull):

1. `syncAccountEmails` collects `newInboxMessageIds` for rows ingested in that run.
2. `processPendingPlainEmails` / `processPendingP2PBeapEmails` run (same as before).
3. **`enqueueRemoteOpsForLocalLifecycleState`** enqueues remote ops from current local columns for those IDs (archive → `pending_delete` → `pending_review` precedence).
4. **`scheduleOrchestratorRemoteDrain`** only — IPC returns without waiting; remote mailbox mirror continues in the background.

After each **auto-sync tick** (`syncOrchestrator.startAutoSync`), steps 1–3 are the same, then **`drainOrchestratorRemoteQueueBounded`** still runs inline (capped ~28s / 150 batches) before the next tick is scheduled, plus **`scheduleOrchestratorRemoteDrain`** for overflow.

### Pull vs background remote drain

- **`syncPullLock`** (`markPullActive` / `markPullInactive`) wraps **provider list + per-message fetch** in `syncAccountEmails` for that `accountId`.
- **`scheduleOrchestratorRemoteDrain`** can still run during Pull (e.g. `fireRemoteOrchestratorSync` from another IPC handler). **`processOrchestratorRemoteQueueBatch`** skips rows whose `account_id` is pull-active (rows stay `pending`; **`deferredDueToPull`**). Other accounts’ queue rows still process.
- **`inbox:syncAccount`** already schedules drain **after** `syncAccountEmails` returns; the lock covers concurrent drains, not the manual Pull ordering alone.

**`inbox:aiClassifySingle`**: after local DB updates, non-urgent paths call **`enqueueRemoteOpsForLocalLifecycleState(db, [messageId])`** (same supersede / skip rules as bulk mirror), then the handler calls **`scheduleOrchestratorRemoteDrain`** — background only (no inline bounded drain).

**`inbox:aiCategorize`** schedules background drain only (no inline bounded drain), so Auto-Sort is not blocked on remote I/O.

**`scheduleOrchestratorRemoteDrain`** runs one batch per tick, then **reschedules** while `pendingRemaining > 0`, after work was processed, or when a parallel enqueue set `drainRescheduleRequested` — so the queue is drained to completion in the background (not a single batch only).

**Pull vs drain:** `inbox:syncAccount` calls **`scheduleOrchestratorRemoteDrain`** only after **`syncAccountEmails`** resolves; the pull lock is released in **`syncAccountEmailsImpl`**’s **`finally { markPullInactive }`**, so the lock is cleared before the IPC handler schedules drain.

**IMAP:** On socket **`end`**, the provider sets **`connected = false`** and **`client = null`** so the next operation reconnects. **`applyOrchestratorRemoteOperation`** requires **`connected && client`**. Auth/session-style errors from apply are **not retried** up to 8 times; the queue row is marked **`failed`** and **IMAP** accounts get **`updateAccount({ status: 'error', lastError })`** so the UI can prompt reconnect (e.g. web.de).

Bulk **Auto-Sort** (`runAiCategorizeForIds`) ends with **`inbox:enqueueRemoteSync`** (alias of lifecycle mirror) for **all successfully classified** message IDs (`allProcessedIds`), then **`inbox:fullRemoteSyncForMessages`** so every touched account gets a pass over **all** rows where local lifecycle ≠ `imap_remote_mailbox` (lifecycle moves only; **inbox restore** when remote is wrong but local is inbox is counted as `inboxRestoreNeeded` until a dedicated op exists).

**`inbox:fullRemoteSyncAllAccounts`** (UI **☁ Sync Remote**): loops **`emailGateway.listAccounts()`**, runs **`enqueueFullRemoteSync`** per account, then **`scheduleOrchestratorRemoteDrain`** once — useful to force reconciliation without re-running Auto-Sort.

After each successful remote **`apply`**, **`processOrchestratorRemoteQueueBatch`** updates **`inbox_messages.email_message_id`** and **`inbox_messages.imap_remote_mailbox`** when the provider returns `imapUidAfterMove` / `imapMailboxAfterMove`, so the column tracks the message’s actual remote folder.

**IMAP `email_message_id`:** must be the numeric **UID** in the source mailbox (not the RFC `Message-ID` header). Ingest uses **`resolveStorageEmailMessageId`** (`messageRouter.ts`) and IMAP sync builds raw messages with **`uid` + `id`** only (`syncOrchestrator.mapToRawEmailMessage`). RFC header stays in **`imap_rfc_message_id`**. Schema **v42** one-time `UPDATE` swaps columns when legacy rows stored RFC in `email_message_id` and UID in `imap_rfc_message_id`.

IMAP **`applyOrchestratorRemoteOperation`** calls **`imapEnsureMailbox(dest)`** before `MOVE`. Gmail uses **`ensureWrDeskUserLabel`** to create missing user labels.

## Idempotency & retries

- **Queue:** `UNIQUE(message_id, operation)` collapses duplicate work; re-enqueue after completion resets the row to `pending`.
- **Providers:** Gmail/Outlook may return `skipped: true` only for explicit same-destination / already-moved Graph errors — **not** generic “not found” (avoids marking rows completed when the message id is stale). **IMAP** only returns `skipped: true` after verifying the message is already in the destination mailbox (HEADER Message-ID or UID in that folder).
- **Outlook recovery:** If mail seems missing after an older build, check **Deleted items** (e.g. *Gelöschte Elemente*) and **Recoverable items** in Outlook on the web; move back to Inbox if needed, then re-sync. Current builds use **move** to **Pending Delete** / **Pending Review** folders only (no Graph hard-delete for those ops).
- **Processor:** Default **50** pending rows per batch. Rows are grouped by **`account_id`** and each account is drained **in parallel** (`Promise.allSettled`); within one account, ops run **sequentially** with a short pause — **50ms** after IMAP moves, **200ms** after Gmail / Microsoft 365 (Graph rate limits). Up to **8** attempts per row; transient failures return row to `pending` with incrementing `attempts`. Stale `processing` (>5 min) reset to `pending`. Each apply is capped at **30s** (`Promise.race`) so hung IMAP does not block the drain forever. Before a row is marked `processing`, **`emailGateway.ensureConnectedForOrchestratorOperation`** runs (15s connect cap): failure → row **`failed`** immediately (max attempts), IMAP accounts get **`status: 'error'`**, and other rows for the **same `account_id` in that batch** reuse the error without repeated handshakes.
- **Debug:** `debug:queueStatus` returns **`byAccountStatus`** (`GROUP BY account_id, status`) and **`queueByAccountSummary`** (human labels: `email (provider)` + pending/processing/completed/failed counts) for isolating one bad account (e.g. web.de) vs Outlook.
- **Visibility:** `inbox_messages.remote_orchestrator_last_error` holds the latest error / retry hint; `inbox:listRemoteOrchestratorQueue` exposes queue rows.
- **Retry failed:** `inbox:retryFailedRemoteOps` (optional **`accountId`** argument) — bulk debug **Retry failed** resets **all** failed rows; **Per account → Retry failed (this account)** resets only **`status = 'failed'`** rows for that **`account_id`**. Both set **`status = 'pending'`, `attempts = 0`, `last_error = NULL`**, **`updated_at`**, then **`scheduleOrchestratorRemoteDrain`**. The debug panel auto-refreshes queue stats every **5s** while open and shows drain progress + ETA from the **completed** count trend over the last **30s**.

## Manual QA (Auto-Sort ↔ remote)

- [ ] Auto-Sort 10 messages → `remote_orchestrator_mutation_queue` shows expected pending rows (via `inbox:listRemoteOrchestratorQueue` / DB).
- [ ] Optional: click **☁ Sync Remote** (bulk toolbar or standard inbox toolbar) → full account reconcile enqueued; drain still chained until queue empty.
- [ ] Wait for background drain → rows move to `completed` (or failed with visible error).
- [ ] web.de: messages appear in correct lifecycle folders.
- [ ] Outlook: messages appear in correct lifecycle folders.
- [ ] Reclassify 1 message → prior queue row superseded / new op enqueued per supersede rules.
- [ ] Pull again → no spurious “Could not fetch message” for moved mail (INBOX + lifecycle fetch path).

## Follow-ups

- Inverse operations (unarchive, cancel pending) on the remote mailbox.
- Configurable IMAP folder names / Gmail label names per account (`orchestratorRemote` on `EmailAccountConfig`).
- Backoff delay between retries (currently immediate re-queue).
