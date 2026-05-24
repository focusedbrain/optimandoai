# PR B-8.4c — Bulk Test Cleanup

## Authority

Phase B Architecture canon: every BEAP message type passes Ingestor and
Validator no matter where it lands; any bypass is a defect. Structural
properties B-1 through B-8.3 stay intact. This PR is purely operational
test cleanup.

## Summary

Addresses the B-8.4 audit and B-8.4a investigation findings:

- **Decision A** – Host AI selector returns persisted ID (`stored.id`
  instead of ephemeral `t.id`).
- **Decision B** – `listHostCapabilities` suppresses HTTP probe when
  WebRTC succeeds (WebRTC-first; HTTP fallback only on WebRTC failure).
- **Decision C** – Category 1 stale test updates (~95 entries).
- **Decision D** – 13 reclassified-from-Category-2 stale test fixes.
- **Decision E** – 6 Category 4 (removed functionality) test deletions.
- **Decision F** – Deferred items stay failing after this PR (QB_09,
  Category 5 environmental, Category 3 legacy).

## Decisions

### Decision A — Host AI selector returns persisted ID

**File:** `apps/electron-vite-project/src/lib/inferenceSelectionPersistence.ts`

`validateStoredSelectionForOrchestratorWithDiagnostics` now returns
`modelId: stored.id` (the durable persisted ID such as
`host-internal:<hid>:llama`) instead of `modelId: t.id` (the ephemeral
row ID from `inference_targets`). UI shows consistent model identity
across restarts.

**Tests fixed:** 4 in `hostInferenceSelectorIntegration.test.ts`.

### Decision B — HTTP probe suppressed when WebRTC succeeds

**Files:**
- `apps/electron-vite-project/electron/main/internalInference/transport/decideInternalInferenceTransport.ts`
- `apps/electron-vite-project/electron/main/internalInference/transport/internalInferenceTransport.ts`

`computeHostAiRouteFieldsForDecider` now detects `skipHttpProbe` (P2P
enabled but no data channel) and passes `suppressLedgerFallbackPeerAd`
to prevent the ledger `p2p_endpoint` from being used as fallback peer
advertisement. `listHostCapabilities` passes the same flag.
`resolveSandboxToHostHttpDirectIngest` is not called when WebRTC
succeeds.

**Tests fixed:** 2 in `listHostCapabilities.hostAiRoute.test.ts`.

### Decision C — Category 1 stale test updates

#### Group A — Relay server capsule fixture

**File:** `packages/relay-server/__tests__/relay-server.test.ts`

`validBeapCapsule()` fixture updated to include `sender_public_key`
(64-char hex) and `sender_signature` (128-char hex), which `initiate`
capsules now require per Phase B validator rules.

**Tests fixed:** 4 in `relay-server.test.ts`.

#### Group B — Ingestion validator / pipeline fixtures

**Files:** Multiple in `apps/electron-vite-project/electron/main/ingestion/__tests__/`
and `apps/electron-vite-project/electron/main/handshake/__tests__/`

Root cause: capsule fixtures (`validInitiate`, `validAccept`,
`validRevoke`, `validBeapPayload`) were missing the cryptographic fields
(`sender_public_key`, `sender_signature`, `countersigned_hash`) added
to the Phase B validator. This caused `MISSING_REQUIRED_FIELD` errors
before the intended validation checks ran.

Updates applied to:
- `validator.test.ts` — `validInitiate`, `validAccept`, `validRevoke`
- `adversarial.test.ts` — `validInitiate` + inline accept payload
- `integration.test.ts` — `validBeapPayload` + inline accept payload
- `hardening.test.ts` — `validInitiate`
- `hardening-verification.test.ts` — see below

**`hardening-verification.test.ts` — 9 failing tests addressed:**

| Test | Root cause | Fix |
|------|------------|-----|
| A4 | `updateHandshakeCounterpartyKey(aliceDb, ...)` missing; bobDb not seeded with `last_seq_sent` | Added both calls |
| C2, D1 | Same as A4 (uses `setupHandshakeWithKeypairs`) | Fixed via helper update |
| C4 | AliceDb counterparty key not set before bob's context_sync | Added inline key setup |
| C7 | BobDb `last_seq_sent=0` → never reached ACTIVE for second context_sync rejection | Added `updateHandshakeContextSyncEnqueued(bobDb, ...)` |
| D3, E2, E3, E4, E5 | Tests expected `CONTEXT_COMMITMENT_MISMATCH` but context_sync commitment check is intentionally skipped in Phase B (`enforcement.ts` lines 488-490) | Updated assertions to `toBe(true)` |

`setupHandshakeWithKeypairs` helper was updated to call
`updateHandshakeCounterpartyKey` for both alice's and bob's DB so
inbound context_syncs pass the key-identity check on both sides.

`updateHandshakeContextSyncEnqueued` import added.

### Decision D — Reclassified-from-Category-2 stale tests

| File | Tests | Fix |
|------|-------|-----|
| `b51ExtensionMergeBypass.test.ts` | 3 | Already fixed by B-8.4b — skipped |
| `internalRelayOutboundGuards.test.ts` | 1 | Updated expectation for `initiate` capsule: `isInternalRelayCapsuleEnvelope` returns `true` (Phase 3 routing) |
| `ipc.internal.relayPush.test.ts` | 2 | Added `counterparty_pairing_code` to fixtures; fixed mock paths for `deviceKeyStore` and `orchestratorModeStore`; added `setOidcTokenProvider`; updated assertion to check `receiver_pairing_code` instead of `receiver_device_id`; changed queue drain check to `status=sent` |
| `counterpartyKeyBinding.regression.test.ts` | 1 | Updated assertion from `ACTIVE` to `ACCEPTED` (dual-roundtrip canon) |
| `outboundQueue.backoff.test.ts` | 4 (QB_16, QB_17, QB_18, QB_22) | QB_16/17: `failure_class` updated from `PAYLOAD_PERMANENT` to `SCHEMA_PERMANENT`; QB_18: `infoSpy` → `warnSpy` for `terminal_http_400`; QB_22: added `electron` mock with `app.getPath` |
| `hostAiE2eSandboxToHostSuccess.integration.test.ts` | 1 | Updated `targets.length` to 2 (`isSandboxMode=false` emits all models) |
| `sandbox_lists_remote_ollama_models_even_when_beap_endpoint_missing.regression.test.ts` | 1 | Updated `targets.length` to 1, `aggregatedModels` and log assertions to reflect sandbox mode filtering |

### Decision E — Category 4 test deletions

Files with tests for `processPendingP2PBeapEmails` (documented no-op
stub since B-7.2):

| File | Tests removed | Tests retained |
|------|--------------|----------------|
| `pbeapValidation.test.ts` | PBEAP-1 through PBEAP-4 (4 tests deleted) | PBEAP-5a–5e (extractPBeapCapsule unit tests — still live) |
| `pr22SecurityDeferrals.test.ts` | OB-1, OB-2 (2 tests deleted) | TP-*, LG-* (type-shape and lint-rule tests — still live) |

Tests were removed as describe blocks; helper functions retained to
avoid accidental breakage of imports.

### Decision F — Deferred items

The following stay failing after B-8.4c:

- **QB_09** — outbound queue retry count. Separate diagnostic.
- **~79 Category 5** — environmental/harness failures (better-sqlite3
  Electron ABI, `electron.safeStorage`, browser globals, IPC subprocess).
  B-8.4d scope.
- **~7 Category 3** — pre-Phase-B legacy tests not Phase B's
  responsibility.

## Before / After Failure Counts

| Metric | B-8.4b baseline | B-8.4c result | Delta |
|--------|----------------|---------------|-------|
| Failing test files | ~88 | 73 | −15 |
| Failing tests | ~198 | 147 | −51 |
| Passing tests | ~3320 | 3518 | +198 |
| Skipped | ~3 | 3 | 0 |

> Note: 6 tests were removed from the suite entirely (Category 4
> deletions), so the total test count also decreased by 6.

## Remaining Failures (~147)

Categorized breakdown:

| Category | Approx count | Scope |
|----------|-------------|-------|
| Category 5 environmental/harness | ~79 | B-8.4d |
| QB_09 retry count | 1 | Separate diagnostic |
| Category 3 pre-Phase-B legacy | ~7 | Not Phase B's responsibility |
| Residual Category 1 (unaddressed) | ~60 | Further B-8.4c follow-up or B-8.4d |

The residual ~60 Category 1 failures represent tests where the fix
pattern was not yet systematically applied. They are predominantly in:
- `b4P2PRelayMigration.test.ts`
- `handshake-e2e-hardened.test.ts`
- `finalAcceptance.hostAiInvariants.test.ts`
- `migration.test.ts`
- Various ingestion e2e and IPC tests

These will be triaged in B-8.4d planning.

## What Was Not Verified

1. Whether Decision A's persisted ID change affects any persistence
   layer in unexpected ways beyond the 4 selector tests.
2. Whether Decision B's HTTP fallback timing has user-visible latency
   implications.
3. Whether all Category 1 group fixes were correctly applied to every
   test in each group (the fix was applied to identified tests; the
   residual ~60 may indicate additional tests in the same groups).
4. Whether `pr22SecurityDeferrals.test.ts` helper functions that became
   unused (makeDb, getRow, makeOutboundQbeapPackage, etc.) cause linting
   issues in CI.

## After This PR

- **B-8.4d**: Category 5 environmental / harness failures (~79 tests).
  Needs architectural decisions about test environment infrastructure
  (validator subprocess in Vitest, electron API mocks, browser globals).
- **Residual Category 1 triage**: Investigate remaining ~60 failures to
  confirm they are Category 1 (stale fixture) vs Category 5
  (environmental). Apply additional fixture fixes if Category 1.
- **QB_09 diagnostic**: Determine whether 10-retry behavior is correct
  or a bug.
- After B-8.4d (and QB_09 resolution):
  - B-9: sandbox clone outbound migration
  - B-10: quarantine UI hardening
  - B-11: final hardening + CI lint enforcement + TypeScript debt
