# PR B-2 Breakage Inventory

Paths that write to `inbox_messages` or `inbox_attachments` using raw `db.prepare()`, bypassing
the sealed storage gate.  In `reject` mode, reads of these rows through `sealedQuery()` return
nothing because the rows have no seals.

The breakage is intentional.  These paths drive the scope of PRs B-3 through B-9.

---

## Classification

| Class | Meaning | Gate treatment |
|-------|---------|----------------|
| **CONTENT_WRITE** | Writes `depackaged_json`, `beap_package_json`, or initial INSERT of inbox-bound content | Must be migrated to use the gate (validator must produce a seal) |
| **ATTACHMENT_WRITE** | Writes `inbox_attachments` content columns | Must be migrated to use the gate |
| **METADATA_UPDATE** | Writes non-content columns (`read_status`, `archived`, `deleted`, `ai_analysis_json`, etc.) | These do NOT require the gate — metadata updates are not content-bearing |

The gate is scoped to **content columns**.  `METADATA_UPDATE` paths are structural violations on
paper (they use raw `db.prepare()`) but they do not write content and are therefore not
gate-required.  The architecture document states: "Direct `db.prepare()` is for schema and
non-content tables."  Metadata updates fall into this category.

---

## Broken content-write paths (MUST migrate in B-3+)

### `electron/main/email/beapEmailIngestion.ts`

| Line | Operation | Class | Target PR |
|------|-----------|-------|-----------|
| 760–772 | `INSERT INTO inbox_messages (id, ..., depackaged_json, ...)` | CONTENT_WRITE | B-3 |
| 492–511 | `UPDATE inbox_messages SET depackaged_json = ?` (re-validation) | CONTENT_WRITE | B-3 |
| 246 | `INSERT INTO inbox_attachments (id, message_id, ...)` | ATTACHMENT_WRITE | B-3 |
| 507 | `INSERT INTO inbox_attachments` (duplicate path) | ATTACHMENT_WRITE | B-3 |
| 640 | `UPDATE inbox_messages SET` (status update with content refresh) | CONTENT_WRITE | B-3 |
| 747 | `UPDATE inbox_messages SET` (retry path) | CONTENT_WRITE | B-3 |

### `electron/main/email/messageRouter.ts`

| Line | Operation | Class | Target PR |
|------|-----------|-------|-----------|
| 294–302 | `INSERT INTO inbox_messages (id, ..., depackaged_json, ...)` | CONTENT_WRITE | B-4 |
| 305 | `INSERT INTO inbox_attachments (id, message_id, ...)` | ATTACHMENT_WRITE | B-4 |
| 309 | `UPDATE inbox_attachments SET content_sha256 = ?` | ATTACHMENT_WRITE | B-4 |
| 312–322 | `UPDATE inbox_attachments` (encryption columns) | ATTACHMENT_WRITE | B-4 |

### `electron/main/email/mergeExtensionDepackaged.ts`

| Line | Operation | Class | Target PR |
|------|-----------|-------|-----------|
| 126 | `UPDATE inbox_messages SET depackaged_json = ?` (extension merge) | CONTENT_WRITE | B-5 |
| 145 | `INSERT INTO inbox_attachments` (merged attachments) | ATTACHMENT_WRITE | B-5 |
| 149–154 | `UPDATE inbox_attachments` (filename, encryption, sha256) | ATTACHMENT_WRITE | B-5 |

### `electron/main/email/plainEmailIngestion.ts`

| Line | Operation | Class | Target PR |
|------|-----------|-------|-----------|
| 46 | `UPDATE inbox_messages SET depackaged_json = ?` (plain email conversion) | CONTENT_WRITE | B-6 |

### `electron/main/email/ipc.ts`

| Line | Operation | Class | Target PR |
|------|-----------|-------|-----------|
| 3569 | `UPDATE inbox_messages SET depackaged_json = ?` (AI post-process re-write) | CONTENT_WRITE | B-7 |

---

## Metadata-update paths (no gate required, informational only)

These paths use raw `db.prepare()` against `inbox_messages` or `inbox_attachments` but write
**non-content columns only**.  They do not require the gate.

### `electron/main/email/ipc.ts`
- L1764: `UPDATE inbox_messages SET last_autosort_session_id = NULL`
- L1972–1973: `UPDATE inbox_messages SET remote_orchestrator_last_error = ?`
- L2067: `UPDATE inbox_messages SET email_message_id = ?, imap_remote_mailbox = ?`
- L3156: `UPDATE inbox_messages SET read_status = 1`
- L3315: `UPDATE inbox_messages SET read_status = ?`
- L3329: `UPDATE inbox_messages SET starred = ?`
- L3341: `UPDATE inbox_messages SET archived = 1`
- L3355: `UPDATE inbox_messages SET sort_category = ?`
- L3530: `UPDATE inbox_attachments SET extracted_text = ?, text_extraction_status = ?` *(text extraction — review in B-8)*
- L3594: `UPDATE inbox_attachments SET text_extraction_status = 'skipped'`
- L3694: `UPDATE inbox_messages SET ai_analysis_json = ?`
- L3936: `UPDATE inbox_messages SET ai_analysis_json = ?`
- L4021: `UPDATE inbox_messages SET ai_analysis_json = ?`
- L4700: `UPDATE inbox_messages SET last_autosort_session_id = ?`
- L4851–4872: `UPDATE inbox_messages SET archived / pending_delete / pending_review_at`
- L4892: `UPDATE inbox_messages SET ai_analysis_json = ?`
- L5158: `UPDATE inbox_messages SET ai_analysis_json = ?`
- L5303: `UPDATE inbox_messages SET pending_delete = 1`
- L5321: `UPDATE inbox_messages SET sort_category = 'pending_review'`
- L5336: `UPDATE inbox_messages SET pending_delete = 0, ...`
- L5350: `UPDATE inbox_messages SET sort_category = NULL, ...`
- L5364: `UPDATE inbox_messages SET archived = 0, ...`

### `electron/main/email/remoteDeletion.ts`
- L188: `UPDATE inbox_messages SET lifecycle_remote_delete_skip_reason = ?`
- L210: `UPDATE inbox_messages SET deleted = 1, deleted_at = ?, purge_after = ?`
- L240: `UPDATE inbox_messages SET deleted = 0, ...`
- L285: `UPDATE inbox_messages SET remote_deleted = 1, remote_deleted_at = ?`

### `electron/main/email/inboxLifecycleEngine.ts`
- L114: `UPDATE inbox_messages SET ...` (lifecycle state transition)
- L177: `UPDATE inbox_messages SET lifecycle_final_delete_queued_utc = ?`

### `electron/main/email/inboxOrchestratorRemoteQueue.ts`
- L447: `UPDATE inbox_messages SET remote_orchestrator_last_error = ?`
- L646: `UPDATE inbox_messages SET email_message_id = ?, imap_remote_mailbox = ?`
- L1667: `UPDATE inbox_messages SET account_id = ?` (account migration)

### `electron/main/email/beapEmailIngestion.ts`
- L263: `UPDATE inbox_messages SET has_attachments = 1, attachment_count = ?`
- L511: `UPDATE inbox_attachments SET encryption_key = ?`
- L513: `UPDATE inbox_attachments SET content_sha256 = ?` *(attachment sha review)*

---

## Test files (out of scope — test infrastructure only)

The following test files write to `inbox_messages` directly.  They are test infrastructure, not
production code, and are exempt from the migration requirement:

- `electron/main/email/__tests__/pr22SecurityDeferrals.test.ts`
- `electron/main/email/__tests__/mergeExtensionDepackaged.validation.test.ts`
- `electron/main/email/__tests__/pbeapValidation.test.ts`
- `electron/main/email/__tests__/messageRouter.ingestTransaction.test.ts`

These tests may need updating in their respective migration PRs.

---

## Runtime impact of reject mode today

Since **no production code calls `sealedQuery()`** yet (only test files do), the runtime impact of
reject mode is zero today:

- Existing rows continue to be readable via raw `db.prepare().all()` — the gate only applies
  when code explicitly routes reads through `sealedQuery()`.
- Production write paths continue to use raw `db.prepare()` — the gate only applies when code
  explicitly routes writes through `prepareSealedInsert()` / `prepareSealedUpdate()`.

The gate is enforced structurally: once B-3+ migration PRs route each path through the gate,
those paths immediately get full seal verification.  Until then, the gate sits ready but idle on
the production paths.

---

## Summary

| Category | Count |
|----------|-------|
| CONTENT_WRITE paths requiring gate migration | 14 call sites across 5 files |
| ATTACHMENT_WRITE paths requiring gate migration | 8 call sites across 3 files |
| METADATA_UPDATE paths (no gate required) | ~30 call sites across 5 files |
| Test-file paths (out of scope) | ~5 call sites across 4 files |
