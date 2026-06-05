# wrdesk — W-series Verification Runbook (docs/build-specs/0019)

**Status:** Build C (`critical_job_*` handshake family + `RemoteHandshakeExecutor`
+ topology config) is **code-complete, not accepted**. Build C lands no new live
behavior without explicit topology configuration, which no machine has yet. The
off-rig proofs (mocked-transport + real-socket loopback, report `0018`) are green;
they do **not** exercise two real machines over the live cross-device handshake.

This W-series is the deferred **real-hardware** acceptance evidence for Build C —
the first **two-machine** session: a Windows **workstation** + a mini-PC
**sandbox** paired over the real cross-device handshake, with `linked` topology
configured. It joins the V-series (`0009`) as B-track acceptance evidence; **neither
blocks Build C's code landing** (per spec 0017 §7). Execute later on the rig;
check off **in order**; record evidence per step in the next report file
(`0020-w-series-verification-report.md`).

Per INV-7, no flag default changes for this series: `WRDESK_SEAM_DEPACKAGE_CUTOVER`
stays **OFF** on both machines. The W-series verifies the *routing/transport*
mechanics (the `critical_job_*` round-trip), not the email-path cutover — the two
are independent and gated separately.

---

## W0 — Preconditions

- `git pull` on both machines; branch + HEAD sanity; confirm HEAD contains the
  Build C commits (Phase 1 `feat(critical-jobs): … receiving-side gate`, Phase 2
  `feat(critical-jobs): … RemoteHandshakeExecutor …`).
- Confirm flag state on **both** machines: depackage cutover **OFF**, B1
  validation soak as-is.
- Confirm the depackaging worker bundle on the **sandbox** (mini-PC) matches the
  branch bundle (the sandbox is the node that actually runs `depackage`); reuse
  the V0/`0009` bundle-hash procedure.
- Both machines logged into the **same** SSO account (same `wrdesk_user_id`) —
  the critical-job gate requires a **same-principal internal** handshake.

## W1 — Pairing + topology config

1. Pair the workstation and the mini-PC over the normal device-pairing flow
   (pairing code) so an **internal** handshake reaches `ACTIVE` on both sides.
   Record the `handshakeId` and confirm `internal_coordination_identity_complete`.
2. On the **workstation**, configure linked topology so `depackage` (and
   `depackage-email`) route to the mini-PC sandbox. Either:
   - edit `orchestrator-mode.json` `linked`:
     ```json
     "linked": [
       { "role": "sandbox", "handshakeId": "<W1 handshakeId>", "jobKinds": ["depackage", "depackage-email"] }
     ]
     ```
   - **or** launch with `WRDESK_TOPOLOGY_LINKED='[{"role":"sandbox","handshakeId":"<id>","jobKinds":["depackage"]}]'`
     / `--topology-linked=…`.
3. Confirm validation: a deliberately illegal entry must be **dropped** with a
   `[CRITICAL_JOB_TOPOLOGY]` warning and must **not** route:
   - `decrypt-qbeap` in `jobKinds` (consumer-local, INV-6);
   - `view-attachment` linked to an `appliance` (INV-6).
4. **Evidence:** workstation log shows the validated `linked` entry; the
   resolution table now reports `remote-handshake` *available* for the linked
   kinds (was `E_NO_EXECUTOR` pre-config).

## W2 — Remote `depackage` of a real fetched email (placement-matrix topology (b))

Workstation → mini-PC sandbox → microVM → signed result back.

1. On the **workstation**, take a **real fetched email** (raw RFC822 from a
   connected provider account) and dispatch a `depackage` critical job. The
   workstation holds **no** depackage executor (INV-1) — it must route the opaque
   bytes over the internal handshake to the mini-PC.
2. On the **mini-PC sandbox**, observe the inbound `critical_job_request` at the
   ingest endpoint (Bearer-authed, direct — **not** relay), the gate pass
   (internal + ACTIVE + same-principal, size cap, replay dedupe), and the
   **sovereign re-dispatch** through the mini-PC's OWN dispatcher into the
   isolation microVM (or in-process on free).
3. The mini-PC returns a `critical_job_result` carrying the signed
   `CriticalJobResult`. On the **workstation**, confirm the sender verifies the
   job-result **signature** locally and the dispatcher `verify.ts` post-path
   accepts (`safe-text` re-validated), then the result is consumed.
4. **Evidence:** matching `request_id` on both sides; mini-PC log
   `[CRITICAL_JOB] … kind=depackage executor=in-process|microvm ok=true`;
   workstation shows `ok=true`, `meta.executorId=remote-handshake`, and a
   non-empty `safeText` derived **only** inside the mini-PC's isolation boundary
   (invariant-0 preserved: the workstation never parsed the bytes). Include a
   **mixed/carrier** email so the opaque-package (sealed-artifact) channel is
   exercised over the real wire.

## W3 — Link-down fail-closed (INV-3 / INV-7)

1. With a job mid-flight (or immediately before dispatch), drop the link to the
   mini-PC (kill the sandbox process / pull the network).
2. **Evidence:** the workstation dispatch returns `ok:false` with a typed
   `E_REMOTE_LINK_DOWN` (or `E_REMOTE_HANDSHAKE_INACTIVE` if the handshake left
   `ACTIVE`) within the wall-clock budget, and the call site maps it to the
   existing quarantine/retry path. There is **NO** local fallback to in-process on
   the workstation (the table never declared one) — verify the email is
   quarantined, not parsed locally.

## W4 — Oversize / replay refusals over the real channel

1. **Oversize:** craft a `depackage` request whose `inputBytes` exceed the
   receiving-side cap; dispatch from the workstation.
   - **Evidence:** mini-PC returns `critical_job_error code=E_REMOTE_PAYLOAD_TOO_LARGE`
     and **no worker is invoked** (refused at the gate); workstation surfaces it.
2. **Replay:** capture a valid `critical_job_request` and re-deliver the same
   `jobId` to the mini-PC.
   - **Evidence:** the second delivery returns `critical_job_error code=E_REMOTE_REPLAY`;
     the job runs **at most once**.
3. **(Optional, recommended) same-principal / decrypt-qbeap refusals over the
   wire:** confirm a request from a non-same-principal handshake is refused
   (`E_REMOTE_HANDSHAKE_INACTIVE`) and that a `decrypt-qbeap` request is refused
   (`E_KEY_LOCALITY`) — these are unit-proven in `0018`; W4 confirms them on the
   real channel.

---

## Acceptance

The W-series passes when W1–W4 are all green with evidence recorded in
`0020-w-series-verification-report.md`. On pass, Build C's remote-handshake
routing is accepted for the workstation→sandbox topology — the prerequisite the
appliance topology (next build) builds on. The W-series and V-series are
independent B-track gates; passing one does not imply the other.
