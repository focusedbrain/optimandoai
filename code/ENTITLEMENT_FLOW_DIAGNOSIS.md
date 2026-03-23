# Entitlement Flow Diagnosis — Where Publisher Disappears

**Date:** 2025-03-12  
**Issue:** Publisher entitlement never appears in tokens; `resolveTier(plan, roles) → "pro"`  
**Scope:** Identify the exact stage where the data becomes incorrect (no fixes proposed)

---

## Pipeline Overview

```
WooCommerce subscription
    → WordPress billing sync
    → Keycloak (user attributes / roles)
    → Keycloak token issuance
    → WRDesk token decoding
    → resolveTier(plan, roles)
```

**Verified:** WRDesk application logic is correct. Tokens contain `roles=["pro"]` and `plan=undefined` or `plan="pro"`.

**Conclusion:** The entitlement is lost somewhere between WooCommerce and the issued tokens.

---

## Step 1 — Billing Source of Truth

**Location:** WooCommerce Subscriptions (or equivalent) — external to WRDesk codebase

### Inspection Checklist

| Field | Expected for Publisher | Actual | Notes |
|-------|------------------------|--------|-------|
| Subscription plan | publisher / publisher_lifetime | ? | |
| Subscription status | active | ? | |
| Product SKU | e.g. wrdesk-publisher, publisher-annual | ? | |
| Internal plan name | publisher, publisher_lifetime, enterprise | ? | |

### WooCommerce Plan Naming (from capabilities.ts)

WRDesk expects Keycloak to receive:
- **Pro:** WooCommerce stores as `private` internally → WRDesk maps to `pro`
- **Publisher:** Expected as `publisher` or `publisher_lifetime`
- **Enterprise:** Expected as `enterprise`

**Verify:** Does the billing record for the affected user show Publisher (or equivalent) with status active?

---

## Step 2 — Billing → Keycloak Sync

**Location:** WordPress plugin / webhook / cron — **not in WRDesk codebase**

### Inspection Checklist

| Question | Answer |
|----------|--------|
| Which component performs the sync? | ? (WordPress plugin, Lambda, webhook, etc.) |
| What Keycloak fields does it update? | User attributes / Realm roles / Client roles / Groups |
| Mapping: WooCommerce plan → Keycloak | ? |
| Sync trigger | On upgrade event / Cron / Manual |
| Error logging | ? |

### Expected Mapping (Example)

| WooCommerce plan | Keycloak attribute | Keycloak role |
|------------------|--------------------|---------------|
| private (Pro) | wrdesk_plan=private | pro |
| publisher | wrdesk_plan=publisher | publisher |
| publisher_lifetime | wrdesk_plan=publisher_lifetime | publisher_lifetime |
| enterprise | wrdesk_plan=enterprise | enterprise |

### Sync Failure Modes

| Failure | Description |
|---------|-------------|
| **Publisher not in sync logic** | Sync only handles Pro (`private`); Publisher plans are never propagated |
| **Wrong value written** | Sync writes `pro` or `private` for Publisher subscriptions |
| **Wrong attribute name** | Sync writes to `subscription_plan` but mapper expects `wrdesk_plan` |
| **Role not assigned** | Sync updates attribute but not `publisher` role; attribute may not be in tokens |
| **Sync not triggered** | Publisher upgrade does not trigger sync (e.g. different product type) |
| **Sync errors** | Sync fails silently; check logs |

---

## Step 3 — Keycloak User State

**Location:** Keycloak Admin Console → Users → [affected user]

### Actual Values (To Be Filled)

**Attributes:**
| Attribute | Value |
|-----------|-------|
| wrdesk_plan | ? |
| wrdesk-plan | ? |
| subscription_plan | ? |
| plan | ? |
| tier | ? |

**Realm Roles:**
| Role | Assigned? |
|------|-----------|
| publisher | ? |
| publisher_lifetime | ? |
| pro | ? |
| enterprise | ? |

**Client Roles (wrdesk-orchestrator):**
| Role | Assigned? |
|------|-----------|
| publisher | ? |
| pro | ? |

**Groups:**
| Group | Member? |
|-------|---------|
| /publisher | ? |
| /pro | ? |

**Note:** WRDesk does not read the `groups` claim. If Publisher is represented only as group membership, it will not be detected.

---

## Step 4 — Protocol Mappers

**Location:** Keycloak Admin Console → Clients → wrdesk-orchestrator → Client scopes → Mappers

### Mapper Configuration (To Be Filled)

| Mapper Name | Claim Name | Source | Add to ID token | Add to access token | Add to userinfo |
|-------------|------------|--------|-----------------|---------------------|-----------------|
| ? | ? | User Attribute / Role | ? | ? | ? |

### Critical Check

**If "Add to ID token" and "Add to access token" are both OFF:**
- Plan claim appears only in userinfo
- WRDesk never calls userinfo; it only reads tokens
- **Result:** Plan invisible to WRDesk

---

## Step 5 — Issued Tokens

**Action:** Log in as affected user; capture and decode `id_token` and `access_token`

### id_token Claims

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

### access_token Claims

| Claim | Present? | Value |
|-------|----------|-------|
| wrdesk_plan | ? | ? |
| (same as above) | ? | ? |

### Verification

**Does any claim contain "publisher"?** If NO → issue is in Keycloak (user state or mapper). If YES → issue may be in WRDesk extraction (but application side is already verified).

---

## Step 6 — Entitlement Flow Table

| Stage | Value | Correct? |
|-------|-------|----------|
| **1. Billing plan** | ? | ? |
| **2. Keycloak user attribute** | ? | ? |
| **3. Keycloak roles** | ? | ? |
| **4. Token claim (plan)** | ? | ? |
| **5. Token claim (roles)** | ? | ? |
| **6. WRDesk plan detection** | undefined or "pro" | Incorrect (observed) |
| **7. WRDesk role detection** | ["pro"] | Observed |
| **8. resolveTier()** | "pro" | Result of 6+7 |

### First Incorrect Stage

The first stage where the value is wrong determines the root cause:

| First wrong stage | Root cause category |
|-------------------|---------------------|
| 1 | Billing system incorrect |
| 2 | Billing → Keycloak sync failure |
| 3 | Keycloak role mapping incorrect |
| 4 | Token mapper misconfigured (claim not in tokens) |
| 5 | Roles in token wrong (sync/role assignment) |
| 6 | WRDesk extraction (already ruled out) |

---

## Step 7 — Root Cause Classification

### Category A: Billing System Incorrect

**Evidence:** WooCommerce shows Pro or wrong plan for the user.

**Indicators:** Billing record has `private` or `pro` instead of `publisher`.

---

### Category B: Billing → Keycloak Sync Failure

**Evidence:** Billing shows Publisher, but Keycloak user has wrong/missing attribute or role.

**Indicators:**
- Keycloak user attribute `wrdesk_plan` = `pro` or missing
- Keycloak user has `pro` role but not `publisher` role
- Sync logic does not handle Publisher product/SKU
- Sync errors in logs

---

### Category C: Keycloak Attribute Correct, Not Mapped to Token

**Evidence:** Keycloak user has `wrdesk_plan=publisher`, but token lacks the claim.

**Indicators:**
- User Attributes tab shows `wrdesk_plan: publisher`
- Decoded token has no `wrdesk_plan` (or equivalent) claim
- Protocol Mapper for plan has "Add to ID token" and "Add to access token" = OFF

---

### Category D: Keycloak Role Mapping Incorrect

**Evidence:** User should have `publisher` role but does not.

**Indicators:**
- User Role mapping shows only `pro`, not `publisher`
- Sync updates attribute but not roles; plan is attribute-only and mapper is misconfigured

---

### Category E: Token Mapper Misconfigured

**Evidence:** Mapper exists but adds claim only to userinfo, or uses wrong claim name.

**Indicators:**
- "Add to userinfo" = ON, "Add to ID token" / "Add to access token" = OFF
- Claim name not in WRDesk's PLAN_CLAIM_KEYS list

---

## Most Probable Root Cause

Given observed logs:
- `[SESSION] ⚠️ No plan claim found in either token` — plan missing
- `[SESSION] Plan found in access_token: pro` — plan wrong

**Ranked by probability:**

1. **Billing → Keycloak sync failure** — Sync does not set Publisher for this user, or writes `pro` instead of `publisher`. Keycloak user has wrong attribute/role.

2. **Protocol Mapper adds plan only to userinfo** — User attribute may be correct, but mapper does not add it to id_token or access_token. WRDesk never sees it.

3. **Billing system incorrect** — User's subscription is recorded as Pro in WooCommerce (e.g. wrong product, migration issue).

4. **No Protocol Mapper for plan** — Sync writes user attribute, but no mapper adds it to tokens. Attribute exists in Keycloak but never appears in JWT.

5. **Publisher as group only** — Entitlement stored as group membership; WRDesk does not read `groups`.

---

## Evidence Required to Confirm

| Stage | Evidence |
|-------|----------|
| Billing | WooCommerce subscription record (plan, status, SKU) |
| Sync | Sync component code/config; sync logs for the user |
| Keycloak user | Screenshot: User → Attributes, Role mapping |
| Mappers | Screenshot: wrdesk-orchestrator → Mappers (token types) |
| Tokens | Decoded id_token and access_token payloads |

---

## Summary

**Pipeline:** WooCommerce → WordPress sync → Keycloak → Tokens → WRDesk

**WRDesk is correct.** The entitlement is lost before tokens are issued.

**Most probable failure stage:** Billing → Keycloak sync (sync does not propagate Publisher) or Keycloak Protocol Mapper (plan claim not added to tokens).

**Next step:** Inspect billing record, sync logic, Keycloak user state, and token contents to identify the first stage where the value is incorrect.
