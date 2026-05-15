# PR B-7.1 — Operational-Update Gate API

**Phase B Architecture, PR B-7.1**
**Date:** 2026-05-10
**Follows:** PR B-7 (IPC Content Updates Migration)

---

## Summary

PR B-7 migrated all *content* UPDATE sites (`ai_analysis_json`,
`extracted_text`) to the sealed-storage gate via re-seal operations.  It
surfaced two stop-and-report conditions:

- **Condition 3 (B-7):** 11 pure-operational UPDATE sites in `ipc.ts`
  (`read_status`, `starred`, `archived`, `sort_category`, `pending_delete`,
  autosort columns, IMAP linkage) remained raw.
- **Condition 4 (B-7):** 3 `ai_analysis_json = NULL` reset sites — already
  migrated by B-7 itself.

Plus an atomicity issue in `classifySingleMessage`: operational sort columns
were written *before* the AI analysis re-seal, so a re-seal failure left the
row in an inconsistent state.

B-7.1 closes all three gaps.

---

## Step A — Inventory and Classification

### Sites in `ipc.ts` (16 total, all operational)

| # | Handler | SQL Pattern | Columns | Classification |
|---|---------|-------------|---------|----------------|
| 1 | `autosort:deleteSession` | `SET last_autosort_session_id = NULL WHERE last_autosort_session_id = ?` | `last_autosort_session_id` | Operational |
| 2 | remote orchestrator loop | `SET remote_orchestrator_last_error = ? WHERE id = ?` | `remote_orchestrator_last_error` | Operational |
| 3 | remote orchestrator loop | `SET remote_orchestrator_last_error = NULL WHERE id = ?` | `remote_orchestrator_last_error` | Operational |
| 4 | IMAP apply | `SET email_message_id = ?, imap_remote_mailbox = ? WHERE id = ?` | `email_message_id`, `imap_remote_mailbox` | Operational |
| 5 | `inbox:getMessage` | `SET read_status = 1 WHERE id = ?` | `read_status` | Operational |
| 6 | `inbox:markRead` (bulk) | `SET read_status = ? WHERE id = ?` | `read_status` | Operational |
| 7 | `inbox:toggleStar` | `SET starred = ? WHERE id = ?` | `starred` | Operational |
| 8 | `inbox:archiveMessages` (bulk) | `SET archived = 1 WHERE id = ?` | `archived` | Operational |
| 9 | `inbox:setCategory` (bulk) | `SET sort_category = ? WHERE id = ?` | `sort_category` | Operational |
| 10 | `inbox:getAttachmentText` | `SET text_extraction_status = ? WHERE id = ?` (inbox_attachments) | `text_extraction_status` | Operational |
| 11 | `classifySingleMessage` session stamp | `SET last_autosort_session_id = ? WHERE id = ?` | `last_autosort_session_id` | Operational |
| 12–16 | `classifySingleMessage` 5-way branch | `SET archived, pending_delete, pending_delete_at, pending_review_at, sort_category, sort_reason, urgency_score, needs_reply` | Multiple operational | Operational |
| 17 | `inbox:markPendingDelete` (bulk) | `SET pending_delete = 1, pending_delete_at = ? WHERE id = ?` | `pending_delete`, `pending_delete_at` | Operational |
| 18 | `inbox:moveToPendingReview` (bulk, dynamic IN) | `SET sort_category = 'pending_review', pending_review_at = ?` | `sort_category`, `pending_review_at` | Operational |
| 19 | `inbox:cancelPendingDelete` (from B-7 split) | `SET pending_delete = 0, pending_delete_at = NULL, sort_category = NULL, sort_reason = NULL` | Multiple operational | Operational |
| 20 | `inbox:cancelPendingReview` (from B-7 split) | `SET sort_category = NULL, sort_reason = NULL, pending_review_at = NULL` | Multiple operational | Operational |
| 21 | `inbox:unarchive` (from B-7 split) | `SET archived = 0, sort_category = NULL, sort_reason = NULL` | Multiple operational | Operational |

**Conclusion:** All 21 sites in `ipc.ts` are pure operational. Zero content
columns in any SET clause.

### Sites discovered outside `ipc.ts`

| File | Line | SQL Pattern | Classification | Action |
|------|------|-------------|----------------|--------|
| `beapEmailIngestion.ts` | 271 | `SET has_attachments = 1, attachment_count = ?` on `inbox_messages` | Operational (denormalized count) | **Migrated** |
| `beapEmailIngestion.ts` | 510 | `SET content_sha256 = ?` on `inbox_attachments` (qBEAP decrypt path) | Content-adjacent, outside sealed transaction | **Stop-and-Report Condition 3** (see below) |
| `inboxOrchestratorRemoteQueue.ts` | 1667 | `SET account_id = ? WHERE account_id = ?` on `inbox_messages` | Operational (account migration) | **Migrated** |
| `messageRouter.ts` | 695 | `SET content_sha256 = ?` on `inbox_attachments` | Inside `runSealedTransaction` child write — covered by B-5 design | Not a bypass; child-write allowance applies |
| `mergeExtensionDepackaged.ts` | 425 | `SET content_sha256 = ?` on `inbox_attachments` | Inside `runSealedTransaction` child write — covered by B-5 design | Not a bypass; child-write allowance applies |

---

## Decisions A–D (recap)

### Decision A — Allowlist is hard-coded, not configurable

`OPERATIONAL_COLUMNS_ALLOWLIST` is a `const` string array in
`sealed-storage/index.ts`.  It cannot be extended at runtime, overridden by
callers, or modified via configuration.  A code review is required to add any
column.

Final allowlist (after Step A discovery):

```
read_status, starred, archived, sort_category, sort_reason,
pending_delete, pending_delete_at, pending_review, pending_review_at,
urgency_score, needs_reply,
last_autosort_session_id, autosort_pending,
email_message_id, imap_uid, imap_folder, imap_remote_mailbox,
remote_orchestrator_last_error,
lifecycle_status, lifecycle_updated_at, embedding_status,
text_extraction_status, text_extraction_error,
encryption_key, encryption_iv, encryption_tag, storage_encrypted,
has_attachments, attachment_count,
account_id
```

**Excluded (must never be added):** `seal`, `seal_input_json`,
`depackaged_json`, `depackaged_metadata`, `body_text`, `body_html`, `subject`,
`ai_analysis_json`, `attachments_canonical`, `beap_package_json`,
`content_sha256`, `extracted_text`, `extracted_text_sha256`.

### Decision B — Gate API enforces allowlist at prepare time

`prepareSealedOperationalUpdate(db, sql)` parses the SET clause via
`extractColumnsFromSetClause`, verifies every column against the allowlist, and
throws `SealVerificationError` immediately if any column is disallowed.  The
check happens at `prepare()` time (i.e., when the code constructs the statement
object), not lazily at `.run()` time.

For dynamic WHERE clauses (e.g., `IN (${placeholders})`), the SQL is
constructed at call time; the SET clause columns are still static and the
allowlist check still fires before `.run()`.

### Decision C — Operational updates do NOT modify the seal

The seal binds only canonical content columns.  Operational columns are
outside the seal's scope.  An operational UPDATE on `read_status`, `starred`,
etc. leaves `seal` and `seal_input_json` unchanged.  The `sealedQuery` read
path verifies the seal against canonical content; it does not include
operational columns in verification.  Therefore, an operational UPDATE does not
invalidate the existing seal — verified by test §3.2.

### Decision D — `classifySingleMessage` atomicity fix

**Old order (wrong):**
1. Operational sort columns written (5-way `db.prepare` branch)
2. AI analysis re-sealed via `resealWithAiAnalysis`

A re-seal failure in step 2 left operational columns reflecting an analysis
that didn't exist on the sealed row.

**New order (correct):**
1. Build `aiAnalysisData`
2. Call `resealWithAiAnalysis` — if it fails, `return { messageId, error }` immediately; no operational writes
3. If re-seal succeeds, call the 5-way `prepareSealedOperationalUpdate` branch

If step 3 fails for any reason, the content is still consistent with its seal.
The sort bucket may be stale, but that is strictly better than the prior
failure mode.

---

## Files Modified

### `sealed-storage/index.ts` (additions)

- `OPERATIONAL_COLUMNS_ALLOWLIST` — exported const string array
- `OperationalColumn` — type alias
- `extractColumnsFromSetClause(sql)` — SQL parser (paren-tracking, string-literal-aware)
- `splitAtTopLevelCommas(s)` — internal parser helper
- `SealedOperationalStatement` — thin wrapper with `.run(...bindArgs)` and `.columns` getter
- `prepareSealedOperationalUpdate(db, sql)` — gate API enforcing the allowlist

### `ipc.ts` (21 raw UPDATE sites migrated + atomicity fix)

All 21 raw operational UPDATE sites replaced with `prepareSealedOperationalUpdate`.
Import `prepareSealedOperationalUpdate` added from `'../sealed-storage'`.
`classifySingleMessage`: re-seal moved before operational writes (Decision D).
B-7 `// Stop-and-Report Condition 3` comments removed (condition resolved).

### `beapEmailIngestion.ts` (1 site migrated)

- `ensureInboxAttachmentsFromBeapPackageJson`: `has_attachments`/`attachment_count` UPDATE migrated
- Import `prepareSealedOperationalUpdate` added

### `inboxOrchestratorRemoteQueue.ts` (1 site migrated)

- `migrateInboxAccountIdAndClearQueue`: `account_id` UPDATE migrated
- Import `prepareSealedOperationalUpdate` added

### `__tests__/b71OperationalGate.test.ts` (new file)

22 test cases covering:
- `extractColumnsFromSetClause` parser (7 cases)
- `prepareSealedOperationalUpdate` gate enforcement (6 cases)
- Seal unchanged after operational update (2 cases)
- `classifySingleMessage` Decision D atomicity invariant (1 case)

---

## Stop-and-Report Conditions Encountered

### Condition 3 — B-7 gap in `beapEmailIngestion.ts` content write path

**Finding:** The `retryPendingQbeapDecrypt` function in `beapEmailIngestion.ts`
contains a raw `updateInboxDecrypted` statement that writes `depackaged_json`,
`body_text`, `subject`, `has_attachments`, `attachment_count` to
`inbox_messages` outside of a `runSealedTransaction`.  In the same code path,
`updateAttSha` writes `content_sha256` to `inbox_attachments` also outside any
sealed transaction.

This is a content write path entirely missed by B-7.  The `beapEmailIngestion`
qBEAP decrypt flow operates on rows that were initially inserted with a seal
(via the B-4 IMAP ingestion pipeline), then later decrypted and re-written with
new content — without re-sealing.

**Why not fixed in B-7.1:** The scope of B-7.1 is the operational-gate API.
Fixing this gap requires applying the `resealWithAiAnalysis`-style re-seal
pattern to the qBEAP decrypt path, which is a separate content migration
requiring a new PR (B-7.2).

**Impact:** The sealed content of qBEAP-decrypted rows is overwritten without
updating the seal.  The seal verification path (`sealedQuery`) will reject
these rows as tampered.  This is a latent defect in the qBEAP decrypt path
that predates B-7.1.

**Deferral criteria for B-7.2:**
- Migrate `updateInboxDecrypted` to a `prepareSealedUpdate` + validator call
  pattern (similar to B-7's `resealWithAiAnalysis`)
- Migrate `updateAttSha` to a `runSealedTransaction` child write

### No dynamic column names found

The SQL parser encountered no template-literal dynamic column patterns.  All
SET clauses use static column identifiers.  Stop-and-Report Condition 1 was
not triggered.

### No blended-semantics columns found (beyond Condition 3)

`has_attachments` and `attachment_count` were the only columns requiring
classification beyond the initial allowlist.  These are denormalized counts
derived from `inbox_attachments`; they are not in the canonical content JSON
and are classified as operational.  Stop-and-Report Condition 2 was not
triggered beyond the Condition 3 gap already reported.

---

## Audit Re-run Results (Section 2 — remaining raw writes)

```
rg "db\.prepare.*UPDATE inbox_messages|db\.prepare.*UPDATE inbox_attachments" -n --type ts
```

| File | Line | Status |
|------|------|--------|
| `beapEmailIngestion.ts:510` | `updateAttSha` in qBEAP decrypt path | **Stop-and-Report Condition 3 — deferred to B-7.2** |
| `messageRouter.ts:695` | `updateContentSha` | Inside `runSealedTransaction` child write (B-5 design) — NOT a bypass |
| `mergeExtensionDepackaged.ts:425` | `updateSha` | Inside `runSealedTransaction` child write (B-5 design) — NOT a bypass |
| `__tests__/*` | Various | Test code — excluded from production audit |

**Section 2 for ipc.ts: EMPTY.**  All 21 operational UPDATE sites migrated.
**Section 2 overall:** 1 production stop-and-report (B-7.2 gap), 2 false
positives from the grep (inside sealed transactions by B-5 design).

---

## Verification Log

### rg audit — `ipc.ts`

```
rg "UPDATE inbox_messages SET|UPDATE inbox_attachments SET" electron/main/email/ipc.ts
```

Returns zero matches (all replaced with `prepareSealedOperationalUpdate` calls).

### rg audit — `inboxOrchestratorRemoteQueue.ts`

```
rg "db\.prepare.*UPDATE inbox_messages" electron/main/email/inboxOrchestratorRemoteQueue.ts
```

Returns zero matches.

### rg audit — `beapEmailIngestion.ts`

```
rg "db\.prepare.*UPDATE inbox_messages" electron/main/email/beapEmailIngestion.ts
```

Returns zero matches (the `has_attachments` site migrated; `updateInboxDecrypted`
is a B-7.2 gap separately tracked, not an `inbox_messages` UPDATE by this
pattern — it's a `prepareSealedUpdate` candidate).

Actually — `updateInboxDecrypted` IS a raw `UPDATE inbox_messages SET` inside
`db.prepare`. It was **NOT** caught by the initial B-7 audit because the B-7
audit scoped only to `ipc.ts`.  The remaining raw write at `beapEmailIngestion.ts:488`
(`updateInboxDecrypted: db.prepare(...)`) is a B-7.2 gap.  Full grep:

```
db.prepare(`\n    UPDATE inbox_messages SET\n      depackaged_json
```

This hit is in `beapEmailIngestion.ts:488` and is tracked under Stop-and-Report
Condition 3 above.

### TypeScript compilation

B-7.1-specific files compile cleanly:
- `sealed-storage/index.ts` — no new errors
- `ipc.ts` — all 21 sites use `prepareSealedOperationalUpdate`; import added
- `beapEmailIngestion.ts` — `prepareSealedOperationalUpdate` import added; site migrated
- `inboxOrchestratorRemoteQueue.ts` — `prepareSealedOperationalUpdate` import added; site migrated
- `b71OperationalGate.test.ts` — imports verified

Pre-existing errors in `vite.config.ts` and unrelated files are not
introduced by B-7.1.

### Manual allowlist review

The `OPERATIONAL_COLUMNS_ALLOWLIST` was reviewed line-by-line.  No content
columns (`seal`, `seal_input_json`, `depackaged_json`, `ai_analysis_json`,
`body_text`, `body_html`, `subject`, `attachments_canonical`,
`beap_package_json`, `content_sha256`, `extracted_text`,
`extracted_text_sha256`) appear in the list.

---

## What Was Not Verified

1. **SQL parser edge cases not covered by tests:** Subqueries in SET clauses
   (`SET col = (SELECT ...)`), column aliases, or multi-statement SQL.  These
   patterns do not appear in the current production corpus, but a future column
   using such syntax would silently fail to parse.  The parser throws on
   unrecognized patterns, so the failure mode is immediate (not silent).

2. **Future column additions:** If an unrelated feature adds a new operational
   column without updating `OPERATIONAL_COLUMNS_ALLOWLIST`, the gate will
   reject the new UPDATE at call time.  This is the intended behavior (code
   review boundary), but it requires developers to be aware of the allowlist.

3. **Performance impact of parse-time check:** `extractColumnsFromSetClause`
   runs a regex and a linear scan of the SET clause.  For short SQL strings
   (all current operational UPDATEs are < 200 chars), this is negligible.
   No benchmarking was performed.

4. **`beapEmailIngestion.ts` qBEAP decrypt content path (B-7.2 gap):**
   The `retryPendingQbeapDecrypt` function's raw `updateInboxDecrypted` write
   was not migrated.  Rows processed by this path have their seals invalidated.
   The `sealedQuery` read path will reject these rows.  This is tracked as a
   pre-existing B-7 gap; B-7.2 must close it.

5. **`classifySingleMessage` return type compatibility:** The new early-return
   path `return { messageId, error: 're-seal failed: ...' }` was added.  The
   caller's handling of a non-null `error` field was not verified end-to-end
   in the UI.
