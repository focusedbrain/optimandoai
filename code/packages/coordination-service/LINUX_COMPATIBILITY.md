# Linux Compatibility — Coordination Service

## Overview

The coordination relay is built for deterministic, Linux-compatible deployment. Native modules (better-sqlite3) are compiled inside the container to match the Node.js ABI, eliminating host/container mismatches.

---

## Node Version Pinning

- **Version**: Node 22 LTS
- **Source**: `.nvmrc` at repo root
- **Docker**: `node:22-bookworm-slim`

Use the same Node version locally and in CI to avoid ABI mismatches:

```bash
nvm use   # or: nvm install 22
```

---

## Container Build

### Prerequisites

- Podman or Docker
- Build from **repo root** (not `packages/coordination-service`)

### Build Command

```bash
# From repo root
podman build -t coordination-test -f packages/coordination-service/Dockerfile .
```

### What Happens

1. **Builder stage**: Copies workspace manifests and package source (no host `node_modules` or `dist`)
2. **pnpm install**: Runs inside container — better-sqlite3 compiles for container Node ABI
3. **pnpm build**: Builds ingestion-core and coordination-service
4. **Runtime stage**: Copies only built artifacts and compiled node_modules

### .dockerignore

Host artifacts are excluded so they never enter the container:

- `node_modules` — host modules would cause ABI mismatch
- `dist` — build happens inside container
- `.git` — not needed at runtime

---

## Runtime

### Start Container

```bash
podman run -p 51249:51249 coordination-test
```

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `COORD_PORT` | 51249 | HTTP listen port |
| `COORD_HOST` | 0.0.0.0 | Bind address |
| `COORD_DB_PATH` | /data/coordination.db | SQLite database path |

### Health Check

```bash
curl http://localhost:51249/health
```

Returns 200 when storage, JWKS, and event loop are healthy.

---

## Verification

| Check | Command |
|-------|---------|
| Node ABI match | `podman run coordination-test node -p "process.versions.modules"` |
| Service start | `podman run -p 51249:51249 coordination-test` |
| Health | `curl http://localhost:51249/health` |

---

## Local Development (Linux)

```bash
nvm use
pnpm install
pnpm build
COORD_PORT=51249 node packages/coordination-service/dist/server.js
```

---

## Troubleshooting

### "NODE_MODULE_VERSION mismatch"

- **Cause**: Host-compiled native modules copied into container, or Node version mismatch.
- **Fix**: Ensure `.dockerignore` excludes `node_modules` and `dist`. Rebuild image.

### "Cannot find module 'better-sqlite3'"

- **Cause**: Build stage failed to compile, or node_modules not copied.
- **Fix**: Check builder stage has `python3`, `make`, `g++` for native compilation.

### Container exits immediately

- **Cause**: Database path not writable, or missing env.
- **Fix**: Ensure `/data` volume exists and is writable by `beap` user.
