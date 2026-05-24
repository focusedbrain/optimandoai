# Credential security threat model (SSH / edge tier)

Phase 4.5 credential hardening (P4.5.11–P4.5.15). This document describes what the desktop main process defends against for **SSH private keys, passphrases, and related edge credentials**, and what remains out of scope.

## Scope

Applies to credentials handled by:

- Edge tier wizard (`wizard/sshSession.ts`)
- Replica and global SSH actions (`edge-tier/replicaActions*.ts`, `globalActions*.ts`)
- Email edge-fetch supervisor poll (SSH re-delivery)
- IPC boundaries between renderer and main (`wizard/ipc.ts`, dashboard IPC)

Does **not** cover vault master-password KDF, OAuth refresh tokens, or BEAP signing keys (separate models).

---

## Defended threats

| Threat | Mitigation | Step |
|--------|------------|------|
| SSH PEM written to renderer / IPC payloads | Main reads key files; renderer holds path only; `assertNoSecretsInValue` at IPC return | P4.5.11 |
| Credentials linger in main RAM after cancel / action complete | `Buffer` storage + `zeroizeBuffer` on every exit path; shutdown hook clears registered holders | P4.5.12 |
| MITM on repeat SSH connects | TOFU host key pinning; explicit user confirmation on fingerprint change | P4.5.13 |
| Credentials in logs, exceptions, or telemetry payloads | `scrubForLog` on all main-process console output; `assertNoSecretsInValue` on IPC; CI `no-credential-logs` regression | P4.5.14 |
| Credentials swapped to disk via page file / swap | Best-effort libsodium secure memory when APIs exist; always zero on release | P4.5.15 |

---

## Not defended (residual risk)

| Threat | Notes |
|--------|--------|
| Same-user malware / keyloggers | Any process running as the user can read process memory or intercept UI input. |
| Debugger / memory dump attached to the Electron main process | Developer tools or external debuggers can inspect live memory before zeroing. |
| Swap / hibernation **before** zeroing, when memory locking unavailable | Pageable `Buffer` objects may be written to the OS page file while credentials are loaded. |
| Core dumps | OS crash dumps may capture memory unless disabled at OS level. |
| Cold boot attacks | RAM retention attacks against powered-on machines are out of scope. |
| First-connect MITM (TOFU trust boundary) | Documented in `hostKeyStore.ts`; user must vet VPS provider on first wizard connect. |

---

## Container replacement model (Phase 5)

Phase 5 supervisor design (**replace-not-restart**) applies to BEAP pod containers on the edge VM and local pod, not to SSH credential handling above.

When a trust-sensitive container (ingestor, validator, depackager, sealer, certifier, mail-fetcher) fails:

1. The supervisor **destroys** the container (`podman rm -f`) and **creates a new instance** from the immutable image (`podman play kube` for that container). It does **not** use `podman restart` or Podman `restartPolicy: OnFailure` for those roles.
2. **Implication:** compromise or corruption confined to one container instance does **not** persist across replacement — ephemeral container state (memory, tmpfs, local files in the container rootfs) is discarded with the instance.
3. **Boundary:** the only deliberate state handed off across replacement is **queue position** (where the mail-fetch / ingest pipeline resumes). Quarantined crash-causing messages are stored separately (P5.5), not replayed automatically.
4. **Residual risk:** an attacker who can repeatedly trigger container crashes forces the supervisor to spend replacement budget (CPU, brief unavailability, operator noise). Mitigation: **replacement-budget circuit breaker** (P5.7) stops unbounded replace loops and surfaces the condition to the user.

Pod manifests move to `restartPolicy: Never` for trust-sensitive containers in P5.1 so Podman does not silently restart failed containers ahead of the supervisor.

---

## Memory locking (mlock) status

Implementation: `electron/main/security/secureMemory.ts` surveys **libsodium-wrappers** (already a dependency for vault crypto) for:

- `sodium_malloc` / `sodium_free`
- `sodium_mlock` / `sodium_munlock` (maps to `mlock(2)` on Linux, `VirtualLock` on Windows, `mlock` on macOS when available)
- `memzero` (used for zeroization when present)

### Current build (libsodium-wrappers Emscripten / WASM)

| Platform | `sodium_malloc` | `sodium_mlock` | Effective mode | User-facing guarantee |
|----------|-----------------|----------------|----------------|------------------------|
| Linux | **Not exported** | **Not exported** | `plain_buffer` | Zero-on-exit only; **not** non-pageable |
| Windows | **Not exported** | **Not exported** | `plain_buffer` | Same |
| macOS | **Not exported** | **Not exported** | `plain_buffer` | Same |

On startup, when locking is unavailable, main logs once:

`[credential-memory] memory locking not available on this platform — SSH credentials remain pageable until zeroed`

### Verification (when locking is wired)

On Linux with native libsodium secure-memory APIs available:

```bash
cat /proc/<main-pid>/smaps | grep VmLck
```

Expect non-zero `VmLck` while credentials are loaded during an SSH action.

---

## Follow-up (not implemented)

**Future hardening — native secure heap module (P4.5.x-future):**

The Emscripten `libsodium-wrappers` build does not expose `sodium_malloc` / `sodium_mlock`. A small native Node addon (or Electron rebuild against native libsodium) could provide true locked pages without replacing the existing crypto stack. Tracked as deferred work — complexity (cross-platform `electron-rebuild`, postinstall) outweighs benefit at the current threat model unless enterprise customers require swap exclusion.

Until then:

- `withCredential()` documents residual swap exposure in source.
- `zeroizeBuffer()` uses libsodium `memzero` when available, else `Buffer.fill(0)`.
- No user-facing copy claims non-pageable memory.

---

## Related files

| File | Role |
|------|------|
| `security/secureMemory.ts` | Survey, optional locked allocation, memzero |
| `security/zeroize.ts` | `withCredential`, registered clearers |
| `security/secretScrubber.ts` | Log / IPC scrubbing |
| `edge-tier/ssh/hostKeyStore.ts` | TOFU host key pins |
| `security/__tests__/credentialConsumers.snapshot.test.ts` | Registry of in-memory credential holders |

Phase 5 supervisor / container replacement is documented in the **Container replacement model** section above; implementation lives in `packages/pod-supervisor/` (P5.2+).

---

## Phase 4.5 exit

All five hardening steps (P4.5.11–P4.5.15) must pass automated tests before Phase 4.5 is closed. Live VPS + OAuth E2E remains the human gate per [`phase-4-5-manual-test.md`](phase-4-5-manual-test.md).
