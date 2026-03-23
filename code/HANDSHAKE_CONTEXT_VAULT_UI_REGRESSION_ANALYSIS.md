# HS Context Vault UI Regression — Focused Code Analysis

**Date:** 2025-03-13  
**Task:** Investigate why WRVault "New HS Context" shows the old generic form instead of the refactored structured HS Context authoring UI.  
**Status:** Analysis complete — no implementation.

---

## 1. Executive Diagnosis

### Most likely reason the old generic form is still shown in WRVault

**The refactored structured HS Context editor (`HsContextProfileEditor`) was implemented in a React component tree that is never mounted in the active WRVault path.** The active WRVault lightbox uses `vault-ui-typescript.ts` (pure TypeScript, no React). All "New HS Context" actions in that path explicitly call `renderHandshakeContextDialog`, which renders the legacy generic form. The refactored editor lives in `VaultUI.tsx` → `HsContextProfileList` → `HsContextProfileEditor`, but `VaultUI.tsx` is not used when opening WRVault from the extension.

### Cause breakdown

| Factor | Contribution |
|--------|--------------|
| **a) Wrong component still mounted** | **Primary.** `renderHandshakeContextDialog` (legacy) is the component that renders the screenshot form. It is the only HS Context create/edit form in the active path. |
| **b) Electron UI path not rewired** | **Primary.** The WRVault lightbox is rendered by `vault-ui-typescript.ts`. That file was never updated to use the refactored editor. The refactor targeted `VaultUI.tsx`, which is not in the lightbox flow. |
| **c) Auto/Manual mode routing to legacy form** | **None.** The Auto/Manual toggle controls QSO autofill consent (`loadAutoConsentForVault` / `saveAutoConsent`), not which form is shown for HS Context creation. |
| **d) HS Context create action still mapped to generic context item creation** | **Primary.** All entry points for "New HS Context" (`add-handshake-context`, `renderAddDataDialog(container, 'handshake_context')`, `#hc-empty-add-btn`, `#hc-list-add-btn`, `hc-edit-btn`) call `renderHandshakeContextDialog`. |
| **e) Combination** | **Yes.** (a), (b), and (d) together: wrong component mounted because the active path was never rewired, and all create actions map to the legacy form. |

---

## 2. Active WRVault UI Path

### Call chain for the screen shown in the screenshot

```
Extension sidepanel / content script
  └─ openWRVault() / OPEN_WRVAULT_LIGHTBOX
       └─ content-script.tsx: openWRVaultLightbox()
            └─ import('./vault/vault-ui-typescript').then(({ openVaultLightbox }) => openVaultLightbox())
                 └─ vault-ui-typescript.ts: openVaultLightbox()  [line 192]
                      └─ Creates overlay, header (with Auto/Manual), mainContent
                      └─ initVaultUI(mainContent)  [line 364]
                           └─ vaultAPI.getVaultStatus() → currentVaultTier
                           └─ renderVaultDashboard(container) or unlock/create
                                └─ renderVaultDashboard: sidebar + #vault-main-content
                                └─ Event delegation on container for data-action
```

### "New HS Context" action paths

| Entry point | File | Line | Handler |
|-------------|------|------|---------|
| Sidebar `add-handshake-context` | `vault-ui-typescript.ts` | 1209 | `renderHandshakeContextDialog(container)` |
| Add Data dialog with `handshake_context` preselected | `vault-ui-typescript.ts` | 3000–3002 | `renderHandshakeContextDialog(container)` |
| Empty state "+ Add Context Item" | `vault-ui-typescript.ts` | 1817–1819 | `renderHandshakeContextDialog(parentContainer)` |
| List header "+ Add Context" | `vault-ui-typescript.ts` | 1904–1905 | `renderHandshakeContextDialog(parentContainer)` |
| Edit button on existing item | `vault-ui-typescript.ts` | 1922–1926 | `renderHandshakeContextDialog(parentContainer, itemId)` |
| Row click | `vault-ui-typescript.ts` | 1940–1943 | `renderHandshakeContextDialog(parentContainer, itemId)` |

### Component that renders the screenshot form

- **Function:** `renderHandshakeContextDialog`  
- **File:** `apps/extension-chromium/src/vault/vault-ui-typescript.ts`  
- **Lines:** 1951–2176  

### Auto / Manual toggle behavior

- **Location:** Header of WRVault overlay (`vault-ui-typescript.ts` lines 249–265)  
- **Purpose:** QSO autofill consent — whether the vault may auto-fill QSO fields.  
- **State:** `loadAutoConsentForVault()` / `saveAutoConsent(boolean)`  
- **Effect on HS Context form:** None. The toggle does not control which form is shown for create/edit.  

### Create/edit route

- **Create:** `vaultAPI.createItem({ category: 'handshake_context', title, fields, favorite: false })` then `vaultAPI.setItemMeta(newItem.id, { binding_policy })`  
- **Edit:** `vaultAPI.updateItem(editItemId, { title, fields })` then `vaultAPI.setItemMeta(editItemId, { binding_policy })`  
- **Path:** Generic vault item API (HTTP → Electron Express → vault RPC → `VaultService`).  

### Difference from refactored path

The refactored path uses `HsContextProfileEditor` → `hsContextProfilesRpc` (`createHsProfile`, `updateHsProfile`) → WebSocket/VAULT_RPC → `vault.hsProfiles.*` → `hsContextProfileService` → `hs_context_profiles` / `hs_context_profile_documents` tables. The active path uses `vaultAPI.createItem` / `vaultAPI.updateItem` → generic vault items (encrypted fields in `vault_items`). These are different data models and storage paths.

---

## 3. Legacy vs Refactored Editor Analysis

### Two parallel HS Context authoring UIs

| Aspect | Legacy | Refactored |
|--------|--------|------------|
| **Component** | `renderHandshakeContextDialog` (function, pure TS) | `HsContextProfileEditor` (React) |
| **File** | `vault-ui-typescript.ts` (lines 1951–2176) | `hsContext/HsContextProfileEditor.tsx` |
| **List component** | Inline in `loadHandshakeContextList` | `HsContextProfileList.tsx` |
| **Parent** | `vault-ui-typescript.ts` (initVaultUI → renderVaultDashboard) | `VaultUI.tsx` (view === 'hs-context') |
| **Data model** | Generic vault item: `title`, `fields` (context_type, summary, payload, notes), `meta.binding_policy` | HS Context Profile: `hs_context_profiles` + `hs_context_profile_documents` |
| **API** | `vaultAPI.createItem`, `vaultAPI.updateItem`, `vaultAPI.setItemMeta` | `createHsProfile`, `updateHsProfile`, `uploadHsProfileDocument`, etc. |
| **Fields** | Title, Context Type, Summary, Context Payload, Internal Notes, Binding Policy | Business Identity, Tax & Identifiers, Contacts, Opening Hours, Links, Documents, custom fields |

### Which is active in Electron WRVault

- **Active:** Legacy (`renderHandshakeContextDialog`).  
- **Reason:** WRVault is opened via the extension; the extension uses `vault-ui-typescript.ts` for the lightbox. `VaultUI.tsx` is never imported or rendered in that flow.

### Which is active in extension/Chromium surfaces

- **WRVault lightbox (content script):** Legacy. Same `vault-ui-typescript.ts` path.  
- **VaultUI.tsx:** Not used in the lightbox. `VaultUI` is exported but has no imports in the active WRVault flow. Per `ARCHITECTURE_VAULT.md` (line 409): "The lightbox in content-script uses the TypeScript version."

### Refactored component wiring

- **HsContextProfileEditor** is used only by `HsContextProfileList`.  
- **HsContextProfileList** is used only by `VaultUI.tsx` (line 234).  
- **VaultUI.tsx** is not imported by `vault-ui-typescript.ts`, `content-script.tsx`, or any entry point that opens the vault lightbox.  
- **Conclusion:** The refactored editor was implemented but never wired into the active WRVault path.

### Older component owning "New HS Context" in Electron

- **Owner:** `vault-ui-typescript.ts` via `renderHandshakeContextDialog`.  
- **Electron note:** WRVault is opened from the extension (sidepanel/content script). The Electron app does not host a separate WRVault UI; it provides the vault backend (HTTP API). The extension’s vault UI runs in the extension context (Chrome or Electron-embedded browser).  

### Refactor coverage

- **Effectively ignored in:** WRVault lightbox (the only active WRVault UI).  
- **Implemented in:** `VaultUI.tsx`, which is not part of the lightbox flow.

---

## 4. Auto / Manual Mode Analysis

### What Auto mode renders

- **Auto:** User has consented to QSO autofill. `saveAutoConsent(true)`; button styling indicates "Auto" is active.  
- **Manual:** User has not consented. `saveAutoConsent(false)`; "Manual" is active.  
- **Rendered content:** The main vault content (dashboard, category list, items) is the same in both modes. The toggle does not change which form is shown.

### What Manual mode renders

- Same dashboard and forms as Auto. Only the consent state differs.

### Whether Manual is intentionally mapped to the old generic form

- **No.** The Auto/Manual toggle is unrelated to HS Context form selection. Both modes use `renderHandshakeContextDialog` when creating/editing HS Context.

### Whether HS Context creation should use a different form

- **Yes.** For Publisher/Publisher Lifetime/Enterprise users, HS Context creation should use the structured `HsContextProfileEditor` (or equivalent) instead of the legacy generic form. The current behavior is a regression/missed wiring.

### Whether the toggle bypasses the structured editor

- **No.** The toggle does not select the editor. The editor is chosen by the `add-handshake-context` / `renderAddDataDialog(..., 'handshake_context')` handlers, which always call `renderHandshakeContextDialog`. The structured editor is never in the decision path.

### Code paths

- **Auto/Manual:** `vault-ui-typescript.ts` lines 309–344: `loadAutoConsentForVault`, `saveAutoConsent`, `showVaultAutoConsentDialog`.  
- **Current behavior:** Intentional for QSO consent; not intentional for HS Context form selection.  
- **Toggle logic:** Does not select the editor; it is irrelevant to the HS Context form bug.

---

## 5. New HS Context Create Action Analysis

### How the app decides which form/editor to open

- **Decision:** Hardcoded. When `preselectedCategory === 'handshake_context'` or `action === 'add-handshake-context'`, the code calls `renderHandshakeContextDialog(container)`. There is no branch that checks tier or selects the structured editor.

### Generic record-type form renderer

- **Yes.** `renderAddDataDialog` uses `preselectedCategory` to branch:
  - `document` → `renderDocumentUploadDialog`
  - `handshake_context` → `renderHandshakeContextDialog`
  - Other categories → generic Add Data form with category dropdown

### HS Context treated as generic context item

- **Yes.** `handshake_context` is treated as a category that uses the legacy "context item" form (`renderHandshakeContextDialog`), which has Title, Context Type, Summary, Payload, Notes, Binding Policy. There is no special-case for the structured HS Context profile editor.

### Special-case handling for structured HS Context

- **Missing.** There is no check for `canUseHsContextProfiles` or tier when opening the HS Context form. The code does not branch to `HsContextProfileEditor` or `HsContextProfileList` for any create/edit action.

### Tier checks

- **Sidebar visibility:** `getCategoryOptionsForTier(currentVaultTier)` filters which categories appear in the Add Data dialog. `handshake_context` is included for publisher+ tiers (from `vaultCapabilities.ts`).  
- **Editor selection:** No tier check. Even when the user is eligible, the wrong (legacy) editor is shown. The bug is editor selection, not access control.

### Exact files/functions

| Location | Function | Logic |
|----------|----------|-------|
| `vault-ui-typescript.ts` | `renderAddDataDialog` (lines 2993–3003) | If `preselectedCategory === 'handshake_context'` → `renderHandshakeContextDialog(container)` |
| `vault-ui-typescript.ts` | Event handler for `add-handshake-context` (line 1209) | `renderHandshakeContextDialog(container)` |
| `vault-ui-typescript.ts` | `loadHandshakeContextList` (lines 1817–1819, 1904–1905) | `#hc-empty-add-btn` and `#hc-list-add-btn` → `renderHandshakeContextDialog(parentContainer)` |

### Decision logic

- **Single path:** All HS Context create/edit actions call `renderHandshakeContextDialog`. No conditional for structured vs legacy form.

---

## 6. Data Model / Save-Path Analysis

### Screenshot form fields and save path

The legacy form writes:

- **title** — item title  
- **context_type** — field  
- **summary** — field  
- **payload** — field (encrypted)  
- **notes** — field (internal_notes)  
- **binding_policy** — meta (allowed_domains, handshake_types, valid_until, safe_to_share, step_up_required)

**Save path:** `vaultAPI.createItem` / `vaultAPI.updateItem` → generic vault item API → `vault_items` table with encrypted fields.

### Compatibility with refactored structured model

- **Incompatible.** The refactored model uses:
  - `hs_context_profiles`: name, description, scope, tags, org_id, fields (JSON with structured keys), etc.
  - `hs_context_profile_documents`: PDFs, labels, document_type, extracted_text, sensitive, etc.
- The legacy form does not write to `hs_context_profiles` or `hs_context_profile_documents`. It writes to generic `vault_items`.

### Submitting the legacy form

- **Effect:** Creates/updates a generic vault item with `category: 'handshake_context'`. It does not create an HS Context Profile.  
- **Structured field normalization:** Bypassed. The refactor’s normalization (`hsContextNormalize`, `ProfileFields`) is not used.  
- **Documents / labeled PDFs / structured links / contacts:** Not supported. The legacy form has no document upload, no structured links, no contacts array. It only has a single "Context Payload" textarea.

### Exact save path

- **Frontend:** `vault-ui-typescript.ts` lines 2148–2162: `vaultAPI.createItem`, `vaultAPI.setItemMeta`.  
- **Backend:** Extension `vault/api.ts` → `VAULT_HTTP_API` → background → `fetch` to `http://127.0.0.1:51248/api/vault/*` → Express → `vault/rpc.ts` → `VaultService.createItem`, `setItemMeta`.  
- **Storage:** `vault_items` table; `binding_policy` in item meta.

### Legacy form and structured HS Context

- **Cannot produce:** Proper structured HS Context profiles. It produces generic vault items that may be used as legacy context but do not support the structured publisher-grade model (documents, links, contacts, etc.).  
- **UI refactor:** Effectively negated for WRVault create/edit, because the active path never uses the structured editor or profile save path.

---

## 7. Publisher/Enterprise Gating Analysis

### Tier gate for HS Context usage

- **Backend:** `vaultCapabilities.ts`: `handshake_context` requires `publisher` tier. `canAccessRecordType(tier, 'handshake_context', 'share')` gates HS Context.  
- **API:** `getVaultStatus` returns `canUseHsContextProfiles` from that check.  
- **Sidebar:** `getCategoryOptionsForTier(currentVaultTier)` filters categories; `handshake_context` appears only for publisher+.

### Publisher users and tier gate

- **Pass:** Publisher+ users correctly pass the tier gate; they see the HS Context category and can create context items.  
- **Form shown:** Despite correct tier, they see the legacy form. The wrong form appears even when the user is eligible.

### Problem type

- **Not permission-related.** The bug is component routing: the correct editor is never mounted. Access control is functioning; the structured editor was never wired in.

### Tier/access path

- `initVaultUI` → `vaultAPI.getVaultStatus()` → `status.tier` → `currentVaultTier`  
- `getCategoryOptionsForTier(currentVaultTier)` → categories for sidebar  
- No tier check before calling `renderHandshakeContextDialog`; it is always used for HS Context.

---

## 8. Refactor Coverage Analysis

### Surfaces/components updated during HS Context UI refactor

- `HsContextProfileEditor.tsx` — structured editor with Business Identity, Tax & Identifiers, Contacts, Opening Hours, Links, Documents  
- `HsContextProfileList.tsx` — list + create/edit using `HsContextProfileEditor`  
- `HsContextDocumentUpload.tsx` — document upload for profiles  
- `StructuredHsContextPanel.tsx` — display of structured context in handshake view  
- `hsContextProfilesRpc.ts` — RPC client for profile CRUD  
- `hsContextProfileService.ts` (Electron) — backend for `hs_context_profiles`  
- `hsContextNormalize.ts` — field normalization  
- `HandshakeContextProfilePicker.tsx` — profile picker in handshake flows  

### Surfaces/components NOT updated

- **`vault-ui-typescript.ts`** — All HS Context create/edit still uses `renderHandshakeContextDialog`. No use of `HsContextProfileEditor` or `HsContextProfileList`.  
- **WRVault lightbox entry point** — Uses `vault-ui-typescript.ts` only; `VaultUI.tsx` is not in the flow.

### WRVault Electron "New HS Context" in refactor

- **Omitted.** The refactor did not touch `vault-ui-typescript.ts` for HS Context. The "New HS Context" path in the active WRVault was not updated.

### Structured panel vs WRVault create/edit

- **Structured panel:** `StructuredHsContextPanel` renders structured HS Context in the handshake view (display only).  
- **WRVault create/edit:** Still uses the legacy form.  
- **Alignment:** The structured panel expects data from the refactored profile model. WRVault create/edit writes to the legacy model. Users creating via WRVault produce legacy items, not structured profiles, so the structured panel would not receive the intended data for those items.

### Summary

- **Updated:** React components (`HsContextProfileEditor`, `HsContextProfileList`), RPC, backend service, handshake display, picker.  
- **Missed:** `vault-ui-typescript.ts` and the WRVault lightbox create/edit path.  
- **Type:** Missed wiring — the structured editor exists but was never connected to the active WRVault path.

---

## 9. Implementation Anchors for Follow-Up Fix

### Electron WRVault files likely needing change

- **Primary:** `apps/extension-chromium/src/vault/vault-ui-typescript.ts`  
- **Secondary:** Possibly `apps/extension-chromium/src/vault/hsContext/HsContextProfileList.tsx` or `HsContextProfileEditor.tsx` if they need to be embeddable in a non-React container.

### Component currently rendering the legacy form

- **Function:** `renderHandshakeContextDialog`  
- **File:** `vault-ui-typescript.ts` lines 1951–2176  

### Where the structured HS Context editor should be mounted

- **Option A:** Replace the body of `renderHandshakeContextDialog` (or the branch when `preselectedCategory === 'handshake_context'`) with a React root that mounts `HsContextProfileEditor` (create) or `HsContextProfileEditor` with `profileId` (edit).  
- **Option B:** Create a wrapper that renders `HsContextProfileList` in "create" or "edit" mode inside the vault main content area, replacing the legacy dialog.  
- **Mount point:** Same container passed to `renderHandshakeContextDialog` — the vault main content (`#vault-main-content` or its parent).

### Auto/Manual toggle

- **Change:** Not required for the HS Context form fix. The toggle is independent.  
- **Bypass for HS Context:** Not needed; the toggle does not affect form selection.

### Tests to add/update

- **Integration:** "New HS Context" in WRVault opens the structured editor (not the legacy form) for publisher+ users.  
- **Unit:** `renderHandshakeContextDialog` is not called for HS Context create when the structured path is used (or the function is removed/replaced).  
- **E2E:** Create HS Context from WRVault → structured form visible → save → profile appears in list and uses `hs_context_profiles` model.

---

## 10. Most Likely Root Cause

**The structured HS Context editor was implemented in `VaultUI.tsx` / `HsContextProfileList` / `HsContextProfileEditor`, but the active WRVault UI is `vault-ui-typescript.ts`, which was never updated.** All "New HS Context" actions in the active path call `renderHandshakeContextDialog`, so users always see the legacy generic form.

**Type:** Wiring/regression — the refactor exists but was never connected to the WRVault lightbox. It is not a missing implementation of the structured editor; it is a missing connection between the active UI path and that editor.

---

## 11. Minimal Safe Fix Direction

1. **In `vault-ui-typescript.ts`:** When the user creates or edits HS Context and has `canUseHsContextProfiles` (publisher+), do not call `renderHandshakeContextDialog`. Instead, mount the structured editor (e.g. `HsContextProfileEditor` or `HsContextProfileList` in create/edit mode) in the same container.
2. **Mounting:** Create a React root in the vault main content area and render `HsContextProfileEditor` (or a thin wrapper) with `profileId` for edit, `undefined` for create, and `onSaved` / `onCancel` to close and refresh the list.
3. **Tier check:** Before choosing the editor, ensure `currentVaultTier` is publisher+ (or use `getVaultStatus().canUseHsContextProfiles`). If not, keep the legacy form or show an upgrade message.
4. **Legacy path:** Retain `renderHandshakeContextDialog` only if needed for non-publisher users or for backward compatibility with existing legacy items. Otherwise, remove or deprecate it for HS Context.
5. **Generic context:** Do not change the Add Data flow for non–HS Context categories (password, identity, company, custom, document). Only change the `handshake_context` branch.
6. **Scope:** Limit changes to `vault-ui-typescript.ts` and any minimal glue (e.g. React root creation, import of `HsContextProfileEditor`). Avoid broad refactors.

---

*End of analysis.*
