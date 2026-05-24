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

---

## Running the local pod

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
| validator | `RuntimeDefault`  | OCI default |
| depackager| `RuntimeDefault`  | OCI default (ML-KEM-768 + AES-GCM require V8 JIT syscalls) |
| sealer    | `Localhost: beap-sealer.json` | Strict allowlist; no execve, no fork, no ptrace, no keyctl, no mount. See `seccomp/sealer.json` for the full removal list and rationale. |

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

---

## Environment variables

### All containers

| Variable         | Required | Description                              |
|-----------------|----------|------------------------------------------|
| `BEAP_ROLE`      | Yes      | `ingestor` / `validator` / `depackager` / `sealer` |
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
├── pod.yaml                    pod manifest (podman play kube)
├── seccomp/
│   └── sealer.json             strict seccomp allowlist for sealer
├── scripts/
│   └── pod-smoke.sh            automated smoke test
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
