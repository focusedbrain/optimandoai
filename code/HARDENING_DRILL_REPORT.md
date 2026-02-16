# HARDENING DRILL REPORT — WRVault Red-Team Audit

**Date:** 2026-02-15
**Auditor role:** Senior Red-Team Security Engineer (adversarial, 15-year local-first encryption background)
**Scope:** Full WRVault codebase — crypto, auth, routing, storage, migration, provider lifecycle
**Threat model:** Local-first. Attacker has filesystem + memory + renderer + API replay capability. Cannot break AES/HKDF/XChaCha primitives directly.

---

## A) Executive Summary

WRVault implements a sound envelope-encryption scheme (KEK/DEK hierarchy, scrypt KDF, AES-256-GCM key wrapping, XChaCha20-Poly1305 record encryption, per-record DEKs).  The HTTP route layer correctly resolves tier per-request, checks capability before decrypt, and enforces lazy decryption for listing operations.

**However, a critical bypass exists.**  The WebSocket RPC handler (`rpc.ts` / `handleVaultRPC`) exposes `vault.getItem`, `vault.listItems`, `vault.createItem`, `vault.updateItem`, `vault.deleteItem`, `vault.search`, `vault.getAutofillCandidates`, `vault.exportCSV`, and `vault.importCSV` — all **without any tier or capability check**.  Any process on 127.0.0.1 that connects to the WebSocket can decrypt, exfiltrate, or modify any record regardless of subscription tier.  This single finding invalidates the capability-gate invariant.

Additionally, `getAutofillCandidates()` performs bulk decryption of all password-category records (including parsing `fields_json` directly), violating the lazy-decrypt invariant.  `exportCSV()` bulk-decrypts every record in the vault.

The HTTP endpoint `/api/vault/item/meta/get` lacks a capability check — any tier can read any item's binding-policy metadata.

Structural crypto and session management is solid.  KEK zeroization on lock is correct.  Challenge-based passkey replay protection works.  Tier resolution per-request prevents stale-tier attacks.  Atomic writes protect meta files.

**Bottom line:** The HTTP surface is hardened.  The WebSocket surface is wide open.  Until the RPC path is gated, the vault cannot be considered enterprise-grade.

---

## B) Confirmed Secure Invariants

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| B1 | KEK never stored in plaintext on disk | **SECURE** | KEK derived from scrypt (passphrase) or unwrapped from HKDF(PRF) (passkey). Only `wrappedKEK` stored in meta JSON. `service.ts:lock()` zeroizes both KEK and DEK buffers. |
| B2 | DEK unwrapped only after capability check (HTTP path) | **SECURE** | `getItem(id, tier)` checks `canAccessCategory()` before calling `openRecord()`. `service.ts:1004-1008`. |
| B3 | No bulk decrypt in `listItems()` | **SECURE** | `listItems()` SQL query selects only metadata columns; returns `fields: []` for all schema versions. `service.ts:1060,1129`. |
| B4 | No bulk decrypt in `search()` | **SECURE** | `search()` SQL query excludes encrypted columns; returns `fields: []`. `service.ts:1159,1177`. |
| B5 | Atomic writes protect meta file | **SECURE** | `atomicWriteFileSync()` uses write-tmp -> fsync -> rename. `atomicWrite.ts:1-35`. |
| B6 | Tier resolved per-request (HTTP path) | **SECURE** | `resolveRequestTier()` calls `ensureSession()` → `resolveTier()` from fresh JWT claims. All 17 vault HTTP handlers call it. `main.ts:98-107`. |
| B7 | Logout locks vault | **SECURE** | `logoutFast()` calls `lockVaultIfLoaded()` as first action (line 24-25 of main.ts). Session-expire detection in both WS and HTTP auth-status handlers also calls it. |
| B8 | Passkey challenge cannot be replayed | **SECURE** | `ChallengeStore.consume()` is one-time-use with TTL. `completePasskeyEnroll()` and `completePasskeyUnlock()` both consume challenge as first step. `service.ts:399, challengeStore.ts`. |
| B9 | KEK lifetime bounded to unlock session | **SECURE** | `lock()` zeroizes `session.kek` and `session.vmk`, flushes decrypt cache, calls `provider.lock()`. `service.ts:305-347`. |
| B10 | Provider registry is compile-time only | **SECURE** | `PROVIDER_REGISTRY` in `unlockProvider.ts` is a `const` record with factory functions. No runtime mutation API exists. |
| B11 | Free cannot create Pro record types (HTTP path) | **SECURE** | `/api/vault/item/create` calls `canAccess(tier, category, 'write')` before `createItem()`. `main.ts:3911-3915`. |
| B12 | Schema downgrade impossible | **SECURE** | `updateItem()` always writes `schema_version = ENVELOPE_SCHEMA_VERSION (2)`. No path writes version 1. `service.ts:951`. |
| B13 | HTTP + WS bound to 127.0.0.1 only | **SECURE** | `httpApp.listen(port, '127.0.0.1')` at main.ts:5589. WebSocket: `new WebSocketServer({ host: '127.0.0.1', port })` at main.ts:1737. |
| B14 | Partial migration cannot expose plaintext in listings | **SECURE** | `listItems()` never reads `fields_json`, `wrapped_dek`, or `ciphertext` columns — SQL query explicitly selects only metadata. `service.ts:1060`. |

---

## C) Attack Attempts and Results

### CRITICAL

| # | Attack Vector | Code Path | Result | Root Cause |
|---|---------------|-----------|--------|------------|
| C1 | **Tier bypass via WebSocket RPC `vault.getItem`** — Connect to WS on 127.0.0.1, send `{ method: "vault.getItem", params: { id: "<pro-only-item>" } }`. | `main.ts:1807` → `handleVaultRPC()` → `rpc.ts` → `vaultService.getItem(id)` (NO tier param) → `service.ts:1004`: `if (tier)` is false → capability check SKIPPED → `openRecord()` decrypts record. | **SUCCESS** | `handleVaultRPC` never resolves or passes tier. `getItem()` tier param is optional; when omitted, capability check is bypassed entirely. |
| C2 | **Tier bypass via WebSocket RPC CRUD** — Same WS channel: `vault.createItem` with `category: "password"` from free-tier user. Or `vault.updateItem`, `vault.deleteItem` for any record. | `rpc.ts:104-118` → `vaultService.createItem(data)`, `updateItem(id, updates)`, `deleteItem(id)` — NONE check capability in service layer. | **SUCCESS** | Capability check for create/update/delete exists ONLY in HTTP route handlers, not in the service methods themselves. RPC bypasses the HTTP layer entirely. |
| C3 | **Bulk decrypt via `vault.exportCSV` RPC** — Send `{ method: "vault.exportCSV" }` over WS. | `rpc.ts:155` → `vaultService.exportCSV()` → calls `this.listItems()` then `this.getItem(item.id)` for EVERY item without tier. `service.ts:1509-1551`. | **SUCCESS** | `exportCSV()` decrypts all records. No capability gating. Exposed via RPC. Returns full plaintext CSV of entire vault. |
| C4 | **Bulk decrypt via `vault.getAutofillCandidates` RPC** — Send `{ method: "vault.getAutofillCandidates", params: { domain: "%" } }`. | `rpc.ts:140` → `vaultService.getAutofillCandidates("%")` → `service.ts:1187-1217`: queries `SELECT * FROM vault_items WHERE category = 'password'`, then `JSON.parse(row.fields_json)` + `this.decryptItemFields()` for EVERY match. | **SUCCESS** | `getAutofillCandidates()` bulk-decrypts. No tier check. Parses `fields_json` directly (legacy v1 path). Violates both lazy-decrypt and capability-gate invariants. |
| C5 | **Unvalidated import via `vault.importCSV` RPC** — Send `{ method: "vault.importCSV", params: { csvData: "..." } }` with rows of any category. | `rpc.ts:161` → `vaultService.importCSV(csvData)` → `service.ts:1557-1608`. Creates items of ANY category (password, document, handshake_context) without capability check. | **SUCCESS** | `importCSV()` calls `createItem()` for each row. No capability gating in service layer. |

### MODERATE

| # | Attack Vector | Code Path | Result | Root Cause |
|---|---------------|-----------|--------|------------|
| C6 | **Meta read without capability check (HTTP)** — `POST /api/vault/item/meta/get { id: "<handshake-context-id>" }` from a free-tier user. | `main.ts` (vault/item/meta/get handler) → `vaultService.getItemMeta(id)` — handler does NOT call `resolveRequestTier()` and does NOT check `canAccessCategory()`. | **SUCCESS** | The `/api/vault/item/meta/get` HTTP route has no tier resolution or capability gating. Any authenticated user can read any item's meta (binding policies, domain bindings, etc.). |
| C7 | **Local process exfiltration while vault is unlocked** — Any process on localhost can connect to the HTTP API (port is discoverable) and call `/api/vault/item/get` with a valid session. | `main.ts` HTTP routes. No per-request authentication token. Tier is resolved from session JWT (Keycloak), but the HTTP server has no caller-identity verification. | **PARTIAL** | HTTP server has no request-level auth (no bearer token, no CORS enforcement for non-browser clients). Mitigated by: (a) 127.0.0.1 binding, (b) vault must be unlocked, (c) tier still resolved per-request. Risk: any local malware can call the API if it finds the port. |
| C8 | **`clearSession()` does not clear `cachedUserInfo`** — After logout, `getCachedUserInfo()` returns stale roles/plan. | `session.ts:248-251`: only clears `accessToken` and `expiresAt`. `cachedUserInfo` retains previous roles until next `ensureSession()` refresh. | **PARTIAL** | `resolveRequestTier()` calls `ensureSession()` which returns `accessToken: null` after logout, so tier resolves to `DEFAULT_TIER`. The stale `cachedUserInfo` is a data hygiene issue, not a direct exploit. However, if any code path reads `getCachedUserInfo()` directly for authorization, it would see stale elevated roles. |

### LOW / INFORMATIONAL

| # | Attack Vector | Code Path | Result | Notes |
|---|---------------|-----------|--------|-------|
| C9 | **DecryptCache holds plaintext in V8 heap** — Memory dump while vault is unlocked reveals up to 16 recently-decrypted record field sets as JS strings. | `cache.ts:55-73`. `evict()` sets `entry.value = ''` but original string is immutable in V8 — GC must collect it. | **PARTIAL** | Known trade-off documented in `cache.ts:7-17`. TTL=60s, max 16 entries. `flush()` called on lock. JS strings cannot be zeroized. Acceptable under local-first model if lock is prompt. |
| C10 | **Zeroization not guaranteed by V8 runtime** — `zeroize(buffer)` uses `randomBytes().copy()` + `buffer.fill(0)`. JIT could optimize away the fill. | `crypto.ts:219-227`. | **PARTIAL** | Node.js Buffer.fill(0) is generally effective (backed by C++ ArrayBuffer). The `randomBytes` pre-fill adds defense-in-depth. No V8 optimization of Buffer.fill has been observed in practice. Would benefit from a `crypto.timingSafeEqual`-style guaranteed-write primitive if available. |
| C11 | **Windows: `renameSync` not fully atomic** — On NTFS, `renameSync` can fail if target is locked (antivirus, indexer). | `atomicWrite.ts:20-21`. | **PARTIAL** | On POSIX (Linux/macOS), rename is atomic. On Windows, failure leaves `.tmp` file alongside original — original is untouched. Recovery: check for `.tmp` on startup. Not a data-loss risk, but a liveness risk. |
| C12 | **`fields_json` still written alongside envelope columns** — `createItem` stores `'[]'` in `fields_json` (service.ts:864). `updateItem` stores `'[]'`. Legacy v1 rows retain their original `fields_json` until migrated. | `service.ts:865,945`. | **INFORMATIONAL** | Not a vulnerability — v2 items store `'[]'` (empty), and encrypted data is in `ciphertext`. But legacy v1 rows with encrypted `fields_json` (per-field XChaCha20) are readable with DEK+HKDF. Migration converts them to v2 envelope format. |
| C13 | **PRF salt stored in plaintext meta file** — `prfSalt` and `wrappedKEK` are in the JSON meta file alongside vault. | `service.ts:426-434`, meta file. | **INFORMATIONAL** | By design — meta must be readable when locked to initiate passkey ceremony. `wrappedKEK` is encrypted with HKDF(PRF output, prfSalt). Without the authenticator's PRF output (requires biometric/PIN), `wrappedKEK` cannot be unwrapped. Acceptable under threat model. |
| C14 | **Passphrase unlock has no challenge-response** — Password sent in cleartext over HTTP to 127.0.0.1. | `POST /api/vault/unlock { password }`. | **FAIL (benign)** | 127.0.0.1 traffic is not routable. Local TLS would add complexity with no security benefit under local-first model. Rate limiting exists (`unlockAttempts`). |
| C15 | **Tier escalation via crafted JWT claims** — Inject `wrdesk_plan: "enterprise"` into a forged JWT. | `session.ts:155-204` → `decodeJwtPayload()` → `extractUserInfo()`. | **FAIL** | JWT is obtained from Keycloak token refresh. `decodeJwtPayload()` is used AFTER verification by Keycloak during the refresh flow. An attacker cannot inject claims without a valid Keycloak refresh token. `resolveTier()` only reads from the Keycloak-issued JWT. |
| C16 | **Schema downgrade: force `schema_version = 1` on a v2 record** — Direct SQLite write (requires filesystem access + DEK to open the encrypted DB). | SQLCipher database is encrypted with DEK. | **FAIL** | Attacker needs DEK to open the database. If they have the DEK, they already have full access — schema downgrade adds nothing. The application always writes v2 and the `openRecord` path validates the AES-GCM auth tag. |
| C17 | **Crash mid-meta-write corrupts vault state** — Kill process during `updateProvidersMeta()`. | `atomicWrite.ts` → write to `.tmp` → fsync → rename. | **FAIL** | If crash before rename: original meta file is intact. If crash after rename: new file is complete (fsync'd). `.tmp` file is orphaned but harmless. |
| C18 | **Stale tier used after downgrade** — User's plan changes from Pro to Free server-side. Next vault API call should reflect Free. | `resolveRequestTier()` → `ensureSession()` → reads fresh JWT → `resolveTier()`. | **FAIL** | Per-request tier resolution. When token expires (60s buffer), `ensureSession()` refreshes from Keycloak, getting new claims. Worst case: stale for up to token lifetime (typically 5-15 min). |
| C19 | **Replay passkey unlock with captured PRF output + challenge** — Intercept `passkeyUnlockComplete` payload, replay it. | `service.ts:529-531` → `this.challengeStore.consume(challengeBase64)` — returns false on second use. | **FAIL** | Challenge is consumed (deleted) on first use. Replay returns `false` → throws "Invalid or expired unlock challenge". TTL prevents long-lived challenges. |

---

## D) Confirmed Weak Points

### D1 — CRITICAL: WebSocket RPC Path Bypasses All Capability Gates

**Severity:** Critical
**CVSS estimate:** 8.1 (High — local, authenticated, data exfiltration + integrity violation)

**Root cause:** `rpc.ts:handleVaultRPC()` dispatches directly to `VaultService` methods without resolving tier or checking capabilities. The service methods (`getItem`, `createItem`, `updateItem`, `deleteItem`, `listItems`, `search`, `getAutofillCandidates`, `exportCSV`, `importCSV`) do not enforce capability checks internally — they rely on the caller (HTTP route handler) to do so.

**Exploitable paths:**
- `vault.getItem` → decrypts any record (free user reads Pro-only data)
- `vault.createItem` → creates any category (free user creates password/document/handshake records)
- `vault.updateItem` → modifies any record
- `vault.deleteItem` → deletes any record
- `vault.exportCSV` → bulk-decrypts entire vault to CSV
- `vault.getAutofillCandidates` → bulk-decrypts all password records
- `vault.importCSV` → inserts records of any category
- `vault.search` → searches all records (metadata only, but no tier filter)

**Impact:** Complete bypass of the tier/capability model. Any local process on 127.0.0.1 can exfiltrate the entire vault (while unlocked) via a single `vault.exportCSV` RPC call.

### D2 — MODERATE: `/api/vault/item/meta/get` Missing Capability Check

**Severity:** Moderate
**Root cause:** The HTTP handler for `POST /api/vault/item/meta/get` does not call `resolveRequestTier()` or check `canAccessCategory()`. Any authenticated user can read binding-policy metadata for any item, including Publisher-only handshake context items.

**Impact:** Information disclosure of binding policies (allowed domains, TTL, share flags). Not a direct data exfiltration (no encrypted fields exposed), but reveals organizational policy data that should be gated.

### D3 — MODERATE: `getAutofillCandidates()` Violates Lazy Decrypt

**Severity:** Moderate (in context of D1, this is already exploitable via RPC; independently, the method exists even if not yet called from HTTP routes)
**Root cause:** `getAutofillCandidates()` calls `JSON.parse(row.fields_json)` and `decryptItemFields()` for every matching row — a bulk-decrypt path that bypasses envelope encryption for v1 records and has no capability check.

---

## E) Immediate Patch Recommendations (Prioritized)

### P1 — [CRITICAL] Gate the WebSocket RPC path with per-request tier resolution

**Smallest fix:** In `handleVaultRPC()` (or in `main.ts` at the WS dispatch site, line 1807), resolve the tier BEFORE dispatching, and pass it to every service method that touches data. Alternatively, add a `tier` parameter to all service methods and make it required (not optional).

**Preferred structural fix:** Move capability checks INTO the service methods themselves (defense-in-depth). `getItem()` should REQUIRE tier, not accept it optionally. `createItem()`, `updateItem()`, `deleteItem()` should accept tier and gate internally. This way, no caller can accidentally omit the check.

```typescript
// rpc.ts — at the top of handleVaultRPC:
const tier = await resolveRequestTier()  // or inject via parameter

// Then for every case:
case 'vault.getItem': {
  const { id } = GetItemRequestSchema.parse(params)
  const item = await vaultService.getItem(id, tier)  // tier is now mandatory
  return { success: true, item }
}
```

**Estimated effort:** ~2 hours. Affects `rpc.ts` + service method signatures.

### P2 — [CRITICAL] Remove or gate `exportCSV` and `importCSV` from RPC

**Smallest fix:** Either (a) remove `vault.exportCSV` and `vault.importCSV` cases from `handleVaultRPC`, or (b) add tier-gated capability checks before calling them. Export should also respect tier filtering (only export records the user can access).

### P3 — [CRITICAL] Rewrite `getAutofillCandidates()` to respect envelope encryption and capability

**Smallest fix:** `getAutofillCandidates()` should:
1. Check `canAccessCategory(tier, 'password', 'read')` before any decrypt.
2. Use `getItem(id, tier)` instead of manual `JSON.parse(fields_json)` + `decryptItemFields()`.
3. Or return metadata-only and let the caller decrypt lazily.

### P4 — [MODERATE] Add capability check to `/api/vault/item/meta/get`

**Smallest fix:**
```typescript
httpApp.post('/api/vault/item/meta/get', async (req, res) => {
  try {
    const tier = await resolveRequestTier()
    const vaultService = await getVaultService()
    const { id } = req.body
    if (!id) { ... }
    const category = vaultService.getItemCategory(id)
    const { canAccessCategory: canAccess } = await getVaultCapHelpers()
    if (!canAccess(tier, category, 'read')) {
      res.status(403).json({ ... })
      return
    }
    const meta = vaultService.getItemMeta(id)
    res.json({ success: true, data: meta })
  }
})
```

### P5 — [LOW] Clear `cachedUserInfo` in `clearSession()`

**Smallest fix:** Add `cachedUserInfo = null` to `clearSession()` in `session.ts`.

### P6 — [LOW] Add `.tmp` recovery check on vault meta load

**Smallest fix:** In `loadVaultMetaRaw()`, check for a `.tmp` file. If it exists and the original is missing, rename `.tmp` → original. If both exist, delete `.tmp` (original is authoritative since rename didn't complete).

---

## F) Final Classification

### Military-grade under local-first model: **NO**

**Justification:** The WebSocket RPC bypass (D1) provides a complete, unauthenticated (within localhost) path to exfiltrate the entire vault. Military-grade systems require zero bypass paths, defense-in-depth at every layer, and formal verification of access control invariants. The current system has correct crypto but incomplete access control enforcement — the HTTP surface is hardened while the WebSocket surface is wide open.

### Enterprise-grade: **NO (conditional — YES after P1-P4)**

**Justification:** The capability model is well-designed and correctly implemented on the HTTP surface. Tier resolution is per-request, capability checks happen before decrypt, lazy decryption prevents bulk exposure, and session teardown zeroizes keys. However, the RPC bypass (D1) and the missing meta-read gate (D2) violate the "fail-closed before decrypt" invariant that enterprise environments require.

**After applying patches P1 through P4:** The system would meet enterprise-grade requirements under a local-first threat model. The crypto primitives are sound (scrypt, AES-256-GCM, XChaCha20-Poly1305), the key hierarchy is correct, and the defense-in-depth structure (KEK/DEK separation, per-record DEKs, capability-before-decrypt) is architecturally solid.

### Ready for regulated environments: **NO (conditional — YES after P1-P4 + audit trail)**

**Justification:** Regulated environments (GDPR, HIPAA, SOC 2) require:
1. No bypass paths for access control — **FAILS** (D1).
2. Complete audit logging of data access — **NOT PRESENT** (no persistent audit log of who accessed which records).
3. Verifiable capability enforcement — **FAILS** on RPC path.

After patches and addition of an access audit trail, the system would be suitable for regulated data handling under the local-first model.

---

*Report prepared under adversarial assumptions. All findings reference specific code paths. Opinions are evidence-backed.*
