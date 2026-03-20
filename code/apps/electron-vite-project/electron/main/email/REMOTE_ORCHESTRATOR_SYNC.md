# Remote orchestrator ↔ origin mailbox sync

## Responsibility split

| Layer | Role |
|--------|------|
| **SQLite `inbox_messages`** | Source of truth for WR Desk UI (archived, `sort_category`, `pending_delete`, deletion queue, etc.). |
| **`remote_orchestrator_mutation_queue`** | Outbox of **best-effort** remote mutations; idempotent per `(message_id, operation)`. |
| **Email providers** (`applyOrchestratorRemoteOperation`) | Provider-specific mapping to Gmail labels, Graph folder moves, or IMAP `MOVE`. |
| **`domain/remoteLifecycleAbstraction.ts`** | Shared lifecycle model: canonical bucket names, backend kind (`gmail_api_labels` / `microsoft_graph_mailfolder_move` / `imap_uid_move`), `resolveRemoteLifecycleSnapshot(account)`. |
| **`emailGateway.applyOrchestratorRemoteOperation`** | Connects account + provider; no inbox UI logic. |

Local IPC handlers **always** commit local state first, then call `fireRemoteOrchestratorSync` (enqueue + async drain). Remote failures **do not** roll back local state.

## Lifecycle → remote mapping

| Local transition | Queue `operation` | Gmail | Microsoft 365 (Graph) | IMAP |
|------------------|---------------------|-------|------------------------|------|
| Archive | `archive` | Remove `INBOX` | Move → well-known `archive` | `MOVE` → `Archive` (mailbox created if needed) |
| Pending review | `pending_review` | Add user label `Pending Review`, remove `INBOX` + `Pending Delete` label | Move → child folder `Pending Review` under Inbox | `MOVE` → `Pending Review` (default mailbox; locate source via `imap_remote_mailbox` + RFC Message-ID search) |
| Pending delete | `pending_delete` | Add user label `Pending Delete`, remove `INBOX` + `Pending Review` label | Move → child folder `Pending Delete` under Inbox | `MOVE` → `Pending Delete` (same locate rules) |
| **Final delete** (grace elapsed) | *(existing)* | `users.messages.trash` via `deleteMessage` | Move → `deleteditems` via `deleteMessage` | `\Deleted` + expunge |

AI classification enqueues `pending_review`, `pending_delete`, and **`archive`** (when the model chooses `archive`, local `archived = 1` and the `archive` remote op runs).

## Post-pull / auto-sync mirror

After **`inbox:syncAccount`** (Pull) and after each **auto-sync tick**:

1. `syncAccountEmails` collects `newInboxMessageIds` for rows ingested in that run.
2. `processPendingPlainEmails` / `processPendingP2PBeapEmails` run (same as before).
3. **`enqueueRemoteOpsForLocalLifecycleState`** enqueues remote ops from current local columns for those IDs (archive → `pending_delete` → `pending_review` precedence).
4. **`drainOrchestratorRemoteQueueBounded`** runs inline (time/batch capped ~28s / 150 batches) so the server catches up before IPC returns when possible.
5. **`scheduleOrchestratorRemoteDrain`** runs so any remaining / concurrent queue work continues in the background.

IMAP **`applyOrchestratorRemoteOperation`** calls **`imapEnsureMailbox(dest)`** before `MOVE`. Gmail uses **`ensureWrDeskUserLabel`** to create missing user labels.

## Idempotency & retries

- **Queue:** `UNIQUE(message_id, operation)` collapses duplicate work; re-enqueue after completion resets the row to `pending`.
- **Providers:** Gmail/Outlook may return `skipped: true` for ambiguous “already there” API errors. **IMAP** only returns `skipped: true` after verifying the message is already in the destination mailbox (HEADER Message-ID or UID in that folder).
- **Processor:** Up to **8** attempts per row; transient failures return row to `pending` with incrementing `attempts`. Stale `processing` (>20 min) reset to `pending`.
- **Visibility:** `inbox_messages.remote_orchestrator_last_error` holds the latest error / retry hint; `inbox:listRemoteOrchestratorQueue` exposes queue rows.

## Follow-ups

- Inverse operations (unarchive, cancel pending) on the remote mailbox.
- Configurable IMAP folder names / Gmail label names per account (`orchestratorRemote` on `EmailAccountConfig`).
- Backoff delay between retries (currently immediate re-queue).
