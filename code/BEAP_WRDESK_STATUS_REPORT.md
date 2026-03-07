# BEAP / WRDesk — Current Project Status Report

**Date:** 2026-03-07  
**Scope:** Full repository analysis

---

## 1. Project Structure

### 1.1 Tree Overview (max 3 levels)

```
code/
├── apps/
│   ├── desktop/              # Legacy Electron desktop (dist wrapper)
│   ├── electron-vite-project/  # Main WRDesk desktop app (Electron + Vite + React)
│   └── extension-chromium/    # Chrome extension (BEAP Inbox, Handshake, Vault)
├── packages/
│   ├── coordination-service/ # Multi-tenant relay for Free tier (relay.wrdesk.com)
│   ├── relay-server/         # Self-hosted relay (Pro tier, Bearer auth)
│   ├── ingestion-core/     # Portable Ingestor + Validator (no Electron deps)
│   ├── shared/               # Shared utilities
│   ├── shared-extension/     # Extension-specific shared code
│   └── hello/                # Placeholder
├── docs/                     # Architecture docs
├── scripts/                  # Build, release, check scripts
└── [config files]
```

### 1.2 Main Modules & Responsibilities

| Module | Role |
|--------|------|
| **electron-vite-project** | Main app: Electron main process, P2P server, handshake ledger, ingestion pipeline, HTTP API, WebSocket bridge to extension |
| **extension-chromium** | Browser extension: BEAP Inbox, Handshake UI, Vault, RPC client to Electron |
| **coordination-service** | Free-tier relay: OIDC auth, WebSocket push, capsule storage, handshake registry |
| **relay-server** | Pro-tier relay: Bearer auth, `/beap/ingest`, `/beap/pull`, `/beap/ack` |
| **ingestion-core** | Ingestor + Validator + Distribution Gate — portable, used by Electron, coordination-service, relay-server |

### 1.3 Languages, Frameworks, Build Tools

| Category | Technology |
|----------|------------|
| **Languages** | TypeScript (primary), JavaScript |
| **Desktop** | Electron 33+, Vite |
| **UI** | React 18 |
| **Extension** | Chrome Extension Manifest V3 |
| **Build** | pnpm workspaces, TypeScript |
| **Testing** | Vitest |
| **DB** | better-sqlite3 (SQLite) |

---

## 2. Handshake Roundtrip

### 2.1 Handshake Initiation & Acceptance

**Initiation:**
- `apps/electron-vite-project/electron/main/handshake/ipc.ts` — `handshake.initiate` RPC
- `capsuleBuilder.ts` — `buildInitiateCapsule()` / `buildInitiateCapsuleWithContent()`
- `initiatorPersist.ts` — persist handshake record
- `relaySync.ts` — register with coordination or relay (`registerHandshakeWithRelay`)

**Acceptance:**
- `ipc.ts` — `handshake.accept` RPC
- `capsuleBuilder.ts` — `buildAcceptCapsule()`
- `enforcement.ts` — `processHandshakeCapsule()` (state transition, ownership)

**IPC wiring:**
- `electron/main.ts` — `handshake:initiate`, `handshake:accept`, `handshake:submitCapsule` handlers
- `electron/preload.ts` — `handshakeView.initiateHandshake`, `acceptHandshake`, `submitCapsule`

### 2.2 BEAP Capsule Exchange After Handshake

**Outbound:**
- `outboundQueue.ts` — enqueue via `enqueueOutboundCapsule(db, handshakeId, targetEndpoint, capsule)`
- `processOutboundQueue()` — polls every 10s, sends via `p2pTransport.sendCapsuleViaHttp()`
- Target: `getEffectiveRelayEndpoint()` → coordination URL (Free) or relay URL (Pro) or `p2p_endpoint` (direct)

**Inbound:**
- **Coordination (Free):** `coordinationWs.ts` — WebSocket push on `/beap/ws`, `processIncomingInput` → `validateInput` → `canonicalRebuild` → `processHandshakeCapsule`
- **Relay (Pro):** `relayPull.ts` — HTTP polling to `/beap/pull`, same pipeline
- **Direct P2P:** `p2pServer.ts` — POST `/beap/ingest`, same pipeline

### 2.3 Context Graph Data

**Context blocks:**
- `context_blocks` — array of `{ block_id, block_hash, type, content? }` (or hash-only proofs)
- `context_hash` — SHA-256 over canonical block hashes
- `context_commitment` — optional commitment string
- `context_block_proofs` — optional proofs for hash-only blocks

**Stored in:** `context_store` table (DB), `handshake_record` (last_capsule_hash_received, seq).

### 2.4 BEAP Capsule Format

**Wire format** (`capsuleBuilder.ts` → `HandshakeCapsuleWire`):

```typescript
interface HandshakeCapsuleWire {
  schema_version: 2;
  capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke' | 'context_sync';
  handshake_id: string;
  relationship_id: string;
  sender_id: string;
  sender_wrdesk_user_id: string;
  sender_email: string;
  receiver_id: string;
  receiver_email: string;
  senderIdentity: { email, iss, sub, email_verified, wrdesk_user_id };
  receiverIdentity: ReceiverIdentity | null;
  capsule_hash: string;      // 64-char hex, SHA-256 over canonical fields
  context_hash: string;
  context_commitment: string | null;
  nonce: string;
  timestamp: string;
  seq: number;
  external_processing: 'none' | 'local_only';
  reciprocal_allowed: boolean;
  tierSignals: TierSignals;
  wrdesk_policy_hash: string;
  wrdesk_policy_version: string;
  sharing_mode?: SharingMode;   // accept only
  prev_hash?: string;           // refresh/revoke
  context_block_proofs?: ReadonlyArray<ContextBlockProof>;
  context_blocks: ReadonlyArray<ContextBlockWireProof>;
  p2p_endpoint?: string | null;
}
```

**Hash computation:** `capsuleHash.ts` — `computeCapsuleHash` over canonical fields (sorted keys, no whitespace).

### 2.5 Schema Definitions / TypeScript Interfaces

| Location | Purpose |
|----------|---------|
| `packages/ingestion-core/src/types.ts` | `ValidatedCapsule`, `ValidatedCapsulePayload`, `CapsuleType`, `ValidationResult` |
| `apps/electron-vite-project/electron/main/handshake/capsuleBuilder.ts` | `HandshakeCapsuleWire` |
| `apps/electron-vite-project/electron/main/handshake/types.ts` | `HandshakeRecord`, `HandshakeState`, `ReceiverPolicy` |

**No JSON Schema:** Validation is via TypeScript + runtime checks in validator.

### 2.6 Error Handling

| Scenario | Handling |
|----------|----------|
| **Timeout** | `p2pTransport.ts` — 30s fetch timeout; `sendCapsuleViaHttp` returns `{ success: false }`; queue retries with exponential backoff |
| **Reject** | `enforcement.ts` — `processHandshakeCapsule` returns `{ success: false, reason }`; capsule rejected, logged |
| **Invalid capsule** | `validator.ts` — returns `{ success: false, reason, details }`; `processIncomingInput` routes to quarantine |
| **Malformed JSON** | Ingestor sets `ingestion_error_flag = true`; `ValidationResult` with `INGESTION_ERROR_PROPAGATED` |
| **Coordination down** | `coordinationWs.ts` — reconnect with backoff; `setP2PHealthCoordinationConnected(false)` |

---

## 3. BEAP Relay (beap-coordinator)

### 3.1 Location

**Coordination service (Free tier relay):**
- `packages/coordination-service/`
- Entry: `src/index.ts`
- Server: `src/server.ts`
- Auth: `src/auth.ts`
- Store: `src/store.ts`
- WebSocket: `src/wsManager.ts`
- Rate limit: `src/rateLimiter.ts`  
- Handshake registry: `src/handshakeRegistry.ts`

**Relay server (Pro tier relay):**
- `packages/relay-server/`
- Entry: `src/index.ts`
- Server: `src/server.ts`

**Note:** “beap-coordinator” is not a literal name; the coordination service is the Free-tier relay.

### 3.2 Protocol

| Protocol | Location |
|----------|----------|
| **WebSocket** | `wss://relay.wrdesk.com/beap/ws` — push, ACK, heartbeat |
| **HTTP** | POST `/beap/capsule`, POST `/beap/register-handshake`, GET `/health` |

### 3.3 P2P Relay Principle (Free Tier)

1. **Registration:** Client registers handshake via `POST /beap/register-handshake` (OIDC Bearer).
2. **Capsule delivery:** Sender POSTs `handshake_id` + capsule JSON to `POST /beap/capsule`.
3. **Recipient lookup:** `getRecipientForSender(handshakeId, senderUserId)` from registry.
4. **Push:** If recipient is online, `pushCapsule(recipientUserId, id, body)` via WebSocket.
5. **Store:** If offline, `storeCapsule`; on reconnect, `pushPendingCapsules(userId)`.
6. **ACK:** Client sends `{ type: 'ack', ids: [...] }`; `acknowledgeCapsules(ids, userId)`.

### 3.4 Container Definition

| File | Purpose |
|------|---------|
| `packages/coordination-service/Dockerfile` | `wrdesk/coordination-service:latest` |
| `packages/relay-server/Dockerfile` | `wrdesk/beap-relay:latest` |

**Coordination Dockerfile:** Node 20-slim, `useradd -r -g beap beap`, `USER beap`, non-root, no shell.

**Deployment:** Live at `https://relay.wrdesk.com` (Podman, Nginx, Cloudflare TLS).

### 3.5 Endpoints / Routes

**Coordination service:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Health check |
| POST | `/beap/register-handshake` | OIDC Bearer | Register handshake |
| POST | `/beap/capsule` | OIDC Bearer | Submit capsule |
| WebSocket | `/beap/ws` | Token in URL or header | Push, ACK |

**Relay server:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Health check |
| POST | `/beap/ingest` | Bearer (handshake token) | Receive capsule |
| GET | `/beap/pull` | Bearer (relay secret) | Host pulls capsules |
| POST | `/beap/ack` | Bearer (relay secret) | Acknowledge |
| POST | `/beap/register-handshake` | Bearer (relay secret) | Register handshake |

### 3.6 Authentication & Rate Limiting

**Coordination:**
- Auth: OIDC `jose.jwtVerify` with JWKS from `COORD_OIDC_JWKS_URL`
- Rate limit: `rateLimiter.ts` — per-user, tier-based (free/pro/enterprise)
- WebSocket: Token in `?token=` or `Authorization` header; 4001 if no valid token

**Relay:**
- Auth: `RELAY_AUTH_SECRET` (Bearer) for `/beap/pull`, `/beap/ack`, `/beap/register-handshake`
- Ingest: Bearer token from handshake (`counterparty_p2p_token`)
- Rate limit: per-IP, per-handshake, auth-failure limits

### 3.7 Security Status

| Check | Status |
|-------|--------|
| Relay open without auth | **No** — coordination requires OIDC; relay requires Bearer |
| ACK recipient verification | **Fixed** — `store.ts` `acknowledgeCapsules(ids, userId)` uses `AND recipient_user_id = ?` |
| Config defaults | **Fixed** — `p2pConfig.ts` uses `relay.wrdesk.com` |
| TEST_MODE | **Risk** — ensure `COORD_TEST_MODE` is not set in production |
| max_connections | **Enforced** — `server.ts` checks `getConnectedCount() >= config.max_connections` before accepting WS |

**See:** `COORDINATION_SECURITY_AUDIT.md` for full audit.

---

## 4. Tier Architecture (Free vs. Pro)

### 4.1 Separation in Code

| Tier | Mode | Relay | Auth |
|------|------|-------|------|
| **Free** | `relay_mode: 'local'` | `use_coordination` → `relay.wrdesk.com` | OIDC |
| **Pro** | `relay_mode: 'remote'` | `relay_url` (user config) | Bearer |
| **Disabled** | `relay_mode: 'disabled'` | Direct P2P only | `p2p_endpoint` in capsule |

**Logic:** `p2pConfig.ts` — `getEffectiveRelayEndpoint()`, `use_coordination` computed from `relay_mode` and `coordination_enabled`.

### 4.2 Configuration Flags

- `relay_mode`: `'local' | 'remote' | 'disabled'`
- `coordination_enabled`: boolean
- `use_coordination`: `coordination_enabled && (relay_mode === 'local' || relay_mode === 'disabled')`
- `relay_url`, `relay_pull_url`, `relay_auth_secret` for remote relay

### 4.3 Self-Hosting Variant

**Implemented:** `packages/relay-server` — standalone relay with Bearer auth, `/beap/ingest`, `/beap/pull`, `/beap/ack`.

**Planned:** VM with Ingestor + Validator before host — described in `docs/RELAY_INTEGRATION_ANALYSIS.md`; `sandboxStub.ts` is a placeholder. No VM isolation.

---

## 5. Ingestor & Validator

### 5.1 Ingestor

**Location:** `packages/ingestion-core/src/ingestor.ts` (also `apps/electron-vite-project/electron/main/ingestion/` — legacy copy).

**Flow:** `ingestInput(rawInput, sourceType, transportMeta)` → `CandidateCapsuleEnvelope`:
- Detects BEAP via MIME, headers, JSON structure, attachment metadata
- Parses JSON, builds provenance
- Size limit: `MAX_RAW_INPUT_BYTES` (15MB)

### 5.2 Validator

**Location:** `packages/ingestion-core/src/validator.ts`

**Checks:**
1. Ingestion error propagated
2. JSON parsability
3. Prototype pollution
4. JSON depth ≤ 50
5. Field count ≤ 500
6. schema_version in [1, 2]
7. capsule_type in valid set
8. Required fields per type
9. Enum validation
10. Structural integrity
11. Cryptographic fields (capsule_hash, sender_id)
12. Hash format (64-char hex)
13. Payload size ≤ 10MB
14. Sanitization

**On failure:** `{ success: false, reason, details }`; no exception.

### 5.3 Dual-Validation Flow

**Current:** Single validation in main process (Electron or coordination-service). No VM.

**Planned:** VM runs Ingestor + Validator first; host validates again. Not implemented.

### 5.4 Protection Gaps

| Threat | Status |
|--------|--------|
| Zero-day parser exploits | **Partial** — JSON.parse; depth/field limits reduce risk |
| DDoS | **Partial** — rate limits; no global disk cap |
| Manipulated binary data | **Partial** — JSON only; size limits enforced |
| capsule_hash not verified | **Missing** — `handshakeVerification.ts` implements this but is unused |

**See:** `INGESTOR_VALIDATOR_HARDENING_REPORT.md`.

---

## 6. Cryptography & Signatures

### 6.1 Signature Schemes

| Mechanism | Purpose |
|-----------|---------|
| **Capsule hash** | SHA-256 over canonical fields (not a digital signature) |
| **Context hash** | SHA-256 over block hashes |
| **Block hash** | SHA-256 over block content |
| **OIDC** | Auth for coordination (JWT) |
| **Bearer** | Auth for relay |
| **ML-KEM-768** | Post-quantum crypto (API present; `.qBEAP` not used) |

**No Ed25519/ECDSA:** Capsules are integrity-hashed, not signed.

### 6.2 Key Management

- **OIDC:** JWKS from issuer URL
- **Relay:** `RELAY_AUTH_SECRET` (Bearer)
- **P2P:** `counterparty_p2p_token` per handshake (32-byte hex)
- **Session:** Per-launch secret for Electron ↔ extension WebSocket

### 6.3 End-to-End vs Transport

- **Transport:** TLS (Cloudflare + Nginx) for coordination
- **Capsule:** Hash-based integrity only; no end-to-end encryption of capsule content

### 6.4 Signature Chain in Handshake

- `prev_hash` links refresh/revoke caps to previous capsule
- `chainIntegrity` step verifies `prev_hash` matches `last_capsule_hash_received`
- `capsule_hash` is not verified; `handshakeVerification.ts` implements this but is unused

---

## 7. Open Issues & TODOs

### 7.1 TODOs Found

| File | TODO |
|------|------|
| `electron/main.ts` | `contextIsolation:true` refactor; store secretKey in vault |
| `content-script.tsx` | Collect conversation history, documents, embeddings |
| `sidepanel.tsx` | Mini-app installation dialog |
| `pdf-extractor.ts` | Full implementation with pdf-parse |
| `vault-ui-typescript.ts` | Export vault data to CSV |
| `processFlow.ts` | Actually call LLM |
| `autofillOrchestrator.ts` | Phase 2 OverlaySession |
| `beapCrypto.ts` | Wire AAD to aeadEncrypt |
| `orchestrator-db/service.ts` | UI state export, templates export |
| `imap.ts` | Attachment listing, fetching |
| `llm/ipc.ts` | Store in persistent config |

### 7.2 Incomplete / Fragile Areas

- **capsule_hash verification:** Not implemented in pipeline
- **VM isolation:** Not implemented
- **sandboxStub:** Placeholder only
- **handshakeVerification.ts:** Full crypto verification not wired

---

## 8. Dependencies & Deployment

### 8.1 External Dependencies

**Key:** `better-sqlite3`, `ws`, `jose`, `express`, `electron`, `vite`, `react`, `vitest`.

**Full list:** `pnpm-lock.yaml` in repo root.

### 8.2 Container Definitions

| Image | Dockerfile |
|-------|------------|
| `wrdesk/coordination-service:latest` | `packages/coordination-service/Dockerfile` |
| `wrdesk/beap-relay:latest` | `packages/relay-server/Dockerfile` |

### 8.3 Deployment

- **Manual:** `relay.wrdesk.com` — Podman, Nginx, Cloudflare TLS
- **CI/CD:** Not documented
- **Scripts:** `scripts/` for release, manifest, lint

### 8.4 Services

| Service | Location |
|---------|----------|
| Coordination | `relay.wrdesk.com` (Podman) |
| Host | Local Electron app |
| P2P server | Local (port 51249) |
| Relay (Pro) | User-configured VM |

---

## 9. Test Coverage

### 9.1 Unit Tests

| Area | Tests |
|------|-------|
| Ingestor | `ingestor.test.ts` |
| Validator | `validator.test.ts` |
| Distribution Gate | `distributionGate.test.ts` |
| BEAP detection | `beapDetection.test.ts` |
| Plain transform | `plainTransform.test.ts` |
| Hardening | `hardening.test.ts`, `adversarial.test.ts` |
| Handshake | `e2e.roundtrip.test.ts`, `e2e.pipeline.test.ts`, `chainIntegrity.test.ts`, `stateMachine.test.ts` |
| Coordination | `coordination-client.test.ts` |
| Relay | `relay-server.test.ts` |

### 9.2 Integration / E2E

- `e2e.transport.test.ts` — Ingestor → Validator → Distribution Gate
- `e2e.http.test.ts` — HTTP ingestion
- `e2e.websocket.test.ts` — WebSocket
- `e2e.ipc.test.ts` — IPC
- `entrypoints.guard.e2e.test.ts` — Entry point audit

### 9.3 Critical Paths Not Covered

- Coordination WebSocket push end-to-end
- Relay pull → host pipeline
- Full handshake roundtrip via coordination

### 9.4 Test Fixtures

- `handshakeTestDb.ts` — test DB
- `validator.test.ts` — mock capsules
- `e2e.roundtrip.test.ts` — handshake fixtures

---

## 10. Security Assessment (Priority)

### CRITICAL (Must Fix Before Production)

| # | Issue | Fix |
|---|-------|-----|
| 1 | ~~ACK does not verify recipient~~ | **Fixed** — `store.ts` uses `recipient_user_id` |
| 2 | ~~Config defaults wrong~~ | **Fixed** — `relay.wrdesk.com` |
| 3 | TEST_MODE in production | Ensure `COORD_TEST_MODE` is unset |
| 4 | capsule_hash not verified | Wire `handshakeVerification.ts` into pipeline |

### HIGH (Near Term)

| # | Issue | Fix |
|---|-------|-----|
| 1 | No audience (aud) check in OIDC | Add `audience` to `jwtVerify` |
| 2 | Disk fill via capsules | Add global storage limit or stricter rate limits |
| 3 | TEST_MODE impersonation | Add startup warning; remove in prod |

### MEDIUM (Later Sprint)

| # | Issue | Fix |
|---|-------|-----|
| 1 | No email_verified check | Optional reject if `email_verified !== true` |
| 2 | JSON depth/recursion | Add explicit limit before parsing |
| 3 | String length per field | Enforce `MAX_STRING_LENGTH` (5MB) per field |

### Evaluation Summary

| Question | Answer |
|----------|--------|
| Relay open without auth? | **No** — OIDC (coordination) or Bearer (relay) |
| Capsule injection/tampering? | **Mitigated** — validation; capsule_hash not verified |
| DoS on relay? | **Partial** — rate limits; no global disk cap |
| Input validated before parsing? | **Partial** — size limit; JSON.parse depth not limited |
| Containers hardened? | **Yes** — non-root, no shell, resource limits via env |

---

## Summary Table

| Module | Status | Next Action |
|--------|--------|-------------|
| **Handshake roundtrip** | Implemented | Add capsule_hash verification |
| **Coordination service** | Live | Verify TEST_MODE off; add aud check |
| **Relay server** | Implemented | Document deployment |
| **Ingestion-core** | Implemented | Add capsule_hash verification |
| **Ingestor** | Implemented | Add JSON depth limit before parse |
| **Validator** | Implemented | Add per-field string length |
| **Tier separation** | Implemented | — |
| **VM isolation** | Not implemented | — |
| **Capsule hash** | Format only | Wire handshakeVerification |
| **Tests** | Good coverage | Add coordination E2E |

---

*Report generated from codebase analysis.*