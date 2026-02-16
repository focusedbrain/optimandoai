# WRVault — Adversarial Security Review

**Reviewer posture:** External, skeptical, zero trust in prior claims.
**Date:** 2026-02-15
**Scope:** All vault code as committed. Threat scenarios 1–7 per brief.

---

## A) Executive Summary

WRVault implements a structurally sound local-first vault with per-record
envelope encryption, tiered capability gating, and a passkey abstraction.
The cryptographic primitives (scrypt, AES-256-GCM, XChaCha20-Poly1305, HKDF)
are correctly applied.  However, **four HTTP routes decrypt data before
checking capabilities**, the **meta file is not written atomically** (crash =
potential lockout), the **passkey flow issues challenges it never verifies**
(replay of PRF output is structurally possible), and the **vault is not
locked on auth session expiry** (tier can go stale).  The decrypt cache holds
**plaintext in non-zeroizable JS strings**.  Legacy v1 records are still
**bulk-decrypted** during `listItems()`.  None of these are remotely
exploitable — they all require local process or filesystem access — but several
violate the "fail-closed, gate-before-decrypt" invariant the project claims.
Under a strict regulated-environment audit, these would be flagged as findings
requiring remediation before certification.

---

## B) Critical Findings

### B-1. Four HTTP Routes Decrypt Before Capability Check

**Severity:** Critical (violates stated invariant)
**Affected routes:**

| Route | File:Line | Issue |
|-------|-----------|-------|
| `POST /api/vault/item/get` | `main.ts:3876` | `getItem(id)` called without `tier` — decrypts, then checks |
| `POST /api/vault/item/update` | `main.ts:3900` | `getItem(id)` called without `tier` — decrypts to read category |
| `POST /api/vault/item/delete` | `main.ts:3923` | `getItem(id)` called without `tier` — same pattern |
| `POST /api/vault/item/meta/set` | `main.ts:3970` | `getItem(id)` called without `tier` — decrypts to verify category |

**Why it matters:** The service method `getItem(id, tier?)` at `service.ts:982-987`
performs a pre-decrypt capability check **only when `tier` is provided**. All four
routes omit the `tier` argument.  The per-record DEK is unwrapped, the ciphertext
is decrypted, and the plaintext fields exist in memory before the HTTP handler's
capability check at the response layer.  Decrypted data is not returned to
unauthorized callers, but:
- The plaintext exists in process memory (and potentially the decrypt cache).
- A compromised renderer (Threat 2) could time the request and infer that the
  record was decrypted.
- The stated security invariant "capability gate occurs before unwrap/decrypt"
  is violated.

**Fix (4 one-line changes):**

```typescript
// main.ts — each of the four routes:
const item = await vaultService.getItem(req.body.id, currentTier as any)
```

---

### B-2. Non-Atomic Meta File Writes

**Severity:** Critical (data loss / lockout on crash)
**Affected code:**

| Method | File:Line | Issue |
|--------|-----------|-------|
| `saveVaultMeta()` | `service.ts:1802` | `writeFileSync(metaPath, ...)` — direct overwrite |
| `updateProvidersMeta()` | `service.ts:604` | `readFileSync` → modify → `writeFileSync` — no rename |

**Why it matters:** If the Electron process crashes, is killed, or the OS loses
power during `writeFileSync`, the meta file may be truncated or empty.  The meta
file contains `salt` and `wrappedDEK` — without these, the vault **cannot be
unlocked**.  The database itself is encrypted, so the meta file is the sole
recovery path.  `loadVaultMetaRaw()` catches the `JSON.parse` error but then
throws a fatal error with no recovery.

**Attack vector (Threat 1 — filesystem):** A malicious local process could
continuously overwrite the meta file with garbage, causing permanent vault lockout
on next unlock attempt.

**Fix (write-then-rename pattern):**

```typescript
import { renameSync } from 'fs'

private atomicWriteJson(filePath: string, data: any): void {
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, filePath)  // atomic on POSIX; near-atomic on NTFS
}
```

Apply to both `saveVaultMeta()` and `updateProvidersMeta()`.

---

## C) Moderate Findings

### C-1. Vault Not Locked on Auth Session Expiry

**Severity:** Moderate
**Location:** `main.ts:20-52` (`logoutFast`)

`logoutFast()` sets `hasValidSession = false` and `currentTier = DEFAULT_TIER`
('free'), but **does not call `vaultService.lock()`**.  After logout:
- The vault remains unlocked in memory (KEK + DEK live).
- `currentTier` drops to `'free'`, so Pro+ record types become inaccessible via
  HTTP routes.
- However, `automation_secret` records remain accessible at the `free` tier.
- The in-memory KEK could be extracted by any code running in the main process.

**Why it matters (Threat 3 — memory inspection):** If a user logs out but leaves
the app running, their vault keys persist until the autolock timer fires or the
app exits.  In a shared-workstation scenario, this is a credential exposure window.

**Fix:** Add `vaultService.lock()` to `logoutFast()`:

```typescript
function logoutFast(): void {
  // ... existing code ...
  try {
    const { vaultService } = require('./main/vault/rpc')
    vaultService.lock()
  } catch { /* vault may not be initialized */ }
}
```

---

### C-2. Passkey PRF Output Is Replayable by Design

**Severity:** Moderate (design limitation, not implementation bug)
**Location:** `unlockProvider.ts:307-347`, `service.ts:488-570`

The WebAuthn PRF extension produces a **deterministic** output for a given
`(credential, prfSalt)` pair.  The server generates a challenge in
`beginPasskeyUnlock()` but **never verifies it** in `completePasskeyUnlock()`.
This is not a bug per se — the challenge only affects the assertion signature, not
the PRF output — but it means:

1. The challenge serves no security purpose (it's decorative).
2. If an attacker captures the PRF output (Threat 2 or 3), they can replay it
   indefinitely without needing the authenticator again.
3. The PRF output is functionally a **static secret** for the lifetime of the
   enrollment.

**Why it matters:** In the stated threat model, capturing the PRF output requires
local process access (already a loss condition).  But the user may believe the
passkey provides session-bound freshness when it does not.

**Mitigation (documentation + optional hardening):**
- Document in `PASSKEY_UNLOCK.md` that the PRF output is deterministic and replay
  is structurally possible given local access.
- Optionally: Bind a server-generated nonce into the HKDF info string so each
  unwrap requires a fresh nonce from `beginPasskeyUnlock`.  This limits replay
  to a single begin→complete window.

---

### C-3. Legacy v1 Records Bulk-Decrypted During `listItems()`

**Severity:** Moderate (violates lazy-decrypt invariant)
**Location:** `service.ts:1109-1132`

```
1109:1132:apps/electron-vite-project/electron/main/vault/service.ts
      } else {
        // ── v1 legacy: parse + decrypt fields inline (backwards compat) ──
        let fields: Field[] = []
        // ... parse + decrypt ALL fields for EVERY v1 row ...
        fields = await this.decryptItemFields(row.id, fields)
        items.push({ ..., fields })
      }
```

**Why it matters:** If a vault contains 1,000 legacy v1 records, calling
`listItems()` decrypts all of them simultaneously — exactly the scenario the
envelope v2 design was meant to prevent.  The HTTP route for `/api/vault/items`
does post-filter by tier, but the decryption has already occurred.

**Fix:** Return `fields: []` for v1 records in `listItems()` as well, and handle
legacy decryption in `getItem()` only (it already does):

```typescript
// service.ts listItems() — legacy branch:
items.push({
  ...rowMetadata,
  fields: [],  // lazy: decrypt in getItem() only
})
```

---

### C-4. `currentTier` Is Stale Between Auth Refreshes

**Severity:** Moderate
**Location:** `main.ts:79`

`currentTier` is a module-level `let` variable, set during login/startup and
cleared on logout.  It is **not revalidated per-request** against the Keycloak
session.  If the backend token refresh fails silently, or if the Keycloak admin
revokes roles, `currentTier` retains its previous value until the next full
session check.

**Race condition (Threat 4):** Between a tier downgrade on the auth server and
the next session check, the user operates at the old (higher) tier.

**Fix (incremental):** Revalidate tier on each vault HTTP request by checking the
session's access token claims.  Alternatively, set a maximum tier-validity window
(e.g., 5 minutes) and force recheck.

---

### C-5. Decrypt Cache Stores Non-Zeroizable Plaintext

**Severity:** Moderate (acknowledged in code, but undocumented in threat model)
**Location:** `cache.ts:28,80-81`

```
28:apps/electron-vite-project/electron/main/vault/cache.ts
  value: string        // decrypted fields JSON
```

```
80:81:apps/electron-vite-project/electron/main/vault/cache.ts
      // Release reference (JS strings are immutable so we can't overwrite)
      ;(entry as any).value = ''
```

JavaScript strings are immutable and heap-allocated.  The original string data
persists until the V8 garbage collector reclaims it.  `flush()` releases the
reference but cannot overwrite the memory.  Up to 16 records × ~60 seconds of
plaintext may be resident in the V8 heap.

**Why it matters (Threat 3 — memory inspection):** A heap dump or memory scanner
can find decrypted vault records in the string heap even after `flush()`.

**Fix options (trade-off):**
- **Option A:** Store decrypted data in a `Buffer` (zeroizable) instead of a
  `string`.  Parse fields from the Buffer on each access.
- **Option B:** Reduce `maxEntries` to 1 and `ttlMs` to 5000.
- **Option C:** Accept the risk and document it as a known limitation.

---

## D) Low-Risk / Informational Findings

### D-1. Provider Registry Not Frozen

**Location:** `unlockProvider.ts:362-365`

`PROVIDER_REGISTRY` is a plain object, not `Object.freeze()`-d.  Runtime code
(or a dependency with prototype pollution) could inject a new provider.

**Impact:** Requires code execution in the main process (already a total
compromise).
**Fix:** `Object.freeze(PROVIDER_REGISTRY)` — one line.

---

### D-2. `resolveProvider()` Falls Back Silently

**Location:** `unlockProvider.ts:371-376`

If `type` is an unrecognized string (e.g., from a corrupted meta file), the
function silently returns a `PassphraseUnlockProvider`.  This is safe (passphrase
still requires the correct password) but could mask a corrupted provider state.

**Fix:** Log a warning when falling back:

```typescript
if (type && !PROVIDER_REGISTRY[type]) {
  console.warn(`[VAULT] Unknown provider type "${type}" — falling back to passphrase`)
}
```

---

### D-3. No Meta File Integrity Check

**Location:** `service.ts:1755-1777` (`loadVaultMetaRaw`)

The meta file is parsed with `JSON.parse()` and fields are extracted by name.
There is no checksum, HMAC, or schema validation.  A corrupted or tampered file
may produce subtly wrong values (e.g., truncated `salt`, invalid `kdfParams`)
that cause cryptographic failures rather than clean errors.

**Fix:** Add an HMAC-SHA256 over the meta file contents using a key derived from
the vault's DB path (not secret, but detects tampering/corruption).

---

### D-4. Passkey Enrollment State Not Cleared on Abandonment

**Location:** `service.ts:348-349`

`passkeyEnrollPrfSalt` and `passkeyEnrollChallenge` persist in memory if the
user starts enrollment but never completes it (closes popup, navigates away).
They are cleared only on successful completion (line 429-430) or by a new
`beginPasskeyEnroll()` call.

**Impact:** The stale salt could be used with a captured PRF output later, but
only if the vault remains unlocked.

**Fix:** Add a timeout that clears enrollment state after 120 seconds:

```typescript
this.passkeyEnrollTimeout = setTimeout(() => {
  this.passkeyEnrollChallenge = null
  this.passkeyEnrollPrfSalt = null
}, 120_000)
```

---

### D-5. `zeroize()` Uses `randomBytes().copy()` + `fill(0)`

**Location:** `crypto.ts:219-227`

The `zeroize` function overwrites with random data then zeros.  This is correct
for Node.js `Buffer` (backed by `ArrayBuffer`, not subject to V8 interning).
However:
- V8 may optimize away the `fill(0)` if the buffer is not subsequently read
  (compiler dead-store elimination).
- There is no `mfence` / `compiler_fence` equivalent in JS.

**Impact:** Theoretical.  In practice, V8 does not optimize away `Buffer.fill()`
calls.  No action required, but worth noting for future Node.js version upgrades.

---

### D-6. `activeProviderType` Manipulation via Meta File (Threat 1)

**Location:** `service.ts:194-195`

An attacker with filesystem access can edit the meta file to set
`activeProviderType: 'passphrase'`, bypassing the default passkey selection.
However:
- This does NOT bypass authentication — the attacker still needs the master
  password.
- Passphrase is always available as a fallback by design.
- The user intended passkey for convenience/additional factor, not as the sole
  gate.

**Impact:** Low.  Downgrade from passkey to passphrase requires filesystem
access, which is already the primary threat boundary for a local vault.

---

### D-7. Migration Not Wrapped in Transaction

**Location:** `db.ts:405-435` (`migrateEnvelopeColumns`)

Each `ALTER TABLE ADD COLUMN` runs as a separate statement.  If the process
crashes after adding `wrapped_dek` but before adding `schema_version`, the
schema is partially migrated.  However, each migration is idempotent
(duplicate column errors are caught), so re-running the migration on next
startup completes it.

**Impact:** Informational.  Self-healing on restart.

---

## E) Suggested Minimal Hardening Changes (Prioritized)

| Priority | Finding | Fix | Effort | Impact |
|----------|---------|-----|--------|--------|
| **P0** | B-1: Decrypt before capability check | Pass `currentTier` to `getItem()` in 4 routes | 4 lines | Restores fail-closed invariant |
| **P0** | B-2: Non-atomic meta file write | Write-then-rename pattern in `saveVaultMeta` + `updateProvidersMeta` | ~15 lines | Prevents lockout on crash |
| **P1** | C-1: Vault not locked on logout | Add `vaultService.lock()` to `logoutFast()` | 5 lines | Closes post-logout key exposure |
| **P1** | C-3: v1 bulk decrypt in listItems | Return `fields: []` for v1 records in list | 5 lines | Enforces lazy-decrypt for all versions |
| **P2** | C-5: Non-zeroizable cache strings | Use `Buffer` for cache values or reduce TTL | ~30 lines | Reduces memory exposure window |
| **P2** | C-4: Stale `currentTier` | Add per-request tier revalidation or max-age check | ~20 lines | Tightens tier propagation |
| **P3** | D-1: Freeze provider registry | `Object.freeze(PROVIDER_REGISTRY)` | 1 line | Defense in depth |
| **P3** | D-4: Clear stale enrollment state | Timeout to clear `passkeyEnrollPrfSalt` | 5 lines | Reduces replay window |
| **P3** | D-3: Meta file integrity | Add HMAC or checksum to meta file | ~30 lines | Detects tampering/corruption |

---

## F) Final Verdict

### Is the vault enterprise-grade under a local-first threat model?

**NO** — with qualification.

**Justification:**

The cryptographic foundation is sound: per-record envelope encryption with
zeroizable DEKs, scrypt-based KEK derivation, proper AES-256-GCM key wrapping,
and a clean unlock-provider abstraction.  The capability model is well-defined and
the tier gating is correct at the service layer.

However, an enterprise-grade vault in a regulated environment must satisfy
**defense-in-depth invariants provably**, not just in the common path.
Currently:

1. **The "gate before decrypt" invariant is violated in 4 of 11 HTTP routes.**
   This is a compliance-grade finding.  The data does not leak to the client, but
   the decryption occurs without authorization, which fails a formal audit
   criterion.

2. **The meta file — the sole key-material bootstrap for the vault — is written
   non-atomically.**  A power failure during passkey enrollment could leave the
   vault unrecoverable.  Enterprise deployments on shared infrastructure (VDI,
   terminal servers) are particularly exposed.

3. **Auth session expiry does not lock the vault.**  On shared workstations, this
   is a credential exposure window that a compliance auditor would flag.

4. **Plaintext resides in non-zeroizable JS strings** in the decrypt cache.
   While acknowledged in code comments, this is undocumented in the threat model
   and would be flagged in a SOC 2 or ISO 27001 control review.

**The P0 and P1 fixes (approximately 30 lines of code) would close the most
significant gaps.**  After those, the vault would be defensible under a
local-first threat model for enterprise use.  The remaining P2/P3 items are
hardening measures that improve posture but are not blocking.

**Bottom line:** The architecture is enterprise-capable.  The implementation has
fixable gaps that should be resolved before any regulated deployment.

---

## G) Remediation Log — Critical RPC Authorization Bypass (2026-02-16)

### Finding

The WebSocket RPC path (`handleVaultRPC` in `rpc.ts`, dispatched from `main.ts`)
called `VaultService` methods (`getItem`, `createItem`, `updateItem`, `deleteItem`,
`exportCSV`, `importCSV`, `getAutofillCandidates`, `search`, `listItems`) **without
resolving tier or checking capabilities**.  Any local process on `127.0.0.1` could
bypass the entire capability model while the vault was unlocked.

Additionally:
- `exportCSV` bulk-decrypted all records regardless of tier.
- `getAutofillCandidates` bulk-decrypted password records via direct field parsing
  instead of using `getItem()` with capability checks.
- `importCSV` could create records of any category without capability checks.
- `/api/vault/item/meta/get` (HTTP) lacked tier resolution and capability gating.

### Fix Applied

**1. Service-layer enforcement (defense-in-depth):**

All data-touching `VaultService` methods now **require `tier: VaultTier`** as a
mandatory TypeScript parameter.  Omitting it is a compile-time error:

- `getItem(id, tier)` — tier was optional, now required; `if (tier)` guard removed.
- `createItem(item, tier)` — new capability check before encryption.
- `updateItem(id, updates, tier)` — new capability check before re-encryption.
- `deleteItem(id, tier)` — new capability check before mutation.
- `exportCSV(tier)` — filters items by capability, passes tier to `getItem()`.
- `importCSV(csvData, tier)` — passes tier to `createItem()` per row.
- `getAutofillCandidates(domain, tier)` — rewritten to use `getItem(id, tier)` per
  record instead of raw field parsing (fixes bulk-decrypt violation).
- `getItemMeta(id, tier)` — new capability check before reading metadata.
- `setItemMeta(id, meta, tier)` — delegates to gated `getItemMeta()`.
- `listItems(filters, tier?)` — optional tier param adds server-side filtering.
- `search(query, category?, tier?)` — optional tier param adds server-side filtering.

**2. RPC-layer auth gate:**

`handleVaultRPC(method, params, tier)` now requires tier as a third parameter.
The WebSocket dispatcher in `main.ts` calls `ensureSession()` first and rejects
with an error response if no valid session exists (`accessToken === null`).
Tier is resolved from the JWT claims per-request via `resolveTier()`.

**3. HTTP meta endpoint:**

`POST /api/vault/item/meta/get` now calls `resolveRequestTier()` and passes tier
to `getItemMeta()`.  Returns HTTP 403 if the tier cannot read the record's category.

**4. Updated call sites:**

All HTTP route handlers in `main.ts` that call changed service methods now pass
the resolved `tier` parameter (e.g., `createItem(req.body, tier)`,
`updateItem(id, updates, tier)`, `deleteItem(id, tier)`, `setItemMeta(id, meta, tier)`).

### Verification

- `rpcAuth.test.ts` — 18 tests verifying capability gate invariants across tiers,
  RPC handler signature enforcement (`handleVaultRPC.length === 3`), and simulated
  service-layer blocking for free/pro/publisher/enterprise tiers.
- All 110 existing vault tests pass without regression.
- TypeScript compilation enforces: any future code that calls `VaultService.getItem(id)`
  without tier will fail to compile.

### Residual Risk

The WebSocket connection itself has no per-request bearer token — any local process
that can reach the WebSocket port while the vault is unlocked can issue RPC calls.
The tier resolved from the JWT session means a compromised renderer inherits the
user's actual tier.  Full mitigation would require per-request HMAC or nonce binding,
which is out of scope for this patch.
