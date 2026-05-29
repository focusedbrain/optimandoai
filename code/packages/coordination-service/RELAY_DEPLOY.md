# Relay deploy — BEAP container isolation (release-blocking)

Podman on the **relay host** is mandatory. The coordination-service Node process must not validate untrusted relay capsules in-process in production.

## Surfaces

| Surface | Gate | On failure |
|--------|------|------------|
| **Host (desktop)** | `runStartupPodmanProbe()` → `beapPreflightGate` blocks P2P/coordination WS/relay pull until Podman + machine ready | Blocking `PodmanRequiredModal` (no dismiss-and-continue) |
| **Relay (wrdesk.com)** | Shell preflight + Node `runRelayPodIsolationPreflight()` before `server.listen` | `exit 1`, loud stderr; service never listens |

## Relay host bootstrap order

1. Install **Podman** on the Linux VM (do **not** bundle Podman inside the coordination Docker image).
2. Build/load `beap-components:dev` images per `packages/beap-pod/README.md`.
3. Start relay pod:
   ```bash
   export POD_AUTH_SECRET="$(openssl rand -hex 32)"
   envsubst < packages/beap-pod/pod-relay-host.yaml | podman play kube -
   ```
4. Run shell preflight:
   ```bash
   COORD_BEAP_INGESTOR_URL=http://127.0.0.1:18100 \
     packages/coordination-service/scripts/beap-isolation-preflight.sh
   ```
5. Start coordination-service with `COORD_BEAP_INGESTOR_URL=http://127.0.0.1:18100` (default).

## Where to wire the shell gate (if not using docker-entrypoint)

- **systemd**: `ExecStartPre=/path/to/beap-isolation-preflight.sh`
- **compose**: `depends_on` + health on ingestor, or `command: sh -c './beap-isolation-preflight.sh && node ...'`
- **IaC / Ansible**: task before `systemctl start coordination-service`

Node boot preflight is already in `packages/coordination-service/src/index.ts`.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `COORD_BEAP_INGESTOR_URL` | `http://127.0.0.1:18100` | Ingestor for `/relay-validate` + health preflight |
| `COORD_BEAP_PREFLIGHT_TIMEOUT_MS` | `10000` | Boot health probe timeout |
| `COORD_BEAP_VALIDATE_TIMEOUT_MS` | `15000` | Per-capsule relay validation timeout |
| `COORD_BEAP_ISOLATION_SKIP` | — | **Dev/test only** — skips preflight and in-process validation fallback |
| `COORD_TEST_MODE` | — | Vitest — same as skip |

## Capsule path (production)

`POST /beap/capsule` → `validateRelayCapsuleViaIngestor` → ingestor `POST /relay-validate` (container) → store on success. Ingestor unreachable → **503** `POD_ISOLATION_UNAVAILABLE` (fail closed).

## Third-party license notices (relay-only)

| Artifact | Path |
|----------|------|
| Notices document | `packages/coordination-service/THIRD-PARTY-NOTICES` |
| Regenerate npm table | `pnpm --filter @repo/coordination-service licenses:generate` |
| In image | `/app/THIRD-PARTY-NOTICES`, `/app/licenses/`, symlink under `/usr/share/licenses/beap-coordination/` |
| On host (optional step) | `/opt/beap/licenses/` via `deploy-bundle/install-relay-licenses.sh` |

**Not** merged into repo-root `THIRD_PARTY_LICENSES.md` (desktop/orchestrator scope).

Podman on the relay VM: Apache-2.0, https://podman.io — external runtime, not redistributed in the image.
