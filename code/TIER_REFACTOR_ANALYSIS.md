# Tier Logic — Full Codebase Analysis for Refactor Safety

**Date:** 2025-03-12  
**Goal:** Identify all tier decision points and dependencies to enable safe refactor to a single source of truth.  
**Scope:** Analysis only — no code changes.

---

## Step 1 — Tier Decision Points

### 1.1 Core Tier Resolution Functions

| Location | Function | Purpose |
|----------|----------|---------|
| `apps/electron-vite-project/src/auth/capabilities.ts` | `resolveTier(plan?, roles?, ssoTier?)` | **Ultimate tier decision.** Plan primary → ssoTier fallback → mapRolesToTier. |
| `apps/electron-vite-project/src/auth/capabilities.ts` | `mapRolesToTier(roles)` | Maps roles → tier when plan absent. Priority: enterprise > publisher_lifetime > publisher > pro > private_lifetime > private > free. |
| `apps/electron-vite-project/src/auth/capabilities.ts` | `extractSsoTierFromRoles(roles)` | Extracts enterprise/publisher/pro from roles. Returns undefined for other roles. |
| `apps/electron-vite-project/electron/main.ts` | `resolveRequestTier()` | Per-request orchestrator. Calls ensureSession() → resolveTier(plan, roles, sso_tier). |

### 1.2 Tier Evaluation Call Sites

| File | Line | Context |
|------|------|---------|
| `main.ts` | 113 | resolveRequestTier() — HTTP vault handlers |
| `main.ts` | 202 | checkStartupSession() — startup tier |
| `main.ts` | 294 | requestLogin() — post-login tier |
| `main.ts` | 3593-3597 | RPC handler — vault.bind auth gate (rpcTier) |
| `main.ts` | 4376 | WebSocket AUTH_STATUS — re-resolve tier |
| `main.ts` | 4787 | **HTTP SSO callback** — `resolve(session?.wrdesk_plan, session?.roles ?? [])` — **missing sso_tier** |
| `main.ts` | 4860 | HTTP auth status — re-resolve tier |
| `main.ts` | 5743, 5828, 5863, 5905, 5922, 5946, 5974, 5993, 6025, 6042, 6066, 6090, 6122, 6144 | All vault HTTP handlers — resolveRequestTier() |

### 1.3 Tier-Dependent Logic (Non-Resolution)

| File | Pattern | Usage |
|------|---------|-------|
| `session.ts` | `wrdesk_plan`, `sso_tier` | SessionUserInfo fields; extracted from JWT |
| `session.ts` | `extractSsoTierFromRoles(roles)` | Computes sso_tier in extractUserInfoFromTokens |
| `main.ts` | `currentTier` | Display-only cache (tray, IPC). **Never** used for vault access control. |
| `main.ts` | `plan: (userInfo.wrdesk_plan as any) \|\| 'free'` | sessionFromClaims (lines 2070, 3400) — passes raw wrdesk_plan to handshake |
| `handshake/ipc.ts` | `session.plan === 'enterprise' \|\| 'publisher' \|\| 'publisher_lifetime'` | resolveProfileIdsToContextBlocks — tier check for HS Context |
| `handshake/types.ts` | `SSOSession.plan` | Type: 'free' \| 'pro' \| 'publisher' \| 'enterprise' |
| `handshake/sessionFactory.ts` | `claims.plan` | sessionFromClaims — expects plan from caller |
| `vault/service.ts` | `canAccessCategory(tier, ...)` | All item CRUD, list, search, export, HS profiles |
| `vault/documentService.ts` | `canAccessRecordType(tier, ...)` | Document operations |
| `vault/rpc.ts` | `handleVaultRPC(method, params, tier)` | RPC receives tier from main.ts WebSocket handler |
| `packages/shared/vault/vaultCapabilities.ts` | `canAccessRecordType`, `canAccessCategory`, `canAttachContext` | Capability gating |

### 1.4 Role Checks (Indirect)

No direct `roles.includes("publisher")` etc. in application code. Role-to-tier mapping is encapsulated in:
- `mapRolesToTier()` — uses `normalizedRoles.includes('enterprise')`, `includes('publisher')`, etc.
- `extractSsoTierFromRoles()` — uses `normalized.includes('enterprise')`, `includes('publisher')`, `includes('pro')`) — only these three.

---

## Step 2 — Tier Sources

| Source | Location | Format | Used By |
|--------|----------|--------|---------|
| **Plan claims (JWT)** | session.ts: extractPlanFromPayload | PLAN_CLAIM_KEYS: wrdesk_plan, wrdesk-plan, plan, subscription_plan, etc. | resolveTier (primary) |
| **Roles (JWT)** | session.ts: extractRoles | realm_access.roles + resource_access.wrdesk-orchestrator.roles | mapRolesToTier, extractSsoTierFromRoles |
| **sso_tier** | session.ts: extractUserInfoFromTokens | extractSsoTierFromRoles(roles) → Tier \| undefined | resolveTier (fallback when plan absent) |
| **Session cache** | session.ts: cachedUserInfo | SessionUserInfo (wrdesk_plan, roles, sso_tier) | ensureSession() → resolveRequestTier |
| **WooCommerce** | capabilities.ts: WC_PLAN_ALIASES | private → pro, private_lifetime → pro | resolveTier (plan claim only) |
| **Database** | None | — | Tier is not stored in DB |

**Note:** WooCommerce sync is external. WRDesk does not read from WooCommerce directly. Plan/roles come from Keycloak tokens.

---

## Step 3 — Tier Flow (Runtime Pipeline)

### Primary Path (WRVault)

```
Keycloak SSO (tokens)
  → refreshWithKeycloak() / loginWithKeycloak()
  → extractUserInfoFromTokens(tokens)
      → plan = planFromAccess || planFromId
      → roles = merged from id_token + access_token
      → sso_tier = extractSsoTierFromRoles(roles)
  → cachedUserInfo (SessionUserInfo)
  → ensureSession() returns { accessToken, userInfo }
  → resolveRequestTier()
      → plan = session.userInfo.wrdesk_plan
      → roles = session.userInfo.roles || []
      → tier = resolveTier(plan, roles, session.userInfo.sso_tier)
  → resolveTier():
      1. if plan valid → return plan-derived tier
      2. if !plan && ssoTier → return ssoTier
      3. else → mapRolesToTier(roles)
  → Tier
```

### Downstream Consumers

| Consumer | Path | Tier Source |
|----------|------|--------------|
| **POST /api/vault/status** | resolveRequestTier() → res.json({ ...status, tier }) | Per-request |
| **Vault HTTP handlers** (list, create, get, update, delete, etc.) | resolveRequestTier() → canAccessCategory(tier, ...) | Per-request |
| **Vault RPC (WebSocket)** | ensureSession() → resolveTier(plan, roles, sso_tier) → handleVaultRPC(..., tier) | Per-message |
| **Extension UI** | GET /api/auth/status → response.tier → authTier | Cached in background |
| **Vault UI (extension)** | POST /api/vault/status → status.tier → currentVaultTier | Set on status fetch |
| **Handshake SSOSession** | sessionFromClaims({ plan: userInfo.wrdesk_plan \|\| 'free' }) | Raw wrdesk_plan, not resolved tier |
| **Handshake resolveProfileIdsToContextBlocks** | session.plan (from SSOSession) | Uses plan directly; checks enterprise/publisher/publisher_lifetime |

### Inconsistency: Handshake Uses plan, Not Resolved Tier

- `sessionFromClaims` receives `plan: userInfo.wrdesk_plan || 'free'` — raw plan claim.
- `resolveProfileIdsToContextBlocks` checks `session.plan === 'enterprise' || 'publisher' || 'publisher_lifetime'`.
- If plan is missing but user has publisher role, sso_tier would be publisher, but session.plan would be 'free'.
- **Result:** Handshake HS Context logic may incorrectly deny Publisher users when plan is missing.

### Inconsistency: HTTP SSO Callback Missing sso_tier

- Line 4787: `resolve(session?.wrdesk_plan, session?.roles ?? [])` — **does not pass sso_tier**.
- Session from updateSess has sso_tier. This path should pass it for consistency.

---

## Step 4 — Feature Gating

### 4.1 Capability Layer (packages/shared/vault/vaultCapabilities.ts)

| File | Function | Gate |
|------|----------|------|
| vaultCapabilities.ts | `canAccessRecordType(tier, recordType, action)` | Tier ≥ RECORD_TYPE_MIN_TIER[recordType] |
| vaultCapabilities.ts | `canAccessCategory(tier, category, action)` | Tier ≥ min for LEGACY_CATEGORY_TO_RECORD_TYPE[category] |
| vaultCapabilities.ts | `canAttachContext(tier, policy, target)` | Tier must allow handshake_context share |
| vaultCapabilities.ts | `getCategoryOptionsForTier(tier)` | Filters categories by tier |
| vaultCapabilities.ts | `RECORD_TYPE_MIN_TIER` | handshake_context → publisher; human_credential → pro; etc. |
| vaultCapabilities.ts | `TIER_LEVEL` | Numeric ordering for tier comparison |

### 4.2 Record Type Gating

| Record Type | Min Tier |
|-------------|----------|
| automation_secret | free |
| human_credential |
| pii_record |
| document |
| custom | pro |
| handshake_context | publisher |

### 4.3 Feature-Specific Gating

| Feature | Location | Gate |
|---------|----------|------|
| **HS Context** | vaultCapabilities.ts, handshake/ipc.ts | handshake_context record type; session.plan in resolveProfileIdsToContextBlocks |
| **Password Manager** | RECORD_TYPE_MIN_TIER[human_credential] | pro |
| **Document Vault** | RECORD_TYPE_MIN_TIER[document] | pro |
| **HS Context Profiles** | vaultService.listHsProfiles(tier) | tier passed; canAccessRecordType checks |
| **canAttachContext** | canAccessRecordType(tier, 'handshake_context', 'share') | publisher+ |

### 4.4 Extension UI Gating

| File | Usage |
|------|-------|
| extension-chromium/src/vault/vault-ui-typescript.ts | currentVaultTier from status.tier; getCategoryOptionsForTier(currentVaultTier); buildSidebarCategoriesHTML(currentVaultTier) |
| extension-chromium/src/handshake/components/* | hasPublisherTier prop — gates HS Context UI |
| extension-chromium/src/background.ts | authTier from AUTH_STATUS response |
| extension-chromium/src/popup-chat.tsx | setUserTier from status response |

---

## Step 5 — External Dependencies (Environments)

| Environment | Tier Source | Consistency |
|-------------|-------------|-------------|
| **Electron orchestrator** | resolveRequestTier(), resolveTier() | Single source: capabilities.ts |
| **Browser extension** | Receives tier from HTTP API (auth status, vault status) | Derived from orchestrator |
| **Backend API** | main.ts HTTP handlers — all resolveRequestTier() | Consistent |
| **Shared packages** | vaultCapabilities.ts — receives tier as param | No tier resolution; pure gating |
| **Handshake** | sessionFromClaims(plan: wrdesk_plan) | **Uses plan, not resolved tier** — potential inconsistency |

**Extension does not resolve tier.** It receives tier from the orchestrator via HTTP. All tier resolution happens in the Electron main process.

---

## Step 6 — Refactor Safety Assessment

### 6.1 Moving to Roles as Single Authority

**Proposed change:** Use roles as the single source of truth; deprecate plan claim for tier resolution.

| Risk | Assessment |
|------|-------------|
| **Legacy tokens without roles** | Some tokens may lack realm_access/resource_access. | **HIGH** — Would downgrade to free. Need fallback to plan for backward compatibility. |
| **WooCommerce plan sync** | Billing sync may set wrdesk_plan but not roles. | **HIGH** — If roles-first, users with plan but no role would be downgraded. |
| **Plan/role mismatch** | User has plan=pro, roles=[publisher] (sync lag). | **MEDIUM** — Roles-first would upgrade. Plan-first (current) keeps pro. |
| **Handshake SSOSession** | sessionFromClaims uses plan. | **MEDIUM** — Would need to pass resolved tier instead of plan. |
| **extractSsoTierFromRoles** | Only maps enterprise, publisher, pro. | **LOW** — publisher_lifetime, private, private_lifetime fall through to mapRolesToTier. |

### 6.2 Safe Refactor Prerequisites

1. **Keycloak must assign roles consistently** — All users with valid plan must have corresponding role (publisher, pro, enterprise).
2. **Billing sync must assign roles** — WooCommerce → Keycloak sync must set both attributes and roles.
3. **Legacy token handling** — Keep plan fallback for tokens without roles.
4. **Handshake session** — Change sessionFromClaims to accept resolved tier, or derive from resolveTier before building session.

### 6.3 Recommended Refactor Strategy

| Phase | Action | Risk |
|-------|--------|------|
| **1** | Fix HTTP SSO callback to pass sso_tier to resolveTier | Low |
| **2** | Change sessionFromClaims to use resolved tier instead of raw plan | Medium — requires callers to pass tier |
| **3** | Audit Keycloak: ensure all plans have corresponding roles | External |
| **4** | Consider roles-first with plan fallback (invert priority) | High — only after phase 1–3 |

### 6.4 What Must Not Break

- Feature gating (canAccessCategory, canAccessRecordType) — receives tier; unchanged.
- API response format — tier stays in status, auth responses.
- Legacy tokens — plan fallback must remain for tokens without roles.
- WooCommerce — Billing sync must continue to work; if sync writes plan only, plan fallback is required.

---

## Summary

### 1. All Tier Logic Locations

- **Resolution:** capabilities.ts (resolveTier, mapRolesToTier, extractSsoTierFromRoles)
- **Orchestration:** main.ts (resolveRequestTier, 6 direct resolveTier call sites, 17+ resolveRequestTier call sites)
- **Extraction:** session.ts (extractUserInfoFromTokens, extractPlanFromPayload, extractRoles)
- **Gating:** vaultCapabilities.ts, vault/service.ts, vault/documentService.ts, vault/rpc.ts
- **Handshake:** handshake/ipc.ts (resolveProfileIdsToContextBlocks), sessionFactory.ts, sessionFromClaims callers
- **Extension:** vault-ui-typescript.ts (currentVaultTier), background.ts (authTier)

### 2. Tier Source Signals

| Signal | Source | Priority |
|--------|--------|----------|
| wrdesk_plan | JWT (PLAN_CLAIM_KEYS) | Primary |
| sso_tier | extractSsoTierFromRoles(roles) | Fallback when plan absent |
| roles | JWT (realm_access + resource_access) | Fallback via mapRolesToTier |

### 3. Tier Decision Functions

- `resolveTier(plan, roles, ssoTier)` — single decision point
- `mapRolesToTier(roles)` — used when plan absent/unrecognized
- `extractSsoTierFromRoles(roles)` — precomputed role-derived tier

### 4. Feature Gating Files

- `packages/shared/src/vault/vaultCapabilities.ts` — canAccessRecordType, canAccessCategory, canAttachContext
- `apps/electron-vite-project/electron/main/vault/service.ts` — canAccessCategory on all item ops
- `apps/electron-vite-project/electron/main/vault/documentService.ts` — canAccessRecordType
- `apps/electron-vite-project/electron/main/vault/types.ts` — re-exports vaultCapabilities
- `apps/extension-chromium/src/vault/vault-ui-typescript.ts` — getCategoryOptionsForTier, sidebar filtering

### 5. Refactor Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Roles-only would break legacy tokens | HIGH | Keep plan fallback |
| WooCommerce sync may not set roles | HIGH | Verify sync; keep plan fallback |
| Handshake uses plan not tier | MEDIUM | Pass resolved tier to sessionFromClaims |
| HTTP SSO callback missing sso_tier | LOW | Add third param |

**Conclusion:** Moving to roles as single authority is **not safe** without:
1. Keycloak/billing sync ensuring roles are always set for paid plans
2. Legacy plan fallback for tokens without roles
3. Handshake session using resolved tier instead of raw plan
