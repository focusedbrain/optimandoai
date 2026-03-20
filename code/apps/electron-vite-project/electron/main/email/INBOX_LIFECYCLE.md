# Inbox retention lifecycle (local + remote)

## Where state lives

| Concept | Storage |
|--------|---------|
| **Desired timing** | `pending_review_at` (entered review, UTC ISO), `pending_delete_at` (entered pending-delete bucket, UTC ISO) |
| **Local applied stage** | `sort_category`, `pending_delete`, `archived`, `deleted`, `deletion_queue` |
| **Audit** | `lifecycle_exited_review_utc`, `lifecycle_final_delete_queued_utc` |
| **Remote mirror (best-effort)** | `remote_orchestrator_mutation_queue` + provider adapters |
| **Remote final delete** | `deletion_queue` + `executePendingDeletions` → `emailGateway.deleteMessage` |

## Scheduler

- **`runInboxLifecycleTick`** in `inboxLifecycleEngine.ts`, invoked every **5 minutes** from `registerInboxHandlers` and once on startup (`setImmediate`).
- All cutoffs use **`Date.now()`**-derived **UTC ISO** strings compared to DB timestamps (also stored as ISO UTC).

## Transitions

1. **Pending Review ≥ 14 days** → set `pending_delete=1`, `pending_delete_at=nowUtc`, clear `sort_category`/`sort_reason`, set `lifecycle_exited_review_utc`; enqueue remote `pending_delete`.
2. **Pending Delete ≥ 7 days** (and `deleted=0`, no active `deletion_queue` row) → `queueRemoteDeletion(..., grace 0)`; set `lifecycle_final_delete_queued_utc`.
3. **`executePendingDeletions`** (twice per tick) processes `deletion_queue` where `grace_period_ends <= now` — permanent remote delete + local `remote_deleted` (existing).

## Idempotency

- Review promotion: only rows with `pending_delete` falsy and `sort_category='pending_review'`.
- Final queue: only `deleted=0` and no active queue row.
- Repeated ticks do not duplicate promotions.

## Remote unavailable

- **Review → pending delete:** local promotion always applied; remote uses orchestrator queue (retries). See `remote_orchestrator_last_error` on the message row.
- **Final delete:** if `deleteMessage` fails, `deletion_queue.execution_error` is set and the row retries on later ticks; local row stays `deleted=1` but **not** purged until remote success path (existing `remoteDeletion` behavior).

## Edge cases

| Case | Handling |
|------|-----------|
| User cancels review/delete | Clears flags; job predicates exclude the row |
| `pending_review_at` NULL | Never auto-promotes |
| Clock skew | All sides use UTC ISO strings from the same cutoff calculation per tick |
| Double bucket | `pending_review` list excludes `pending_delete=1` in SQL |

Constants: `PENDING_REVIEW_RETENTION_MS`, `PENDING_DELETE_RETENTION_MS` in `inboxLifecycleEngine.ts`.
