# Phase 3 — Profile Registry & Core Store Split: Phase Report

Branch: `refactor/wr-handshake-phase-3-profile-registry-core-store`
Date: 2026-07-24

## 1. What shipped

### 1.1 Profile registry with fail-closed dispatch (B1–B4, B7) — [VII.4.1–4.2]

- `packages/ingestion-core/src/profileRegistry.ts` — profiles are **registry
  records**, not code branches. Each `WrProfileRecord` fixes: id + version,
  role symmetry, **signature cardinality** (parameterizing the Phase-2
  signature-list verification), mutual-consent requirement, **attestation
  requirement** (`mandatory | forbidden | optional`), permitted ingress paths
  (formation-time recording only — log-only at runtime [VII.4.6]), permitted
  grant vocabularies (empty, reserved-inert until Phase 5), and the Q2
  `frozen_for_new_grant_types` flag.
- Initial content — exactly the five briefed records:
  - `pbeap_publisher` (asymmetric; attestation **mandatory**; 1 sig)
  - `private_personal` (symmetric; attestation **forbidden at schema level**
    [VII.4.5]; 1 sig + mutual consent)
  - `org_internal` (symmetric; **2 sigs**, countersigned byte-identical core
    [VII.3.2])
  - `org_cross` (symmetric; **2 sigs**)
  - `legacy_v0` (Q2 — blesses historical signature discipline; migrated rows
    stay operational, **frozen for new grant types**; no forced
    re-establishment)
- `resolveProfile(id, version)` is **fail-closed**: unknown id →
  `unknown_profile`, unsupported version → `unsupported_profile_version`; no
  fallback record, no default branch. No conversion/upgrade path exists
  [VII.4.7]; `optirando.handshake.prior_ref` and
  `optirando.attestation.publisher` stay registered-inert in
  `containers.ts::RESERVED_NAMESPACES`.
- **Dispatcher wiring** — `canonicalCore.ts::verifyCanonicalEnvelope` is the
  single entry point for profile semantics on the receive path:
  1. profile dispatch (fail-closed, names the profile in the refusal),
  2. per-profile **signature cardinality** over *distinct* valid keys (the
     same key twice is one signature; a countersignature over differing
     bytes cannot verify — `bytesForMode` binds both modes to the same
     canonical core value [Q3]),
  3. schema-level **attestation rules** via `checkProfileContainerRules`.
- `enforcement.ts` Stage 0c maps refusals to visible reason codes:
  `UNKNOWN_PROFILE` (unknown id / unsupported version) and
  `PROFILE_SCHEMA_VIOLATION` (attestation presence/absence, cardinality),
  with `refused_profile` (`id@version`) recorded in the denial audit entry.
  Refusals are pre-visibility: no relationship row materializes.

### 1.2 Parallel core store + runtime split (G1–G3) — [XI.LB§6 seam]

- Migration **v75** (`db.ts::HANDSHAKE_MIGRATIONS`) creates:
  - `wr_handshake_core` — **append-only**: SQLite `BEFORE UPDATE` /
    `BEFORE DELETE` triggers `RAISE(ABORT)`, so immutability is enforced by
    the store itself, not writer discipline. Columns: `core_hash` (PK),
    `handshake_id` (unique), `profile_id`, `profile_version`, `core_version`,
    `core_json` (canonical serialization), `signatures_json`,
    `capture_provenance`, `backfilled`, `created_at`.
  - `wr_handshake_runtime` — mutable operational slice (state, sharing mode,
    seq counters, capsule-hash chain heads, p2p endpoint/tokens, effective
    policy, repair flags), keyed by handshake, referencing the core by hash.
- **Never in-place ALTER**: the ~60-field mutable `handshakes` table is
  untouched and remains the **read authority** during the transition window.
- `coreStore.ts` — the single adapter surface:
  - `adaptRecordToCoreStore` is called from the two legacy writers
    (`insertHandshakeRecord`, `updateHandshakeRecord`) and dual-writes core
    (insert-once) + runtime (upsert). Existing dialects keep writing through
    the thin adapter; eliminating the dialects is Phase 4.
  - `insertCoreRecord` passes the Phase-2 **anti-rollback high-water gate**
    (`object_class = 'wr.handshake.core'`); a differing core for an existing
    handshake is refused — profile/core immutable, "convert" = new
    handshake [VII.3.3].
  - `deleteHandshakeRecord` removes only the runtime mirror; core rows are
    append-only history and survive.
- **Backfill (G2)**: `backfillWrCoreStore` runs at the end of
  `migrateHandshakeTables` (non-frozen handles only), inside one
  transaction: one synthetic `legacy_v0` core per existing row with
  `ingress_path = null`, `capture_provenance = 'unknown_legacy'`,
  `backfilled = 1`, **empty signature list** — never fabricated signatures,
  countersignatures, or provenance. The synthetic core is deterministic over
  the row's immutable identity fields (parties, relationship id, creation
  instant), so re-runs are hash-stable no-ops.

### 1.3 Ledger freeze & key sweep (G5, prep for Q10)

- `LEDGER_SCHEMA_FREEZE_VERSION = 74` (`db.ts`):
  `migrateHandshakeTables(db, { freezeAtVersion })` skips every migration
  past the freeze — v75+ (core store split and everything after) never
  lands on `handshake-ledger.db`.
- **Persisted freeze marker**: `openLedger` writes
  `ledger_meta('wr_schema_freeze', '74')` before migrating, and
  `migrateHandshakeTables` reads it when called **without options** — this
  closes the real-world hole where the ingestion IPC layer lazily calls
  `migrateHandshakeTables(db)` on whatever handle it received (the ledger is
  the active pipeline DB while the vault is locked). Handles without
  `ledger_meta` are never frozen.
- `ledgerHygiene.ts` — one-time (idempotent, re-runnable) sweep wired into
  `openLedger`:
  - re-asserts row-level key hygiene (v73 copy-before-null semantics) for
    rows written by pre-v73 builds after the migration already ran;
  - copies any **undocumented table** (audited against
    `documentedHandshakeTableNames(≤74)` + the four ledger-native tables)
    verbatim into a JSON sidecar next to the DB, then drops it
    (copy-before-remove; a failed copy blocks the drop);
  - `assertLedgerHygiene` verifies documented-tables-only, zero key-material
    values on relationship rows, and `PRAGMA integrity_check` — logged on
    every ledger open.

### 1.4 ingress_path registry (Q4 groundwork)

- `packages/ingestion-core/src/ingressRegistry.ts` — initial identifiers
  registered: `wr_code_public`, `wr_code_red`, `beap_invitation`,
  `relay_code_claim`, `optirando_code_entry`, reserved `wr_ad`, and
  `optirando.ingress.file_import`. Values are recorded on **new** formations
  only from Phase 4; backfilled rows keep `ingress_path = null`.
- The Phase-2 lint/test guard (`ingressPathLogOnly.guard.test.ts`) stays
  green: no semantic branch on `ingress_path` anywhere in repository source
  (the registry and core store only construct/validate/log it).

### 1.5 Security fix found en route: Ed25519 seed-branch signing

`canonicalCore.ts::privateKeyFromHex` and
`signatureKeys.ts::signCapsuleHash` both used
`generateKeyPairSync('ed25519', { seed })` for 64-char-hex keys. Node has
**no seed option** for that call — it silently returns a *random* keypair,
so any raw-seed key produced signatures that never verify. Production keys
are PKCS#8 DER hex (the other branch), so shipped capsules were unaffected,
but the defect was live for any seed-format key. Both sites now wrap the
seed in a proper RFC 8410 PKCS#8 DER prefix (`302e…0420 ‖ seed`). Found by
acceptance test 3 (countersignature gate).

## 2. Acceptance tests → results

| # | Test | Where | Result |
|---|------|-------|--------|
| 1 | Unknown-profile refusal [VII.4.2] — unknown id + unsupported version, visible refusal naming the profile, no fallback, pre-visibility through the real pipeline | `phase3ProfileRegistry.acceptance.test.ts` | PASS |
| 2 | Schema-level attestation rejection [VII.4.5] — `private_personal` + publisher_attestation rejected by schema (unit + real pipeline → `PROFILE_SCHEMA_VIOLATION`); `pbeap_publisher` without attestation rejected | `phase3ProfileRegistry.acceptance.test.ts` | PASS |
| 3 | Countersignature gate [VII.3.2] — `org_internal`/`org_cross` need 2 distinct valid signatures over the byte-identical core; differing-bytes countersig rejected; same-key-twice rejected | `phase3ProfileRegistry.acceptance.test.ts` | PASS |
| 4 | Migration parity (a)–(d) — row-count parity handshakes ↔ core + runtime; every legacy row → dispatcher-accepted `legacy_v0` core (no fabricated signatures/provenance, high-water tracked); post-migration refresh/revoke round-trips (runtime mirrors, core frozen); key material resolves via the Phase-2 key store; backfill idempotent | `phase3CoreStoreSplit.acceptance.test.ts` | PASS |
| 5 | Hash stability (T2) — hash stable across independent equal constructions, serialize/parse round-trips, file-backed reopen + migration re-run; UPDATE/DELETE on `wr_handshake_core` aborted by triggers; structural scan: no source writer targets the table | `phase3CoreStoreSplit.acceptance.test.ts` | PASS |
| 6 | Ledger hygiene (G5) — frozen handle never receives v75+ (explicit + lazy no-options call); sweep moves row keys to key store and nulls columns; undocumented table copied out to sidecar then dropped; post-sweep hygiene assertion `{ok, keyColumnsClear, integrityOk}` on both handles | `phase3LedgerFreeze.acceptance.test.ts` | PASS |
| 7 | Do-not-regress suite | see §3 | PASS (3 known pre-existing failures, see §3) |

30/30 Phase-3 acceptance tests green.

## 3. Do-not-regress evidence

- Handshake suite (`electron/main/handshake`, 77 files): **76 passed**;
  the only failing file is `outboundQueue.backoff.test.ts` (9 tests) —
  **pre-existing**: commit `34e26f42` ("Strip legacy :51249 direct-LAN P2P
  ingest plane") retired the direct-relay path in `outboundQueue.ts`
  (preflight-fails all non-coordination sends) without updating the test.
  This branch never touched `outboundQueue.ts`.
- `internalInference.directHost.regression.test.ts`: 2 failures
  (`E_SEALED_RPC_MISSING_PEER_X25519`) — **pre-existing**, confirmed against
  the clean baseline during the Phase-2 sweep; unrelated to key extraction
  (that code path is missing the *peer public* X25519 key).
- `relayP2pSignalHandler.stale.test.ts`: collection error
  (`registerP2pEnsureCacheInvalidator is not a function`) — **pre-existing**
  module-mocking issue confirmed on the clean tree in Phase 1. The other
  p2p-signal suites (20 tests incl. forbidden-key checks) pass.
- `b4P2PRelayMigration.test.ts` + `pbeapTrustPersistence.regression.test.ts`:
  all pass (30 tests).
- `packages/ingestion-core`: 107/107 pass.
- `packages/coordination-service`: 141/141 pass.
- `ingressPathLogOnly.guard.test.ts` (Phase-2 A2 guard): passes with the
  new registry/core-store code in scope.

## 4. Migration dry-run evidence

No production DB copies exist on this development machine
(`~/.opengiraffe/electron-data` is empty), so the dry-run harness runs
against **fixture DBs in the exact pre-split shape**: created via
`migrateHandshakeTables(db, { freezeAtVersion: 74 })` (byte-shaped by the
full production migration chain v1→v74), populated with real-shape rows
through the production writers, then upgraded with the real
`migrateHandshakeTables(db)` call. Harness output (automated, re-runnable):

```
[WR-CORE] legacy_v0 backfill: { scanned: 3, backfilled: 3, alreadyPresent: 0, failed: 0 }
(a) row-count parity: handshakes(3) == wr_handshake_core(3) == wr_handshake_runtime(3)   PASS
(b) legacy_v0 dispatcher-accepted, backfilled=1, provenance=unknown_legacy, sigs=[]      PASS
(c) refresh + revoke round-trips; runtime mirrors; core byte-identical                    PASS
(d) key store resolves local_private_key post-split; rows stay null                       PASS
idempotent re-run: alreadyPresent=1, core rows byte-identical                             PASS
```

**Operator step before shipping to a machine with live data**: run the same
harness against copies of the real vault + ledger files (the harness is the
`phase3CoreStoreSplit` + `phase3LedgerFreeze` acceptance files; point a copy
at the fixture path). The backfill itself is idempotent and non-destructive
(additive tables only), and the sweep copies out before it drops.

## 5. `handshake_type` inventory (for Phase 4 elimination)

Grep-level inventory across repository source (tests excluded):
**249 occurrences in 78 files**, of which **100 comparison-branch sites
(`handshake_type ===/!==`) in 49 files**. No new reads were added by this
phase (the core store records profile ids, not `handshake_type`; the
transition adapter maps every row to `legacy_v0` regardless of type).
Heaviest branch concentrations to eliminate in Phase 4:

- `electron/main/handshake/`: `ipc.ts`, `enforcement.ts`,
  `internalPersistence.ts`, `steps/internalRoutingCapsule.ts`,
  `steps/ownership.ts`, `capsuleBuilder.ts`, `initiatorPersist.ts`,
  `recipientPersist.ts`, `revocation.ts`, `contextSyncEnqueue.ts`,
  `p2pTransport.ts`, `internalRelayOutboundGuards.ts`,
  `handshakeAccountIsolation.ts`, `topologyAutoWire.ts`
- `electron/main/internalInference/` (17 files — Q9: same-user pairing
  becomes the Internal Handshake **profile**; these become profile-record
  reads)
- `electron/main/p2p/`: `relaySync.ts`, `relayPull.ts`, `relayIdentity.ts`,
  `coordinationWs.ts`, `coordinationSamePrincipalInbound.ts`
- UI: `HandshakeWorkspace.tsx`, `HandshakeView.tsx`,
  `AcceptHandshakeModal.tsx`, extension handshake components ("Cross-Device"
  stays as the UI label per Q9)
- `packages/shared/src/handshake/` + `packages/coordination-service/src/server.ts`

## 6. Rollback plan (store split — transition window)

- The legacy `handshakes` table remains the **read authority**; nothing
  reads `wr_handshake_core`/`wr_handshake_runtime` for behavior yet. The
  split tables are additive and append-only.
- **Rollback = stop consulting the new tables.** No data migration to
  reverse: the legacy table never stopped being complete. Dropping the two
  v75 tables (or ignoring them) loses no operational state.
- The adapter is failure-isolated: a core-store write error logs and never
  fails the relationship write.
- Ledger freeze rollback: delete the `ledger_meta('wr_schema_freeze')` row
  and the ledger resumes receiving migrations (not recommended — documented
  for completeness). The sweep's sidecar JSON retains any removed
  undocumented tables for restoration.
- The read-authority flip (legacy table becomes read-only) is a Phase-4
  step, gated on the one-pipeline writers landing.

## 7. Exit criteria

| Criterion | Status |
|---|---|
| All acceptance tests green | Yes — 30/30 (§2) |
| Dry-run evidence attached | Yes — §4 (fixture-shaped; operator step for real DB copies documented) |
| Dispatcher is single entry for profile semantics | Yes — `resolveProfile`/`checkProfileContainerRules` consumed only via `verifyCanonicalEnvelope`; no other code branches on profile ids |
| No `handshake_type` reads added; existing reads inventoried | Yes — §5 (249 occurrences / 78 files / 100 branch sites) |
| Ledger frozen | Yes — v74 freeze via option + persisted `ledger_meta` marker; lazy-migration hole closed and regression-tested |
| Rollback plan documented | Yes — §6 |

## 8. Deviations / notes for Phase 4+

1. **Key material stays in the ledger-local `handshake_key_store`** (a
   documented ≤v74 table). The ledger is the active pipeline DB while the
   vault is locked, so relationships formed through it must keep signing
   (Phase-2 invariant). Full key relocation off the ledger is coupled to its
   Phase-5 repurposing as the Tier-L evidence home (Q10). The sweep
   guarantees keys never sit on **relationship rows**.
2. **Adapter-written new rows also carry `capture_provenance =
   'unknown_legacy'`** (with `backfilled = 0` distinguishing them). Real
   provenance recording starts with the one pipeline in Phase 4 [IX.3.1
   rule 5]; fabricating provenance for dialect-written rows would violate
   the never-fabricate rule.
3. **Countersignature acquisition is not implemented** — the gate verifies
   cardinality when a 2-sig core arrives; producing `org_internal` /
   `org_cross` cores (collecting the responder countersignature) is Phase-4
   formation work. Phase-3 emissions remain `legacy_v0` (1 sig).
4. `wr_handshake_runtime.repair_flags_json` currently carries only
   `internal_coordination_repair_needed`; the full repair-flag family
   migrates when the read authority flips.
5. Pre-existing test failures (outboundQueue.backoff; directHost ×2;
   relayP2pSignalHandler.stale collection) are unchanged — none touched by
   this phase; candidates for cleanup alongside Phase 4's transport work.
