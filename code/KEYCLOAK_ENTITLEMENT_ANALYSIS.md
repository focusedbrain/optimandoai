# Keycloak Entitlement Configuration Analysis

**Date:** 2025-03-12  
**Issue:** Publisher entitlement not present in issued tokens; tier resolves to "pro"  
**Scope:** Identify Keycloak configuration issues — diagnosis only (no fixes proposed)

---

## Context

- **Keycloak:** `https://auth.wrdesk.com/realms/wrdesk`
- **Client:** `wrdesk-orchestrator`
- **Billing source:** WooCommerce/WordPress → Subscription DB → Keycloak (per HANDSHAKE_ARCHITECTURE_AUDIT.md)
- **WRDesk behavior:** Reads `id_token` and `access_token`; extracts plan from both; falls back to roles if plan absent

**Observed logs:**
- `[SESSION] ⚠️ No plan claim found in either token`
- `[SESSION] Plan found in access_token: pro`

**Conclusion:** Keycloak is not providing `"publisher"` in either token. The application never receives the correct entitlement.

---

## Step 1 — Keycloak User Inspection Checklist

**Location:** Keycloak Admin Console → Users → [affected user]

### User Attributes

| Attribute Name | Expected for Publisher | Actual Value |
|----------------|------------------------|--------------|
| wrdesk_plan | publisher | ? |
| wrdesk-plan | publisher | ? |
| subscription_plan | publisher | ? |
| plan | publisher | ? |
| tier | publisher | ? |

**Check:** Does the user have any attribute containing `publisher`, `publisher_lifetime`, or `enterprise`?  
**Or** only attributes with `pro` or `private`?

### Realm Roles

| Role | Publisher User Should Have | Actual |
|------|----------------------------|--------|
| publisher | ✓ | ? |
| publisher_lifetime | (if lifetime) | ? |
| pro | May have both | ? |
| enterprise | (if enterprise) | ? |

### Client Roles (wrdesk-orchestrator)

| Role | Publisher User Should Have | Actual |
|------|----------------------------|--------|
| publisher | ✓ | ? |
| pro | May have both | ? |

### Groups

| Group | Publisher User Should Be In | Actual |
|-------|------------------------------|--------|
| /publisher | Possibly | ? |
| /pro | Possibly | ? |

**Likely misconfiguration:** User has `pro` role but not `publisher` role. Plan may be stored as User Attribute, but the attribute is either missing, wrong (`pro`), or not mapped into tokens.

---

## Step 2 — Protocol Mapper Configuration

**Location:** Keycloak Admin Console → Clients → wrdesk-orchestrator → Client scopes → Dedicated → Mappers  
(or Realm → Client Scopes → wrdesk-orchestrator-dedicated → Mappers)

### Mapper Checklist

For each mapper that exposes plan/entitlement:

| Mapper Name | Claim Name | Source | Add to ID token | Add to access token | Add to userinfo |
|-------------|------------|--------|-----------------|---------------------|-----------------|
| wrdesk_plan (or similar) | wrdesk_plan | User Attribute | ? | ? | ? |

### Common Misconfiguration

**Claim only in userinfo:** If "Add to ID token" and "Add to access token" are **OFF**, and only "Add to userinfo" is ON:

- WRDesk uses the token endpoint (refresh_token grant) and receives `access_token` + `id_token`
- WRDesk does **not** call the `/userinfo` endpoint
- The plan claim never appears in the tokens WRDesk reads
- **Result:** Plan invisible to the application

### Mapper Source Types

| Source | Description |
|--------|-------------|
| User Attribute | Reads from user.attributes.wrdesk_plan |
| User Property | Reads from user entity (e.g. username, email) |
| Hardcoded claim | Static value |
| Script | Custom JavaScript |

**For plan:** Source should be **User Attribute** with attribute name matching what the billing sync sets (e.g. `wrdesk_plan`).

### Claim Name vs Attribute Name

Keycloak mappers can use a different **claim name** than the **attribute name**:
- Attribute: `wrdesk_plan` → Claim: `wrdesk_plan` (same)
- Attribute: `wrdesk_plan` → Claim: `plan` (different)
- Attribute: `subscription_plan` → Claim: `wrdesk_plan` (different)

WRDesk checks: `wrdesk_plan`, `wrdesk_plans`, `wrdesk-plan`, `wrdeskPlan`, `wrdeskTier`, `user_plan`, `plan`, `plans`, `subscription`, `subscription_plan`, `subscriptionTier`, `subscription-tier`, `tier`, `user_tier`.

If the mapper uses a claim name **not** in this list (e.g. `entitlement`, `subscription_tier`), WRDesk will not find it.

---

## Step 3 — Role Assignment Model

### How Plan Is Represented

| Model | Used? | Token Location | WRDesk Reads? |
|-------|-------|----------------|---------------|
| **User Attribute** | ? | Requires Protocol Mapper | Yes (if mapper adds to tokens) |
| **Realm role** | ? | realm_access.roles | Yes |
| **Client role** | ? | resource_access.wrdesk-orchestrator.roles | Yes |
| **Group** | ? | groups claim | **No** — WRDesk does not read groups |

### Critical Finding

**WRDesk does not extract the `groups` claim.** If Publisher entitlement is represented as group membership (e.g. user in group `/publisher`), it will not be used for tier resolution.

### Role vs Attribute

- **Roles:** Automatically included in tokens via built-in mappers (`realm_access`, `resource_access`)
- **User attributes:** Require a custom Protocol Mapper to be added to tokens

If the billing system updates a **User Attribute** but no mapper adds it to tokens, the attribute exists in Keycloak but never appears in the JWT.

---

## Step 4 — Billing → Keycloak Sync

**Location:** External to WRDesk codebase. Sync logic is not in this repository.

### Architecture (from HANDSHAKE_ARCHITECTURE_AUDIT.md)

```
WooCommerce / WordPress  →  Subscription DB  →  Keycloak User Attribute Sync
(Payment/Subscription)      (License store)      (wrdesk_plan or equivalent)
```

### Sync Failure Modes

| Failure Mode | Description |
|--------------|-------------|
| **No sync for Publisher** | Sync only handles Pro; Publisher upgrades are not propagated |
| **Wrong attribute name** | Sync writes `subscription_plan` but mapper reads `wrdesk_plan` |
| **Wrong value** | Sync writes `pro` instead of `publisher` for Publisher subscriptions |
| **Role not assigned** | Sync updates attribute but not roles; attribute not in tokens (no mapper) |
| **Delayed sync** | Sync runs on schedule; user sees old tier until next run |
| **Sync targets userinfo only** | External service calls userinfo API to update; tokens unchanged until next login/refresh |

### What to Verify

1. **Where does the sync run?** (WordPress plugin, cron job, webhook, Lambda, etc.)
2. **What does it update?** (User Attribute, realm role, client role, group)
3. **Attribute/role name** used by the sync
4. **Value** written for Publisher (e.g. `publisher`, `publisher_lifetime`)
5. **Trigger** (real-time on purchase, batch job, manual)

---

## Step 5 — Token Contents (Decoded)

### id_token Payload

Decode at [jwt.io](https://jwt.io) or via `JSON.parse(Buffer.from(parts[1], 'base64url').toString())`.

| Claim | Present? | Value |
|-------|----------|-------|
| wrdesk_plan | ? | ? |
| wrdesk_plans | ? | ? |
| plan | ? | ? |
| tier | ? | ? |
| subscription_plan | ? | ? |
| realm_access.roles | ? | ? |
| resource_access.wrdesk-orchestrator.roles | ? | ? |
| groups | ? | ? |

### access_token Payload

| Claim | Present? | Value |
|-------|----------|-------|
| wrdesk_plan | ? | ? |
| (same as above) | ? | ? |

### Verification

If **neither** token contains `publisher` in any claim, the issue is entirely in Keycloak (mapper config, user data, or sync).

---

## Step 6 — Role Hierarchy

**Location:** Keycloak Admin Console → Realm → Roles → Role hierarchy (if enabled)

### Hierarchy Check

If a hierarchy exists such as:
- `publisher` → `pro` (publisher includes pro)

Then a user with `publisher` might receive **both** `publisher` and `pro` in `realm_access.roles`. WRDesk's `mapRolesToTier` checks `publisher` before `pro`, so that would work.

**Inverse hierarchy:** If `pro` → `publisher` (pro includes publisher), that would be unusual. Typically higher tiers include lower.

**Composite roles:** If `pro` is a composite role that includes other roles, verify which roles are actually in the token. Keycloak can expand composites; the token should contain the effective roles.

---

## Step 7 — Expected Output Summary

### 1. Keycloak Entitlement Model

| Component | Expected | To Verify |
|-----------|----------|-----------|
| **Plan storage** | User Attribute `wrdesk_plan` or role `publisher` | User → Attributes, User → Role mapping |
| **Token inclusion** | Protocol Mapper adds claim to ID token and/or access token | Client → Mappers |
| **Sync** | Billing system updates Keycloak on plan change | External sync service |

### 2. Actual Roles and Attributes (To Be Filled)

| Type | Expected for Publisher | Actual |
|------|------------------------|--------|
| User attribute wrdesk_plan | publisher | ? |
| Realm role publisher | Assigned | ? |
| Client role publisher | Assigned | ? |
| Realm role pro | May have | ? |

### 3. Protocol Mapper Configuration (To Be Filled)

| Mapper | Claim | ID Token | Access Token | Userinfo |
|--------|-------|----------|--------------|----------|
| ? | ? | ? | ? | ? |

### 4. Token Claims (To Be Filled)

| Claim | id_token | access_token |
|-------|----------|--------------|
| wrdesk_plan | ? | ? |
| realm_access.roles | ? | ? |
| resource_access...roles | ? | ? |

### 5. Exact Reason Publisher Entitlement Is Missing

**Most probable causes (ranked):**

1. **Protocol Mapper adds plan only to userinfo** — WRDesk never calls userinfo; tokens lack the claim.
2. **No Protocol Mapper for plan** — User attribute exists but no mapper adds it to id_token or access_token.
3. **User attribute not set** — Billing sync does not write `wrdesk_plan` (or equivalent) for Publisher users.
4. **User attribute wrong value** — Sync writes `pro` instead of `publisher`.
5. **Plan as group only** — Publisher represented as group membership; WRDesk does not read `groups`.
6. **Role not assigned** — Publisher is role-based but user only has `pro` role; sync does not assign `publisher`.
7. **Claim name mismatch** — Mapper uses a claim name WRDesk does not check.

---

## Verification Steps for Keycloak Admin

1. **User → Attributes:** Confirm `wrdesk_plan` (or equivalent) = `publisher` for the affected user.
2. **User → Role mapping:** Confirm `publisher` role is assigned (realm or client).
3. **Clients → wrdesk-orchestrator → Client scopes → Mappers:** Find the mapper for plan; ensure "Add to ID token" and/or "Add to access token" = ON.
4. **Decode tokens:** Log in as the user, capture tokens, decode, and verify the plan claim and its value.
5. **Billing sync:** Trace the path from WooCommerce/WordPress purchase to Keycloak update; confirm Publisher upgrades are synced and use the correct attribute/role.
