# Runtime Tier Value Trace — Publisher → Pro Downgrade Diagnosis

**Date:** 2025-03-12  
**Issue:** User with Publisher plan detected as Pro in WRVault; HS Context locked  
**Scope:** Trace exact runtime path; identify where `publisher` becomes `pro`

---

## Step 1 — JWT Claim Inspection

### Token Decoding Location

**File:** `apps/electron-vite-project/src/auth/session.ts`

| Function | Lines | Purpose |
|----------|-------|---------|
| `decodeJwtPayload(token)` | 38–46 | Base64url-decode JWT payload (no verification; token already verified by Keycloak during refresh) |
| `extractUserInfo(payload)` | 90–223 | Extract plan, roles, and user metadata from decoded payload |

### Which Token Is Used

**In `ensureSession()` (lines 255–276):**
```typescript
const tokenToDecode = tokens.id_token || tokens.access_token;
const payload = decodeJwtPayload(tokenToDecode);
cachedUserInfo = payload ? extractUserInfo(payload) : null;
```

**In `updateSessionFromTokens()` (lines 303–305):**
```typescript
const tokenToDecode = tokens.id_token || tokens.access_token;
const payload = decodeJwtPayload(tokenToDecode);
cachedUserInfo = payload ? extractUserInfo(payload) : null;
```

**Conclusion:** The system prefers **id_token over access_token**. If `id_token` exists, it is used. Otherwise `access_token` is used.

### What Happens If wrdesk_plan Exists Only in access_token

If Keycloak puts `wrdesk_plan` only in `access_token` and not in `id_token`:

1. `tokens.id_token` is present (OIDC refresh typically returns it when `openid` scope is used).
2. `tokenToDecode = tokens.id_token` — the id_token is used.
3. `extractUserInfo()` runs on the id_token payload.
4. The id_token payload does **not** contain `wrdesk_plan`.
5. `wrdesk_plan` remains `undefined` after extraction.
6. `resolveTier(undefined, roles)` falls back to `mapRolesToTier(roles)`.
7. If roles contain `pro` but not `publisher`, the result is `pro`.

**Result:** Publisher users can be downgraded to Pro when the plan claim is only in the access_token.

---

## Step 2 — Claim Extraction Runtime Trace

### Extraction Priority (session.ts lines 130–167)

**PLAN_CLAIM_KEYS** — first match wins, in order:
1. `wrdesk_plan`
2. `wrdesk_plans`
3. `user_plan`
4. `user_plans`
5. `plan`
6. `plans`
7. `subscription`
8. `subscription_plan`
9. `tier`
10. `user_tier`

**NESTED_ATTRIBUTE_KEYS** (if no direct match):
- `user_attributes`, `attributes`, `custom_attributes`, `user_metadata`

Each nested object is searched for the same PLAN_CLAIM_KEYS.

### Effective Logic (Pseudocode)

```
plan =
  payload["wrdesk_plan"]     // first
  || payload["wrdesk_plans"] // (or first element if array)
  || payload["user_plan"]
  || payload["user_plans"]
  || payload["plan"]
  || payload["plans"]
  || payload["subscription"]
  || payload["subscription_plan"]
  || payload["tier"]
  || payload["user_tier"]
  || nestedSearch(user_attributes, attributes, custom_attributes, user_metadata)
  || undefined  // then fallback to roles in resolveTier
```

### Roles Extraction

- `realm_access.roles` (array)
- `resource_access["wrdesk-orchestrator"].roles` (array)

### Example `extractUserInfo()` Output

**Scenario A — Plan from JWT:**
```json
{
  "displayName": "John Doe",
  "email": "john@example.com",
  "initials": "JD",
  "sub": "abc-123",
  "iss": "https://auth.wrdesk.com/realms/wrdesk",
  "wrdesk_user_id": "abc-123",
  "roles": ["publisher", "pro"],
  "wrdesk_plan": "publisher"
}
```

**Scenario B — Plan absent, inferred from roles:**
```json
{
  "displayName": "John Doe",
  "email": "john@example.com",
  "initials": "JD",
  "sub": "abc-123",
  "iss": "https://auth.wrdesk.com/realms/wrdesk",
  "wrdesk_user_id": "abc-123",
  "roles": ["pro"],
  "wrdesk_plan": undefined
}
```

**Scenario C — Plan wrong (stale Keycloak):**
```json
{
  "displayName": "John Doe",
  "email": "john@example.com",
  "roles": ["pro"],
  "wrdesk_plan": "pro"
}
```

---

## Step 3 — Tier Resolution Logic

### Decision Tree in `resolveTier()` (capabilities.ts)

```
resolveTier(wrdesk_plan, keycloakRoles):
│
├─ if wrdesk_plan is falsy (undefined, "", null)
│  └─ return mapRolesToTier(keycloakRoles)  // FALLBACK
│
└─ if wrdesk_plan is present:
   ├─ normalized = wrdesk_plan.toLowerCase().trim()
   │
   ├─ WC_PLAN_ALIASES (WooCommerce alignment):
   │  ├─ "private" → "pro"
   │  └─ "private_lifetime" → "pro"
   │
   ├─ VALID_PLAN_TIERS exact match:
   │  └─ if normalized in ["free","private","private_lifetime","pro","publisher","publisher_lifetime","enterprise"]
   │     → return normalized
   │
   ├─ FUZZY_MAP (first regex match):
   │  ├─ /enterprise/i → "enterprise"
   │  ├─ /publisher.*life/i → "publisher_lifetime"
   │  ├─ /publisher/i → "publisher"
   │  ├─ /\bpro\b/i → "pro"
   │  ├─ /private.*life/i → "pro"
   │  └─ /\bprivate\b/i → "pro"
   │
   └─ if no match: "Plan claim has unrecognized value" → mapRolesToTier(keycloakRoles)
```

### Plan vs Roles Priority

- **Plan overrides roles** when the plan claim is present and matches a known tier.
- **Roles are used only** when:
  - `wrdesk_plan` is absent, or
  - `wrdesk_plan` is present but not in VALID_PLAN_TIERS and no FUZZY_MAP match.

### When planClaim = "publisher" but result = "pro"

This can happen only if:

1. **Plan claim is absent** → fallback to roles → `mapRolesToTier` returns `pro` because user has `pro` role but not `publisher`.
2. **Plan claim is "pro"** (wrong value from Keycloak) → `resolveTier` returns `pro` directly.
3. **Plan claim is unrecognized** (e.g. typo, wrong format) → fallback to roles → `pro` if only `pro` role exists.

There is no path where `wrdesk_plan === "publisher"` produces `pro` inside `resolveTier`. The downgrade must occur before `resolveTier` (wrong/missing plan) or in the fallback (roles only).

---

## Step 4 — Backend Tier Propagation

### `resolveRequestTier()` (main.ts lines 105–118)

```typescript
async function resolveRequestTier(): Promise<Tier> {
  const session = await ensureSession();
  if (!session.accessToken || !session.userInfo) {
    return DEFAULT_TIER;  // 'free'
  }
  const plan = session.userInfo.wrdesk_plan;
  const roles = session.userInfo.roles || [];
  const tier = resolveTier(plan, roles);
  currentTier = tier;  // display cache only
  return tier;
}
```

### POST /api/vault/status Response (main.ts lines 5738–5750)

```typescript
const tier = await resolveRequestTier();
const status = await vaultService.getStatus();
res.json({
  success: true,
  data: { ...status, tier },
  ...(sessionToken ? { sessionToken } : {})
});
```

### Response Structure

```json
{
  "success": true,
  "data": {
    "exists": true,
    "locked": false,
    "isUnlocked": true,
    "availableVaults": [...],
    "tier": "pro"
  },
  "sessionToken": "..."
}
```

### Tier Caching

| Variable | Scope | Used For |
|----------|-------|----------|
| `currentTier` | main.ts module | Display only (tray, IPC). **Never** used for vault access control. |
| `cachedUserInfo` | session.ts module | Cached until token refresh. `resolveRequestTier` reads from it. |

**Per-request behavior:** Each `POST /api/vault/status` call runs `resolveRequestTier()` → `ensureSession()` → `resolveTier(plan, roles)`. Tier is recalculated per request from the current session. If `ensureSession()` returns cached data (token not expired), `cachedUserInfo` is used; otherwise a new refresh runs and `cachedUserInfo` is updated.

---

## Step 5 — Vault UI Tier Handling

### Where `currentVaultTier` Is Set

**File:** `apps/extension-chromium/src/vault/vault-ui-typescript.ts`

**Line 22:** `let currentVaultTier: VaultTier = 'free'` (module-level default)

**Lines 376–387** (in `initVaultUI`):
```typescript
const status = await vaultAPI.getVaultStatus();  // → POST /api/vault/status
if (status.tier) {
  currentVaultTier = status.tier as VaultTier;
  console.log('[VAULT UI] Tier set from backend:', currentVaultTier);
} else {
  console.warn('[VAULT UI] No tier in status response — defaulting to free.');
}
```

### Data Flow: API → UI

1. `getVaultStatus()` → `apiCall('/status')` → background fetches `POST /api/vault/status`
2. Backend returns `{ success: true, data: { ...status, tier } }`
3. `apiCall` resolves with `response.data` (vault api.ts line 130)
4. `status = response.data` → `status.tier` is the tier from the backend
5. `currentVaultTier = status.tier`

### HS Context Gate

**File:** `packages/shared/src/vault/vaultCapabilities.ts`

**Exact condition:**
```typescript
// RECORD_TYPE_MIN_TIER
handshake_context: 'publisher'

// canAccessRecordType(tier, recordType, action)
const userLevel = TIER_LEVEL[tier] ?? 0;           // pro=3, publisher=4
const requiredTier = RECORD_TYPE_MIN_TIER[recordType];  // handshake_context → 'publisher'
const requiredLevel = TIER_LEVEL[requiredTier] ?? 0;     // 4
if (userLevel < requiredLevel) return false;
```

**Equivalent:**
```
HS_CONTEXT_ENABLED = (tier === "publisher" || tier === "publisher_lifetime" || tier === "enterprise")
                  = (TIER_LEVEL[tier] >= 4)
```

For `tier === "pro"` (level 3): `3 < 4` → HS Context is blocked.

---

## Step 6 — Tier Mutation Check

### Trace Table

| Stage | Value | Notes |
|-------|-------|-------|
| **JWT wrdesk_plan** | `publisher` or `undefined` | Depends on Keycloak mapper and which token (id vs access) is used |
| **extractUserInfo()** | `wrdesk_plan: "publisher"` or `undefined` | From first matching PLAN_CLAIM_KEYS in decoded token |
| **resolveTier()** | `"publisher"` or `"pro"` | Plan primary; roles fallback if plan absent/unrecognized |
| **resolveRequestTier()** | Same as resolveTier | Pass-through; no transformation |
| **/api/vault/status** | `data.tier` | Same value in response |
| **Vault UI currentVaultTier** | Same as API | `status.tier` from response |

### First Stage Where publisher → pro

The downgrade happens in one of these places:

1. **JWT payload** — `wrdesk_plan` is missing or `"pro"` in the token actually decoded (id_token).
2. **extractUserInfo()** — Plan claim absent → `wrdesk_plan: undefined` → fallback to roles.
3. **resolveTier()** — With `wrdesk_plan: undefined`, `mapRolesToTier(["pro"])` returns `"pro"`.

There is no transformation after `resolveTier()`. The API and UI simply pass the value through.

**Most likely first failure point:** `extractUserInfo()` returns `wrdesk_plan: undefined` (plan not found in the decoded token), and `mapRolesToTier(roles)` returns `"pro"` because the user has `pro` but not `publisher` in roles.

---

## Step 7 — Keycloak Claim Validation

### How wrdesk_plan Is Mapped (External to Codebase)

The codebase does not configure Keycloak. It only reads JWT claims. Keycloak configuration is external.

### Typical Keycloak Setup

| Component | Description |
|-----------|-------------|
| **User Attribute** | e.g. `wrdesk_plan` (or `wrdesk-plan`) stored on the user |
| **Protocol Mapper** | Maps User Attribute → JWT claim |
| **Token types** | Mapper can target: ID Token, Access Token, Userinfo, or both |
| **Claim name** | Mapper can use a different claim name than the attribute (e.g. `plan` instead of `wrdesk_plan`) |

### Claim Names the Code Checks

- `wrdesk_plan` (underscore)
- `wrdesk_plans`
- `user_plan`, `user_plans`
- `plan`, `plans`
- `subscription`, `subscription_plan`
- `tier`, `user_tier`

### Claim Names NOT Checked

- `wrdesk-plan` (hyphen) — Keycloak sometimes uses hyphens in claim names
- `wrdeskTier` — coordination service uses this, but main app does not
- `wrdesk_tier` — not in PLAN_CLAIM_KEYS

### Where wrdesk_plan Can Appear

| Location | Depends On |
|----------|------------|
| **id_token** | Mapper "Add to ID token" = ON |
| **access_token** | Mapper "Add to access token" = ON |
| **Userinfo** | Mapper "Add to userinfo" = ON (not used by WRDesk) |

If the mapper adds the claim only to the access token, and the app prefers the id_token, the plan will not be found.

---

## Step 8 — Final Diagnosis

### 1. Full Runtime Tier Trace

```
Keycloak issues JWT (id_token + access_token)
    │
    ▼
session.ts: tokenToDecode = id_token || access_token
    │
    ▼
decodeJwtPayload(tokenToDecode) → payload
    │
    ▼
extractUserInfo(payload) → { wrdesk_plan?, roles }
    │  PLAN_CLAIM_KEYS search (first match)
    │  extractRoles(payload) → roles
    │
    ▼
resolveRequestTier() → ensureSession() → session.userInfo
    │
    ▼
resolveTier(wrdesk_plan, roles)
    │  if wrdesk_plan: use it (exact/fuzzy)
    │  else: mapRolesToTier(roles)
    │
    ▼
POST /api/vault/status → res.json({ data: { ...status, tier } })
    │
    ▼
Vault UI: currentVaultTier = status.tier
    │
    ▼
canAccessRecordType(tier, 'handshake_context') → tier >= publisher
```

### 2. Exact Stage Where Tier Becomes "pro"

The tier becomes `"pro"` in **`resolveTier()`** when either:

- **Path A:** `wrdesk_plan === "pro"` (from JWT) → direct/fuzzy match returns `"pro"`.
- **Path B:** `wrdesk_plan` is `undefined` → `mapRolesToTier(roles)` returns `"pro"` because roles include `"pro"` but not `"publisher"`.

The root cause is upstream of `resolveTier()`: either wrong/missing plan in the JWT, or wrong/missing roles.

### 3. Why the Downgrade Occurs

1. **Plan claim missing in decoded token** — id_token preferred; if plan is only in access_token, it is never read.
2. **Plan claim wrong** — Keycloak has `wrdesk_plan = "pro"` (stale or bad sync).
3. **Role fallback** — No plan found; user has `pro` role but not `publisher` (role not assigned on upgrade).
4. **Claim name mismatch** — Keycloak uses e.g. `wrdesk-plan` or `wrdeskTier`; code only checks `wrdesk_plan`, `plan`, `tier`, etc.

### 4. Component Responsible

| Component | Responsibility |
|-----------|----------------|
| **Keycloak** | Provide correct `wrdesk_plan` (or equivalent) and `publisher` role in the token that is actually decoded |
| **session.ts** | Prefer id_token; if plan is only in access_token, it will not be found |
| **capabilities.ts** | Correctly implements plan-primary, roles-fallback; no bug in resolution logic |

### 5. Evidence Required to Confirm

| Evidence | How to Obtain |
|----------|---------------|
| Decoded id_token payload | Add temporary log of `JSON.stringify(payload)` in `extractUserInfo` after `decodeJwtPayload`, or decode at jwt.io |
| Decoded access_token payload | Same, but decode access_token when id_token is used |
| Plan extraction log | `[SESSION] Plan found in claim "X": Y` — which claim and value |
| No-plan log | `[SESSION] ⚠️ No plan claim found. Custom JWT claims:` — full custom claims |
| Roles log | `[SESSION] ⚠️ Roles extracted: [...]` |
| Tier resolution log | `[TIER] resolveRequestTier: wrdesk_plan=X, roleCount=N, resolved=Y` |
| Keycloak mapper config | Admin → Clients → wrdesk-orchestrator → Mappers — token types for plan claim |
| Keycloak user attributes | Admin → Users → [user] → Attributes — `wrdesk_plan` or equivalent |

---

## Summary

The downgrade from Publisher to Pro occurs because either:

1. **Plan claim is missing** in the token used for extraction (id_token preferred; plan may be only in access_token), or  
2. **Plan claim is wrong** (Keycloak has `"pro"`), or  
3. **Plan is missing and role fallback** returns `"pro"` (user has `pro` role but not `publisher`).

The resolution logic in `capabilities.ts` is correct. The failure is in the **input** to that logic: the JWT claims (and/or Keycloak configuration) that feed `extractUserInfo()` and `resolveTier()`.
