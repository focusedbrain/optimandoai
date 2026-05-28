# Credential relay protocol (PR6)

Source of truth for orchestrator → Agent mail-fetch credential relay over the `edge_ingestor` P2P channel. Implementation must conform; divergences require updating this document first.

## Namespaces

| Namespace | Port | Auth | Purpose |
|-----------|------|------|---------|
| `/setup-ui`, `/sso-callback`, `/agent/health`, `/agent/recover` | 8090 (loopback) | None / localhost maintenance | Setup UI (410 after pair) |
| `/pair/*` | 8443 (TLS) | Pairing code + SSO sub | Pairing only |
| `/agent/*` | 51249 (P2P) | `Authorization: Bearer <orchestrator_p2p_token>` | Application API (credentials, status) |
| `/beap/ingest` | 51249 (P2P) | Same Bearer | BEAP capsules (existing) |

Three namespaces, three concerns. No overlap.

## Transport

- **Channel**: existing P2P HTTP to `p2p_endpoint` from the `edge_ingestor` handshake (direct LAN when reachable; coordination relay is out of scope for PR6 Agent listener — orchestrator uses direct `http://<agent-host>:51249` recorded at pairing).
- **Auth**: every `/agent/*` request includes `Authorization: Bearer <token>` where the token is `orchestrator_p2p_auth_token` exchanged at pairing (orchestrator sends; Agent verifies against persisted `orchestratorP2pAuthToken`).
- **No** URL-parameter auth, API keys, or custom schemes.

## Pair record extension (PR4 + PR6)

Both sides persist after pairing:

| Field | Type | Owner |
|-------|------|--------|
| `agent_encryption_public_key_b64` | base64 (32 bytes raw X25519) | Agent generates; orchestrator stores |
| `p2p_endpoint` | string URL | Agent advertises e.g. `http://<host>:51249` |
| `orchestrator_p2p_auth_token` | UUID string | Orchestrator generates; sends in `/pair/confirm`; Agent stores for inbound verify |
| `agent_p2p_auth_token` | UUID string | Agent generates; returned in `/pair/initiate`; orchestrator stores for outbound Bearer |

Existing PR4 fields unchanged (`handshake_id`, `handshake_type: edge_ingestor`, Ed25519 pairing keys, nonces, fingerprint, roles).

### Wire additions

**`POST /pair/initiate` response** adds:

```json
{
  "agent_encryption_public_key_b64": "<base64>",
  "p2p_endpoint": "http://203.0.113.10:51249",
  "agent_p2p_auth_token": "<uuid>"
}
```

**`POST /pair/confirm` request** adds:

```json
{
  "orchestrator_p2p_auth_token": "<uuid>"
}
```

### Migration (PR4-era pairs)

On Agent startup when `phase === 'paired'`:

- If `agentEncryptionKeypair` missing: generate X25519 keypair, persist private key in encrypted state, expose public key on `GET /agent/health` as `agentEncryptionPublicKeyB64` and `encryptionKeyMigrationRequired: true`.
- If `orchestratorP2pAuthToken` missing: pairing must be re-run (test-only pairs); production path is re-pair.

Orchestrator polls `/agent/health` (via setup port 8090 during development, or P2P health in PR7) to learn new encryption public key and updates its replica / handshake row.

## Encryption envelope (v1)

**Algorithm**: X25519 ephemeral ECDH + HKDF-SHA256 + AES-256-GCM (libsodium `crypto_box` equivalent semantics without libsodium dependency).

**Stable Agent key**: X25519 keypair generated after SSO sign-in (before pairing code). Private key in Agent encrypted state; public key in pair record.

### Wrap (orchestrator → Agent)

1. Generate ephemeral X25519 keypair.
2. `shared = ECDH(ephemeral_private, agent_public)`.
3. `key = HKDF-SHA256(shared, salt=nonce, info="wrdesk-agent-credential-v1")`.
4. `ciphertext = AES-256-GCM(key, iv=nonce[0:12], plaintext, aad=associatedData)`.
5. Wire object:

```typescript
interface CredentialRelayEnvelopeV1 {
  version: 1
  ephemeral_public_key_b64: string // 32-byte X25519 public key
  nonce_b64: string // 24 random bytes (12 used as GCM iv, full as HKDF salt)
  ciphertext_b64: string
  associated_data: string // e.g. "account:<account_id>"
}
```

**Inner plaintext** (UTF-8 JSON after unwrap):

```typescript
interface CredentialRelayPlaintext {
  encrypted_bundle: string // JSON string of EncryptedCredentialBundleWire (@repo/email-fetch)
  account_key_hex: string // 64 hex chars
  wrapped_account_key?: string // optional VMK-wrapped blob from orchestrator (opaque)
  quarantine_key_hex?: string // optional 64 hex
}
```

### Unwrap (Agent)

1. Verify `version === 1`.
2. ECDH(agent_private, ephemeral_public) → same HKDF → decrypt.
3. Validate `associated_data` matches request `account_id`.
4. Re-encrypt `account_key_hex` and bundle metadata into Agent at-rest record (AES-256-GCM under Agent state encryption key — separate from envelope).

### Threat model

| Defended | Not defended |
|----------|----------------|
| Relay/coordination operator reading relay bodies | Compromised orchestrator host (it has plaintext before wrap) |
| In-flight buffer dumps on Agent host before unwrap | Compromised Agent host after unwrap |
| Log redaction mistakes on relay path | Malicious paired orchestrator (Bearer is legitimate) |

Defense in depth: P2P Bearer already authenticates the sender; envelope ensures ciphertext is useless without Agent private key even if relay logs bodies.

## Message catalog

All paths are on **`p2p_endpoint`** (port **51249**). JSON bodies unless noted.

### `POST /agent/credentials/relay`

**Auth**: Bearer required.

**Preconditions**: `phase === 'paired'`; envelope valid. Pod may be `running`, `stopped`, or `halted_by_anomaly` — relay is allowed; activate is separate.

**Request**:

```typescript
interface CredentialRelayRequest {
  account_id: string
  display_name: string
  provider: 'google' | 'microsoft'
  envelope: CredentialRelayEnvelopeV1
}
```

**Postconditions**: Account record persisted under `state.accounts[account_id]` (at-rest encrypted fields). **Does not** push into a running mail-fetcher (tmpfs/env immutable until restart).

**Response 200**:

```json
{ "status": "stored", "account_id": "..." }
```

**Errors**:

| HTTP | `error` | When |
|------|---------|------|
| 401 | `unauthorized` | Missing/wrong Bearer |
| 409 | `not_paired` | Agent unpaired |
| 400 | `invalid_envelope` | Decrypt/parse failure |
| 400 | `invalid_provider` | Unsupported provider |
| 400 | `invalid_account_id` | Empty/malformed id |
| 503 | `agent_halted` | `halted_by_anomaly` — relay allowed but orchestrator should not activate until recover |

**Idempotency**: Same `account_id` overwrites prior stored credentials (safe retry).

---

### `POST /agent/credentials/activate`

**Auth**: Bearer required.

**Preconditions**: `phase === 'paired'`; at least one stored account (optional — may be no-op restart).

**Behavior**: Graceful pod restart via pod manager (`stop` → `start`). After mail-fetcher healthy, Agent pushes all stored accounts to mail-fetcher via local supervisor HTTP (`POST /accounts/start`, `POST /accounts/deliver_key`, quarantine key) — same contract as SSH `mailFetcherRemote.ts`. **Does not** consume supervisor replacement budget.

**Response 200**:

```json
{ "status": "activate_started", "pod_state": "starting" }
```

**Errors**: same 401/409; `409` `pod_start_failed` if restart fails.

**Idempotency**: Safe to retry; may restart pod again.

---

### `DELETE /agent/credentials/{account_id}`

**Auth**: Bearer required.

**Postconditions**: Account removed from state; pod restart scheduled to drop credentials from mail-fetcher tmpfs.

**Response 200**: `{ "status": "revoked", "account_id": "..." }`

**Errors**: `404` `account_not_found`

**Idempotency**: DELETE on missing account returns 404 (not idempotent); orchestrator treats 404 as success.

---

### `GET /agent/accounts/status`

**Auth**: Bearer required.

**Response 200**:

```typescript
interface AgentAccountsStatusResponse {
  pod_state: string
  accounts: Array<{
    account_id: string
    display_name: string
    provider: string
    has_credentials: boolean
    remote_state?: 'awaiting_key' | 'active' | 'degraded' | 'stopped'
    last_fetch_at?: string
    last_error?: string
  }>
  encryption_key_migration_required?: boolean
  agent_encryption_public_key_b64?: string
}
```

`remote_state` is polled from mail-fetcher `GET /accounts/status` when pod running.

**Idempotency**: Read-only.

---

## Pod-runtime credential injection

The mail-fetcher role does **not** read OAuth material from pod launch env. PR5 injects only `POD_AUTH_SECRET`, certifier edge keys, etc.

PR6 **runtime delivery** (after pod healthy):

1. Agent reads decrypted account records from encrypted state.
2. Agent calls mail-fetcher on `127.0.0.1:18106` via `podman exec` + Node fetch (same as `mailFetcherRemote.ts`), using live `POD_AUTH_SECRET` from pod manager memory.
3. Sequence per account: `/accounts/start` → `/accounts/deliver_key` → quarantine key once per pod.
4. Clears in-memory key material in `finally` blocks.

On `POST /agent/credentials/activate` or pod start completion, `deliverAllAccountsToMailFetcher()` runs.

## Orchestrator flow (`edgeFetch.state`)

Unchanged user entry: connect account in orchestrator.

When `edgeFetch.state` → `awaiting_key` / migration for **`deployment_type: 'agent'`**:

1. Build `CredentialRelayPlaintext` via existing `encryptAccountCredentialBundle()`.
2. Wrap with `agent_encryption_public_key_b64`.
3. `POST /agent/credentials/relay` over P2P with Bearer `agent_p2p_auth_token`.
4. `POST /agent/credentials/activate`.
5. Poll `GET /agent/accounts/status` until mail-fetcher reports `active`.
6. Transition orchestrator account to `active`.

**SSH path** (`deployment_type: 'ssh'` or omitted): existing `migration.ts` + `mailFetcherRemote.ts` unchanged.

## Credential lifecycle

| Event | Action |
|-------|--------|
| Account migrate to Agent | relay + activate |
| OAuth refresh on desktop | re-relay + activate (orchestrator pushes new bundle) |
| User disconnect / migrate back | `DELETE /agent/credentials/{id}` |
| Agent pod restart (supervisor) | Agent re-delivers all stored accounts after healthy |
| Token refresh inside mail-fetcher | Local to container (@repo/email-fetch); orchestrator may push refreshed bundle on desktop reauth |

## Error paths (orchestrator)

| Condition | Orchestrator behavior |
|-----------|----------------------|
| Agent unreachable | Retry with backoff; keep `migrating` / surface error on account |
| Relay 401 | Re-pair or fix tokens |
| Relay `invalid_envelope` | Fix keys; do not retry same payload |
| Agent `halted_by_anomaly` | Block activate; prompt recover (PR5 `/agent/recover` on 8090) |
| Wrong encryption key | Re-fetch key from health / re-pair |

## Stream B invariant

PR6 does not add SMTP or send paths. `rolePolicy.canSend` unchanged. Agent pod remains fetch-only.

## Versioning

`envelope.version === 1` only in PR6. Future algorithms increment version; Agent rejects unknown versions with `400 invalid_envelope`.
