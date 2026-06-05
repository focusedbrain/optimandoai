# wrdesk — Build C: `critical_job_*` Handshake Family + RemoteHandshakeExecutor + Topology Config (docs/build-specs/0017)

**Type:** Build. Off-rig (mocked/loopback transport for proofs; real two-machine topology verification is deferred to a hardware session — see §7). Commit this spec as `docs/build-specs/0017-build-c-spec.md`; report → `0018`.

**Pre-flight:** `git pull`; branch; HEAD contains `1b5d3217` (triage) and the 0016 verdict ("internalInference host plumbing: SOUND"). Flags unchanged throughout: depackage cutover OFF, B1 in soak; Build C introduces **no new live behavior** without explicit topology configuration, which no machine has yet.

**What Build C delivers:** a critical job can be routed over the internal handshake to a linked machine, which re-dispatches it through its own dispatcher and returns the signed result. This activates the workstation rows of the resolution table and is the prerequisite for the appliance topology. Template: the `internal_inference_request|result|error` pattern (host side verified sound in 0016).

---

## 1. Phase 0 — Shared-code hang check (the 0016 caveat, resolved structurally)

`runSandboxHostInferenceChat` is a class-(b) hang. Build C does NOT reuse that entry point — but it must be established whether the hang's root cause lives in **shared** gate/transport code (`assertRecordForServiceRpc`, the dispatch/transport selection, capsule signing/verification) that Build C inherits, or in inference-chat-specific code. Diagnose to that boundary only: if shared → fix it in this build with tests; if inference-specific → register the finding (file:line, cause) in `0018` and proceed. Do not repair the inference chat feature itself.

## 2. Phase 1 — The `critical_job_*` service-message family + receiving side

1. **Wire types:** `critical_job_request | critical_job_result | critical_job_error`, modeled on the `internal_inference_*` family: new discriminator, relay whitelist entry, ingest routing — the three items the architecture analysis identified as the gap. `cancel` only if it falls out of the template trivially; otherwise defer.
2. **Request payload:** the serialized `CriticalJobSpec` (which structurally cannot carry key material — INV-2 test already exists; add a wire-level assertion anyway) + the requester's handshake context. **Result payload:** the `CriticalJobResult` including the existing job-result signature. **Error payload:** typed code, no plaintext (INV-5).
3. **Receiving-side gate (new code, modeled on the sound host pattern):** `assertRecordForServiceRpc`-equivalent — internal handshake, ACTIVE, same-principal — plus: payload size cap (consistent with `limits.maxInputBytes`), `jobId` replay dedupe, and per-kind admission.
4. **Receiving-side re-dispatch with full local sovereignty (defense in depth):** the receiver runs the job through its OWN dispatcher against its OWN resolution table and invariants. A remote request can never force an executor choice: a request for a kind the receiver's table doesn't permit, or that violates INV-1/INV-6 locally (e.g. any remote `decrypt-qbeap` request, or `view-attachment` on a node without the custody key), is **refused with a typed error** (`E_REMOTE_KIND_REFUSED` / `E_KEY_LOCALITY`), never executed degraded (INV-7). Unit tests for each refusal.

## 3. Phase 2 — Sender side: RemoteHandshakeExecutor + topology config

1. **Topology persistence (deferred from Build A, lands now):** `orchestrator-mode.json` gains `linked: Array<{role: 'sandbox'|'appliance', handshakeId, jobKinds: CriticalJobKind[]}>` with env/argv override; validation rejects entries violating key-locality (e.g. `decrypt-qbeap` in any `jobKinds`, `view-attachment` linked to an `appliance`). `ResolutionContext.topology` now reads from it (replacing the Build A default `{linked: []}`).
2. **RemoteHandshakeExecutor (replacing the Build A stub):** `supports(kind)` from KIND_METADATA key-locality (consumer-local kinds never supported); `isAvailable()` = matching ACTIVE linked entry for the kind + transport reachable; `run()` = serialize → send `critical_job_request` over the template's transport selection (direct HTTP / WebRTC DC as `internal_inference` does) → await result/error with a transport timeout subordinate to the dispatcher's `maxWallClockMs` → verify the job-result signature locally before returning (the dispatcher's `verify.ts` post-path then applies as for any executor).
3. **Resolution-table activation:** workstation rows resolve to `remote-handshake` for kinds present in a linked entry; absent topology, behavior is exactly today's (`E_NO_EXECUTOR` / transitional rules) — proven by a no-topology regression test. No table semantics change beyond availability becoming real.

## 4. Security proof obligations (unit/mocked)

Same-principal violation refused · non-ACTIVE handshake refused · oversize request refused at the gate (never reaches a worker) · `jobId` replay deduped · remote `decrypt-qbeap` request refused (`E_KEY_LOCALITY`) · receiver-table mismatch refused (`E_REMOTE_KIND_REFUSED`) · result with bad signature rejected by sender (`E_SAFETEXT_REJECTED`-class handling, no insert) · link-down mid-job → typed error → existing quarantine/retry mapping at call sites (INV-3/INV-7: never a local fallback the table doesn't declare).

## 5. Round-trip proofs (off-rig)

1. **Mocked-transport round-trip per routable kind:** workstation context dispatches `depackage` / `validate-*` → wire → receiver (sandbox context) re-dispatches in-process → signed result returns → sender verification green. Include a mixed/carrier depackage fixture so the opaque-package channel survives the wire.
2. **Loopback two-instance round-trip** (two orchestrator processes on one box, real handshake channel, to the standard the clone path already meets): at least `depackage` end-to-end. If the existing loopback/relay-mock harness cannot host this, say so with specifics — do not hand-roll a flaky harness; the real-hardware proof is §7's job.

## 6. Out of scope

Appliance role plumbing (UI gating, SSO device-code, fetch-at-appliance) — next build after Build C. `decrypt-qbeap` implementation. Fetch relocation. Any flag default change. Repairing the inference chat feature. Full cross-device E2E automation (the `it.todo` matrix) beyond §5.2's standard.

## 7. Deferred verification (specify, don't run): the W-series

Append to the verification docs a short **W-series runbook** (next numbered file) for the first two-machine session — Windows workstation + mini-PC sandbox over the real cross-device handshake: W1 pairing + topology config; W2 remote `depackage` of a real fetched email (workstation → mini-PC → microVM → signed result back; this is placement-matrix topology (b) made real); W3 link-down fail-closed; W4 oversize/replay refusals over the real channel. The W-series joins the V-series as B-track acceptance evidence; neither blocks Build C's code landing.

## 8. Process

Small conventional commits per phase; Phase 1 before Phase 2 (receiver before sender, so the sender always has a real counterpart in tests); contradictions reported before absorbed; report `0018` with commit map, Phase 0 verdict, refusal-test evidence, round-trip evidence, and deviations.
