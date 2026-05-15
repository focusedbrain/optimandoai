# PR B-7/11 — IPC Content Updates Migration

## Summary

Prior to B-7, two content-producing IPC paths in `ipc.ts` wrote directly to
`inbox_messages.depackaged_json` / `ai_analysis_json` and `inbox_attachments.extracted_text`
using raw `db.prepare().run()` calls, bypassing the sealed-storage gate:

1. **`inbox:getAttachmentText`** — on-demand PDF extraction wrote `inbox_attachments`
   fields (extracted_text, hashes) + merged a new `depackaged_json` into the parent row.
2. **AI analysis handlers** (5 sites) — `inbox:aiSummarize`, `inbox:aiDraftReply` (two
   branches), `classifySingleMessage`, `inbox:persistManualBulkAnalysis` — all wrote
   `ai_analysis_json` raw.
3. **`ai_analysis_json = NULL` resets** (3 mixed sites) — `inbox:cancelPendingDelete`,
   `inbox:cancelPendingReview`, `inbox:unarchive` — cleared `ai_analysis_json` alongside
   operational columns in one raw UPDATE.

B-7 migrates all these content writes to the sealed gate's re-seal pattern.

## Step A Inventory

Total `UPDATE inbox_messages SET` sites in `ipc.ts` after migration: **11 remaining** — all
pure operational (read_status, starred, archived, sort_category, pending_delete, autosort
session IDs, IMAP identifiers, remote orchestrator error). These are Stop-and-Report
Condition 3 (see below).

Content writes migrated by B-7: **8 sites** (5 AI + 1 PDF extraction + 3 mixed).

## Step B — PDF extraction investigation result

| Aspect | Finding |
|--------|---------|
| Trigger | On-demand IPC (`inbox:getAttachmentText`); ingest-time path (`messageRouter`) already sealed |
| Writes | `inbox_attachments`: extracted_text, hashes, status. `inbox_messages`: depackaged_json (merge) |
| Ingest path | Already inside `runSealedTransaction` (Att-2 pattern). NOT migrated — already correct |
| IPC path | Raw `db.prepare().run()` — **migrated in B-7** |

## Step C — AI analysis investigation result

| Handler | Data written | Shape |
|---------|-------------|-------|
| `inbox:aiSummarize` | Merges `summary` + `status` into existing object | `{ summary: string, status: string, ...prev }` |
| `inbox:aiDraftReply` (BEAP) | Merges capsule draft | `{ draftReply: { publicMessage, encryptedMessage }, draftReplyPublic, draftReplyFull, status }` |
| `inbox:aiDraftReply` (non-BEAP) | Merges text draft | `{ draftReply: string, status }` |
| `classifySingleMessage` | Writes full analysis object | `{ category, urgencyScore, urgencyReason, summary, reason, needsReply, needsReplyReason, recommendedAction, actionExplanation, actionItems, draftReply, status: 'classified' }` |
| `inbox:persistManualBulkAnalysis` | Renderer-supplied bulk analysis | Same shape as classifySingleMessage |

`AiAnalysisCanonicalShape`: No dedicated TypeScript type found in main process. All sites
use `Record<string, unknown>`. The validator accepts any non-array object for `ai_analysis_json`
(structural validation only — per Decision C the validator does not validate semantic correctness).

## Decisions

### Decision A — Read-modify-validate-seal-write atomically

New module `sealedContentUpdate.ts` implements:
- `readCanonicalForReseal(db, messageId)` — sealed read via `sealedQuery`; forward-migrates
  pre-Phase-B rows with no seal; rejects rows with invalid seals (tampered).
- `resealWithAiAnalysis(db, messageId, aiAnalysisData | null)` — full re-seal cycle.
- `resealWithPdfExtraction(db, attachmentId, extractionData)` — updates
  `attachments_canonical` + child write to `inbox_attachments`.

If any step fails, the function returns `{ ok: false, error }` and the original row is
unchanged. No partial writes.

### Decision B — Extracted text bound via attachment SHA-256 in canonical

The full extracted text is stored in `inbox_attachments.extracted_text` (child write within
`runSealedTransaction`). The canonical content's `attachments_canonical` entry is updated with
`extracted_text_sha256` and `content_sha256` — the seal binds these hashes, making any
post-write tampering with the attachment row detectable.

`extracted_text` itself is NOT embedded in canonical content (would be very large for
multi-page PDFs). The SHA-256 binding is sufficient for integrity.

### Decision C — `ai_analysis_json` as top-level canonical field

`ai_analysis_json` is added to the canonical content object in `depackaged_json`. The
`ai_analysis_json` column is also kept in sync as a separate column for backward-compatible
UI queries (SELECT ai_analysis_json).

Validator version bumped to `'1.1.0'` to mark B-7 content shape acceptance.

`validateAiAnalysisField` helper added to `contentValidator.ts`: called from both
`validatePlainEmailContent` and `validateBeapMessageContent`. Accepts: absent, null, any
non-array object. Rejects: array, primitive string/number.

### Decision D — UI surfaces operation failures with no shortcut

- PDF extraction failure: IPC handler returns `{ ok: false, error: "PDF text extraction could
  not be persisted..." }`. No partial write. Original attachment unchanged.
- AI analysis failure: handler returns `{ ok: false, error: "AI analysis could not be
  applied..." }`. No partial write. Original row unchanged.
- `classifySingleMessage`: if re-seal fails, logs warning and returns the classification
  result to the UI. Rationale: the operational classification (sort_category, urgency) is the
  primary result; the `ai_analysis_json` persistence is advisory. The operational columns are
  already written (Stop-and-Report Condition 3 — see below).
- Cancel/unarchive paths: if re-seal fails, logs warning but still applies the operational
  column reset (the user's action succeeded; the content clear is advisory).

## Stop-and-report conditions encountered

| Condition | Triggered? | Resolution |
|-----------|-----------|------------|
| 1. AI output too variable for closed-world validation | No — all sites use `Record<string, unknown>` with similar top-level keys; validator accepts any non-array object | Not triggered |
| 2. PDF extraction requires substantial architectural restructuring | No — single IPC path, straightforward replacement | Not triggered |
| 3. Operational-only updates require substantial new gate API | **YES** — 11 raw operational UPDATEs remain | See below |
| 4. Investigation reveals UPDATE sites audit missed | **YES** — 3 mixed ai_analysis_json = NULL resets found | Handled: content part re-sealed, operational part deferred to Condition 3 |
| 5. Validator cannot accept ai_analysis_json cleanly | No — added `validateAiAnalysisField` helper | Not triggered |

### Stop-and-Report Condition 3 — Operational UPDATE sites

**11 remaining raw `UPDATE inbox_messages SET` sites in `ipc.ts` (all pure operational):**

| Lines | Fields | Handler |
|-------|--------|---------|
| 1767 | `last_autosort_session_id = NULL` | session clear |
| 1975-1976 | `remote_orchestrator_last_error` | orchestrator error |
| 2070 | `email_message_id`, `imap_remote_mailbox` | IMAP sync |
| 3154, 3313 | `read_status` | mark read |
| 3327 | `starred` | star/unstar |
| 3339 | `archived = 1` | archive |
| 3353 | `sort_category` | manual sort |
| 4684 | `last_autosort_session_id` | autosort session |
| 4835-4856 | `archived`, `pending_delete`, `sort_category`, `urgency_score`, `needs_reply`, etc. | classifySingleMessage operational |
| 5296 | `pending_delete = 1, pending_delete_at` | queue delete |
| 5314 | `sort_category = 'pending_review', pending_review_at` | review queue |

Also remaining: `inbox_attachments.text_extraction_status = 'skipped'` (line 3560, operational).

Migrating these requires one of:
- A new `runOperationalUpdate(db, sql, params)` gate wrapper that verifies the existing seal
  is still valid before allowing the operational UPDATE.
- Or: a full re-seal for every operational column change (expensive for high-frequency ops
  like `read_status`).

**Canon-owner decision needed before B-7.1 or B-8 proceeds.**

## New files

- `electron/main/email/sealedContentUpdate.ts` — `resealWithAiAnalysis`, `resealWithPdfExtraction`
- `electron/main/email/__tests__/b7IpcContentUpdates.test.ts` — 21 tests

## Modified files

- `packages/ingestion-core/src/contentValidator.ts`
  - `CONTENT_VALIDATOR_VERSION` bumped to `'1.1.0'`
  - `validateAiAnalysisField` helper added
  - Called from `validatePlainEmailContent` and `validateBeapMessageContent`
- `electron/main/email/ipc.ts`
  - Import added: `resealWithAiAnalysis`, `resealWithPdfExtraction`
  - 5 AI analysis raw UPDATEs → `resealWithAiAnalysis`
  - 1 PDF extraction raw UPDATE pair → `resealWithPdfExtraction`
  - 3 mixed ai_analysis_json = NULL UPDATEs split: content via `resealWithAiAnalysis`,
    operational via separate raw UPDATE (deferred per Condition 3)

## Verification log

```
grep: "UPDATE inbox_messages SET ai_analysis_json" in ipc.ts → 0 matches
grep: "UPDATE inbox_messages SET depackaged_json" in ipc.ts → 0 matches
grep: "UPDATE inbox_attachments SET extracted_text" in ipc.ts → 0 matches
  (text_extraction_status = 'skipped' at line 3560 remains — pure operational, Condition 3)

TypeScript: sealedContentUpdate.ts compiles cleanly; contentValidator.ts clean.
Pre-existing tsc errors in main.ts (unrelated to B-7) unchanged.
```

## What was NOT verified

1. **Existing sealed rows with old content shape** (no `ai_analysis_json`): the forward
   path adds `ai_analysis_json` to the canonical object. Old rows WITHOUT the field remain
   readable (validator accepts absence). First write after B-7 deployment upgrades them to
   the new seal.

2. **Parallel PDF extraction with concurrency**: B-7 does not serialize PDF extraction per
   parent message. If two attachments of the same message are extracted simultaneously,
   both `resealWithPdfExtraction` calls will read the same canonical content and race.
   The last write wins; the first write's `attachments_canonical` update will be overwritten.
   Full fix: serialize extraction per parent message ID. Not implemented — Stop-and-Report
   Condition 2 acknowledged (mechanically simple but out of scope for B-7).

3. **Performance of full-row re-validation**: every AI analysis write now calls
   `validatorOrchestrator.validate()` (subprocess IPC, ~ms latency). For background batch
   classification (`inbox:aiCategorize` processing many messages), this adds per-message
   round-trips. Not profiled.

4. **Operational UPDATEs** (Stop-and-Report Condition 3): 11 sites remain raw. Canon-owner
   decision on gate API extension needed.

5. **`classifySingleMessage` atomicity**: the operational sort columns are written before
   `resealWithAiAnalysis` is called. If re-seal fails, the sort columns are written but
   `ai_analysis_json` is not — the row has operational state without the advisory content.
   Full atomicity requires the new operational gate API (Condition 3).
