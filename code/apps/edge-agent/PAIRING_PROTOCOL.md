# Edge Agent pairing protocol (PR4)

Source of truth for Agent ↔ host orchestrator pairing. Implementation must conform; divergences require updating this document first.

## Ports

| Port | Bind | Purpose |
|------|------|---------|
| 8090 | `127.0.0.1` only | Setup UI + SSO callback (`/sso-callback`) |
| 8443 | `0.0.0.0` | Pairing API over HTTPS (self-signed TLS) |
| 51249 | `0.0.0.0` | Post-pairing P2P (PR5+) |

## Fingerprint format

1. Normalize Ed25519 public keys: lowercase hex, 64 chars, **no** `ed25519:` prefix.
2. Nonces: UTF-8 strings from the wire (base64url, 16+ bytes entropy each).
3. Concatenate in fixed order: `orchestrator_public_key || agent_public_key || orchestrator_nonce || agent_nonce`.
4. `SHA-256(concat)` → take first 8 bytes → lowercase hex → group as `aaaa-bbbb-cccc-dddd` (four groups of four hex digits).

Example: `a3f2-b91c-7e4d-082f`

Both Agent setup UI and orchestrator (C8) must render **identical** strings (lowercase, dashes every four hex chars).

## Pairing code

- Six decimal digits, cryptographically random (`000000`–`999999`).
- **Display**: `XXX-XXX` (dash after third digit).
- **Wire / storage in initiate body**: six digits only, no dash.
- **Lifetime**: 10 minutes from generation.
- **Single-use**: consumed on first `/pair/initiate` attempt (success or failure after validation passes). Regenerate explicitly via setup UI.
- **Memory only**: not persisted to disk; Agent restart issues a new code.

## Message sequence

### 0. Preconditions

- Agent phase `unpaired`, user signed in (SSO `sub` + refresh token in encrypted state).
- Agent displays active pairing code on setup UI (`:8090`).

### 1. `POST /pair/initiate` (orchestrator → Agent `:8443`)

**Request** (`application/json`):

| Field | Type | Description |
|-------|------|-------------|
| `pairing_code` | string | Six digits, no dash |
| `orchestrator_sub` | string | SSO subject from orchestrator session |
| `orchestrator_public_key` | string | Fresh Ed25519 public key (hex, 64 chars) for this pairing only |
| `orchestrator_nonce` | string | Random base64url nonce |

**Agent checks:**

1. Code matches active code, not expired, not consumed.
2. `orchestrator_sub` equals Agent's signed-in `sub`.
3. `orchestrator_public_key` is 64 hex chars.
4. Mark code consumed.

**On failure:** HTTP 4xx with `{ "error": "<code>", "message": "..." }` — see Error codes.

**Response** (`200`):

| Field | Type |
|-------|------|
| `session_id` | string (UUID) |
| `agent_public_key` | string (64 hex) |
| `agent_nonce` | string |
| `fingerprint` | string (formatted) |
| `agent_restart_epoch` | string (stable per Agent process start) |
| `agent_encryption_public_key_b64` | string (X25519 public key, base64) |
| `p2p_endpoint` | string (e.g. `http://203.0.113.10:51249`) |
| `agent_p2p_auth_token` | string (UUID — orchestrator sends as Bearer on `/agent/*`) |

Agent generates fresh Ed25519 pairing keypair + `agent_nonce`, stores in-memory session. X25519 encryption keypair and Agent P2P bearer are created at SSO sign-in (PR6).

### 2. Display fingerprint (both UIs)

No wire message. User compares Agent `:8090` screen with orchestrator (C8).

### 3. `POST /pair/confirm` (orchestrator → Agent `:8443`)

**Request:**

| Field | Type |
|-------|------|
| `session_id` | string |
| `party` | `"orchestrator"` |
| `orchestrator_p2p_auth_token` | string (UUID — Agent expects as Bearer on inbound `/agent/*`) |

Sets `orchestrator_confirmed = true` on session and stores the orchestrator P2P token in encrypted state.

### 4. `POST /setup/pair/confirm` (browser → Agent `:8090`)

Same fields; `party`: `"agent_ui"`.

Sets `agent_ui_confirmed = true`.

### 5. Persist (Agent, when both confirmations true)

- Write `pair_record` to encrypted state: both public keys, nonces, fingerprint, `sub`, `confirmed_at`, orchestrator address hint.
- Phase → `paired`.
- Clear in-memory pairing session.

**Response** on next `POST /pair/confirm` from orchestrator when complete: `{ "status": "paired", "fingerprint": "..." }`

### 6. `GET /pair/status?session_id=` (optional poll)

Returns session state: `awaiting_confirmations` | `paired` | `rejected` | `expired`.

### 7. `POST /pair/reject` (either party)

Discards in-flight session; returns to code display (new code required).

## Error codes (`/pair/initiate`)

| HTTP | `error` | Meaning |
|------|---------|---------|
| 400 | `invalid_code` | Wrong code format |
| 401 | `code_mismatch` | Code wrong |
| 410 | `code_expired` | TTL elapsed |
| 410 | `code_consumed` | Already used |
| 403 | `sub_mismatch` | SSO sub differs |
| 400 | `invalid_public_key` | Malformed orchestrator key |

## TLS

- Self-signed certificate generated at Agent start for pairing listener.
- SPKI fingerprint logged for ops; trust established via pairing fingerprint + SSO sub match, not CA PKI.

## Keycloak (operational)

- Client `wrdesk-edge-agent`, public, PKCE.
- Redirect: `http://127.0.0.1:8090/sso-callback`
- Token exchange audience: `beap-edge-attestation`
- **Refresh policy**: confirm with realm owner that VPS long-run refresh is acceptable (document in PR).

## Resulting handshake type (PR4.5)

When pairing completes, both sides persist a relationship with **`handshake_type: edge_ingestor`** (not `internal`). Role pair is **`host` ↔ `edge_agent`** only. The Agent stores an `edge_ingestor` handshake-shaped record in encrypted state; the orchestrator creates the ledger row in PR8 using the same type and roles.

## Out of scope (PR4)

- Orchestrator wizard UI (C8).
- Pod start after pairing (PR5).
