# HS Context Profile — Three Issues Analysis

**Purpose:** Technical trace for three separate issues. No implementation — mapping only.

---

## ISSUE 1 — Autofill from Company Data

### 1.1 Company Data Schema and Storage

| Aspect | Details |
|--------|---------|
| **Table** | `vault_items` (in vault SQLCipher DB) |
| **DB** | Same vault DB as other vault items; path: `~/.opengiraffe/electron-data/vault_*.db` |
| **Category** | `category = 'company'` identifies Company Data records |
| **Key columns** | `id`, `container_id`, `category`, `title`, `domain`, `fields_json`, `favorite`, `created_at`, `updated_at` |
| **Fields (Company)** | Stored in `fields_json` as array of `{ key, value, type }`. Standard keys per `COMPANY_STANDARD_FIELDS`: |

**Company Data standard fields** (`apps/extension-chromium/src/vault/types.ts` lines 82–97):

| Key | Label |
|-----|-------|
| `ceo_first_name` | CEO First Name |
| `ceo_surname` | CEO Surname |
| `street` | Street |
| `street_number` | Number |
| `postal_code` | Postal Code / ZIP |
| `city` | City |
| `state` | State / Province |
| `country` | Country |
| `email` | Company Email |
| `phone` | Phone Number |
| `website` | Website |
| `vat_number` | VAT Number |
| `tax_id` | Tax ID |
| `additional_info` | Additional Info |

**Record title:** `title` column — user-defined name for the record (e.g. "Acme Corp", "My Company").

**List function:** `vaultService.listItems(filters, tier)` — `apps/electron-vite-project/electron/main/vault/service.ts` lines 827–908.  
Filter: `{ category: 'company' }` returns Company Data items.  
RPC: `vault.listItems` → `handleVaultRPC` → `vaultService.listItems`.  
Extension API: `vaultAPI.listItems({ category: 'company' })` — `apps/extension-chromium/src/vault/api.ts` lines 304–319.

**Read single record:** `vaultService.getItem(id, tier)` — `service.ts` lines 771–820. Returns decrypted `VaultItem` with full `fields` array.  
RPC: `vault.getItem` → `handleVaultRPC` → `vaultService.getItem`.  
Extension API: `vaultAPI.getItem(id)` — `api.ts` lines 267–268.

---

### 1.2 HS Context Profile Form

| Aspect | Details |
|--------|---------|
| **File** | `apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx` |
| **Component** | `HsContextProfileEditor` |
| **Parent** | `HsContextProfileList` (when `view === 'create'` or `'edit'`) |

**Profile form fields** (from `ProfileFields` in `hsContextNormalize.ts` and editor sections):

| Section | Field Key | Label (in UI) |
|---------|-----------|---------------|
| Company / Organization | `legalCompanyName` | Legal Company Name |
| | `tradeName` | Display Name (if distinct) |
| | `address` | Address |
| | `country` | Country |
| Links / Online Presence | `website` | Website |
| | `linkedin` | LinkedIn |
| | `twitter` | Twitter / X |
| | `facebook` | Facebook |
| | `instagram` | Instagram |
| | `youtube` | YouTube |
| | `officialLink` | Official Link |
| | `supportUrl` | Support URL |
| Contacts | `generalPhone` | General Phone |
| | `generalEmail` | General Email |
| | `supportEmail` | Support Email |
| | `contacts` | Contact Persons (array) |
| Tax & Identifiers | `vatNumber` | VAT Number |
| | `companyRegistrationNumber` | Company Registration Number |
| | `supplierNumber` | Supplier Number |
| | `customerNumber` | Customer Number |
| Opening Hours | `openingHours` | Opening Hours (array) |
| | `timezone` | Timezone |
| | `holidayNotes` | Holiday Notes |
| Billing | `billingEmail` | Billing Email |
| | `paymentTerms` | Payment Terms |
| | `bankDetails` | Bank Details |
| Logistics | `receivingHours` | Receiving Hours |
| | `deliveryInstructions` | Delivery Instructions |
| | `supportHours` | Support Hours |
| | `escalationContact` | Escalation Contact |

---

### 1.3 Mapping: Profile Form Field → Company Data Field

| Profile Form Field | Company Data Field | Notes |
|--------------------|--------------------|-------|
| `legalCompanyName` | `title` | Company record title is the primary name |
| `tradeName` | — | No direct match; could use `ceo_first_name` + `ceo_surname` or leave empty |
| `address` | `street`, `street_number`, `postal_code`, `city`, `state`, `country` | Concatenate into single address string |
| `country` | `country` | Direct |
| `website` | `website` | Direct |
| `generalPhone` | `phone` | Direct |
| `generalEmail` | `email` | Direct |
| `vatNumber` | `vat_number` | Direct |
| `companyRegistrationNumber` | `tax_id` | Often used for registration number |
| `linkedin`, `twitter`, `facebook`, etc. | — | No match in Company Data |
| `contacts` | — | Company has CEO name only; could create one contact from `ceo_first_name` + `ceo_surname` |
| `supportEmail`, `billingEmail`, etc. | — | No match; `additional_info` might contain hints |

---

### 1.4 Implementation Path

| Question | Answer |
|----------|--------|
| **Can the form access Company Data?** | Yes. `HsContextProfileEditor` is in the extension; it can import `vaultAPI` from `../api` (or `@/vault/api`). `vaultAPI.listItems({ category: 'company' })` and `vaultAPI.getItem(id)` are available. |
| **Shared service for extension and Electron?** | Extension uses `vaultAPI` (HTTP via background → Electron). Electron app uses the same HTTP API or direct `vaultService`; the handshake/HS Context UI in Electron uses the extension components via `@ext/` alias, with `hsContextProfilesRpc` shimmed. `vaultAPI` is not shimmed for Electron — it goes through HTTP. Both can call `listItems` / `getItem`. |
| **Shim for Company Data?** | No. `listHsProfiles` is shimmed for Electron; Company Data uses `vaultAPI.listItems` / `getItem`, which work in both extension and Electron (HTTP to local server). |
| **Implementation** | Add a dropdown at top of form: fetch `listItems({ category: 'company' })`, show items by `title`. On select, call `getItem(id)` and map fields into `setFields` / `setName` etc. |

---

## ISSUE 2 — Profile Saves Without Clicking "Save Profile"

### 2.1 Save Trigger Analysis

| Trigger | Location | Code |
|---------|----------|------|
| **Draft creation (create path)** | `HsContextProfileEditor.tsx` lines 181–252 | `useEffect` when `!profileId` calls `createHsProfile({ name: 'Untitled', ... })` immediately on mount. This persists a new row in `hs_context_profiles` before any user action. |
| **Explicit Save** | `HsContextProfileEditor.tsx` lines 332–428 | `handleSave` → `updateHsProfile(currentProfileId, input)` → called only when user clicks "Save Profile" (line 527). |
| **Auto-save / debounced save** | — | None. No `useEffect` that calls `updateHsProfile` on `fields` or other state change. |
| **Save-on-blur** | — | None. |
| **Controlled state → DB on change** | — | No. Form uses `useState`; DB writes only via `createHsProfile` (draft) and `updateHsProfile` (Save). |

**Conclusion:** The only "persist without Save click" is the **draft creation** when opening the create form. `createHsProfile` is invoked in the `useEffect` (lines 214–225) so the user gets a profile ID for document upload. No other automatic save occurs.

---

### 2.2 Invocation Summary

| Function | Invoked From | When |
|----------|--------------|------|
| `createHsProfile` | `HsContextProfileEditor.tsx` line 217 | `useEffect` when `!profileId` (create mode) — runs on mount |
| `updateHsProfile` | `HsContextProfileEditor.tsx` line 421 | `handleSave` — only when user clicks "Save Profile" |
| `updateHsProfileDocumentMeta` | `HsContextDocumentUpload.tsx` line 256 | When user edits document label/type and saves — separate from profile save |

---

### 2.3 Intended vs Current Behavior

| Aspect | Current | Desired |
|--------|---------|---------|
| **Form state** | Local `useState` for edits | Same ✓ |
| **DB write on Save** | `updateHsProfile` on Save click | Same ✓ |
| **DB write before Save** | `createHsProfile` on mount (draft) | User expects no DB write until Save |
| **Cancel** | `handleCancel` (lines 433–437): deletes draft if `shouldDeleteDraftOnCancel`, then `onCancel()` | Same ✓ |
| **Cancel button** | Yes (line 524) | Same ✓ |

---

### 2.4 Draft vs Saved State

| Concept | Details |
|---------|---------|
| **Draft** | A profile created with `createHsProfile` when `view === 'create'`. Name "Untitled", empty fields. |
| **Auto-persist** | Draft is persisted immediately so `HsContextDocumentUpload` can use `profileId` for uploads. |
| **Design reason** | Document upload requires a profile ID; without a draft, uploads would need a different flow (e.g. temp storage, attach on first Save). |

**Root cause:** The draft creation is intentional for document upload, but it creates a DB row before the user clicks Save. Users may see this as "saving without Save."

**Options to fix:**
1. **Defer draft creation** until first document upload or first Save — requires upload flow that works without `profileId` (e.g. client-side queue, attach on Save).
2. **Keep draft, clarify UX** — e.g. "Draft" badge, or only show in list after explicit Save.
3. **Create draft on first Save** — form stays local-only until Save; document upload disabled until first Save (or use a two-phase flow).

---

## ISSUE 3 — Company Data Tier Gating (Pro → Publisher)

### 3.1 Tier Check Locations

Company Data uses category `'company'`, which maps to record type `'pii_record'` (same as Private Data / identity). All checks go through `canAccessCategory(tier, 'company', action)` or `canAccessRecordType(tier, 'pii_record', action)`.

| File | Line(s) | Usage |
|------|---------|-------|
| `packages/shared/src/vault/vaultCapabilities.ts` | 98 | `RECORD_TYPE_MIN_TIER['pii_record'] = 'pro'` — gates both identity and company |
| | 260–261 | `LEGACY_CATEGORY_TO_RECORD_TYPE`: `identity` → `pii_record`, `company` → `pii_record` |
| | 327, 331 | `CATEGORY_UI_MAP`: `company.recordType = 'pii_record'` |
| | 375–394 | `getCategoryOptionsForTier` filters by `canAccessRecordType(tier, CATEGORY_UI_MAP[cat].recordType)` |
| | 386–394 | `canAccessCategory(tier, category)` → `canAccessRecordType(tier, LEGACY_CATEGORY_TO_RECORD_TYPE[category])` |
| `apps/extension-chromium/src/vault/vault-ui-typescript.ts` | 1077 | `canAccessCategory(tier, cat)` for sidebar visibility |
| `apps/electron-vite-project/electron/main/vault/service.ts` | 589 | `canAccessCategory(tier, item.category, 'write')` in createItem |
| | 684 | `canAccessCategory(tier, itemCategory, 'write')` in updateItem |
| | 753 | `canAccessCategory(tier, itemCategory, 'delete')` in deleteItem |
| | 784 | `canAccessCategory(tier, cat, 'read')` in listItems |
| | 925, 969 | Filter items by `canAccessCategory(tier, i.category, 'read')` |
| | 982 | `canAccessCategory(tier, 'password', 'read')` for password-specific path |
| | 1410 | `canAccessCategory(tier, itemCategory, 'read')` in getItem |
| | 1528 | Filter items by `canAccessCategory(tier, i.category, 'read')` |
| `apps/electron-vite-project/electron/main.ts` | 5920, 6066, 6102, 6163, 6187, 6236 | `canAccessCategory` used for HTTP route handlers |

---

### 3.2 Publisher Tier and Hierarchy

| Aspect | Value |
|--------|-------|
| **Publisher string** | `'publisher'` (and `'publisher_lifetime'`) |
| **Tier order** | `packages/shared/src/vault/vaultCapabilities.ts` lines 66–75: |

```ts
TIER_LEVEL = {
  unknown: -1,
  free: 0,
  private: 1,
  private_lifetime: 2,
  pro: 3,
  publisher: 4,
  publisher_lifetime: 5,
  enterprise: 6,
}
```

**Hierarchy:** `free < private < private_lifetime < pro < publisher < publisher_lifetime < enterprise`

---

### 3.3 Required Changes

To make Company Data Publisher-only while keeping Private Data (identity) at Pro:

**Option A — Special-case in `canAccessCategory` (minimal change):**
- In `canAccessCategory`, add: if `category === 'company'`, require `TIER_LEVEL[tier] >= TIER_LEVEL['publisher']` instead of using `pii_record`.
- File: `packages/shared/src/vault/vaultCapabilities.ts` lines 386–394.

**Option B — New record type (cleaner model):**
- Add `VaultRecordType`: `'company_data'` with `RECORD_TYPE_MIN_TIER['company_data'] = 'publisher'`.
- Change `LEGACY_CATEGORY_TO_RECORD_TYPE['company']` from `'pii_record'` to `'company_data'`.
- Change `CATEGORY_UI_MAP['company'].recordType` to `'company_data'`.
- Add `'company_data'` to `VAULT_RECORD_TYPES` and related structures.

**Downstream impact:**
- Pro users who already have Company Data would lose access after the change.
- Consider migration or grandfathering for existing Pro users with Company Data.

---

## Summary

| Issue | Root Cause | Key Files |
|-------|------------|-----------|
| **1. Autofill from Company Data** | No dropdown or mapping implemented | `HsContextProfileEditor.tsx`, `vault/api.ts`, `vault/types.ts` (COMPANY_STANDARD_FIELDS) |
| **2. Saves without Save** | Draft creation via `createHsProfile` on mount for document upload | `HsContextProfileEditor.tsx` lines 181–252 |
| **3. Company Data tier** | `company` → `pii_record` → min tier `pro` | `vaultCapabilities.ts` RECORD_TYPE_MIN_TIER, LEGACY_CATEGORY_TO_RECORD_TYPE, canAccessCategory |
