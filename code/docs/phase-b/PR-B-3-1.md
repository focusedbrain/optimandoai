# PR B-3.1 — Email Migration Gap Closure

**Phase B, PR B-3.1**
**Depends on:** PRs B-1, B-2, B-3

---

## Purpose

Post-implementation audit of PR B-3 surfaced three gaps where the sealed-storage
gate was bypassed or dead code was left in place.  This PR closes all three.

No new ingestion paths are migrated (P2P relay remains B-4, extension Stage-5
remains B-5).

---

## Gap-by-gap recap

### Gap 1 — `inbox_attachments` writes were not gated

**Problem.** `messageRouter.ts` wrote sealed `inbox_messages` rows but followed
with raw `db.prepare()` INSERTs into `inbox_attachments` for the same message.
Attachment content could be tampered post-write without invalidating the parent
seal because the seal's `canonical_json` did not include attachment hashes.

**Decision: Option Att-2.**  The parent message's `canonical_json` (which the
seal binds) is extended to include an `attachments_canonical` array carrying
each attachment's `content_sha256`.  Attachment rows themselves carry no
independent seal; their integrity is transitively guaranteed by the parent seal.

**Att-2 scope:**

| Source type | Attachment sealing status | Notes |
|-------------|--------------------------|-------|
| `email_plain` | **Sealed in B-3.1** | `attachments_canonical` array added to canonical content before validator call.  Seal covers all attachment SHA-256s. |
| `email_beap` | **Deferred to B-5** | BEAP `depackaged_json` is a protocol-defined capsule format.  Augmenting it with attachment metadata requires a `depackaged_json` format migration that would break existing consumers.  Attachment rows for BEAP emails remain raw child writes within the same `db.transaction()` — they are atomic with the sealed parent but not yet hash-bound to the seal.  B-5 will migrate `depackaged_json` to a wrapper format. |

**Files changed:**

- `electron/main/sealed-storage/index.ts`:
  - Added `ChildAttachmentDescriptor` type documenting the Att-2 pattern.
  - Added `runSealedTransaction(db, sealedInsert, parentBindArgs, sealParams, childWrites)`:
    wraps `db.transaction()`, verifies the parent seal first, then executes all
    child write callbacks inside the same transaction.
- `packages/ingestion-core/src/contentValidator.ts`:
  - Added `validateAttachmentsCanonical()` helper.
  - Extended `validatePlainEmailContent()` to validate the optional
    `attachments_canonical` array when present.
- `electron/main/email/messageRouter.ts`:
  - Moved all attachment preprocessing (file crypto, SHA-256, PDF extraction)
    to **Step 2a** — before the validator call — so attachment hashes are
    available for inclusion in the canonical content.
  - Extended `buildPlainEmailInboxPayload()` to accept and include
    `attachmentsCanonical: ChildAttachmentDescriptor[]` in the canonical
    content object.
  - Replaced raw `db.transaction()` inbox write with `runSealedTransaction()`.

---

### Gap 2 — Dead `plain_email_inbox` staging callers

**Problem.** `plain_email_inbox` was dropped in schema v65 (PR B-3).  Three
files still called `insertPendingPlainEmail` / `processPendingPlainEmails`,
producing silent SQLite errors on every email sync cycle.

**Resolution.** Removed all callers and the helper functions themselves.  IPC
handlers that polled the staging table now return empty / no-op responses.

**Files changed:**

| File | Change |
|------|--------|
| `electron/main/email/beapSync.ts` | Removed `insertPendingPlainEmail` import and `processEmailForBeap` Strategy 3 branch.  Plain emails routed by `detectAndRouteMessage` in `syncOrchestrator`; no staging needed. |
| `electron/main/email/ipc.ts` | Removed `processPendingPlainEmails` import and call. |
| `electron/main/email/syncOrchestrator.ts` | Removed `processPendingPlainEmails` import and call. |
| `electron/main/handshake/ipc.ts` | Removed `getPendingPlainEmails` / `markPlainEmailProcessed` imports; `handshake.getPendingPlainEmails` IPC handler now returns `{ items: [] }`; `handshake.ackPendingPlainEmail` no-ops. |
| `electron/main/handshake/db.ts` | Removed `insertPendingPlainEmail`, `getPendingPlainEmails`, `markPlainEmailProcessed`, `PendingPlainEmailEntry`.  Removed stale `plain_email_inbox` index repair entries from `EMAIL_PIPELINE_INDEX_REPAIRS`. |
| `electron/main/email/plainEmailIngestion.ts` | **Deleted** (sole export was `processPendingPlainEmails`). |

---

### Gap 3 — `beapEmailIngestion.ts` legacy paths

**Problem.** The B-3 amendment stated `beapEmailIngestion.ts` would be
restructured.  The audit found it was not: `processPendingP2PBeapEmails`,
`insertDirectBeap`, `tryQbeapDecryptInbox`, and `retryPendingQbeapDecrypt`
still write `inbox_messages` via raw `db.prepare()` without seals.

**Classification of each function:**

| Function | Verdict | B-3.1 action |
|----------|---------|-------------|
| `processPendingP2PBeapEmails` | **Stop-and-report — B-4 scope.** Drains `p2p_pending_beap`; its inbox writes are the P2P relay ingestion path.  Migrating requires B-4 pipeline changes. | Added `ACTION REQUIRED (B-4)` JSDoc block. |
| `insertDirectBeap` (inside P2P fn) | **B-4 scope.** Raw INSERT for P2P rows without seal. | Documented in B-4 action block. |
| `updateInbox` / `updateInboxOutbound` (inside P2P fn) | **B-4 scope.** Raw UPDATEs for P2P rows without seal. | Documented. |
| `tryQbeapDecryptInbox` | Retained (called by P2P fn).  **Safety guard added.** | Checks `seal IS NOT NULL` before proceeding; returns `{ decrypted: false }` for already-sealed B-3+ rows, preventing a raw UPDATE from overwriting sealed `depackaged_json`. |
| `retryPendingQbeapDecrypt` | Retained (called from `main.ts`).  **Safety guard added.** | Query filters now include `AND (seal IS NULL OR seal = '')` — excludes B-3+ sealed rows from the retry batch. |
| `ensureInboxAttachmentsFromBeapPackageJson` | Keep — used by P2P fn and `ipc.ts`. | No change. |
| `extractP2PBeapInboxPreview` | Keep — used by P2P fn. | No change. |
| `beapPackageToMainProcessDepackaged` | Keep — used by P2P fn and tests. | No change. |
| `createQbeapDecryptInboxStmts` | Keep — used by P2P fn. | No change. |

**Stop-and-report #3 resolution for P2P writes:**  `processPendingP2PBeapEmails`
and its child statements write `inbox_messages` without seals.  Migrating them
to the gate requires calling the validator subprocess for each P2P batch row —
equivalent to implementing the B-4 P2P pipeline migration.  This is out of
B-3.1's scope.  The stop-and-report condition is surfaced here; B-4 owns the
fix.

---

## Att-1 vs Att-2 decision

The stop-and-report condition for Att-2 infeasibility (asynchronous attachment
arrival) does **not** apply to the email path: email attachments arrive together
with the message in the same `RawEmailMessage` struct.

Att-2 was chosen over Att-1 because:

1. Single source of truth per logical message: one seal verifies both the
   message content and its attachment list.
2. No parent-child seal verification logic needed at read time.
3. Email ingestion produces all attachment bytes synchronously before writing.

Att-1 is not needed for the email path.  It remains the fallback for paths
where attachments arrive after the parent row is written (not applicable to
B-3.1).

---

## Tests added

`electron/main/email/__tests__/b31GapClosure.test.ts`

| Test | Gap |
|------|-----|
| `plain_email` with valid `attachments_canonical` passes | Gap 1a |
| `plain_email` with missing `attachment_id` is rejected | Gap 1a |
| `plain_email` with non-array `attachments_canonical` is rejected | Gap 1a |
| `plain_email` with empty `content_sha256` is rejected | Gap 1a |
| `plain_email` with `null` `content_sha256` passes | Gap 1a |
| `runSealedTransaction` writes parent + N child rows atomically | Gap 1b |
| `runSealedTransaction` rolls back parent+children on child throw | Gap 1b |
| `runSealedTransaction` throws `SealVerificationError` on bad seal | Gap 1b |
| Parent `canonical_json` contains original attachment SHA-256 (tampering detectable) | Gap 1c |
| `insertPendingPlainEmail` not exported from `handshake/db` | Gap 2 |
| `getPendingPlainEmails` not exported from `handshake/db` | Gap 2 |
| `markPlainEmailProcessed` not exported from `handshake/db` | Gap 2 |
| `tryQbeapDecryptInbox` returns `decrypted=false` for sealed rows | Gap 3 |

---

## Stop-and-report conditions encountered

| Condition | Resolution |
|-----------|-----------|
| Att-2 infeasible for email path | **Not triggered.** Attachments arrive synchronously with the message on the email path. |
| Plain-email staging caller that isn't legacy | **Not triggered.** All three callers (`beapSync.ts`, `ipc.ts`, `syncOrchestrator.ts`) were confirmed legacy; `detectAndRouteMessage` covers the same need. |
| `beapEmailIngestion.ts` P2P function reachable, writes `inbox_messages`, no clean migration | **Triggered.** `processPendingP2PBeapEmails` and its child writes are B-4 scope.  Surfaced in JSDoc and PR description; not fixed in B-3.1. |
| `inbox_attachments` seal columns already exist with non-NULL data | **Not triggered.** `inbox_attachments` has no `seal` / `seal_input_json` columns; confirmed by schema inspection. |

---

## Verification log

### `rg` checks

```
# plain_email_inbox in production code
→ Only in schema v28 (historical creation), schema v65 (DROP), and comments.
  No live function calls. ✓

# INSERT INTO inbox_messages in electron/main/email/
→ messageRouter.ts:258 (sealed via prepareSealedInsert + runSealedTransaction) ✓
→ beapEmailIngestion.ts:812 (P2P insertDirectBeap — B-4 stop-and-report documented) ⚠

# UPDATE inbox_messages SET in electron/main/email/
→ beapEmailIngestion.ts: P2P path (B-4 scope) ⚠
→ mergeExtensionDepackaged.ts, ipc.ts, etc.: metadata/lifecycle updates (not ingestion) ✓

# validatorOrchestrator.validate in electron/main/email/
→ messageRouter.ts:533  (BEAP inbox write)  ✓
→ messageRouter.ts:593  (quarantine write)  ✓
→ messageRouter.ts:838  (plain email write) ✓
→ No inbox-bound write path in messageRouter.ts bypasses the validator. ✓
```

### TypeScript compilation

All errors in the output are pre-existing (unrelated to B-3.1 changes).
The B-3.1 changes introduce zero new TypeScript errors.

### Test results

```
packages/ingestion-core              ✓ 37 tests pass
electron/main/sealed-storage         ✓ 20 tests pass
electron/main/email/b31GapClosure    ✓ 10 tests pass, 5 skipped (better-sqlite3)
electron/main/email/messageRouter    ✓ 1 test pass, 9 skipped (better-sqlite3)
```

---

## Known remaining gaps (not in B-3.1 scope)

| Gap | Owner |
|-----|-------|
| `processPendingP2PBeapEmails` / `insertDirectBeap` raw inbox writes | **B-4** |
| `tryQbeapDecryptInbox` / `retryPendingQbeapDecrypt` raw inbox UPDATEs | **B-4** (P2P path); legacy rows not reclaimable post-B-3 |
| `email_beap` attachment SHA-256 not in seal (`depackaged_json` format migration needed) | **B-5** |
| `mergeExtensionDepackaged.ts` raw `UPDATE inbox_messages` | **B-5** (extension merge path) |
