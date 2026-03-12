# WRDesk Tier Forensic Trace — Full Runtime Analysis

**Date:** 2025-03-12  
**Issue:** Tier still "pro" after dual-token fix; Publisher features locked  
**Observed:** `[VAULT UI] Tier set from backend: pro`

---

## Step 1 — Raw Token Sources

### Where Tokens Are Received

**File:** `apps/electron-vite-project/src/auth/refresh.ts`

```typescript
// refreshWithKeycloak(refreshToken) calls Keycloak token endpoint
const response = await fetch(tokenEndpoint, { method: 'POST', body: ... });
const tokens = await response.json();

return {
  access_token: tokens.access_token,   // From Keycloak response
  id_token: tokens.id_token,          // From Keycloak response (if openid scope)
  refresh_token: tokens.refresh_token,
  expires_in: tokens.expires_in,
  ...
};
```

**Keycloak token endpoint** returns the raw JSON. Tokens are **not** decoded or modified by WRDesk before use.

### Claim Comparison Table (Expected Structure)

| Claim | id_token | access_token |
|-------|----------|--------------|
| wrdesk_plan | Depends on Keycloak mapper | Depends on Keycloak mapper |
| wrdesk-plan | Depends on Keycloak mapper | Depends on Keycloak mapper |
| plan | Depends on Keycloak mapper | Depends on Keycloak mapper |
| tier | Depends on Keycloak mapper | Depends on Keycloak mapper |
| subscription_plan | Depends on Keycloak mapper | Depends on Keycloak mapper |
| subscription | Depends on Keycloak mapper | Depends on Keycloak mapper |
| realm_access.roles | Typically present | Typically present |
| resource_access | Typically present | Typically present |
| groups | May be present | May be present |

**Critical:** WRDesk does **not** call the Keycloak `/userinfo` endpoint. Plan claims must be in `id_token` or `access_token` to be detected. If Keycloak mappers add the plan only to the userinfo response, it will never be seen.

---

## Step 2 — Token Decoding

### decodeJwtPayload() — session.ts:38-46

```typescript
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
```

**Behavior:**
- Splits on `.` — expects 3 parts (header.payload.signature)
- Decodes `parts[1]` with `base64url` (Node 16+)
- `JSON.parse` for payload
- Returns `null` on any error (no partial data)

**Potential issues:**
- `base64url`: Node.js supports it. If Keycloak uses standard base64 with `+`/`/`, base64url may fail on `+`/`/` (base64url uses `-`/`_`). Keycloak typically uses base64url for JWTs.
- No truncation handling — full payload is parsed.

---

## Step 3 — extractUserInfo (extractUserInfoFromTokens)

### Current Implementation — session.ts:194-253

**Function:** `extractUserInfoFromTokens(tokens)` — replaces the old single-token `extractUserInfo`.

**Flow:**
1. `idPayload = decodeJwtPayload(tokens.id_token)` (if id_token exists)
2. `accessPayload = decodeJwtPayload(tokens.access_token)`
3. **Plan:** `planFromAccess = extractPlanFromPayload(accessPayload)` then `planFromId = extractPlanFromPayload(idPayload)`
4. **Plan resolution:** `plan = planFromAccess || planFromId` (access first)
5. **Roles:** `rolesFromId = extractRoles(idPayload)`, `rolesFromAccess = extractRoles(accessPayload)`
6. **Roles merge:** `roles = [...new Set([...rolesFromId, ...rolesFromAccess])]`
7. **Profile:** from `idPayload || accessPayload`

### extractPlanFromPayload — Claim Keys Checked

**PLAN_CLAIM_KEYS** (in order):
- wrdesk_plan, wrdesk_plans, wrdesk-plan, wrdeskPlan, wrdeskTier
- user_plan, user_plans, plan, plans
- subscription, subscription_plan, subscriptionTier, subscription-tier
- tier, user_tier

**Nested:** user_attributes, attributes, custom_attributes, user_metadata (each searched for PLAN_CLAIM_KEYS)

**Not checked:**
- `wrdesk-plans` (hyphen plural)
- `groups` — Keycloak group membership (e.g. `/publisher` or `publisher`)

### extractRoles — Role Sources

**Checked:**
- `realm_access.roles` (array)
- `resource_access['wrdesk-orchestrator'].roles` (array)

**Not checked:**
- `groups` claim
- Other client IDs in resource_access

### Example userInfo Output

**When plan found in access_token:**
```json
{
  "displayName": "User Name",
  "email": "user@example.com",
  "sub": "...",
  "wrdesk_plan": "publisher",
  "roles": ["pro", "publisher"]
}
```

**When plan NOT found (fallback path):**
```json
{
  "displayName": "User Name",
  "email": "user@example.com",
  "wrdesk_plan": undefined,
  "roles": ["pro"]
}
```

---

## Step 4 — ensureSession()

### Caching Logic — session.ts:271-318

```typescript
// EARLY RETURN: cached if token valid (60s buffer)
if (accessToken && expiresAt && expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
  return { accessToken, userInfo: cachedUserInfo || undefined };
}

// Otherwise: refresh
const tokens = await refreshWithKeycloak(refreshToken);
cachedUserInfo = extractUserInfoFromTokens(tokens);
return { accessToken, userInfo: cachedUserInfo };
```

**Stale cache scenario:**
- User upgrades Pro → Publisher on Keycloak
- `ensureSession()` returns early with cached token (not expired)
- `cachedUserInfo` still has `wrdesk_plan: undefined` or `wrdesk_plan: "pro"`
- Stale until: token expires (or within 60s of expiry) and refresh runs

**Token lifetime:** Typically 5–15 min. Stale tier can persist for that duration.

**On refresh:** `cachedUserInfo` is always recomputed from new tokens. No reuse of old userInfo.

---

## Step 5 — resolveRequestTier()

### Code Path — main.ts:105-118

```typescript
async function resolveRequestTier(): Promise<Tier> {
  const session = await ensureSession();
  if (!session.accessToken || !session.userInfo) return DEFAULT_TIER;
  const plan = session.userInfo.wrdesk_plan;
  const roles = session.userInfo.roles || [];
  const tier = resolveTier(plan, roles);
  return tier;
}
```

**Runtime trace example (tier = "pro"):**
```
[TIER TRACE]
plan = undefined   (or "pro")
roles = ["pro"]
→ resolveTier(undefined, ["pro"]) → "pro"
```

**Values that produce "pro":**
- `plan = undefined`, `roles = ["pro"]` → mapRolesToTier → "pro"
- `plan = "pro"` → direct match → "pro"
- `plan = "private"` → WC alias → "pro"

---

## Step 6 — resolveTier() Logic

### Decision Tree — capabilities.ts:57-105

1. **If wrdesk_plan present:**
   - WC_PLAN_ALIASES: `private` → pro, `private_lifetime` → pro
   - VALID_PLAN_TIERS exact match
   - FUZZY_MAP: enterprise, publisher_lifetime, publisher, pro, private...
   - Unrecognized → fallback to roles
2. **If wrdesk_plan absent:** mapRolesToTier(roles)

**No publisher → pro mapping:** When `wrdesk_plan === "publisher"`, it returns `"publisher"` (exact or fuzzy). There is no path that converts publisher to pro.

**Conclusion:** The downgrade happens because `resolveTier` receives either `plan = undefined` or `plan = "pro"`.

---

## Step 7 — Role Source Verification

### extractRoles() — session.ts:116-143

**Sources:**
- `realm_access.roles`
- `resource_access['wrdesk-orchestrator'].roles`

**Not used:**
- `groups` — Keycloak group membership
- Other clients in resource_access

**Role fallback behavior:**
- `mapRolesToTier(["pro"])` → "pro"
- `mapRolesToTier(["publisher"])` → "publisher"
- `mapRolesToTier(["pro", "publisher"])` → "publisher" (publisher checked first)

**If user has Publisher plan but only "pro" role:**
- Keycloak may not assign a "publisher" role
- Plan might be in a User Attribute, not a role
- If the plan attribute is not in either token, we fall back to roles
- Roles = ["pro"] → tier = "pro"

---

## Step 8 — Full Runtime Tier Trace

| Stage | Value | Notes |
|-------|-------|-------|
| **Keycloak token endpoint** | id_token, access_token | Raw tokens from refresh |
| **Decoded id_token** | wrdesk_plan=?, roles=? | From decodeJwtPayload |
| **Decoded access_token** | wrdesk_plan=?, roles=? | From decodeJwtPayload |
| **extractUserInfoFromTokens()** | wrdesk_plan=planFromAccess\|\|planFromId, roles=merged | access_token plan first |
| **ensureSession()** | userInfo=cachedUserInfo | Cached if token valid |
| **resolveRequestTier()** | plan=userInfo.wrdesk_plan, roles=userInfo.roles | Pass-through |
| **resolveTier()** | result="pro" | When plan undefined + roles=["pro"], or plan="pro" |
| **/api/vault/status** | tier="pro" | From resolveRequestTier |

### First Stage Where Tier Becomes "pro"

**resolveTier(plan, roles)** is where the tier is determined. It returns "pro" when:

1. **Path A:** `plan = "pro"` (from JWT)
2. **Path B:** `plan = undefined` and `mapRolesToTier(roles)` returns "pro" (roles include "pro", not "publisher")
3. **Path C:** `plan = "private"` (WC alias → pro)

The **root cause** is upstream: `extractUserInfoFromTokens` produces `wrdesk_plan: undefined` or `wrdesk_plan: "pro"`.

---

## Step 9 — Root Cause Evaluation

| # | Cause | Probability | Evidence |
|---|-------|-------------|----------|
| 1 | **Plan claim missing in both tokens** | **HIGH** | Keycloak mapper may add plan only to userinfo, not to tokens |
| 2 | Plan claim name mismatch | MEDIUM | e.g. `wrdesk-plans` (hyphen plural) not in PLAN_CLAIM_KEYS |
| 3 | Plan in nested structure we don't search | MEDIUM | e.g. `payload.custom_claim.plan` with different structure |
| 4 | **User lacks "publisher" role** | **HIGH** | Plan in attribute only; roles = ["pro"] → fallback → "pro" |
| 5 | cachedUserInfo stale | MEDIUM | Token valid, no refresh; old plan/roles used |
| 6 | **Plan only in userinfo endpoint** | **HIGH** | Refresh returns tokens only; WRDesk never calls userinfo |
| 7 | Multiple roles, "pro" wins | LOW | mapRolesToTier checks publisher before pro |

### Most Probable Root Causes (Ranked)

1. **Plan claim missing in both tokens** — Keycloak Protocol Mapper may add the plan claim only to the userinfo response, not to id_token or access_token. The refresh_token grant returns tokens from the token endpoint and does not call userinfo.

2. **User has "pro" role but not "publisher" role** — Publisher may be represented as a User Attribute, not a role. If the attribute is not mapped into the tokens, we fall back to roles. Roles = ["pro"] → "pro".

3. **Stale cachedUserInfo** — Token still valid; ensureSession returns cached data. User upgraded recently; next refresh would get new claims.

4. **Claim name mismatch** — Keycloak uses a claim name not in PLAN_CLAIM_KEYS (e.g. `wrdesk-plans`, or a custom mapper name).

---

## Expected Output Summary

### 1. Full Runtime Value Trace

```
Keycloak token endpoint → { access_token, id_token }
    ↓
decodeJwtPayload(id_token) → idPayload
decodeJwtPayload(access_token) → accessPayload
    ↓
planFromAccess = extractPlanFromPayload(accessPayload)  // undefined if not found
planFromId = extractPlanFromPayload(idPayload)          // undefined if not found
plan = planFromAccess || planFromId                     // undefined → fallback
roles = merge(extractRoles(idPayload), extractRoles(accessPayload))
    ↓
userInfo = { wrdesk_plan: plan, roles }
    ↓
ensureSession() → { userInfo: cachedUserInfo }  // may be cached
    ↓
resolveRequestTier() → plan = userInfo.wrdesk_plan, roles = userInfo.roles
    ↓
resolveTier(plan, roles) → "pro"  // when plan undefined + roles includes "pro"
    ↓
/api/vault/status → { tier: "pro" }
```

### 2. Exact Code Location Where Tier Becomes "pro"

**resolveTier()** in `capabilities.ts:57-105` — specifically:
- Line 104: `return mapRolesToTier(keycloakRoles)` when plan is absent or unrecognized
- `mapRolesToTier(["pro"])` returns `"pro"` (line 146)

### 3. Evidence Supporting the Conclusion

- `[SESSION] ⚠️ No plan claim found in either token` — plan missing
- `[SESSION] Plan found in access_token: pro` — wrong value from Keycloak
- `[TIER] resolveRequestTier: wrdesk_plan=(none), roleCount=1, resolved=pro` — fallback to roles
- `[TIER] No wrdesk_plan and no roles in token; defaulting to free` — would indicate no roles either

### 4. Component Responsible

| Component | Responsibility |
|-----------|----------------|
| **Keycloak** | Must add plan claim to id_token or access_token via Protocol Mapper. If plan is only in userinfo or not mapped to tokens, WRDesk cannot see it. |
| **Session extraction** | Correctly checks both tokens and PLAN_CLAIM_KEYS. May miss claims if Keycloak uses an unsupported name or structure. |
| **Role mapping** | Correct. Fallback to "pro" when roles = ["pro"] and plan is absent. |
| **Session caching** | Can serve stale userInfo for up to token lifetime if user upgraded recently. |

---

## Evidence Required to Confirm

1. **Decoded id_token payload** — All top-level keys and values
2. **Decoded access_token payload** — All top-level keys and values
3. **Console logs:** `[SESSION] Plan found...` or `[SESSION] ⚠️ No plan claim found...`
4. **Console logs:** `[TIER] resolveRequestTier: wrdesk_plan=X, roleCount=N, resolved=Y`
5. **Keycloak Protocol Mapper config** — Token types (ID token, Access token, Userinfo) for plan claim
6. **Keycloak User Attributes** — Value of wrdesk_plan (or equivalent) for the user
7. **Keycloak roles** — realm_access.roles and resource_access.wrdesk-orchestrator.roles for the user
