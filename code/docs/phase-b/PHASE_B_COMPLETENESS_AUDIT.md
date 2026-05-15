# Phase B Completeness Audit

**Canonical regression prompt for the sealed-storage structural property.**

Run this audit after any change to:
- `apps/electron-vite-project/electron/main/email/` (any inbound or content path)
- `apps/electron-vite-project/electron/main/sealed-storage/` (gate implementation)
- `eslint.config.mjs` (lint rules)

Last full run: **B-11 closure — 2026-05-14**
Status at last run: **Section 2 EMPTY — structural property fully enforced.**

---

## Section 1 — Structural property checks

The canon directive: *every BEAP message type passes Ingestor and Validator no matter
where it lands; any bypass is a defect.*

For each check below, grep the production path (excluding `__tests__/`, `test/`,
and `sealed-storage/`) and confirm the property holds.

### 1.1 — Inbound path: IMAP (`beapEmailIngestion.ts`)

- [ ] Entry point calls `processBeapPackageInline` (or equivalent canonical ingestor).
- [ ] `processBeapPackageInline` calls `validatorOrchestrator.validate` before write.
- [ ] INSERT into `inbox_messages` uses `prepareSealedInsert` / `runSealedTransaction`.
- [ ] INSERT into `quarantine_messages` uses `prepareSealedInsert` / `runSealedTransaction`.
- [ ] No raw `db.prepare('INSERT INTO inbox_messages ...')` in `beapEmailIngestion.ts`.

**B-1/B-2 status:** PASS at B-11 closure.

### 1.2 — Inbound path: P2P relay (`messageRouter.ts`)

- [ ] P2P relay calls `processBeapPackageInline`.
- [ ] `processBeapPackageInline` enforces Ingestor + Validator gate.
- [ ] INSERT into `inbox_messages` uses `prepareSealedInsert` / `runSealedTransaction`.
- [ ] No raw `db.prepare('INSERT INTO inbox_messages ...')` in the P2P relay path.

**B-4 status:** PASS at B-11 closure.

### 1.3 — Inbound path: Extension Stage-5 (`mergeExtensionDepackaged.ts`)

- [ ] Extension depackage calls `validatorOrchestrator.validate` before any write.
- [ ] INSERT into `quarantine_messages` (when quarantined) uses `prepareSealedInsert`.
- [ ] Reseal of `inbox_messages` (when allowed) uses `prepareSealedUpdate` or the
     reseal helper; does not raw-insert a new content row.
- [ ] No raw `db.prepare('INSERT INTO inbox_messages ...')` in `mergeExtensionDepackaged.ts`.
- [ ] `has_attachments` / `attachment_count` updates use `prepareSealedOperationalUpdate`.

**B-5 status:** PASS at B-11 closure.

### 1.4 — Content update paths

#### IPC PDF text extraction (`sealedContentUpdate.ts`)
- [ ] `resealWithPdfExtraction` reads existing row via `db.prepare('SELECT seal ...')`
     (pre-check only; no content propagation from raw read).
- [ ] Write path uses `prepareSealedUpdate` (reseal with extracted text in seal).
- [ ] No raw UPDATE that sets `body_text` or `depackaged_json`.

**B-7.2 status:** PASS at B-11 closure.

#### IPC AI analysis (`sealedContentUpdate.ts`)
- [ ] `resealWithAiAnalysis` uses `prepareSealedUpdate` (reseal with AI result in seal).
- [ ] No raw UPDATE that sets content columns.

**B-7.2 status:** PASS at B-11 closure.

#### Late qBEAP decryption (`retryPendingQbeapDecrypt`)
- [ ] Decryption re-seals via `prepareSealedUpdate` or `runSealedTransaction`.
- [ ] No raw UPDATE that replaces `depackaged_json` or `body_text`.

**B-7 status:** PASS at B-11 closure.

### 1.5 — Attachment hash verification (B-7.3)

- [ ] `sealedQuery` verifies `attachments_canonical` hash list against actual attachment
     rows before returning content to callers.
- [ ] `prepareSealedInsert` / `runSealedTransaction` include `attachments_canonical` in
     the seal input JSON when `has_attachments = 1`.
- [ ] `prepareSealedUpdate` (reseal) recalculates `attachments_canonical` from current
     attachment rows before sealing.

**B-7.3 status:** PASS at B-11 closure.

### 1.6 — Operational gate: allowlist enforcement (B-7.1)

- [ ] `OPERATIONAL_COLUMNS_ALLOWLIST` in `sealed-storage/index.ts` contains all columns
     that are updated via `prepareSealedOperationalUpdate`.
- [ ] Any new operational column added to the allowlist has a corresponding PR comment
     from canon owner confirming it is non-content.
- [ ] `beap-canon/no-raw-inbox-write` lint rule reports zero errors on:
     `pnpm lint -- apps/electron-vite-project/electron/main/email/`

**B-7.1 / B-11 status:** PASS at B-11 closure. Allowlist additions in B-11:
`lifecycle_exited_review_utc`, `lifecycle_final_delete_queued_utc`,
`lifecycle_remote_delete_skip_reason`, `deleted`, `deleted_at`, `purge_after`,
`remote_deleted`, `remote_deleted_at`.

### 1.7 — Renderer-as-mirror property (B-8)

- [ ] No IPC handler writes content columns directly in response to a renderer request.
- [ ] All renderer-triggered content writes go through the sealed-storage gate
     (reseal helpers, operational update, or a queued background job).
- [ ] Renderer-facing read handlers (`getMessage`, `listMessages`, etc.) do not
     propagate their returned content into a new sealed row.

**B-8 status:** PASS at B-11 closure.

### 1.8 — Outbound clone path (B-9)

- [ ] `prepareBeapInboxSandboxClone` reads source `inbox_messages` row via `sealedQuery`
     (seal verification + attachment hash check before clone payload construction).
- [ ] No raw `db.prepare('SELECT ... FROM inbox_messages ...')` in
     `beapInboxClonePrepare.ts`.
- [ ] Clone preparation is read-only (no INSERT or UPDATE to `inbox_messages` on host).
- [ ] Clone payload is the encrypted blob for sandbox; host tracks clone via
     operational column `cloned_to_sandbox_at` (or equivalent).

**B-9 status:** PASS at B-11 closure.

---

## Section 2 — Real bypasses

**Status at B-11 closure: EMPTY.**

Any entry here means Phase B's structural property is not fully enforced and the PR
cannot be merged without a fix or an explicit canon owner deferral.

| Bypass | File | Line | Status |
|--------|------|------|--------|
| *(none)* | | | |

---

## Section 3 — Warnings (non-critical, tracked)

The following items are lint warnings (`beap-canon/no-raw-inbox-select`). They represent
raw `db.prepare(SELECT ...)` reads on `inbox_messages` or `quarantine_messages` that
skip seal verification. They are non-critical because the reads return content to the
renderer (UI display only) and do not propagate that content into new sealed rows.

Migration to `sealedQuery()` is tracked in `PHASE_B_DEFERRED_ITEMS.md`.

| File | Approximate count | Nature |
|------|-------------------|--------|
| `email/ipc.ts` | ~20 | getMessage, listMessages, toggleStar, getQuarantineMessages, etc. |
| `email/inboxOrchestratorRemoteQueue.ts` | ~2 | Queue batch reads |
| `email/sealedContentUpdate.ts` | ~1 | Seal-status pre-check |
| `email/remoteDeletion.ts` | ~1 | Deletion queue join read |
| `email/dashboardSnapshot.ts` | ~2 | Snapshot reads |

---

## Section 4 — CI lint rule verification

Run: `pnpm lint -- apps/electron-vite-project/electron/main/email/`

Expected output at B-11 closure:
- Zero `beap-canon/no-raw-inbox-write` errors.
- N `beap-canon/no-raw-inbox-select` warnings (tracked in Section 3).

To verify the rule catches deliberate bypasses:
1. Temporarily add to any production file (not in `__tests__/`):
   ```typescript
   db.prepare('INSERT INTO inbox_messages (id) VALUES (?)')
   ```
2. Run `pnpm lint`. Confirm error: `beap-canon/no-raw-inbox-write`.
3. Remove the line. Confirm clean run.

---

## Section 5 — Deferred items

Per `PHASE_B_DEFERRED_ITEMS.md`:

- **B-10 UI work** — renderer info box, sandbox setup button, quarantine indicators.
- **QB_09 retry diagnostic** — fetch call count under timer advancement.
- **Category 3 legacy failures** — inference routing correctness (~7 tests, 4 suites).
- **TypeScript debt** — 327 + 153 errors, pre-existing legacy.
- **Buffer-restart recovery** — extension Stage-5 in-memory retry buffer.
- **Raw SELECT migrations** — `sealedQuery` backlog (~26 sites, warn-only).

---

## Section 6 — Test suite signal

At B-11 closure:

```
Test Files: 4 failed | 326 passed (330)
Tests:      10 failed | 4175 passed | 9 skipped | 29 todo
```

Known/expected failures:
- QB_09 (`outboundQueue.backoff.test.ts`): 1 test — retry count diagnostic deferred.
- Category 3 inference (`hostAiRoutingCorrectness`, `internalInferenceService`,
  `internalInference.directHost`): 9 tests — pre-Phase-B legacy.

No structural regressions in the sealed-storage surface.

---

## How to run this audit

1. `pnpm lint` — confirm `beap-canon/no-raw-inbox-write` reports zero errors.
2. `pnpm exec vitest run` — confirm ~10 failures, same files as above.
3. For each check in Section 1, grep the relevant file or read the production code.
4. Update Section 2 if any bypass is found. Section 2 must be empty before merging.
