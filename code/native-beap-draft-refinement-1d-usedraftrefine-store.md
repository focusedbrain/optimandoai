# 1D — `useDraftRefineStore` (Inventory & Wiring)

**Search scope:** Entire `code` workspace (including `apps/electron-vite-project`).

| Search term | Result |
|-------------|--------|
| **`useDraftRefineStore`** | **Found** — primary export in `useDraftRefineStore.ts`; consumed in `EmailInboxView.tsx`, `HybridSearch.tsx`, `EmailInboxBulkView.tsx`. |
| **`draftRefineStore`** | **Not found** as a symbol (no separate variable with that name). |
| **`DraftRefineStore`** | **Not found**. The internal interface is **`DraftRefineState`** (`useDraftRefineStore.ts` **11–34**). |
| **`refineDraft`** | **Not found** as an identifier in TS/TSX (only in prose/docs). |
| **`draftRefinement`** | **Not found** as an identifier. |

---

## 1. Canonical file path

| File | Role |
|------|------|
| **`apps/electron-vite-project/src/stores/useDraftRefineStore.ts`** | Single source of truth: Zustand store **`useDraftRefineStore`**. |

---

## 2. State variables (data + refs)

All live on **`DraftRefineState`** (**11–20**). Initial values (**37–43**).

| Field | Type | Purpose |
|-------|------|---------|
| **`connected`** | `boolean` | Whether a draft-refine session is active. |
| **`messageId`** | `string \| null` | Inbox message id for this session. |
| **`messageSubject`** | `string \| null` | Shown in HybridSearch scope chip when in draft sub-focus path (subject line). |
| **`draftText`** | `string` | Current draft body copied from the panel; kept in sync via **`updateDraftText`**. |
| **`refineTarget`** | **`DraftRefineTarget`** | `'email' \| 'capsule-public' \| 'capsule-encrypted'` — which field is wired. |
| **`refinedDraftText`** | `string \| null` | LLM output pending user accept (not auto-applied to textarea). |
| **`onResponse`** | **`(text: string) => void) \| null`** | Callback registered by the panel to apply text on **accept** (closes over `setDraft` / capsule setters). |

---

## 3. Actions / methods exposed

Implemented on the same object (**36–78**).

| Method | Behavior |
|--------|----------|
| **`connect(messageId, messageSubject, draftText, onResponse, refineTarget?)`** | Sets **`connected: true`**, stores ids/subject/draft snapshot, **`refineTarget`** (default **`'email'`**), **`onResponse`**, clears **`refinedDraftText`**. |
| **`updateDraftText(draftText)`** | **`set({ draftText })`** — sync while user edits connected field. |
| **`disconnect()`** | Resets all state to defaults ( **`connected: false`**, nulls, empty strings). |
| **`deliverResponse(text)`** | **`set({ refinedDraftText: text })`** — called from HybridSearch when chat returns refined text. |
| **`acceptRefinement()`** | If **`refinedDraftText`** and **`onResponse`**, invokes **`onResponse(refinedDraftText)`**, then **`set({ refinedDraftText: null })`**. |

**Exported type:** **`DraftRefineTarget`** (**9**).

---

## 4. Connection to `InboxDetailAiPanel` (`EmailInboxView.tsx`)

`InboxDetailAiPanel` is a local function in **`EmailInboxView.tsx`**.

| Mechanism | Detail |
|-----------|--------|
| **Import** | **19** — `import { useDraftRefineStore } from '../stores/useDraftRefineStore'` |
| **Selectors / bindings** | **168–176** — `connect`, `disconnect`, `connected`, `messageId`, `refineTarget`, `refinedDraftText`, `acceptRefinement`. |
| **Email draft** | **`handleDraftRefineConnect`** **377–392** — `draftRefineConnect(messageId, subject, text, (refined) => { setDraft(refined); setEditedDraft(refined) }, 'email')`. |
| **Capsule public / encrypted** | **`handleCapsulePublicRefineConnect`** **394–410**, **`handleCapsuleEncryptedRefineConnect`** **412–428** — targets **`'capsule-public'`** / **`'capsule-encrypted'`**; toggles disconnect if same field already connected. |
| **Sync `draftText`** | **`useEffect`** **442–461** — while connected for this **`messageId`**, calls **`updateDraftText`** with capsule or email draft string. |
| **Disconnect on message change** | **`useEffect` [messageId]** **356** — `draftRefineDisconnect()`. |
| **Click-outside** | **`useEffect`** **430–440** — `mousedown` outside **`draftRef`** → **`draftRefineDisconnect()`**. |
| **Imperative reads** | **`useDraftRefineStore.getState()`** **395–396**, **413–414**, **444–450** — toggle checks and **`updateDraftText`**. |
| **UI** | **`refinedDraftText`** drives preview; **`acceptRefinement`** on **✓ Accept** buttons (e.g. **1143–1150**, **1319–1330**). |

No separate **`DraftRefineStore`** class — only this hook + **`getState()`**.

---

## 5. Connection to `HybridSearch` (chat bar)

| Mechanism | Detail |
|-----------|--------|
| **Import** | **4** |
| **Subscriptions** | **340–342**, **356–360** — `connected`, `messageId`, `messageSubject`, `draftText`, `refineTarget`, `deliverResponse`, `acceptRefinement`, `disconnect`. |
| **Mode** | **`useEffect`** **362–364** — `if (draftRefineConnected) setMode('chat')`. |
| **Submit path** | **`handleSubmit`** **488–529** — `isDraftRefine = draftRefineConnected && draftRefineMessageId === selectedMessageId`; builds **`chatQuery`** from **`useDraftRefineStore.getState().draftText`** (and hook snapshot); calls **`chatWithContextRag`**. |
| **After LLM** | **604–615** — **`draftRefineDeliverResponse(refined)`**; history row with **`onUse: () => draftRefineAcceptRefinement()`**. |
| **Clear selection** | **`handleClearMessageSelection`** **380–383** — **`draftRefineDisconnect()`** then parent callback. |
| **DOM** | **`data-draft-refine`** **741–744** when connected + message id matches. |

---

## 6. Subscribe / notify pattern

**Pattern:** **Zustand** (`create` from **`zustand`** **7**, **36**).

- **Subscribe:** React components call **`useDraftRefineStore(selector)`**. When **`set()`** updates any accessed slice, the component **re-renders**.
- **Notify:** There is **no** separate `subscribe()` / `emit()` / `EventEmitter`. Updates are **synchronous** via **`set`** in **`connect`**, **`updateDraftText`**, **`disconnect`**, **`deliverResponse`**, **`acceptRefinement`**.
- **Cross-component:** **`HybridSearch`** and **`InboxDetailAiPanel`** share one global store instance; both stay consistent by **re-rendering on store changes**.
- **Imperative access:** **`useDraftRefineStore.getState()`** for one-off reads inside callbacks (**489** HybridSearch, **395** EmailInboxView) without subscribing.

**Not used here:** Context API, props drilling for refine state, or RxJS.

---

## 7. Other consumer: `EmailInboxBulkView.tsx`

Bulk inbox uses the **same** store (**39**, **789–794**, **1635**):

- **`draftRefineConnect` / `disconnect` / `updateDraftText`** for card-level draft refinement.
- **844** — disconnect when message id matches on some lifecycle.
- **850** — **`updateDraftText(output.draftReply)`** when connected.

So **`useDraftRefineStore`** is **shared** between **normal detail** and **bulk** views; only one refine session globally.

---

## 8. If the store did not exist (hypothetical)

**Actual:** The draft → chat → refinement → accept flow **does** use **`useDraftRefineStore`**.

**If it were absent**, you would need another **global** channel (React context, app-level state, or IPC) to pass **`draftText`**, **`messageId`**, **`onResponse`**, and pending **`refinedDraftText`** between the draft panel and **`HybridSearch`**. **No such alternate mechanism** is present in this codebase for this flow.

---

## 9. Quick reference — file line map

| File | Lines (approx.) |
|------|-----------------|
| Store definition | `useDraftRefineStore.ts` **1–80** |
| `InboxDetailAiPanel` wiring | `EmailInboxView.tsx` **19**, **168–176**, **356**, **377–461**, **430–440**, preview/accept in draft sections |
| Chat bar wiring | `HybridSearch.tsx` **4**, **340–360**, **362–378**, **380–383**, **452–615**, **670–744**, **831–836**, **1000–1030** |
| Bulk inbox | `EmailInboxBulkView.tsx` **39**, **789–794**, **844**, **850**, **1635** |

---

*Section 1D — `useDraftRefineStore` inventory. Related: sections 1B (chat connection mechanics) and 1C (Message vs Draft badge vs this store).*
