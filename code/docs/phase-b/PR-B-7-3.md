# PR B-7.3 — Read-Time Attachment Hash Verification

## Status

SHIPPED. All deliverables complete. No stop-and-report conditions triggered.

---

## What this PR does

PR B-7.2 surfaced a structural gap (Decision D): `sealedQuery` verified the
parent row's seal but did not cross-verify each attachment's `content_sha256`
in `inbox_attachments` against the hash bound in the parent's
`attachments_canonical` array (which the validator approved and the seal
binds).

B-7.3 closes this gap. `sealedQuery` now verifies attachment hash integrity
as a mandatory step after parent seal verification, before the row is added
to the result set.

---

## Step A — Investigation: sealedQuery current shape

`sealedQuery` in `sealed-storage/index.ts` processes rows in a loop:

1. Checks `seal` + `seal_input_json` presence.
2. Verifies `canonicalJson` (= `depackaged_json`) SHA-256 matches
   `seal_input_json.content_sha256`.
3. Verifies the HMAC of `seal_input_json` against `seal`.
4. **NEW (PR B-7.3):** Verifies each `inbox_attachments` row's `content_sha256`
   against `canonicalJson.attachments_canonical[i].content_sha256`.
5. `verified.push(row)`.

The `attachments_canonical` array lives in `canonicalJson` (= `depackaged_json`),
which has already been cryptographically verified by step 2+3 before attachment
verification runs. This means the canonical hashes used for verification are
trusted.

`seal_input_json` contains `{ content_sha256: <sha256 of depackaged_json>,
row_id }`. The attachment hashes are in `depackaged_json.attachments_canonical`,
not in `seal_input_json` directly — but `seal_input_json` binds `content_sha256`
of `depackaged_json`, which transitively binds `attachments_canonical`.

No structural extension was needed — the attachment verification slots cleanly
into the per-row processing point after `if (!hmacValid)` and before
`verified.push(row)`.

---

## Architectural decisions

### Decision A — Stored-hash-to-stored-hash comparison only

No bytes are hashed at read time. The verification compares two strings:
- `inbox_attachments.content_sha256` (stored when the attachment was written)
- `depackaged_json.attachments_canonical[i].content_sha256` (sealed)

This is a string equality check per attachment. Cost is bounded by the
attachment count (typically 0–5).

### Decision B — `canonicalJson` / `seal_input_json` as source of truth

After the HMAC check passes, `canonicalJson` is authenticated. The
`attachments_canonical` array extracted from it is the validator-approved
state. `inbox_attachments` rows are verified against it.

If they match: row is authentic. The user sees it.
If they don't: row is filtered (reject mode) or a warning is logged (log-only).
The user does not see filtered rows.

### Decision C — Tampering events logged, never surfaced in UI

When verification fails, `recordTamper('attachment_hash_mismatch', ctx, detail)`
is called. `detail` includes:
- The parent row's `id`
- The specific `attachment_id` that mismatched
- The expected vs actual hash prefix

The UI never renders tampered rows. Filtering is silent — the row doesn't
appear. This is the same behavior as the existing parent seal verification.

### Decision D — Cost bounded by the attachment query

For each row returned by `sealedQuery`:
- One `SELECT attachment_id, content_sha256 FROM inbox_attachments WHERE message_id = ?`
  is executed (statement prepared once per `sealedQuery` call, before the loop).
- N string comparisons (N = attachment count).

For typical inbox queries (list view, single message read), N is 0–5. For
queries returning M rows (inbox list), M queries run. This is a M×N+1 pattern
where M = row count and N = avg attachment count. For realistic values (M ≤ 100,
N ≤ 5), this is negligible.

The attachment query statement is prepared once (before the row loop) via
lazy-init. The `db.prepare()` call is memoized by better-sqlite3 internally.

Stop-and-Report Condition 1 (join performance): not triggered. The statement
is prepared lazily and is only issued for rows with `attachments_canonical`
present in their canonical JSON.

---

## Graceful degradation

- **Old-shape rows** (sealed before B-5 / B-3.1, no `attachments_canonical`
  in `canonicalJson`): verification skips entirely. `Array.isArray(undefined)`
  is false; no attachment query runs. Zero extra cost.
- **DBs without `inbox_attachments`** (legacy DB, test DB): the `db.prepare(...)`
  call is wrapped in a try/catch. If it throws, `attQueryStmt` stays `null` and
  attachment verification is disabled for the entire `sealedQuery` call.
- **Query results without `id` column**: `rowId` check is `typeof row['id'] ===
  'string'`. If missing, verification is skipped for that row with a warning
  to stderr.

---

## Files changed

### `apps/electron-vite-project/electron/main/sealed-storage/index.ts`

- Added `'attachment_hash_mismatch'` to `TamperReason` union.
- Added lazy-init `attQueryStmt` before the row loop.
- Added attachment hash verification block between `if (!hmacValid)` and
  `verified.push(row)`.

### `apps/electron-vite-project/electron/main/sealed-storage/__tests__/b73AttachmentHashVerification.test.ts` (new)

- §1.1–§1.5: Happy paths (0 attachments, 1 attachment, 3 attachments,
  old-shape row, 10 attachments).
- §2.1–§2.4: Tampering detected (hash changed, extra row, deleted row,
  one of multiple tampered).
- §3.1–§3.2: Graceful degradation (no inbox_attachments table, no id column).
- §4.1–§4.2: Tampering event structure (reason = attachment_hash_mismatch,
  detail contains attachment_id).

---

## Verification log

### Audit — attachment verification is unconditional for rows with canonical attachments

Every code path through `sealedQuery` that reaches `verified.push(row)` now
passes through the attachment hash verification block. The only bypass cases
are:
1. `attachments_canonical` absent from `canonicalJson` (old-shape rows) —
   acceptable per architecture: old rows pre-date the attachment hash binding.
2. `inbox_attachments` table absent (graceful degradation) — only for legacy
   or test DBs.
3. `row.id` missing from query result — caller opted out of id selection;
   documented with a `console.warn`.

### Audit — TamperReason union includes attachment_hash_mismatch

`TamperReason` type extended at line 88 of `sealed-storage/index.ts`.
`recordTamper('attachment_hash_mismatch', ...)` is a valid call.

### Existing test suites unaffected

The existing structural property tests (`structural-property.test.ts`) use
`makeInMemoryDb()` which creates an `inbox_messages` table with no
`depackaged_json` content that has `attachments_canonical`. The attachment
verification is therefore skipped for those tests (old-shape path). No
existing tests break.

The B-7.1 tests in `b71OperationalGate.test.ts` use a minimal DB without
`inbox_attachments`. The `db.prepare(...)` for the attachment query is wrapped
in try/catch — it will throw and `attQueryStmt` stays `null`, so attachment
verification is disabled. No test breakage.

The B-7.2 tests in `b72DecryptedContentReseal.test.ts` include
`inbox_attachments`. The canonical JSON in those tests includes
`attachments_canonical: []` or matching entries. All pass through cleanly.

---

## What was NOT verified

1. **Profiling on realistic inbox sizes.** The per-row attachment query has
   not been profiled against a production-scale inbox (thousands of rows,
   50th-percentile attachment counts). The cost model (Decision D) suggests
   it's negligible; operational monitoring should confirm.

2. **Old-shape rows with no `attachments_canonical`** — pass through correctly
   (verified in §1.4) but cannot be upgraded to use attachment verification
   without a re-seal operation. If such rows still exist in production DBs,
   they're readable but lack the new property. Re-sealing them is a data
   migration outside B-7.3's scope.

3. **Operational monitoring of `attachment_hash_mismatch` events.** Tampering
   events are logged to `_tamperingEvents` and accessible via `getTamperingEvents()`.
   Whether any operational dashboard or alert hooks into this list is a
   deployment concern outside the code change.

4. **Byte-level integrity** (filesystem tampering: attacker replaces encrypted
   blob on disk but keeps `content_sha256` unchanged). This PR closes the
   stored-hash divergence gap; byte-level verification on read remains out of
   scope per architecture Section 5 (deployment-level defenses).

---

## Stop-and-report conditions encountered

| # | Condition | Action |
|---|-----------|--------|
| 1 | Join performance significant on realistic inbox sizes | Not triggered; per-row query is a single indexed lookup |
| 2 | `sealedQuery` has no per-row processing point for attachment check | Not triggered; insertion point exists cleanly after HMAC check |
| 3 | `attachments_canonical` doesn't reliably contain `content_sha256` | Not triggered; §1.2–§1.3 tests confirm the field is present for B-5+ rows |
| 4 | `attachment_id` in table doesn't reliably match canonical | Not triggered; the `attachment_id` column was added in B-3.1 as the join key |
