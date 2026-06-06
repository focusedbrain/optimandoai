# Deferred items — tracked list

Consolidated from scattered `rig/README.md` notes and commit messages so deferrals are
tracked in one place rather than re-discovered. One line each: **what** / **why deferred** /
**what unblocks it**. "By design" items are not pending work — they are decisions, listed so
they are not mistaken for gaps.

_Last updated: 2026-06-06._

## Architectural — by design (NOT pending)

- **qBEAP decrypt-at-orchestrator** — qBEAP hybrid decrypt stays in the orchestrator; the
  inner microVM holds no handshake private keys (Build-1 worker is an email-MIME depackager,
  not a BEAP decryptor). _Unblocks:_ nothing — this is the decided trust model, not a TODO.

## Security hardening — pending

- **VM-identity attestation of the guest result-signing key** — guest signatures are not yet
  attestation-bound, so `validateSafeText` re-validation in the seam stays authoritative.
  _Unblocks:_ guest attestation lands (then the build-time marker can be runtime-attested).
- **image/bundle guard mandatory-when-microvm** — `E_IMAGE_BUNDLE_MISMATCH` preflight exists
  but the marker is a build-time content hash and the guard is not yet hard-required on the
  microVM path. _Unblocks:_ a soak period on the fast-fail guard + runtime attestation, after
  which the guard becomes mandatory when the microVM path is selected.
- **P2P confidential-branch metadata seal-binding** — the pBEAP trust verdict is bound into
  the row seal on the email-sync `email_beap` path and the P2P non-confidential path, but the
  P2P **confidential** branch seals via the validator subprocess and does not yet bind the
  verdict metadata. _Unblocks:_ route the confidential-branch metadata through the
  `boundMetadataJson` arg of `computeSeal` (needs a seal/schema touch on that branch).
- **pBEAP Gate-5 signing-bytes canonicalization in main** — live call sites pass header-only
  (no counterparties / signing bytes), so the live verdict is `unverified_public`;
  `verified_bound` is unreachable on the live path until Gate-5 canonicalization is mirrored
  in main. _Unblocks:_ port the Gate-5 signing-bytes canonicalization into main (the verdict
  then records `verified_bound` with no call-site change). Owned by Build C.

## Two-box only — deferred to the cross-machine runbook

- **Clone gesture exactly-once + `relay_pending`/ACK-driven `live`** — relay-transport halves
  (`live`=WS push, `queued`=store-pull) are machine-proven single-box; `relay_pending` and the
  15 s `onBeapDeliveryAck`-driven `live` are renderer-only and exactly-once needs a second
  machine toggling offline/online. _Unblocks:_ the two-machine guided session (CROSS_MACHINE_RUNBOOK.md).
- **Quarantine full custody round-trip** — encrypt→decrypt blob and "orchestrator can't read
  plaintext" are unit-covered; host encrypt → qBEAP clone-quarantine send → paired-sandbox
  decrypt across two live instances is not. _Unblocks:_ two-machine session.
- **Direct-P2P + live-both-online internal flows** — orchestrator mode / session / WS holder
  are module singletons, so one process cannot host two live WS clients with distinct device
  ids. _Unblocks:_ two physical machines (or de-singletonizing the orchestrator session — out
  of scope for the rig).

## Test-infra debt — restore skipped coverage

These three suites currently carry `it.skip`/`test.skip` guards (with reason strings in-line)
so the baseline is green and no-regression claims stay verifiable. None are production defects.

- **inboxSealedRead legacy-NULL fixture** — the "legacy inner seal migrates" test inserts
  `seal_key_source=NULL`, impossible since schema v68 (`NOT NULL DEFAULT 'vmk'` + backfill).
  _Unblocks:_ re-author against a `'vmk'`-tagged legacy row to restore inner→ledger migration coverage.
- **sealed-storage harness `handshakes` table** — the confidential-defer test INSERTs into a
  `handshakes` table the shared `createSealedStorageTestContext()` harness doesn't create.
  _Unblocks:_ add the `handshakes` table to the harness (or create it in the test).
- **zeroization test asserts provider buffer** — the structural-property test asserts the
  provider-owned key buffer is zeroized, but `sealKeyCopy()` deliberately zeroizes only the
  gate's private copy and never the provider buffer. _Unblocks:_ re-author to assert the
  internal copy is zeroized / not retained.

## Infra / platform — later builds

- **Interactive inner-orchestrator microVM + role flag**, **Windows hypervisor backends**
  (Hyper-V / VirtualBox flush), **pinned reproducible guest kernel/image** — _Unblocks:_
  dedicated platform-bring-up build; not required for the handshake round-trip proof.
