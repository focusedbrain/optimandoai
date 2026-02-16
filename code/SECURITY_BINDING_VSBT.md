# SECURITY_BINDING_VSBT.md — Vault Session Binding Token

## 1. Purpose

The Vault Session Binding Token (VSBT) is a **local-process-isolation hardening layer** that prevents unauthorized local processes from accessing WRVault endpoints while the vault is unlocked.

### Problem Addressed

WRVault listens on `127.0.0.1:51248`. Any process on the same machine can reach these endpoints. Without VSBT, a malicious local process (malware, rogue extension, compromised script) could:

- Read/write vault records at the user's tier while the vault is unlocked.
- Trigger bulk operations (export, autofill candidates).
- Lock the vault (denial of service).

### Solution

A cryptographically random, per-session token is generated at vault unlock and required on every subsequent request. Only the Electron main process and the trusted extension client possess the token.

---

## 2. Token Lifecycle

```
┌─────────────────────────────────────────────────────┐
│                   VAULT LOCKED                       │
│  VSBT = null                                         │
│  validateToken(*) → false                            │
│  getSessionToken() → null                            │
└──────────────────────┬──────────────────────────────┘
                       │ unlock / create / passkey-unlock
                       ▼
┌─────────────────────────────────────────────────────┐
│                  VAULT UNLOCKED                      │
│  VSBT = crypto.randomBytes(32).toString('hex')       │
│  Returned in unlock/create response as sessionToken  │
│  validateToken(VSBT) → true                          │
│  validateToken(anything else) → false                │
└──────────────────────┬──────────────────────────────┘
                       │ lock / logout / session-expire
                       ▼
┌─────────────────────────────────────────────────────┐
│                   VAULT LOCKED                       │
│  session = null → VSBT destroyed                     │
│  Old VSBT is irrecoverable                           │
│  All subsequent requests with old VSBT → rejected    │
└─────────────────────────────────────────────────────┘
```

**Key properties:**

| Property               | Value                                  |
|------------------------|----------------------------------------|
| Entropy                | 256 bits (32 cryptographic random bytes) |
| Encoding               | Hex string (64 characters)             |
| Storage                | In-memory only (Electron main process) |
| Persisted to disk      | **Never**                              |
| Lifetime               | Bound to vault session (unlock → lock) |
| Rotation               | New token on every unlock              |
| Replay after lock      | Impossible (old token invalidated)     |

---

## 3. Enforcement Points

### 3.1 HTTP API (`/api/vault/*`)

An Express middleware runs **before** all vault route handlers:

```
Request → JSON parse → VSBT middleware → route handler → VaultService
```

- **Header**: `X-Vault-Session: <VSBT>`
- **Exempt endpoints** (work when vault is locked or establish a session):
  - `/api/vault/health`
  - `/api/vault/status`
  - `/api/vault/create` — returns `sessionToken` in response
  - `/api/vault/unlock` — returns `sessionToken` in response
  - `/api/vault/passkey/unlock-begin`
  - `/api/vault/passkey/unlock-complete` — returns `sessionToken` in response
- **All other endpoints**: VSBT required. Missing/invalid → HTTP 401 before any service call.

### 3.2 WebSocket RPC (`vault.*` methods)

After the existing JWT/session authentication gate:

- **Exempt methods**: `vault.create`, `vault.unlock`, `vault.getStatus`
- **All other methods**: `msg.vsbt` field required and validated.
  - Missing/invalid → error response before `handleVaultRPC` is called.
- `vault.create` and `vault.unlock` return `sessionToken` in the response payload.

### 3.3 Extension Client

The extension API client (`api.ts`) stores the VSBT in a module-level variable (`_vsbt`):

- Set on `unlockVault()`, `createVault()`, `passkeyUnlockComplete()`.
- Cleared on `lockVault()`.
- Sent to the background script in every `chrome.runtime.sendMessage` call as `msg.vsbt`.
- The background script attaches it as the `X-Vault-Session` HTTP header on every fetch to `127.0.0.1`.

---

## 4. Threat Model

### What VSBT Protects Against

| Threat                                    | Mitigated? | How                                           |
|------------------------------------------|------------|-----------------------------------------------|
| Malicious local process calling 127.0.0.1 | **Yes**    | Request rejected — no VSBT                    |
| Replay of captured VSBT after lock        | **Yes**    | VSBT invalidated on lock                      |
| Replay of VSBT from previous session      | **Yes**    | VSBT rotates on every unlock                  |
| Brute-force VSBT guess                    | **Yes**    | 2^256 entropy — computationally infeasible    |
| Malicious process locking the vault (DoS) | **Yes**    | `/api/vault/lock` requires VSBT               |
| Tier escalation via VSBT manipulation     | **No** (not needed) | Tier is resolved server-side from JWT, not from client |

### What VSBT Does NOT Protect Against

| Threat                                              | Why                                                      |
|----------------------------------------------------|----------------------------------------------------------|
| Attacker with full memory read access               | VSBT is in process memory; full memory dump exposes it   |
| Compromised Electron main process                   | Attacker IS the server — game over regardless             |
| Compromised extension background script              | Background script holds the VSBT in memory               |
| Network MITM on 127.0.0.1 (e.g., proxy injection)  | Token travels over plaintext HTTP on localhost            |

> **Note**: The VSBT is a defense-in-depth layer. It is NOT a replacement for the existing JWT-based session authentication or tier-based capability enforcement. Both remain active and are checked independently.

---

## 5. Implementation Files

| File                                            | Change                                                       |
|-------------------------------------------------|--------------------------------------------------------------|
| `electron/main/vault/service.ts`                | Added `getSessionToken()` method                             |
| `electron/main/vault/rpc.ts`                    | `vault.create` and `vault.unlock` responses include `sessionToken` |
| `electron/main.ts`                              | VSBT Express middleware, WS RPC gate, updated unlock/create/passkey handlers |
| `extension-chromium/src/vault/api.ts`           | VSBT storage/clear helpers, attached to `apiCall` messages   |
| `extension-chromium/src/background.ts`          | Forwards VSBT as `X-Vault-Session` header on HTTP requests   |
| `electron/main/vault/vsbt.test.ts`              | 14 focused tests covering lifecycle, rotation, rejection     |

---

## 6. Testing

### Automated (vitest)

```
npx vitest run electron/main/vault/vsbt.test.ts
```

14 tests covering:
1. `getSessionToken()` returns null when locked
2. `getSessionToken()` returns 64-char hex when unlocked
3. `validateToken()` accepts correct token
4. `validateToken()` rejects wrong token
5. `validateToken()` rejects when locked
6. Old VSBT invalid after lock (replay prevention)
7. VSBT rotates across unlock cycles
8. 100 unlocks produce 100 unique tokens (entropy check)
9. Simulated middleware rejects missing VSBT
10. Simulated middleware rejects incorrect VSBT
11. Simulated middleware accepts correct VSBT
12. Exempt paths correctly identified
13. RPC data methods require VSBT; exempt methods do not
14. Only latest unlock token is valid after rapid re-unlocks

### Manual Smoke Test

1. Start the Electron app.
2. Open a separate terminal and run:
   ```bash
   curl -X POST http://127.0.0.1:51248/api/vault/item/get \
     -H "Content-Type: application/json" \
     -d '{"id":"test"}'
   ```
   **Expected**: `401 — Missing vault session token`

3. Unlock the vault normally via the extension UI.
4. Repeat the curl command:
   **Expected**: `401 — Missing/Invalid vault session token` (no VSBT header)

5. Lock the vault. Attempt any vault endpoint with a previously-captured token:
   **Expected**: `401 — Invalid vault session token`

---

## 7. Non-Goals

- **TLS on localhost**: Out of scope. VSBT assumes the loopback interface is not MITM'd by a network-level adversary (standard threat model for local-first apps).
- **Rate limiting**: Not implemented. VSBT rejection is fast (string comparison) and does not warrant rate limiting at this layer.
- **VSBT persistence**: VSBT is explicitly ephemeral. It must never be written to disk, localStorage, IndexedDB, or chrome.storage.

---

## 8. Relationship to Existing Security Layers

```
Request Flow:

  [Client] → X-Vault-Session header
       │
       ▼
  [Express VSBT Middleware] ← Rejects if token missing/invalid (401)
       │
       ▼
  [Route Handler] → resolveRequestTier() from JWT
       │
       ▼
  [VaultService method] → canAccessCategory(tier, category, action)
       │
       ▼
  [Envelope Crypto] → unwrap DEK → decrypt record
```

The VSBT adds a layer **before** JWT tier resolution and capability checks. This means:
- A hostile process without VSBT is stopped at the outermost gate.
- A process WITH the correct VSBT still faces full tier/capability enforcement.
- Tier is never derived from or influenced by the VSBT.
