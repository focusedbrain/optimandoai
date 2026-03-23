# WRDesk Plan Detection Architecture Audit

**Date:** 2025-03-12  
**Issue:** User with valid Publisher plan detected as Pro tier in WRVault; HS Context remains locked  
**Scope:** Plan resolution pipeline — diagnosis only (no fixes proposed)

---

## 1. Architecture Diagram — Plan Propagation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        PLAN ORIGIN (External to WRDesk)                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  WooCommerce / WordPress  →  Subscription DB  →  Keycloak User Attribute Sync            │
│  (Payment/Subscription)      (License store)      (wrdesk_plan or equivalent)            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        KEYCLOAK (auth.wrdesk.com)                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  • User Attribute: wrdesk_plan (or plan, tier, etc.)                                     │
│  • Realm roles: enterprise, publisher, publisher_lifetime, pro, private, private_lifetime  │
│  • Client roles: resource_access.wrdesk-orchestrator.roles                                │
│  • Mapper: User Attribute → JWT claim (id_token and/or access_token)                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        TOKEN REFRESH (session.ts)                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  refreshWithKeycloak(refreshToken) → { access_token, id_token?, expires_in }              │
│  Token source: id_token (preferred) || access_token                                       │
│  decodeJwtPayload(tokenToDecode) → extractUserInfo(payload)                               │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        CLAIM EXTRACTION (session.ts: extractUserInfo)                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  PLAN_CLAIM_KEYS (first match wins): wrdesk_plan, wrdesk_plans, user_plan, user_plans,     │
│    plan, plans, subscription, subscription_plan, tier, user_tier                          │
│  NESTED: user_attributes, attributes, custom_attributes, user_metadata                    │
│  ROLES: realm_access.roles + resource_access.wrdesk-orchestrator.roles                    │
│  Output: userInfo.wrdesk_plan, userInfo.roles                                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        TIER RESOLUTION (capabilities.ts: resolveTier)                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  1. PRIMARY: wrdesk_plan claim                                                            │
│     • WC_PLAN_ALIASES: private → pro, private_lifetime → pro                               │
│     • VALID_PLAN_TIERS: exact match                                                       │
│     • FUZZY_MAP: regex patterns (enterprise, publisher_lifetime, publisher, pro, etc.)      │
│  2. FALLBACK: mapRolesToTier(roles) — enterprise > publisher_lifetime > publisher > pro   │
│  3. FAIL-CLOSED: DEFAULT_TIER ('free') if neither provides valid tier                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (main.ts)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  resolveRequestTier() → ensureSession() → resolveTier(plan, roles) → Tier                   │
│  Called per-request for: /api/vault/status, /api/vault/items, /api/vault/item/create, etc. │
│  /api/vault/status response: { ...status, tier }                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        VAULT CAPABILITY GATE (vaultCapabilities.ts)                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  RECORD_TYPE_MIN_TIER: handshake_context → publisher                                      │
│  canAccessRecordType(tier, 'handshake_context', action) → true iff tier >= publisher       │
│  TIER_LEVEL: pro=3, publisher=4, publisher_lifetime=5, enterprise=6                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (vault-ui-typescript.ts)                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  getVaultStatus() → POST /api/vault/status → response.data                                 │
│  currentVaultTier = status.tier as VaultTier (set once at initVaultUI)                    │
│  getCategoryOptionsForTier(currentVaultTier) → filters HS Context for Publisher+          │
│  Header badge: tierBadge.textContent = currentVaultTier                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Identified Failure Points (Ranked by Probability)

### 2.1 HIGH — Keycloak Claim Mapping / Missing or Wrong wrdesk_plan

**Location:** Keycloak → JWT payload

**Mechanism:**
- `wrdesk_plan` is a custom Keycloak User Attribute that must be mapped to a JWT claim via a Protocol Mapper.
- If the mapper is not configured for the `wrdesk-orchestrator` client, or maps only to `access_token` (not `id_token`), the claim may be absent or wrong.
- `session.ts` prefers `id_token` for extraction: `tokenToDecode = tokens.id_token || tokens.access_token`. If Keycloak puts `wrdesk_plan` only in `access_token`, the app would use `id_token` which may lack it.

**Evidence:** Decoded JWT payload (id_token and access_token) for the affected user — check presence of `wrdesk_plan`, `plan`, `tier`, `wrdesk_tier` and their values.

---

### 2.2 HIGH — Keycloak User Attribute Not Updated

**Location:** Keycloak User Attribute (e.g. `wrdesk_plan`)

**Mechanism:**
- User upgrades from Pro to Publisher in WooCommerce/Payment system.
- Sync to Keycloak (User Attribute or role assignment) may be delayed, fail, or use a different attribute name.
- Keycloak keeps `wrdesk_plan = "pro"` or equivalent until next sync.

**Evidence:** Keycloak Admin Console → Users → [affected user] → Attributes. Verify `wrdesk_plan` (or equivalent) value.

---

### 2.3 HIGH — Plan Claim Absent → Fallback to Roles Only

**Location:** `session.ts` → `capabilities.ts` → `mapRolesToTier`

**Mechanism:**
- If `wrdesk_plan` is absent, `resolveTier` falls back to `mapRolesToTier(keycloakRoles)`.
- Roles: `realm_access.roles` + `resource_access.wrdesk-orchestrator.roles`.
- If the user has `pro` role but not `publisher` role (e.g. role not assigned on upgrade), `mapRolesToTier` returns `pro`.

**Evidence:** Session logs: `[SESSION] ⚠️ No plan claim found. Custom JWT claims:` and `[SESSION] ⚠️ Roles extracted:`. If plan is missing and roles are `["pro"]`, this explains Pro tier.

---

### 2.4 MEDIUM — Token Lifetime / Refresh Not Updating Claims

**Location:** `session.ts` → `ensureSession`

**Mechanism:**
- `ensureSession` returns cached `accessToken` and `cachedUserInfo` if token is valid (with 60s buffer).
- If user upgraded while token was still valid, cached JWT retains old claims until refresh.
- Token lifetime typically 5–15 minutes; refresh may not occur until near expiry.

**Evidence:** Session logs: `[SESSION][F] ensureSession: UNLOCKED (cached token valid, expiresAt=...)` and `[SESSION] Token refresh: hasIdToken=..., wrdesk_plan=..., roleCount=...`. Compare before/after refresh.

---

### 2.5 MEDIUM — FUZZY_MAP / Claim Value Ambiguity

**Location:** `capabilities.ts` → `resolveTier` → FUZZY_MAP

**Mechanism:**
- FUZZY_MAP order: `enterprise` → `publisher_lifetime` → `publisher` → `pro` → ...
- For `"pro publisher"`, `/publisher/i` matches first (publisher comes before pro in the loop), so returns `publisher` correctly.
- If the claim value is literally `"pro"` when it should be `"publisher"` (e.g. Keycloak sync error), the app correctly returns `pro`. The bug would be upstream.

**Evidence:** `[TIER] Resolved from plan claim (fuzzy "..." → pro)` — confirms fuzzy match and the exact input string.

---

### 2.6 MEDIUM — PLAN_CLAIM_KEYS Order / Conflicting Claims

**Location:** `session.ts` → `extractUserInfo`

**Mechanism:**
- First matching claim wins: `wrdesk_plan`, `wrdesk_plans`, `user_plan`, `plan`, `tier`, etc.
- If `wrdesk_plan: "pro"` (stale) and `plan: "publisher"` (from another source), `wrdesk_plan` is used first and returns `pro`.

**Evidence:** Session logs: `[SESSION] Plan found in claim "wrdesk_plan": pro` — confirms which claim was used and its value.

---

### 2.7 MEDIUM — Coordination Service Uses Different Claim Names

**Location:** `packages/coordination-service/src/auth.ts`

**Mechanism:**
- Coordination service uses `payload.tier` or `payload.wrdesk_tier` — not `wrdesk_plan`.
- Main app uses `wrdesk_plan`. If Keycloak mappers use different names for different clients, inconsistency could occur.

**Note:** Coordination service is not in the main vault path; its tier is for relay/coordination. The vault tier comes from `main.ts` → `resolveRequestTier()` in `session.ts` only.

---

### 2.8 LOW — Frontend Tier Not Refreshed

**Location:** `vault-ui-typescript.ts` → `currentVaultTier`

**Mechanism:**
- `currentVaultTier` is set once in `initVaultUI` from `status.tier`.
- `renderUnlockScreen` calls `getVaultStatus()` but does not update `currentVaultTier`.
- If user opens vault when tier is Pro, then refreshes backend, the UI would not update until vault is closed and reopened.

**Note:** This only affects display if the backend is correct. If backend returns Pro, the issue is upstream.

---

### 2.9 LOW — WooCommerce → Keycloak Sync Misconfiguration

**Location:** External (WooCommerce / WordPress sync)

**Mechanism:**
- WooCommerce uses `private` for Pro; `WC_PLAN_ALIASES` maps it to `pro`.
- If Publisher is incorrectly synced as `private` or `pro`, the app would resolve to Pro.

**Evidence:** Sync logic and Keycloak payload for Publisher users.

---

## 3. Most Probable Root Cause

**Primary hypothesis:** Keycloak `wrdesk_plan` (or equivalent) is either:
- **absent** for the Publisher user, or
- **set to `"pro"`** (stale or wrong sync),

and the role fallback `mapRolesToTier` returns `pro` because the user has `pro` role but not `publisher` role (or the Publisher role is not assigned).

**Secondary hypothesis:** `wrdesk_plan` is present only in `access_token`, while `session.ts` prefers `id_token` for extraction. If `id_token` lacks the claim, extraction falls back to roles, which may be Pro-only.

---

## 4. Evidence Required to Confirm

| Evidence | Source | Purpose |
|----------|--------|---------|
| Decoded JWT payload (id_token) | `session.ts` logs or manual decode | Verify presence and value of `wrdesk_plan`, `plan`, `tier`, `wrdesk_tier` |
| Decoded JWT payload (access_token) | Same | Compare id_token vs access_token claims |
| Plan claim extraction log | `[SESSION] Plan found in claim "X": Y` | Confirm which claim was used and its value |
| Roles extraction log | `[SESSION] ⚠️ Roles extracted: [...]` | Confirm role fallback when plan absent |
| Tier resolution log | `[TIER] resolveRequestTier: wrdesk_plan=X, roleCount=N, resolved=Y` | Confirm tier resolution path |
| `POST /api/vault/status` response | Network tab or `get-logs.ps1` | Confirm `tier` value returned to frontend |
| Keycloak User Attribute | Keycloak Admin → Users → Attributes | Verify `wrdesk_plan` (or equivalent) value |
| Keycloak Protocol Mapper | Keycloak Admin → Clients → wrdesk-orchestrator → Mappers | Verify token type (id_token vs access_token) for plan claim |

---

## 5. Components Involved in the Failure

| Component | File(s) | Role |
|-----------|---------|------|
| Keycloak | External | Source of wrdesk_plan / roles |
| Token refresh | `session.ts`, `refresh.ts` | Token acquisition and decode |
| Claim extraction | `session.ts` (extractUserInfo, extractRoles) | Plan and roles from JWT |
| Tier resolution | `capabilities.ts` (resolveTier, mapRolesToTier) | Plan/roles → Tier |
| Backend auth | `main.ts` (resolveRequestTier, ensureSession) | Per-request tier |
| Vault status | `main.ts` POST /api/vault/status | Returns tier to client |
| Capability gate | `vaultCapabilities.ts` | handshake_context requires publisher |
| Vault UI | `vault-ui-typescript.ts` | Displays tier, gates HS Context |

---

## 6. Summary

The plan resolution pipeline is:

1. **Keycloak** → JWT claims (`wrdesk_plan` or roles)
2. **session.ts** → Extract plan and roles from id_token (preferred) or access_token
3. **capabilities.ts** → `resolveTier(plan, roles)` → Tier
4. **main.ts** → `resolveRequestTier()` per request → `{ ...status, tier }`
5. **vault-ui-typescript.ts** → `currentVaultTier = status.tier` → gating

The most likely failure points are:

1. **Keycloak** not providing `wrdesk_plan` or providing it as `pro`
2. **Plan claim** absent or wrong → fallback to roles → only `pro` role present
3. **id_token vs access_token** — claim present only in access_token while id_token is preferred

Gathering the evidence in Section 4 will pinpoint the exact failure stage.
