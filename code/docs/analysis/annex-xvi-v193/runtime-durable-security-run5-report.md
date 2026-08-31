# Run 5 — Production Runtime Wiring, Durable Security State, Restart/Crash Safety

Branch: `integration/consolidated-current` · Run-4 HEAD: `6c808582` · Run-5 HEAD: `f9ec23f1`

Pinned Annex `docs/spec/Annex_XVI_WR_Code_v1.95.pdf` verified at Slice 0 **and**
at completion (SHA-256):

```
064AAD6D8F28A0B1B7688C516CA3C4D8BA486BF723A5483D8C119D44F875829F
```

Matches the Run-1..4 pinned value. The Annex remains normative; this report
records implementation state only.

## Commits per slice

| Slice | Commit | Content |
| --- | --- | --- |
| 0 | `5e8a178a` | Baseline capture + runtime/persistence inventory (`run5-runtime-persistence-inventory.md`) |
| 1 | `13800198` | Production composition root: runtime-owned identity, singleton security deps, no caller-supplied trusted state |
| 2 | `6488fe4e` | `wrc-security.db` (schema v1) + durable directory generation floors, fail-closed |
| 3 | `d4966a3c` | Durable device registry (schema v2), generation-gated upserts, atomic pairing commit |
| 4+5 | `d223beac` | Durable relay replay ledger + Gate-6 request-id idempotency (schema v3), atomic bind-and-settle |
| 6–8 | `1fe05170` | Production-composition proofs: relay, device trust, capsule admission through the runtime |
| 9 | `3840f4e8` | Explicit acceptance boundary: `wrc.acceptReference` token protocol over the durable consume CAS |
| 10 | `db387d1e` | Fail-closed persistence proofs; handle closed on failed open/migrate |
| 11 | `d575ebcd` | Restart/crash/concurrency matrix suite |
| 12 | `047ca7d4` | Production full-path suite (all 7 classes via the RPC dispatcher) + anti-bypass proofs |
| 13 | `f9ec23f1` | Bounded lazy maintenance (schema v4 indexes, retention pruning) |

## Regression (sanctioned runner `pnpm test:native-db`, full sweep)

| Capture | Total | Failed |
| --- | --- | --- |
| run5.before (Slice 0) | 6507 | 154 deterministic (+1 known hardware-probe flake in one capture) |
| run5.after | 6585 | 154 |

**Exact failing-identity comparison: IDENTICAL SETS** (154 = 154, verified by
normalized set diff of `%TEMP%\run5.before2.failures.txt` against the after
capture). **Zero new deterministic failures, zero baseline-only now green,
+78 new passing tests** (the Run-5 suites). Flaky movement: none — the one
known hardware-probe flake (`hardware-capability.test.ts`) matched the
deterministic before-capture in the after run.

New Run-5 suites (all green under the native runner): `wrcRuntimeComposition`
(composition root), `directoryGenerationFloorDurability` (14),
`deviceRegistryDurability`, `replayIdempotencyDurability` (15),
`productionWiring` (13), `explicitAcceptance`, `productionFailClosed`,
`restartConcurrencyMatrix` (10), `productionFullPath` (14),
`persistenceMaintenance` (7).

## Runtime dependency graph

**Before Run 5** (Run-4 end state): `wrcRuntime.ts` owned the resolution
client, directory client, and use-limit discovery — but use-limit/epoch
stores silently fell back to memory in production (the frozen-ledger finding,
Slice 0), the admission replay ledger was constructed **per submission**,
devices/relay/claim-identity existed only as gate-adapter options that tests
injected, and `handleWrcSubmitReference` accepted a caller-supplied
`receiver`.

**After Run 5** — one production dependency graph, composed in
`wrcRuntime.ts` and nowhere else:

```
resolveSecurityDb() ── openWrcSecurityDb (fail-closed, THROWS) ── maintainWrcSecurityDb (bounded, once)
        │
        ├─ createDbEpochFloorStore ────────────► WrcResolutionClient (Gate 1–3 substrate)
        ├─ createDbDirectoryGenerationFloorStore ► WrcDirectoryClient (Gate 2)
        ├─ createDbUseLimitStore ──────────────► Gate 3 §XVI.8.4 + acceptance consumption
        ├─ createDbDeviceRegistry ─────────────► Gate 4 device/pass decisions
        ├─ createDbRelay ──────────────────────► Gate 5 custody + replay ledger
        └─ createDbAdmissionReplayStore ───────► Gate 6 request-id idempotency
                                │
readRuntimeIdentityFromEnvironment + SSO session ► receiver / claim identity / decrypt key
                                │
                    runWrCodeGatePipeline (the ONE six-gate pipeline)
```

Every store is a process-lifetime singleton; the per-submission object only
assembles references. Test seams (`setWrc*ForTests`) are the only injection
points and null-restore to the production graph.

## Production capture/resolution path

`e-mail detection / clipboard / selection / manual entry (wrc.captureReference)`
→ explicit submission act → **`wrc.submitReference`** (RPC dispatcher
`handleHandshakeRPC`) → `handleWrcSubmitReference` (runtime-owned receiver;
caller `receiver` ignored) → `runWrCodeGatePipeline` (Gates 1–6) → acceptance
token minted inside the trust boundary → **`wrc.acceptReference`** (the only
consumption surface). `wrc.resolvePublisher` remains status/audit only —
proven to yield no relay/capsule material.

## Schema: `wrc-security.db` (new file, own additive chain)

Location: `~/.opengiraffe/electron-data/wrc-security.db` (override:
`WRDESK_WRC_SECURITY_DB`). WAL, busy_timeout 5000, FK on. Why a new file: the
handshake ledger handle is frozen at v74 + hygiene-swept (WRC v77/78 tables
could never exist there → the silent memory fallback Slice 0 uncovered), and
the vault is unlock-gated. The handshake chain and all previous stores
(entry lifecycle, Run-2 P keys, Run-3 canonical designators, pairing state,
consent/preview data, legacy rows) are untouched.

| v | Tables / indexes |
| --- | --- |
| 1 | `wrc_directory_generation_floor`, `wrc_publisher_epoch_floor`, `wrc_entry_use_state` (re-homed v77/78 DDL) |
| 2 | `wrc_device_record`, `wrc_counterpart_pass` |
| 3 | `wrc_relay_envelope` (+ slot index), `wrc_relay_request_ledger`, `wrc_admission_request_ledger` |
| 4 | pruning indexes: envelope expiry, both ledgers' created_at |

## Persistence semantics

**Directory generation floors (Gate 2).** `raise` is a conditional upsert
(`WHERE excluded.generation_floor > current`) — monotonicity is a property of
the statement, so concurrent resolutions cannot race the floor backwards and
restart reads whatever was last accepted. A present-but-malformed floor row
THROWS (refuse), never reads as "never seen". Operator-anchor rollover and
stale pre-rollover material behave exactly as Run 4 defined; the floor only
adds rollback resistance across restart.

**Device registry (Gate 4).** The tenant-signed Device Record JSON remains
authoritative; the DB is its index. Upserts are generation-gated in the
statement (only strictly higher generation replaces a row) → revocation
rollback is impossible, stale records cannot displace newer ones. Keying:
`(tenant_part, device_party_id)` for records — no aliasing across tenants;
`(c_initiator_part, c_responder_part, device_party_id)` for counterpart
passes — a pass under C-parent A is a different row than under B.
Revocation/withdrawal use transactions with generation-CAS. Malformed or
tampered persisted records fail signature verification on read (fail closed).

**Relay replay ledger (Gate 5).** `wrc_relay_request_ledger` binds
`(capsule_id, request_instance_id) → first claimant` via INSERT-if-absent
inside a transaction with the custody read: two concurrent first uses settle
on exactly one claimant; the named claimant re-presenting the same claim gets
the DEFINED idempotent re-release (§XVI.7.5.9); any other party is refused —
before and after restart. Envelope custody (`wrc_relay_envelope`) survives
restart with status (available/withdrawn/expired) intact.

**Gate-6 request-id idempotency.** `wrc_admission_request_ledger` maps
`request_instance_id → admitted capsule_id`, written only after every other
admission predicate passed (a Gate-6 failure persists nothing). `record`
returns the SETTLED capsule id (first writer wins atomically): a retry with
the same binding returns the idempotent admitted result; the same request id
re-bound to a different capsule refuses `request_replayed`. Logically
distinct from the relay ledger (idempotency ≠ replay); they share only the
DB file. Rate-attempt timestamps stay in memory by documented decision
(short window, not security state — inventory doc).

## Transaction boundaries

- Floor raise: single conditional statement.
- Device upsert / revoke / withdraw: single statement or transaction with
  generation-CAS.
- Pairing acceptance: `deps.atomically` wraps §XVI.8.4 slot consumption +
  Device Record registration in ONE DB transaction — `slot consumed → crash
  → record lost` cannot occur; a failed durable write rolls the consumption
  back and the acceptance refuses.
- Relay release: custody read + ledger bind in one transaction.
- Admission: record-and-settle in one statement (first writer wins).
- Consumption: the Run-2 CAS (`consume` conditional on the live claim) —
  unchanged semantics, now always on the durable store.

## Admission / acceptance / consumption (Slice 9)

Admission does not consume. A successful `wrc.submitReference` mints an
opaque 24-byte-random acceptance token bound to the admission's canonical
entry key, claimant, request instance id, and capsule id. `wrc.acceptReference`
is the ONLY consumption surface: token single-shot (removed before the CAS;
restored only on infrastructure THROW, never on protocol refusal), consumption
is the durable Run-2 CAS conditional on the claim still being held. Crash
matrix: failed acceptance never consumes; successful acceptance is not
repeat-consumable; crash after the CAS leaves the use durably taken; crash
before committed acceptance leaves the claim to its normal timeout; racing
acceptances have exactly one winner (decided in the DB statement). The
pending-token map is deliberately process-memory: it holds no security
authority — losing it means the admission was never accepted and the claim
times out. Token TTL: 900 s default, `WRDESK_WRC_ACCEPTANCE_TOKEN_TTL_S`.

## Restart / concurrency matrices (Slice 11 + per-slice suites)

`restartConcurrencyMatrix.e2e.test.ts` — every scenario against the real
native DB with a true restart (handle closed, file reopened, all stores
rebuilt):

| Scenario | Result |
| --- | --- |
| Directory: accept gen N → restart → N−1 | refused `generation_stale` |
| Device: pair → restart → SI resolve | admitted |
| Device: revoke → restart → same device | refused Gate 4 |
| Relay: release → restart → same-party replay | defined idempotent re-release; ledger still names first claimant |
| Capsule: admit → restart → same request | exact idempotent result (`idempotentReplay: true`, same capsule) |
| One-time-use: consume → restart → second use | refused `CONSUMED` |
| Failed downstream: claim → release → restart | not consumed; next attempt possible; crash-while-claimed times out lazily |
| Pairing race: 2 concurrent on 1 slot | one winner, loser deterministic, exactly one durable record after restart |
| Admission race: 2 acceptances on single use | one winner, `uses_taken = 1` durable |

## Anti-bypass proofs (Slice 12, from the real RPC dispatcher)

- All 7 classes (P, I, C, SP, SI, SC, SE): capture → submit → six gates →
  acceptance token, through `handleHandshakeRPC`.
- E-mail detection proven as a capture origin feeding `wrc.submitReference`.
- `wrc.resolvePublisher` yields no capsule/relay/sealed-nonce material.
- No RPC exists to call Gate 5/6 with trusted state (unknown_method).
- Caller-supplied `receiver`, `designator`, `devicePass`, `directoryApproved`,
  `replayApproved`, `relayReleased` params are dead weight — the refusal
  names the RUNTIME's device, proving the decision source.
- Replay/idempotency state cannot be caller-marked (`request_replayed`).
- Forged/near-miss/spent acceptance tokens refuse; state untouched; the real
  token still works exactly once.

## Fail-closed behavior (Slice 10)

`openWrcSecurityDb` THROWS on unopenable path or corrupted file (closing the
native handle first — Windows file-lock remediation), and the composition
root does not catch that into a memory store: submissions error visibly.
A security DB that dies under a running composition refuses/errors — never
admits from empty volatile state. In-memory store constructors remain only
as explicit test fixtures behind `setWrc*ForTests` seams and unit suites.

## Maintenance (Slice 13) and operational defaults

`maintainWrcSecurityDb` — bounded (rowid-limited batches over v4 indexes),
lazy (called once by the composition root at first DB use, no scheduler).
Prunes: relay envelopes expired longer than retention; relay-ledger rows
older than retention **whose envelope is gone or expired** (a row with a live
envelope is never pruned regardless of age); admission-ledger rows older than
retention. Never touches floors, use state, device records, counterpart
passes. Maintenance failure logs and skips — pruning less is safe.

One-line operational defaults: replay/idempotency retention 30 days
(`WRDESK_WRC_REPLAY_RETENTION_S`); maintenance batch 1000 rows/table;
acceptance-token TTL 900 s (`WRDESK_WRC_ACCEPTANCE_TOKEN_TTL_S`), pending cap
1000; security-DB path override `WRDESK_WRC_SECURITY_DB`.

## Remaining Annex XVI attachment points (unchanged from Run 4)

- Transport-backed relay + directory service endpoints (wire seam exists;
  an operational deployment binds it).
- Acceptance record / establishment step (§XVI.7.5.8): nonce_R
  countersignature, Establishment Commitment (§XVI.13.6) — attachment seam.
- Handshake State Index recording after Gate 6 and trusted-UI surfaces (P12).
- Device Pass live proof-of-possession over P2P session establishment
  (§XVI.13.7 step 2) — transport concern.

## Consciously deferred non-normative work

- §XVI.7.2a catalog blocks, §XVI.7.7a trigger catalog, adaptive menus,
  WR Pointer, semantic navigation, automation execution, umbrella/product UI,
  presentation/rendering, v1.96 cosmetics (out of scope by order).
- Cross-process DB contention beyond WAL + busy_timeout (single main process
  owns the file today).
- Scheduled (non-lazy) maintenance — prohibited by the order (no external
  scheduler); the lazy bounded pass converges.
