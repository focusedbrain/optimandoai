# BEAP host pod — focused threat model (Stream A)

This is not an exhaustive product threat model. It documents threats **this hardening stream addresses** and what remains **out of scope**.

## In scope (defended)

| Threat | Mitigation |
|--------|------------|
| Untrusted attachment / parser exploit in depackager | Strict seccomp, read-only root, PID/memory limits, quarantine tmpfs, no auto-restart thrashing |
| Validator flood from one peer | Per-peer rate limit (10 / 60 s) → container exit + pod teardown |
| Tamper / impossible structural state | `tamper_suspected` → escalation report + pod halt |
| Runtime image swap (same tag, different layers) | Digest verify on every `podman play kube` |
| Stuck or crashed container | Host supervisor health probes + replacement |
| Fork-bomb / PID exhaustion in one container | `pids` cgroup limit per role |
| Silent auto-restart masking attacks | `restartPolicy: Never`; supervisor-only recovery |

## Out of scope (not defended here)

- **Compromised host kernel** or hypervisor — container isolation cannot help.
- **Malicious insider with vault + desktop access** — can disable checks or exfiltrate keys.
- **Supply-chain compromise of build pipeline** — digest pinning detects local store swaps, not upstream build tampering (cosign / sigstore deferred).
- **TPM / measured boot / hardware attestation** — Phase 3.
- **Edge tier SSH wizard** — Streams C/D.
- **Send/receive role separation when edge active** — Stream B.

## Assumptions

- Podman is correctly installed and not replaced by an attacker before first run.
- User reviews anomaly notifications before opting into **Try to recover**.
- Held messages remain opaque encrypted blobs (established by hold-queue work).
