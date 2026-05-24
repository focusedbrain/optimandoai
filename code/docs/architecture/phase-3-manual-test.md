# Phase 3 — Manual end-to-end test (edge certification)

Branch: `phase-1/pod-becomes-hot-path`  
Date documented: 2026-05-24

This procedure proves the full **REMOTE_EDGE → LOCAL_VERIFY → seal** path with one manually deployed edge pod and the Electron dev UI audit trail. Requires **Linux** for local pod + optional Linux VM (or podman-in-podman) for the edge.

## Prerequisites

- Linux host with **podman**, **Node 20+**, **pnpm**, repo checked out on `phase-1/pod-becomes-hot-path`
- BEAP pod image built: `pnpm --filter @repo/beap-pod build` and `podman build -t beap-components:dev -f packages/beap-pod/Containerfile packages/beap-pod`
- Seccomp profiles installed per `packages/beap-pod/README.md`
- SSO session in the Electron app (or `BEAP_ATTESTATION_STUB=1` + `WR_DESK_SSO_ACCESS_TOKEN` for CLI-only attestation stub)
- Vault unlocked (local pod starts after unlock)
- Dev VMK derive key for edge-cli: `export BEAP_EDGE_DEV_DERIVE_KEY_HEX=$(openssl rand -hex 32)`

## 1. Deploy REMOTE_EDGE on a Linux target

Use a Hetzner VM, local KVM, or podman-in-podman container with SSH.

```bash
# On dev machine — generate identity (private key encrypted to VMK-derived dev key)
pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts generate-keypair \
  --derive-key-hex "$BEAP_EDGE_DEV_DERIVE_KEY_HEX"

# Register replica + attestation (stub or real Keycloak)
export BEAP_ATTESTATION_STUB=1
export WR_DESK_SSO_ACCESS_TOKEN="<your-access-token-or-stub>"
pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts register-edge \
  --host <EDGE_VM_IP> --port 18100 \
  --derive-key-hex "$BEAP_EDGE_DEV_DERIVE_KEY_HEX" \
  --sso-token "$WR_DESK_SSO_ACCESS_TOKEN"

# Deploy pod to VM (Linux-only; refuses non-Linux uname)
pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts deploy-edge \
  --host <EDGE_VM_IP> --user <ssh-user> --ssh-key ~/.ssh/id_ed25519 \
  --derive-key-hex "$BEAP_EDGE_DEV_DERIVE_KEY_HEX"
```

Verify edge ingestor responds: `curl -sS -o /dev/null -w "%{http_code}" http://<EDGE_VM_IP>:18100/health` → `200`.

## 2. Enable edge tier and LOCAL_VERIFY local pod

```bash
pnpm exec tsx apps/electron-vite-project/scripts/edge-cli.ts enable-edge-tier \
  --derive-key-hex "$BEAP_EDGE_DEV_DERIVE_KEY_HEX"
```

Or set `edge-tier-settings.json` → `"enabled": true` and restart vault / local pod.

Confirm local pod mode:

```bash
podman ps --filter name=beap-pod-local-verify
podman inspect beap-pod-local-verify-verifier --format '{{.Config.Env}}' | grep LOCAL_SSO_SUB
```

Electron **Edge tier** panel (bottom-right toggle) should show **Mode: LOCAL_VERIFY** and configured replica host/`edge_pod_id`.

## 3. Positive path — edge → local → sealed

1. Start Electron on Linux with vault unlocked and SSO session active.
2. Send a synthetic BEAP message (extension ingest, inbox test message, or `processIncomingInput` harness) that routes through `@repo/pod-client` with edge tier enabled.
3. Expect success: message validated and sealed (handshake pipeline or inbox path per capsule type).
4. Open **Edge tier → Edge verifications**: two rows typical for one ingest — **shallow** `verified`, then **deep** `verified` (same `edge_pod_id`, your SSO `sub`).

CLI spot-check audit file:

```bash
cat ~/.config/wr-desk/edge-verification-audit.json | jq '.verifications[-3:]'
```

## 4. Negative — edge unreachable (`EDGE_UNREACHABLE`)

```bash
# On edge VM
podman pod stop beap-pod-remote-edge
```

Send another message. Expect ingestion rejection with reason **EDGE_UNREACHABLE** (no fallback in Phase 3). Local pod should not seal the payload.

Restart edge pod before continuing:

```bash
# re-run deploy-edge or podman play kube on VM
```

## 5. Negative — tampered certificate (`PACKAGE_HASH_MISMATCH`)

Use a debug HTTP proxy (mitmproxy, socat, or a one-off Node relay) between pod-client and local ingestor:

1. Let edge return a valid `{ certificate, depackaged_payload }`.
2. Before POST to local `18100/ingest`, mutate `edge_certificate.package_hash` (or swap cert body) while keeping original `body` bytes.
3. Local verifier shallow check should fail with **PACKAGE_HASH_MISMATCH**.
4. **Edge verifications** panel shows `PACKAGE_HASH_MISMATCH` for that attempt; message is not sealed.

Alternative without proxy: modify cert in a unit/integration test (`podHotPath.edgeTier`) — manual proxy proves full stack.

## 6. JWKS refresh visibility

After vault unlock, **Edge tier status** shows **JWKS last refreshed** timestamp (from `edge-tier-settings.json` `cached_jwks_fetched_at`). Stale JWKS refresh on verification failure is exercised by rotating Keycloak keys (Phase 4 wizard automates this).

## Pass criteria (Phase 3 done)

| Check | Expected |
|-------|----------|
| Edge deploy + register | REMOTE_EDGE pod running on Linux VM |
| `edge_tier.enabled` | Local pod restarts as LOCAL_VERIFY |
| Positive ingest | Edge cert → local verify → seal |
| Audit UI | Real shallow/deep rows with `edge_pod_id`, `sub`, `verified` |
| Edge stopped | `EDGE_UNREACHABLE`, no seal |
| Cert tamper | `PACKAGE_HASH_MISMATCH` in audit + rejection |
| Automated tests | `pnpm --filter @repo/beap-pod test`, `pnpm --filter @repo/pod-client test`, electron edge-tier + audit tests pass |

## Notes

- Phase 3 UI is **read-only** (no wizard, no replica editing). Use `edge-cli` for config.
- Verifier emits one JSON line per `/verify-cert` to stdout; Electron tails `podman logs -f beap-pod-local-verify-verifier`.
- Do **not** merge Phase 3 branch to `main` until Phase 4+ sign-off.
