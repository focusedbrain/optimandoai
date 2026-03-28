# 1B — How the Draft Field Connects to the Chat Bar (Exact Trace)

**Scope:** Depackaged-email single-field draft path and shared infrastructure (Zustand `useDraftRefineStore`, `HybridSearch` top bar). Line numbers refer to the repository at authoring time.

**Primary files**

| File | Role |
|------|------|
| `apps/electron-vite-project/src/components/EmailInboxView.tsx` | `InboxDetailAiPanel`: draft textarea, `connect` / `disconnect`, click-outside |
| `apps/electron-vite-project/src/stores/useDraftRefineStore.ts` | Global “draft refine” session |
| `apps/electron-vite-project/src/components/HybridSearch.tsx` | Top chat bar: mode, submit, prompt, LLM bridge, history |
| `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` | `subFocus` / `editingDraftForMessageId` for “✏️ Draft” scope badge |
| `apps/electron-vite-project/src/App.css` | `.ai-draft-connected`, `.capsule-draft-field--selected`, etc. |

---

## 1. Event handlers on the depackaged-email draft `<textarea>`

**Location:** `EmailInboxView.tsx`, non-`isNativeBeap` branch (depackaged / normal email reply draft).

| Handler | Bound? | Line(s) | Function |
|---------|--------|-----------|----------|
| **`onClick`** | Yes | 1296 | `handleDraftRefineConnect` |
| **`onFocus`** | Yes | 1297–1300 | Inline: `setDraftSubFocused(true)` → `setEditingDraftForMessageId(messageId)` → `handleDraftRefineConnect()` |
| **`onBlur`** | Yes | 1302–1305 | Inline: `setDraftSubFocused(false)` → `setEditingDraftForMessageId(null)` |
| **`onMouseDown`** | **No** | — | *(not used on this textarea)* |

**`handleDraftRefineConnect` definition:** lines **377–392** (`useCallback`). It early-returns if `(editedDraft || draft)` is empty after trim (**379–380**). Otherwise calls `draftRefineConnect(messageId, subject, text, onResponse, 'email')` from the store.

**Does connection fire on focus?** **Yes.** Focus runs the same **`handleDraftRefineConnect`** as click (**1297–1300**). So any focus transition into the textarea attempts to connect (if there is non-empty draft text).

**Does it fire on explicit click only?** **No** — **both** `onClick` and `onFocus` invoke **`handleDraftRefineConnect`** (duplicate invocation on a typical click: focus first, then click — both paths run).

---

## 2. State: what tracks “draft is connected to chat”?

### 2.1 Primary: Zustand `useDraftRefineStore` (actual connection)

**File:** `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`

| Field | Type (conceptual) | Meaning |
|-------|-------------------|---------|
| **`connected`** | `boolean` | **This is the connection flag** — `true` after `connect()`, `false` after `disconnect()` |
| **`messageId`** | `string \| null` | Which inbox message is wired |
| **`messageSubject`** | `string \| null` | Shown in HybridSearch chip |
| **`draftText`** | `string` | Snapshot synced from the textarea; updated via **`updateDraftText`** |
| **`refineTarget`** | `'email' \| 'capsule-public' \| 'capsule-encrypted'` | Which field for Native BEAP |
| **`refinedDraftText`** | `string \| null` | LLM result before accept |
| **`onResponse`** | callback \| null | Applied on **accept** |

**Declared:** interface **`DraftRefineState`** lines **11–34**, implementation lines **36–78**.

**Set `connected === true`:** **`connect(...)`** lines **44–53** — `set({ connected: true, messageId, messageSubject, draftText, refineTarget, onResponse, refinedDraftText: null })`.

**Set `connected === false`:** **`disconnect()`** lines **58–67** — clears all fields including `connected: false`.

**In `InboxDetailAiPanel`, subscribed as:**  
`draftRefineConnected` (**170**), `draftRefineMessageId` (**171**), `draftRefineTarget` (**172**) — lines **168–172**.

### 2.2 Secondary: local `draftSubFocused` (NOT the connection flag)

**Declared:** `const [draftSubFocused, setDraftSubFocused] = useState(false)` — line **149**.

**Type:** `boolean`.

**Set `true`:** textarea **`onFocus`** — line **1298**.

**Set `false`:** textarea **`onBlur`** — line **1303**.

**Purpose:** Drives the **✏️** indicator in the draft header (**1266–1273**) — `draft && draftSubFocused`. It does **not** control `useDraftRefineStore.connected`.

### 2.3 Inbox store: `editingDraftForMessageId` + `subFocus` (scope badge in chat bar)

**File:** `useEmailInboxStore.ts`

- **`editingDraftForMessageId`**: lines **206**, **584**, **626–641**.
- **`subFocus`**: **`SubFocus`** — when draft editing, **`{ kind: 'draft', messageId }`** (**636**).

**Set on draft textarea focus:** `useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)` — **1299** (and capsule fields **1081**, **1127**).

**Set on blur:** `setEditingDraftForMessageId(null)` — **1304** (capsule **1085**, **1131**).

**CRITICAL — blur clears draft sub-focus:** Yes. **`onBlur`** calls **`setEditingDraftForMessageId(null)`**, which sets **`subFocus: { kind: 'none' }`** when `id === null` (**628–631**). That makes **`HybridSearch`**’s **`uiFocusContext.kind`** no longer **`'draft'`** when focus moves to the chat input — so the **green “✏️ Draft”** chip (**675–694**) disappears and the bar shows the generic message scope (**717+**).

### 2.4 Naming note

There is **no** variable named `isDraftConnected` or `draftRefineMode`. The code uses **`draftRefineConnected`** (selector from **`connected`**) and **`draftSubFocused`** separately.

---

## 3. When connection becomes true: data flow and chat bar behavior

### 3.1 Draft text pushed to the chat system

**Not** a separate prop down to the input. **`connect`** stores **`draftText`** in Zustand (**49–50** in store).

**Live sync while connected:** `EmailInboxView.tsx` **`useEffect`** **442–461** — when `draftRefineConnected && draftRefineMessageId === messageId`, calls **`updateDraftText`** with `editedDraft || draft || ''` (email path) or capsule strings.

### 3.2 Chat bar mode: Search → Chat

**File:** `HybridSearch.tsx` **362–364**:

```ts
useEffect(() => {
  if (draftRefineConnected) setMode('chat')
}, [draftRefineConnected])
```

So when **`useDraftRefineStore.connected`** becomes true, **`mode`** is forced to **`'chat'`**.

### 3.3 Auto-focus chat input

**HybridSearch.tsx** **366–374** — when **`draftRefineConnected`** turns true, **`requestAnimationFrame(() => inputRef.current?.focus())`** runs (refs **337**, **827–845**).

### 3.4 Functions / store involved

| Piece | Location |
|-------|----------|
| **`connect`** | `useDraftRefineStore.connect` — called from **`handleDraftRefineConnect`** **382–390** |
| **`setMode('chat')`** | `HybridSearch.tsx` **363** |
| **No `setSearchMode` name** | Uses local **`mode`** state **`setMode`** |
| **`setFocusedContext`** | **Not used** — focus uses **`uiFocusContext`** derived from **`inboxSubFocus`** (**343–355**) |

---

## 4. Visual changes when connected

### 4.1 Purple border (depackaged email draft)

**Wrapper** gets class **`ai-draft-connected`** when `draftRefineConnected && draftRefineMessageId === messageId` — **1010–1012**.

**CSS:** `App.css` **1030–1034**:

```css
.ai-draft-connected .inbox-detail-ai-draft-textarea,
.ai-draft-connected textarea.inbox-detail-ai-draft-textarea {
  border: 2px solid var(--color-primary, #7c3aed) !important;
  border-radius: 6px;
}
```

**Not** `:focus`-only for that purple block — it is tied to **`.ai-draft-connected`** on the parent. The textarea still has normal focus styling from base rules elsewhere.

### 4.2 Header ✏️ vs 👉 (depackaged path)

**1266–1273:** Shows **✏️** only when **`draft && draftSubFocused`** — i.e. **textarea is focused**, not merely `connected`. When focus moves to chat, **`draftSubFocused`** is false → ✏️ **hides** even if **`connected`** is still true.

### 4.3 “Connected to chat ↑”

**1287–1290** — Rendered when **`draftRefineConnected && draftRefineMessageId === messageId`** (no `draftSubFocused` requirement).

### 4.4 Native BEAP capsule fields (reference)

- **👉** in header **1018–1037** — when **`refineTarget`** is **`capsule-public`** or **`capsule-encrypted`**.
- **`.capsule-draft-field--selected`** — **1045–1050**, **1091–1096** (`App.css` **6222–6227**).
- **`.capsule-draft-textarea--refine-connected`** — **1069–1074**, **1115–1120** (`App.css` **6257–6260**).

### 4.5 `:focus` on capsule textareas

**App.css** **6262–6266** — **`.capsule-draft-textarea:focus`** adds border/shadow. That is independent of refine-connected styling; overlapping purple can look like “still selected” on focus alone.

---

## 5. User submits refinement from the chat bar

### 5.1 Handler

**`handleSubmit`** — `HybridSearch.tsx` **452–635** ( **`useCallback`** ). Triggered by **Send** button **851** or **Enter** in input (**639–642**).

### 5.2 How draft context is chosen

Inside **`handleSubmit`**, chat branch (**474+**):

- **`isDraftRefine`** = **`draftRefineConnected && draftRefineMessageId === selectedMessageId`** — **488**.
- **`currentDraft`** = **`useDraftRefineStore.getState().draftText || draftRefineDraftText || ''`** — **489** (prefers latest store snapshot).

### 5.3 Prompt construction

**495–529** — If **`isDraftRefine`**, builds **`chatQuery`**:

- **Email (`refineTarget` not capsule):** wraps **`currentDraft`** and user **`trimmed`** instruction in a template (“Here is a draft email reply…” / “refine it with this instruction…”).
- **Capsule public/encrypted:** similar with **`capsuleKind`** labels (**497–516**).

Otherwise falls through to normal inbox context + user question (**531–556**).

### 5.4 LLM call

**558–570** — **`window.handshakeView?.chatWithContextRag?.({`**  
`query: chatQuery`, `scope: effectiveScope`, `model`, `provider`, **`stream: true`**, plus `selectedMessageId`, etc.

So the refinement uses the **same RAG chat IPC** as normal chat, with a **synthetic `chatQuery`** that embeds the draft + instruction.

---

## 6. When the AI returns: path back to the textarea + accept

### 6.1 Store: `deliverResponse` / `acceptRefinement`

**`deliverResponse`** — store **69–71** — sets **`refinedDraftText`**.

**`acceptRefinement`** — **72–78** — if **`refinedDraftText`** and **`onResponse`**, calls **`onResponse(refinedDraftText)`**, then clears **`refinedDraftText`**.

**`onResponse`** was registered in **`connect`** from **`EmailInboxView`**: for email, **`(refined) => { setDraft(refined); setEditedDraft(refined) }`** — **386–389**.

### 6.2 HybridSearch after successful answer

**604–615** — If **`isDraftRefine`** and **`answerText.trim()`**:

1. **`draftRefineDeliverResponse(refined)`** — pushes text to store.
2. Appends assistant row to **`draftRefineHistory`** with **`showUseButton: true`**, **`onUse: () => draftRefineAcceptRefinement()`** — **607–612**.
3. **`setResponse(null)`**, **`setQuery('')`** — **613–614**.

### 6.3 Accept UI (two places)

| UI | File | Lines |
|----|------|-------|
| **“✓ Accept”** in draft panel preview | `EmailInboxView.tsx` | **1319–1334** (`onClick={acceptRefinement}`) |
| **“USE ↓”** in chat panel history | `HybridSearch.tsx` | **1022–1030** (`onClick={msg.onUse}` → **`draftRefineAcceptRefinement`**) |

### 6.4 Reject

**No dedicated “Reject” control.** User can ignore the preview, or **`disconnect()`** clears **`refinedDraftText`** (store **58–67**). Closing the panel does not by itself reject.

---

## 7. Deselect / disconnect: mechanisms

### 7.1 Toggle on same capsule field (Native BEAP only)

**`handleCapsulePublicRefineConnect` / `handleCapsuleEncryptedRefineConnect`** — **394–427**: if already connected with same **`messageId`** and same **`refineTarget`**, **`draftRefineDisconnect()`** and **return** — **second click toggles off**.

### 7.2 Email draft: no toggle in `handleDraftRefineConnect`

**377–392** — Always connects if text non-empty; **does not** check “already connected” to toggle off on second click.

### 7.3 Click outside draft row → **disconnect**

**430–440** — **`document.addEventListener('mousedown', handleClickOutside)`** when connected. If **`!draftRef.current.contains(target)`**, **`draftRefineDisconnect()`**.

**CRITICAL:** The top **`HybridSearch`** bar lives **outside** **`draftRef`** (draft container ref **1009–1013**). A **mousedown** on the chat input or Send button is **outside** **`draftRef`** → **`disconnect()`** runs. This **clears `connected`** and ends refine mode regardless of blur.

### 7.4 Clear message / × on scope chip

**`handleClearMessageSelection`** — `HybridSearch.tsx` **380–383** — calls **`draftRefineDisconnect()`** then **`onClearMessageSelection?.()`**.

### 7.5 Blur on textarea

**`onBlur`** (**1302–1305**) does **not** call **`draftRefineDisconnect`**. It only clears **`draftSubFocused`** and **`setEditingDraftForMessageId(null)`**.

So:

- **Zustand connection** is dropped mainly by **mousedown-outside** (chat bar) or **explicit disconnect** APIs — **not** by blur alone.
- **UI “draft sub-focus”** (✏️ chip in HybridSearch + **`draftSubFocused`**) **is** blur-driven — focusing the chat bar removes the green **“✏️ Draft”** badge even if something else kept **`connected`** true (in practice mousedown-outside usually disconnects first).

### 7.6 Message switch

**`EmailInboxView.tsx` `useEffect` [messageId]** — **356**: **`draftRefineDisconnect()`** on message change.

---

## 8. Summary table (quick lookup)

| Question | Answer |
|----------|--------|
| **Connection flag** | **`useDraftRefineStore` → `connected`** (`draftRefineConnected` in panel) |
| **Blur disconnects refine store?** | **No** — blur only clears **`draftSubFocused`** + **`editingDraftForMessageId`** |
| **Chat click disconnects refine store?** | **Yes** — **mousedown** outside **`draftRef`** (**430–440**) |
| **Chat bar mode** | **`setMode('chat')`** when **`draftRefineConnected`** (**362–364**) |
| **LLM** | **`chatWithContextRag`** with constructed **`chatQuery`** (**560–570**) |
| **Apply refined text** | **`acceptRefinement`** → **`onResponse`** → **`setDraft` / `setEditedDraft`** |

---

*Section 1B — Draft ↔ chat bar wiring. For broader draft generation IPC, see `native-beap-draft-refinement-architecture-analysis.md`.*
