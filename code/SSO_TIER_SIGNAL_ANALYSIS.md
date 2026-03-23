# SSO Token Roles as Authoritative Tier Signal — Integration Analysis

**Date:** 2025-03-12  
**Objective:** Add a non-breaking tier signal derived from SSO roles while preserving all existing behavior.  
**Scope:** Identify safe extension points only — no code changes proposed.

---

## Step 1 — Tier Resolution Points

### Functions Involved

| Function | Location | Purpose |
|----------|----------|---------|
| `extractUserInfoFromTokens()` | `session.ts:196-254` | Decodes id_token + access_token; extracts plan, roles, profile. Returns `SessionUserInfo`. |
| `extractRoles()` | `session.ts:115-143` | Extracts roles from a single JWT payload (realm_access + resource_access). |
| `extractPlanFromPayload()` | `session.ts:79-104` | Extracts plan from a single JWT payload (PLAN_CLAIM_KEYS). |
| `resolveTier()` | `capabilities.ts:57-105` | **Ultimate tier decision.** Plan primary, roles fallback. Returns `Tier`. |
| `mapRolesToTier()` | `capabilities.ts:119-162` | Maps roles → tier when plan absent/unrecognized. |
| `resolveRequestTier()` | `main.ts:105-118` | Per-request tier resolution. Calls `ensureSession()` → `resolveTier(plan, roles)`. |

### Ultimate Tier Decision

**`resolveTier(plan, roles)`** in `capabilities.ts` is the single function that decides the tier. All other code paths feed into it.

---

## Step 2 — Current Tier Decision Graph

```
resolveTier(wrdesk_plan, keycloakRoles):
│
├─ if wrdesk_plan present
│   ├─ WC_PLAN_ALIASES[normalized]? → return mapped (private→pro)
│   ├─ VALID_PLAN_TIERS.includes(normalized)? → return normalized
│   ├─ FUZZY_MAP matches? → return tier
│   └─ else → fallback to mapRolesToTier(roles)
│
└─ else (no plan)
    └─ return mapRolesToTier(keycloakRoles)
```

**mapRolesToTier(roles):**
```
Priority: enterprise > publisher_lifetime > publisher > pro > private_lifetime > private > free
Returns first matching role; else DEFAULT_TIER ('free')
```

**Data flow:**
```
session.userInfo = extractUserInfoFromTokens(tokens)
  → wrdesk_plan = planFromAccess || planFromId
  → roles = merged from id_token + access_token, deduplicated

resolveRequestTier()
  → session = ensureSession()
  → plan = session.userInfo.wrdesk_plan
  → roles = session.userInfo.roles || []
  → tier = resolveTier(plan, roles)
```

**Verified:** The logic matches exactly. No additional branches exist.

---

## Step 3 — Safe Extension Points

### Candidate Extension Points

| # | Location | Description | Risk |
|---|----------|-------------|------|
| **EP1** | `session.ts` — inside `extractUserInfoFromTokens()` | Compute `ssoTier` from `roles` before returning. Add to `SessionUserInfo`. | Low — additive only |
| **EP2** | `session.ts` — new helper `extractSsoTierFromRoles(roles)` | Pure function: roles → tier. Called from EP1 or EP3. | None — no side effects |
| **EP3** | `capabilities.ts` — inside `resolveTier()` | Add optional third param `ssoTier`; use as additional evidence before or after plan. | Low — optional param, backward compatible |
| **EP4** | `capabilities.ts` — new function `resolveTierWithSso(plan, roles, ssoTier?)` | Wrapper that calls `resolveTier` with ssoTier logic. | None — additive |
| **EP5** | `main.ts` — inside `resolveRequestTier()` | Compute `ssoTier` from `roles` before calling `resolveTier`. Pass to `resolveTier` if extended. | Low — single call site |
| **EP6** | `SessionUserInfo` interface | Add optional `sso_tier?: Tier` field. | None — optional |

**Recommended insertion order:**
1. EP2 (helper) — pure, testable
2. EP1 (session) — populate `sso_tier` in `SessionUserInfo`
3. EP6 (interface) — add field
4. EP3 or EP4 (capabilities) — integrate ssoTier into resolution
5. EP5 (main) — pass ssoTier from session to resolveTier

---

## Step 4 — Role Extraction

### Current Implementation

| Source | Extracted? | Location |
|--------|------------|----------|
| `realm_access.roles` | Yes | `session.ts:125-127` |
| `resource_access.wrdesk-orchestrator.roles` | Yes | `session.ts:131-136` |
| `resource_access.<other-client>.roles` | No | Only `wrdesk-orchestrator` |
| `groups` | No | Not extracted |

**Merge strategy:** Roles from both tokens (id_token + access_token) are merged and deduplicated (`session.ts:212-214`).

**Tier roles supported:** `publisher`, `publisher_lifetime`, `pro`, `enterprise`, `private`, `private_lifetime` — all mapped in `mapRolesToTier()`.

**Roles are reliable** when Keycloak includes them in the token. The fragility is that plan attributes may not be present; roles are already used as fallback.

---

## Step 5 — Capability Mapping

| Component | Location | Integration |
|-----------|----------|-------------|
| `vaultCapabilities.ts` | `packages/shared/src/vault/vaultCapabilities.ts` | `canAccessRecordType(tier, recordType, action)` |
| `RECORD_TYPE_MIN_TIER` | `handshake_context` → `publisher` | Tier must be ≥ publisher for HS Context |
| `canAccessCategory()` | Tier + legacy category | Used by vault HTTP handlers |
| `getCategoryOptionsForTier()` | Tier → UI options | Sidebar/create-dialog |

**Key:** All capability checks receive a single `tier` value. `Tier` is the union type from `capabilities.ts`. No changes needed to `vaultCapabilities.ts` — any new tier signal must feed into the same `resolveTier()` output so the final `Tier` value remains the single source.

**Integration:** The new `ssoTier` signal should influence the *input* to `resolveTier` or the *logic inside* `resolveTier`, not the capability layer. The capability layer continues to receive only `Tier`.

---

## Step 6 — Backward Compatibility Risks

### Risks if Role-Based Tier Signals Are Introduced

| Risk | Description | Mitigation |
|------|-------------|------------|
| **Legacy tokens without roles** | Some tokens may lack `realm_access` or `resource_access`. | ssoTier = undefined when no roles → treat as absent; existing plan/fallback unchanged |
| **Users with roles not matching plan** | Billing says Pro, Keycloak has publisher role (stale role). | ssoTier as **advisory** or **secondary** — never override plan when plan is present and valid |
| **Billing sync inconsistencies** | Plan = pro, roles = [publisher] (sync lag). | Define precedence: plan primary, ssoTier as upgrade evidence only when plan absent |
| **Role hierarchy confusion** | User has both pro and publisher. | `mapRolesToTier` already handles: publisher checked before pro |

### Recommended Signal Semantics

| Signal | Semantics |
|--------|-----------|
| **Primary** | `wrdesk_plan` (plan claim) — unchanged |
| **Secondary** | `keycloakRoles` → `mapRolesToTier` — existing fallback |
| **Advisory / Additional** | `ssoTier` — derived from roles, used as *additional evidence* when plan is absent or to *upgrade* tier when plan is lower than ssoTier |

**Safe approach:** ssoTier should be **secondary or advisory**, not primary. Use it to:
- Strengthen the role fallback (roles already feed mapRolesToTier)
- Or: when plan is absent, ssoTier could be used directly (equivalent to current mapRolesToTier)
- Or: when plan is present but ssoTier is higher, optionally upgrade (risky — could escalate if roles are stale)

**Conservative:** Use ssoTier only when plan is absent — i.e. it is redundant with current role fallback. The value is making the role-derived tier **explicit** and **traceable**, and potentially allowing future logic (e.g. "prefer ssoTier over plan when plan looks stale").

---

## Step 7 — Non-Breaking Tier Signal Design

### Proposed Internal Signal: `ssoTier`

**Definition:** `ssoTier = mapRolesToTier(roles)` — the tier derived solely from SSO roles.

**Passing alongside existing signals:**
- Option A: `resolveTier(plan, roles, ssoTier?)` — optional third param
- Option B: Keep `resolveTier(plan, roles)` — ssoTier is implicit (roles already used)
- Option C: `resolveTier(plan, roles, { ssoTier })` — options object for future extension

**Non-breaking:** Existing callers `resolveTier(plan, roles)` continue to work. New param is optional.

**Integration logic (advisory):**
```
if (plan present and valid)
  → return plan-derived tier  // unchanged
else
  → return mapRolesToTier(roles)  // ssoTier === this; explicit is redundant
```

**Integration logic (upgrade when plan absent):**
```
if (plan present and valid)
  → return plan-derived tier
else
  → return ssoTier ?? mapRolesToTier(roles) ?? DEFAULT_TIER
```
Here ssoTier is just a precomputed `mapRolesToTier(roles)` — no behavior change.

**Integration logic (upgrade when plan conflicts):**
```
// Risky — could escalate. Only if explicitly desired.
if (plan present and valid)
  effectiveTier = plan-derived
  if (ssoTier && TIER_LEVEL[ssoTier] > TIER_LEVEL[effectiveTier])
    return ssoTier  // upgrade
  return effectiveTier
else
  return ssoTier ?? mapRolesToTier(roles)
```

**Recommendation:** Start with **explicit ssoTier** as a precomputed value passed through the pipeline. No behavior change. Enables future logic (logging, debugging, optional upgrade) without risk.

---

## Step 8 — Minimal Code Insertion Locations

### Exact Insertion Points

| File | Location | Insertion |
|------|----------|-----------|
| **session.ts** | `SessionUserInfo` interface (~line 15) | Add `sso_tier?: Tier` (optional) |
| **session.ts** | `extractUserInfoFromTokens()` return (~line 247) | Compute `ssoTier = mapRolesToTier(roles)`; add to returned object. Requires import of `mapRolesToTier` from capabilities. No circular import: capabilities does not import session. |
| **capabilities.ts** | `resolveTier()` signature (~line 57) | Add optional `ssoTier?: Tier` param. Use when plan absent: `return ssoTier ?? mapRolesToTier(keycloakRoles)`. |
| **main.ts** | `resolveRequestTier()` (~line 110) | Pass `session.userInfo.sso_tier` as third arg to `resolveTier` (when populated). |

**Alternative (no resolveTier signature change):** Compute ssoTier in `resolveRequestTier` and pass as part of a "when plan absent" branch — but that would duplicate logic. Cleaner to have `resolveTier` accept optional ssoTier.

**Other call sites of resolveTier:**
- `main.ts:202` — `checkStartupSession()` — uses `session.userInfo`; would get sso_tier from session
- `main.ts:294` — `requestLogin()` — same
- `main.ts:3594` — RPC handler — `rpcSession.userInfo`; would get sso_tier
- `main.ts:4375` — another handler
- `main.ts:4859` — another handler

All read from `session.userInfo` or `rpcSession.userInfo`. If `sso_tier` is added to `SessionUserInfo`, these call sites would need to pass it to `resolveTier` only if we extend the signature. **Minimal change:** extend `resolveTier(plan, roles, ssoTier?)` and update all call sites to pass `userInfo.sso_tier` — or leave existing calls as `resolveTier(plan, roles)` (ssoTier undefined), which preserves current behavior.

**Truly minimal:** Only add `sso_tier` to `SessionUserInfo` and compute it in `extractUserInfoFromTokens`. Do not change `resolveTier` or any call site. The new signal exists for logging/debugging and future use. Zero behavior change.

---

## Summary

### 1. Current Tier Resolution Architecture

- **Extraction:** `extractUserInfoFromTokens` → plan (access_token first, then id_token), roles (merged from both)
- **Resolution:** `resolveTier(plan, roles)` — plan primary, `mapRolesToTier(roles)` fallback
- **Entry points:** `resolveRequestTier()`, `checkStartupSession()`, `requestLogin()`, RPC handlers, HTTP vault handlers

### 2. Locations Where Tier Is Determined

| Location | Function |
|----------|----------|
| `capabilities.ts:57` | `resolveTier()` — sole decision point |
| `capabilities.ts:119` | `mapRolesToTier()` — used when plan absent |
| `main.ts:105` | `resolveRequestTier()` — orchestrates per-request resolution |

### 3. Safe Extension Points

1. **session.ts** — Add `sso_tier` to `SessionUserInfo`; compute in `extractUserInfoFromTokens` via `mapRolesToTier(roles)`
2. **capabilities.ts** — Add optional `ssoTier` param to `resolveTier`; use when plan absent
3. **main.ts** — Pass `userInfo.sso_tier` to `resolveTier` at all call sites (optional — can defer)

### 4. Risks of Role-Based Signals

- Legacy tokens without roles → ssoTier undefined; no change
- Plan/role mismatch → keep plan primary; ssoTier advisory
- Billing sync lag → do not let ssoTier override valid plan

### 5. Minimal Code Insertion Locations

| File | Line | Change |
|------|------|--------|
| `session.ts` | 15-24 | Add `sso_tier?: Tier` to `SessionUserInfo` |
| `session.ts` | 247-253 | Compute and add `sso_tier: mapRolesToTier(roles)` to return |
| `capabilities.ts` | 57 | Add `ssoTier?: Tier` param; use in fallback branch |
| `main.ts` | 110-113 | Pass `session.userInfo.sso_tier` to `resolveTier` |

**Phase 1 (zero behavior change):** Session + interface only.  
**Phase 2 (integrate):** Extend `resolveTier` and pass ssoTier.
