# Phase 2 — Canonical Core: Phase Report

Branch: `refactor/wr-handshake-phase-2-canonical-core`
Date: 2026-07-24
Scope reference: Phase-2 order + `00_Master-Brief.md`

## 1. What shipped

### 1.1 Canonicalization module + full-coverage signing (A8) — [VII.6.1.3, XII.5 pattern]

- **`packages/ingestion-core/src/canonical.ts`** — the shared canonicalization
  module: deterministic byte-identical JSON serialization (sorted keys, UTF-8,
  integer-preserving number rules, `undefined`-property elision = absence of
  field, rejection of non-canonical values like `NaN`/`±Infinity`/`-0`
  fractions), plus **domain-separation tags** (`objectType` + version) and
  `signingBytes()` = tag ‖ canonical bytes.
- **`apps/electron-vite-project/electron/main/handshake/canonicalCore.ts`** —
  THE hash/signature entry point for new-format (v3) objects. `signCore` signs
  the **complete canonical form** of the core record under the domain tag
  `wr.handshake.core` v3; there is intentionally no API to sign a field
  subset. Countersignature mode per **Q3**: `canonical_hash` signs
  tag ‖ SHA-256(canonical bytes) — both signature modes cover the same
  referenced bytes.
- The v2 subset hash (`capsuleHash.ts`) is **retained unchanged** for the
  legacy wire surface (see §1.6 dual format). The acceptance suite proves the
  gap it left: tampering `tierSignals` (outside the v2 subset) sails through
  legacy verification and is caught only by the canonical envelope.

### 1.2 Frozen signed core record (A1–A7) — [VII.3.1–3.2]

**`packages/ingestion-core/src/coreRecord.ts`** defines `WrHandshakeCore`:

| Field | Notes |
|---|---|
| `profile` | `{id, version}`; Phase-2 emissions carry `legacy_v0` v1 (real assignment arrives with the one pipeline, Phase 4) |
| `initiator_id` / `responder_id` | full-claim SSO-bound party ids (`sub`, `iss`, `email`, `wrdesk_user_id`); responder null until known |
| `ingress_path` | null on all Phase-2 emissions; **log-only forever** — guarded (§1.7) |
| `declarations` | ordered container; carries the complete capsule content under `optirando.decl.capsule` (critical) |
| `extensions` | ordered container; empty on Phase-2 emissions |
| `created_at` | capsule timestamp |
| `nonce` | 64-hex freshness nonce, checked against the core nonce store |
| (envelope) `signatures` | ordered detached list; per-profile cardinality parameterization arrives with the registry (Phase 3) — the list structure and all-must-verify rule land now |

Receive-side verification (`verifyCanonicalEnvelope`) is fail-closed:
structural parse → every signature in the list must verify → at least one
full-coverage `canonical_bytes` signature must be bound to the **pinned
sender key** → container criticality → binding cross-check of every consumed
wire field against the signed declaration (under-signing rejection) →
sender-identity-must-be-a-signed-core-party (full-claim, extends the Phase-1
guard into the signed core).

**Nonce store** (`nonceStore.ts`, table `wr_core_nonces`, migration v74):
a nonce may be observed once per scope; identical redelivery (same bound
capsule hash) falls through to the duplicate-capsule dedup; a seen nonce with
a **different** hash is a replayed core → `NONCE_REPLAY` refusal.

### 1.3 Containers with criticality (V3) — [VII.3.4–3.6]

**`packages/ingestion-core/src/containers.ts`**:

- Ordered lists of `{ns, version, critical?, payload}`; the parser is modeled
  on the `p2p_signal` preserve-unknown pattern — it returns the **original
  entry objects** (never copies-with-dropped-keys, never reorders).
- Unknown non-critical → preserve and ignore. Unknown critical → visible
  refusal **naming the namespace** (`UNKNOWN_CRITICAL_EXTENSION` +
  `refused_namespace` in the audit entry).
- Namespace registry: implemented = `optirando.decl.capsule`. Reserved-inert
  (registered, refusal-only if critical): the master-brief do-not-regress set
  (`optirando.grant.single_use`, `optirando.grant.ttl`, `optirando.ad.wr_ad`,
  `optirando.invitation.targeted_bound`, `optirando.credential.attachment`,
  `optirando.bridge.*`) plus `optirando.handshake.prior_ref`,
  `optirando.credential.*`, `optirando.transport.*`,
  `optirando.decl.capability`.
- The Gate-2 allowlist-strip (`canonicalRebuild.ts`) is **not** applied to the
  new format: `wr_canonical_v3` passes through byte-faithfully after
  structural validation; a malformed envelope rejects the capsule instead of
  being silently stripped (stripping would downgrade v3 to legacy).

### 1.4 Key extraction (G6)

Migration **v73** in the existing `HANDSHAKE_MIGRATIONS` chain: new
`handshake_key_store` table; copy-before-null of `local_private_key`,
`local_x25519_private_key_b64`, `local_mlkem768_secret_key_b64` inside one
transaction; old columns retained but nulled (no SQLite column drops
pre-rebuild); the copy is `ON CONFLICT DO NOTHING`, so a re-run never
overwrites extracted keys with the nulled columns (idempotence proven in
`keyExtraction.test.ts`).

- Writers (`insertHandshakeRecord`, `updateHandshakeRecord`,
  `updateHandshakeSigningKeys`) route key material to the store and null the
  row columns when the store exists; reads overlay store values onto the
  record, so relationships keep signing/decrypting throughout.
- Store presence is detected via `sqlite_master` (positive evidence). The
  first implementation probed the table itself, which the regex-dispatch mock
  DB used by several suites misreported as "present", silently voiding key
  writes — caught by the do-not-regress diff (§3) and fixed.
- Pre-v73 / mock DBs keep keys on the row columns; overlay is a no-op there.

### 1.5 Generic anti-rollback high-water store (G4) — [IX.4.2, X.7.8]

Migration **v74**: `wr_high_water_versions` keyed by
(`object_class`, `object_id`). `enforceHighWater` is a one-transaction
check-and-raise: below-mark → fail-closed `rollback` rejection (signature
validity never overrides); equal → idempotent accept; higher → raise.
Malformed versions are rejected fail-closed. Consumers arrive over
Phases 3–6; the store and semantics land now.

**Backup/restore semantics (decision, risk register):**

1. The high-water table lives **in the same database file** as the objects it
   guards, inside the same WAL boundary. A whole-file snapshot restore
   restores objects and marks **together, coherently** — legitimate objects
   are never mass-rejected after a restore (the primary failure mode named in
   the risk register).
2. Stated trade-off: a whole-DB restore IS a rollback of the guarded object
   classes, and the store intentionally cannot detect it from inside the
   restored file. Cross-restore rollback visibility requires an anchor
   outside the backup boundary — that anchor is the Phase-5 hash-chained
   evidence store (Tier-L, Q10), recorded as an open item, not silently
   claimed [X.0.1 claims discipline].
3. Restore procedure: (a) restore the DB file as a unit — never merge a
   foreign high-water table into a live DB; (b) restored marks are
   authoritative from that point; (c) `recordRestoreMarker` leaves a
   `HIGH_WATER_RESTORE_MARKER` audit entry so evidence readers can
   distinguish an operator restore from silent rollback.

The restore scenario is exercised in `antiRollback.test.ts`.

### 1.6 Version-gated wire — dual-format emission

- New canonical form is versioned `WR_CANONICAL_SCHEMA_VERSION = 3` inside
  the `wr_canonical_v3` envelope; the legacy v2 surface (`schema_version: 2`,
  subset hash + sender signature) stays **byte-compatible** on every outbound
  capsule. Old peers' allowlist rebuild strips the unknown `wr_canonical_v3`
  field and verifies exactly what it verified before — this is the explicit
  cross-version compatibility mechanism (risk register: "old peers'
  allowlist-rebuild must keep verifying what we send them"). Verified in the
  acceptance suite: a v3 capsule with the envelope stripped ingests
  successfully under legacy rules; the two-instance pairing rig
  (`pairingActivation.rig.test.ts`, real relay) is green with dual-format
  capsules end-to-end.
- Receivers: capsules **with** the envelope verify it fail-closed ON TOP of
  the legacy rules (Stage 0c in `enforcement.ts`); capsules without it verify
  under legacy rules alone and are marked **`legacy_v2`** in evidence
  (`wire_format` in every success/denial audit entry); v3-verified capsules
  are marked `canonical_v3`.
- Emission falls back to legacy-only (logged) when party identities are not
  plumbed at a call site or canonicalization fails — the transitional dual
  format must not break v2 interop. Plumbed call sites: initiate, accept,
  refresh (ipc + p2pTokenBackfill), context_sync (ipc, contextSyncEnqueue,
  relayPull).
- Large payload fields (`context_blocks`, `context_blocks_sealed`) are
  covered by SHA-256 references over a **stable projection** (absent/null
  collapse) inside the signed declaration, keeping the dual format inside the
  64 KB Gate-2 cap while preserving full coverage; the projection is applied
  identically on emit and verify so the Gate-2 rebuild's null-normalization
  cannot break the binding.

### 1.7 ingress_path log-only guard (A2)

`ingressPathLogOnly.guard.test.ts` scans repository source and fails on any
semantic dispatch over an `ingress_path` value (string-literal comparisons,
`switch`, prefix/`includes` dispatch). Existing references (coordination WS /
relay-pull / ingestion-RPC log payloads, `coreRecord.ts` structural
validation) are write/validate-only and pass.

## 2. Acceptance tests → results

| # | Test | Where | Result |
|---|---|---|---|
| 1 | Replay compatibility: v2 verifies under legacy rules (`legacy_v2` evidence mark); under-signed v3 rejected (`under_signed_field`); tamper outside the legacy subset rejected (`binding_mismatch`) with a control proving legacy-only would accept it; tampered core bytes rejected (`signature_invalid`); wrong sender key rejected | `phase2CanonicalCore.acceptance.test.ts` (real pipeline: `handleIngestionRPC` → Gate 2 → validator → enforcement, real sqlite) | PASS |
| 2 | Container semantics: unknown non-critical establishes (`ignoredNamespaces`), unknown critical refuses naming the namespace pre-visibility (no relationship row), order + unknown entries survive a wire round-trip byte-identically | same file | PASS |
| 3 | Canonical determinism: serialize/parse/serialize byte-identical; independently built equal objects hash equal; key order irrelevant; number/string edge cases; domain-tag separation | `packages/ingestion-core/__tests__/canonical.test.ts` | PASS |
| 4 | Nonce/replay: seen nonce + different content → `NONCE_REPLAY` refusal pre-visibility; identical redelivery is dedup, not replay | acceptance file + `antiRollback.test.ts` (unit semantics) | PASS |
| 5 | Key extraction: post-migration sign round-trip on pre-existing relationships; old columns null; idempotent re-run; new writes never land on the row | `keyExtraction.test.ts` | PASS |
| 6 | Anti-rollback: below-high-water rejected; (class,id) keying; malformed fail-closed; documented restore scenario incl. `HIGH_WATER_RESTORE_MARKER` | `antiRollback.test.ts` | PASS |
| 7 | Do-not-regress | see §3 | PASS (parity) |

## 3. Do-not-regress evidence

Full sweep of `electron/main/{handshake,email,internalInference,ingestion}`
compared against a stash-clean baseline at the Phase-1 HEAD (identical
command, JSON reporters diffed by file and by failing test name):

- **Baseline: 31 failing files. After Phase 2: 31 failing files — the same
  files with the same failing tests. Zero new failures, zero changed failure
  sets.**
- The sweep initially showed 2 regressions (`ipc.handshake.test.ts` T6,
  `postAcceptContextSync.ingestPaths.regression.test.ts` ×3), root-caused to
  the key-store presence probe misfiring on mock DBs (§1.4) and fixed;
  re-diff confirmed parity.
- Pre-existing failures documented for the record (identical at baseline,
  unrelated directories/mocks — e.g. `emailGateway.getAccountConfig is not a
  function`, outbound-queue fetch mocks, sealed-RPC fixtures):
  `internalInference.directHost.regression.test.ts` (2 sealed-RPC-fixture
  tests; its forbidden-key/`p2p_pending_beap` invariant tests pass),
  `sandboxEgressGuard.test.ts` (422 vs 413/429 — known from the Phase-1
  report), and 29 other files listed in the baseline diff.
- `packages/ingestion-core` + `packages/coordination-service`: 246 passed,
  only `sandboxEgressGuard.test.ts` failing (pre-existing).
- Two-instance pairing rig over the real relay (`pairingActivation.rig`) and
  the Phase-1 suites (`ingressAdmission`, `structuralAbsence`,
  `handshakeRegistry.identity`, `b4P2PRelayMigration`,
  `pbeapTrustPersistence`) remain green.

## 4. Exit criteria

- [x] Acceptance tests 1–7 automated and green.
- [x] Dual-format emission verified: old-peer behavior exercised by the
      strip-envelope control test (legacy rules accept what we send) and the
      real-relay rig; the compatibility mechanism (allowlist rebuild ignores
      the additive envelope; legacy hash covers no new fields) documented in
      §1.6. No explicit cutover needed — emission stays dual until peer
      version detection or a product-approved cutover (Phase 3+ decision).
- [x] `canonicalCore.ts` (over `ingestion-core/canonical.ts`) is the only
      hash/signature entry point for new-format objects; the only other
      signing surfaces are the retained legacy v2 path (`capsuleHash.ts` /
      `signatureKeys.ts`, version-gated) and unrelated subsystems (vault
      seals, qBEAP transport crypto).
- [x] Backup/restore semantics decision for the high-water store recorded
      (§1.5) and exercised in tests.

## 5. Deviations / notes for Phase 3

1. **New tables ride the shared migration chain** (v73/v74), which today also
   applies to `handshake-ledger.db`. This is the documented Phase-2 deviation;
   the Phase-3 ledger freeze + sweep (G5) removes key material and undocumented
   tables from the ledger handle.
2. **Signature cardinality** is structurally present (ordered list,
   all-must-verify, ≥1 bound full-coverage signature) but not yet
   profile-parameterized — registry data lands in Phase 3.
3. **`legacy_v0` profile id** is emitted on every Phase-2 envelope; Phase 3's
   registry must bless it (Q2) and Phase 4's pipeline assigns real profiles.
4. `internalInference.directHost.regression.test.ts` carries 2 pre-existing
   sealed-RPC fixture failures at the Phase-1 baseline (E_SEALED_RPC_MISSING_
   PEER_X25519); its do-not-regress invariants (no `p2p_pending_beap`
   enqueue, forbidden keys) pass. Worth repairing the fixture in a hygiene
   pass, independent of this refactor's phases.
