# WRVault — Extended High-Assurance Security Audit Report

**Auditor posture:** External, adversarial, zero trust in prior summaries.  
**Date:** 2026-02-16  
**Scope:** Full code read of all vault modules after the RPC authorization fix.  
**Methodology:** Manual static analysis of every decrypt call site, every public entry point, every tier resolution, every session lifecycle event.

---

## A) Executive Summary

WRVault now enforces the "gate before decrypt" invariant across **both** the HTTP
API and the WebSocket RPC surface.  Every `VaultService` data method that touches
cryptographic material (`getItem`, `createItem`, `updateItem`, `deleteItem`,
`exportCSV`, `importCSV`, `getAutofillCandidates`, `getItemMeta`, `setItemMeta`)
requires `tier: VaultTier` as a **mandatory** TypeScript parameter — omitting it
is a compile-time error.  The RPC dispatcher in `rpc.ts:39` passes the
server-resolved tier from `main.ts:1807-1821` into every call.  Unauthenticated
RPC requests are rejected at `main.ts:1809`.

The one remaining decrypt path without an externally-enforced tier check is the
**internal migration path** (`migrateItemToV2`), which is fire-and-forget from
`listItems` — it reads the raw DB row and re-encrypts it without capability
gating.  This is architecturally correct (migration is a system operation, not
a user data-access operation), but a future developer could misuse it.

Document operations (`importDocument`, `getDocument`, `listDocuments`,
`deleteDocument`, `updateDocumentMeta`) enforce capability checks inside the
`documentService.ts` functions before any `sealRecord`/`openRecord` call.

No bulk-decrypt path exists.  `listItems()` and `search()` return `fields: []`.
`exportCSV()` filters by capability before calling `getItem(id, tier)`.
`getAutofillCandidates()` was rewritten to use `getItem(id, tier)` per-record.

KEK and DEK are zeroized on `lock()`.  The decrypt cache is flushed before keys
are destroyed.  Logout triggers `lockVaultIfLoaded()` before clearing the session.
Session expiration in both the WS `AUTH_STATUS` handler and the HTTP `/api/auth/status`
handler also triggers `lockVaultIfLoaded()`.

Tier is resolved per-request from JWT claims via `resolveRequestTier()` (HTTP)
or `ensureSession()` + `resolveTier()` (RPC).  The module-level `currentTier`
variable is documented as display-only and is never used for access control.

---

## B) Decrypt Graph Table (Section 1)

Every call site in the codebase that performs a cryptographic decrypt or unwrap
operation, traced to its public entry point:

| # | Decrypt Call Site | Parent Function | Entry Point(s) | Tier Required? | Pre-Cap Check? | Verdict |
|---|---|---|---|---|---|---|
| 1 | `openRecord(wrappedDEK, ciphertext, kek)` | `VaultService.getItem()` (service.ts:1041) | HTTP `/api/vault/item/get`, RPC `vault.getItem` | YES — `tier: VaultTier` (mandatory) | YES — `canAccessCategory()` at line 1022 | **PASS** |
| 2 | `this.decryptItemFields(id, fields)` | `VaultService.getItem()` (service.ts:1044) | Same as #1 (legacy v1 path) | YES — same | YES — same check at line 1022 | **PASS** |
| 3 | `sealRecord(fieldsJson, kek)` | `VaultService.createItem()` (service.ts:851) | HTTP `/api/vault/item/create`, RPC `vault.createItem` | YES — `tier: VaultTier` (mandatory) | YES — `canAccessCategory()` at line 830 | **PASS** |
| 4 | `sealRecord(fieldsJson, kek)` | `VaultService.updateItem()` (service.ts:945) | HTTP `/api/vault/item/update`, RPC `vault.updateItem` | YES — `tier: VaultTier` (mandatory) | YES — `canAccessCategory()` at line 923 | **PASS** |
| 5 | `this.getItem(item.id, tier)` | `VaultService.exportCSV()` (service.ts:1556) | RPC `vault.exportCSV` | YES — `tier: VaultTier` (mandatory) | YES — pre-filtered at 1547 + getItem's internal check | **PASS** |
| 6 | `this.getItem(row.id, tier)` | `VaultService.getAutofillCandidates()` (service.ts:1233) | RPC `vault.getAutofillCandidates` | YES — `tier: VaultTier` (mandatory) | YES — `canAccessCategory()` at line 1218 + getItem's internal check | **PASS** |
| 7 | `this.createItem({...}, tier)` | `VaultService.importCSV()` (service.ts:1640) | RPC `vault.importCSV` | YES — tier passed through to createItem | YES — createItem's internal check at line 830 | **PASS** |
| 8 | `openRecord(wrappedDEK, ciphertext, kek)` | `getDocument()` (documentService.ts:225) | HTTP `/api/vault/document/get` | YES — `tier: VaultTier` (mandatory) | YES — `canAccessRecordType()` at line 209 | **PASS** |
| 9 | `sealRecord(contentStr, kek)` | `importDocument()` (documentService.ts:166) | HTTP `/api/vault/document/upload` | YES — `tier: VaultTier` (mandatory) | YES — `canAccessRecordType()` at line 126 | **PASS** |
| 10 | `this.decryptItemFields(id, fields)` | `VaultService.migrateItemToV2()` (service.ts:1314) | Internal — fire-and-forget from `listItems()` | NO — no tier param | NO — migration is a system operation | **FINDING** |
| 11 | `sealRecord(fieldsJson, kek)` | `VaultService.migrateItemToV2()` (service.ts:1318) | Internal — same as #10 | NO — same | NO — same | **FINDING** |
| 12 | `wrapDEK(kek, wrappingKey)` | `VaultService.completePasskeyEnroll()` (service.ts:421) | HTTP `/api/vault/passkey/enroll-complete` | YES — tier passed as string | YES — `requireProTier()` at line 396 | **PASS** |
| 13 | `unwrapDEK(wrappedKEK, wrappingKey)` | `PasskeyUnlockProvider.unlock()` (unlockProvider.ts:329) | HTTP `/api/vault/passkey/unlock-complete` | YES — tier at service.ts:526 | YES — `requireProTier()` at line 526 | **PASS** |
| 14 | `unwrapDEK(meta.wrappedDEK, kek)` | `PassphraseUnlockProvider.unlock()` (unlockProvider.ts:215) | HTTP `/api/vault/unlock`, RPC `vault.unlock` | N/A (unlock establishes session, not data access) | N/A | **PASS** |
| 15 | `deriveFieldKey()` + `decryptField()` | `VaultService.decryptItemFields()` (service.ts:1789-1792) | Only called from `getItem()` or `migrateItemToV2()` | Depends on caller | Depends on caller (#1/#2 = PASS, #10 = FINDING) | **CONDITIONAL** |

### Finding: migrateItemToV2 (rows 10-11)

`migrateItemToV2()` decrypts a v1 record and re-encrypts as v2 without a tier check.  This is called fire-and-forget from `listItems()` at service.ts:1154.  The method is `private` (not exposed via RPC or HTTP) and takes no tier parameter.  It reads only the KEK from `this.session.kek` (which requires the vault to be unlocked).

**Risk level:** LOW.  The method is private, not callable externally, and does not return decrypted data to any caller — it only re-encrypts in-place.  The plaintext exists transiently in a local variable and is sealed immediately.  However, a future developer could accidentally make this public or call it from an unsafe context.

**Recommendation:** Add a code comment documenting that this is intentionally ungated, or alternatively require tier as a parameter but pass a synthetic "system" tier.

---

## C) RPC Surface Table (Section 3)

Every RPC method in `handleVaultRPC` (`rpc.ts`), with auth/tier verification status:

| RPC Method | Auth Required? | Tier Resolved? | Tier Passed to Service? | Verdict |
|---|---|---|---|---|
| `vault.create` | YES (main.ts:1808) | YES (main.ts:1817) | N/A (vault creation, no data access) | **PASS** |
| `vault.unlock` | YES | YES | N/A (unlock path) | **PASS** |
| `vault.lock` | YES | YES | N/A (lock, no data access) | **PASS** |
| `vault.getStatus` | YES | YES | N/A (metadata only) | **PASS** |
| `vault.createContainer` | YES | YES | Not passed (containers have no per-category gating) | **PASS** |
| `vault.updateContainer` | YES | YES | Not passed (same) | **PASS** |
| `vault.deleteContainer` | YES | YES | Not passed (same) | **PASS** |
| `vault.listContainers` | YES | YES | Not passed (same) | **PASS** |
| `vault.createItem` | YES | YES | YES — `createItem(data, tier)` rpc.ts:103 | **PASS** |
| `vault.updateItem` | YES | YES | YES — `updateItem(id, updates, tier)` rpc.ts:109 | **PASS** |
| `vault.deleteItem` | YES | YES | YES — `deleteItem(id, tier)` rpc.ts:115 | **PASS** |
| `vault.getItem` | YES | YES | YES — `getItem(id, tier)` rpc.ts:121 | **PASS** |
| `vault.listItems` | YES | YES | YES — `listItems(filters, tier)` rpc.ts:127 | **PASS** |
| `vault.search` | YES | YES | YES — `search(query, category, tier)` rpc.ts:133 | **PASS** |
| `vault.getAutofillCandidates` | YES | YES | YES — `getAutofillCandidates(domain, tier)` rpc.ts:139 | **PASS** |
| `vault.updateSettings` | YES | YES | Not passed (settings, no record data) | **PASS** |
| `vault.getSettings` | YES | YES | Not passed (same) | **PASS** |
| `vault.exportCSV` | YES | YES | YES — `exportCSV(tier)` rpc.ts:159 | **PASS** |
| `vault.importCSV` | YES | YES | YES — `importCSV(csvData, tier)` rpc.ts:165 | **PASS** |

### Auth gate verification (main.ts:1807-1821):

```
const rpcSession = await ensureSession()
if (!rpcSession.accessToken) {
  // reject with error — fail-closed
  return
}
const rpcTier = resolveTier(rpcSession.userInfo?.wrdesk_plan, ...)
const response = await handleVaultRPC(msg.method, msg.params, rpcTier)
```

**No diagnostic or internal bypass methods exist.**  The `default:` case returns `{ success: false, error: 'Unknown method' }`.  There is no `vault.admin.*` or `vault.internal.*` namespace.

### Simulated attack attempts:

| Attack | Path | Result |
|---|---|---|
| RPC with no session (expired token) | main.ts:1809 `!rpcSession.accessToken` check | **BLOCKED** — `'Authentication required'` |
| Forged tier in client payload | Tier is resolved server-side from JWT, not from `msg.params` | **BLOCKED** — client cannot influence tier value |
| Direct localhost WebSocket | Connects to WS, sends `vault.getItem` — `ensureSession()` called, requires valid Keycloak refresh token | **BLOCKED** if no valid session; **ALLOWED** at user's actual tier if session exists |

---

## D) PASS/FAIL Checklist — Sections 1–8

### Section 1 — Call-Site & Decrypt Graph

| Check | Status |
|---|---|
| All `openRecord` calls preceded by capability check | **PASS** (except internal migration — LOW risk) |
| All `sealRecord` calls preceded by capability check | **PASS** (except internal migration — LOW risk) |
| All `decryptField` calls preceded by capability check | **PASS** (called only from `getItem` or `migrateItemToV2`) |
| `unwrapDEK` / `unwrapRecordDEK` preceded by check | **PASS** (unwrap happens inside `openRecord`/`getItem`, after check) |
| `tier` is non-optional in all public data methods | **PASS** — TypeScript enforced |
| No decrypt path reachable from RPC without tier | **PASS** |
| No decrypt path reachable from HTTP without tier | **PASS** |

**Section 1 overall: PASS** (with one LOW-risk informational finding on migration)

### Section 2 — Tier Resolution & Staleness

| Check | Status |
|---|---|
| Tier resolved per-request in HTTP handlers | **PASS** — `resolveRequestTier()` called in each handler |
| Tier resolved per-request in RPC handler | **PASS** — `ensureSession()` + `resolveTier()` at main.ts:1808-1820 |
| No service method uses global `currentTier` | **PASS** — `currentTier` (main.ts:87) is display-only, never passed to service |
| `resolveRequestTier()` calls `ensureSession()` which refreshes token | **PASS** — session.ts:155-204 returns fresh JWT claims |
| Tier downgrade between requests propagates immediately | **PASS** — each request calls `ensureSession()` → fresh JWT → fresh `resolveTier()` |

**Simulated downgrade:**
1. Request 1: `ensureSession()` returns JWT with `wrdesk_plan: 'pro'` → `resolveTier()` → `'pro'` → `getItem(id, 'pro')` → allowed for `password` category.
2. Server-side plan change: Keycloak admin removes `pro` plan.
3. Request 2: `ensureSession()` detects token near expiry or calls `refreshWithKeycloak()` → fresh JWT with `wrdesk_plan: 'free'` → `resolveTier()` → `'free'` → `getItem(id, 'free')` → throws `Tier "free" cannot read category "password"`.

**Staleness window:** Between JWT expiry buffer (60s before expiry, the token is refreshed — session.ts:157). During this window, the cached token's claims are authoritative. If the plan was downgraded server-side less than 60s before token expiry, the old tier persists until refresh. This is inherent to JWT-based auth and not a code defect.

**Section 2 overall: PASS**

### Section 3 — RPC Surface & Localhost Abuse

| Check | Status |
|---|---|
| All RPC methods require authenticated session | **PASS** — main.ts:1808-1815 |
| All data-touching RPC methods pass resolved tier | **PASS** — see table in Section C |
| No diagnostic/internal method bypass | **PASS** — `default:` returns error |
| No session → rejected | **PASS** |
| Forged tier → impossible | **PASS** (server-resolved) |
| Direct WS client → auth-gated | **PASS** (requires valid Keycloak session) |

**Residual risk:** Any local process that has a valid Keycloak session (same user) can make vault requests at the user's own tier.  This is by-design for the extension communication model but would be a risk on shared workstations.  Mitigation: the WS connection itself is `127.0.0.1`-only.

**Section 3 overall: PASS**

### Section 4 — Bulk Decrypt Invariant

| Check | Status | Evidence |
|---|---|---|
| `listItems()` does not decrypt content | **PASS** | service.ts:1144 — `fields: []` for all rows. SQL query at 1075 does not SELECT `fields_json`, `wrapped_dek`, or `ciphertext`. |
| `search()` does not decrypt content | **PASS** | service.ts:1179 SQL selects only metadata columns. Line 1197: `fields: [] as Field[]`. |
| `exportCSV(tier)` only decrypts allowed records | **PASS** | service.ts:1547 pre-filters by `canAccessCategory(tier, ...)`, then 1556 calls `this.getItem(item.id, tier)` per-record which enforces its own check. |
| `getAutofillCandidates(domain, tier)` uses per-record `getItem(id, tier)` | **PASS** | service.ts:1225 SQL selects only `id`. Line 1233 calls `this.getItem(row.id, tier)`. No `decryptItemFields()` call. |

**Section 4 overall: PASS**

### Section 5 — Session & Lock Behavior

| Check | Status | Evidence |
|---|---|---|
| `logoutFast()` triggers vault lock | **PASS** | main.ts:20-25: `lockVaultIfLoaded()` called first |
| Session expiration triggers lock (WS path) | **PASS** | main.ts:2472-2475: `if (!loggedIn && hasValidSession) lockVaultIfLoaded()` |
| Session expiration triggers lock (HTTP path) | **PASS** | main.ts:2844-2847: same pattern |
| After lock, `getItem()` fails | **PASS** | `ensureUnlocked()` at service.ts:1010 checks `!this.session || !this.db` |
| KEK is zeroized on lock | **PASS** | service.ts:326-327: `zeroize(this.session.kek)` |
| DEK/VMK is zeroized on lock | **PASS** | service.ts:323-325: `zeroize(this.session.vmk)` |
| Provider's cached KEK is zeroized | **PASS** | service.ts:331-333: `this.provider.lock()` → PassphraseUnlockProvider.lock() at unlockProvider.ts:225-230 |
| Decrypt cache flushed on lock | **PASS** | service.ts:314: `this.decryptCache.flush()` called BEFORE zeroize |
| Session set to null on lock | **PASS** | service.ts:337: `this.session = null` |
| DB handle closed on lock | **PASS** | service.ts:317-320: `closeVaultDB(this.db); this.db = null` |

**Section 5 overall: PASS**

### Section 6 — Meta File & Provider State Resilience

| Check | Status | Evidence |
|---|---|---|
| Meta writes use atomic write | **PASS** | service.ts:625: `atomicWriteFileSync(metaPath, ...)`. Also service.ts:1865 for initial save. |
| Atomic write = write-tmp → fsync → rename | **PASS** | atomicWrite.ts:18-33: `writeFileSync(tmpPath)` → `fsyncSync(fd)` → `renameSync(tmpPath, targetPath)` |
| Partial write leaves original intact | **PASS** | If crash occurs during `writeFileSync(tmpPath)` or `fsyncSync`, only `.tmp` is affected. Original meta file untouched. |
| Vault does not brick on corrupt meta | **PASS** | `loadVaultMetaRaw()` (service.ts:1818-1839) catches parse errors. If meta file is missing, throws a descriptive error but does not corrupt DB. |
| Provider state cannot escalate tier | **PASS** | Provider state contains `type`, `name`, `enrolled_at`, `data` (credential ID, wrapped KEK). No tier information is stored in provider state. Tier is always resolved from JWT claims. |

**Missing recovery feature (informational):** If `targetPath.tmp` exists from a prior crash, the code does not attempt to recover from it on load. The `.tmp` file is orphaned. Not a security issue — just a UX gap.

**Section 6 overall: PASS**

### Section 7 — Memory Exposure

| Check | Status | Evidence |
|---|---|---|
| Decrypt cache holds plaintext in memory | **ACKNOWLEDGED** | cache.ts:15-17 documents the trade-off. Max 16 entries, 60s TTL. |
| Cache flushed on lock | **PASS** | service.ts:314 |
| Cache entries release string reference on evict | **PASS** | cache.ts:81: `(entry as any).value = ''` |
| KEK/DEK are `Buffer` (not string) | **PASS** | VaultSession fields are `Buffer`. Zeroized on lock. |
| KEK/DEK not logged or stringified | **PASS** | Console logs reference only IDs, categories, and tier strings. No `console.log` of key material found. |
| No module-level decrypted data | **PASS** | `decryptCache` is instance-level on VaultService, flushed on lock. No global plaintext storage. |
| Record DEK zeroized after use | **PASS** | envelope.ts:179 (`sealRecord` finally block), envelope.ts:199 (`openRecord` finally block) |
| Passkey wrapping key zeroized | **PASS** | service.ts:423 (`completePasskeyEnroll`), unlockProvider.ts:334 (`PasskeyUnlockProvider.unlock`) |
| PRF output zeroized | **PASS** | service.ts:424, service.ts:563 |

**Inherent limitation:** JS strings are immutable — the decrypt cache holds `JSON.stringify(fields)` as a string that cannot be securely overwritten (only dereferenced for GC). This is documented in cache.ts:15-17 and is a known limitation of the JS runtime.

**Section 7 overall: PASS** (with documented inherent limitation)

### Section 8 — Migration & Legacy Behavior

| Check | Status | Evidence |
|---|---|---|
| `listItems()` does not decrypt v1 records | **PASS** | service.ts:1137-1148: `fields: []` for ALL schema versions. No `fields_json` parsing occurs. |
| `search()` does not decrypt v1 records | **PASS** | service.ts:1179 SQL does not select `fields_json`. Line 1197: `fields: []`. |
| `migrateItemToV2()` does not return plaintext | **PASS** | service.ts:1300-1327: decrypts v1 fields, re-seals as v2, writes to DB. Return type is `void`. Plaintext exists only in local scope. |
| Migration cannot be triggered externally | **PASS** | `migrateItemToV2()` is `private` (not in RPC or HTTP surface). `upgradeVault()` is also not exposed via RPC. |
| Schema downgrade attack impossible | **PASS** | `createItem()` always writes `schema_version = ENVELOPE_SCHEMA_VERSION` (2). `updateItem()` with fields always writes v2. There is no code path that writes `schema_version = 1`. A crafted SQL injection would require bypassing SQLCipher encryption. |
| Legacy v1 records migrated correctly | **PASS** | service.ts:1296 `sealRecord()` uses fresh per-record DEK. Old `fields_json` cleared to `'[]'` at line 1301. |

**Section 8 overall: PASS**

---

## E) Confirmed Weak Points

### E-1. `clearSession()` does not clear `cachedUserInfo` (LOW)

**File:** `session.ts:248-251`

```typescript
export function clearSession(): void {
  accessToken = null;
  expiresAt = null;
  // cachedUserInfo is NOT cleared here
}
```

After `logoutFast()` calls `clearSession()`, `cachedUserInfo` retains the previous user's roles/plan until the next `ensureSession()` refresh.  This is a stale-state issue, not an exploitable vulnerability, because:
1. `resolveRequestTier()` calls `ensureSession()` which will return `{ accessToken: null }` after logout.
2. With `accessToken === null`, `resolveRequestTier()` returns `DEFAULT_TIER` ('free').
3. The stale `cachedUserInfo` is never used for security decisions after logout.

**Risk:** Informational.  **Fix:** Add `cachedUserInfo = null` to `clearSession()`.

### E-2. Inherent JS string plaintext in decrypt cache (INFORMATIONAL)

JS strings are immutable — the 16-entry decrypt cache holds decrypted fields as JSON strings that cannot be securely overwritten in memory.  On `lock()`, the cache is flushed (references released), but the actual bytes persist in the V8 heap until GC reclaims and the OS recycles the page.

**Risk:** Requires physical memory access or a V8 heap dump while the process is running.  Documented trade-off (cache.ts:15-17).  No code fix possible within the JS runtime.

### E-3. HTTP API has no per-request authentication token (MODERATE — pre-existing)

The HTTP API on `127.0.0.1` does not require a bearer token or HMAC — any local process can make requests.  The RPC WS path validates the session via `ensureSession()`, but the session is bound to the Electron app's Keycloak refresh token, not to the individual TCP connection.

**Risk:** On a multi-user system or a system with local malware, any process on the loopback interface can issue vault requests while the vault is unlocked.  Tier enforcement prevents privilege escalation beyond the user's plan, but data at the user's tier is exposed.

**Mitigation potential:** Add a per-session bearer token to HTTP requests (generated during login, validated per-request).

---

## F) Minimal Patch Recommendations

| Priority | Finding | Patch |
|---|---|---|
| P1 (LOW) | `clearSession()` doesn't clear `cachedUserInfo` | Add `cachedUserInfo = null` to `clearSession()` in `session.ts:248-251`. One line. |
| P2 (MODERATE) | HTTP API lacks per-request auth token | Generate a random token on login, store in renderer, require as `Authorization: Bearer <token>` on all `/api/vault/*` requests. Validate in Express middleware. ~30 lines. |
| P3 (INFORMATIONAL) | `migrateItemToV2` has no tier parameter | Add a comment documenting the intentional design choice, or add `tier?: VaultTier` with a log warning if not provided. |
| P4 (INFORMATIONAL) | Orphaned `.tmp` files from crashed atomic writes | On vault meta load, check for `<path>.tmp` and delete it (or log a warning). ~5 lines. |

---

## G) Final Classification

### Local-first secure: YES

**Justification:**  
All decrypt operations are gated by mandatory `tier: VaultTier` parameters enforced at the TypeScript compilation level. Tier is resolved per-request from JWT claims (`resolveRequestTier()` for HTTP, `ensureSession()` + `resolveTier()` for RPC). The module-level `currentTier` (main.ts:87) is explicitly documented as display-only and is never passed to any service method. Unauthenticated RPC calls are rejected at main.ts:1809. KEK/DEK are zeroized on lock. Decrypt cache is flushed. Passkey challenges are one-time-use with TTL. Meta writes are atomic. No bulk-decrypt path exists.

**Code evidence:** service.ts `getItem` signature (line 1009): `async getItem(id: string, tier: VaultTier)` — tier is non-optional. rpc.ts `handleVaultRPC` signature (line 39): `async function handleVaultRPC(method: string, params: any, tier: VaultTier)` — tier is mandatory. Capability check at service.ts:1022 is unconditional (no `if (tier)` guard).

### Enterprise-grade: YES (conditional on P2)

**Justification:**  
The core security model is sound: per-record envelope encryption, tier-based capability gating at the service layer (defense-in-depth with HTTP route checks), atomic meta writes, session-bound vault lifecycle, zeroization of key material.  The only gap for enterprise deployment is the HTTP API's lack of per-request authentication (P2), which matters on shared workstations or VDI environments.

### High-assurance ready: YES (conditional on P1 + P2)

**Justification:**  
After clearing `cachedUserInfo` on logout (P1) and adding per-request HTTP authentication (P2), the vault would satisfy the following invariants under adversarial conditions:

1. **Gate before decrypt** — enforced at TypeScript compilation level + runtime checks.
2. **Per-request tier resolution** — JWT claims refreshed per-request, no cached/stale tier used for decisions.
3. **Session-bounded key lifetime** — KEK/DEK zeroized on lock, lock triggered on logout/expiry.
4. **No bulk decrypt** — listing, searching, and exporting all respect per-record capability checks.
5. **Replay-resistant passkey** — one-time-use, TTL-bounded challenges via `ChallengeStore`.
6. **Crash-safe metadata** — atomic write-rename for provider state.
7. **Compile-time safety** — TypeScript mandatory parameters prevent future developer from omitting tier.

The remaining informational items (decrypt cache in JS strings, migration without tier) are inherent platform limitations and documented design choices, not code defects.

---

*End of report.*
