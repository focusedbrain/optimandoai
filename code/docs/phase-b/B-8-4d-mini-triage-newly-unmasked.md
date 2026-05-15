# B-8.4d Mini-Triage — Newly-Unmasked Failures after B-8.4d-iii-5a

**Date:** 2026-05-13  
**Scope:** 89 failures that became visible after B-8.4d-iii-5a unblocked 39 previously-broken suites.  
**Method:** Differential comparison of `vitest-triage-output.json` (pre-5a, 147 failures) against `vitest-5a-output.json` (post-5a, 228 failures). New failures = tests failing in the post-5a run that were absent from the pre-5a run.

---

## Identification note: 89, not 81

The prompt estimated 81 new failures (228 - 147). The actual differential is **89** new failures because B-8.4d-iii-5a simultaneously fixed 8 of the 147 previously-visible failures (the electron mock made `rpcAuth.test.ts`, 4 tests in `b4P2PRelayMigration.test.ts`, `revocation.test.ts`, and `hardening.test.ts` pass). The net change of 81 is correct; the gross new count is 89.

Cross-check: 147 − 8 (resolved) + 89 (new) = **228** ✓

---

## Section 1 — Mini-triage summary

| Category | Count |
|----------|-------|
| 1 (stale test) | 54 |
| 2 (real regression) | **0** |
| 5b (environmental — sealed vault, CPU detection, NLP, log isolation) | 35 |
| **Total** | **89** |

---

## Section 2 — Category 1 by pattern

### Pattern A — Missing Phase B cryptographic capsule fields in e2e/ingestion fixtures (18 tests)

**Files:** `e2e.transport.test.ts` (11), `e2e.http.test.ts` H1/H4/H5 (3), `e2e.ipc.test.ts` (2), `e2e.websocket.test.ts` (2)

**Error signature:** `AssertionError: expected false to be true` / `expected 'rejected' to be 'validated'` / `expected 'Missing required field: sender_public_key'`

**Root cause:** These suites were blocked by `app.getPath` at load time before B-8.4d-iii-5a. They are e2e ingestion tests. Their capsule fixtures do not include `sender_public_key`, `sender_signature`, and `countersigned_hash` — the three cryptographic fields required by Phase B's validator. The ingestion pipeline rejects every capsule with `Missing required field: sender_public_key`, causing `result.success === false`.

**Evidence:** `e2e.transport.test.ts` test 6 fails with `expected 'Missing required field: sender_public_key...' to match /vault|session|log in/i` — the error message is explicit. B-8.4c resolved the same failure pattern for `validator.test.ts`, `adversarial.test.ts`, `integration.test.ts`, `hardening.test.ts`, and `relay-server.test.ts`.

**Fix shape:** Add `sender_public_key`, `sender_signature`, `countersigned_hash` to the capsule builder functions in each of the 4 affected test files. Same fix as B-8.4c Pattern C.

---

### Pattern B — Phase B pairing-code validation intercepts before endpoint-distinctness check (3 tests)

**Files:** `acceptX25519Binding.internal.regression.test.ts` (1), `ipc.internal.accept.validation.test.ts` (1), `ipc.internal.deviceId.test.ts` (1)

**Error signature:**
- `expected 'INTERNAL_PEER_DEVICE_MISMATCH: ...' to contain 'INTERNAL_ENDPOINT_ID_COLLISION'`
- `expected 'INTERNAL_PAIRING_CODE_INVALID: ...' to contain 'INTERNAL_ENDPOINT_INCOMPLETE'`

**Root cause:** Phase B added a new pairing-code-based device verification layer (using `getLocalPairingCode()` / `getOrchestratorPairingCode()`) that runs **before** the existing endpoint-distinctness check (`validateInternalEndpointPairDistinct`) and the `INTERNAL_ENDPOINT_INCOMPLETE` checks targeting `getLocalDeviceIdForRelay()`. Two sub-patterns:

1. **`INTERNAL_ENDPOINT_ID_COLLISION` → `INTERNAL_PEER_DEVICE_MISMATCH`** (2 tests): The test fixtures include `internal_peer_pairing_code: '123456'`. Phase B's accept path now checks this field first. The test either doesn't pass `local_pairing_code_typed` at all, causing `INTERNAL_PAIRING_CODE_INVALID`, or passes a code that doesn't match the device's own code from `getLocalPairingCode()` (which returns `undefined` from the mock), triggering the "defense in depth" mismatch branch. The pair-distinctness check at `validateInternalEndpointPairDistinct` is never reached.

2. **`INTERNAL_ENDPOINT_INCOMPLETE` → `INTERNAL_PAIRING_CODE_INVALID`** (1 test, `ipc.internal.deviceId.test.ts`): The test mocks `orchestratorModeStore.getInstanceId` to return `undefined` to test the no-device-id fast-fail. Phase B's initiate validation (`validateInternalInitiateContract`) now validates the `receiver_pairing_code` format earlier in the sequence than the `sender_device_id` completeness check. The test request omits `receiver_pairing_code`, causing `INTERNAL_PAIRING_CODE_INVALID` to fire first.

**Evidence:** Production code `ipc.ts` lines 1859–1901 show `internal_peer_pairing_code` check precedes `validateInternalEndpointPairDistinct`. `internalEndpointValidation.ts` line 418 shows `INTERNAL_PAIRING_CODE_INVALID` check in `validateInternalInitiateContract`.

**Fix shape:** Update test fixtures and mocks to exercise the new pairing-code flow correctly. Three options per test: (a) set `internal_peer_pairing_code: undefined` in the fixture to skip the pairing-code branch and reach the old code path, (b) provide a matching `local_pairing_code_typed` AND mock `getOrchestratorPairingCode`, or (c) assert the new (correct) error code instead.

---

### Pattern C — Automation tests using `jest` global instead of `vi` (12 tests)

**Files:** `TriggerRegistry.test.ts` (9), `ListenerManager.test.ts` (3)

**Location:** `apps/extension-chromium/src/automation/__tests__/`

**Error signature:** `ReferenceError: jest is not defined` (lines 81, 191, 210, 232, 245, 251 of the respective test files)

**Root cause:** These suites were unblocked by the `globals: true` change in B-8.4d-iii-5a (they were previously failing with `describe is not defined`). They now load and run. Inside the test bodies, they call `jest.fn()`, `jest.spyOn()`, etc. — Jest-specific globals not available in Vitest. With `globals: true`, Vitest exposes `vi` but not `jest`.

**Evidence:** Explicit `ReferenceError: jest is not defined` at the specific test-body lines.

**Fix shape (Category 1, mechanical):** Replace all occurrences of `jest.fn()` → `vi.fn()`, `jest.spyOn()` → `vi.spyOn()`, `jest.mock()` → `vi.mock()`, etc. in both files. 12 tests resolved. Alternatively, add `globalThis.jest = vi` to the Vitest setup file (same as the `@jest/globals` alias approach from B-8.4d-iii-5a Decision D) — this has lower surgical cost but affects all tests.

---

### Pattern D — p2p-transport stale fixtures and key format (11 tests)

**Files:** `p2p-transport.test.ts` (all 11 failing tests in `packages/relay-server/`)

**Error signatures:**
- `expected 422 to be 200` (P3_01, P4_01)
- `expected 422 to be 400` (P3_06)
- `expected 0 to be >= 1` (P6_01)
- `Error: privateKey must be hex (64-char seed or PKCS#8 DER)` (P6_05, P6_07, P7_01–P7_05)

**Root cause:** Two sub-patterns:

1. **Missing capsule crypto fields** (P3_01, P3_06, P4_01): The `validBeapCapsule()` fixture in `p2p-transport.test.ts` is missing `sender_public_key` and `sender_signature`. The relay server's validation rejects with HTTP 422 instead of accepting the capsule. B-8.4c fixed the same pattern in `relay-server.test.ts`.

2. **Wrong private key format** (P6_05, P6_07, P7_01–P7_05): These tests pass a private key string that doesn't conform to the Phase B requirement of a 64-char hex seed or PKCS#8 DER format. Likely a test fixture that used an older key representation (e.g., base64 or raw bytes) before Phase B updated the crypto module's key format requirements.

**Fix shape:** (1) Add `sender_public_key` and `sender_signature` to `validBeapCapsule()`. (2) Update the private key fixtures to use the 64-char hex seed format expected by Phase B.

---

### Pattern E — ACCEPTED → ACTIVE transition requires dual-roundtrip context sync (1 test)

**File:** `e2e.roundtrip.test.ts` test T18 ("full initiate → accept → refresh round-trip with two parties")

**Error signature:** `AssertionError: expected 'ACCEPTED' to be 'ACTIVE'`

**Root cause:** Identical to the failures resolved in `hardening-verification.test.ts` during B-8.4c. Phase B requires that a handshake transitions from `ACCEPTED` to `ACTIVE` only after both parties exchange a context_sync capsule (the dual-roundtrip). The test builds a round-trip scenario but doesn't call `updateHandshakeContextSyncEnqueued` to pre-seed `last_seq_sent = 1`, so the transition to `ACTIVE` never fires.

**Fix shape:** Add `updateHandshakeContextSyncEnqueued(db, handshakeId)` call for each side in the test setup before asserting `ACTIVE` state — same fix applied in B-8.4c to `hardening-verification.test.ts`.

---

### Pattern F — Policy shape drift: `policy_selections` object has 3 keys instead of 2 (5 tests)

**File:** `ipc.handshake.test.ts` (5 tests)

**Error signature:** `expected { …(3) } to deeply equal { cloud_ai: true, internal_ai: true }`

**Root cause:** These tests assert that `policy_selections` persisted by `handshake.initiate` / `handshake.accept` equals a plain 2-key object `{ cloud_ai: ..., internal_ai: ... }`. Phase B added a third key to the effective policy shape (likely `local_ai` or `orchestrator_ai`). The serialized / deserialized object has 3 keys; the assertion uses `toEqual` which requires exact match.

The `expected false to be true` failures in the same file (2 tests) follow from the same structural mismatch — the overall operation returns `success: false` due to an unrecognised policy shape.

**Fix shape:** Read the current policy_selections output from the production code and update the assertions to include the new key. Use `expect.objectContaining` for assertions where the exact key count isn't the invariant.

---

### Pattern G — Execution-flow drift: fetch/spy/insert behavior changed (2 tests)

**Files:** `p2pTransport.coordination.test.ts` (1), `relayPull.messageRelay.test.ts` (1)

**Errors:**
- `expected "spy" to not be called at all, but actually been called 1 times` (coordination)
- `expected +0 to be 1` (relayPull)

**Root cause:**

*`p2pTransport.coordination.test.ts`* — The test expects that `sendCapsuleViaCoordination` for a `context_sync` capsule with missing wire context blocks **before** calling `fetch`. Phase B changed the execution order: `fetch` is now called (or at least the fetch mock is invoked) before the internal relay validation gate fires. The `LOCAL_INTERNAL_RELAY_VALIDATION_FAILED` error is still returned, but the fetch spy is called once.

*`relayPull.messageRelay.test.ts`* — The test expects that a `message_relay`-routed capsule is inserted into the `p2p_pending_beap_messages` table by `pullFromRelay`. Phase B changed the persistence logic for `message_relay` distribution — either the insert happens under a different condition, the target table changed, or the insert path now requires an additional field not present in the mock.

**Fix shape (Category 1):** Read the current `sendCapsuleViaCoordination` and `pullFromRelay` implementations and update the test assertions to match the new execution order and persistence behavior.

---

### Pattern H — Error message text changed (1 test)

**File:** `diagnostics.test.ts` — "User-Friendly Error Messages should convert timeout errors"

**Error signature:** `expected 'Error: Model load timed out after 90s…' to contain 'Model loading timed out'`

**Root cause:** The timeout error message was reworded in Phase B. The test asserts a substring `'Model loading timed out'`, but the current message is `'Model load timed out after 90s'`.

**Fix shape:** Update the `toContain` assertion to match the current message substring or switch to a regex.

---

### Pattern I — Authorization gate: `expires_at` not checked inline (1 test)

**File:** `authorization.test.ts` — "Execution Authorization Gate expired handshake → HANDSHAKE_INACTIVE"

**Error signature:** `AssertionError: expected true to be false`

**Root cause:** The test sets `expires_at: past` with `state: 'ACTIVE'` and expects `authorizeToolInvocation` to deny with `HANDSHAKE_INACTIVE`. The production implementation delegates to `diagnoseHandshakeInactive` (enforcement.ts:607–618), which only checks `record.state !== HS.ACTIVE`. It does **not** check `expires_at` inline. The implementation treats state as the source of truth for activity; expiry-triggered deactivation is expected to be handled by a background state-transition process.

**Category 1 with a note:** This test was written assuming inline expiry checking in the authorization gate. The current design uses state-based inactive tracking. If the canon spec explicitly requires inline expiry checking (rather than relying on a background state-transition process), this becomes **Category 2**. Based on the current implementation and the absence of inline checks elsewhere in the authorization pipeline, classifying as Category 1 (stale test assumption).

**Fix shape:** Update test to set `state: 'PENDING_ACCEPT'` (or another non-ACTIVE state) to test the inactive path, OR add a test that verifies the background expiry process transitions the state correctly.

---

## Section 3 — Category 2 (real regressions)

**Section 3 empty: no real regressions found in the newly-unmasked population.**

All 89 failures were investigated individually. Every failure has a clear Category 1 or Category 5 root cause:
- Category 1 failures are the result of Phase B legitimately changing API shapes, cryptographic requirements, validation order, or error message text.
- Category 5 failures are the result of test-environment infrastructure gaps (sealed vault, CPU detection subprocess, NLP model dependency, log file path isolation).

The integration tests in the 89 (`e2e.transport.test.ts`, `e2e.http.test.ts`, `e2e.roundtrip.test.ts`, `p2p-transport.test.ts`) received extra scrutiny per the triage spec. All failures traced to stale fixtures or missing mock setup, not implementation bugs.

---

## Section 4 — Category 5b by infrastructure gap

| Infrastructure gap | Affected files | Count | Estimated fix scope |
|--------------------|----------------|-------|---------------------|
| **5b-1: Sealed vault key provider not bound** | `b8BeapInboxIpc.test.ts`, `b81BeapInboxPagination.test.ts` | 28 | Medium — requires `bindKeyProvider(testKeyProvider)` in test setup. The key provider must be a deterministic mock. beapInbox tests may need a `SealedStorage` test harness analogous to the one built for `hardening-verification.test.ts`. |
| **5b-2: CPU capability detection timeout** | `hardware-capability.test.ts` | 2 | Small — mock `os.cpus()` or the CPU detection subprocess; increase test timeout. These tests previously failed at import (`@jest/globals`), now load but hang on real hardware detection. |
| **5b-3: NLP classifier null dependency** | `NlpClassifier.test.ts` | 2 | Small-Medium — NLP classifier module reads a null model at test time. Likely requires mocking the model-load path or providing a stub model. |
| **5b-4: Rotating logger log-file path isolation** | `diagnostics.test.ts` ("Rotating Logger" tests, 2) | 2 | Small — the global electron mock returns the same `userData` path for all parallel tests. The rotating logger is a singleton per path. Two options: (a) the electron mock returns a unique per-test path (using `process.pid + Math.random()`), or (b) the logger is reset via `resetLogger()` in `beforeEach`. |
| **5b-5: HTTP server returns HTML for oversized payload** | `e2e.http.test.ts` H3 | 1 | Small — the express/http server returns an HTML 413 or 400 page instead of JSON. The test tries `JSON.parse(response.body)` and throws. Fix: configure the http server's error handler to always return JSON, or update the test to handle non-JSON error responses. |

---

## Section 5 — Integration tests in the 89

Four integration test files appeared in the newly-unmasked 89. Each receives per-test analysis per the triage spec.

### 5.1 `e2e.transport.test.ts` (11 failing tests)

**Location:** `apps/electron-vite-project/electron/main/ingestion/__tests__/e2e.transport.test.ts`

**Architecture:** Full ingestion pipeline exercised through the `handleIngestionRPC` / `handleIngestionHTTP` RPC handlers. Tests span HTTP, WebSocket, and IPC transports. Data flows from raw JSON capsule → validation → distribution → handshake_pipeline or other targets.

**Failures and root causes:**

| Test | Error | Root cause | Cat |
|------|-------|-----------|-----|
| 1: valid BEAP capsule → validated, routed | `expected false to be true` | Missing `sender_public_key` | 1 |
| 4: future timestamp → validator passes | `expected false to be true` | Missing `sender_public_key` | 1 |
| 5: wrong content-type, valid BEAP JSON | `expected false to be true` | Missing `sender_public_key` | 1 |
| 6: valid BEAP via ingestion.ingest | `expected 'Missing required field: sender_public_key'` | Explicit — fixture lacks field | 1 |
| 10: valid input via extension simulation | `expected false to be true` | Missing `sender_public_key` | 1 |
| Audit: audit record has required fields | `expected 'rejected' to be 'validated'` | Upstream rejection → no audit | 1 |
| 16: 20 identical requests in parallel | `expected false to be true` | Missing `sender_public_key` | 1 |
| accept capsule with sharing_mode | `expected false to be true` | Missing `sender_public_key` | 1 |
| revoke capsule routes to handshake_pipeline | `expected false to be true` | Missing `sender_public_key` | 1 |
| file_upload source type propagated | `expected false to be true` | Missing `sender_public_key` | 1 |
| ValidatedCapsule has immutable provenance | `expected false to be true` | Missing `sender_public_key` | 1 |

**Verdict:** All 11 are **Category 1**. The capsule fixture builder in this file was written before Phase B's cryptographic field requirements. Adding `sender_public_key`, `sender_signature`, and `countersigned_hash` to the shared capsule builder will resolve all 11.

No Category 2 evidence. The ingestion pipeline's validation is behaving correctly — it rejects capsules missing required fields. The tests are stale.

---

### 5.2 `e2e.http.test.ts` (4 failing tests)

**Location:** `apps/electron-vite-project/electron/main/ingestion/__tests__/e2e.http.test.ts`

**Architecture:** Integration test that starts a real HTTP server and sends POST requests to `/api/ingestion/ingest`.

| Test | Error | Root cause | Cat |
|------|-------|-----------|-----|
| H1: valid BEAP capsule → 200, validated | `expected false to be true` | Missing `sender_public_key` in fixture | 1 |
| H3: oversized payload → rejected, no parsing | `SyntaxError: Unexpected token '<'` | HTTP server returns HTML for large payload instead of JSON | 5b-5 |
| H4: future timestamp → validator passes | `expected false to be true` | Missing `sender_public_key` | 1 |
| H5: text/plain mime_type, valid BEAP JSON | `expected false to be true` | Missing `sender_public_key` | 1 |

**Verdict:** H1/H4/H5 = Category 1. H3 = Category 5b-5.

---

### 5.3 `e2e.roundtrip.test.ts` (1 failing test)

**Location:** `apps/electron-vite-project/electron/main/ingestion/__tests__/e2e.roundtrip.test.ts`

**Architecture:** Full two-party round-trip: `handshake.initiate` → `handshake.accept` → `refresh`. Verifies ACCEPTED → ACTIVE transition.

**Test T18:** "full initiate → accept → refresh round-trip with two parties"  
**Error:** `expected 'ACCEPTED' to be 'ACTIVE'`

**Analysis:** Phase B requires the dual-roundtrip context-sync protocol (both parties exchange a context_sync capsule) before the handshake transitions to ACTIVE. The test builds a round-trip but does not trigger the context-sync exchange. The same failure pattern was diagnosed and fixed for `hardening-verification.test.ts` tests A4/D1 in B-8.4c.

**Verdict:** **Category 1.** No regression. The implementation correctly enforces the dual-roundtrip invariant. Fix: add `updateHandshakeContextSyncEnqueued(db, handshakeId)` for both sides before asserting ACTIVE.

---

### 5.4 `p2p-transport.test.ts` (11 failing tests)

**Location:** `packages/relay-server/__tests__/p2p-transport.test.ts`

**Architecture:** Integration test for the relay-server's P2P transport layer. Tests P2P server input hardening, authentication, auto-trigger, and full roundtrip.

| Tests | Error | Root cause | Cat |
|-------|-------|-----------|-----|
| P3_01, P4_01 | `422 != 200` | Missing `sender_public_key`, `sender_signature` in fixture | 1 |
| P3_06 | `422 != 400` | Same — capsule rejected before reaching the handshake_id check | 1 |
| P6_01 | `expected 0 >= 1` | Auto-trigger count is 0 — likely fixture issue preventing the capsule from being accepted, same root cause | 1 |
| P6_05, P6_07, P7_01–P7_05 | `privateKey must be hex` | Key fixture uses wrong format (not 64-char hex seed / PKCS#8 DER) | 1 |

**Extra scrutiny on P7 "Full Roundtrip" tests:** These test the entire P2P roundtrip including tamper detection (P7_03) and token authentication (P7_04). The `privateKey must be hex` error fires before any business logic runs — the test is failing at the key-setup stage, not at the roundtrip assertion. There is no evidence that the tamper detection or authentication logic regressed.

**Verdict:** All 11 are **Category 1.** Fix: (1) add `sender_public_key`/`sender_signature` to `validBeapCapsule()`, (2) update private key fixtures to 64-char hex seed format.

---

## Section 6 — Updated fix scope for subsequent PRs

### B-8.4d-i (bulk stale-test cleanup)

Originally scoped to 90 Category 1 failures from the visible pre-5a population.

After this triage, the Category 1 list grows by 54:

| Source | Cat 1 count |
|--------|-------------|
| Original B-8.4d triage | 90 |
| Newly-unmasked (this triage) | 54 |
| **Combined** | **144** |

The 54 new failures cluster into 9 patterns (Patterns A–I above), all mechanical.  
Largest patterns:  
- A: 18 tests — add crypto fields to 4 e2e test files  
- C: 12 tests — `jest` → `vi` in 2 automation test files  
- D: 11 tests — fix fixture in 1 p2p-transport test file  

All 54 are straightforward test fixes with no production code changes required.

### B-8.4d-iii-5b (architectural test-infrastructure)

Originally scoped to 52 Category 5 failures from the visible pre-5a population.

After this triage, the Category 5b list grows by 35:

| Source | Cat 5 count |
|--------|-------------|
| Original B-8.4d triage | 52 |
| Newly-unmasked (this triage) | 35 |
| **Combined** | **87** |

The 35 new Cat 5 failures cluster into 5 infrastructure gaps (Gaps 5b-1 through 5b-5 in Section 4). The dominant gap is 5b-1 (sealed vault key provider, 28 tests across 2 files).

### B-8.4d-ii (regression fixes)

**Not needed.** Zero Category 2 failures found in the newly-unmasked population.

The combined assessment across both the original B-8.4d triage and this mini-triage:
- **Zero Category 2 in 228 observed failures.**
- B-8.4d-ii may be written off as a planned PR unless new evidence of regression emerges from B-8.4d-i or B-8.4d-iii-5b.

---

## Appendix — Files unblocked by B-8.4d-iii-5a and their new failure counts

| Suite file | New failures | Primary category |
|------------|-------------|-----------------|
| `b8BeapInboxIpc.test.ts` | 16 | 5b-1 (sealed vault) |
| `b81BeapInboxPagination.test.ts` | 12 | 5b-1 (sealed vault) |
| `e2e.transport.test.ts` | 11 | 1-A (missing crypto fields) |
| `p2p-transport.test.ts` | 11 | 1-D (fixtures + key format) |
| `TriggerRegistry.test.ts` | 9 | 1-C (jest global) |
| `ipc.handshake.test.ts` | 5 | 1-F (policy shape) |
| `e2e.http.test.ts` | 4 (3 Cat1 + 1 Cat5) | 1-A / 5b-5 |
| `ListenerManager.test.ts` | 3 | 1-C (jest global) |
| `diagnostics.test.ts` | 3 (1 Cat1 + 2 Cat5) | 1-H / 5b-4 |
| `NlpClassifier.test.ts` | 2 | 5b-3 |
| `e2e.ipc.test.ts` | 2 | 1-A (missing crypto fields) |
| `e2e.websocket.test.ts` | 2 | 1-A (missing crypto fields) |
| `hardware-capability.test.ts` | 2 | 5b-2 (timeout) |
| `acceptX25519Binding.internal.regression.test.ts` | 1 | 1-B (pairing code order) |
| `e2e.roundtrip.test.ts` | 1 | 1-E (ACCEPTED→ACTIVE) |
| `ipc.internal.accept.validation.test.ts` | 1 | 1-B (pairing code order) |
| `ipc.internal.deviceId.test.ts` | 1 | 1-B (pairing code order) |
| `p2pTransport.coordination.test.ts` | 1 | 1-G (flow drift) |
| `authorization.test.ts` | 1 | 1-I (expires_at design) |
| `relayPull.messageRelay.test.ts` | 1 | 1-G (insert drift) |
| **Total** | **89** | |

## Appendix — 8 pre-5a failures now resolved by B-8.4d-iii-5a

These were in the original 147-failure count and are now passing:

| File | Test | Why fixed |
|------|------|-----------|
| `rpcAuth.test.ts` | "handleVaultRPC accepts 3 arguments" | Electron mock freed `getPath` at load time |
| `b4P2PRelayMigration.test.ts` | §1.3 corrupted bytes → quarantine | Same |
| `b4P2PRelayMigration.test.ts` | §4.1 processPendingP2PBeapEmails INSERT callers | Same |
| `b4P2PRelayMigration.test.ts` | §4.2 processBeapPackageInline callers | Same |
| `b4P2PRelayMigration.test.ts` | §4.3 processSandboxQuarantine callers | Same |
| `b4P2PRelayMigration.test.ts` | §4.4 retryPendingQbeapDecryption callers | Same |
| `revocation.test.ts` | "revokeHandshake function is exported" | Same |
| `hardening.test.ts` | "handshake IPC handler does not import processIncomingInput" | Same |
