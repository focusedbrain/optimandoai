# Coordination Relay Hardening — Refactor Documentation

## Summary

Refactored the coordination relay to support deterministic fail-close behavior, self-healing session cleanup, explicit health state reporting, and removal of hidden state coupling. Protocol compatibility is preserved.

---

## Changes

### 1. Stateless Relay

- **Before**: Global mutable state in `store`, `auth`, `wsManager`, `rateLimiter`, `handshakeRegistry`.
- **After**: All state encapsulated in a relay instance created by `createServer()`. Each module exposes a factory (`createStore`, `createAuth`, etc.) that returns an adapter with state in closure.
- **Allowed state**: Ephemeral connection state (WebSocket clients map), cached JWKS, short-lived handshake state. Authoritative state lives in the storage adapter (SQLite).

### 2. Fail-Close Security

- **OIDC/JWKS**: Requests are rejected (401) when token validation fails. No fallback authentication.
- **Storage**: When storage operations fail (e.g. DB unavailable), requests return 503 Service Unavailable. `storeCapsule`, `registerHandshake`, `countPendingForRecipient` are wrapped in try/catch; failures propagate as 503.
- **Health endpoint**: Returns 503 when storage, JWKS, or event loop checks fail.

### 3. Self-Healing Sessions

- **Session TTL**: Configurable via `COORD_SESSION_TTL_SECONDS` (default 86400). Handshake registry entries older than TTL are purged by cleanup.
- **Heartbeat expiry**: Dead peers detected via WebSocket ping/pong. Clients that miss `heartbeat_interval + PONG_TIMEOUT_MS` are terminated and removed. Configurable via `COORD_WS_HEARTBEAT_INTERVAL`.
- **Stale handshake cleanup**: `cleanupStaleHandshakes(handshake_ttl_seconds)` removes handshake entries older than `COORD_HANDSHAKE_TTL_SECONDS` (default 604800). Runs hourly with capsule cleanup.

### 4. Health Endpoint

- **Path**: `GET /health`
- **200 OK** when: storage reachable, JWKS cache valid, event loop responsive.
- **503 Service Unavailable** otherwise.
- Does not depend on client traffic. Proactively checks storage, JWKS fetch, and `setImmediate` responsiveness.

### 5. Implementation Constraints

- **No global mutable state**: All state inside relay instance.
- **No synchronous blocking IO**: Replaced `readFileSync` with `readFile` from `fs/promises` for TLS cert loading. `createServer` is now async.
- **Session TTL configurable**: `COORD_SESSION_TTL_SECONDS`, `COORD_HANDSHAKE_TTL_SECONDS`.
- **Heartbeat interval configurable**: `COORD_WS_HEARTBEAT_INTERVAL`.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `COORD_PORT` | 51249 | HTTP listen port |
| `COORD_SESSION_TTL_SECONDS` | 86400 | Session TTL (24h) |
| `COORD_HANDSHAKE_TTL_SECONDS` | 604800 | Handshake registry TTL (7d) |
| `COORD_WS_HEARTBEAT_INTERVAL` | 30000 | WebSocket heartbeat interval (ms) |

---

## File Changes

| File | Change |
|------|--------|
| `config.ts` | Added `session_ttl_seconds`, `handshake_ttl_seconds`. Default port 51249. |
| `store.ts` | Refactored to `createStore()` factory. Added `checkHealth()`, `cleanupStaleHandshakes()`. Fail-close via `ensureDb()` throw. |
| `auth.ts` | Refactored to `createAuth(store, config)`. Added `checkJwksHealth()`. JWKS in closure. |
| `handshakeRegistry.ts` | Refactored to `createHandshakeRegistry(store)`. |
| `rateLimiter.ts` | Refactored to `createRateLimiter()`. State in closure. |
| `wsManager.ts` | Refactored to `createWsManager(store)`. Clients map in closure. |
| `cleanup.ts` | Refactored to `createCleanup(store, config)`. Added handshake cleanup. |
| `health.ts` | Refactored to `createHealth(store, auth, wsManager)`. Returns 503 when unhealthy. |
| `server.ts` | Async `createServer()`. Creates relay, uses `readFile` for TLS. Returns `{ server, relay }`. |
| `index.ts` | Awaits `createServer()`, wires cleanup. |

---

## Verification

Run from repo root:

```bash
# Build
pnpm install
cd packages/coordination-service && pnpm build

# Start service (port 51249)
COORD_PORT=51249 node dist/index.js

# Health check
curl http://localhost:51249/health
```

---

## Protocol Compatibility

No protocol changes. All BEAP endpoints (`/beap/register-handshake`, `/beap/capsule`, `/beap/system-event`, `/beap/ws`) retain existing request/response formats and behavior.
