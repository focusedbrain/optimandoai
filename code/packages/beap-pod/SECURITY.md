# BEAP pod security posture (LOCAL_HOST and manifests)

This document describes enforced security invariants for the BEAP verification pod. These apply to **all users**, including free tier — hardening is not tier-gated.

## Container posture (per role)

Every container in `pod.yaml`, `pod-local-verify.yaml`, and `pod-remote-edge.yaml`:

| Control | Setting |
|--------|---------|
| User | Distinct non-root `runAsUser` per role (10100–10105 range) |
| Root FS | `readOnlyRootFilesystem: true` |
| Privilege escalation | `allowPrivilegeEscalation: false` |
| Capabilities | `drop: ["ALL"]` |
| Seccomp | `RuntimeDefault` or `Localhost` custom profile |
| Resources | CPU, memory, and **PID** limits per role |
| Scratch | Memory-backed `emptyDir` only; no persistent writable paths except role-specific tmpfs |
| Restart | `restartPolicy: Never` — Podman must not auto-restart |

### PID limits

| Role | `pids` limit |
|------|----------------|
| ingestor, validator, sealer, certifier, verifier | 64 |
| depackager | 128 |
| mail-fetcher (REMOTE_EDGE) | 256 |

### Seccomp

- **Depackager** (untrusted bytes): `Localhost` → `beap-depackager.json` (strictest custom profile).
- **Sealer / certifier**: `Localhost` → `beap-sealer.json` / `beap-certifier.json`.
- Other Node roles: `RuntimeDefault`.

Profiles are installed to `~/.local/share/containers/seccomp/` by the desktop app (`installSeccompProfiles.ts`) before `podman play kube`.

### Quarantine (LOCAL_HOST)

The host depackager mounts memory-backed `tmp-quarantine` at `/var/lib/quarantine`. The host supervisor picks up opaque blobs on a timer; they are **never parsed** on pickup.

## Runtime image integrity (A3)

Before each pod start, `podRunner` verifies `beap-components:dev` digest against `expected-image-digest.json`. Mismatch **fails closed** — the pod does not start.

Update after build:

```bash
pnpm --filter @repo/beap-pod run record-image-digest
```

Set `BEAP_SKIP_IMAGE_DIGEST_VERIFY=1` only for local debugging.

## Host supervisor policy (A5)

The Electron host supervisor is the **only** authority for container replacement and pod teardown. Podman `restartPolicy: Never` is intentional.

| Event | Action |
|-------|--------|
| Health probe fails 3× consecutively (`podman exec` Node loopback `/health`) | Replace container (`podman kill` + `start`) |
| Container exited / missing | Replace container |
| Replacement budget exceeded (5 per role / 10 min) | Stop pod, `replacement_exhausted`, notify user |
| Diagnostic file `escalation-*.json` | Stop pod immediately, `halted_by_anomaly`, no replacement |

Probe interval: 5 s. User **Try to recover** clears budget and restarts the pod.

## Failure policy (A6)

| Condition | Response |
|-----------|----------|
| Single message structural validation failure | HTTP 422, continue |
| Single message crypto failure | HTTP 422, continue |
| Single message depackaging failure | HTTP 422, quarantine payload, continue |
| Uncaught exception in role | Exit container |
| Stuck health probe | Exit container |
| N=10 validation failures / 60 s from same peer | Exit validator, escalation report, **pod teardown** |
| Structurally impossible state (`tamper_suspected`) | Escalation report, **pod teardown** |
| Seccomp / resource limit (kernel) | Process killed; supervisor surfaces event |

Escalation reports use filename pattern `escalation-*.json` under `/tmp/diagnostic-reports`.

## Mail-fetcher fetch-only boundary (Stream B)

The mail-fetcher role is **fetch-only**. Send capability is forbidden by:

- Shared `@repo/role-policy` (`edge_role_send_forbidden` for `edge_mail_fetcher` context)
- Startup assertion in `mail-fetcher/supervisor.ts` (exits if policy ever allows send)
- HTTP handler rejection of send-shaped paths (`403 forbidden_role`)
- No SMTP credentials or mounts in `pod-remote-edge.yaml` (IMAP/OAuth read bundles only under `/var/lib/mail-fetcher`)

Any future send path must remove or weaken all of these; CI `check:role-policy-gates` guards host orchestrator gates.

## CI

`packages/beap-pod/__tests__/podManifestSecurity.test.ts` asserts manifest invariants on every CI run.

`pnpm run check:role-policy-gates` verifies host fetch/send entry points call role policy.

## Threat model

See [THREAT_MODEL.md](./THREAT_MODEL.md).
