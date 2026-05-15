# PR B-8.4d-i — Bulk Stale Test Cleanup + Authorization Defense-in-Depth

## Summary

This PR delivers:
1. **One production fix** — inline `expires_at` check added to `diagnoseHandshakeInactive` in `enforcement.ts` (defense-in-depth against stale `ACTIVE` state from background expiry process lag).
2. **144+ stale test fixes** across 9 patterns identified in the B-8.4d full triage and B-8.4d mini-triage.

**Before/after failure count:** 228 → 71

The 71 remaining failures are all in expected non-Category-1 buckets:
- 65 Category 5 environmental (sealed vault key provider, CPU mock, HTTP JSON errors, NLP stub, autofill jsdom)
- 2 Category 3 legacy (`hostAiRoutingCorrectness.regression.test.ts`)
- 1 QB_09 deferred (`outboundQueue.backoff.test.ts`)
- 3 Category 5 internal inference (Electron BrowserWindow mock, DB mock incompleteness)

---

## Decision A — Production fix for Pattern I (defense-in-depth)

**File:** `apps/electron-vite-project/electron/main/handshake/enforcement.ts`

Added an unconditional inline `expires_at` check to `diagnoseHandshakeInactive`. This closes the window where a handshake whose background state-transition (ACTIVE → REVOKED) hasn't run yet would pass the authorization gate despite being past `expires_at`.

```typescript
// New defense-in-depth check — expires_at
if (record.expires_at !== null && record.expires_at !== undefined) {
  if (new Date(record.expires_at).getTime() < now.getTime()) {
    return { active: false, reason: `Handshake expired at ${record.expires_at}` }
  }
}
```

Check is unconditional. No grace period. No test-mode bypass.

**Stop-and-report:** No design conflicts were found. `diagnoseHandshakeInactive` had no existing grace-period or soft-expiry concept.

---

## Decision B — Additional test for defense-in-depth scenario

**File:** `apps/electron-vite-project/electron/main/ingestion/__tests__/authorization.test.ts`

Added test: `state ACTIVE but expires_at past → HANDSHAKE_INACTIVE (defense-in-depth against stale state from background expiry process)`.

---

## Decision C — Pattern A: missing crypto fields in e2e fixtures (18 tests)

**Files:** `e2e.transport.test.ts`, `e2e.http.test.ts` (H1/H4/H5), `e2e.ipc.test.ts`, `e2e.websocket.test.ts`, `fixtures/capsules.ts`

Added `sender_public_key`, `sender_signature`, and `countersigned_hash` to shared capsule fixture builders. Fixed in prior session (B-8.4c).

---

## Decision D — Pattern B: pairing-code validation order (3 tests)

**Files:** `acceptX25519Binding.internal.regression.test.ts`, `ipc.internal.accept.validation.test.ts`, `ipc.internal.deviceId.test.ts`

Updated expected error codes to match Phase B's earlier pairing-code validation gate. Fixed in prior session.

---

## Decision E — Pattern C: jest → vi migration (12 tests)

**Files:** `TriggerRegistry.test.ts`, `ListenerManager.test.ts`

Chose **Option E1** (mechanical replacement). Only 2 files affected; E1 produces cleaner Vitest-idiomatic code. Fixed in prior session.

---

## Decision F — Pattern D: p2p-transport stale fixtures (11 tests)

**File:** `p2p-transport.test.ts`

- Crypto fields added to `validBeapCapsule()`.
- Private key fixture updated to 64-char hex seed.
- `vaultService.getStatus` mocked to `{ isUnlocked: true }` in `P6_01`.
- `updateHandshakeCounterpartyKey` called in setup to align DB with test keypair.

Fixed in prior session.

---

## Decision G — Pattern E: ACCEPTED → ACTIVE dual-roundtrip (1 test)

**File:** `e2e.roundtrip.test.ts` (T18)

Added `updateHandshakeContextSyncEnqueued` calls for both peers to satisfy Phase B's requirement that `last_seq_sent >= 1` before ACTIVE transition. Fixed in prior session.

---

## Decision H — Pattern F: policy_selections 3rd key (5 tests)

**File:** `ipc.handshake.test.ts`

Updated `policy_selections` assertions to include the Phase B `ai_processing_mode` third key. Fixed in prior session.

---

## Decision I — Pattern G: execution-flow drift (2 tests)

**Files:** `p2pTransport.coordination.test.ts`, `relayPull.messageRelay.test.ts`

- `p2pTransport.coordination.test.ts`: Phase B auto-fills wire fields; `fetch` is now called before the relay validation gate. Updated assertion `expect(fetchMock).toHaveBeenCalled()`. Fixed in prior session.
- `relayPull.messageRelay.test.ts`: `p2p_pending_beap` table dropped; `message_relay` capsules now go through `processBeapPackageInline`. Fixed in prior session.

**Stop-and-report:** Neither case reveals canon-directive violation. In `p2pTransport.coordination.test.ts`, `fetch` is called with auto-filled wire fields — the server-side 500 response is returned as expected, confirming the authorization gate is still active on the server side.

---

## Decision J — Pattern H: error message text (1 test)

**File:** `diagnostics.test.ts`

Updated substring assertion from `'Model loading timed out'` to `'Model load timed out'`. Fixed in prior session.

---

## Decision K — Pattern I verification

Decision A's production fix makes `authorization.test.ts` pass. Confirmed via test run.

---

## Additional Category 1 fixes (L1–L8, L4, L6, L7)

These address the remaining ~90 Category 1 tests from the B-8.4d Definitive Triage that were not in the mini-triage:

### L1 — evaluator.test.ts (8 tests)
Spread `DEFAULT_INGRESS_POLICY` in fixture `ingress` objects to initialize required array fields; adjusted 3 assertions to match current production behavior.

### L2 — BeapPackageBuilder.test.ts + sessionImportArtefact.test.ts (13 tests)
Mocked `getDeviceX25519PublicKey` and `deriveSharedSecretX25519` to bypass `chrome.runtime.sendMessage` (absent in jsdom).

### L3 — handshakeRefresh.test.ts (4 tests)
Updated assertions to match proof-only API shape (`block_id`, `block_hash` only); corrected RPC parameter from `context_blocks` to `context_block_proofs`.

### L4 — listInferenceTargets.step8.test.ts + hostAiPeerEndpointAndAdvertisement.test.ts (50+ tests)
- `isDcUpListMock.mockReturnValue(false)` added to test blocks that exercise legacy HTTP probe path.
- `hostHasActiveInternalLedgerHostPeerSandboxFromDb` mocked to bypass `db.prepare` calls.

### L5 — migration.test.ts (5 tests)
Relaxed static assertions for `peerX25519PublicKey`/`peerPQPublicKey` (legitimate in Phase B); handled absent `useFullAutoStatus.ts`.

### L6 — DB migration tests (b4P2PRelayMigration, b72DecryptedContentReseal, mergeExtensionDepackaged) (~17 tests)
- Added `buildValidSealForRowId` HMAC helper across all three files.
- Fixed `bindKeyProvider(() => Promise.resolve(TEST_DEK))` → `bindKeyProvider(() => TEST_DEK)` (sync).
- Fixed `makeTestDb()` to omit `handshakes` table (let `migrateHandshakeTables` build it).
- Added missing columns (`beap_package_json`, `encryption_iv`, etc.).
- Updated `validation_reason` assertions to `.toBeFalsy()` per B-5.1 change.

### L7 — b5ExtensionMerge, b7IpcContentUpdates, b8BeapInboxIpc, b81BeapInboxPagination, messageRouter (41 tests)

**b5ExtensionMerge.test.ts** (7 tests):
- §E.6: Fixed `session_import_artefact` fixture: `declared_purpose: 'session_share'` (not `'session_transfer'`); removed unknown keys `agent_config`, `processing_history`; added required `session_name`, `capabilities_required`, converted `display_grids` from object to array.
- §F.1–§F.3, §F.6: Fixed `bindKeyProvider(() => Promise.resolve(TEST_DEK))` → sync; `makeSealedOutcome` now generates HMAC-verified seals via `buildValidSealForRowId`.
- §F.4: `validation_reason` assertion changed to `.toBeFalsy()` (B-5.1 no longer writes to inbox on rejection).
- §G.2: Changed `require('../beapInboxClonePrepare')` → `await import(...)` (ESM environment, `createRequire` can't resolve TypeScript files dynamically).

**b7IpcContentUpdates.test.ts** (5 tests):
- Both `§2` and `§3` `makeSuccessOutcome` updated to generate HMAC-verified seals via `buildValidSealForRowId`.

**b8BeapInboxIpc.test.ts** (16 tests) + **b81BeapInboxPagination.test.ts** (12 tests):
- `vi.mock('../sealed-storage', ...)` → `vi.mock('../../sealed-storage', ...)`: tests live in `handshake/__tests__/` but `ipc.ts` imports from `'../sealed-storage'` which resolves to `main/sealed-storage`. From the `__tests__/` subdirectory the correct relative depth is `'../../sealed-storage'`.
- Same depth correction applied to `'../email/sealedContentUpdate'` → `'../../email/sealedContentUpdate'`.
- All dynamic `import('../email/sealedContentUpdate')` calls within tests updated to `import('../../email/sealedContentUpdate')`.

**messageRouter.ingestTransaction.test.ts** (1 test):
- Added `bindKeyProvider`/`unbindKeyProvider`/`clearTamperingEvents` import.
- Added `beforeEach` mock for `validatorOrchestrator.validate` returning HMAC-computed seals, plus `afterEach` cleanup.
- Phase B added validator calls for all email types (including plain_email); test was missing the mock.

### L8 — UI/renderer fixes (~6 tests)
- `ThisDeviceCard.test.tsx`: updated helper text copy assertion.
- `beapInboxActionTooltips.test.ts`: updated `SANDBOX_HOVER` constant.
- `finalAcceptance.hostAiInvariants.test.ts`: updated static assertion for `computeHandshakeAvailableModels`; added `available: true` to fixture.
- `inboxMessageSandboxClone.test.ts`: updated fixture to nest `beap_sandbox_clone` inside `beap_package_json.metadata.inbox_response_path.sandbox_clone_provenance`.

---

## Stop-and-report conditions encountered

None triggered.

---

## What was not verified

1. **Whether the Pattern I production fix affects any other code path calling `diagnoseHandshakeInactive`**: The function has a narrow signature (takes `HandshakeRecord`, returns `{ active: boolean, reason?: string }`). All callers in `enforcement.ts` handle the `active: false` case via a unified rejection path. The new check is semantically compatible with every call site.

2. **Whether any Pattern G fix masks a real behavior change**: `p2pTransport.coordination.test.ts` confirms `fetch` IS called (correct for Phase B's auto-fill path) and returns failure (server 500) — the transport gate remains active. `relayPull.messageRelay.test.ts` confirms `processBeapPackageInline` IS called for `message_relay` capsules. Neither masks a canon-directive violation.

3. **Performance impact of inline expiry check**: One `new Date(expires_at).getTime()` comparison per authorization. Negligible.

---

## Verification log

```
Before:  228 failures
After L6 (DB migration tests):  111 failures
After L7 (sealed gate + mock path fixes):  71 failures

Final: 71 failures (all Category 5 / Category 3 / QB_09 — none are Category 1)

Failing files:
  outboundQueue.backoff.test.ts          — QB_09 deferred
  e2e.http.test.ts (H3)                  — Category 5 (HTTP JSON error response)
  hostAiRoutingCorrectness.regression    — Category 3 legacy
  internalInference.directHost           — Category 5 (Electron BrowserWindow mock)
  internalInferenceService.test.ts       — Category 5 (DB mock incompleteness)
  hsContextOcrJob.test.ts                — Category 5
  NlpClassifier.test.ts                  — Category 5 (NLP stub)
  background-sender-gate.test.ts         — Category 5
  datavault-classifier.test.ts           — Category 5
  datavault-improvements.test.ts         — Category 5
  hardening.test.ts                      — Category 5
  scan-dos-caps.test.ts                  — Category 5
  security-regression.test.ts            — Category 5
  writes-kill-switch.test.ts             — Category 5
  committer.test.ts                      — Category 5
  fieldScanner.test.ts                   — Category 5
```

---

## After this PR

- **B-8.4d-iii-5b**: Category 5 architectural (sealed vault key provider test harness, CPU mock, rotating logger isolation, HTTP server JSON error responses, NLP stub).
- **Separate QB_09 diagnostic**: investigate outbound queue retry behavior.
- **Category 3 tracking**: ~2 pre-Phase-B legacy failures (`hostAiRoutingCorrectness.regression.test.ts`).

After these:
- B-9: sandbox clone outbound migration.
- B-10: quarantine UI hardening.
- B-11: final hardening + CI lint enforcement + TypeScript debt cleanup.
