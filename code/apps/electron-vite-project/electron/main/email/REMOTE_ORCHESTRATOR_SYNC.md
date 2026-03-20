# Remote orchestrator ↔ origin mailbox sync

## Responsibility split

| Layer | Role |
|--------|------|
| **SQLite `inbox_messages`** | Source of truth for WR Desk UI (archived, `sort_category`, `pending_delete`, deletion queue, etc.). |
| **`remote_orchestrator_mutation_queue`** | Outbox of **best-effort** remote mutations; idempotent per `(message_id, operation)`. |
| **Email providers** (`applyOrchestratorRemoteOperation`) | Provider-specific mapping to Gmail labels, Graph folder moves, or IMAP `MOVE`. |
| **`emailGateway.applyOrchestratorRemoteOperation`** | Connects account + provider; no inbox UI logic. |

Local IPC handlers **always** commit local state first, then call `fireRemoteOrchestratorSync` (enqueue + async drain). Remote failures **do not** roll back local state.

## Lifecycle → remote mapping

| Local transition | Queue `operation` | Gmail | Microsoft 365 (Graph) | IMAP |
|------------------|---------------------|-------|------------------------|------|
| Archive | `archive` | Remove `INBOX` | Move → well-known `archive` | `MOVE` → `Archive` (mailbox created if needed) |
| Pending review | `pending_review` | Add `WRDesk/PendingReview`, remove `INBOX` + `WRDesk/PendingDelete` | Move → child folder `WR Desk — Pending Review` under Inbox | `MOVE` → `Pending Review` (default mailbox; locate source via `imap_remote_mailbox` + RFC Message-ID search) |
| Pending delete | `pending_delete` | Add `WRDesk/PendingDelete`, remove `INBOX` + `WRDesk/PendingReview` | Move → child folder `WR Desk — Pending Delete` under Inbox | `MOVE` → `Pending Delete` (same locate rules) |
| **Final delete** (grace elapsed) | *(existing)* | `users.messages.trash` via `deleteMessage` | Move → `deleteditems` via `deleteMessage` | `\Deleted` + expunge |

AI classification uses the same queue when it applies `pending_review` / `pending_delete` (not the legacy `archive` sort bucket).

## Idempotency & retries

- **Queue:** `UNIQUE(message_id, operation)` collapses duplicate work; re-enqueue after completion resets the row to `pending`.
- **Providers:** Gmail/Outlook may return `skipped: true` for ambiguous “already there” API errors. **IMAP** only returns `skipped: true` after verifying the message is already in the destination mailbox (HEADER Message-ID or UID in that folder).
- **Processor:** Up to **8** attempts per row; transient failures return row to `pending` with incrementing `attempts`. Stale `processing` (>20 min) reset to `pending`.
- **Visibility:** `inbox_messages.remote_orchestrator_last_error` holds the latest error / retry hint; `inbox:listRemoteOrchestratorQueue` exposes queue rows.

## Follow-ups

- Inverse operations (unarchive, cancel pending) on the remote mailbox.
- Configurable IMAP folder names / Gmail label prefix per account.
- Backoff delay between retries (currently immediate re-queue).
