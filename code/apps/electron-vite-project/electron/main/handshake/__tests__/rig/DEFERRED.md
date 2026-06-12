# Deferred items — tracked list

Consolidated from scattered `rig/README.md` notes and commit messages so deferrals are
tracked in one place rather than re-discovered. One line each: **what** / **why deferred** /
**what unblocks it**. "By design" items are not pending work — they are decisions, listed so
they are not mistaken for gaps.

_Last updated: 2026-06-10 (Prompt 5 rig session — mini-PC, session 2, vhost-vsock green; Part A closed)._

## Logging / UX mislabels — pending

- **Duplicate-accept `COUNTERSIGNATURE_INVALID` mislabel** — when an accept capsule is
  replayed on an already-ACTIVE internal handshake (e.g. during re-pair or duplicate relay
  delivery), the host logs `COUNTERSIGNATURE_INVALID` as if the signature failed. Observed
  on the 2026-06-08 cross-machine session; handshake state was already ACTIVE and processing
  continued correctly. Expected behaviour: treat as idempotent no-op (same as duplicate
  context_sync), log at debug/info with reason `accept_already_active`, not a signature-
  failure error. _Priority:_ low. _Unblocks:_ add ACTIVE-state early return in accept ingest before
  countersignature verification; align log level/message.

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
- **pBEAP `verified_bound` on the live path** — live call sites (`messageRouter` +
  `beapEmailIngestion`) pass header-only, so `classifyPbeapTrust` always returns
  `unverified_public` (reason `signing_bytes_unavailable` for well-formed traffic — the
  `signingBytes` guard short-circuits before any binding check). _Unblocks (BOTH required):_
  (1) port the Gate-5 signing-bytes canonicalization into main, and (2) wire the paired
  counterparty's fingerprint + Ed25519 pubkey into `knownCounterparties` at both call sites.
  With only (1), well-formed traffic advances to `no_handshake_for_fingerprint` — still
  `unverified_public`. Once both are wired, `verified_bound` is **provable on the single-box
  Phase 1 harness** (real Ed25519, no relay/trust dependence — see `livePbeapTrust.test.ts`);
  **no two-box hardware session is required** to prove it. Owned by Build C.

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

## Prompt 5 — rig proof legs (2026-06-10)

**Windows dev-box session:** code-only (Part C unit tests). No rig access.  
**Mini-PC rig session 1 (`643609d4`):** halted on `/dev/vhost-vsock`.  
**Mini-PC rig session 2 (resumed `c052051d`):** vhost-vsock green; Part A **CLOSED**.

- **Part A — Build C final leg (depackage-email critical job through crosvm microVM)**
  _Status: **CLOSED** (2026-06-10 rig session 2)._
  `loopbackHttp.email.rig.test.ts` 3/3 pass. Proof: workstation→RemoteHandshakeExecutor→
  real HTTP→sandbox receiver (paid, MicroVMExecutor)→crosvm; `flushed=per-action` proves
  microVM ran; sender-side verify OK (`ok=true`); overlay nuked per-action.
  Configuration: single-box, two in-process dispatcher instances, real localhost HTTP.
  See `rig-evidence/2026-06-10/README.md` for the full proof chain.

- **Part B — A2 live ingestion (sandbox reads real email with read client)**
  _Status: Code complete; live run awaiting operator read-client consent._
  Implemented this session: `sandboxEmailFetch.ts` (`fetchOpaqueViaOutlook`),
  `sandboxEmailDelivery.ts` (`sandbox_email_delivery` RPC + host handler),
  `b2LiveIngestion.rig.test.ts` (tripwire 1/1 pass, live skips).
  Default `deliverToHost` remains fail-closed; rig test injects local DB write.
  _Unblocks:_ (1) operator sets `WRDESK_PART_B_ACCOUNT_ID=<id>` and runs
  `connectReadClient` to store read-scoped token; (2) re-run `b2LiveIngestion.rig.test.ts`.

- **Part C — Outlook /$value spike (live fidelity vs real Microsoft Graph)**
  _Status: Test bodies implemented; live validation awaiting Microsoft test account._
  RIG-1..4 now have real test bodies (were stubs). Activate with:
  `WRDESK_PART_C_ACCESS_TOKEN=<token> WRDESK_PART_C_MESSAGE_ID=<id>`.
  GATE: if RIG-1 returns 403 (Mail.Read insufficient for `/$value`), STOP and report —
  do NOT flip `WRDESK_OUTLOOK_OPAQUE_INPUT` and do NOT bump scope without sign-off.
  _Unblocks:_ operator Microsoft test account at rig; run RIG-1..4; commit evidence;
  flip `WRDESK_OUTLOOK_OPAQUE_INPUT` only if all four pass.

## UX-3 / Revocation — gaps (2026-06-12)

- **Remote-capsule revoke does not call `removeTopologyForHandshake`** —
  `enforcement.ts:460-463` processes an inbound `handshake-revoke` capsule by calling
  `buildRevokeRecord` + `updateHandshakeRecord` but does **not** call
  `removeTopologyForHandshake`. If the sandbox peer sends a revoke capsule, the host's
  `orchestrator-mode.json` linked entry remains; `resolveIngestionOwnership()` continues
  returning `owner: 'sandbox'` and inbound mail stays delegated until a cold restart or the
  user force-revokes locally. The Trigger D toast/banner also does not fire for the remote
  path. _Fix_: add a post-enforcement hook that fires `removeTopologyForHandshake` (and the
  revoke notification callback) for `handshake-revoke` capsule types — same as the local-user
  path. _Priority_: medium. _Unblocks_: ownership/fail-closed invariants are LOCKED;
  schedule this as its own task after sign-off on the fix scope.

## Email ingestion — Prompt 4 follow-ups

- **Orphaned-sandbox read-poll noise** — when `orchestrator-mode.json` sets `mode='sandbox'`
  but there is no live active internal handshake (e.g. the paired host was reset),
  `resolveIngestionOwnership` still returns `sandboxShouldReadPoll=true` because the decision
  uses `orchestratorModeStore.mode` directly. The poll immediately fails-closed (no read token →
  HELD quarantine — safe, not a security gap), but generates noisy HELD rows and log lines until
  the pairing is repaired. _Fix_: gate `sandboxShouldReadPoll` on `hasActiveInternalHandshake(db)`
  inside `ingestionOwnership.ts` so an orphaned sandbox stays idle. _Priority:_ low.
  _Unblocks:_ expose a `hasActiveInternalHandshake` helper from `internalSandboxesApi.ts` and
  thread `db` into `resolveIngestionOwnership` (interface change — needs a callsite audit).

## Infra / platform — later builds

- **Interactive inner-orchestrator microVM + role flag**, **Windows hypervisor backends**
  (Hyper-V / VirtualBox flush), **pinned reproducible guest kernel/image** — _Unblocks:_
  dedicated platform-bring-up build; not required for the handshake round-trip proof.
