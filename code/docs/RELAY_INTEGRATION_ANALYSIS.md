# Self-Hosted Relay Integration — Codebase Analysis

## Architecture Context

The relay is **not** a central service. Each user hosts their own relay server. It serves:
1. **Public endpoint** — accepts incoming BEAP Capsules (solves NAT/firewall)
2. **First validation layer** — runs Ingestor + Validator before anything reaches the host

```
Tier structure:
Free:     Capsule → Local VM (Ingestor + Validator + Relay) → IPC → Host → SQLite
Pro:      Same as Free with Vault Profiles and higher limits
HA/Ent:   Capsule → Remote Server (I+V+R) → mTLS → Local VM (I+V) → IPC → Host → SQLite
```

---

## Analysis Results

### A1: P2P Transport

**Current transport:**
- `p2pTransport.ts`: `sendCapsuleViaHttp(capsule, targetEndpoint, handshakeId, bearerToken)` — simple `fetch()` POST to any URL
- `targetEndpoint` is a full URL (e.g. `https://host:port/beap/ingest`)
- Bearer token from `handshake.counterparty_p2p_token` for auth
- 30s timeout, no retries (retries handled by queue)

**Outbound queue (`outboundQueue.ts`):**
- `enqueueOutboundCapsule(db, handshakeId, targetEndpoint, capsule)` — writes to `outbound_capsule_queue` table
- `processOutboundQueue(db)` — polls every 10s (via `main.ts` setInterval), picks oldest pending, calls `sendCapsuleViaHttp`
- Exponential backoff on failure, max 10 retries
- `target_endpoint` comes from `handshake.p2p_endpoint` (counterparty's endpoint)

**Abstraction needed:**
- `sendCapsuleViaHttp` is already target-agnostic — it accepts any URL
- **No code change** for relay: `target_endpoint` in the queue can be a relay URL instead of direct host
- The queue and transport logic are unchanged; only the *value* of `p2p_endpoint` in handshakes changes (relay URL vs host URL)

**Relay compatibility:** **High** — transport is already abstract. Sender's host sends to receiver's relay URL; relay runs Ingestor+Validator and forwards to host (or host pulls).

---

### A2: P2P Server as Relay

**Current server (`p2pServer.ts`):**
- Separate HTTP/HTTPS server on configurable port (default 51249)
- Binds to `0.0.0.0` (all interfaces) or configured `bind_address`
- Single route: `POST /beap/ingest`
- Auth: Bearer token from handshake (`counterparty_p2p_token`)
- Rate limits: per-IP, per-handshake, auth-failure
- Flow: parse body → `processIncomingInput()` (Ingestor+Validator) → `processHandshakeCapsule()` if handshake_pipeline

**This is already a relay** — it accepts capsules from the internet and runs Ingestor+Validator before handshake processing.

**Standalone potential:**
- **Blocking dependencies:**
  - `getDb()` — SQLite for handshake state, context store, audit
  - `getSsoSession()` — SSO session for `processHandshakeCapsule` (tier, user ID)
  - `processHandshakeCapsule` — needs db + session
- **To run standalone (remote relay):**
  - Relay would run Ingestor+Validator only (no handshake processing)
  - Validated capsules would be forwarded to host via mTLS or host would pull
  - Relay would NOT need SQLite or SSO — only validation + forward
- **To run in local VM:** Same code, but with `getDb`/`getSsoSession` provided via IPC or localhost HTTP from host

**Code reuse:** ~85% — `createP2PRequestHandler` logic (parse, auth, rate limit, `processIncomingInput`) is reusable. The handshake-processing branch would be optional (relay-only mode vs host-attached mode).

---

### A3: Ingestor + Validator Portability

**Ingestor (`ingestor.ts`):**
- Pure function: `ingestInput(rawInput, sourceType, transportMeta) → CandidateCapsuleEnvelope`
- Dependencies: `beapDetection`, `plainTransform`, `provenanceMetadata`, `types`
- **No Electron, no IPC, no DB** — fully portable

**Validator (`validator.ts`):**
- Pure function: `validateCapsule(candidate) → ValidationResult`
- Dependencies: `types` only
- **No Electron, no IPC, no DB** — fully portable

**Ingestion pipeline (`ingestionPipeline.ts`):**
- `processIncomingInput(rawInput, sourceType, transportMeta) → IngestionResult`
- Calls: `ingestInput` → `validateCapsule` → `routeValidatedCapsule`
- **No Electron, no IPC, no DB** — fully portable

**Blocking dependencies (in callers only):**
- `handleIngestionRPC` / `registerIngestionRoutes` / `p2pServer` need:
  - `db` — for `processHandshakeCapsule`, audit, quarantine
  - `ssoSession` — for `processHandshakeCapsule` (receiver identity, tier)
- `processHandshakeCapsule` needs: db, SSOSession, ReceiverPolicy

**Extractable:** **Yes** — Ingestor + Validator + Distribution Gate are pure. The handshake-processing step is the only part that requires db/session. A relay can run Ingestor+Validator and either:
- Forward `ValidatedCapsule` to host (host runs handshake)
- Or run handshake if it has db/session (local VM case)

**Effort:** Low — extract `ingestor`, `validator`, `ingestionPipeline`, `distributionGate`, `types` into a shared package. No Electron imports.

---

### A4: Local VM/Container

**Existing infrastructure:**
- **Sandbox** (`sandbox/sandboxProcessBridge.ts`): Uses `child_process.fork()` to run `sandboxWorker.ts` in isolated process. Node IPC. No Docker.
- **Ollama**: `spawn()` for `ollama serve`. External process.
- **No VM, no Docker, no container** in the codebase for ingestion/relay.

**Current app structure:**
- Single Electron main process
- P2P server runs **inside** the main process (same as Express on 51248)
- Outbound queue processed by `setInterval` in main process

**Recommended approach for Free tier:**
- **Option A: child_process** — Fork a Node script that runs P2P server + Ingestor+Validator. Communicate via Unix socket or localhost HTTP. Host pulls validated capsules or relay pushes via localhost.
- **Option B: Docker** — Run relay as a container. Host connects via `localhost:port` or Docker network. Better isolation, more setup.
- **Option C: Worker thread** — Less isolation than process; not recommended for security boundary.

**Effort:** Medium — need to extract relay logic into a runnable Node script, add IPC/socket for host↔relay, and optionally Dockerfile.

---

### A5: Host ↔ Relay Communication

**Existing pull mechanisms:**
- **Email sync** (`beapSync.ts`): Polls email accounts, submits to ingestion
- **Auth login-wait**: Long-poll (130s) for SSO callback
- **Vault status**: Extension polls with backoff when vault locked
- **No pull mechanism** for capsules from a relay — all ingestion today is push (HTTP POST to host or in-process RPC)

**Recommended approach:**

| Scenario | Approach |
|----------|----------|
| **Local VM (same machine)** | Relay pushes via `localhost` HTTP to host's `/api/ingestion/ingest` (existing route). Or host polls relay's "pending" endpoint. Push is simpler. |
| **Remote server** | Host must **PULL** — relay cannot push through firewall. Options: (1) Poll `GET /relay/pending` with auth, (2) Long-poll, (3) WebSocket initiated by host. mTLS for auth. |

**Implementation:**
- Add `GET /relay/pending?since=<timestamp>` on relay — returns validated capsules not yet delivered
- Host polls every N seconds, submits each to local `handleIngestionRPC`
- Or: WebSocket from host to relay; relay pushes validated capsules on connection
- Auth: Shared secret or mTLS client cert

---

### A6: Relay Endpoint in Handshake

**Current `p2p_endpoint` source:**
1. **Accept capsule** (`handshake/ipc.ts`): `p2pEndpointParam ?? getP2PConfig(db)?.local_p2p_endpoint ?? process.env.BEAP_P2P_ENDPOINT ?? null`
2. **Initiate capsule** (`handshake/ipc.ts`): Same fallback chain
3. **P2P config** (`p2pConfig.ts`): `local_p2p_endpoint` in `p2p_config` table, set when P2P server starts via `computeLocalP2PEndpoint(config)` → `http(s)://{host}:{port}/beap/ingest`
4. **Host detection**: `detectLocalP2PHost()` — primary non-internal IPv4, or 127.0.0.1

**Change needed:**
- **Local relay (VM):** `local_p2p_endpoint` = relay's public URL (e.g. user's dyndns or tunnel). Relay runs on same machine, binds to 0.0.0.0; host knows relay URL from config.
- **Remote relay:** User configures relay URL in setup wizard. Stored in `p2p_config` or new `relay_config` table. `local_p2p_endpoint` (or `relay_endpoint`) = that URL.
- **Initiate/Accept:** When building capsule, use `relay_endpoint` instead of `local_p2p_endpoint` if relay is enabled.

**Schema:** Extend `p2p_config` with `relay_endpoint TEXT` (user's relay URL) and `use_relay BOOLEAN`. When `use_relay`, capsule's `p2p_endpoint` = `relay_endpoint`.

---

### A7: Outbound Path

**Option A: Host → Receiver's relay directly**
- Sender's host has `target_endpoint` = receiver's relay URL (from accept capsule)
- Host calls `sendCapsuleViaHttp(capsule, receiverRelayUrl, ...)` — outbound HTTP, no firewall issue
- Receiver's relay validates, then forwards to receiver's host (or host pulls)

**Option B: Host → Own relay → Receiver's relay**
- Sender's host sends to own local relay
- Own relay forwards to receiver's relay
- Adds hop, more complexity. Useful only if sender's host cannot make outbound HTTP (unusual).

**Recommended: Option A**
- Simpler — reuse existing `sendCapsuleViaHttp` and queue
- `target_endpoint` in handshake is already the receiver's endpoint; we just change it to receiver's relay URL
- No new forwarding logic on sender side

---

### A8: Config and Discovery

**Current config (`p2p_config` table):**
- `enabled`, `port`, `bind_address`, `tls_enabled`, `tls_cert_path`, `tls_key_path`, `local_p2p_endpoint`

**Recommended config structure:**

```ts
// Extend p2p_config or add relay_config
interface RelayConfig {
  use_relay: boolean           // If true, p2p_endpoint in capsules = relay_url
  relay_url: string | null     // User's relay URL (e.g. https://relay.example.com)
  relay_mode: 'local' | 'remote'  // local = VM on same machine, remote = user's server
  // For local: relay_url might be auto-detected (localhost:port) or tunnel URL
  // For remote: user enters in setup wizard
}
```

**Discovery:**
- **Local VM:** Relay runs on known port (e.g. 51250). Host connects to `http://127.0.0.1:51250`. Relay URL for handshake = tunnel/dyndns if user has one, else not used for incoming (relay is local).
- **Remote:** User configures `relay_url` in settings. No auto-discovery.

---

## Recommended Implementation Order

1. **Extract Ingestor+Validator package** — Create `@repo/ingestion-core` with `ingestor`, `validator`, `ingestionPipeline`, `distributionGate`, `types`. No Electron deps.
2. **Add relay config** — Extend `p2p_config` with `relay_url`, `use_relay`, `relay_mode`.
3. **Relay endpoint in handshake** — When `use_relay`, set `p2p_endpoint` = `relay_url` in initiate/accept capsules instead of `local_p2p_endpoint`.
4. **Standalone relay server** — New `apps/relay` or `packages/relay` that runs HTTP server, uses ingestion-core, forwards validated capsules to host (or exposes pull endpoint).
5. **Host pull from remote relay** — Add `GET /relay/pending` on relay, host polling or WebSocket client.
6. **Local VM relay** — Run relay as child_process or Docker; host pushes to `localhost:port` or pulls from it.
7. **Double validation (HA tier)** — Remote relay validates, forwards to local VM relay, which validates again, then to host.

---

## Files to Create / Modify

| Action | File | Purpose |
|--------|------|---------|
| **Create** | `packages/ingestion-core/` | Extract ingestor, validator, pipeline, distributionGate, types |
| **Create** | `apps/relay/` or `packages/relay/` | Standalone relay server (HTTP, Ingestor+Validator, forward/pull) |
| **Modify** | `electron/main/p2p/p2pConfig.ts` | Add `relay_url`, `use_relay`, `relay_mode` |
| **Modify** | `electron/main/handshake/ipc.ts` | Use `relay_url` for `p2p_endpoint` when `use_relay` |
| **Modify** | `electron/main/handshake/db.ts` | Migration for new p2p_config columns |
| **Modify** | `electron/main/p2p/p2pServer.ts` | Optional: add relay-only mode (no handshake, forward only) |
| **Create** | `apps/relay/Dockerfile` | Container image for remote relay |
| **Create** | Host pull client | Poll or WebSocket to fetch validated capsules from remote relay |
| **Modify** | `electron/main.ts` | Wire relay config, optionally start local relay as child_process |
