# Phase 1 — Hygiene & Guards: Phase Report

**Branch:** `refactor/wr-handshake-phase-1-hygiene-guards`
**Date:** 2026-07-24
**Constraint honoured:** zero schema and zero wire-format changes, except the additive `iss` columns in `coordination_handshake_registry` (server-side, lazy backfill).

---

## 1. What shipped

### 1.1 Full-claim identity guard (V6 / F2) — [VII.3.8–3.10]

One shared implementation now performs every identity comparison on ingest/ack/return paths:

- **`packages/ingestion-core/src/identityGuard.ts`** — `fullClaimIdentityMatch` (presented vs. bound claim set; exact match on issuer + subject + email + wrdesk id; no OR-logic, no sub-only shortcut), `samePrincipalFullClaim` (symmetric two-identity form), `isPartialIdentityCollision` (spoof-signal predicate: guard failed but *identifying* claims overlap). Placed in `@repo/ingestion-core` because both the Electron app and the coordination service already depend on it.

All four defect sites replaced (old comparators **deleted**, not wrapped):

| Defect site | Before | After |
|---|---|---|
| `handshake/steps/ownership.ts` | wrdesk-id-only ownership check | `fullClaimIdentityMatch` + sender-field consistency check; partial collisions fail as `HANDSHAKE_OWNERSHIP_VIOLATION` |
| `handshake/handshakeAccountIsolation.ts` | OR-logic `sessionMatchesParty` | `classifyPartyForSessionVisibility` on the full-claim guard; Q12 mixed-realm rows stay visible but are flagged `mixed-realm-repair` (repair UX), never silently invalidated |
| `coordination-service/auth.ts` | sub-only ack binding | `ValidatedIdentity.iss` added; `RESOLVER_VERSION` → 3; token cache hash salted with the issuer |
| `coordination-service/server.ts` (relay identity) | issuer dropped | `wsManager` binds `iss` per connection; `beap_ingest_ack` requires a full-claim match against the registered principal (`identityMatchesRegisteredPrincipal`) |

Additional call sites audited and migrated: `internalInference/policy.ts` (`handshakeSamePrincipal` → `samePrincipalFullClaim`; `assertRecordForServiceRpc` is strictly tighter), `internalInference/hostAiPeerLivePresence.ts` (session/party gates now full-claim).

**Server-side `iss` persistence:** additive `initiator_iss` / `acceptor_iss` columns (`DEFAULT NULL`) on `coordination_handshake_registry`; lazy backfill on next registration; first-write-wins with conflicting re-registration refused (`handshake_principal_mismatch`, HTTP 403). Rows without a recorded `iss` keep working on `sub` until re-registration (the documented backfill window).

### 1.2 Receiver-side ingress admission filter (E2 groundwork) — [VII.2.7]

**`handshake/ingressAdmission.ts`** (`admitInboundDelivery`) is the first ingress stage for all inbound deliveries. It enforces: relationship exists → state is operational (`ACTIVE`/`ACCEPTED`) → full-claim sender guard (when the transport authenticates a sender) → `sharing_mode`/`effective_policy` scope for context-bearing deliveries. Blocked transmissions die **pre-visibility** (no inbox row, no placeholder, no dashboard notification) and write an `INGRESS_ADMISSION_BLOCKED` audit-log record. The signature takes an extensible input object so Phase-5 grant refs slot in without restructuring.

Wired at every inbound entry point (there is no single choke point today):

- `email/beapEmailIngestion.ts` — Stage 0 of `processBeapPackageInlineInternal` (BEAP inbox path, previously vault-check-only admission).
- `handshake/enforcement.ts` — Stage 0 of `processHandshakeCapsule` (control-plane capsules; formation capsules with no record yet are admitted — the state machine owns them).
- `email/messageRouter.ts` — email-borne BEAP packages; blocked packages skip decrypt/validate and take the encrypted quarantine containment path, never the BEAP inbox.

This is the substrate Phase 4 needs: a revoked relationship already causes inbound transmissions to die silently at this stage.

### 1.3 Dead-path removal (C14 / A11 / A12)

- `skipConsentForAutomation` deleted from the extension policy schema ([VII.10.5.5]: no auto-accept control may be representable).
- `handshake/handshakeVerification.ts` (unused verifier) deleted, with its test file.
- `verifyContextVersions` (no-op step) deleted from the pipeline and `steps/contextVersions.ts` removed.
- `handshake/__tests__/structuralAbsence.test.ts` walks the source tree and fails on any reintroduced reference.

---

## 2. Realm-distribution inventory (Q12 risk gate)

Mechanism: `handshake/realmInventory.ts` (`inventoryRealmDistribution`, logged via `logRealmDistributionInventory`) plus `scripts/realm-inventory.py` for offline ledger inspection.

Counts from the local ledger at enforcement time:

| Metric | Count |
|---|---|
| Total handshake rows | 1 |
| By state | ACTIVE: 1 |
| By type | internal: 1 |
| Distinct issuer hosts | 1 (`auth.wrdesk.com`) |
| Rows with missing initiator/acceptor `iss` | 0 / 0 |
| Cross-realm pairs | 0 |
| Cross-realm same-sub / same-email (mixed-realm risk class) | 0 / 0 |

No mixed-realm rows exist locally, so guard tightening has **zero repair-UX impact** on this ledger. The `mixed-realm-repair` visibility flag in `handshakeAccountIsolation.ts` remains in place for ledgers where the inventory is non-zero.

---

## 3. Acceptance-test status

1. **Cross-SSO rejection [VII.3.8/3.10]** — green. Regression tests at all four defect sites: `handshake/__tests__/enforcement.test.ts` (ownership), `handshake/__tests__/ingressAdmission.test.ts` (ingress guard, same-sub/different-issuer), `packages/coordination-service/__tests__/handshakeRegistry.identity.test.ts` (ack binding, sender authorization, recipient resolution, lazy backfill, first-write-wins), `internalInference/__tests__/hostAiPeerLivePresence.test.ts` (same email/wrdesk-id under a different issuer denied). Guard unit suite: `packages/ingestion-core/__tests__/identityGuard.test.ts`.
2. **Pre-visibility blocking [VII.2.7]** — green. `ingressAdmission.test.ts` (16 tests) plus `b4P2PRelayMigration.test.ts` §1.2/§1.2b assert the BEAP inbox path passes through the filter: unknown and revoked relationships produce an `error` outcome with `ingress_admission_*` reason, zero inbox/quarantine rows, and an `INGRESS_ADMISSION_BLOCKED` audit record.
3. **Structural absence [VII.10.5.5]** — green. `structuralAbsence.test.ts` proves no `skipConsentForAutomation`, no `verifyContextVersions`, no `handshakeVerification` reference anywhere in source.
4. **Do-not-regress** — no regressions. `internalInference.directHost.regression.test.ts`: all load-bearing invariants pass (no `p2p_pending_beap` enqueue, all authorization gates). Forbidden-key coverage (`relayP2pSignalHandler.republishRequest`, `hostAiP2pSignalSchemaRejectLog`, `critical-jobs/remote relayExclusion`) passes.

**Baseline-parity proof:** the handshake + internalInference + email scope was run on the clean tree and on this branch with JSON reporters; per-file failing-test sets were diffed programmatically. The only differing files are this phase's new/fixed suites (all green). Every other failing file is byte-identical pre/post — i.e. pre-existing local-environment failures, not Phase-1 regressions.

Suite results on this branch (local, Node runtime):

| Suite | Result |
|---|---|
| `packages/ingestion-core` | 90 passed |
| `packages/coordination-service` | 139 passed, 2 pre-existing failures (see §4) |
| `handshake/__tests__/enforcement.test.ts` | 87 passed |
| `handshake/__tests__/ingressAdmission.test.ts` | 16 passed |
| `handshake/__tests__/structuralAbsence.test.ts` | passed |
| `email b4P2PRelayMigration` + `pbeapTrustPersistence` | 17 passed |
| `internalInference hostAiPeerLivePresence` | 11 passed |

## 4. Pre-existing failures observed (identical on clean tree; out of Phase-1 scope)

- `coordination-service/__tests__/sandboxEgressGuard.test.ts` — 2 tests get 422 where 413 (over-cap) / 429 (rate-limit) are expected.
- `internalInference.directHost.regression.test.ts` — 2 `runSandboxHostInferenceChat` cases fail locally with `E_SEALED_RPC_MISSING_PEER_X25519` (sealed-RPC peer key absent in this environment).
- `relayP2pSignalHandler.stale.test.ts` — fails at import (`registerP2pEnsureCacheInvalidator is not a function`), a module-mock breakage on main.
- ~31 electron test files (mostly internalInference + email ingestion-poll rigs) fail in the local Node environment identically pre/post; their failure sets were diffed test-by-test to prove parity.

Incidental fixes landed while making suites runnable locally: `coordination.test.ts` outdated `upgrade_url` assertion (`optirando.com/pricing`), b4 suite now binds both seal-key slots and mocks the vault capability gate (hermetic, mirroring the pbeapTrust suite).

## 5. Exit criteria checklist

- [x] All acceptance tests automated and green (new failures: none; parity proven against baseline).
- [x] Realm-distribution inventory included above.
- [x] Shared guard is the single identity-comparison implementation; old comparators deleted (`sessionMatchesParty`, `samePrincipal`, wrdesk-id-only ownership check).
- [x] No schema changes except additive `initiator_iss`/`acceptor_iss` server-side with lazy backfill.
- [x] No wire-format changes.
