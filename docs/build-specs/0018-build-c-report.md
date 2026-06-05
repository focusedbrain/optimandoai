# wrdesk — Build C Report (docs/build-specs/0018)

**Status: code-complete, NOT accepted.** Build C (`critical_job_*` handshake
family + receiving-side gate & sovereign re-dispatch + `RemoteHandshakeExecutor` +
topology config) lands per spec `0017`. Off-rig proofs (mocked-transport +
real-socket loopback) are green. Real two-machine acceptance is the W-series
(`0019`), which does not block this landing. **No flag defaults changed**;
`WRDESK_SEAM_DEPACKAGE_CUTOVER` stays OFF. **No new live behavior** activates
without explicit `linked` topology, which no machine has configured.

Branch: `build-c/critical-job-handshake` (off `1b5d3217`).

---

## 1. Commit map

| Commit | Phase | Contents |
|--------|-------|----------|
| `3024d246` | spec | Commit `0017` verbatim + README index (0017/0018/W) |
| `a29f4bec` | Phase 1 (receiver) | `critical_job_*` wire family, Buffer-aware serialize + INV-2 wire assertion, receiving-side gate + sovereign re-dispatch + typed refusals, receiver dispatcher, ingest routing, `p2pServer` probe, remote error codes, tests |
| `b4397cea` | Phase 2 (sender) | topology validation + persistence + `ResolutionContext.topology` sourcing, real `RemoteHandshakeExecutor`, direct-HTTP transport, signature-only verify helper, live-cutover activation, tests |
| `f505d705` | proofs | §5.2 real-socket loopback round-trip |

Phase 1 (receiver) landed before Phase 2 (sender), per spec §8, so the sender's
tests always had a real counterpart.

**Test totals (critical-jobs):** 111 passed / 1 skipped (the skipped one is the
pre-existing `dispatcher.microvm.rig.test.ts`, rig-gated). New Build C tests: 48
across `remote/__tests__/` (serialize, receiver, relayExclusion, topology,
executor, roundtrip, loopbackHttp).

---

## 2. Phase 0 verdict — the `runSandboxHostInferenceChat` hang

**Verdict: INFERENCE-SPECIFIC, not shared. No shared-code fix required; Build C is
structurally immune regardless.**

The class-(b) hang (`internalInference.directHost.regression.test.ts` →
"Host mode cannot use Sandbox host-chat entry point", times out at 5000 ms) was
diagnosed to the shared/inference boundary:

- **Root cause (file:line):**
  `internalInference/sandboxHostChat.ts:49` `runSandboxHostInferenceChat` gates
  only on the handshake **record/ledger** — `assertRecordForServiceRpc(record)`
  at `sandboxHostChat.ts:82` (and the direction/role ledger check
  `assertLedgerRolesSandboxToHost` → `deriveInternalHostAiPeerRoles(r,
  getInstanceId())`, `policy.ts:60,310,322`) — and has **no local
  orchestrator-mode precondition** (`isSandboxMode()` / `!isHostMode()`). In the
  test, the `beforeEach` sets `getInstanceId()` = the record's sandbox side, so
  the ledger gate correctly **passes** even with `isHostMode()` forced true; the
  function then proceeds to `requestHostCompletion` (`sandboxHostChat.ts:314`) and
  `await`s the inference pending promise (`await promise`,
  `sandboxHostChat.ts:322`, default timeout 120 000 ms), which never resolves in
  the test → the 5 s test timeout fires first.

- **Boundary analysis — the shared code Build C inherits behaved correctly and
  did not hang:**
  - `assertRecordForServiceRpc` (`policy.ts:282–304`): synchronous, record-scoped,
    returned correctly (it is intentionally mode-agnostic; the direction/role gate
    is separate). **Not the hang source.**
  - Transport-selection deciders (`decideInternalInferenceTransport`,
    `decideHostAiIntentRoute`): bounded, returned a choice. **Not the hang source.**
  - Capsule signing/verification (`critical-jobs/verify.ts`,
    `depackaging-microvm/hypervisorProvider.ts:153 verifyJobResultSignature`):
    synchronous Ed25519, never used by inference at all. **Not the hang source.**
  The two contributing factors — (a) the missing local-mode precondition on the
  inference-chat **entry point**, and (b) the unbounded-in-test `await` on the
  **inference** pending map — are both inference-chat-specific.

- **Action:** per spec §1, the finding is registered here and we proceed; the
  inference chat feature is **not** repaired (out of scope, §6).

- **Why Build C cannot reproduce this class of hang:** the dispatcher wraps every
  executor in `runWithTimeout(maxWallClockMs)` (`dispatcher.ts:128`), and
  `RemoteHandshakeExecutor.run()` awaits the transport with a timeout
  **subordinate** to `maxWallClockMs` (`remoteHandshakeExecutor.ts:59`
  `subordinateTimeout`). A peer that never answers fails closed
  (`E_REMOTE_LINK_DOWN`/`E_TIMEOUT`) within the wall clock. The receiving side
  runs in a known local mode with explicit gates.

---

## 3. Refusal-test evidence (spec §4 security obligations)

All proven by unit/mocked tests (`remote/__tests__/`):

| Obligation | Code | Test |
|-----------|------|------|
| Same-principal violation refused | `E_REMOTE_HANDSHAKE_INACTIVE` | `receiver.test.ts` "same-principal violation refused" |
| Non-ACTIVE handshake refused | `E_REMOTE_HANDSHAKE_INACTIVE` | `receiver.test.ts` "non-ACTIVE handshake refused" |
| Non-internal handshake refused | `E_REMOTE_HANDSHAKE_INACTIVE` | `receiver.test.ts` "non-internal handshake refused" |
| Oversize request refused at the gate, never reaches a worker | `E_REMOTE_PAYLOAD_TOO_LARGE` | `receiver.test.ts` "oversize request refused… never dispatched" (asserts `dispatch` not called) |
| `jobId` replay deduped | `E_REMOTE_REPLAY` | `receiver.test.ts` "jobId replay deduped" |
| Remote `decrypt-qbeap` refused | `E_KEY_LOCALITY` | `receiver.test.ts` "remote decrypt-qbeap refused"; topology validation rejects it in `jobKinds` |
| `view-attachment` without custody key refused | `E_KEY_LOCALITY` | `receiver.test.ts` "view-attachment without custody key refused" |
| Receiver-table mismatch refused | `E_REMOTE_KIND_REFUSED` | `receiver.test.ts` "receiver-table mismatch refused" (free-sandbox `open-link`) |
| Result with bad signature rejected by sender, no insert | `E_SIGNATURE_INVALID` | `executor.test.ts` "bad depackage signature rejected by the sender" (genuine-then-tampered) + "missing-signature … rejected" |
| Link-down mid-job → typed error → quarantine/retry mapping | `E_REMOTE_LINK_DOWN` | `executor.test.ts` "link-down → E_REMOTE_LINK_DOWN"; `loopbackHttp.test.ts` real-socket Bearer rejection |
| INV-2 (no key material on the wire) | `E_REMOTE_PROTOCOL` | `serialize.test.ts` (top-level allowlist + forbidden nested field-name scan + re-assert on deserialize) |
| Relay exclusion (never relay-whitelisted) | — | `relayExclusion.test.ts` (capsule whitelist + signal handler + coordination-service source) |
| Topology key-locality (INV-6) | — | `topology.test.ts` (decrypt-qbeap dropped; view-attachment→appliance dropped) |

Defense in depth: the refusals are enforced at **both** ends — the topology
validator (sender) refuses to even configure an illegal route, and the receiver
re-checks key-locality/admission against its OWN table regardless of what the
sender requested.

---

## 4. Round-trip evidence (spec §5)

### §5.1 Mocked-transport round-trip per routable kind — `roundtrip.test.ts`

Workstation dispatcher → `RemoteHandshakeExecutor` → loopback transport → REAL
receiver (free-sandbox context) → in-process re-dispatch → signed result → sender
signature verify → dispatcher `verify.ts` post-path. Green:

- `depackage`: signed result returns, `meta.executorId=remote-handshake`,
  `safeText.body_text` present.
- `depackage` **carrier fixture** (multipart w/ attachment): green ⇒ the artifact
  ciphertext Buffers round-tripped **byte-for-byte** (the job-result signature
  commits to ciphertext digests; a lossy wire would fail verification),
  `artifacts.length ≥ 1`.
- `depackage-email`: result returns over the wire.

### §5.2 Loopback over a real socket — `loopbackHttp.test.ts`

A localhost HTTP server replicates the production ingest branch (Content-Type gate
+ Bearer auth against the handshake token + `isCriticalJobServiceRpcShape` →
`tryHandleCriticalJobServiceP2P`), driven by the **real** `httpCriticalJobTransport`
(fetch). `depackage` end-to-end over a real socket verifies green; a wrong Bearer
is rejected at the socket and the sender surfaces a typed remote error (no insert).

**Harness honesty (spec §5.2):** this is a single-process, real-socket loopback of
the **direct** channel. The existing unit harness (`createP2PServer`) starts **one**
in-process ingest server; there is **no** harness that spins up **two** orchestrator
processes paired over a **live coordination-relay handshake**. Standing one up by
hand for a unit test would be exactly the flaky harness §5.2 warns against, so the
two-process / real-handshake-channel proof is deferred to the real-hardware
**W-series** (`0019`). What the loopback *does* prove (real socket, real transport,
real ingest dispatch, real receiver, real signing/serialization, real sender
verification) is everything in the direct path except the second OS process and the
relay-mediated pairing.

---

## 5. Deviations / contradictions (reported before absorbed, spec §8)

1. **Synchronous response-body delivery vs. the inference reverse-POST.** The
   `internal_inference_*` template delivers the result via a **reverse POST** to
   the requester's ingest (async, correlated by `request_id` through a pending
   map). Build C delivers the `critical_job_result`/`_error` as the **HTTP 200
   response body** of the request POST (synchronous, single bounded round-trip).
   Rationale: deterministic off-rig proofs without a reverse-delivery pending map,
   and it keeps the §5.2 loopback a single request/response. `request_id`
   correlation is still on the envelope, so a future async / WebRTC-DC delivery can
   be added without a wire change. **No security property depends on the delivery
   style** (the gate, sovereignty, and signature verification are transport-shape
   independent). Inbound `critical_job_result`/`_error` ingest POSTs are explicitly
   rejected (400) in this model.

2. **WebRTC data-channel carriage deferred.** Spec §3.2 mentions "direct HTTP /
   WebRTC DC as `internal_inference` does." Build C implements the **direct-HTTP**
   carriage only; the transport is a pluggable interface (`CriticalJobTransport`)
   so a DC carriage can be added later. Rationale: the DC path for a new family
   needs its own DC discriminator + router entry (more surface), and the off-rig
   proofs are deterministic over HTTP; adding a DC harness now risks the flakiness
   §5.2 warns against. The security gate/sovereignty/signature properties are
   transport-independent, so this is an optimization, not a correctness gap.

3. **`cancel` deferred.** Spec §2.1 allows `cancel` "only if it falls out of the
   template trivially." With synchronous response-body delivery there is no pending
   request to cancel out-of-band, so `critical_job_cancel` does not fall out
   trivially and is **deferred** (would re-enter scope alongside async/DC delivery).

4. **Receiver dispatcher omits `remote-handshake` (anti-loop hardening, not in the
   spec letter).** `buildReceiverDispatcher` registers only local executors (no
   `remote-handshake`), so a node whose table would route a kind onward (e.g. a
   mis-linked workstation receiving a request) fails closed with `E_NO_EXECUTOR`
   rather than re-delegating in a loop. This strengthens "full local sovereignty"
   (§2.4) and changes no declared table semantics.

5. **`view-attachment` custody capability defaults to `false`.** Build C ships no
   custody-key plumbing (out of scope, §6), so `custodyHeld` defaults to `false` →
   `view-attachment` is refused with `E_KEY_LOCALITY` on any node until that build
   lands. This is the safe default (fail closed) and matches the spec's example
   ("view-attachment on a node without the custody key → `E_KEY_LOCALITY`").

6. **Observation (pre-existing, not introduced by Build C):**
   `verifyJobResultSignature` (`depackaging-microvm/hypervisorProvider.ts:153`)
   returns `true` for an
   all-zero Ed25519 key+signature (the identity-point weak-key edge case). This is
   within the module's documented threat model — it proves *transport integrity*,
   not *identity*; the signer key is "untrusted-by-default" pending the attestation
   build, and `validateSafeText` (closed-schema re-validation) is the authoritative
   content gate. Build C's sender signature pre-check inherits this property. **Not
   fixed** (out of scope; attestation build), recorded here because it surfaced
   while writing the bad-signature test (which was rewritten to use a
   genuine-then-tampered result so it exercises a real signature mismatch).

---

## 6. Out of scope (confirmed untouched, spec §6)

Appliance role plumbing; `decrypt-qbeap` implementation; fetch relocation; flag
defaults; the inference-chat feature; full cross-device E2E automation beyond §5.2.

---

## 7. Deferred verification

The **W-series** runbook (`0019`) specifies the first two-machine session (Windows
workstation + mini-PC sandbox over the real cross-device handshake: W1 pairing +
topology, W2 remote `depackage` of a real fetched email, W3 link-down fail-closed,
W4 oversize/replay refusals). It joins the V-series (`0009`) as B-track acceptance
evidence; neither blocks Build C's code landing.
