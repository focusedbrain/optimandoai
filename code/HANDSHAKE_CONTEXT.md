# Handshake Context — Architecture & Security

## Overview

Handshake Context items are structured data payloads that can be manually
attached (and, in future, auto-attached) to cryptographic handshakes with
external peers. Examples include personalized offers, user manuals, support
profiles, and onboarding packets.

**Available to:** Publisher+ tiers only (publisher, publisher_lifetime, enterprise).

---

## Data Model

### Storage

Handshake context items are stored as regular `vault_items` rows (envelope v2
encryption) with:

| Column         | Value                                               |
|----------------|-----------------------------------------------------|
| `category`     | `'handshake_context'`                               |
| `record_type`  | `'handshake_context'`                               |
| `schema_version` | `2` (envelope v2)                                 |
| `wrapped_dek`  | Per-record DEK wrapped by vault KEK (AES-256-GCM)   |
| `ciphertext`   | XChaCha20-Poly1305 encrypted fields JSON             |
| `meta`         | JSON — contains `binding_policy` (see below)         |

### Standard Fields

| Key            | Type     | Required | Description                                    |
|----------------|----------|----------|------------------------------------------------|
| `context_type` | text     | yes      | Category label (e.g., "Personalized Offer")    |
| `summary`      | text     | yes      | Short human-readable description               |
| `payload`      | textarea | yes      | The actual data to attach (encrypted at rest)  |
| `notes`        | textarea | no       | Internal notes (never shared in a handshake)   |

### Binding Policy (`meta.binding_policy`)

Every handshake context item carries a binding policy stored in the `meta`
JSON column. This policy controls *when* and *where* the item may be attached.

```typescript
interface HandshakeBindingPolicy {
  allowed_domains: string[]    // Glob patterns: '*.example.com', 'partner.org'
  handshake_types: string[]    // Tags: 'support', 'sales', 'onboarding'
  valid_until: number | null   // Unix timestamp (ms), null = no expiry
  safe_to_share: boolean       // Default false — must be explicitly enabled
  step_up_required: boolean    // Default false — if true, re-auth needed
}
```

**Default policy** (fail-safe): `safe_to_share = false`, all lists empty, no
expiry, no step-up. A newly created item cannot be attached until the user
explicitly marks it shareable.

---

## Security Rules

### 1. Capability Gate (Publisher+)

Access to `handshake_context` records requires `TIER_LEVEL >= publisher`.
The check runs **before** any decrypt/unwrap operation (fail-closed).

```
Free      → BLOCKED
Private   → BLOCKED
Pro       → BLOCKED
Publisher → ALLOWED
Enterprise → ALLOWED
```

### 2. No Implicit Sharing

In the MVP, context items are **never** automatically shared. The user must:

1. Create the item and fill in fields.
2. Set `safe_to_share = true` in the binding policy.
3. Manually select the item for inclusion in a handshake payload.

### 3. Attachment Evaluation (`canAttachContext`)

Before a context item can be attached, the `canAttachContext` evaluator runs
six checks in fail-fast order:

| # | Check               | Block Reason         | Remediation                                    |
|---|---------------------|----------------------|------------------------------------------------|
| 1 | Tier capability     | `tier_insufficient`  | Upgrade to Publisher+                          |
| 2 | `safe_to_share`     | `not_safe_to_share`  | Enable in item settings                        |
| 3 | Domain binding      | `domain_mismatch`    | Add domain to `allowed_domains`                |
| 4 | Handshake type      | `type_mismatch`      | Add type tag to `handshake_types`              |
| 5 | TTL / `valid_until` | `expired`            | Extend or remove expiration                    |
| 6 | Step-up             | `step_up_required`   | Re-authenticate                                |

Each blocked result includes a human-readable `message` suitable for display
in the UI.

### 4. Domain Glob Matching

The `matchDomainGlob` function supports:

- **Exact match:** `example.com` matches only `example.com`
- **Wildcard prefix:** `*.example.com` matches `sub.example.com`,
  `a.b.example.com`, and the bare `example.com`
- Matching is **case-insensitive**

### 5. No Execution Path

Handshake context data is treated as **opaque payload**. There is no code
path that interprets, executes, or dynamically loads context payloads.

---

## API Endpoints

All endpoints require the vault to be unlocked and the user's tier to be
Publisher+.

| Method | Path                            | Description                          |
|--------|---------------------------------|--------------------------------------|
| POST   | `/api/vault/item/create`        | Create (category=handshake_context)  |
| POST   | `/api/vault/item/get`           | Retrieve (decrypts fields)           |
| POST   | `/api/vault/item/update`        | Update fields and title              |
| POST   | `/api/vault/item/delete`        | Delete                               |
| POST   | `/api/vault/items`              | List (filter by category)            |
| POST   | `/api/vault/item/meta/get`      | Read binding policy from meta        |
| POST   | `/api/vault/item/meta/set`      | Write binding policy to meta         |
| POST   | `/api/vault/handshake/evaluate` | Evaluate attachment eligibility      |

### Example: Evaluate Attachment

```json
POST /api/vault/handshake/evaluate
{
  "itemId": "hc-abc123",
  "target": {
    "domain": "partner.example.com",
    "type": "sales",
    "step_up_done": true
  }
}
```

Response (allowed):
```json
{ "success": true, "data": { "allowed": true } }
```

Response (blocked):
```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "domain_mismatch",
    "message": "Domain \"evil.com\" is not in the allowed domains list (*.example.com)."
  }
}
```

---

## UI

### Sidebar

- **Publisher+:** "Handshake Context" appears as an interactive sidebar entry
  with "View Context Items" and "+ Add Context" actions.
- **Pro and below:** Entry appears locked with a "Publisher" badge.

### Create/Edit Dialog

A dedicated dialog provides:
- Title, Context Type, Summary, Payload, Notes fields
- Binding Policy section with:
  - Allowed Domains (comma-separated, supports glob)
  - Handshake Types (comma-separated tags)
  - Valid Until (datetime picker)
  - Safe to Share (checkbox)
  - Require Re-authentication (checkbox)

### List View

Each item row shows:
- Title and summary
- Status badges: `shareable` / `not shareable`, `expired`, domain count,
  type count, `step-up`
- Actions: Test (evaluate), Edit, Delete

### Test Attachment Dialog

The "Test" button opens an evaluation simulator where the user enters:
- Target domain
- Handshake type (optional)
- Step-up completed (checkbox)

The result clearly shows **ALLOWED** or **BLOCKED** with the specific reason
and all checks performed, making the policy transparent and debuggable.

---

## File Inventory

| File | Role |
|------|------|
| `packages/shared/src/vault/vaultCapabilities.ts` | Binding policy types, `canAttachContext`, `matchDomainGlob` |
| `packages/shared/src/vault/vaultCapabilities.test.ts` | 58 tests including evaluator + glob |
| `apps/electron-vite-project/electron/main/vault/types.ts` | Re-exports for backend |
| `apps/electron-vite-project/electron/main/vault/service.ts` | `getItemMeta`, `setItemMeta`, `evaluateAttach` |
| `apps/electron-vite-project/electron/main.ts` | HTTP routes for meta + evaluate |
| `apps/extension-chromium/src/vault/types.ts` | Re-exports + `HANDSHAKE_CONTEXT_STANDARD_FIELDS` |
| `apps/extension-chromium/src/vault/api.ts` | `getItemMeta`, `setItemMeta`, `evaluateHandshakeAttach` |
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | List, create/edit dialog, attach evaluation UI |
