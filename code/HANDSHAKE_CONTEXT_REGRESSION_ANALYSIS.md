# Handshake Context Selection & Tier Gating — Regression Analysis

**Date:** 2025-03-13  
**Task:** Focused code analysis for regression in handshake context selection and tier gating.  
**Status:** Analysis complete — no implementation.

---

## 1. Executive Diagnosis

### Most likely root cause of the missing Ad Hoc Context option

**The entire Context Graph section (including both "Vault Profiles" and "Ad-hoc Context" tabs) is gated on `canUseHsContextProfiles` in `SendHandshakeDelivery.tsx`.** When a Pro user initiates a handshake, `canUseHsContextProfiles` is `false` (because `canAccessRecordType('pro', 'handshake_context', 'share')` returns `false`). The component hides the whole section, so the user never sees the option to add any context — including Ad Hoc.

### Cause breakdown

| Factor | Contribution |
|--------|--------------|
| **a) Tier gating** | **Primary.** `canUseHsContextProfiles` is derived from `canAccessRecordType(tier, 'handshake_context', 'share')`, which is `false` for Pro. The UI incorrectly uses this flag to gate the entire Context Graph, not just Vault Profiles. |
| **b) Vault locked state** | **Secondary.** Accept flow disables the Accept button when vault is locked, but the Context Graph (including Ad-hoc) remains visible. Vault locked does not hide Ad Hoc in AcceptHandshakeModal. |
| **c) Tab rendering logic** | **Primary.** In `SendHandshakeDelivery`, the whole tabbed section is wrapped in `includeVaultProfiles && canUseHsContextProfiles`, so both tabs disappear together. |
| **d) Modal state / conditional rendering** | **Primary.** The conditional `{includeVaultProfiles && canUseHsContextProfiles && (...)}` at line 676 of `SendHandshakeDelivery.tsx` hides the entire Context Graph when either condition fails. |
| **e) Linux-specific behavior** | **None.** No platform-specific logic found. Linux is simply where the regression was observed. |
| **f) Combination** | **Yes.** Tier gating (a) drives the flag; tab rendering (c) and conditional rendering (d) apply it too broadly. |

---

## 2. Active Handshake UI Path

### Call chain for context attachment

#### Initiate flow (Electron)

```
App.tsx
  └─ HandshakeView (onNewHandshake)
       └─ HandshakeInitiateModal
            └─ SendHandshakeDelivery  ← BUG: gates entire Context Graph on canUseHsContextProfiles
```

#### Initiate flow (Extension sidepanel / popup)

```
sidepanel.tsx / popup-chat.tsx
  └─ SendHandshakeDelivery  ← Same bug
```

#### Accept flow (Electron)

```
HandshakeView
  └─ PendingSlideOut (onAccept)
       └─ AcceptHandshakeModal  ← OK: Context Graph always visible; only Vault tab content gated
```

#### Alternative initiate flow (Extension — HandshakeRequestForm / InitiateHandshakeDialog)

```
HandshakeRequestForm / InitiateHandshakeDialog
  └─ Context Graph always visible  ← OK: Ad-hoc available to all
```

### Exact files and components

| Component | File | Role |
|-----------|------|------|
| HandshakeView | `apps/electron-vite-project/src/components/HandshakeView.tsx` | Main handshake layout; fetches `canUseHsContextProfiles` from `getVaultStatus`, passes to AcceptHandshakeModal |
| AcceptHandshakeModal | `apps/electron-vite-project/src/components/AcceptHandshakeModal.tsx` | Accept flow; Vault Profiles + Ad-hoc tabs; **always shows Context Graph** |
| HandshakeInitiateModal | `apps/electron-vite-project/src/components/HandshakeInitiateModal.tsx` | Wraps SendHandshakeDelivery; fetches `canUseHsContextProfiles` from `getVaultStatus` |
| HandshakeRequestView | `apps/electron-vite-project/src/components/HandshakeRequestView.tsx` | Uses SendHandshakeDelivery directly |
| SendHandshakeDelivery | `apps/extension-chromium/src/handshake/components/SendHandshakeDelivery.tsx` | **Buggy:** gates entire Context Graph on `includeVaultProfiles && canUseHsContextProfiles` |
| HandshakeRequestForm | `apps/extension-chromium/src/handshake/components/HandshakeRequestForm.tsx` | **Correct:** Context Graph always visible; only "Include Vault Profiles" toggle gated |
| InitiateHandshakeDialog | `apps/extension-chromium/src/handshake/components/InitiateHandshakeDialog.tsx` | **Correct:** Context Graph always visible |

### Tab rendering

- **AcceptHandshakeModal** (lines 286–310): Tabs `['vault','adhoc']` always rendered when `showContextGraph` is true. No `canUseHsContextProfiles` check on the tab bar.
- **SendHandshakeDelivery** (lines 709–733): Tabs inside `{includeVaultProfiles && canUseHsContextProfiles && (...)}` — entire block hidden when `canUseHsContextProfiles` is false.
- **HandshakeRequestForm** (lines 414–436): Tabs always rendered; Context Graph section not wrapped in `canUseHsContextProfiles`.

### Props controlling visibility

| Prop | Source | Used to gate |
|------|--------|--------------|
| `canUseHsContextProfiles` | `getVaultStatus()` → `canAccessRecordType(tier, 'handshake_context', 'share')` | Vault Profiles picker (correct) and entire Context Graph (incorrect in SendHandshakeDelivery) |
| `includeVaultProfiles` | Local state, default `true` | Toggle for attaching Vault Profiles; in SendHandshakeDelivery also gates entire Context Graph (incorrect) |
| `isVaultUnlocked` | `getVaultStatus()` | Profile picker disabled state; Accept button disabled |

### Vault locked UI

- **VaultStatusIndicator** (`apps/electron-vite-project/src/components/VaultStatusIndicator.tsx`): Shows "Vault unlock required" when `!isUnlocked && requiresVault`. Does not replace the Context Graph area.
- **AcceptHandshakeModal** (line 419): `disabled={accepting || !isVaultUnlocked}` on Accept button. Context Graph (including Ad-hoc) remains visible.

### Upgrade / publisher gating UI

- **Vault tab content** (when `!canUseHsContextProfiles`): "Publisher / Enterprise feature" / "Upgrade to attach structured Vault Profiles…" message instead of `HandshakeContextProfilePicker`.
- **SendHandshakeDelivery** (lines 552–578): "Add a Context Graph" toggle wrapped in `canUseHsContextProfiles` — when false, the toggle is hidden entirely.

---

## 3. Ad Hoc Context Gating Analysis

### Current conditions controlling Ad Hoc visibility

| File | Condition | Effect |
|------|-----------|--------|
| **SendHandshakeDelivery.tsx** | Line 552: `{canUseHsContextProfiles && (...)}` | Hides "Add a Context Graph" toggle when `canUseHsContextProfiles` is false |
| **SendHandshakeDelivery.tsx** | Line 676: `{includeVaultProfiles && canUseHsContextProfiles && (...)}` | Hides entire Context Graph (Vault + Ad-hoc tabs) when either is false |
| **AcceptHandshakeModal.tsx** | No gate on Ad-hoc tab | Ad-hoc tab always visible when Context Graph expanded |
| **HandshakeRequestForm.tsx** | No gate on Context Graph section | Context Graph (including Ad-hoc) always visible |
| **InitiateHandshakeDialog.tsx** | No gate on Context Graph section | Context Graph (including Ad-hoc) always visible |

### Is Ad Hoc visibility tied to `canUseHsContextProfiles`?

**Yes, in SendHandshakeDelivery only.** The whole Context Graph block (including Ad-hoc) is inside `includeVaultProfiles && canUseHsContextProfiles`.

### Is Ad Hoc visibility tied to vault status?

**No.** Ad-hoc content (plain text/JSON) does not require vault access. `isVaultUnlocked` is used to disable the Accept button and the profile picker, not to hide Ad-hoc.

### Are Ad Hoc upload/input controls hidden when vault is locked?

**No.** In AcceptHandshakeModal, the Ad-hoc textarea and controls are shown regardless of vault state. The Accept button is disabled when vault is locked.

### Is tab switching to Ad-hoc prevented?

**In SendHandshakeDelivery:** Yes — the whole tabbed section is hidden when `canUseHsContextProfiles` is false, so the user cannot switch to Ad-hoc.

**In AcceptHandshakeModal, HandshakeRequestForm, InitiateHandshakeDialog:** No — Ad-hoc tab is always available.

### Shared conditional rendering

**SendHandshakeDelivery** uses a single condition for both the "Add a Context Graph" toggle and the tabbed section. That incorrectly hides Ad-hoc together with Vault Profiles.

### Match to intended behavior

| Component | Intended | Actual |
|-----------|----------|--------|
| SendHandshakeDelivery | Ad-hoc always available | Ad-hoc hidden when `canUseHsContextProfiles` is false |
| AcceptHandshakeModal | Ad-hoc always available | Correct |
| HandshakeRequestForm | Ad-hoc always available | Correct |
| InitiateHandshakeDialog | Ad-hoc always available | Correct |

---

## 4. Structured HS Context / Vault Profiles Gating Analysis

### Current gating

| Check | Location | Purpose |
|-------|----------|---------|
| `canUseHsContextProfiles` | `main.ts` lines 2577, 5969: `canAccessRecordType(tier, 'handshake_context', 'share')` | Tier gate for HS Context Profiles |
| Vault tab content | All components: `canUseHsContextProfiles ? <HandshakeContextProfilePicker /> : <UpgradeMessage />` | Show picker or upgrade message |
| `isVaultUnlocked` | HandshakeContextProfilePicker `disabled` / `isVaultUnlocked` | Disable picker when vault locked |

### Tier checks

- **vaultCapabilities.ts**: `RECORD_TYPE_MIN_TIER['handshake_context'] = 'publisher'`
- **main.ts**: `canUseHsContextProfiles = canAccessRecordType(tier, 'handshake_context', 'share')`
- **hsContextProfileService.ts** (line 99): `requireHsContextAccess(tier, action)` → `canAccessRecordType`
- **hsContextAccessService.ts** (line 25): Same pattern

### Vault locked checks

- Profile picker receives `isVaultUnlocked` and disables when locked.
- Accept flow: Accept button disabled when `!isVaultUnlocked`.

### Upgrade message logic

- When `!canUseHsContextProfiles`, Vault tab shows: "Publisher / Enterprise feature" / "Upgrade to attach structured Vault Profiles…"

### Separation from Ad Hoc

- **Correct:** AcceptHandshakeModal, HandshakeRequestForm, InitiateHandshakeDialog gate only the Vault tab content, not the Context Graph or Ad-hoc tab.
- **Incorrect:** SendHandshakeDelivery gates the entire Context Graph (including Ad-hoc) on `canUseHsContextProfiles`.

---

## 5. Vault Locked State Analysis

### Does vault locked block only Vault Profiles or the whole context UI?

- **AcceptHandshakeModal:** Vault locked disables the Accept button but does not hide the Context Graph. Ad-hoc remains usable for input; only submission is blocked until vault is unlocked.
- **SendHandshakeDelivery:** The Context Graph is hidden by `canUseHsContextProfiles`, not by vault locked. Vault locked is a separate concern (e.g. vault error banner when `includeVaultProfiles` and vault error).

### Should Ad Hoc remain usable when vault is locked?

**Yes.** Ad-hoc is plain text/JSON and does not require vault access. Only the Accept button (signing) and Vault Profiles picker should depend on vault unlock.

### Is the locked-state panel rendered too high?

**No.** VaultStatusIndicator is a separate component. The Context Graph is not replaced by a "Vault is locked" panel. The regression is from tier gating, not vault locked UI.

### Where vault locked state is used

- **VaultStatusIndicator**: `isUnlocked`, `warningEscalated`, `requiresVault`
- **AcceptHandshakeModal**: `disabled={accepting || !isVaultUnlocked}` on Accept button
- **HandshakeContextProfilePicker**: `isVaultUnlocked` prop for disabled state

### Is the vault locked panel overly broad?

**No.** The regression is from `canUseHsContextProfiles` gating the whole Context Graph in SendHandshakeDelivery, not from vault locked UI.

---

## 6. Tier / Account-State Analysis

### Code path

1. **IPC:** `vault:getStatus` (main.ts ~2574)
2. **Tier:** `getEffectiveTier({ refreshIfStale: false, caller: 'vault-getStatus' })`
3. **Gate:** `canUseHsContextProfiles = canAccessRecordType(tier, 'handshake_context', 'share')`
4. **Return:** `{ isUnlocked, name, tier, canUseHsContextProfiles }`
5. **UI:** Components call `window.handshakeView?.getVaultStatus?.()` and use `status?.canUseHsContextProfiles ?? false`

### Tier logic

- **vaultCapabilities.ts**: `canAccessRecordType('pro', 'handshake_context', 'share')` → `false`
- **vaultCapabilities.ts**: `canAccessRecordType('publisher', 'handshake_context', 'share')` → `true`

### Linux relevance

**None.** Tier and vault status come from the same IPC/API path on all platforms. Linux is where the regression was observed, not a cause.

### Is tier logic too broad for UI?

**Yes.** `canUseHsContextProfiles` correctly represents "can use HS Context Profiles (Vault Profiles)". The bug is that SendHandshakeDelivery uses it to gate the entire Context Graph, including Ad-hoc, which should be available to all tiers.

---

## 7. Regression Analysis

### Before the HS Context publisher gating refactor

- Likely: Context Graph (Vault + Ad-hoc) was shown to all users.
- Vault Profiles picker may have been gated or not; Ad-hoc was available.

### After the refactor

- `canUseHsContextProfiles` introduced and passed from `getVaultStatus`.
- **SendHandshakeDelivery** (lines 552, 676): "Add a Context Graph" toggle and entire Context Graph wrapped in `canUseHsContextProfiles` (and `includeVaultProfiles`).
- **AcceptHandshakeModal, HandshakeRequestForm, InitiateHandshakeDialog**: Only Vault tab content gated; Context Graph and Ad-hoc remain visible.

### Likely culprit

**File:** `apps/extension-chromium/src/handshake/components/SendHandshakeDelivery.tsx`

**Conditions:**
- Line 552: `{canUseHsContextProfiles && (...)}` — "Add a Context Graph" toggle
- Line 676: `{includeVaultProfiles && canUseHsContextProfiles && (...)}` — entire Context Graph

**Change in logic:** A single flag (`canUseHsContextProfiles`) was used to gate both Vault Profiles and the whole Context Graph, instead of only Vault Profiles.

### UI vs API regression

**UI regression only.** The API/RPC still accepts ad-hoc context. The problem is that Pro users never see the UI to add it in the initiate flow when using SendHandshakeDelivery.

---

## 8. Confirm Intended Fix Boundaries

### Free users

- **Ad Hoc Context:** Visible and usable.
- **Vault Profiles / HS Context Profiles:** Hidden or upgrade message.
- **Context Graph section:** Visible with Ad-hoc tab available.

### Pro users

- **Ad Hoc Context:** Visible and usable.
- **Vault Profiles / HS Context Profiles:** Upgrade message in Vault tab.
- **Context Graph section:** Visible with both tabs; Vault tab shows upgrade, Ad-hoc tab is usable.

### Publisher / Publisher Lifetime / Enterprise users

- **Ad Hoc Context:** Visible and usable.
- **Vault Profiles / HS Context Profiles:** Full access when vault unlocked.
- **Context Graph section:** Visible with both tabs; both usable when vault unlocked.

### Vault locked state

- **Vault Profiles:** Picker disabled or blocked; upgrade/unlock messaging as appropriate.
- **Ad Hoc Context:** Remain usable for input; only signing/submission blocked when required.

### Mapping to components

| Component | "Add Context" / Context Graph | Vault tab | Ad-hoc tab |
|-----------|------------------------------|-----------|------------|
| AcceptHandshakeModal | Always visible when expanded | Gated by `canUseHsContextProfiles` | Always visible |
| SendHandshakeDelivery | **Should be:** always visible | Gated by `canUseHsContextProfiles` | **Should be:** always visible |
| HandshakeRequestForm | Always visible | Gated by `canUseHsContextProfiles` | Always visible |
| InitiateHandshakeDialog | Always visible | Gated by `canUseHsContextProfiles` | Always visible |

---

## 9. Implementation Anchors for the Follow-Up Fix

### Files to change

1. **`apps/extension-chromium/src/handshake/components/SendHandshakeDelivery.tsx`**

### Components / props / conditions to adjust

1. **"Add a Context Graph" toggle (lines 552–578)**  
   - **Current:** Wrapped in `{canUseHsContextProfiles && (...)}`  
   - **Change:** Show toggle for all users. When `!canUseHsContextProfiles`, default `includeVaultProfiles` to `false` or show toggle with Ad-hoc-only behavior.

2. **Context Graph section (lines 675–906)**  
   - **Current:** `{includeVaultProfiles && canUseHsContextProfiles && (...)}`  
   - **Change:** Always show the Context Graph section (or show when `includeVaultProfiles || true` for Ad-hoc). Decouple from `canUseHsContextProfiles`.  
   - **Options:**  
     - A) Show Context Graph always; gate only Vault tab content on `canUseHsContextProfiles`.  
     - B) Show when `includeVaultProfiles || canUseHsContextProfiles` so Ad-hoc is available even when `includeVaultProfiles` is false.  
   - **Recommended:** Match HandshakeRequestForm / InitiateHandshakeDialog: Context Graph always visible; "Include Vault Profiles" toggle only when `canUseHsContextProfiles`; Vault tab content gated; Ad-hoc tab always usable.

3. **`includeVaultProfiles` semantics**  
   - When `!canUseHsContextProfiles`, `includeVaultProfiles` is irrelevant (no profiles). Ensure Ad-hoc path does not depend on it.

### Where to decouple Ad Hoc from HS Context profile gating

- **SendHandshakeDelivery.tsx** lines 552 and 676: Remove `canUseHsContextProfiles` from the conditions that control visibility of the Context Graph and Ad-hoc tab.
- Keep `canUseHsContextProfiles` only for: "Include Vault Profiles" toggle visibility (when applicable) and Vault tab content (picker vs upgrade message).

### Where to scope vault locked state to Vault Profiles only

- Vault locked already affects only profile picker and Accept button. No change needed for vault locked scoping.

### Tests to add or update

- **Unit:** Pro user with `canUseHsContextProfiles: false` sees Ad-hoc tab and can add ad-hoc context in SendHandshakeDelivery.
- **Integration:** Initiate handshake as Pro user; verify Ad-hoc context is sent.
- **Regression:** Publisher user still sees Vault Profiles and upgrade message for Free/Pro.

---

## Most Likely Root Cause

**SendHandshakeDelivery gates the entire Context Graph (including "Add a Context Graph" and both Vault and Ad-hoc tabs) on `includeVaultProfiles && canUseHsContextProfiles`.** For Pro users, `canUseHsContextProfiles` is false, so the whole section is hidden and they cannot add any context, including Ad Hoc.

---

## Minimal Safe Fix Direction

1. **In SendHandshakeDelivery.tsx:**  
   - Always show the Context Graph section (collapsible + tabs), independent of `canUseHsContextProfiles`.  
   - Show the "Include Vault Profiles" toggle only when `canUseHsContextProfiles` (or hide it and default `includeVaultProfiles` to false when `!canUseHsContextProfiles`).  
   - Gate only the Vault tab content on `canUseHsContextProfiles`; keep the Ad-hoc tab always visible and usable.

2. **Align with HandshakeRequestForm and InitiateHandshakeDialog:**  
   - Context Graph always visible.  
   - "Include Vault Profiles" toggle conditional on `canUseHsContextProfiles`.  
   - Vault tab: picker or upgrade message based on `canUseHsContextProfiles`.  
   - Ad-hoc tab: always available.

3. **Preserve existing behavior:**  
   - `skipVaultContext: !canUseHsContextProfiles || !includeVaultProfiles` in RPC options.  
   - No changes to AcceptHandshakeModal, HandshakeRequestForm, or InitiateHandshakeDialog.
