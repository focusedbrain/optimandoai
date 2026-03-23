# HS Context Profile Editor — Code-Level Implementation Analysis

**Purpose:** Exact code locations, function signatures, and insertion points for three changes.  
**Generated:** For implementation in next step.

---

## CHANGE 1 — Remove Premature Draft Creation on Mount

### 1. useEffect Code (Draft Creation)

**Current state:** The codebase has **already been refactored**. There is **no** useEffect that auto-creates a profile on mount.

**File:** `apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx`

**Lines 236–254 — Load existing profile (edit mode only):**

```tsx
  useEffect(() => {
    if (profileId) {
      setLoading(true)
      getHsProfile(profileId)
        .then((detail: HsContextProfileDetail) => {
          if (!mountedRef.current) return
          setName(detail.name)
          setDescription(detail.description ?? '')
          setScope(detail.scope)
          setTagsInput(detail.tags.join(', '))
          setFields(detail.fields ?? {})
          setCustomFields(detail.custom_fields ?? [])
          setDocuments(detail.documents ?? [])
        })
        .catch((err: any) => setError(err?.message ?? 'Failed to load profile'))
        .finally(() => setLoading(false))
    }
  }, [profileId])
```

- **Dependencies:** `[profileId]`
- **Behavior:** Only loads when `profileId` exists (edit mode). Does **not** create a draft.

**Draft creation location:** Draft is created lazily via `getOrCreateProfileId` (lines 363–379), called when:
1. User uploads a document and `profileId` is undefined → `HsContextDocumentUpload` calls `onGetOrCreateProfileId()` (line 689)
2. User clicks Save with no `currentProfileId` → `handleSave` calls `createHsProfile` (lines 476–479)

**`getOrCreateProfileId` (lines 363–379):**

```tsx
  const getOrCreateProfileId = useCallback(async (): Promise<string> => {
    if (currentProfileIdRef.current) return currentProfileIdRef.current
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    const input: CreateProfileInput = {
      name: name.trim() || 'Untitled',
      description: description.trim() || undefined,
      scope,
      tags,
      fields: { ...fields },
      custom_fields: customFields.filter((cf) => cf.label.trim()),
    }
    const created = await createHsProfile(input)
    if (!mountedRef.current) return created.id
    currentProfileIdRef.current = created.id
    setCurrentProfileId(created.id)
    return created.id
  }, [name, description, scope, tagsInput, fields, customFields])
```

---

### 2. All Places Where profileId / currentProfileId Is Read

| Line | Reference | Requires profileId? | Notes |
|------|-----------|---------------------|-------|
| 42 | `profileId?: string` (Props) | No | Optional prop |
| 176 | `profileId` (destructured) | No | From props |
| 188 | `!!profileId` | No | Sets `loading` initial state |
| 202 | `profileId` | No | Initial value for `currentProfileId` |
| 209 | `profileId` | No | Initial value for ref |
| 238 | `if (profileId)` | No | Guard for load effect |
| 240 | `getHsProfile(profileId)` | Yes | Edit mode only |
| 254 | `[profileId]` | No | Effect dependency |
| 364 | `currentProfileIdRef.current` | Yes | Early return if draft exists |
| 376 | `setCurrentProfileId(created.id)` | No | State setter |
| 473 | `if (currentProfileId)` | Yes | Save: update vs create branch |
| 474 | `updateHsProfile(currentProfileId, ...)` | Yes | Update path |
| 476 | `createHsProfile(input)` | No | Create path (no id needed) |
| 492 | `shouldDeleteDraftOnCancel(profileId, currentProfileId)` | Yes | Cancel cleanup |
| 493 | `deleteHsProfile(currentProfileId!)` | Yes | Delete draft |
| 571 | `profileId ? 'Edit' : currentProfileId ? 'Draft' : 'New'` | No | Header text |
| 686 | `profileId={currentProfileId}` | Yes | Document upload needs id for API |
| 689 | `!profileId ? getOrCreateProfileId : undefined` | No | Enables upload-triggered draft |

**Summary:**
- **Require profileId/currentProfileId:** `getHsProfile`, `updateHsProfile`, `deleteHsProfile`, `HsContextDocumentUpload` (for upload API)
- **Can work without:** Form rendering, field editing, header text, `buildValidatedInput`, `handleSave` create branch

---

### 3. HsContextDocumentUpload Props

**File:** `apps/extension-chromium/src/vault/hsContext/HsContextDocumentUpload.tsx`  
**Lines 69–77:**

```tsx
interface Props {
  /** When undefined, upload will call onGetOrCreateProfileId before uploading. */
  profileId?: string
  documents: ProfileDocumentSummary[]
  onDocumentsChanged: () => void
  /** Called when user uploads and profileId is missing — returns new profile ID. Enables upload-triggered draft creation. */
  onGetOrCreateProfileId?: () => Promise<string>
  theme?: 'dark' | 'standard'
  disabled?: boolean
}
```

- **profileId:** Optional. When undefined, upload uses `onGetOrCreateProfileId` before uploading.
- **Behavior when profileId is null/undefined:**
  - If `onGetOrCreateProfileId` is provided: calls it to get/create profile, then uploads (lines 229–236).
  - If not provided: shows error "Profile not ready — save the profile first to enable uploads" (lines 237–240).
- **Does not crash:** Handles undefined via `let pid = profileId` and conditional `onGetOrCreateProfileId` call.

---

### 4. handleSave Function

**File:** `apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx`  
**Lines 465–487:**

```tsx
  const handleSave = async () => {
    const input = buildValidatedInput()
    if (!input) return

    setSaving(true)
    setError(null)

    try {
      if (currentProfileId) {
        await updateHsProfile(currentProfileId, input as UpdateProfileInput)
        onSaved(currentProfileId)
      } else {
        const created = await createHsProfile(input)
        if (!mountedRef.current) return
        setCurrentProfileId(created.id)
        onSaved(created.id)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }
```

- **Logic:** If `currentProfileId` exists → `updateHsProfile`. Else → `createHsProfile`.
- **Does not assume draft:** Create path works without any prior draft.

---

### 5. Cancel/Close Handler

**File:** `apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx`  
**Lines 491–496:**

```tsx
  const handleCancel = async () => {
    if (shouldDeleteDraftOnCancel(profileId, currentProfileId)) {
      try { await deleteHsProfile(currentProfileId!) } catch {}
    }
    onCancel()
  }
```

**File:** `apps/extension-chromium/src/vault/hsContext/hsContextDraftLogic.ts`  
**Lines 11–15:**

```ts
export function shouldDeleteDraftOnCancel(
  profileId: string | undefined,
  currentProfileId: string | undefined,
): boolean {
  return !profileId && !!currentProfileId
}
```

- **Behavior:** In create mode (`!profileId`) with a draft (`currentProfileId`), deletes the draft on cancel.
- **Cleanup:** `deleteHsProfile(currentProfileId!)` removes the auto-created draft.
- **Close:** `onCancel()` is always called (from parent).

---

## CHANGE 2 — Company Data Autofill Dropdown

**Note:** This is **already implemented** in the current codebase. Below is the reference for the pattern.

---

### 6. vaultAPI.listItems Usage

**Example 1 — HsContextProfileEditor (lines 221–234):**

```tsx
// File: apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx
import { listItems, getItem } from '../api'

useEffect(() => {
  setCompanyDataLoading(true)
  listItems({ category: 'company' })
    .then((items: VaultItem[]) => {
      if (!mountedRef.current) return
      setCompanyDataItems(items.map((i) => ({ id: i.id, title: i.title || '(Untitled)' })))
    })
    .catch(() => {
      if (!mountedRef.current) return
      setCompanyDataItems([])
    })
    .finally(() => setCompanyDataLoading(false))
}, [])
```

**Example 2 — vault-ui-typescript loadVaultItems (lines 1398–1399):**

```ts
const filters = category === 'all' ? undefined : { category: category as any }
const items = await vaultAPI.listItems(filters)
```

**Example 3 — dataVaultAdapter (line 94):**

```ts
const items = await vaultAPI.listItems()
```

**Pattern:** `listItems({ category: 'company' })` returns `Promise<VaultItem[]>`.

---

### 7. vaultAPI.getItem with Full Field Access

**File:** `apps/extension-chromium/src/vault/api.ts`  
**Lines 267–269:**

```ts
export async function getItem(id: string): Promise<VaultItem> {
  return await apiCall('/item/get', { id })
}
```

**File:** `apps/extension-chromium/src/vault/types.ts`  
**Lines 142–160:**

```ts
export interface Field {
  key: string
  value: string
  encrypted: boolean
  type: FieldType
  explanation?: string
}

export interface VaultItem {
  id: string
  container_id?: string
  category: ItemCategory
  title: string
  fields: Field[]
  domain?: string
  favorite: boolean
  created_at: number
  updated_at: number
}
```

**Field access:** `item.fields` is `Field[]`. Use `item.fields.find(f => f.key === 'street')?.value` or a helper.

**Example — HsContextProfileEditor (lines 51–54, 389–391):**

```tsx
function getCompanyFieldValue(item: VaultItem, key: string): string {
  const f = item.fields?.find((x) => x.key === key)
  return (f?.value ?? '').trim()
}

const item = await getItem(itemId) as VaultItem
const mapped = mapCompanyToProfileFields(item)
```

---

### 8. Top of HsContextProfileEditor Form JSX

**File:** `apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx`

**Profile Info section (lines 607–660):**

```tsx
        {/* ── Profile Info ── */}
        <div style={sectionStyle}>
          <div style={sectionHeadingStyle}>Profile Info</div>
          <div>
            <label style={labelStyle}>Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Acme Corp — Supplier Profile" />
          </div>
          ...
          {companyDataLoading ? (
            <div style={{ fontSize: '12px', color: mutedColor, marginTop: '12px' }}>Loading company data…</div>
          ) : companyDataItems.length === 0 ? (
            <div style={{ fontSize: '12px', color: mutedColor, marginTop: '12px' }}>
              No company data available — add company data in the vault first
            </div>
          ) : (
            <div style={{ marginTop: '14px' }}>
              <label style={labelStyle}>Auto-fill from Company Data</label>
              <select ...>
                <option value="">— Select company data to auto-fill —</option>
                {companyDataItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>
```

**Insertion point:** Inside Profile Info, after Scope/Tags row, before closing `</div>` of the section. The dropdown is already placed there.

**Form pattern:** Controlled inputs with `useState` (no Formik/react-hook-form).

---

### 9. Form Fields State and Setting

**State (lines 200–201):**

```tsx
const [fields, setFields] = useState<ProfileFields>(EMPTY_FIELDS)
const [customFields, setCustomFields] = useState<CustomField[]>(EMPTY_CUSTOMS)
```

**Type:** `ProfileFields` from `hsContextProfilesRpc` — flat object with keys like `legalCompanyName`, `address`, `country`, `website`, `generalPhone`, `generalEmail`, `vatNumber`, `companyRegistrationNumber`, etc.

**Setter (lines 382–384):**

```tsx
const setField = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) => {
  setFields((prev) => ({ ...prev, [key]: value }))
}
```

**Bulk set example (lines 391–401):**

```tsx
setFields((prev) => {
  const next = { ...prev }
  for (const [k, v] of Object.entries(mapped)) {
    const isEmpty = (prev as any)[k] == null || String((prev as any)[k] ?? '').trim() === ''
    if (v != null && String(v).trim() !== '' && isEmpty) {
      ;(next as any)[k] = v
    }
  }
  return next
})
```

---

### 10. Company Data Field Structure

**File:** `apps/extension-chromium/src/vault/types.ts`  
**Lines 83–98 (COMPANY_STANDARD_FIELDS):**

```ts
export const COMPANY_STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'ceo_first_name', label: 'CEO First Name', ... },
  { key: 'ceo_surname', label: 'CEO Surname', ... },
  { key: 'street', label: 'Street', ... },
  { key: 'street_number', label: 'Number', ... },
  { key: 'postal_code', label: 'Postal Code / ZIP', ... },
  { key: 'city', label: 'City', ... },
  { key: 'state', label: 'State / Province', ... },
  { key: 'country', label: 'Country', ... },
  { key: 'email', label: 'Company Email', ... },
  { key: 'phone', label: 'Phone Number', ... },
  { key: 'website', label: 'Website', ... },
  { key: 'vat_number', label: 'VAT Number', ... },
  { key: 'tax_id', label: 'Tax ID', ... },
  { key: 'additional_info', label: 'Additional Info', ... },
]
```

**Decrypted company item shape:**

```ts
{
  id: string,
  category: 'company',
  title: string,  // company name
  fields: [
    { key: 'street', value: 'Main St', encrypted: false, type: 'text' },
    { key: 'street_number', value: '123', encrypted: false, type: 'text' },
    { key: 'postal_code', value: '12345', encrypted: false, type: 'text' },
    { key: 'city', value: 'Berlin', encrypted: false, type: 'text' },
    { key: 'state', value: '', encrypted: false, type: 'text' },
    { key: 'country', value: 'Germany', encrypted: false, type: 'text' },
    { key: 'email', value: 'info@acme.de', encrypted: false, type: 'email' },
    { key: 'phone', value: '+49...', encrypted: false, type: 'text' },
    { key: 'website', value: 'https://acme.de', encrypted: false, type: 'url' },
    { key: 'vat_number', value: 'DE123...', encrypted: false, type: 'text' },
    { key: 'tax_id', value: '...', encrypted: false, type: 'text' },
    ...
  ],
  ...
}
```

**Field names:** `street`, `street_number`, `postal_code`, `city`, `state`, `country`, `email`, `phone`, `website`, `vat_number`, `tax_id` (flat key-value in `fields` array).

---

## CHANGE 3 — Company Data Tier Gating

**Note:** Already implemented. Reference below.

---

### 11. RECORD_TYPE_MIN_TIER and VaultRecordType

**File:** `packages/shared/src/vault/vaultCapabilities.ts`  
**Lines 29–48 (VaultRecordType):**

```ts
export type VaultRecordType =
  | 'automation_secret'
  | 'human_credential'
  | 'pii_record'
  | 'company_data'
  | 'document'
  | 'custom'
  | 'handshake_context'
```

**Lines 88–106 (RECORD_TYPE_MIN_TIER and RECORD_TYPE_MIN_TIER_WRITE):**

```ts
export const RECORD_TYPE_MIN_TIER: Record<VaultRecordType, VaultTier> = {
  automation_secret: 'free',
  human_credential: 'pro',
  pii_record: 'pro',
  company_data: 'pro',
  document: 'pro',
  custom: 'pro',
  handshake_context: 'publisher',
} as const

export const RECORD_TYPE_MIN_TIER_WRITE: Partial<Record<VaultRecordType, VaultTier>> = {
  company_data: 'publisher',
} as const
```

---

### 12. LEGACY_CATEGORY_TO_RECORD_TYPE

**File:** `packages/shared/src/vault/vaultCapabilities.ts`  
**Lines 271–280:**

```ts
export const LEGACY_CATEGORY_TO_RECORD_TYPE: Record<LegacyItemCategory, VaultRecordType> = {
  automation_secret: 'automation_secret',
  password: 'human_credential',
  identity: 'pii_record',
  company: 'company_data',
  custom: 'custom',
  document: 'document',
  handshake_context: 'handshake_context',
} as const
```

- **company** maps to **company_data**.

---

### 13. canAccessCategory

**File:** `packages/shared/src/vault/vaultCapabilities.ts`  
**Lines 406–414:**

```ts
export function canAccessCategory(
  tier: VaultTier,
  category: LegacyItemCategory,
  action: VaultAction = 'read',
): boolean {
  const recordType = LEGACY_CATEGORY_TO_RECORD_TYPE[category]
  if (!recordType) return false
  return canAccessRecordType(tier, recordType, action)
}
```

**Flow:** `category` → `recordType` (via `LEGACY_CATEGORY_TO_RECORD_TYPE`) → `canAccessRecordType(tier, recordType, action)`.

**canAccessRecordType (lines 149–171):** Uses `RECORD_TYPE_MIN_TIER` for read, `RECORD_TYPE_MIN_TIER_WRITE` (or `RECORD_TYPE_MIN_TIER`) for write/delete.

---

### 14. Sidebar Rendering for Company Data

**File:** `apps/extension-chromium/src/vault/vault-ui-typescript.ts`  
**Lines 1069–1115 (buildSidebarCategoriesHTML):**

```ts
function buildSidebarCategoriesHTML(tier: VaultTier): string {
  let html = ''
  const activeCats: Array<{ cat: LegacyItemCategory; accessible: boolean; minTier: string }> = []
  for (const cat of ALL_ITEM_CATEGORIES) {
    const uiInfo = CATEGORY_UI_MAP[cat]
    if (!uiInfo) continue
    const accessible = canAccessCategory(tier, cat)
    const minTier = RECORD_TYPE_MIN_TIER[uiInfo.recordType] || 'pro'
    activeCats.push({ cat, accessible, minTier })
  }

  for (const { cat, accessible, minTier } of activeCats) {
    const ui = CATEGORY_UI_MAP[cat]
    const cfg = SIDEBAR_CATEGORY_CONFIG[cat]
    if (!cfg) continue
    // ... renders each category as accessible (interactive) or locked (badge)
  }
  return html
}
```

**Tier check:** `canAccessCategory(tier, cat)` (line 1077) — default action `'read'`.  
**Company config:** `SIDEBAR_CATEGORY_CONFIG['company']` (line 1063): `{ containerType: 'company', viewAction: 'view-companies', viewLabel: 'View Companies', containersId: 'company-containers' }`.

**Add Company button (lines 1457–1465):** Only shown when `canAccessCategory(currentVaultTier, 'company', 'write')`.

---

### 15. TIER_LEVEL Hierarchy

**File:** `packages/shared/src/vault/vaultCapabilities.ts`  
**Lines 70–79:**

```ts
export const TIER_LEVEL: Record<VaultTier, number> = {
  unknown: -1,
  free: 0,
  private: 1,
  private_lifetime: 2,
  pro: 3,
  publisher: 4,
  publisher_lifetime: 5,
  enterprise: 6,
} as const
```

- **publisher** level: **4**
- **pro** level: **3**

---

## Summary: Current Implementation Status

| Change | Status | Notes |
|--------|--------|-------|
| 1. Remove premature draft creation | Done | No mount-time creation; draft only on first upload or first Save |
| 2. Company Data autofill dropdown | Done | In Profile Info, uses listItems/getItem, mapCompanyToProfileFields |
| 3. Company Data tier gating | Done | company_data, Pro read / Publisher write, sidebar + Add button gated |
