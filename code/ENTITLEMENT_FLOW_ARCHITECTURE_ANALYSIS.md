# WRDesk Entitlement Flow — Architecture Analysis

**Goal:** Map the current tier/entitlement flow to enable migration to:
- Authority: Keycloak roles only
- Enforcer: Orchestrator
- UI: display only
- No relay / no realtime push / no tier overrides
- 60-second refresh acceptable
- No `free` as error fallback; use last known good tier or `unknown`

---

## A) Current Authority Model

**Source of truth:** JWT claims from Keycloak (access_token + id_token), consumed by the Orchestrator (Electron main process).

| Signal | Source | Priority |
|--------|--------|----------|
| **wrdesk_plan** | JWT claim (PLAN_CLAIM_KEYS) | Primary — `tierFromPlanClaim()` |
| **sso_tier** | `extractSsoTierFromRoles(roles)` | Fallback when plan absent |
| **roles** | `realm_access.roles` + `resource_access.wrdesk-orchestrator.roles` | Fallback via `mapRolesToTier()` |

**Plan claim keys** (`session.ts:54-70`): `wrdesk_plan`, `wrdesk_plans`, `wrdesk-plan`, `wrdeskPlan`, `wrdeskTier`, `user_plan`, `plan`, `plans`, `subscription`, `subscription_plan`, `subscriptionTier`, `subscription-tier`, `tier`, `user_tier`.

**WooCommerce sync:** External to this repo. Plan/roles come from Keycloak tokens. WRDesk does not read WooCommerce directly. `WC_PLAN_ALIASES` in `capabilities.ts` maps `private` → `pro`, `private_lifetime` → `pro` for plan claim values only.

### 1. WordPress / WooCommerce Sync (External)

**Not in this repo.** The sync logic is external (WordPress plugin, cron, or manual). From docs:

- **Expected flow:** WooCommerce subscription → Keycloak user attribute (`wrdesk_plan`) and/or realm/client roles (`pro`, `publisher`, etc.).
- **WRDesk reads:** `wrdesk_plan` and roles from JWT only. No direct WooCommerce or WordPress access.
- **Relay/realtime:** The coordination service can receive `tier_changed` via `POST /beap/system-event` with `event: 'tier_changed'`. That would be triggered by external billing/sync when plan changes. No such sync code exists in this repo.

---

## B) Current Orchestrator Tier Flow

### 1. `ensureSession(forceRefresh?)`
- **File:** `apps/electron-vite-project/src/auth/session.ts`
- **Input:** `forceRefresh` (default false)
- **Output:** `{ accessToken: string | null; userInfo?: SessionUserInfo }`
- **Flow:** Returns cached token if valid (60s buffer). Else loads refresh token, calls `refreshWithKeycloak()`, extracts `cachedUserInfo` via `extractUserInfoFromTokens()`, returns it.
- **Fallbacks:** No refresh token → returns `{ accessToken: null }`. Refresh fails → clears token, returns `{ accessToken: null }`.

### 2. `extractUserInfoFromTokens(tokens)`
- **File:** `apps/electron-vite-project/src/auth/session.ts:199-266`
- **Input:** `{ access_token, id_token? }`
- **Output:** `SessionUserInfo` with `wrdesk_plan`, `roles`, `sso_tier`, `canonical_tier`
- **Flow:** Plan from access_token first, then id_token. Roles merged from both. `sso_tier = extractSsoTierFromRoles(roles)`. `canonical_tier = resolveTier(plan, roles, ssoTier)`.

### 3. `resolveTier(wrdesk_plan, keycloakRoles, ssoTier?)`
- **File:** `apps/electron-vite-project/src/auth/capabilities.ts:123-153`
- **Input:** Plan string, roles array, optional ssoTier
- **Output:** `Tier`
- **Flow:** `tierFromPlan` vs `tierFromRoles`; higher `TIER_LEVEL` wins. `canonicalTier ?? DEFAULT_TIER`.
- **Fallbacks:** `DEFAULT_TIER` ('free') when neither provides valid tier.

### 4. `resolveRequestTier()`
- **File:** `apps/electron-vite-project/electron/main.ts:104-120`
- **Input:** None
- **Output:** `Promise<Tier>`
- **Flow:** `ensureSession()` → if no `accessToken` or `userInfo` → return `DEFAULT_TIER`. Else `tier = session.userInfo.canonical_tier ?? resolveTier(...)`. Updates `currentTier` (display cache). Returns tier.
- **Fallbacks:** No session → `DEFAULT_TIER` ('free').

### 5. `POST /api/vault/status`
- **File:** `apps/electron-vite-project/electron/main.ts:5822-5839`
- **Input:** POST body (optional)
- **Output:** `{ success, data: { ...status, tier }, sessionToken? }`
- **Flow:** `tier = await resolveRequestTier()`, `status = await vaultService.getStatus()`, `res.json({ success: true, data: { ...status, tier }, ... })`.
- **Fallbacks:** None; tier comes from `resolveRequestTier`.

### Where `free` is returned on error

| Location | Condition | Returns |
|----------|-----------|---------|
| `main.ts:108` | `!session.accessToken \|\| !session.userInfo` | `DEFAULT_TIER` ('free') |
| `main.ts:213` | `requestLogin()` catch | `currentTier = DEFAULT_TIER` |
| `main.ts:219` | `requestLogin()` catch | `currentTier = DEFAULT_TIER` |
| `main.ts:331` | `requestLogin()` catch | `currentTier = DEFAULT_TIER` |
| `capabilities.ts:139` | `canonicalTier ?? DEFAULT_TIER` | 'free' |
| `capabilities.ts:172` | `mapRolesToTier([])` | 'free' |
| `capabilities.ts:209` | No tier role in `mapRolesToTier` | 'free' |

### `lastKnownGoodTier` / `unknown`

- **lastKnownGoodTier:** Does not exist. On session failure, code returns `DEFAULT_TIER` ('free') immediately.
- **unknown:** Used only in `coordinationWs.ts:393` for `systemEvent.tier ?? 'unknown'` when broadcasting TIER_CHANGED. Not used as a tier resolution fallback.

---

## C) Current UI Tier Flow

### Vault UI (`vault-ui-typescript.ts`)

| File | Function | Where `currentVaultTier` comes from | UI overrides? |
|------|----------|-------------------------------------|---------------|
| `vault-ui-typescript.ts` | `initVaultUI()` | `status = await getVaultStatus()` → `status.tier` | No |
| `vault-ui-typescript.ts` | `initVaultUI()` | If `!status.tier` → logs warning, keeps default `'free'` | No — only logs |
| `vault-ui-typescript.ts` | `buildSidebarCategoriesHTML()` | Uses `currentVaultTier` | No |
| `vault-ui-typescript.ts` | `getCategoryOptionsForTier(currentVaultTier)` | Same value | No |

**Module-level:** `let currentVaultTier: VaultTier = 'free'` (line 22). Set once in `initVaultUI` from `status.tier`. No periodic refresh. `renderUnlockScreen` does not call `getVaultStatus` again; tier is not updated until vault is closed and reopened.

**Capability gating:** `canAccessCategory(tier, cat)`, `getCategoryOptionsForTier(currentVaultTier)` — both use the same `currentVaultTier` from backend. Backend also enforces via `resolveRequestTier()` on every vault route.

**Local storage:** Theme only (`optimando-ui-theme`). No cached UI tier.

### Background `authTier`

- **File:** `background.ts:936` — on `TIER_CHANGED`: `chrome.storage.local.set({ authTier: data.tier ?? 'free' })`
- **File:** `background.ts:2156` — `authTier: waitData.tier || 'free'`
- **Source:** Pushed from Electron via `broadcastToExtensions({ type: 'TIER_CHANGED', tier })` (realtime path) or from auth status responses.

---

## D) Remaining Relay/Realtime Leftovers

| File | Symbol | Active? | Notes |
|------|--------|---------|-------|
| `coordinationWs.ts` | `tier_changed` handler | **ACTIVE** | On `system_event` with `event === 'tier_changed'`, calls `ensureSession(true)`, then `broadcastToExtensions({ type: 'TIER_CHANGED', tier })` |
| `coordinationWs.ts` | `pendingContextSyncBuffer` | **ACTIVE** | For context sync capsules, not tier |
| `background.ts` | `TIER_CHANGED` handler | **ACTIVE** | Sets `authTier` in storage, broadcasts to runtime |
| `main.ts` | `broadcastToExtensions` | **ACTIVE** | Used by coordinationWs tier_changed path |
| `main.ts` | `createCoordinationWsClient` | **ACTIVE** | WebSocket to relay; receives tier_changed |
| `packages/coordination-service` | `pushSystemEvent` | **ACTIVE** | External service; receives POST with `event: 'tier_changed'` |
| `packages/coordination-service` | `wrdesk_tier` / `tier` | **ACTIVE** | Used in auth.ts for coordination service identity |
| `getActiveAdapter.ts` | — | N/A | No `pendingTierOverride` |
| `main.ts` | — | N/A | No `pendingTierOverride` (removed in rollback) |

**`_debug`:** Only in `beap-messages/services/beapCrypto.ts` (AAD/signing debug). No `_debug` in `/api/vault/status` response in current codebase (removed in rollback).

---

## E) Remaining Localhost Transport Problems

| File | Function/Context | Endpoint | Bypasses background? |
|------|------------------|----------|------------------------|
| `getActiveAdapter.ts` | `checkElectronAvailability()` | `GET http://127.0.0.1:51248/api/orchestrator/status` | **YES** — direct fetch |
| `getActiveAdapter.ts` | `createPostgresProxyAdapter()` | `GET/POST http://127.0.0.1:51248/api/db/*` | **YES** — direct fetch |
| `OrchestratorSQLiteAdapter.ts` | `connect()`, `get()`, `set()`, etc. | `POST/GET http://127.0.0.1:51248/api/orchestrator/*` | **YES** — direct fetch |
| `migration.ts` | `checkSQLiteAvailability()` | `GET http://127.0.0.1:51248/api/orchestrator/status` | **YES** — direct fetch |
| `BackendConfigLightbox.tsx` | `checkDesktopApp()` | `GET http://127.0.0.1:51248/api/orchestrator/status` | **YES** — direct fetch (fallback after BG check) |
| `background.ts` | `VAULT_HTTP_API` handler | `POST http://127.0.0.1:51248/api/vault/*` | **NO** — background does fetch |
| `background.ts` | `isElectronRunning()`, `isElectronReady()` | `GET http://127.0.0.1:51248/api/health`, `/api/orchestrator/status` | **NO** — background |
| `background.ts` | Various handlers | `/api/orchestrator/*`, `/api/email/*`, etc. | **NO** — background |

**Context of direct callers:**
- `getActiveAdapter`: Called from `storageWrapper` → used by storage operations (background or extension pages).
- `OrchestratorSQLiteAdapter`: Returned by `getActiveAdapter` when Electron available; used by same caller.
- `migration.ts`: Called during migration (likely background or options page).
- `BackendConfigLightbox.tsx`: React component in extension UI (sidepanel/dashboard).

---

## F) Main Architectural Problems

1. **`free` as error fallback** — `resolveRequestTier()` returns `DEFAULT_TIER` ('free') when session is missing or refresh fails. This grants free-tier capabilities on error instead of failing closed with `unknown` or last known good.

2. **No last known good tier** — On token refresh failure or missing session, there is no retention of the previous tier. Immediate fallback to `free` can incorrectly unlock features.

3. **Realtime tier push still active** — `tier_changed` via coordination WebSocket triggers `ensureSession(true)` and `broadcastToExtensions(TIER_CHANGED)`. This path depends on relay and adds complexity; target model is 60s polling only.

4. **Direct localhost fetches bypass background** — `getActiveAdapter`, `OrchestratorSQLiteAdapter`, `migration.ts`, `BackendConfigLightbox` call `127.0.0.1:51248` directly. Content scripts or pages may hit CSP; routing through background would centralize and simplify.

5. **Vault UI tier set once** — `currentVaultTier` is set only in `initVaultUI`. No refresh on unlock, no 60s poll. Tier can become stale until vault is reopened.

---

## G) Minimum Safe Migration Path

1. **Introduce `lastKnownGoodTier` in main.ts** — Module-level variable updated on every successful `resolveRequestTier()`. When session fails, return `lastKnownGoodTier ?? 'unknown'` instead of `DEFAULT_TIER`.

2. **Add `unknown` as valid Tier** — Extend `Tier` type and `canAccessCategory` / `canAccessRecordType` to treat `unknown` as most restrictive (no premium access).

3. **Replace `free` fallback in `resolveRequestTier`** — When `!session.accessToken || !session.userInfo`, return `lastKnownGoodTier ?? 'unknown'` instead of `DEFAULT_TIER`.

4. **Remove `tier_changed` handling in coordinationWs** — Delete the `system_event` branch for `tier_changed` (or make it a no-op). Stop calling `broadcastToExtensions(TIER_CHANGED)` from this path.

5. **Remove TIER_CHANGED handler in background** — Or reduce to a no-op. Tier will come from `/api/vault/status` and auth status only.

6. **Add 60s tier refresh in Vault UI** — After `initVaultUI`, start `setInterval(() => getVaultStatus().then(s => { if (s.tier) currentVaultTier = s.tier })`, 60000). Update badge and sidebar when tier changes.

7. **Route localhost through background** — Add `ORCHESTRATOR_HTTP_API` (or similar) handler in background; replace direct fetches in `getActiveAdapter`, `OrchestratorSQLiteAdapter`, `migration.ts`, `BackendConfigLightbox` with `chrome.runtime.sendMessage` to background.

8. **Switch to roles-first resolution** — In `resolveTier`, prefer `mapRolesToTier(roles)` over `tierFromPlanClaim(wrdesk_plan)` when both exist. Align with “Keycloak roles only” as authority. (Requires Keycloak roles to be correctly synced from WooCommerce.)
