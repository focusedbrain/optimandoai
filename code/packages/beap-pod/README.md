# BEAP Pod

Multi-container HTTP service for BEAP message ingest, validation, depackaging,
and sealing.  Phase 1 architecture: four isolated containers share one pod
network namespace; only the ingestor port is exposed to the host.

---

## Architecture

```
  Host / Electron
       │ POST /ingest (port 18100)
       ▼
  ┌─────────────────────────────────────────────────┐
  │  beap-pod (shared loopback 127.0.0.1)           │
  │                                                 │
  │  ingestor :18100 ──► validator :18101           │
  │                           │                     │
  │                      (message_package only)     │
  │                           ▼                     │
  │                    depackager :18102            │
  │                           │                     │
  │                           ▼                     │
  │                     sealer :18103               │
  └─────────────────────────────────────────────────┘
```

All inter-container traffic stays on loopback; authenticated via the shared
`POD_AUTH_SECRET` (`X-Pod-Auth` header, HMAC-SHA256).

---

## Roles

| Container  | Port  | UID   | Purpose                                    |
|-----------|-------|-------|--------------------------------------------|
| ingestor  | 18100 | 10100 | Entry point; size/type checks; forward to validator |
| validator | 18101 | 10101 | Structural + content validation; close MAX_STRING_LENGTH / ALLOWED_CONTENT_TYPES gaps |
| depackager| 18102 | 10102 | qBEAP/pBEAP decrypt (X25519 + ML-KEM-768); 6-gate pipeline; HTML sanitization |
| sealer    | 18103 | 10103 | HMAC-SHA256 seal over depackaged content; strictest seccomp profile |
| certifier | 18104 | 10104 | REMOTE_EDGE only: Ed25519 edge certificate; strict seccomp; no seal |
| verifier  | 18105 | 10105 | LOCAL_VERIFY only: `/verify-cert` (P3.6+) |
| mail-fetcher | 18106 | 10106 | REMOTE_EDGE only: per-account email fetch + supervisor API (P4.5.5) |

---

## Running the local pod

Container restart is handled by the BEAP supervisor on the desktop, not by Podman. A failed container stays down until the supervisor replaces it from the immutable image.

### Prerequisites

```bash
# Podman ≥ 4.0 (rootless)
podman --version

# envsubst (part of gettext-base on Debian/Ubuntu, gettext on macOS Homebrew)
envsubst --version

# curl, openssl (usually pre-installed)
```

### 1. Build the image

```bash
# From the repository root
podman build -t beap-components:dev -f packages/beap-pod/Containerfile .
```

### 2. Install the sealer seccomp profile

The sealer container uses a strict custom seccomp allowlist.  Install it to the
podman rootless seccomp directory before starting the pod:

```bash
# Rootless podman (default path)
mkdir -p ~/.local/share/containers/seccomp
cp packages/beap-pod/seccomp/sealer.json \
   ~/.local/share/containers/seccomp/beap-sealer.json
```

> **Rootful podman** uses `/var/lib/containers/seccomp/`.  Override the lookup
> root with `--seccomp-profile-root /path/to/seccomp` on the `podman play kube`
> command.

### 3. Generate secrets

```bash
export POD_AUTH_SECRET="$(openssl rand -hex 32)"
export SEAL_KEY_HEX="$(openssl rand -hex 32)"

# Optional: persist to a .env file that is NOT committed to git
echo "POD_AUTH_SECRET=${POD_AUTH_SECRET}" >> .env.pod.local
echo "SEAL_KEY_HEX=${SEAL_KEY_HEX}"       >> .env.pod.local
```

`POD_AUTH_SECRET` is shared by all four containers for inter-container
authentication.  `SEAL_KEY_HEX` is injected only into the sealer; it is read
once at startup, then the env var is zeroed and deleted from the sealer's
process memory.

### 4. Start the pod

```bash
envsubst < packages/beap-pod/pod.yaml | podman play kube -
```

`envsubst` replaces `${POD_AUTH_SECRET}` and `${SEAL_KEY_HEX}` in the manifest
before piping it to podman.  **Never commit a manifest that contains real secret
values.**

Wait for all containers to be ready (the ingestor `/ready` endpoint returns 200
when it can reach the validator):

```bash
# Poll until ready (up to 30 s)
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18100/health)
  [ "$code" = "200" ] && echo "Ready" && break
  sleep 1
done
```

### 5. Verify health

```bash
curl http://127.0.0.1:18100/health
# → {"status":"ok","role":"ingestor","version":"1.0.0"}

curl http://127.0.0.1:18100/ready
# → {"status":"ready","role":"ingestor"}
```

### 6. Send a test message

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"header":{"capsule_type":"handshake","schema_version":1,"sender_key_id":"s1","receiver_key_id":"r1","timestamp":"2026-01-01T00:00:00Z"},"metadata":{},"payload":"","signature":{"value":"test"}}' \
  http://127.0.0.1:18100/ingest
```

### 7. Stop and remove the pod

```bash
podman pod stop beap-pod
podman pod rm   beap-pod
```

---

## Running a REMOTE_EDGE pod

Container restart is handled by the BEAP supervisor on the desktop, not by Podman. A failed container stays down until the supervisor replaces it from the immutable image.

REMOTE_EDGE mode runs on a user-owned Linux VM (paid tier). The edge validates
and depackages inbound BEAP traffic, then **certifies** the result with an
Ed25519 edge certificate bound to SSO identity. It does **not** seal — the
local LOCAL_VERIFY pod re-validates and seals after verifying the certificate.

```
  Inbound BEAP (host :18100)
       ▼
  ingestor :18100 ──► validator :18101 ──► depackager :18102 ──► certifier :18104
                                                                    (Ed25519 sign)

  mail-fetcher :18106 ──► IMAP/OAuth (egress) ──► POST /ingest on :18100
       ▲
  tmpfs credentials at /var/lib/mail-fetcher (supervisor API; desktop P4.5.8+)
```

Five containers share the pod network namespace. Only ingestor **18100** is published on
the host. Mail-fetcher **18106** is loopback-only and is the only container that
requires outbound network (IMAP `:993` and OAuth/Graph HTTPS — see manifest header).

### Prerequisites

Same as [Running the local pod](#running-the-local-pod): podman ≥ 4.0,
`envsubst`, `curl`, `openssl`, and a built `beap-components:dev` image.

### 1. Install the certifier seccomp profile

```bash
mkdir -p ~/.local/share/containers/seccomp
cp packages/beap-pod/seccomp/certifier.json \
   ~/.local/share/containers/seccomp/beap-certifier.json
```

The certifier profile is derived from `sealer.json` with the same strict
allowlist (Strategy §1.3). UID **10104**; port **18104** (loopback only inside
the pod). UID **10103** remains reserved for the sealer in LOCAL_VERIFY.

### 2. Generate secrets and edge identity (manual — Phase 4 wizard automates)

| Variable | Source | Description |
|----------|--------|-------------|
| `POD_AUTH_SECRET` | `openssl rand -hex 32` | Shared inter-container auth (all five containers) |
| `EDGE_PRIVATE_KEY_HEX` | Ed25519 secret key, 32 bytes hex | Certifier only; generated in Electron in production (§2.5) |
| `EDGE_POD_ID` | UUID v4 | Identifies this edge pod instance |
| `SSO_ATTESTATION_JWT` | Keycloak at deploy time | JWT binding `EDGE_POD_ID` to user `sub` |
| `CERT_TTL_SECONDS` | Optional (default **86400**) | Certificate lifetime in seconds (24 h per Decision 4) |

Example (smoke / dev only — **not** production Keycloak flow):

```bash
export POD_AUTH_SECRET="$(openssl rand -hex 32)"
export CERT_TTL_SECONDS="${CERT_TTL_SECONDS:-86400}"

# Generate test Ed25519 key + stub JWT (see scripts/remote-edge-smoke.sh for full example)
eval "$(cd "$(git rev-parse --show-toplevel)" && node --input-type=module <<'NODE'
import { ed25519 } from '@noble/curves/ed25519.js';
import { randomUUID } from 'node:crypto';
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const sk = ed25519.utils.randomSecretKey();
const edgePodId = randomUUID();
const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const p = Buffer.from(JSON.stringify({ sub: 'dev-user', pod_id: edgePodId })).toString('base64url');
console.log(`export EDGE_PRIVATE_KEY_HEX=${hex(sk)}`);
console.log(`export EDGE_POD_ID=${edgePodId}`);
console.log(`export SSO_ATTESTATION_JWT=${h}.${p}.dev-stub`);
NODE
)"
```

The certifier **must refuse to start** if `EDGE_PRIVATE_KEY_HEX`, `EDGE_POD_ID`,
or `SSO_ATTESTATION_JWT` is missing or malformed (enforced in P3.4).

### 3. Start the REMOTE_EDGE pod

```bash
envsubst < packages/beap-pod/pod-remote-edge.yaml | podman play kube -
```

Validate the manifest without starting:

```bash
envsubst < packages/beap-pod/pod-remote-edge.yaml | podman play kube --dry-run -
```

Only ingestor port **18100** is exposed on the host. Ports 18101–18102, 18104, and
18106 are loopback-only inside the pod network namespace.

Mail-fetcher egress (VM firewall / CNI — see `pod-remote-edge.yaml` header):

- TCP **993** — `imap.gmail.com`, `outlook.office365.com`
- TCP **443** — `oauth2.googleapis.com`, `login.microsoftonline.com`, `graph.microsoft.com`

### 4. Verify and stop

```bash
curl http://127.0.0.1:18100/health
podman pod stop beap-pod-remote-edge
podman pod rm   beap-pod-remote-edge
```

### REMOTE_EDGE smoke test

```bash
bash packages/beap-pod/scripts/remote-edge-smoke.sh
bash packages/beap-pod/scripts/remote-edge-smoke.sh --skip-build
```

```bash
bash packages/beap-pod/scripts/remote-edge-smoke.sh
bash packages/beap-pod/scripts/remote-edge-smoke.sh --skip-build
```

---

## Running a LOCAL_VERIFY pod

Container restart is handled by the BEAP supervisor on the desktop, not by Podman. A failed container stays down until the supervisor replaces it from the immutable image.

LOCAL_VERIFY mode runs on the user's desktop (Electron). It accepts inbound BEAP
traffic that includes an **edge certificate** from a REMOTE_EDGE pod the user
owns. The verifier checks the certificate and SSO attestation **before** the
local validator runs; validate → depackage → seal is then identical to LOCAL_HOST.

```
  Inbound BEAP + edge_certificate (host :18100)
       ▼
  ingestor :18100 ──► verifier :18105 ──► validator :18101
                           │                  │
                           │                  ▼
                           │           depackager :18102 ──► sealer :18103
                           │                                    (HMAC seal)
                           └── checks cert + SSO attestation (P3.6)
```

Same container image as LOCAL_HOST; five containers share one pod network
namespace. Only ingestor port **18100** is exposed on the host.

### Prerequisites

Same as [Running the local pod](#running-the-local-pod): podman ≥ 4.0,
`envsubst`, `curl`, `openssl`, node ≥ 18, and a built `beap-components:dev`
image.

### 1. Install the sealer seccomp profile

Same as LOCAL_HOST — the sealer uses `beap-sealer.json`:

```bash
mkdir -p ~/.local/share/containers/seccomp
cp packages/beap-pod/seccomp/sealer.json \
   ~/.local/share/containers/seccomp/beap-sealer.json
```

The verifier uses `RuntimeDefault` seccomp (same as the validator) — CPU-bound
crypto only; no outbound network in Phase 3.

### 2. Generate secrets and verifier identity

| Variable | Source | Description |
|----------|--------|-------------|
| `POD_AUTH_SECRET` | `openssl rand -hex 32` | Shared inter-container auth (all five containers) |
| `SEAL_KEY_HEX` | `openssl rand -hex 32` | Sealer-only HMAC key (same as LOCAL_HOST) |
| `LOCAL_SSO_SUB` | Keycloak `sub` at app start | User identity the verifier binds to |
| `TRUSTED_EDGE_POD_IDS` | Comma-separated UUIDs | Edge pod IDs the user has deployed |
| `KEYCLOAK_JWKS_JSON` | Preloaded JWKS (single-line JSON) | Keycloak public keys for attestation JWT verification |

**JWKS egress trade-off (Phase 3 default: preloaded, no verifier egress):**

| Approach | Pros | Cons |
|----------|------|------|
| **Preloaded `KEYCLOAK_JWKS_JSON`** (default) | No outbound HTTPS from verifier; smallest attack surface | Stale if Keycloak rotates keys without refresh |
| **On-demand `KEYCLOAK_JWKS_URL`** (Phase 4+) | Always fresh keys | Requires egress whitelist to Keycloak |

Electron refreshes preloaded JWKS on app start and on attestation verification
failure. The verifier **must refuse to start** if `LOCAL_SSO_SUB` or a JWKS
source (`KEYCLOAK_JWKS_JSON` or `KEYCLOAK_JWKS_URL`) is missing (enforced in P3.6).

Example (smoke / dev only):

```bash
export POD_AUTH_SECRET="$(openssl rand -hex 32)"
export SEAL_KEY_HEX="$(openssl rand -hex 32)"
export LOCAL_SSO_SUB="your-keycloak-sub-uuid"
export TRUSTED_EDGE_POD_IDS="edge-pod-uuid-1,edge-pod-uuid-2"

# Preloaded JWKS — replace with real Keycloak JWKS JSON (single line)
export KEYCLOAK_JWKS_JSON='{"keys":[...]}'
```

The manifest uses a `__KEYCLOAK_JWKS_JSON__` placeholder; substitute it before
apply (the smoke script patches via node — see `scripts/local-verify-smoke.sh`).

### 3. Start the LOCAL_VERIFY pod

```bash
envsubst '${POD_AUTH_SECRET} ${SEAL_KEY_HEX} ${LOCAL_SSO_SUB} ${TRUSTED_EDGE_POD_IDS}' \
  < packages/beap-pod/pod-local-verify.yaml \
  | sed "s|__KEYCLOAK_JWKS_JSON__|${KEYCLOAK_JWKS_JSON//\"/\\\"}|" \
  | podman play kube -
```

Validate the manifest without starting:

```bash
envsubst '${POD_AUTH_SECRET} ${SEAL_KEY_HEX} ${LOCAL_SSO_SUB} ${TRUSTED_EDGE_POD_IDS}' \
  < packages/beap-pod/pod-local-verify.yaml \
  | sed "s|__KEYCLOAK_JWKS_JSON__|${KEYCLOAK_JWKS_JSON//\"/\\\"}|" \
  | podman play kube --dry-run -
```

Only ingestor port **18100** is exposed on the host. Ports 18101–18103 and
18105 are loopback-only inside the pod network namespace.

### 4. Verify and stop

```bash
curl http://127.0.0.1:18100/health
podman pod stop beap-pod-local-verify
podman pod rm   beap-pod-local-verify
```

### LOCAL_VERIFY smoke test

```bash
bash packages/beap-pod/scripts/local-verify-smoke.sh
bash packages/beap-pod/scripts/local-verify-smoke.sh --skip-build
```

Requires Linux/podman. Tests cert verification (positive + tampered cert rejection) through the full LOCAL_VERIFY pipeline.

---

## Smoke test

An automated smoke script covers build → secrets → start → health checks →
end-to-end ingest → teardown:

```bash
# Full run (builds image)
bash packages/beap-pod/scripts/pod-smoke.sh

# Skip the image build if already built
bash packages/beap-pod/scripts/pod-smoke.sh --skip-build
```

The script exits 0 on success and tears down the pod regardless of outcome.

---

## Seccomp profiles

| Container  | Profile           | Notes |
|-----------|-------------------|-------|
| ingestor  | `RuntimeDefault`  | OCI default |
| verifier  | `RuntimeDefault`  | Same as validator; CPU-bound crypto, loopback only |
| validator | `RuntimeDefault`  | OCI default |
| depackager| `RuntimeDefault`  | OCI default (ML-KEM-768 + AES-GCM require V8 JIT syscalls) |
| sealer    | `Localhost: beap-sealer.json` | Strict allowlist; no execve, no fork, no ptrace, no keyctl, no mount. See `seccomp/sealer.json` for the full removal list and rationale. |
| certifier | `Localhost: beap-certifier.json` | Same strictness as sealer; derived from `sealer.json`. See `seccomp/certifier.json`. |

Long-term goal (Phase 3+): compile the sealer to a standalone binary to reduce
the syscall surface to the read/write/futex/exit class called out in Strategy §1.3.

---

## Endpoints

All endpoints behind `POST /ingest` require `X-Pod-Auth` (inter-container
authentication, not exposed to external callers).

| Container  | Method | Path       | Description                                  |
|-----------|--------|------------|----------------------------------------------|
| ingestor  | GET    | /health    | `{ status: 'ok', role, version }`            |
| ingestor  | GET    | /ready     | `{ status: 'ready' }` when validator reachable |
| ingestor  | POST   | /ingest    | Entry point for all BEAP messages            |
| validator | GET    | /health    | Role liveness (loopback only)                |
| validator | GET    | /ready     | Ready when validation libs loaded            |
| validator | POST   | /validate  | Structural + content validation (X-Pod-Auth) |
| depackager| GET    | /health    | Role liveness (loopback only)                |
| depackager| GET    | /ready     | Ready when receiver key material injected    |
| depackager| POST   | /depackage | qBEAP/pBEAP decrypt + 6-gate (X-Pod-Auth)   |
| sealer    | GET    | /health    | Role liveness (loopback only)                |
| sealer    | GET    | /ready     | Ready once seal key loaded                   |
| sealer    | POST   | /seal      | HMAC-SHA256 seal computation (X-Pod-Auth)    |
| verifier  | GET    | /health    | Role liveness (loopback only; LOCAL_VERIFY)  |
| verifier  | GET    | /ready     | Ready when JWKS + LOCAL_SSO_SUB loaded (P3.6) |
| verifier  | POST   | /verify-cert | Edge cert + SSO attestation gate (X-Pod-Auth; P3.6) |

---

## Environment variables

### All containers

| Variable         | Required | Description                              |
|-----------------|----------|------------------------------------------|
| `BEAP_ROLE`      | Yes      | `ingestor` / `validator` / `depackager` / `sealer` / `certifier` / `verifier` |
| `PORT`           | No       | Listening port (default per role)        |
| `POD_AUTH_SECRET`| Yes      | Shared inter-container HMAC secret       |
| `POD_VERSION`    | No       | Version reported in /health (default `1.0.0`) |

### Ingestor only

| Variable           | Default                      | Description          |
|-------------------|------------------------------|----------------------|
| `VALIDATOR_BASE`   | `http://127.0.0.1:18101`     | Validator container URL |

### Validator only

| Variable            | Default                      | Description           |
|--------------------|------------------------------|-----------------------|
| `DEPACKAGER_BASE`   | `http://127.0.0.1:18102`     | Depackager container URL |

### Depackager only

| Variable                   | Default                   | Description                     |
|---------------------------|---------------------------|---------------------------------|
| `SEALER_BASE`              | `http://127.0.0.1:18103`  | Sealer container URL            |
| `DEPACKAGER_TIMEOUT_MS`    | `5000`                    | Wall-clock timeout per request  |
| `BEAP_LOCAL_X25519_PRIV_B64` | —                       | Receiver X25519 private key (base64) |
| `BEAP_LOCAL_MLKEM_SECRET_B64` | —                      | Receiver ML-KEM-768 secret (base64) |

### Sealer only

| Variable      | Required | Description                                      |
|--------------|----------|--------------------------------------------------|
| `SEAL_KEY_HEX`| Yes      | HMAC-SHA256 key (hex, ≥ 32 bytes). Zeroed after startup. |
| `SEALER_HOST` | No       | Bind address (default `127.0.0.1`)               |

### Certifier only (REMOTE_EDGE)

| Variable               | Required | Description |
|------------------------|----------|-------------|
| `EDGE_PRIVATE_KEY_HEX` | Yes      | Ed25519 private key (32 bytes hex). Zeroed after startup (P3.4). |
| `EDGE_POD_ID`          | Yes      | UUID for this edge pod |
| `SSO_ATTESTATION_JWT`  | Yes      | Keycloak JWT binding pod to user `sub` |
| `CERT_TTL_SECONDS`     | No       | Default `86400` (24 h) |
| `CERTIFIER_HOST`       | No       | Bind address (default `127.0.0.1`) |

### Depackager (REMOTE_EDGE)

| Variable         | Default                      | Description |
|-----------------|------------------------------|-------------|
| `CERTIFIER_BASE` | `http://127.0.0.1:18104`    | Certifier URL when `POD_MODE=REMOTE_EDGE` (wired in P3.4) |

### Verifier only (LOCAL_VERIFY)

| Variable               | Required | Description |
|------------------------|----------|-------------|
| `LOCAL_SSO_SUB`        | Yes      | User's Keycloak `sub` claim |
| `TRUSTED_EDGE_POD_IDS` | Yes      | Comma-separated edge pod UUIDs |
| `KEYCLOAK_JWKS_JSON`   | Yes*     | Preloaded JWKS (Phase 3 default; no egress) |
| `KEYCLOAK_JWKS_URL`    | Yes*     | Alternative: fetch JWKS at runtime (requires egress) |
| `VALIDATOR_BASE`       | No       | Default `http://127.0.0.1:18101` |
| `VERIFIER_HOST`        | No       | Bind address (default `127.0.0.1`) |

\* One of `KEYCLOAK_JWKS_JSON` or `KEYCLOAK_JWKS_URL` must be set.

---

## Development

```bash
# From repo root
pnpm --filter @repo/beap-pod build  # compile TypeScript
pnpm --filter @repo/beap-pod test   # run all unit tests (73 tests)

# Build image
podman build -t beap-components:dev -f packages/beap-pod/Containerfile .
```

## Structure

```
packages/beap-pod/
├── Containerfile               single image, all roles
├── entrypoint.sh               role dispatcher (BEAP_ROLE env)
├── pod.yaml                    LOCAL_HOST manifest (podman play kube)
├── pod-remote-edge.yaml        REMOTE_EDGE manifest (no sealer; certifier :18104)
├── pod-local-verify.yaml       LOCAL_VERIFY manifest (verifier :18105 + sealer)
├── seccomp/
│   ├── sealer.json             strict seccomp allowlist for sealer
│   └── certifier.json          strict seccomp for certifier (from sealer.json)
├── scripts/
│   ├── pod-smoke.sh            LOCAL_HOST automated smoke test
│   ├── remote-edge-smoke.sh    REMOTE_EDGE smoke test
│   └── local-verify-smoke.sh   LOCAL_VERIFY smoke test
├── src/
│   ├── roles/
│   │   ├── ingestor.ts         HTTP server, port 18100
│   │   ├── validator.ts        HTTP server, port 18101
│   │   ├── depackager.ts       HTTP server, port 18102
│   │   ├── depackagePipeline.ts  crypto helpers + 6-gate pipeline
│   │   └── sealer.ts           HTTP server, port 18103
│   └── shared/
│       └── podAuth.ts          X-Pod-Auth inter-container auth helper
└── beapStructuralValidator.ts  pure structural validation (schema checks)
```
