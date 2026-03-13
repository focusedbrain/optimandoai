# WRVault — Context Graph Profile Linking: Codebase Analysis

## Executive Summary

**Root cause identification:** The analysis reveals **two distinct issues**:

1. **Handshake Accept dialog lacks the full Context Graph UI** — The `HandshakeAcceptModal` does not render `HandshakeContextProfilePicker` at all. It only has a boolean "Include Vault Profiles" toggle and does not pass `profile_ids` or `profile_items` to `acceptHandshake()`. If the user expects to see "Add a Context Graph" → "Vault Profiles" tab in the accept flow, that UI was never implemented there.

2. **"No HS Context Profiles found" in Initiate flow** — When the message appears in flows that *do* use the picker (InitiateHandshakeDialog, SendHandshakeDelivery, HandshakeRequestForm), the RPC `vault.hsProfiles.list` returns an empty array. The most likely causes are: **vault mismatch** (profile created in a different vault than the one currently active) or **archived filter** (profile has `archived = 1`).

---

## 1. Accept Dialog Component

### File path and component name

- **HandshakeAcceptModal**: `apps/extension-chromium/src/handshake/components/HandshakeAcceptModal.tsx`

### Current implementation

The `HandshakeAcceptModal` does **not** include:

- The "Add a Context Graph" collapsible section
- The "Vault Profiles" / "Ad-hoc Context" tabs
- The `HandshakeContextProfilePicker` component

It only has:

- A simple "Include Vault Profiles" toggle (lines 167–188)
- `handleAccept` calls `acceptHandshake(handshake.handshake_id, sharingMode, fromAccountId)` **without** `contextOpts` (no `profile_ids`, `profile_items`, or `context_blocks`)

### Where the picker *is* used

`HandshakeContextProfilePicker` is used in **initiator** flows only:

| Component | File | Usage |
|-----------|------|-------|
| InitiateHandshakeDialog | `handshake/components/InitiateHandshakeDialog.tsx` | Dashboard "New Handshake" |
| SendHandshakeDelivery | `handshake/components/SendHandshakeDelivery.tsx` | Sidepanel/Popup WRChat → Handshake Request |
| HandshakeRequestForm | `handshake/components/HandshakeRequestForm.tsx` | Inline handshake request form |

### "No HS Context Profiles found" location

- **File:** `apps/extension-chromium/src/handshake/components/HandshakeContextProfilePicker.tsx`
- **Lines 133–142:** Rendered when `profiles.length === 0` after a successful `listHsProfiles()` call

```tsx
if (profiles.length === 0) {
  return (
    <div style={{...}}>
      No HS Context Profiles found. Create one in the Vault → HS Profiles tab.
    </div>
  )
}
```

### How the picker fetches profiles

- **RPC:** `listHsProfiles(includeArchived = false)` from `vault/hsContextProfilesRpc.ts`
- **Effect:** `useEffect` runs when `isVaultUnlocked !== false`; calls `loadProfiles()` which calls `listHsProfiles()`
- **Parameters:** `includeArchived` defaults to `false` (only non-archived profiles)
- **No filtering:** The picker does not filter by scope, document status, or handshake ID

---

## 2. RPC / Service Layer

### RPC verb

- **Name:** `vault.hsProfiles.list`
- **Params:** `{ includeArchived?: boolean }`

### Handler

- **File:** `apps/electron-vite-project/electron/main/vault/rpc.ts`
- **Lines 327–331:**

```typescript
case 'vault.hsProfiles.list': {
  const includeArchived = params?.includeArchived === true
  const profiles = vaultService.listHsProfiles(tier, includeArchived)
  return { success: true, profiles }
}
```

### Service implementation

- **File:** `apps/electron-vite-project/electron/main/vault/service.ts`
- **Lines 1236–1240:** Delegates to `listProfiles(this.db!, tier, includeArchived)`

### SQL query

- **File:** `apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts`
- **Lines 164–171:**

```sql
SELECT p.*, (SELECT count(*) FROM hs_context_profile_documents d WHERE d.profile_id = p.id) as doc_count
FROM hs_context_profiles p
WHERE p.archived = ?
ORDER BY p.updated_at DESC
```

- **Parameter:** `?` = `includeArchived ? 1 : 0` → when `includeArchived` is false, only `archived = 0` profiles are returned

### Tier gate

- **Function:** `requireHsContextAccess(tier, 'read')` (line 162)
- **Effect:** Throws if `!canAccessRecordType(tier, 'handshake_context', 'read')` — requires Publisher or Enterprise
- **On throw:** The picker would show an error, not "No HS Context Profiles found"

### Filters that could exclude profiles

| Filter | Effect |
|--------|--------|
| `archived = 0` | Archived profiles are excluded when `includeArchived` is false |
| Tier | Free/Pro → throws; Publisher/Enterprise → passes |
| No handshake filter | Query returns all profiles in the vault, not handshake-specific |
| No org_id filter | All orgs in the vault are included |

---

## 3. Profile Lifecycle / State Machine

### Profile statuses

- **archived:** `0` = active, `1` = archived
- **No draft/active/published flags** — only `archived` affects listing

### "Bullrun Athletics" profile

- If it has `archived = 1`, it will not appear when `includeArchived` is false.
- If it has `archived = 0`, it should appear unless the vault DB is different.

### Document extraction status

- The `listProfiles` query does **not** filter by document extraction status.
- Profiles with pending/failed documents are still listed.

---

## 4. Vault Tier / Access Control

### Tier check

- `listProfiles` calls `requireHsContextAccess(tier, 'read')`.
- Tier comes from `getEffectiveTier()` in `main.ts` (line 3805), derived from the JWT session.

### Publisher vs. responder

- The RPC does not distinguish initiator vs. responder.
- `vault.hsProfiles.list` returns the current user's profiles in the active vault, regardless of handshake role.

---

## 5. Database Schema

### hs_context_profiles

```sql
CREATE TABLE IF NOT EXISTS hs_context_profiles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL DEFAULT 'non_confidential',
  tags TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  custom_fields TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
)
```

### hs_context_profile_documents

- Links to `hs_context_profiles` via `profile_id`
- No direct link to handshakes

### Vault isolation

- Each vault uses its own DB file: `~/.opengiraffe/electron-data/vault.db` or `vault_<vaultId>.db`
- Profiles are stored in the **currently active vault's** DB only

---

## 6. Timing / Race Condition Check

### HandshakeContextProfilePicker

- `useEffect` runs when `isVaultUnlocked !== false`
- If `isVaultUnlocked` is `undefined` (loading), the effect runs and fetches
- If `isVaultUnlocked` is `false`, the effect returns early and shows the lock gate

### Possible race

- If the picker mounts before the vault is unlocked, `isVaultUnlocked` may be `undefined` initially, then become `true`. The effect runs once; a later unlock would not re-fetch unless the component remounts or `loadProfiles` is called again.

---

## 7. Data Flow Diagram

```
HandshakeContextProfilePicker (InitiateHandshakeDialog / SendHandshakeDelivery / HandshakeRequestForm)
  └─ useEffect (when isVaultUnlocked !== false)
      └─ loadProfiles()
          └─ listHsProfiles()  [vault/hsContextProfilesRpc.ts]
              └─ sendVaultRpc('vault.hsProfiles.list', { includeArchived: false })
                  └─ chrome.runtime.sendMessage({ type: 'VAULT_RPC', method: 'vault.hsProfiles.list', params: {} })
                      └─ Background: ws.send(JSON.stringify({ id, method, params }))
                          └─ Electron WebSocket handler [main.ts ~3845]
                              └─ handleVaultRPC('vault.hsProfiles.list', params, rpcTier)
                                  └─ vaultService.listHsProfiles(tier, false)
                                      └─ listProfiles(db, tier, false)  [hsContextProfileService.ts]
                                          └─ requireHsContextAccess(tier, 'read')  // throws if free/pro
                                          └─ SQL: SELECT ... FROM hs_context_profiles WHERE archived = 0
                                              └─ result: HsContextProfileSummary[]
                                                  └─ return { success: true, profiles }
                                                      └─ setProfiles(result)
                                                          └─ if result.length === 0 → "No HS Context Profiles found"
```

**Failure point:** The SQL returns 0 rows. Most likely causes: wrong vault DB or all profiles have `archived = 1`.

---

## 8. Hypothesis Verification

| Hypothesis | Verdict |
|------------|---------|
| **A: RPC filters by handshake role** | ❌ Rejected — no role filter in the query |
| **B: Different RPC for responder vs. initiator** | ⚠️ Partial — the accept dialog does not use the picker at all |
| **C: Tier gates listing** | ❌ Rejected — wrong tier would throw, not return empty |
| **D: Query returns profiles linked to handshake** | ❌ Rejected — query returns all vault profiles |
| **E: Archived/status filter** | ✅ **Confirmed** — `archived = 1` excludes profiles when `includeArchived` is false |
| **F: Wrong table** | ❌ Rejected — correct table `hs_context_profiles` is used |

---

## 9. Most Likely Root Causes

### Cause 1: Vault mismatch (high probability)

- User has multiple vaults (e.g. "newvault2").
- Profile "Bullrun Athletics" was created when a different vault (e.g. default) was active.
- When opening the handshake form, the active vault is "newvault2".
- `listHsProfiles` queries the current vault's DB, which has no profiles.

**Check:** Ensure the same vault is active when creating profiles and when opening the handshake request form.

### Cause 2: Archived filter (medium probability)

- Profile was archived (`archived = 1`).
- `listHsProfiles(false)` excludes archived profiles.

**Check:** Call `listHsProfiles(true)` to include archived, or verify the profile is not archived in the DB.

### Cause 3: Accept dialog missing Context Graph UI (design gap)

- The accept dialog does not implement the full "Add a Context Graph" → "Vault Profiles" flow.
- The `acceptHandshake` RPC supports `profile_items` and `profile_ids`, but `HandshakeAcceptModal` never passes them.

---

## 10. Recommended Fixes

### Fix 1: Add full Context Graph UI to HandshakeAcceptModal

Add the same "Add a Context Graph" section used in `InitiateHandshakeDialog` to `HandshakeAcceptModal`:

- Collapsible "Context Graph" section
- Tabs: "Vault Profiles" and "Ad-hoc Context"
- `HandshakeContextProfilePicker` when `canUseHsContextProfiles` is true
- Fetch `canUseHsContextProfiles` via `getVaultStatus()` and `isVaultUnlocked` via `getVaultStatus()`
- Pass `selectedProfileItems` (or `profile_ids` / `profile_items`) to `acceptHandshake()` in `contextOpts`

### Fix 2: Pass context options from accept dialog

Update `handleAccept` in `HandshakeAcceptModal`:

```typescript
await acceptHandshake(handshake.handshake_id, sharingMode, fromAccountId, {
  profile_items: selectedProfileItems,
  policy_selections: defaultPolicy,
})
```

### Fix 3: Include archived profiles when debugging

Temporarily call `listHsProfiles(true)` to see if archived profiles appear. If they do, the archived filter is the cause.

### Fix 4: Vault consistency

- Ensure the handshake form uses the same vault as the Vault UI.
- Consider showing the active vault name in the handshake form so users can confirm they are in the right vault.

---

## 11. Side Effects Check

- **Adding Context Graph to accept modal:** Aligns accept flow with initiate flow; no negative impact if implemented consistently.
- **Changing `includeArchived` default:** Could expose archived profiles; acceptable if intentional.
- **Vault display:** Informational only; no behavioral change.

---

## 12. Files to Modify

| File | Change |
|------|--------|
| `HandshakeAcceptModal.tsx` | Add Context Graph section, `HandshakeContextProfilePicker`, `canUseHsContextProfiles` and `isVaultUnlocked` state, pass `contextOpts` to `acceptHandshake` |
| `HandshakeManagementPanel.tsx` | Pass `canUseHsContextProfiles` to `HandshakeAcceptModal` (same pattern as `InitiateHandshakeDialog`) |
| `HandshakeContextProfilePicker.tsx` | Optional: add `includeArchived` prop for debugging |
