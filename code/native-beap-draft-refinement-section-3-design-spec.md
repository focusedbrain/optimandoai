# SECTION 3 — Design: Capsule Field Selection & Refinement

**Inputs:** Analysis in Sections 1–2 (`native-beap-draft-refinement-1b/1c/1d`, Section 2 IPC trace).  
**Goal:** Specification for **pBEAP** + **qBEAP** selection, chat bar context, refinement routing, accept/reject, deselection, and visuals.

**Important correction:** The depackaged **email** draft path today mixes **focus** (`draftSubFocused`, `setEditingDraftForMessageId` on focus/blur), **mousedown-outside** (`draftRefineDisconnect`), and **Zustand** (`useDraftRefineStore`). It does **not** reliably “keep selection when clicking elsewhere”; clicking the chat bar typically **disconnects** refine and clears sub-focus. The design below targets the **intended** product behavior, not a copy of current bugs.

---

## 1. SELECTION MECHANISM

### 1.1 Recommendation: **A — State-based toggle (no blur dependency)**

| Option | Verdict |
|--------|---------|
| **A) State-based toggle** | **Recommended.** Maintain **`capsuleSelection`** (or equivalent) in React state or a small store slice: **`'none' \| 'public' \| 'encrypted'`**. Clicking a field **toggles or switches** selection; **blur does not change** selection. |
| **B) Focus-based** | **Reject.** Blur fires when moving focus to the chat input → spurious deselection; matches the bug you observed. |
| **C) Same as email draft today** | **Reject as target behavior.** Current email path uses focus/blur for **`draftSubFocused`** / **`subFocus`** and mousedown-outside for **disconnect** — **not** a stable “selected until explicit deselect” model. |

### 1.2 Why state-based

- **Chat refinement requires** typing in **`HybridSearch`** without the capsule textarea staying focused.
- **`useDraftRefineStore.connected`** already represents “wired to chat”; selection of **which** field should persist independently of **DOM focus**.
- **Explicit rules** (click same field to toggle off, click other field to switch) are implementable with **clicks only**, not **focus**.

### 1.3 What to stop using for “selected”

- Do **not** tie “this field is selected for refinement” to **`:focus`** or **`onBlur`** clearing selection.
- **`setEditingDraftForMessageId`** / **`subFocus: draft`** may still be used for **optional** analytics or legacy badges, but **the authoritative “Draft: Public/Encrypted” label** should follow **`capsuleSelection` + `draftRefineConnected`**, not textarea focus alone (see §2).

---

## 2. CONTEXT SWITCHING (CHAT BAR)

### 2.1 Desired labels

| Capsule selection | Chat bar scope label (proposed) |
|-------------------|-----------------------------------|
| **pBEAP selected** | **“Draft: Public”** or **“Draft · Public (pBEAP)”** — **not** generic **“Message”**. |
| **qBEAP selected** | **“Draft: Encrypted”** or **“Draft · Encrypted (qBEAP)”**. |
| **Neither selected** (or refine disconnected) | **“Message”** (current default for selected inbox message). |

Short labels are fine if space is tight; the critical requirement is **distinguish public vs encrypted draft scope** from **whole-message** chat.

### 2.2 What must change (prop/state)

**Today:** `HybridSearch` derives **`uiFocusContext`** only from **`useEmailInboxStore.subFocus`** (`HybridSearch.tsx` **346–355**). **`useDraftRefineStore.refineTarget`** is **not** used for the chip.

**Design:**

1. **Extend `UiFocusContext`** (or add a parallel derived value) so that when:
   - **`activeView === 'beap-inbox'`**,
   - **`selectedMessageId`** is set,
   - **`useDraftRefineStore.connected === true`**,
   - **`draftRefineMessageId === selectedMessageId`**,
   - **`refineTarget === 'capsule-public'`** or **`'capsule-encrypted'`**,

   the scope strip shows **draft capsule** context **even if** the textarea is not focused.

2. **Concrete shape (example):**

   ```ts
   | { kind: 'draft_capsule_public'; messageId: string }
   | { kind: 'draft_capsule_encrypted'; messageId: string }
   ```

   Or a single kind with a discriminant:

   ```ts
   | { kind: 'draft_capsule'; messageId: string; capsule: 'public' | 'encrypted' }
   ```

3. **Implementation lever:** **`useMemo`** for **`uiFocusContext`** should consider **`draftRefineConnected`**, **`draftRefineMessageId`**, **`selectedMessageId`**, and **`refineTarget`** from **`useDraftRefineStore`**, **in addition to** (or instead of for capsule refine) **`subFocus.kind === 'draft'`** from blur-driven editing.

4. **When neither capsule is “selected” for refine:** if not connected or **`refineTarget`** is **`'email'`** on a non-capsule view, fall back to existing **message / attachment** rules.

**“Revert to Message”:** When **`capsuleSelection === 'none'`** *or* **`disconnect()`** *or* message id changes — scope returns to **`{ kind: 'message', messageId }`** (unless attachment sub-focus).

---

## 3. REFINEMENT ROUTING (PUBLIC VS ENCRYPTED)

### 3.1 Current store (already has routing)

**`useDraftRefineStore`** exposes **`refineTarget: DraftRefineTarget`** with **`'capsule-public' | 'capsule-encrypted'`** (`useDraftRefineStore.ts` **9**, **17**).

On **`connect(...)`**, the panel passes a field-specific **`onResponse`** callback:

- Public: **`(refined) => setCapsulePublicText(refined)`**
- Encrypted: **`(refined) => setCapsuleEncryptedText(refined)`**

**`acceptRefinement()`** invokes the stored **`onResponse`** with **`refinedDraftText`** (**72–77**).

### 3.2 Design answer

- **No new `targetField`** is *strictly* required if **`refineTarget`** remains the single source of truth and **`connect()`** is always called with the correct callback for the active field.
- **Optional alias:** A **`targetField: 'public' | 'encrypted'`** would duplicate **`refineTarget`**; prefer **one** discriminant (**keep `refineTarget`**).

- **Routing when AI returns:** HybridSearch calls **`deliverResponse(text)`** then user **Accept** / **USE ↓** → **`acceptRefinement()`** → **`onResponse`**. The callback closure already targets the correct setter — **routing is “whatever was active at `connect` time.”**

- **Critical:** **`connect`** must be invoked when the user **selects** a field (state-based), not only on **focus**, so **`refineTarget`** and **`onResponse`** stay aligned with **pBEAP vs qBEAP** even after focus moves to chat.

- **If refinement is submitted while connected:** use **current** **`getState().refineTarget`** and synced **`draftText`** (already updated by **`updateDraftText`** in **`EmailInboxView`** **442–461**) — no extra “which field” parameter on submit beyond the store.

---

## 4. ACCEPT / REJECT

### 4.1 Accept

- **Single pending refinement** in **`refinedDraftText`** (global store) — matches **one** active refine session.
- **Accept applies to the field that was connected** when the LLM ran — i.e. the field tied to current **`refineTarget`** and **`onResponse`**.

**Where to render Accept**

| Location | Role |
|----------|------|
| **In-panel preview** (existing pattern) | **“✓ Accept”** next to **“Suggested refinement”** under the **active** capsule block — **`EmailInboxView`** pattern **1139–1154** / **1319–1334**. |
| **HybridSearch history** | **“USE ↓”** on assistant rows (**HybridSearch** ~1022–1030) — already calls **`draftRefineAcceptRefinement`**. |

**Recommendation:** Keep **both**; they invoke the same **`acceptRefinement()`**. **No separate accept icon per field simultaneously** — only one preview active.

### 4.2 Reject

- **Implicit:** User can edit the textarea, submit another refinement, or **disconnect**.
- **Explicit (recommended):** Add **“Discard”** / **“Reject”** next to Accept that clears **`refinedDraftText`** without calling **`onResponse`** (new **`rejectRefinement()`** or **`clearRefinedDraft()`** on store).

---

## 5. DESELECTION RULES

| Event | Behavior |
|-------|----------|
| **Click pBEAP** | Select public; **deselect** encrypted; **`connect(..., 'capsule-public', onResponse→setPublic)`** (or update selection + sync store). |
| **Click qBEAP** | Select encrypted; **deselect** public; **`connect(..., 'capsule-encrypted', onResponse→setEnc)`**. |
| **Click pBEAP again** (already selected) | **Toggle off:** **`disconnect()`**, **`capsuleSelection = 'none'`** (mirror current toggle in **394–409** / **412–427** but **without** relying on blur). |
| **Click into chat bar** | **No deselection** — **do not** run **`draftRefineDisconnect`** on mousedown outside **`draftRef`** when target is inside **HybridSearch** root (exclude chat bar from “outside” hit-test). **No** **`setEditingDraftForMessageId(null)`** solely because chat focused. |
| **Click outside both fields AND outside chat bar** | **`disconnect()`**, **`capsuleSelection = 'none'`** (optional: keep message selected). |
| **Escape** | **`disconnect()`**, clear capsule selection for refine, **optional** blur chat input (local UX). |

**Implementation note:** Replace or narrow **`document.addEventListener('mousedown', handleClickOutside)`** (**430–440**) so **`containerRef` / hs-root** for HybridSearch is **not** treated as outside the draft “session.”

---

## 6. VISUAL DESIGN (ALIGN WITH EMAIL DRAFT PATTERN)

Reference: **`.ai-draft-connected`** on draft row (**`EmailInboxView`** **1010–1012**), **`App.css`** **1030–1034** (purple border on textarea); capsule **`.capsule-draft-field--selected`**, **`.capsule-draft-textarea--refine-connected`** (**6222–6260**).

### 6.1 When a capsule field is **selected** (state-based, connected to chat)

| Element | Spec |
|---------|------|
| **Field container** | **`capsule-draft-field--selected`** — **2px solid `#7c3aed`**, **8px radius**, **padding 8px**, **background `#faf5ff`** (existing **6222–6227**). |
| **Textarea** | **`capsule-draft-textarea--refine-connected`** — **2px purple border**, **box-shadow** (**6257–6260**). |
| **👉** | In **section header** next to **“Capsule reply”** when **any** capsule field is selected — point toward **public** or **encrypted** per **`refineTarget`** (existing **1018–1037** pattern). |
| **“Connected to chat ↑”** | Below **label** of **selected** field only (**1061–1066**, **1107–1112** pattern). |
| **Other field (not selected)** | **No** `--selected` on wrapper; **default** **`.capsule-draft-textarea`** border (**6241–6250**); **no** “Connected to chat” hint; optional muted opacity **0.92** if you want stronger contrast. |

### 6.2 Email draft parity

- **Single-field email** uses **wrapper** class **`ai-draft-connected`** for purple border — capsule uses **per-field** **`capsule-draft-field--selected`** + **`capsule-draft-textarea--refine-connected`** — **keep both** for visual consistency with product language (capsule = two independent regions).

### 6.3 Chat bar row

- **Leading icon:** **✏️** when **`uiFocusContext`** is draft-capsule-public / draft-capsule-encrypted (see §2); color **green** band consistent with draft chip (**675–681** style).

---

## 7. STATE VARIABLES (AUTHORITATIVE LIST)

| Name | Owner | Type / values | Purpose |
|------|--------|----------------|--------|
| **`capsuleSelection`** | `InboxDetailAiPanel` local state (or small Zustand slice) | **`'none' \| 'public' \| 'encrypted'`** | UI selection independent of focus. |
| **`useDraftRefineStore.connected`** | Existing | `boolean` | Chat refine session active. |
| **`useDraftRefineStore.messageId`** | Existing | `string \| null` | Must match selected message. |
| **`useDraftRefineStore.refineTarget`** | Existing | **`'capsule-public' \| 'capsule-encrypted' \| 'email'`** | Routes **Accept** and prompts. |
| **`useDraftRefineStore.draftText`** | Existing | `string` | Synced from active field via **`updateDraftText`**. |
| **`useDraftRefineStore.refinedDraftText`** | Existing | `string \| null` | Pending suggestion. |
| **`capsulePublicText` / `capsuleEncryptedText`** | Existing | `string` | Field bodies. |
| **`uiFocusContext`** (extended) | `HybridSearch` | see §2 | Chat bar labels. |

**Remove or demote:** **`onBlur` → `setEditingDraftForMessageId(null)`** for driving **selection** (keep only if needed for unrelated features).

---

## 8. EVENT HANDLERS (SUMMARY)

| Handler | Behavior |
|---------|----------|
| **`onCapsulePublicSelect`** | **mousedown** or **click** on pBEAP container (not textarea focus-only): set **`capsuleSelection='public'`**, **`connect(..., 'capsule-public', setCapsulePublicText)`**, **`updateDraftText(capsulePublicText)`**. Toggle off if already selected. |
| **`onCapsuleEncryptedSelect`** | Same for encrypted. |
| **`onDraftTextChange`** | **`setCapsulePublicText` / `setCapsuleEncryptedText`** + if connected for that field, **`updateDraftText`**. |
| **Chat mousedown** | **stopPropagation** or **whitelist** HybridSearch DOM from global outside-click disconnect. |
| **Escape** | **`disconnect()`** + **`capsuleSelection = 'none'`**. |

---

## 9. CSS CLASSES (CHECKLIST)

| Class | File | Use |
|-------|------|-----|
| **`capsule-draft-field--selected`** | `App.css` ~6222 | Selected field wrapper. |
| **`capsule-draft-textarea--refine-connected`** | ~6257 | Selected field textarea. |
| **`ai-draft-connected`** | ~1030 | Optional parent row when any capsule connected (already **1010–1012**). |
| **`bulk-action-card-draft-subfocus-indicator`** | existing | 👉 in header. |
| **`ai-draft-connect-hint`** | existing | “Connected to chat ↑”. |
| **`inbox-detail-ai-refined-preview`** | existing | Suggested refinement + Accept. |

---

## 10. ACCEPTANCE CRITERIA (PRODUCT)

1. Select pBEAP → chat bar shows **draft public** context; focus chat → **selection unchanged**; refinement applies to **public** text on Accept.
2. Switch to qBEAP → public deselected, encrypted selected; bar label updates; **`draftText`** syncs from encrypted field.
3. Click chat → **no** disconnect from mousedown-outside; **no** flip to **“Message”** if refine still active for a capsule field.
4. Click outside app content (or defined dismiss region) → disconnect + clear selection.
5. Escape → disconnect + clear capsule refine selection.

---

*Section 3 — Design specification. Implementation is out of scope for this document; Sections 1–2 describe current code behavior.*
