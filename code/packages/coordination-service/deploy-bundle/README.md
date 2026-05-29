# Relay deploy bundle

Version-controlled artifacts for the wrdesk.com relay host (`/opt/beap` layout).

## Full relay host bootstrap (Podman + ingestor + preflight)

Fail-closed: exits non-zero if Podman or BEAP ingestor isolation is unavailable.

```bash
export POD_AUTH_SECRET="$(openssl rand -hex 32)"
export BEAP_REPO_ROOT=/path/to/checkout

sudo -E ./packages/coordination-service/deploy-bundle/deploy-relay-host.sh
```

Steps:

1. Verify `podman` on PATH and `podman info` succeeds
2. Start relay ingestor pod (`packages/beap-pod/pod-relay-host.yaml` via `podman play kube`)
3. Run `scripts/beap-isolation-preflight.sh` (Podman + ingestor `/health`)
4. Optionally install license attribution under `/opt/beap/licenses`

Requires: `podman`, `envsubst`, `curl` on the relay host. Podman is **not** bundled in the coordination image.

## License attribution (separate step)

After coordination is deployed, run:

```bash
sudo BEAP_RELAY_LICENSES_DIR=/opt/beap/licenses \
  ./packages/coordination-service/deploy-bundle/install-relay-licenses.sh
```

Default destination: `/opt/beap/licenses/`

- `beap-coordination-THIRD-PARTY-NOTICES` — full notices document
- `beap-coordination-licenses/` — supplemental base-image notices

The running container also carries copies at `/app/THIRD-PARTY-NOTICES` and `/app/licenses/` (baked in Dockerfile).

## Cross-surface Podman contract

Orchestrator, edge SSH deploy, and relay host gates share `@repo/podman-probe` (`packages/podman-probe`). CI runs `pnpm run check:podman-probe-contract` to detect drift.
