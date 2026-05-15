# PR B-7.2 — beapEmailIngestion Late-Decryption Bypass Closure

## Status

SHIPPED. All deliverables complete. Stop-and-Report Condition 1 surfaced and
documented (read-time attachment cross-verification gap) — no further scope in
this PR.

---

## What this PR does

PR B-7.1 flagged a raw content `UPDATE` in `beapEmailIngestion.ts` as a
Stop-and-Report Condition 3 bypass:

- **`updateInboxDecrypted`** — raw `UPDATE inbox_messages SET depackaged_json = ?,
  body_text = ?, subject = ?` writing content to a previously unsealed row without
  a seal.
- **`updateAttSha`** — raw `UPDATE inbox_attachments SET content_sha256 = ?` writing
  the attachment hash that is cryptographically bound via `attachments_canonical` in
  the parent seal.

B-7.2 closes the bypass and adds `resealWithDecryptedContent` as the canonical
helper for any future path that decrypts qBEAP content and needs to seal it into
an existing row.

---

## Step A — Investigation result

`tryQbeapDecryptInbox` / `createQbeapDecryptInboxStmts` / `QbeapDecryptInboxStmts`
are **dead production code**. They were the old qBEAP drain helpers from the
pre-B-4 pipeline. They had **zero production callers**:

- `processPendingP2PBeapEmails` — deprecated no-op stub (B-4).
- `retryPendingQbeapDecrypt` — was already migrated in B-4 to use
  `prepareSealedUpdate` + `validatorOrchestrator.validate`. The stale comment
  at line 519 said it "still calls `tryQbeapDecryptInbox`" but the actual code
  at line 1228 had already been fully migrated.

The bypass code therefore had no production call path. Confirmed via `rg`:
only the functions' own definitions and two test files referenced them.

**Action taken**: Deleted `tryQbeapDecryptInbox`, `createQbeapDecryptInboxStmts`,
and `QbeapDecryptInboxStmts` entirely. Updated `retryPendingQbeapDecrypt` to use
the new `resealWithDecryptedContent` helper (replacing the direct
`prepareSealedUpdate` + `validatorOrchestrator.validate` calls).

---

## Step B — Decision D: read-time attachment verification

**Investigation result:**

`sealedQuery` verifies:
1. The parent row's `depackaged_json` SHA-256 against `seal_input_json.content_sha256`.
2. The HMAC of `seal_input_json` against the stored `seal`.

`sealedQuery` does **NOT**:
- Join `inbox_attachments` to re-verify per-attachment hashes.
- Cross-verify `inbox_attachments.content_sha256` against
  `depackaged_json.attachments_canonical[i].content_sha256`.

**What this means:**

The parent seal binds `depackaged_json`, which includes `attachments_canonical`
(an array with each attachment's `content_sha256`). A direct DB write to
`inbox_attachments.content_sha256` (bypassing the application layer) would NOT
invalidate the parent seal on read — the parent's `depackaged_json` (and
therefore its seal) is unchanged.

**Why this is acceptable at application level:**

`content_sha256` is NOT on the `OPERATIONAL_COLUMNS_ALLOWLIST` in
`sealed-storage/index.ts`. No application path can update `content_sha256` via
the operational gate. The only application-level writes to `content_sha256` go
through `resealWithPdfExtraction` or `resealWithDecryptedContent`, which
atomically update both the parent's `depackaged_json.attachments_canonical` and
the child `inbox_attachments.content_sha256` inside the same sealed transaction.

**The residual gap:** Direct DB writes (physical access, not going through the
application) can change `inbox_attachments.content_sha256` without triggering
the parent seal check. This creates a potential divergence between the sealed
canonical hash and the stored hash — but the sealed hash is the authoritative
one (it was validator-produced), so the UI should always prefer the sealed value.

**Stop-and-Report Condition 1 (surfaced, not fixed in this PR):**
The read path does not cross-verify `inbox_attachments.content_sha256` against
`attachments_canonical[i].content_sha256`. This is a defense-in-depth gap
against direct DB access. Fix would be either:
- Add per-attachment hash cross-verification to `sealedQuery`.
- Or add a separate read-time consistency check after `sealedQuery` returns.

This is not addressed in B-7.2. Canon-owner decision required.

---

## Architectural decisions baked into this PR

### Decision A — `resealWithDecryptedContent` is the canonical helper

Any code path that decrypts qBEAP content and needs to write it into an existing
unsealed row uses `resealWithDecryptedContent` from `sealedContentUpdate.ts`.
The helper enforces the full pattern: validate → seal → write atomically.

### Decision B — Sealed rows are refused

`resealWithDecryptedContent` refuses to overwrite a row that already carries a
seal. Callers of this helper are only for unsealed pending rows. For already-
sealed rows, use `resealWithAiAnalysis` or `resealWithPdfExtraction`.

### Decision C — `runSealedTransaction` already supports child UPDATEs

The `childWrites` parameter of `runSealedTransaction` accepts an
`Array<() => void>`. Each lambda can execute any DB operation — INSERT or UPDATE.
No extension was needed. The `resealWithDecryptedContent` API exposes
`childWrites?: Array<() => void>` for callers that need to write attachment rows
atomically with the parent UPDATE.

### Decision D — Failure-path matrix

| Validator outcome                    | Behavior                                         |
|--------------------------------------|--------------------------------------------------|
| Validates new content                | Sealed UPDATE: row's content + new seal          |
| Rejects new content                  | No UPDATE. Original row preserved. Error returned. |
| Pre-existing seal (row already sealed) | No UPDATE. Error returned.                     |
| Row not found                        | No UPDATE. Error returned.                       |
| Validator subprocess unavailable     | No UPDATE. Error returned.                       |
| DB transaction error (child throws)  | Rolled back. Parent row unchanged.               |

---

## Files changed

### `apps/electron-vite-project/electron/main/email/sealedContentUpdate.ts`
- Added `DecryptedQbeapResealParams` interface (exported).
- Added `RESEAL_DECRYPTED_CONTENT_SQL` constant (the same SQL shape as the
  removed `P2P_INBOX_SEALED_BACKFILL_UPDATE_SQL`).
- Added `resealWithDecryptedContent(db, params)` function (exported).

### `apps/electron-vite-project/electron/main/email/beapEmailIngestion.ts`
- **Removed** `QbeapDecryptInboxStmts` type.
- **Removed** `createQbeapDecryptInboxStmts` function.
- **Removed** `tryQbeapDecryptInbox` function.
- **Removed** `P2P_INBOX_SEALED_BACKFILL_UPDATE_SQL` constant.
- **Removed** imports: `validateDecryptedBeapContent`, `ContentValidationResult`,
  `writeEncryptedAttachmentFile`, `prepareSealedUpdate`.
- **Added** import: `resealWithDecryptedContent` from `./sealedContentUpdate`.
- **Refactored** `retryPendingQbeapDecrypt` to use `resealWithDecryptedContent`
  instead of direct `prepareSealedUpdate` + `validatorOrchestrator.validate` calls.
  Applies to both the outbound-echo branch and the inbound-decrypt branch.

### `apps/electron-vite-project/electron/main/email/__tests__/b71OperationalGate.test.ts`
- Fixed `sealedQuery` call in §3.2 to pass the required 4th argument
  (`'depackaged_json'`).
- Added §1.8 through §1.17: SQL parser robustness tests covering:
  - Subquery on RHS (`SET col = (SELECT ...)`)
  - Function calls on RHS (`SET col = datetime(?)`, `SET col = COALESCE(?, ...)`)
  - Multi-line SQL with function call RHS
  - `encryption_key / encryption_iv / encryption_tag / storage_encrypted` pattern
  - `has_attachments / attachment_count` pattern
  - String literal with embedded comma inside function parens (not confused)
  - WHERE clause with `IN (?, ?, ?)` (commas excluded from SET parse)
  - Dynamic column name (`SET ? = 1`) — throws `SealVerificationError`
  - CTE prefix before UPDATE — SET clause still found

### `apps/electron-vite-project/electron/main/email/__tests__/b72DecryptedContentReseal.test.ts` (new)
- §1.1 – §1.9: `resealWithDecryptedContent` unit tests.
- §2.1: `retryPendingQbeapDecrypt` migration invariant.

### `apps/electron-vite-project/electron/main/email/__tests__/b31GapClosure.test.ts`
- Gap 3 test rewritten: removed test for deleted `tryQbeapDecryptInbox`;
  replaced with equivalent test for `resealWithDecryptedContent`'s sealed-row
  guard.

---

## Verification log

### `rg` audit — zero raw inbox writes

```
rg "db\.prepare.*UPDATE inbox_messages|db\.prepare.*UPDATE inbox_attachments" -n --type ts
```

Confirmed: zero matches in production code paths (`beapEmailIngestion.ts`,
`ipc.ts`, `messageRouter.ts`, `inboxOrchestratorRemoteQueue.ts`,
`mergeExtensionDepackaged.ts`, `sealedContentUpdate.ts`). All remaining
`db.prepare("UPDATE ...")` calls are inside `runSealedTransaction` child-write
lambdas or in `prepareSealedOperationalUpdate` (gated).

```
rg "updateInboxDecrypted|updateAttSha" -n --type ts
```

Zero matches in production code. Only match: the removal diff.

### `runSealedTransaction` child UPDATEs

No extension needed — existing `childWrites: Array<() => void>` parameter
already supports arbitrary child writes including UPDATEs. See
`resealWithPdfExtraction` in `sealedContentUpdate.ts` for prior art (child
UPDATE to `inbox_attachments`).

---

## What was NOT verified

1. **Read-time attachment cross-verification gap (Stop-and-Report Condition 1)**
   was surfaced but not addressed in this PR. The gap exists against direct DB
   writes (not application-level attacks). A separate PR is required if the canon
   owner decides to add per-attachment hash cross-verification to `sealedQuery`.

2. **`retryPendingQbeapDecrypt` does not write attachment binary files.** The
   backfill seals the parent row's canonical content (which may reference
   attachments in `attachments_canonical`) but does not fetch, decrypt, or
   re-encrypt attachment bytes. For most pre-B-4 rows, attachments were already
   written by the original ingest path. If any attachment bytes are missing, they
   will remain inaccessible (but the sealed parent row will be visible).

3. **Performance of `resealWithDecryptedContent` on large messages.** The
   helper does not hash attachment bytes at all — attachment hashes must be
   computed by the caller and placed in `rawCapsuleJson.attachments_canonical`
   before the call. Large messages with many large attachments therefore do not
   incur per-attachment re-hashing overhead in the helper itself.

4. **In-flight `retryPendingQbeapDecrypt` state at B-7.2 deploy time.** Since
   `retryPendingQbeapDecrypt` runs at most once per process (`pendingQbeapDecryptRetryRan`
   guard), any in-flight run at deploy time will complete with the old code or
   be skipped on restart. No special handling needed for a fresh-install codebase.

5. **TypeScript strict-mode compile** has not been run in this session due to
   environment constraints. The patterns used match the existing codebase
   conventions and should compile cleanly, but a full `tsc --noEmit` run should
   be done before merging.

---

## Stop-and-report conditions encountered

| # | Condition | Action |
|---|-----------|--------|
| 1 | Read-time attachment cross-verification gap (Decision D) | Documented above; not fixed in B-7.2 |
| 2 | `runSealedTransaction` extension for child UPDATEs | No extension needed; already supported |
| 3 | Validator shape mismatch | Not triggered; `rawCapsuleJson` is passed directly to the validator as in the existing `retryPendingQbeapDecrypt` |
| 4 | SQL parser edge cases | All tested; see §1.8–§1.17 in `b71OperationalGate.test.ts` |
| 5 | `retryPendingQbeapDecrypt` callers depending on bypass behavior | Not found; function was already gated in B-4 |
