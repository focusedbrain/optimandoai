# WRVault Capability & Record-Type Specification

> **Created:** 2026-02-15 | **Status:** Design-first scaffolding — no existing behavior changed.

---

## Overview

WRVault uses a **record-type + tier-gating** model to control which data categories a user can access. Security (encryption, key management) is **identical** across all tiers — differences are limited to **capability gates** and **trust/export features**.

**Canonical source of truth:**
`packages/shared/src/vault/vaultCapabilities.ts`

Re-exported via barrel files:
- `apps/extension-chromium/src/vault/capabilities.ts`
- `apps/electron-vite-project/electron/main/vault/capabilities.ts`

---

## Record Types

| Record Type          | Min Tier     | UI Section           | Description                                                |
|----------------------|-------------|----------------------|------------------------------------------------------------|
| `automation_secret`  | **Free**    | Secrets & API Keys   | API keys, tokens, secrets for automation and integrations  |
| `human_credential`   | **Pro**     | Password Manager     | Website logins, application passwords, credentials         |
| `pii_record`         | **Pro**     | Data Manager         | Personal identity, company, and business information       |
| `document`           | **Pro**     | Document Vault       | Encrypted document and file storage                        |
| `custom`             | **Pro**     | Custom Data          | User-defined structured data entries                       |
| `handshake_context`  | **Publisher**| Handshake Context   | Data bound into cryptographic handshakes                   |

## Tier Hierarchy

```
free (0) → private (1) → private_lifetime (2) → pro (3) → publisher (4) → publisher_lifetime (5) → enterprise (6)
```

Tiers are resolved from the `wrdesk_plan` JWT claim (Keycloak), falling back to Keycloak roles, and defaulting to `free` (fail-closed). See `apps/electron-vite-project/src/auth/capabilities.ts`.

## What Each Tier Gets

| Tier                 | Record Types                                                              | Actions                        |
|----------------------|---------------------------------------------------------------------------|--------------------------------|
| **Free**             | `automation_secret`                                                       | read, write, delete            |
| **Private(+)**       | `automation_secret`                                                       | read, write, delete, export    |
| **Pro**              | `automation_secret`, `human_credential`, `pii_record`, `document`, `custom` | read, write, delete, export  |
| **Publisher(+)**     | All of the above + `handshake_context`                                    | read, write, delete, export, share |
| **Enterprise**       | Everything                                                                | read, write, delete, export, share |

## Access Check API

```typescript
import {
  canAccessRecordType,
  getAccessibleRecordTypes,
  getCategoryOptionsForTier,
} from './capabilities'

// Check single access
canAccessRecordType('free', 'automation_secret')          // true
canAccessRecordType('free', 'human_credential')           // false
canAccessRecordType('pro', 'human_credential', 'export')  // true
canAccessRecordType('free', 'automation_secret', 'share') // false

// Get all accessible types
getAccessibleRecordTypes('pro')
// → ['automation_secret', 'human_credential', 'pii_record', 'document', 'custom']

// Get filtered category options for the create-item dialog
getCategoryOptionsForTier('pro')
// → [{ value: 'password', label: '🔑 Password Manager', icon: '🔑' }, ...]
```

## Legacy Category Mapping

The existing DB schema uses `ItemCategory` (`password | identity | company | business | custom`). These are mapped to the new `VaultRecordType` for tier gating, but **the DB schema is unchanged**.

| Legacy `ItemCategory` | → `VaultRecordType`  | UI Section       |
|-----------------------|----------------------|------------------|
| `password`            | `human_credential`   | Password Manager |
| `identity`            | `pii_record`         | Data Manager     |
| `company`             | `pii_record`         | Data Manager     |
| `business`            | `pii_record`         | Data Manager     |
| `custom`              | `custom`             | Custom Data      |

New record types (`automation_secret`, `document`, `handshake_context`) will require a DB schema extension (new `ItemCategory` values or a separate `record_type` column) in a future iteration.

## UI Label Changes

Sidebar and create-item dialog labels are updated to align with the new sections:

| Old Label              | New Label              |
|------------------------|------------------------|
| 🔑 Passwords          | 🔑 Password Manager   |
| 👤 Private Data        | 👤 Private Data        |
| 🏢 Company Data        | 🏢 Company Data        |
| 💼 Business Data       | 💼 Business Data       |
| 📝 Custom Data         | 📝 Custom Data         |

New sections (placeholders, not yet connected to backend):
- 🔐 Secrets & API Keys (Free+)
- 📄 Document Vault (Pro+)
- 🤝 Handshake Context (Publisher+)

## File Inventory

| File | Role |
|------|------|
| `packages/shared/src/vault/vaultCapabilities.ts` | **Canonical source of truth** — types, constants, helpers |
| `packages/shared/src/index.ts` | Re-exports vault capabilities |
| `apps/extension-chromium/src/vault/capabilities.ts` | Local barrel re-export |
| `apps/electron-vite-project/electron/main/vault/capabilities.ts` | Local barrel re-export |
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | Sidebar + create-dialog label integration |
| `apps/extension-chromium/src/vault/VaultUI.tsx` | React category filter label integration |
| `apps/extension-chromium/src/vault/types.ts` | Standard fields for `automation_secret` |
| `VAULT_CAPABILITIES.md` | This document |

## Future Work

1. **Runtime tier enforcement** — Wire `canAccessRecordType()` into `VaultService` and HTTP endpoint handlers.
2. **DB schema extension** — Add `automation_secret`, `document`, `handshake_context` to `ItemCategory` enum and DB schema.
3. **Full UI for new record types** — Build create/edit/list UIs for Secrets & API Keys, Document Vault, and Handshake Context.
4. **Policy integration** — Wire `VaultAccessPolicySchema` into the capability check for enterprise compartment access.
5. **Shared package dependency** — Add `@shared/core` as a workspace dependency in both apps for proper monorepo resolution.
