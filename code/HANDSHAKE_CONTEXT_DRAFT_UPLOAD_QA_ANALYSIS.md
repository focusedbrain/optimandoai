# HS Context Draft-Based Document Upload — QA Analysis

**Scope:** Business Documents flow after the recent refactor (draft profile, direct upload, label/type suggestions).  
**Date:** 2025-03-13

---

## 1. Executive Verdict

| Metric | Result |
|--------|--------|
| **Overall QA status** | **PARTIAL** |
| **Release confidence for this flow** | **READY WITH MINOR FIXES** |
| **Top 8 findings (prioritized)** | See below |

### Top 8 Findings (Prioritized)

1. **Cancel cleanup can delete profiles that have documents** — `handleCancel` uses `documents.length === 0`, which can be stale if the user cancels before `reloadDocuments` completes after an upload. Risk: data loss.
2. **Duplicate draft creation in React Strict Mode** — `useEffect` has no guard; double-mount creates two drafts. One becomes orphaned.
3. **`deleteProfile` does not clean `vault_documents`** — Profile delete cascades `hs_context_profile_documents` but leaves `vault_documents` rows orphaned. Storage bloat (pre-existing).
4. **No abort/cleanup in draft-creation effect** — If the component unmounts while `createHsProfile` is in flight, the promise still resolves and may call `setState` on an unmounted component.
5. **Draft creation failure leaves editor in degraded state** — Error is shown, but `currentProfileId` stays undefined; Save disabled; document section shows nothing. No retry path.
6. **Filename suggestion `suggestTypeFromFilename`** — `terms\b` can match substrings (e.g. "terms-of-service.pdf" → contract). Minor; manual override always available.
7. **`suggestLabelFromFilename`** — Filenames like `.pdf` or `....pdf` yield empty string; falls back to `null`. Acceptable.
8. **"Preparing document upload…"** — No loading indicator; slow RPC can make the wait feel unclear.

---

## 2. Draft Profile Lifecycle Analysis

### When the draft is created

- **File:** `HsContextProfileEditor.tsx`
- **Trigger:** `useEffect` with `[profileId]` dependency, when `profileId` is `undefined`
- **Code:** Lines 87–124
- **Action:** Calls `createHsProfile({ name: 'Untitled', ... })` and sets `currentProfileId` and `draftCreating` on success/failure

### Duplicate draft risk

- **Risk:** Yes. The effect has no guard against re-runs.
- **Scenarios:**
  - React 18 Strict Mode double-mount in development → effect runs twice → two `createHsProfile` calls → two drafts; only one ID stored.
  - Parent re-renders that change `profileId` from `undefined` to `undefined` → effect does not re-run (dependency unchanged). Safe.
  - User opens create → effect runs → user navigates away before completion → editor unmounts → effect cleanup not defined → promise may still resolve and call `setState` on unmounted component.
- **Protection:** None. No `didCreateRef`, no `AbortController`, no cleanup.

### Draft creation failure

- **Behavior:** `catch` sets `setError(...)` and `setDraftCreating(false)`.
- **State:** `currentProfileId` remains `undefined`.
- **UI:** Error banner, "Preparing document upload…" replaced by `null` (no upload component), Save disabled.
- **Recovery:** User must Cancel and retry; no retry in-place.

### User edits before draft creation finishes

- **Behavior:** Form is shown immediately (no `loading` for create path). User can edit name, description, etc.
- **State:** Edits go to local state. When draft resolves, `setName('Untitled')` overwrites any name the user typed.
- **Bug:** User edits name during creation → draft completes → name reset to "Untitled". User loses input.

### Save upgrading draft

- **Path:** `handleSave` → `updateHsProfile(currentProfileId!, input)` (lines 254–255)
- **Correctness:** Same profile is updated; no second profile created. Documents stay attached via `profile_id`.

### Cancel cleanup reliability

- **Logic:** `handleCancel` (lines 275–282): if `!profileId && currentProfileId && name.trim() === 'Untitled' && documents.length === 0`, call `deleteHsProfile(currentProfileId)`.
- **Issue:** `documents` is async state. After upload, `onDocumentsChanged` → `reloadDocuments` → `getHsProfile` → `setDocuments`. If user cancels before that completes, `documents.length === 0` while the profile has documents → profile (and documents) are deleted.
- **Verdict:** **PARTIAL** — Logic is correct when state is up to date; race makes it unsafe.

### Files / components involved

- `HsContextProfileEditor.tsx`: `useEffect` (87–124), `handleCancel` (275–282), `handleSave` (171–264)
- `hsContextProfilesRpc.ts`: `createHsProfile`, `deleteHsProfile`, `updateHsProfile`
- `hsContextProfileService.ts`: `createProfile`, `deleteProfile`, `updateProfile`

### Lifecycle verdict: **PARTIAL**

- Duplicate draft risk (Strict Mode, no guard)
- Name overwrite when user edits during creation
- Cancel cleanup race with async `documents`
- No effect cleanup for in-flight creation

---

## 3. Document Upload Readiness Analysis

### Gating conditions

- **File:** `HsContextProfileEditor.tsx` lines 313–324
- **Logic:**
  - `draftCreating === true` → show "Preparing document upload…"
  - `draftCreating === false && currentProfileId` → render `HsContextDocumentUpload`
  - Otherwise → `null`
- **`HsContextDocumentUpload`:** Requires `profileId: string` (non-optional). Not rendered until `currentProfileId` is set.

### Can upload happen before a valid profile ID?

- **No.** `HsContextDocumentUpload` is only rendered when `currentProfileId` is truthy. The upload button cannot be shown or used without it.

### Transition from preparing to upload enabled

- **Flow:** `draftCreating` true → `createHsProfile` resolves → `setDraftCreating(false)` and `setCurrentProfileId(created.id)` → next render shows `HsContextDocumentUpload`.
- **Safety:** Single state update; no intermediate invalid state.

### Rapid user interaction during draft creation

- **Scenario:** User repeatedly clicks where the upload button will appear.
- **Behavior:** Upload section shows "Preparing document upload…"; no button. No race.

### Multiple uploads during initialization

- **Scenario:** Draft created, user uploads several files quickly.
- **Behavior:** Each upload uses the same `profileId`. `onDocumentsChanged` triggers `reloadDocuments` after each upload. No special handling for concurrent uploads; each is sequential in `handleFileChange`. Acceptable.

### Delayed or failed draft creation

- **Delayed:** "Preparing document upload…" stays until resolution. No timeout.
- **Failed:** `draftCreating` set to false, `currentProfileId` stays undefined → upload section shows `null`. No upload possible.

### Verdict: **PASS**

- Upload is correctly gated on `currentProfileId`.
- Transition is clear and safe.
- No upload before a valid profile ID.

---

## 4. Cancel / Cleanup Behavior

### What happens on cancel for a new draft

- **File:** `HsContextProfileEditor.tsx` lines 275–282
- **Steps:**
  1. If `!profileId && currentProfileId && name.trim() === 'Untitled' && documents.length === 0` → `deleteHsProfile(currentProfileId)` (errors ignored)
  2. `onCancel()` → parent sets `view='list'`, `editingId=undefined` → editor unmounts

### Do uploaded documents remain if the user cancels?

- **If cleanup runs (condition true):** Profile is deleted. `hs_context_profile_documents` are removed by CASCADE. `vault_documents` rows are **not** deleted (see Section 7).
- **If cleanup does not run:** Profile and documents remain. Intentional for drafts with documents or a changed name.

### Orphan risk

- **Parsed text / metadata:** In `hs_context_profile_documents`. CASCADE removes them when the profile is deleted.
- **Original files:** In `vault_documents`. `deleteProfile` does not remove them → **orphans**.
- **Cleanup rule:** Only runs when `name === 'Untitled'` and `documents.length === 0`. Stale `documents` can cause incorrect deletion (see Section 2).

### Drafts with uploaded docs but no save

- **Intent:** Preserved. Cleanup only when `documents.length === 0`.
- **Bug:** Race can make `documents.length === 0` when there are documents → profile deleted.

### Repeated create/cancel cycles

- **Scenario:** User opens create → cancel (empty) → create again → cancel (empty) → repeat.
- **Behavior:** Each create makes a new draft. Each cancel with empty draft deletes it. No accumulation.
- **Scenario:** User opens create → cancel before draft completes. No `currentProfileId` → condition false → no delete. Draft may be created after unmount → **orphan** "Untitled" profile.

### Files

- `HsContextProfileEditor.tsx`: `handleCancel` (275–282)
- `hsContextProfilesRpc.ts`: `deleteHsProfile`
- `hsContextProfileService.ts`: `deleteProfile`

### Verdict: **PARTIAL**

- Logic is correct when state is accurate.
- Race on `documents.length` can cause data loss.
- Cancel before draft completes can leave orphan drafts.
- `vault_documents` not cleaned on profile delete (pre-existing).

---

## 5. Save Flow Correctness

### Does save update the same draft?

- **Yes.** `handleSave` always calls `updateHsProfile(currentProfileId!, input)`. No second profile is created.

### Do uploaded documents remain attached?

- **Yes.** Documents are linked by `profile_id`. Update does not change that.

### Document metadata

- **Yes.** Label, `document_type`, sensitive are stored in `hs_context_profile_documents` and survive update.

### Label/type suggestions

- **Editable:** User can change label/type before upload. After upload, Edit updates metadata via `updateHsProfileDocumentMeta`.
- **Persistence:** Stored in DB; survives save and reload.

### Existing profile edit flow

- **Path:** `profileId` provided → `getHsProfile` loads data → no draft creation. Save uses `updateHsProfile` with the same ID.
- **Correctness:** Unchanged; no regression.

### Files

- `HsContextProfileEditor.tsx`: `handleSave` (171–264)
- `hsContextProfilesRpc.ts`: `updateHsProfile`
- `hsContextProfileService.ts`: `updateProfile`

### Verdict: **PASS**

---

## 6. Filename Suggestion Quality and Safety

### Helpers

- **File:** `HsContextDocumentUpload.tsx` lines 12–26
- **`suggestLabelFromFilename`:** Strip `.pdf`, replace `[-_]+` with space, collapse spaces.
- **`suggestTypeFromFilename`:** Lowercase, keyword checks for manual/contract/certificate/pricelist, else `custom`.

### Normalization

- **Label:** `.replace(/\.pdf$/i, '')`, `.replace(/[-_]+/g, ' ')`, `.replace(/\s+/g, ' ')`, `.trim()`.
- **Type:** `.toLowerCase()`, `.replace(/\.pdf$/i, '')`.

### Unusual filenames

- **`.pdf`:** Label `''`, type `'custom'`. Passed as `null` when empty. Safe.
- **`....pdf`:** Label `'...'`, type `'custom'`. Acceptable.
- **Very long names:** No truncation; `validateDocumentLabel` allows up to 200 chars. Fine.

### Extension stripping

- **Regex:** `/\.pdf$/i`. Handles `.PDF`, `.pdf`. Fails for `.pdf.bak` (would leave `.bak`). Edge case.

### Keyword mapping

- **manual:** `manual`, `user guide`, `handbook`, `instructions`
- **contract:** `contract`, `agreement`, `terms`
- **certificate:** `certificate`, `cert`
- **pricelist:** `price`, `pricelist`, `pricing`
- **custom:** Fallback

### False positives

- **`terms`:** Matches "terms-of-service", "terms and conditions". Plausible.
- **`cert`:** Matches "certification", "certain". Possible false positives.
- **`price`:** Matches "priceless", "appraisal". Possible false positives.

### Manual override

- **Before upload:** User can set label/type; `(nextLabel.trim() || suggestedLabel)` and `(nextDocumentType.trim() || suggestedType)` prefer user input.
- **After upload:** Edit updates metadata; suggestions are not reapplied.

### Verdict: **PASS**

- Logic is simple and deterministic.
- Override is always possible.
- Some false positives; low impact.

---

## 7. Data Integrity / Storage Analysis

### Distinguishing drafts from final profiles

- **No schema flag.** Drafts are normal profiles with `name: 'Untitled'`. No `is_draft` or similar.

### Partially completed records

- **Drafts with documents but no save:** Remain in DB. User can return via list and edit.
- **Drafts with no documents, name "Untitled", cancel:** Deleted by cleanup.
- **Drafts with no documents, name changed, cancel:** Remain (cleanup does not run).

### Document handling for drafts

- Same tables and FKs as for normal profiles. No special handling.

### Delete/cleanup and child records

- **`deleteProfile`:** `DELETE FROM hs_context_profiles WHERE id = ?`
- **CASCADE:** `hs_context_profile_documents` has `ON DELETE CASCADE` → document rows removed.
- **`vault_documents`:** Referenced by `storage_key` in `hs_context_profile_documents`. No FK. CASCADE does not touch `vault_documents` → **orphan rows** when a profile is deleted.

### Consistency

- **`hs_context_profiles` / `hs_context_profile_documents`:** Consistent. CASCADE keeps referential integrity.
- **`vault_documents`:** Orphaned when profiles (or documents) are deleted via profile delete. `deleteProfileDocument` correctly deletes from `vault_documents` first; `deleteProfile` does not.

### Files

- `hsContextProfileService.ts`: `deleteProfile` (280–284), `deleteProfileDocument` (435–451)
- `db.ts`: schema for `hs_context_profiles`, `hs_context_profile_documents`, `vault_documents`

### Verdict: **PARTIAL**

- Profile/document consistency is good.
- `deleteProfile` leaves `vault_documents` orphans (pre-existing).

---

## 8. UI / UX Edge-Case Analysis

### Slow draft creation

- **State:** "Preparing document upload…" with no spinner.
- **Experience:** User may be unsure if something is loading. No timeout or retry.

### Transition clarity

- **Flow:** Preparing → upload controls. Clear when it works.
- **Failure:** Error banner; document section goes to `null`. No explicit "Retry" or "Start over".

### Flashes / disabled states

- **Save:** Disabled when `!currentProfileId` or `saving`. Clear.
- **Upload:** Not shown until ready. No flash of disabled upload.

### Business Documents placement

- **Position:** After Profile Info, before Company/Organization.
- **Fit:** Documents are prominent; order is logical.

### Interaction with other fields

- **No conflicts.** Documents and profile fields are independent. No shared state issues.

### Files

- `HsContextProfileEditor.tsx`: Business Documents block (287–325), header (322–341)

### Verdict: **PARTIAL**

- Flow is coherent when it works.
- Preparing state could be clearer (e.g. spinner).
- Failure state could offer retry.

---

## 9. Existing Tests and Missing Tests

### Current coverage

- **`hsContextProfileService.test.ts`:** CRUD, tier gating, duplicate, document metadata, validation. No tests for:
  - Draft creation flow
  - Duplicate-draft prevention
  - Cancel cleanup
  - Save-after-upload
  - Orphan prevention
- **Extension/editor:** No tests for `HsContextProfileEditor` or `HsContextDocumentUpload`.

### Missing tests

1. Draft creation on mount when `profileId` is undefined
2. No duplicate draft when effect runs twice (e.g. Strict Mode)
3. Cancel cleanup: delete only when Untitled and no documents
4. Cancel with documents: do not delete
5. Save updates draft and keeps documents
6. Filename suggestion behavior (label/type)
7. Upload readiness: no upload before `currentProfileId`
8. Draft creation failure handling

### Verdict: **FAIL**

- Backend has solid coverage; draft/upload flow is untested.
- Critical paths (cancel, duplicate draft, save-after-upload) have no tests.

---

## 10. Blocking Issues Before Release

### B1. Cancel cleanup race (data loss)

- **Why blocking:** User can lose uploaded documents if they cancel before `reloadDocuments` completes.
- **Location:** `HsContextProfileEditor.tsx` `handleCancel` (275–282), use of `documents.length === 0`
- **Fix direction:** Use a ref (e.g. `hasUploadedSinceMount`) set on upload success. Only delete when `!hasUploadedSinceMount`. Alternatively, fetch profile and check `document_count` before delete.

### B2. Duplicate draft in Strict Mode (orphans)

- **Why blocking:** Double-mount creates two drafts; one is orphaned.
- **Location:** `HsContextProfileEditor.tsx` `useEffect` (87–124)
- **Fix direction:** Add a ref (e.g. `draftCreationStartedRef`) and skip creation if already set. Or use `AbortController` and ignore results after unmount.

### B3. Name overwrite during draft creation

- **Why blocking:** User can type a name while the draft is being created; `setName('Untitled')` on success overwrites it.
- **Location:** `HsContextProfileEditor.tsx` `useEffect` (115)
- **Fix direction:** Only call `setName('Untitled')` if the current name is still empty or "Untitled". Or avoid overwriting user input.

---

## 11. Non-Blocking Follow-Ups

1. **`deleteProfile` and `vault_documents`:** Before deleting the profile, load document rows, delete their `vault_documents` entries, then delete the profile (or add a service helper).
2. **Effect cleanup:** Add cleanup that sets a "cancelled" flag and ignores the `createHsProfile` result if the component has unmounted.
3. **Preparing state:** Add a spinner or progress indicator next to "Preparing document upload…".
4. **Draft creation failure:** Add a "Retry" or "Try again" control when creation fails.
5. **Filename suggestions:** Refine regex (e.g. `\bterms\b` instead of `terms\b`) to reduce false positives.
6. **Unit tests:** Add tests for draft creation, cancel cleanup, and save-after-upload.

---

## 12. Final Recommendation

**SHIP AFTER SMALL FIXES**

**Rationale:** The flow is structurally sound: upload is gated correctly, save updates the same profile, and document handling is consistent. The main risks are:

1. Cancel cleanup race (B1) — can cause data loss.
2. Duplicate draft creation (B2) — causes orphan profiles.
3. Name overwrite (B3) — poor UX and potential confusion.

Fixing B1, B2, and B3 is small in scope (refs, guards, conditional `setName`). The `vault_documents` orphan issue is pre-existing and can be handled in a separate change.

**Recommendation:** Fix B1, B2, and B3, then ship. Add tests and `vault_documents` cleanup as follow-ups.
