# Phase 4 — One Formation Pipeline: Phase Report

Date: 2026-07-24 · Branch: `refactor/wr-handshake-phase1` (continued) · Baseline: Phase 3 commit `cdf45fd0`

Hard sequencing honored: **Connect-offer/capture flow built first → auto-insert flipped off second → revoke-notify capsule removed last** (§5 records the evidence).

## 1. What shipped

### 1.1 Single formation pipeline (V1) — [VII.4.6, IX.3.1]

- New module `handshake/formationPipeline.ts` is the ONE pipeline. It dispatches on Phase-3 profile-registry records and is the only consent-gated path into the relationship store.
- The four dialects are **deleted, not bypassed**:
  - `initiatorPersist.ts` — deleted; replaced by `formInitiatorRelationship` (the user's explicit creation act is the consent event; a hash-pinned initiator consent record is written before the insert).
  - `recipientPersist.ts` — deleted; .beap file imports terminate in the Connect-offer gate. The `ipc.ts:853-860` force-internal UPDATE is gone; the same-account import case is now the declared compat parameter `profile_id_override: 'internal_device'` into staging.
  - The inbound 24-step pipeline no longer auto-inserts: `enforcement.ts` stages verified inbound initiates (`stageInboundInitiate`) and only re-entry with a `formationConsent` ref creates the record (`HandshakeProcessStaged` result type).
  - Edge-agent pairing — retired for new formations (§1.4).
- `handshake_type: 'internal' | 'standard'` branching **eliminated**. The admission situation is the profile-registry parameter `same_principal` (Q9: `internal_device` profile, UI label "Cross-Device"). `HandshakeRecord` no longer declares `handshake_type`; ~40 production files were converted to read `record.same_principal` / profile records.
  - Wire compat boundaries (declared, tested): `samePrincipalWire.ts` (single legacy-wire reader: `wireDeclaresSamePrincipal`, `legacyWireHandshakeType`), `db.ts` (frozen legacy column read/write only), `p2pTransport.ts` (relay envelope field parse), `coordination-service/server.ts` (relay wire parse/log). v2 wire capsules keep carrying `handshake_type` for old peers (Phase-2 dual-format discipline).
- `steps/internalRoutingCapsule.ts` semantic branching removed: internal-routing validation now keys on the wire declaration/profile record, and legacy wire emission goes through `legacyWireHandshakeType(true)`.
- `ingress_path` is written by the pipeline per the Q4 mapping (`SOURCE_INGRESS_MAP`) and stays **log-only** (acceptance 3 lint enforces no literal-value branch).

### 1.2 Capture methods + Connect-offer staging (V2, C1–C3) — [IX.3.1]

- `packages/ingestion-core/src/captureMethods.ts`: capture-method registry — `scan` (enum slot, fail-closed stub), `manual_entry` (Q5: 6-digit pairing code interim-conforming as `optirando_code_entry`), `assisted_email`, `assisted_discovery` (slot + stub). Invitation classes: `public_bearer` implemented; `targeted_bound` registered refusal-only [IX.3.2].
- `handshake/connectOfferStaging.ts`: staging store in its **own** SQLite file (`connect-offers.db`) — deliberately outside both relationship DB handles (vault DB and the v74-frozen ledger). Tables: `wr_connect_offers`, `wr_consent_records`, `wr_connect_offer_meta`.
- Q1: inbound invitations (email `beapSync`, relay pull, coordination WS, ingestion RPC, .beap import) stop creating `PENDING_REVIEW` rows. Flow: verification chain → client-generated Connect offer → consent → record. Q6: capsule-by-email remains a legitimate transport but always terminates in this gate.
- Failed verification **suppresses the offer entirely** — the row persists as a logged record but is structurally unreachable (never listable, never consentable); no override control exists (acceptance 2 asserts structural absence).
- Q7: staged offers keep the exact 7-day timeout (`INPUT_LIMITS.PENDING_TIMEOUT_MS`); `expireStaleOffers` sweeps.
- Capture provenance (method + source reference + consent id) is a signed contract field: `buildFormationCore` emits the `optirando.decl.capture_provenance` declaration inside the core containers on NEW formations only; backfilled rows keep `unknown_legacy` — provenance is never fabricated.
- Hash-Pinned Consent [IX.3.4]: consent records bind **preview hash + bound-definition hash + contract-state hash**. The preview is client-generated from verified capsule material only (never counterparty free text) and canonically hashable at presentation time (domain-tagged SHA-256 over the Phase-2 canonical JSON — the Intent-Hash substrate for Phase 5). `consentRecordResolves` invalidates any consent whose hashes no longer resolve; `expectedPreviewHash` pins consent to the preview the user actually saw.

### 1.3 Silent revocation completed (V5) — [VII.10.7.2–7.4]

- The peer-notify revoke capsule (`revocation.ts:108-170`) is **removed**. `revokeHandshake` now: mark REVOKED → audit entry → close P2P session → un-wire topology → renderer callback. No outbound capsule, no bounce, no counterparty-visible state change. Call sites dropped the `session`/`getOidcToken` arguments.
- Enforcement is exclusively the Phase-1 receiver-side ingress filter (`ingressAdmission.ts`): post-revocation inbound transmissions die pre-visibility with an `INGRESS_ADMISSION_BLOCKED` audit record, for both `beap_message` and `handshake_capsule` classes.
- Cross-version risk verified explicitly: old-build peers keep a zombie ACTIVE record and keep transmitting; the acceptance test simulates exactly that and shows the sends die at the filter.
- Q8: revocation no longer deletes context blocks, embeddings, or audit rows — evidence and digests persist. Content deletion is the separate explicit operator action `deleteRevokedRelationshipContent` (new RPC `handshake.deleteRevokedContent`), valid only on already-REVOKED relationships; it logs itself and never touches audit rows.
- Inbound revoke capsules from old peers are still accepted (rig test carries a peer-built revoke capsule over a real relay); re-handshake reanimates nothing (unchanged).

### 1.4 Edge-agent fold-in (V8 / I3) — [XI.3-I9]

- Finding: this codebase contains only the agent-side compiled dist (`apps/edge-agent/dist/pairingProtocol.js` etc.); the orchestrator-side counterpart that would create `edge_ingestor` ledger rows ("PR8") never landed here. The dialect is therefore **retired for new formations** rather than adapted.
- `RETIRED_FORMATION_DIALECTS = ['edge_ingestor']` in the profile registry: never registered as a profile, resolves to a fail-closed `unknown_profile` refusal, no adapter maps it anywhere. New same-principal device pairings form exclusively through the one pipeline under `internal_device`.
- Transition window: existing edge-agent pairings remain readable by the agent's own encrypted state store (agent dist untouched — read-only). **Lockstep-upgrade expectation:** deployed agents must be upgraded together with the orchestrator before any new pairing is attempted; there is no orchestrator-side code that can complete the old pairing protocol.
- Structural test: no production source in the Electron app, extension, or packages references `edge_ingestor` (single permitted mention: the retired-dialect registry marker).

## 2. Acceptance tests → results

| # | Test | Where | Result |
|---|---|---|---|
| 1 | No formation outside capture + consent [IX.12.1] | `phase4OneFormationPipeline.acceptance.test.ts` (staging-only inbound; single-writer structural scan; dialects stay deleted) | green |
| 2 | Offer suppression [IX.3.1 rule 2] | same file (unreachable from every read surface; logged record persists; no "connect anyway"; single staging read surface) | green |
| 3 | Ingress-path neutrality [VII.4.6] | same file (lint: no literal-value comparison on `ingress_path`/`capture_method`; same profile → same rights across paths; Q4 mapping total) | green |
| 4 | `handshake_type` elimination | same file (record model clean; no branch outside the four declared wire boundaries; no `'standard'` writes) | green |
| 5 | Silent revocation [VII.10.7.2] | `phase4SilentRevocation.acceptance.test.ts` (no outbound capsule; structural absence in revocation.ts; zombie-peer sends die pre-visibility with logged record; Q8 evidence survives; explicit operator deletion; idempotence) | green |
| 6 | Provenance + Hash-Pinned Consent [IX.3.1 rule 5, IX.3.4] | `phase4OneFormationPipeline.acceptance.test.ts` (provenance in signed contract; three-hash resolution; tamper → invalid; presentation pin; 7-day expiry; no counterparty free text in preview) | green |
| 7 | Edge agent | `phase4EdgeAgentFoldIn.acceptance.test.ts` (retired dialect fail-closed; `internal_device` is the one mechanism; structural absence of `edge_ingestor` writers) | green |
| 8 | Do-not-regress | §3 | green (pre-existing failures unchanged) |

Deep links: no formation semantics existed and none were added; the acceptance-1 single-writer structural test guarantees no deep-link handler can create relationship rows (the only writers are the consent-gated pipeline sites).

## 3. Do-not-regress evidence

- **Handshake suite**: 740 passed / 29 todo across 80 files. Sole failing file: `outboundQueue.backoff.test.ts` (9 failures) — pre-existing since commit `34e26f42` (pre-Phase-1), documented in the Phase-2/3 reports.
- **Wide sweep** (`p2p`, `internalInference`, `packages/shared`, `packages/ingestion-core`, `email`; 1303 tests): failure set is **byte-identical** to the Phase-3 baseline — 0 new, 0 fixed. Baseline method: a clean worktree of `cdf45fd0` at `C:\wrdesk-p3-baseline` with a Node-ABI `better-sqlite3` binary. (An earlier baseline run without the native binding silently *skipped* every DB-backed test and made ~20 email sealed-storage failures look like Phase-4 regressions; with the binding restored they reproduce identically at the Phase-3 commit — environment artifact, not regression.)
- **`internalInference.directHost.regression.test.ts`**: 13/15, the 2 failures are the known pre-existing `E_SEALED_RPC_MISSING_PEER_X25519` items (identical at baseline).
- **`relayP2pSignalHandler` forbidden-key checks**: `relayP2pSignalHandler.republishRequest.test.ts` green; `relayP2pSignalHandler.stale.test.ts` suite-fails on the known pre-existing `registerP2pEnsureCacheInvalidator` mock issue (identical at baseline).
- **coordination-service**: 141 passed; 2 pre-existing `sandboxEgressGuard` failures (reproduced at the Phase-3 commit).
- One true Phase-4 regression was found by the baseline diff and fixed: `computeSamePrincipalCoordinationSkipOwn` tests passed the renamed `capsuleDeclaresSamePrincipal` parameter under its old name; updated, 10/10 green.
- Typecheck: no new errors in touched files (the `ReasonCode.UNAUTHENTICATED` and `getOidcToken` scoping errors in `main.ts`/`ipc.ts` predate Phase 4 verbatim at `cdf45fd0`).

## 4. Sequencing evidence (exit-criteria requirement)

1. **Connect-offer gate first**: the staging store, consent gate, and `connectOfferConsentTestKit.ts` were built and the email/relay onboarding rigs (`pairingActivation.rig.test.ts`, `revokeRepair.rig.test.ts`, `e2e.pipeline.test.ts`, `postAcceptContextSync.ingestPaths.regression.test.ts`) were driven green **through the real staged → consent → record path** (the test kit is not a bypass: it walks `prepareFormationConsent` and re-ingests with the `formationConsent` ref exactly like the production `handshake.accept` / `handshake.consentToConnectOffer` flows) — before the auto-insert removal was finalized.
2. **Auto-insert off second**: `enforcement.ts`/`beapSync`/`relayPull`/`coordinationWs` handle `HandshakeProcessStaged`; `initiatorPersist.ts` and `recipientPersist.ts` deleted only after the rigs above proved end-to-end formation via the gate.
3. **Revoke-notify removal last**: the ingress-filter assertions (16/16 in `ingressAdmission.test.ts`, including revoked → blocked-with-audit-record for both delivery classes) were verified green in this session **before** `revocation.ts` was rewritten; the zombie-peer assertions in `phase4SilentRevocation.acceptance.test.ts` went green immediately after.

## 5. Deviations / notes for Phase 5+

- **Q4 mapping granularity**: transports that cannot yet distinguish capture context (p2p / relay / WS / api / extension) all record `beap_invitation` + `assisted_email`. Refining per-transport capture methods is UI/product work; values are log-only so this is a rendering fidelity issue, not a semantics one.
- **`p2pTransport.ts` / `coordination-service` wire fields**: these parse the legacy `handshake_type` wire field for envelope validation and relay logging. They are declared wire boundaries in acceptance test 4; when the v3 canonical form becomes the only accepted wire (post dual-format window), they shrink to the v3 profile field.
- **`vaultCapabilities.handshake_types`**: name collision only — a vault capability-policy allowlist of free-text "types" (`support`, `sales`, …), unrelated to the eliminated discriminator. Left untouched.
- **Edge agent**: if the orchestrator-side pairing client is ever revived, it must be built as an `internal_device` capture flow (`optirando_code_entry`), not by resurrecting `pairingProtocol.js`. The dist stays only to keep deployed agents' existing state readable.
- **Intent-Hash substrate ready**: `buildConnectOfferPreview` + domain-tagged canonical hashing is the presentation-time hash surface Phase 5's PoAC/PoAE work reuses.
- **Staging store backups**: `connect-offers.db` is intentionally excluded from the relationship-DB backup story — staged offers are re-derivable from re-delivered invitations; consent records for *formed* relationships are additionally referenced from core-store provenance (`consent_id` in the capture-provenance declaration).
