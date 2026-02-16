# HARDENING_VSBT_VERIFICATION.md

## Objective

Verify and harden the Vault Session Binding Token (VSBT) implementation so it is high-assurance and applies equally to all tiers (free / pro / publisher / enterprise).

---

## A) HTTP Route Audit — All `/api/vault/*` Endpoints

**Method**: Enumerated every `httpApp.get` / `httpApp.post` call matching `/api/vault/*` in `main.ts`.

**Result**: 28 routes found. 6 exempt, 22 guarded.

### Exempt Endpoints (VSBT not required)

| # | Route | Justification |
|---|-------|---------------|
| 1 | `GET  /api/vault/health` | Health probe; no vault data |
| 2 | `POST /api/vault/status` | Status check; vault may be locked |
| 3 | `POST /api/vault/create` | Establishes session; **returns VSBT** |
| 4 | `POST /api/vault/unlock` | Establishes session; **returns VSBT** |
| 5 | `POST /api/vault/passkey/unlock-begin` | Reads meta while locked |
| 6 | `POST /api/vault/passkey/unlock-complete` | Establishes session; **returns VSBT** |

### Guarded Endpoints (VSBT required — 401 if missing/invalid)

| # | Route |
|---|-------|
| 1 | `POST /api/vault/delete` |
| 2 | `POST /api/vault/lock` |
| 3 | `POST /api/vault/passkey/enroll-begin` |
| 4 | `POST /api/vault/passkey/enroll-complete` |
| 5 | `POST /api/vault/passkey/remove` |
| 6 | `POST /api/vault/items` |
| 7 | `POST /api/vault/item/create` |
| 8 | `POST /api/vault/item/get` |
| 9 | `POST /api/vault/item/update` |
| 10 | `POST /api/vault/item/delete` |
| 11 | `POST /api/vault/item/meta/get` |
| 12 | `POST /api/vault/item/meta/set` |
| 13 | `POST /api/vault/handshake/evaluate` |
| 14 | `POST /api/vault/documents` |
| 15 | `POST /api/vault/document/upload` |
| 16 | `POST /api/vault/document/get` |
| 17 | `POST /api/vault/document/delete` |
| 18 | `POST /api/vault/document/update` |
| 19 | `POST /api/vault/containers` |
| 20 | `POST /api/vault/container/create` |
| 21 | `POST /api/vault/settings/get` |
| 22 | `POST /api/vault/settings/update` |

**Verdict**: **PASS** — No unguarded route found. Middleware registered before all route handlers via `httpApp.use('/api/vault', ...)` at line 3781.

---

## B) WS/RPC — Connection-Bound Handshake (Hardened)

### Gap Found (pre-hardening)

The original implementation used **per-message** `msg.vsbt` validation. This means:
- The VSBT travels in every WS message (increased exposure).
- No server-side connection state — a malicious client could potentially sniff and forward per-message tokens.

### Fix Applied

Replaced per-message validation with a **connection-bound handshake model**:

1. **`wsVsbtBindings`**: Module-level `Map<socket, string>` tracks which socket is bound to which VSBT.
2. **`vault.bind` method**: Authenticated client sends `{ method: 'vault.bind', params: { vsbt } }` once per connection. Server validates and stores the binding.
3. **Auto-binding**: `vault.create` and `vault.unlock` responses auto-bind the VSBT to the calling socket.
4. **Gate check**: All non-exempt vault methods check `wsVsbtBindings.get(socket)` against `vaultService.validateToken()`. No per-message `msg.vsbt` needed.
5. **Cleanup**:
   - `socket.close` → `wsVsbtBindings.delete(socket)`
   - `vault.lock` success → `wsVsbtBindings.clear()` (all sockets invalidated)
   - `lockVaultIfLoaded()` → `wsVsbtBindings.clear()` (covers logout + session-expire)

### RPC Methods and VSBT Requirement

| Method | VSBT Required? | Binding Behavior |
|--------|---------------|-----------------|
| `vault.bind` | N/A (IS the handshake) | Validates + stores binding |
| `vault.create` | Exempt | Auto-binds on success |
| `vault.unlock` | Exempt | Auto-binds on success |
| `vault.getStatus` | Exempt | Read-only status |
| `vault.lock` | **Required** | Clears ALL bindings on success |
| All other `vault.*` | **Required** | Checked from socket binding |

**Verdict**: **PASS** — Connection-bound model implemented. VSBT travels only once (during bind or auto-bind), not in every message.

---

## C) Sensitive Operation Tracing

### HTTP path: `POST /api/vault/item/get`

```
Request arrives
  → Express VSBT middleware (line 3781)
    → Checks X-Vault-Session header
    → Missing/invalid? → 401, return (route handler NEVER called)
    → Valid? → next()
  → Route handler (line 4073)
    → resolveRequestTier()
    → getVaultService()
    → vaultService.getItem(id, tier)  ← only reached if VSBT passed
      → capability check
      → DEK unwrap / decrypt
```

**VaultService.getItem() is unreachable without valid VSBT.**

### WS path: `vault.getItem`

```
Message received
  → Auth gate: ensureSession() + JWT check (line 1812-1821)
  → VSBT gate: wsVsbtBindings.get(socket) + validateToken() (line 1842-1855)
    → Unbound/invalid? → error response, return
    → Bound? → continue
  → handleVaultRPC('vault.getItem', params, tier) (line 1857)
    → vaultService.getItem(id, tier)  ← only reached if bound + auth'd
```

**handleVaultRPC() is unreachable without valid socket binding.**

### WS path: `vault.exportCSV` / `vault.getAutofillCandidates`

Both are NOT in `VSBT_EXEMPT_RPC`, so they require socket binding. They are WS-only (no HTTP route). Same gate logic applies.

**Verdict**: **PASS** — All three operations verified: VSBT rejection happens BEFORE any service call, BEFORE any decrypt.

---

## D) Lifecycle Verification

### Token Creation

| Event | VSBT Generated? | Returned To Client? |
|-------|-----------------|---------------------|
| `vaultService.unlock()` | Yes (via `extensionToken`) | HTTP: `res.json({ sessionToken })` / WS: auto-bind |
| `vaultService.createVault()` | Yes | HTTP: `res.json({ sessionToken })` / WS: auto-bind |
| `vaultService.completePasskeyUnlock()` | Yes | HTTP: `res.json({ sessionToken })` |

### Token Invalidation

| Event | VSBT Cleared? | WS Bindings Cleared? | Code Path |
|-------|---------------|---------------------|-----------|
| `vaultService.lock()` | Yes (`session = null`) | Yes (`wsVsbtBindings.clear()` in vault.lock handler) | rpc.ts:61 → main.ts:1863 |
| `logoutFast()` | Yes (via `lockVaultIfLoaded()`) | Yes (added to `lockVaultIfLoaded()`) | main.ts:20→123→135 |
| Session expire (WS) | Yes (via `lockVaultIfLoaded()`) | Yes | main.ts:2539 |
| Session expire (HTTP) | Yes (via `lockVaultIfLoaded()`) | Yes | main.ts:2911 |
| Socket close | N/A | Yes (socket entry only) | main.ts:1773 |

### Rotation

Each `unlock()` call generates a new `crypto.randomBytes(32).toString('hex')`. Previous token is superseded (VaultService stores only one session at a time).

**Verdict**: **PASS** — Token created on every unlock, cleared on every lock/logout/expire. WS bindings cleared globally.

---

## E) Tier-Agnostic Enforcement

The VSBT middleware checks `X-Vault-Session` header against `vaultService.validateToken()`. The validation is a simple string comparison (`session.extensionToken === token`). It does NOT reference the user's tier at any point.

The WS binding check is identical: `wsVsbtBindings.get(socket)` + `validateToken()`. No tier reference.

Test coverage: 20 tests (5 per tier × 4 tiers) explicitly verify that free, pro, publisher, and enterprise all receive identical VSBT enforcement.

**Verdict**: **PASS** — Security is not an upsell. VSBT applies identically to all tiers.

---

## F) Fixes Applied (Summary)

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | WS VSBT was per-message, not connection-bound | MODERATE | Replaced with `wsVsbtBindings` Map + `vault.bind` handshake + auto-bind |
| 2 | `lockVaultIfLoaded()` did not clear WS bindings | MODERATE | Added `wsVsbtBindings.clear()` to `lockVaultIfLoaded()` |
| 3 | Socket close did not remove its VSBT binding entry | LOW | Added `wsVsbtBindings.delete(socket)` to `socket.on('close')` |
| 4 | `vault.lock` via WS did not invalidate other connections' bindings | MODERATE | Added `wsVsbtBindings.clear()` after successful `vault.lock` RPC |

---

## G) Test Coverage

**File**: `electron/main/vault/vsbt.test.ts`
**Tests**: 49
**All passing**: Yes

### Test Sections

| Section | Tests | Covers |
|---------|-------|--------|
| Token Lifecycle | 9 | Generation, validation, rotation, entropy |
| HTTP Middleware | 5 | 6 exempt paths, 22 guarded paths, missing/wrong/correct header |
| WS Connection-Bound Binding | 10 | vault.bind, auto-bind, lock clears all, close removes entry, re-unlock invalidates |
| Service-not-called (spy) | 5 | VaultService.getItem / handleVaultRPC never reached without VSBT |
| Tier-agnostic | 20 | free/pro/publisher/enterprise × HTTP + WS × blocked/allowed |

---

## H) Files Changed

| File | Change |
|------|--------|
| `electron/main.ts` | Added `wsVsbtBindings` Map; updated `lockVaultIfLoaded()` to clear bindings; updated socket close handler; rewrote WS vault RPC handler to use connection-bound binding with `vault.bind` + auto-bind + global clear on lock |
| `electron/main/vault/vsbt.test.ts` | Expanded from 14 to 49 tests covering all invariants |

No changes to: `service.ts`, `rpc.ts`, `api.ts`, `background.ts`, `types.ts`, or any capability/tier logic.

---

## I) Invariant Checklist

| # | Invariant | Status |
|---|-----------|--------|
| 1 | No `/api/vault/*` endpoint (except 6 exempt) reachable without valid VSBT while unlocked | **PASS** |
| 2 | WS/RPC requires BOTH authenticated session AND VSBT-bound connection | **PASS** |
| 3 | VSBT validation happens BEFORE any route handler, BEFORE any VaultService call, BEFORE any decrypt | **PASS** |
| 4 | VSBT rotates on every unlock/create; cleared on lock/logout/expire | **PASS** |
| 5 | VSBT is in-memory only; never persisted or logged | **PASS** |
| 6 | Behavior identical across all tiers (free/pro/publisher/enterprise) | **PASS** |

**Overall Verdict**: All 6 invariants verified and enforced. Two moderate gaps found (per-message WS VSBT, missing WS binding cleanup on lock) — both fixed.
