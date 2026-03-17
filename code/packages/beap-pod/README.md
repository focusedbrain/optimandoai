# BEAP Pod

Minimal HTTP server for .beap structural validation and (future) depackaging.

## Endpoints

| Method | Path       | Description                                      |
|--------|------------|--------------------------------------------------|
| GET    | /health    | `{ status: 'ok', version }`                       |
| POST   | /validate  | Structural validation (no keys required)         |
| POST   | /depackage | Full pipeline (keys in request) — 501 for now    |

## Build & Run

```bash
# From repo root
pnpm --filter @repo/beap-pod build
pnpm --filter @repo/beap-pod start

# Container
podman build -t wrdesk-pod -f packages/beap-pod/Containerfile .
podman run -p 17180:17180 wrdesk-pod
```

## Verification

```bash
# Health
curl http://localhost:17180/health

# Validate (POST .beap JSON)
curl -X POST -H "Content-Type: application/json" -d '{"header":{...},"metadata":{...},"payload":"","signature":{"value":"..."}}' http://localhost:17180/validate
```

## Structure

- `beapStructuralValidator.ts` — Pure structural validation (no decryption)
- `podServer.ts` — HTTP server (Node built-in http)
- `Containerfile` — node:20-alpine
- `pod.yaml` — Kubernetes Pod manifest (optional tmpfs for RAM-only)
