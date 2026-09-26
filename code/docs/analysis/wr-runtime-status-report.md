# WR Runtime — Public-Handshake / Publisher-Integration Readiness Report

| Field | Value |
|---|---|
| Branch | `refactor/wr-handshake-phase-5-grants-evidence` |
| Commit | `b9a4b8352712000d4cb02da600220c4b05c37cae` (`b9a4b835`) |
| Date | 2026-07-30 |
| Head subject | `chore: build045 stamp (phase 5 grants/evidence)` |
| Node | v20.11.1 (NODE_MODULE_VERSION 115) |
| pnpm | 10.28.2 |
| TypeScript | 5.9.2 |
| Vitest | 2.1.9 |
| Python | 3.12.10 |
| Workspace root | `apps/electron-vite-project`, `apps/extension-chromium`, `packages/*` |

**Method.** Read-only inspection of current source + migrations + tests. Prior analysis under `docs/analysis/wr-handshake-gap/` was used for orientation only; every claim below was re-checked against code. No migrations run. No production code changed.

**Local test runs (this analysis session).**

| Suite | Result |
|---|---|
| `packages/ingestion-core` (`pnpm test`) | **PASS** — 117/117 |
| `packages/coordination-service` | **FAIL env** — `better-sqlite3` built for NODE_MODULE_VERSION 123 vs host Node 115; 38 non-DB tests passed, 103 skipped |
| `packages/relay-server` | **FAIL env** — same `better-sqlite3` ABI mismatch; 35 skipped |
| Handshake phase4/5 acceptance (`vitest` under root) | **FAIL env** — same ABI mismatch on in-memory SQLite |
| Canonical tests (`packages/ingestion-core/__tests__/canonical.test.ts`) | **PASS** — 17/17 |

Where tests could not execute due to ABI, status still cites test *file paths* as evidence that coverage exists.

---

## A. Transports: pBEAP / qBEAP / relay

### A1. pBEAP — capsule/message format

**Status: `IMPLEMENTED`**

Wire format is the shared `BeapPackage` shape with `header.encoding === 'pBEAP'`, plaintext base64 `payload`, Ed25519 `signature`, no `payloadEnc` / no inner envelope.

**Verbatim type (package root):**

```611:680:apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts
export interface BeapPackage {
  header: BeapEnvelopeHeader
  outerEnvelopeVersion?: '1.0' | '2.0'
  innerEnvelopeCiphertext?: string
  /** 
   * For pBEAP: Base64-encoded plaintext JSON
   * For qBEAP: NOT used (see payloadEnc)
   */
  payload?: string
  payloadEnc?: CapsulePayloadEnc
  signature: BeapSignature
  metadata: {
    created_at: number
    delivery_method: DeliveryMethod
    delivery_hint?: string
    filename: string
    inbox_response_path?: BeapPackageConfig['inboxResponsePathMetadata']
  }
  artefacts?: BeapArtefact[]
  artefactsEnc?: BeapArtefactEncrypted[]
  poae?: PoAERecord
}
```

**Verbatim header fields:**

```456:531:apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts
export interface BeapEnvelopeHeader {
  version: '1.0' | '2.0'
  encoding: 'qBEAP' | 'pBEAP'
  encryption_mode: 'AES-256-GCM' | 'NONE'
  timestamp: number
  sender_fingerprint: string
  receiver_fingerprint?: string
  receiver_binding?: {
    handshake_id: string
    display_name: string
    organization?: string
  }
  receiver_eligibility?: string
  template_hash: string
  policy_hash: string
  content_hash: string
  crypto?: { /* qBEAP only */ }
  signing?: {
    algorithm: 'Ed25519'
    keyId: string
    publicKey: string
  }
  // ...
}
```

**Crypto (pBEAP):**

| Concern | Primitive / library | Evidence |
|---|---|---|
| Encryption | None (`encryption_mode: 'NONE'`) | Builder path returns `payload` base64, no `innerEnvelopeCiphertext` (`BeapPackageBuilder.ts:1958-1962`) |
| Signature | Ed25519 via `@noble/ed25519` (extension `beapCrypto.ts`) | `BeapSignature.algorithm: 'Ed25519'` (`beapCrypto.ts:1398-1407`); `createBeapSignature` (`beapCrypto.ts:1473-1485`) |
| Content hash | SHA-256 | `computeContentHash` / header `content_hash` |

**Production callers:** extension `buildPublicPackage` / reply paths; Electron main `beapEmailIngestion.ts` decodes pBEAP payload without Stage-5 sandbox gate (`beapEmailIngestion.ts:522-534`); trust classification in `depackaging-microvm/livePbeapTrust.ts` / `pbeapTrust.ts`.

**Feature gates:** none dedicated to pBEAP; transport gated by coordination/relay config (`p2pConfig.ts` defaults below).

**Tests:** `apps/extension-chromium/src/beap-messages/services/__tests__/BeapPackageBuilder.test.ts`; `apps/electron-vite-project/electron/main/email/__tests__/pbeapTrustPersistence.regression.test.ts`; ingestion-core content validator tests. Local: ingestion-core pass; Electron tests blocked by better-sqlite3 ABI.

---

### A2. qBEAP — post-quantum(-hybrid) suite

**Status: `IMPLEMENTED`** (hybrid production path; classical-only suite retained as deprecated)

**Suite id (verbatim):**

```489:522:apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts
  crypto?: {
    suiteId: 'HYBRID_MLKEM768_X25519_AES256GCM_HKDFSHA256_ED25519_v1' | 'BEAP-v1-X25519-AES256GCM-HKDF-Ed25519'
    aead: 'AES-256-GCM'
    kdf: 'HKDF-SHA256'
    hash: 'SHA-256'
    keyDerivation: 'HYBRID_MLKEM768_X25519' | 'X25519_ECDH'
    salt: string
    handshake_id: string
    senderX25519PublicKeyB64: string
    pq: PQMetadata | false
  }
```

**PQ metadata (verbatim):**

```210:224:apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts
export interface PQMetadata {
  required: boolean
  active: boolean
  kem?: 'ML-KEM-768'
  hybrid?: boolean
  kemCiphertextB64?: string
}
```

| Layer | Algorithm | Library / location |
|---|---|---|
| Classical KEM/ECDH | X25519 | `@noble/curves/ed25519` (`x25519`) — main `decryptQBeapPackage.ts:9`; extension `x25519KeyAgreement.ts` |
| PQ KEM | ML-KEM-768 | `@noble/post-quantum/ml-kem` — main `decryptQBeapPackage.ts:10`; HTTP endpoints `/api/crypto/pq/mlkem768/*` in `electron/main.ts:11550+`; extension calls Electron HTTP |
| AEAD | AES-256-GCM (12-byte nonce; tag appended or separate) | WebCrypto / Node crypto |
| KDF | HKDF-SHA256 | Labels: `'BEAP v1 capsule'`, `'BEAP v1 artefact'`, `'BEAP v2 inner-envelope'` (`decryptQBeapPackage.ts:26-28`) |
| Signature | Ed25519 | `beapCrypto.createBeapSignature` |

**Encrypted payload wire (`CapsulePayloadEnc` verbatim):**

```131:150:apps/extension-chromium/src/beap-messages/services/beapCrypto.ts
export interface CapsulePayloadEnc {
  sha256Plain: string
  bytesPlain: number
  nonce?: string
  ciphertext?: string
  sha256Cipher?: string
  chunking?: ChunkingMetadata
  chunks?: EncryptedChunk[]
}
```

**v2 outer package:** `outerEnvelopeVersion: '2.0'` + `innerEnvelopeCiphertext: '<nonce_b64>.<ciphertext_b64>'` (`BeapPackageBuilder.ts:624-637`).

**Reachability:** production. Builder fails closed when PQ unavailable for qBEAP (PQ via Electron localhost `:51248`). Decrypt in main process: `electron/main/beap/decryptQBeapPackage.ts` (imported from email ingestion / message router). Keys persisted per handshake (`peer_*` / `local_*` X25519 + ML-KEM columns / `handshake_key_store`).

**Debug flag:** `WR_QBEAP_DECRYPT_DEBUG=1` (`decryptQBeapPackage.ts:18-19`).

**Tests:** `beapCrypto.test.ts`; `qbeapTransports.rig.test.ts`; internal-inference regression distinguishing qBEAP inbox vs service RPC. Local: ABI-blocked where SQLite required.

---

### A3. Sealed Relay (store-and-forward)

**Status: `PARTIAL`**

There is **no** product module named “Sealed Relay” and **no** `wrc-x25519-sealedbox` wire. What exists:

1. **Coordination service** (`packages/coordination-service`) — OIDC-authenticated HTTP + WebSocket store-and-forward for BEAP capsules and handshake lifecycle.
2. **Relay server** (`packages/relay-server`) — HTTP ingest/pull/ack with Bearer auth (simpler/host-pull model).
3. **Client** — Electron `p2p/relayPull.ts`, `p2p/relaySync.ts`, `p2p/coordinationWs.ts`, outbound queue.

**Coordination endpoints (server):**

| Method | Path | Role |
|---|---|---|
| POST | `/beap/capsule` | Publish capsule (JSON body); auth required; store-and-forward (`server.ts:691+`) |
| POST | `/beap/register-handshake` | Register handshake participants (`server.ts:190`) |
| POST | `/beap/flush-queued` | Push pending to live WS (`server.ts:486`) |
| POST | `/beap/p2p-signal` | WebRTC signaling only — not inference bodies (`server.ts:577`) |
| GET/WS | `/beap/ws` | Persistent push + heartbeat (`server.ts:1199`) |
| POST | `/api/coordination/register-pairing-code` (via Electron proxy) | Pairing-code registry |

**Relay-server endpoints (header comment, verbatim):**

```1:5:packages/relay-server/src/server.ts
 * Relay server HTTP/HTTPS routes.
 * POST /beap/ingest, GET /beap/pull, POST /beap/ack,
 * POST /beap/register-handshake, POST /beap/device-register, GET /health
```

**Publish interface (coordination):** authenticated `POST /beap/capsule` with JSON capsule; sender authorization via handshake registry (`server.ts:736-738`). Response 200 (live push) or 202 (queued offline) — covered by tests in `coordination.test.ts` (not runnable here due to ABI).

**Subscribe / receive:**

- WebSocket `/beap/ws?token=…` — push on connect + heartbeat (`wsManager.ts`, `COORD_WS_HEARTBEAT_INTERVAL` default `30000` ms — `config.ts:32`).
- HTTP pull: `GET relay_pull_url` with `Authorization: Bearer <relay_auth_secret>` (`relayPull.ts:125-128`); ack via sibling `/ack`.

**Auth of relay legs:**

- Coordination: OIDC JWT (`COORD_OIDC_ISSUER` default `https://auth.optirando.com/realms/wrdesk`).
- Relay-server: Bearer host/ingest secrets (`auth.ts`).
- Capsule sender must be registered for `handshake_id` or 403 `RELAY_SENDER_UNAUTHORIZED`.

**Missing vs WR Connect “sealed relay / mgmt”:** no `POST ?api=mgmt`, no `wrc-x25519-sealedbox-ed25519-v1`, no website pairing window. Capsules are full BEAP/handshake JSON, not sealed-box mgmt envelopes. (Coordination store-and-forward itself is production-wired; the PARTIAL rating is against the WR Connect sealed-box product surface, not against Optirando capsule relay.)

**Additional flags:**

| Flag | Default | Notes |
|---|---|---|
| `COORD_TEST_MODE=1` | off | Auth bypass for tests; refused if enabled in production (`packages/coordination-service/src/auth.ts:12-14`) |
| `WRDESK_UNIFIED_SERVICE_RPC_RELAY` | **OFF** | Experimental control-plane sealed RPC over relay (`unifiedServiceRpcRelayFlags.ts`) |

**Defaults (`DEFAULT_P2P_CONFIG`):**

```35:55:apps/electron-vite-project/electron/main/p2p/p2pConfig.ts
export const DEFAULT_P2P_CONFIG: P2PConfig = {
  enabled: false,
  // ...
  relay_mode: 'local',
  relay_url: null,
  relay_pull_url: null,
  relay_auth_secret: null,
  coordination_url: 'https://relay.optirando.com',
  coordination_ws_url: 'wss://relay.optirando.com/beap/ws',
  coordination_enabled: true,
  use_coordination: true,
}
```

**Tests:** `packages/coordination-service/__tests__/coordination.test.ts`, `pairing-code.test.ts`, `sandboxEgressGuard.test.ts`; `packages/relay-server/__tests__/relay-server.test.ts`. Local: ABI fail.

---

### A4. Connection model (persistent / reconnect / liveness)

**Status: `IMPLEMENTED`** (coordination WS + optional HTTP pull; no QUIC found)

| Component | Mechanism | Evidence |
|---|---|---|
| Coordination client | WebSocket to `coordination_ws_url` | `p2p/coordinationWs.ts` (device-id binding logs at ~772+) |
| Coordination server | `ws` `WebSocketServer` path `/beap/ws` | `packages/coordination-service/src/server.ts:1199` |
| Heartbeat | Server ping/pong interval | `COORD_WS_HEARTBEAT_INTERVAL` default 30000 (`config.ts:32`); `wsManager.startHeartbeat` |
| Offline drain | Store capsule → push on reconnect / flush-queued | Tests `CS_03_push_on_reconnect`, `CS_29_flush_queued_200` |
| HTTP pull fallback | Periodic `GET` pull + ack | `relayPull.ts` |
| WebRTC (Host AI) | Separate DataChannel path; relay carries `p2p_signal` only | `internalInference/*`, flags in `p2pInferenceFlags.ts` |
| QUIC | — | **ABSENT** — search `QUIC`/`quic` in transport packages: not found as a runtime transport |

**P2P inference flags (defaults when Host AI not disabled):** `WRDESK_P2P_INFERENCE_ENABLED` default on-unset true; signaling/WebRTC/caps/request over P2P default true; `WRDESK_P2P_INFERENCE_HTTP_FALLBACK` default true (`p2pInferenceFlags.ts:104-125`). Orthogonal to public-handshake publisher mgmt.

---

### A5. Canonical serialization for signing

**Status: `PARTIAL`** — multiple serializers; only one is RFC-8785-style with integer-only numbers + domain tags.

#### (1) Handshake / evidence / consent — `@repo/ingestion-core` `canonicalJsonString`

**Verbatim rules** (`packages/ingestion-core/src/canonical.ts:11-26, 112-117`):

- UTF-8 JSON, no insignificant whitespace
- Object keys sorted lexicographically by UTF-16 code units (RFC 8785 §3.2.3 ordering)
- Arrays preserve order
- Numbers MUST be safe integers; floats/NaN/±Infinity rejected; `-0` → `0`
- `undefined` omitted; `null` kept
- Domain tag: `WRH1|<type>|v<version>|` via `domainTag` / `signingBytes`

```113:117:packages/ingestion-core/src/canonical.ts
export function canonicalJsonString(value: CanonicalJsonValue): string {
  const out: string[] = []
  serializeValue(value, '$', out)
  return out.join('')
}
```

**Callers:** `connectOfferStaging.ts`, `evidenceChain.ts`, `executionConsent.ts`, `formationPipeline.ts`. **RFC-8785-style sorted-key JSON: yes** (with stricter integer-only numbers than full JCS number rules).

**Tests:** `packages/ingestion-core/__tests__/canonical.test.ts` — **PASS** locally.

#### (2) Handshake capsule hash — field-subset `JSON.stringify` after key sort

```64:107:apps/electron-vite-project/electron/main/handshake/capsuleHash.ts
export function computeCapsuleHash(input: CapsuleHashInput): string {
  const canonical: Record<string, unknown> = { /* fixed subset */ }
  // ...
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(canonical).sort()) {
    sorted[key] = canonical[key]
  }
  const json = JSON.stringify(sorted)
  return createHash('sha256').update(json, 'utf8').digest('hex')
}
```

Does **not** use `canonicalJsonString`; signs/hashes a **subset** of capsule fields (documented exclusions include scopes, keys, tier signals — file header comments lines 28-34).

#### (3) BEAP package signing — `stableCanonicalize` + `JSON.stringify` then SHA-256 then Ed25519

```367:418:apps/extension-chromium/src/beap-messages/services/beapCrypto.ts
export function stableCanonicalize(value: unknown): unknown {
  // sorts object keys; allows number floats through as JSON.stringify
  // ...
}
export function canonicalSerializeAAD(aadFields: Record<string, unknown>): Uint8Array {
  const canonicalized = stableCanonicalize(aadFields)
  const json = JSON.stringify(canonicalized)
  return stringToBytes(json)
}
```

`computeSigningData` builds `{header, payload, artefacts}`, `JSON.stringify`, SHA-256 hex string → Ed25519 (`beapCrypto.ts:1674-1722`). **Not** the ingestion-core domain-tagged form; floats not rejected.

---

## B. Public Handshake formation (operator/client side)

### B1. Capture methods

**Status: `PARTIAL`**

Registry (verbatim):

```20:70:packages/ingestion-core/src/captureMethods.ts
export type CaptureMethodId = 'scan' | 'manual_entry' | 'assisted_email' | 'assisted_discovery'
// ...
  { id: 'scan', shippable: false, ingress_paths: ['wr_code_public', 'wr_code_red'], ... },
  { id: 'manual_entry', shippable: true, ingress_paths: ['optirando_code_entry', 'optirando.ingress.file_import'], ... },
  { id: 'assisted_email', shippable: true, ingress_paths: ['beap_invitation'], ... },
  { id: 'assisted_discovery', shippable: false, ingress_paths: ['relay_code_claim'], ... },
```

`resolveCaptureMethodForFormation` fail-closes on `shippable: false` (`captureMethods.ts:82-86`).

| Method | Registry | Wired entry points | UI |
|---|---|---|---|
| `manual_entry` | shippable | Internal 6-digit pairing (`ipc.ts` provenance `optirando_code_entry`); `.beap` file import (`file_import`) | `AcceptHandshakeModal.tsx` pairing code; initiate/download flows |
| `assisted_email` | shippable | Inbound email/relay/WS mapped in `formationPipeline.ts` `SOURCE_INGRESS_MAP` → Connect-offer staging | Connect-offer consent IPC `handshake.consentToOffer` |
| `scan` / `code_scan` | **not shippable** (`scan`) | No `BarcodeDetector` / camera capture path found under electron or extension for formation | ABSENT as formation UI |
| `assisted_discovery` | not shippable | No `relay_code_claim` producer found | ABSENT |

Note: catalog name `code_scan` does not appear as an id; registry uses `scan`.

**Tests:** `phase4OneFormationPipeline.acceptance.test.ts` (ABI-blocked locally).

---

### B2. WR Code grammar

**Status: `ABSENT`** (as public publisher WR Code encode/decode)

**Searched:** `WR code`, `wrCode`, `parseWrCode`, `encodeWrCode`, `BarcodeDetector`, `wr_code_public`, `wr_code_red`, `_wr.` across `apps/**`, `packages/**` (excluding `docs/`).

**What exists instead:**

1. **Internal 6-digit pairing code** (not a WR Code grammar):

```84:89:apps/electron-vite-project/electron/main/orchestrator/orchestratorModeStore.ts
export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}
const PAIRING_CODE_RE = /^[0-9]{6}$/
```

Validated on wire as `/^\d{6}$/` (`enforcement.ts:180-182`). Registered with coordination via `POST …/api/coordination/register-pairing-code` (`main.ts:11917`). Resolves **device peer for same-principal internal handshake**, not a public publisher.

2. **Automation “WRCode” stamp conditions** in extension (`automation/types.ts` `WRCodeCondition`, `EventTagMatcher.evaluateWRCode`) — stubbed email-tag check, not a capture grammar.

3. Branding component `WRCodeLogo` in `App.tsx` — UI chrome only.

**No encode/decode of a structured WR Code → publisher resolution** was found.

**Registry slot only:** profile `pbeap_publisher` permits ingress `wr_code_public` / `wr_ad` (`packages/ingestion-core/src/profileRegistry.ts:80-93`) and rejects cores without attestation in tests (`phase3ProfileRegistry.acceptance.test.ts`) — **no** scan/UI formation path consumes it.

---

### B3. Verification chain on capture (DNS / well-known / Assessment Record Store)

**Status: `ABSENT`** for Public Handshake publisher verification.

| Step | Status | Evidence |
|---|---|---|
| DNS Discovery `_wr.<domain>` TXT | **ABSENT** | No `resolveTxt`, `_wr.`, or DNS TXT client in TS/JS (search across apps/packages excl. docs) |
| `/.well-known/wr/...` publisher manifest | **ABSENT** | No `well-known/wr` fetch. Existing well-known: OIDC only (`src/auth/discovery.ts:13` → `…/.well-known/openid-configuration`) |
| Assessment Record Store client | **ABSENT** | No `AssessmentRecord` / assessment-store client symbols |
| Three-way agreement check | **ABSENT** | — |
| `dnsVerification` field on tier signals | **SCAFFOLD / PARTIAL** | Type `{ verified: true; domain: string } \| null` on `TierSignals` (`types.ts:104`); enforced for publisher tier (`tierSteps.ts:59-60` → `TIER_DNS_REQUIRED`); **no producer** found that sets `currentDnsVerification` from a DNS lookup — `sessionFactory.ts` defaults `dnsVerification: null` |

Connect-offer staging verifies **capsule** material into `wr_connect_offers.verification_status` (`connectOfferStaging.ts`) — not DNS/ARS/manifest agreement.

---

### B4. Consent (Hash-Pinned) and PoAE

**Status: `IMPLEMENTED`** for formation Hash-Pinned Consent; PoAE is a **separate** execution evidence path.

#### Hash-Pinned Consent (formation)

Tables + insert in `connectOfferStaging.ts:38-91, 356-393`.

**What is hashed (verbatim preview build):**

```309:340:apps/electron-vite-project/electron/main/handshake/connectOfferStaging.ts
export function buildConnectOfferPreview(offer: ConnectOfferRow): ConnectOfferPreview {
  // boundDefinition: sender_email/iss/sub/wrdesk_user_id, receiver_email, profile_id
  // preview: offer_id, handshake_id, bound_definition, scopes (sorted),
  //          external_processing, reciprocal_allowed, ingress_path, staged_at, expires_at
  const previewHash = sha256Hex(PREVIEW_DOMAIN, canonicalJsonString(preview))
  const boundDefinitionHash = sha256Hex(BOUND_DEF_DOMAIN, canonicalJsonString(boundDefinition))
  return {
    preview,
    preview_hash: previewHash,
    bound_definition_hash: boundDefinitionHash,
    contract_state_hash: offer.capsule_hash,
  }
}
```

Displayed material is client-generated from verified capsule fields (no counterparty free text) — comments at `connectOfferStaging.ts:303-307`. Consent validity: `consentRecordResolves` (`:410-438`).

IPC: `handshake.consentToOffer`, `handshake.listConnectOffers` (`ipc.ts:1046-1071`).

#### Formation evidence = PoAC (not PoAE)

Consented formation writes:

1. **`wr_consent_records`** (three hashes) via `insertConsentRecord`
2. **PoAC** on `wr_evidence_chain` via `appendEvidenceBestEffort({ recordType: 'poac', payload: poacFormationPayload(...) })` — `db.ts:2268-2281`
3. Initial inbound **delivery** grant behind the same consent — `db.ts:2284+`

#### PoAE (execution / package — distinct)

| Kind | Location | Role |
|---|---|---|
| Runtime chain PoAE | `evidenceChain.ts` — `record_type … 'poae'` | Written on tool execution via `executeToolRequest.ts` + Intent Hash from `executionConsent.ts` |
| Extension package PoAE | `BeapPackage.poae` / `generatePoAERecord` | Embedded in BEAP package JSON when actuating processing declared |

Formation does **not** write a PoAE row. Execution PoAE binds Intent Hash of the **execution preview**, not the Connect-offer preview.

---

### B5. Handshake persistence (schemas)

**Status: `IMPLEMENTED`** (multi-table; legacy + core/runtime split + grants + evidence)

#### Legacy `handshakes` (v1 excerpt, still migration base):

```37:63:apps/electron-vite-project/electron/main/handshake/db.ts
      `CREATE TABLE IF NOT EXISTS handshakes (
        handshake_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('DRAFT','PENDING_ACCEPT','ACCEPTED','ACTIVE','EXPIRED','REVOKED')),
        initiator_json TEXT NOT NULL,
        acceptor_json TEXT,
        local_role TEXT NOT NULL CHECK (local_role IN ('initiator','acceptor')),
        sharing_mode TEXT CHECK (sharing_mode IN ('receive-only','reciprocal')),
        // ... tier, seq, policy, expires_at, revoked_at, policy hashes ...
      )`,
```

Later migrations add keys, pairing code, device roles, etc. (through v76+). Record type fields: `PartyIdentity` (email, wrdesk_user_id, iss, sub); `peer_*` / `local_*` key material; `internal_peer_pairing_code`; `same_principal`; states including runtime `PENDING_REVIEW` via Connect offers.

#### Append-only core + runtime (v75):

```1304:1341:apps/electron-vite-project/electron/main/handshake/db.ts
      `CREATE TABLE IF NOT EXISTS wr_handshake_core (
        core_hash TEXT PRIMARY KEY,
        handshake_id TEXT NOT NULL UNIQUE,
        profile_id TEXT NOT NULL,
        profile_version INTEGER NOT NULL,
        core_version INTEGER NOT NULL DEFAULT 1,
        core_json TEXT NOT NULL,
        signatures_json TEXT NOT NULL,
        capture_provenance TEXT NOT NULL DEFAULT 'unknown_legacy',
        backfilled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      // UPDATE/DELETE aborted by triggers
      `CREATE TABLE IF NOT EXISTS wr_handshake_runtime (
        handshake_id TEXT PRIMARY KEY,
        core_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        // seq, p2p tokens, effective_policy_json, ...
      )`,
```

#### Connect offers / consent (separate DB file):

```40:79:apps/electron-vite-project/electron/main/handshake/connectOfferStaging.ts
    CREATE TABLE IF NOT EXISTS wr_connect_offers (
      offer_id TEXT PRIMARY KEY,
      handshake_id TEXT NOT NULL,
      capsule_json TEXT NOT NULL,
      capsule_hash TEXT NOT NULL,
      sender_email TEXT,
      sender_iss TEXT,
      sender_sub TEXT,
      sender_wrdesk_user_id TEXT,
      receiver_email TEXT,
      profile_id TEXT NOT NULL,
      ingress_path TEXT NOT NULL,
      invitation_class TEXT NOT NULL DEFAULT 'public_bearer',
      verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'failed')),
      // suppressed, staged_at, expires_at, consumed_*, consent_id
    );
    CREATE TABLE IF NOT EXISTS wr_consent_records (
      consent_id TEXT PRIMARY KEY,
      // preview_hash, bound_definition_hash, contract_state_hash,
      // capture_method, ingress_path, source_reference, ...
    );
```

#### Grants (v76):

```1353:1365:apps/electron-vite-project/electron/main/handshake/db.ts
      `CREATE TABLE IF NOT EXISTS wr_grants (
        grant_id TEXT PRIMARY KEY,
        handshake_id TEXT NOT NULL,
        grant_type TEXT NOT NULL CHECK (grant_type IN ('delivery', 'preparation')),
        direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
        scopes_json TEXT NOT NULL,
        // consent_id, revoked_at, ...
      )`,
```

#### Evidence chain:

```45:54:apps/electron-vite-project/electron/main/handshake/evidenceChain.ts
    CREATE TABLE IF NOT EXISTS wr_evidence_chain (
      chain_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type IN ('genesis', 'poac', 'poae', 'ber')),
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (chain_id, seq)
    );
```

**Gaps vs Public Handshake contract fields:** no `origin_set` column/type (search: **ABSENT**); no publisher website `pid` / `manifest_root` / `website_kid`; capture provenance exists on core (`capture_provenance`) and consent rows; no LBCP epoch column.

---

### B6. Invitation path / DKIM·SPF·DMARC

**Status: `PARTIAL`** (invitation) / **`ABSENT`** (auth verdicts)

- Invitations arrive as **BEAP initiate capsules** over email / coordination / file — staged as Connect offers (`connectOfferStaging.ts` header comments). Delivery is capsule-based, not hyperlink deep-link formation (prior gap matrix noted deep links only select UI; re-check: no formation from protocol handlers found in this pass).
- **Not** a public WR Code “no-link” publisher invitation model (that grammar is ABSENT — B2).
- **DKIM / SPF / DMARC:** search `dkim|spf|dmarc` in `*.{ts,tsx,js}` → **zero matches**. No Channel Provenance Record typed fields; no UI surfacing of mail-auth verdicts.

---

## C. Publisher side in the runtime (orchestrator role)

### C1. Publisher pairing / publisher management

**Status: `ABSENT`** for WR Connect website pairing; **`PARTIAL`** for “publisher” as account tier.

| Concept | Status | Evidence |
|---|---|---|
| `POST ?api=orchestrator/pair` client | **ABSENT** | No `orchestrator/pair` string in TS/JS (excl. docs) |
| Website pairing window / `sessionBindingKey` | **ABSENT** | No `sessionBindingKey` in code |
| Publisher management UI/IPC for websites | **ABSENT** | No publisher-pair settings surface |
| `HandshakeTier = 'publisher'` | **IMPLEMENTED** as SSO tier signal | `types.ts:12`; tier steps require `dnsVerification` for publisher |
| `publisher_id` on context blocks | **IMPLEMENTED** as sender wrdesk id alias | `db.ts` v2 migration; embeddings provenance — not website PID |

---

### C2. Handshake listing infrastructure

**Status: `PARTIAL`** — wired, but handshake list is unbounded; inbox pagination exists separately.

**IPC / queries:**

```1081:1126:apps/electron-vite-project/electron/main/handshake/ipc.ts
    case 'handshake.list': {
      let records = listHandshakeRecords(db, filter)
      // session email filter + filterHandshakeRecordsForCurrentSession
      // merge Connect-offer display rows
      return { type: 'handshake-list', records: [...records, ...offerRecords] }
    }
```

```2478:2503:apps/electron-vite-project/electron/main/handshake/db.ts
export function listHandshakeRecords(...): HandshakeRecord[] {
  let sql = 'SELECT * FROM handshakes WHERE 1=1'
  // optional state / relationship_id / same_principal
  sql += ' ORDER BY created_at DESC'
  const rows = db.prepare(sql).all(...params)
  return overlayKeysFromStoreBatch(db, rows.map(deserializeHandshakeRecord))
}
```

HTTP: `GET /api/handshake/list` (`ipc.ts:3752+`) also returns full `listHandshakeRecords` result.

**UI:** `useHandshakes` loads **entire** RPC result into React state (`useHandshakes.ts:28-35`). Desktop `HandshakeView.loadHandshakes` additionally does **N+1** `getContextBlockCount(handshake_id)` per row (`HandshakeView.tsx:136-147`). No `react-window` / virtualization on handshake lists. Inbox BEAP list has cursor pagination (`handshake.beapInbox.list`, limit default 200 max 1000 — `ipc.ts:3506-3512`).

**At ~30k rows:** unbounded `SELECT *` + full IPC JSON + in-renderer state + N+1 context-count RPCs. No server-side cursor for handshakes.

**Tests:** `handshakeRpc.test.ts` (listHandshakes); `b81BeapInboxPagination.test.ts` (inbox only).

---

### C3. Key storage

**Status: `IMPLEMENTED`** (per-relationship + device; vault/SQLCipher + key store)

| Material | Storage | Evidence |
|---|---|---|
| Ed25519 / X25519 / ML-KEM private | `handshake_key_store` (extracted from `handshakes` in v73) | `db.ts:1242-1267` |
| Relationship public keys | Columns on `handshakes` / overlay | `types.ts:385-404` |
| Orchestrator DB DEK | Electron `safeStorage.encryptString` → `orchestrator.key` | `orchestrator-db/db.ts:99-167` |
| Extension signing key | `signingKeyVault` / `chrome.storage.local` encrypted | `beapCrypto.getSigningKeyPair` comments `:1733-1745` |
| SSO refresh tokens | keytar (noted in `main.ts`) | comment at `main.ts:264` |
| Vault field encryption | libsodium XChaCha20-Poly1305 | `vault/crypto.ts` |

**Per-relationship keys: yes** — TOFU Ed25519 + X25519 + ML-KEM per handshake id in `handshake_key_store`.

**Not found:** NaCl sealed-box key derived from Ed25519 for WR Connect mgmt; website `kid` registry.

---

### C4. Outbound HTTP(S) client

**Status: `PARTIAL`** — ad-hoc `fetch`, no single website-polling client with a declared redirect/TLS policy.

Observed patterns:

- Coordination / relay: global `fetch(url, { method, headers })` — e.g. `relayPull.ts:125-128`, `relaySync.ts`, `coordinationFlushQueued.ts`
- Capsule outbound path: `sendCapsuleViaHttpWithAuth` in `handshake/p2pTransport.ts` — `TIMEOUT_MS = 30_000`, AbortController; no custom TLS Agent / no explicit `redirect: 'error'`
- Dependencies include `node-fetch@2.7.0` (`apps/electron-vite-project/package.json:57`) and native undici `fetch` on Node 20
- No shared module defining `rejectUnauthorized`, max redirects, or pinned CA for publisher website polling
- PQ API / local orchestrator: `http://127.0.0.1:51248` from extension

**What a website-polling/pushing leg would use today:** new code would likely call `fetch` like `p2pTransport` / relay clients, unless a dedicated client is added. **No** existing WR Connect `?api=mgmt` / `?api=orchestrator/pair` client.

---

## D. Session binding / login-bound machinery

### D1. LBCP / session-binding / login-epoch

**Status: `ABSENT`**

**Searched (apps/packages, excl. docs):** `LBCP`, `binding challenge`, `session epoch`, `login epoch`, `dual possession`, `sessionBindingKey`, `wrc-x25519`.

**Hits:** none in TS/JS. Mentions exist only in `docs/analysis/wr-handshake-gap/*` as future/foreclosed work.

**Related but not LBCP:**

- `wr_handshake_core` append-only store intended as future pin target (migration v75 comment cites `[XI.LB§6]`) — substrate **PARTIAL**, LBCP protocol **ABSENT**
- **VSBT (Vault Session Binding Token)** — nearest existing “session binding”: vault unlock token bound to WS/HTTP/dashboard (`vault/service.ts` `validateToken` / `getSessionToken`; middleware `x-vault-session` in `main.ts:8803+`; tests `vault/vsbt.test.ts`). Scopes vault RPC, **not** website login-epoch / dual-possession.
- WebSocket / Host-AI “heartbeat” ≠ LBCP heartbeat
- `INVALID_CONTEXT_BINDING` reason codes = context block proofs, not login binding

---

### D2. Browser-extension same-origin fetch on desktop instruction

**Status: `ABSENT`** for session-binding / LBCP-style instructed fetch; **`PARTIAL`** for other desktop→tab scripting.

| Capability | Status | Path |
|---|---|---|
| Desktop → extension RPC | IMPLEMENTED | Electron HTTP / WS + `electronRpc` |
| `chrome.scripting.executeScript` for DOM snapshot | IMPLEMENTED | `domSnapshotBridge.ts`, `watchdogDomExtract.ts` |
| Autofill same-origin field fill | IMPLEMENTED | vault autofill |
| Desktop instructs extension to `fetch()` visited origin for binding challenge | **ABSENT** | No message type / handler found for instructed same-origin credentialed fetch for LBCP |

---

## E. Diff against WR Connect website contract (v0.4.0)

### Pairing — `POST ?api=orchestrator/pair`

| Contract | Runtime |
|---|---|
| Request `{code, kid, pub(Ed25519 raw b64u), label}` | **ABSENT** — no client, no handler |
| Response signed by website `sessionBindingKey` from `/.well-known/wr/manifest` | **ABSENT** — no manifest fetch, no `sessionBindingKey` |
| Fields `handshake_id, pid, host, website_kid, website_pub, manifest_root, epoch` | **ABSENT** as website-pair types; local `handshake_id` is Optirando relationship id |

Closest local analog: internal 6-digit pairing code + initiate capsule — different trust model (same-principal device), different signature coverage.

### Management — `POST ?api=mgmt` (`wrc-x25519-sealedbox-ed25519-v1`)

| Contract | Runtime |
|---|---|
| Outer `{v:"wrc-x25519-sealedbox-ed25519-v1", cap:"<b64u sealed box>"}` | **ABSENT** |
| Inner signed `{typ:"wr/mgmt", hs, kid, nce, iat, exp, epo, body, sig}` | **ABSENT** |
| Seal = X25519 sealed box to curve key derived from Ed25519 | **ABSENT** — no `crypto_box_seal` / Ed25519→X25519 convert for mgmt |
| Routes `handshake/register\|update\|list\|changes\|stats` | **ABSENT** as website mgmt; local has `handshake.list` IPC / `/api/handshake/list` (different auth + shape) |

### E1. Closest existing envelope — field-by-field delta

**Closest candidates:** (A) `SealedServiceRpcEnvelope` for Host↔Sandbox sealed RPC; (B) `BeapPackage` for message delivery.

#### vs `SealedServiceRpcEnvelope` (`sealedServiceRpc.ts:29-40`)

| wrc-mgmt field | SealedServiceRpc | Delta |
|---|---|---|
| `v: wrc-x25519-sealedbox-ed25519-v1` | `envelope_type: sealed_service_rpc_v1` (+ schema_version) | Different suite id / purpose |
| `cap` sealed box | `ciphertext_b64` + ephemeral `sender_ephemeral_x25519_pub_b64` + salt/nonce | Ephemeral ECDH + HKDF + AES-GCM, **not** libsodium sealed box |
| Inner `typ: wr/mgmt` | Inner plaintext JSON service-RPC types | No `wr/mgmt` / `wr/mgmt-res` |
| `hs, kid, nce, iat, exp, epo` | `handshake_id`, device ids; no kid/nce/epoch/iat/exp envelope | Missing website epoch / kid / nonce echo protocol |
| `sig` Ed25519 over canonical minus sig | No detached Ed25519 over mgmt envelope (AEAD auth only) | Missing signed envelope layer |
| Routes register/update/list/changes/stats | Internal inference / service RPC routes | Different route vocabulary |
| Response sealed `wr/mgmt-res` echoing `nce` | Open → plaintext JSON result | No sealed response envelope |

Verbatim sealed RPC outer:

```29:40:apps/electron-vite-project/electron/main/serviceRpc/sealedServiceRpc.ts
export interface SealedServiceRpcEnvelope {
  readonly envelope_type: typeof SEALED_SERVICE_RPC_ENVELOPE_TYPE
  readonly schema_version: typeof SEALED_SERVICE_RPC_SCHEMA_VERSION
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly sender_ephemeral_x25519_pub_b64: string
  readonly salt_b64: string
  readonly nonce_b64: string
  readonly ciphertext_b64: string
}
```

#### vs `BeapPackage`

| wrc-mgmt | BeapPackage | Delta |
|---|---|---|
| Small sealed mgmt envelope | Large message package (payload/artefacts/PoAE) | Wrong abstraction |
| X25519 sealed box | Hybrid ML-KEM+X25519 + AES-GCM chunked capsule (qBEAP) or plaintext (pBEAP) | Different crypto |
| `typ: wr/mgmt` + routes | `header.encoding` pBEAP/qBEAP + message content | No mgmt routes |
| Website kid/epoch | Handshake binding + fingerprints | No website identity model |

### E2. Can pBEAP/qBEAP replace `wrc-x25519-sealedbox`?

**No — not directly.** Blocking differences:

1. **Purpose:** BEAP packages carry message/artefact content; mgmt is a compact control plane with nonce/epoch/list cursors.
2. **Crypto suite:** sealed box (anonymous X25519 to static recipient key derived from Ed25519) ≠ hybrid ML-KEM/X25519 HKDF AES-GCM with handshake-bound keys ≠ pBEAP plaintext.
3. **Key derivation:** contract requires Ed25519→Curve25519 conversion for seal target; runtime stores separate X25519 keys for qBEAP, not sealed-box conversion of website Ed25519.
4. **Canonicalization / signature:** mgmt signs canonical JSON minus `sig` with ±120s iat / ≤300s exp; BEAP signs hashed signing-data object; handshake evidence uses domain-tagged `canonicalJsonString`.
5. **Transport:** mgmt is `POST ?api=mgmt` to publisher origin; BEAP uses email/coordination `/beap/capsule`.
6. **No callers** for website pair/mgmt exist to adapt.

Reusable pieces: Ed25519 sign/verify, X25519 ECDH, `canonicalJsonString`, per-handshake key store, HTTP `fetch` patterns — as **libraries**, not as a drop-in capsule substitute.

---

## F. Summary matrix

| Item | Status | One-line evidence | Blocking dependency |
|---|---|---|---|
| A1 pBEAP format/crypto | IMPLEMENTED | `BeapPackage` + pBEAP builder/ingest paths | — |
| A2 qBEAP hybrid PQ | IMPLEMENTED | Suite `HYBRID_MLKEM768_…`; `@noble/post-quantum`; `decryptQBeapPackage.ts` | Electron PQ HTTP auth for extension encapsulate |
| A3 Sealed Relay (product) | PARTIAL | Coordination + relay-server store-and-forward; not sealed-box mgmt | WR Connect mgmt/pair protocol |
| A4 Persistent connections | IMPLEMENTED | WS `/beap/ws` + heartbeat; HTTP pull | — |
| A5 Canonical signing | PARTIAL | ingestion-core RFC8785-like; capsuleHash subset; BEAP stableCanonicalize | Unify serializers before website mgmt |
| B1 Capture methods | PARTIAL | Registry 4 ids; only `manual_entry` + `assisted_email` shippable | Implement `scan` + `assisted_discovery` |
| B2 WR Code grammar | ABSENT | Only `/^\d{6}$/` pairing code | Spec + encode/decode + publisher resolve |
| B3 DNS / well-known / ARS | ABSENT | OIDC well-known only; `dnsVerification` never populated from TXT | Dual-channel verifier + ARS client |
| B4 Hash-Pinned Consent | IMPLEMENTED | `wr_consent_records` + three hashes in `connectOfferStaging.ts` | Origin-set / publisher preview fields |
| B4 Formation PoAC | IMPLEMENTED | `db.ts:2268-2281` `recordType: 'poac'` + delivery grant | — |
| B4 PoAE (execution) | IMPLEMENTED | `wr_evidence_chain` + `executionConsent` Intent Hash | — (distinct from formation) |
| B5 Handshake DB schemas | IMPLEMENTED | `handshakes`, `wr_handshake_core/runtime`, grants, evidence, connect-offers | Publisher identity / origin_set / epoch columns |
| B6 Invitation + DMARC | PARTIAL / ABSENT | Capsule email invitation; zero dkim/spf/dmarc matches | CPR + verdict UI |
| C1 Publisher pairing | ABSENT | No `orchestrator/pair` / website PID mgmt | Website contract client + UI |
| C2 Handshake list @30k | PARTIAL | Unbounded `SELECT *` + full IPC + N+1 `getContextBlockCount`; inbox paginated | Cursor/virtualization for handshakes |
| C3 Key storage | IMPLEMENTED | `handshake_key_store` + `safeStorage` DEK | Website kid + sealed-box key derive |
| C4 Outbound HTTP client | PARTIAL | Ad-hoc `fetch`; no TLS/redirect policy module | Hardened client for website origin |
| D1 LBCP / session bind | ABSENT | No LBCP symbols; nearest is VSBT (vault-only) | Hash-stable core (partial) + protocol |
| D2 Ext. instructed same-origin fetch | ABSENT | DOM scripting exists; no binding-fetch path | Desktop→extension instruct API |
| E Pair API | ABSENT | — | B2+B3+C1 |
| E Mgmt sealed-box API | ABSENT | Closest: `SealedServiceRpcEnvelope` (different suite) | New suite + routes |
| E1 Closest envelope delta | PARTIAL (analysis) | SealedServiceRpc / BeapPackage field deltas above | — |
| E2 BEAP replaces sealedbox? | ABSENT (cannot) | Purpose/crypto/transport mismatch §E2 | Dedicated wrc suite |

---

## Top 10 gaps in build order

Judgment tied to catalog items; each assumes prior items.

1. **B2 — WR Code grammar + resolve-to-publisher** — so capture has a public identifier (unblocks B1 `scan`, C1 pairing request `code`).
2. **B3 — DNS `_wr.` TXT + `/.well-known/wr/manifest` + ARS agreement** — trust chain before any website pair accept (unblocks C1 response verify via `sessionBindingKey` / `manifest_root`).
3. **C1 / E Pair — `orchestrator/pair` client + persistence of `pid`, `website_kid/pub`, `epoch`, `manifest_root`** — first website relationship object.
4. **A5 unify + E mgmt crypto — Ed25519→X25519 sealed box + canonical sign of `wr/mgmt`** — cannot reuse qBEAP/pBEAP as-is (E2); may reuse `canonicalJsonString` + key store.
5. **E Mgmt routes — register/update/list(cursor)/changes/stats** over sealed transport — publisher sync plane.
6. **B1 ship `scan` (+ later `assisted_discovery`)** — registry stubs already fail-closed; wire UI/camera or paste of WR Code into formation pipeline.
7. **B4/B5 extend consent + core fields — `origin_set`, capture provenance for public_bearer, website epoch** — Hash-Pinned Consent exists but lacks Public Handshake contract fields.
8. **C2 handshake list pagination/virtualization** — required before publisher-scale keysets (mgmt `list`) mirror into UI; today breaks at large N.
9. **B6 Channel Provenance (SPF/DKIM/DMARC)** — if assisted_email remains a Public ingress; currently ABSENT.
10. **D1/D2 LBCP** — after hash-stable `wr_handshake_core` + website sessionBindingKey; needs instructed same-origin fetch path (D2) that does not exist.

---

## Appendix — search terms for ABSENT items

| Claim | Directories / globs | Terms |
|---|---|---|
| WR Code parser | `apps/**`, `packages/**` | `parseWrCode`, `encodeWrCode`, `wr_code_public`, `BarcodeDetector` |
| DNS discovery | same | `_wr.`, `resolveTxt`, `dns.promises` |
| Well-known WR | same | `well-known/wr`, `sessionBindingKey`, `manifest_root` |
| Assessment store | same | `AssessmentRecord`, `assessment_record` |
| LBCP | same | `LBCP`, `dual possession`, `binding challenge`, `login epoch` |
| WR Connect mgmt | same | `wrc-x25519`, `orchestrator/pair`, `wr/mgmt` |
| DKIM/SPF/DMARC | `*.{ts,tsx,js}` | `dkim`, `spf`, `dmarc` |
| origin_set | same | `origin_set`, `originSet` |
| QUIC transport | packages coordination/relay/p2p | `QUIC`, `quic` |

---

## Appendix — prior analysis re-verification notes

`docs/analysis/wr-handshake-gap/gap-matrix.md` (Phase 2) claimed Hash-Pinned Consent, capture methods, PoAE chain, and core/runtime split as MISSING. **Current code has advanced** (Phase 4 Connect-offer + Phase 5 grants/evidence on branch `refactor/wr-handshake-phase-5-grants-evidence`). This report treats those as IMPLEMENTED/PARTIAL per citations above. Items still missing for **publisher / WR Connect v0.4.0** (pair, mgmt sealed-box, WR Code, DNS/ARS, LBCP) remain ABSENT as of commit `b9a4b835`.
