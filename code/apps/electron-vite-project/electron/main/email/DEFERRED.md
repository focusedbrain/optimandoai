# Email — deferred work

## A1 — Root mailbox consolidation (preferred future fix)

**Current (A2):** Display-layer dedupe in `listAccounts()` collapses duplicate gateway rows that share the same normalized `provider::email` identity. Role-scoped read tokens are migrated to the surviving row on disk cleanup; tie-break prefers the bundled oauth gateway row.

**Deferred (A1):** One gateway row per mailbox with **scope as an attribute** (read / send / bundled), instead of separate role-split rows plus display dedupe. Would remove the need for `mailboxAccountDedupe.ts` winner logic and orphan cleanup after reconnect.

**Trigger to implement A1:** When role-split legacy rows are rare in the field and a migration path from dual-row → single-row-with-scopes is tested on real sandbox/host pairs.
