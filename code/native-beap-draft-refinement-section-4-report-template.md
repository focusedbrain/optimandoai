# Native BEAP Draft Refinement — Analysis Report (Filled Template)

**SECTION 4 — Report template with findings from Sections 1–3.**  
Paths are relative to the repo’s `code/` root (e.g. `apps/electron-vite-project/...`).

---

## 1. Draft Generation Pipeline

| Item | Finding |
|------|---------|
| **Auto-draft trigger** | **`useEffect`** on **`[messageId, …]`** calls **`runAnalysisStream()`** — `EmailInboxView.tsx` **336–361**. Streaming analysis uses **`aiAnalyzeMessageStream`** (not `inbox:aiAnalyzeMessage`). **Fallback** auto-draft: **`useEffect`** **597–617** (non–Native-BEAP, `needsReply` + empty draft) and **619–639** (Native BEAP, empty capsule fields + `needsReply`) — both invoke **`handleDraftReply()`** once via **`draftFallbackAttemptedRef`**. **Manual:** toolbar **“✎ Draft”** toggle **811–820** (non-Native-BEAP opens draft section + may call **`handleDraftReply`**); **“AI capsule draft”** button **1228–1235** calls **`handleDraftReply`**. |
| **IPC call** | **`inbox:aiDraftReply`** — `electron/main/email/ipc.ts` **3303+**; renderer **`window.emailInbox.aiDraftReply(messageId)`** — `EmailInboxView.tsx` **569**; preload `electron/preload.ts` **823**. |
| **Result shape (Native BEAP)** | `{ ok: true, data: { draft: string, capsuleDraft: { publicText, encryptedText }, isNativeBeap: true } }` — `ipc.ts` **3398–3405**. Plain email: `{ ok: true, data: { draft } }` — **3434**. |
| **State populated** | **`setCapsulePublicText` / `setCapsuleEncryptedText`** — `EmailInboxView.tsx` **572–574** when **`res.ok && data?.isNativeBeap && data.capsuleDraft`**. **`setDraft` / `setEditedDraft`** — **582–585** for plain draft path. |
| **Draft textarea bound to** | Capsule: **`capsulePublicText`** / **`capsuleEncryptedText`** — **1077–1078**, **1123–1124**. Depackaged single-field: **`editedDraft || draft`** — **1294**. |

---

## 2. Chat Bar Connection

| Item | Finding |
|------|---------|
| **Textarea event (depackaged email draft)** | **`onClick={handleDraftRefineConnect}`** — **1296**; **`onFocus`** (sets **`draftSubFocused`**, **`setEditingDraftForMessageId`**, **`handleDraftRefineConnect`**) — **1297–1300**; **`onBlur`** — **1302–1305**. **Capsule:** **`onClick`** **`handleCapsulePublicRefineConnect` / `handleCapsuleEncryptedRefineConnect`** — **1079**, **1125**; **`onFocus`** — **1080–1083**, **1126–1129**; **`onBlur`** — **1084–1086**, **1130–1132**. |
| **Connection state** | **`useDraftRefineStore`** → **`connected`** (selector **`draftRefineConnected`**) — `useDraftRefineStore.ts` **12**, **37**; `EmailInboxView.tsx` **170**. |
| **Set true by** | **`connect(...)`** — `useDraftRefineStore.ts` **44–53**. Called from **`handleDraftRefineConnect`** **377–392** (email), **`handleCapsulePublicRefineConnect`** **401–408**, **`handleCapsuleEncryptedRefineConnect`** **419–426**. |
| **Set false by** ← **BUG POINT** | **`disconnect()`** — `useDraftRefineStore.ts` **58–67**. Triggers: **`draftRefineDisconnect()`** on message change **`356`**; **`mousedown`** outside **`draftRef`** **`430–440`** (chat bar is outside **`draftRef`** → **disconnect**); **`handleClearMessageSelection`** in **`HybridSearch.tsx`** **380–383**; capsule toggle second click **`394–398`**, **`413–417`**. **Blur does not call `disconnect`** but clears **`setEditingDraftForMessageId(null)`** — **1084–1086**, **1130–1132**, **1302–1305** (scope badge / ✏️ behavior). |
| **Pushes to chat via** | **`connect(messageId, subject, draftText, onResponse, refineTarget)`** stores **`draftText`** + callback — **`useDraftRefineStore.ts` **44–53**. **`updateDraftText`** sync — **`EmailInboxView.tsx` **442–461**. |
| **Chat bar receives via** | **`useDraftRefineStore`** selectors — **`HybridSearch.tsx` **340–342**, **356–360** (`connected`, `messageId`, `messageSubject`, `draftText`, `refineTarget`, `deliverResponse`, `acceptRefinement`, `disconnect`). **`setMode('chat')`** when connected — **362–364**. |

---

## 3. Refinement Flow

| Item | Finding |
|------|---------|
| **User types instruction → submitted by** | **`handleSubmit`** — `HybridSearch.tsx` **452–635**; **Enter** in input **`handleKeyDown`** **639–642** → **`handleSubmit`**. |
| **LLM called via** | **`window.handshakeView.chatWithContextRag({ query: chatQuery, … })`** — **`HybridSearch.tsx` **558–570** (draft-refine builds **`chatQuery`** in **495–529**). |
| **Refined text returned via** | **`draftRefineDeliverResponse(refined)`** — **604–606** → sets **`refinedDraftText`** in **`useDraftRefineStore`** (**69–71**). |
| **Accept triggered by** | **✓ Accept** — `EmailInboxView.tsx` **1143–1150** (capsule), **1323–1329** (email draft); **USE ↓** — `HybridSearch.tsx` **1022–1030** → **`draftRefineAcceptRefinement`**. |
| **Draft updated by** | **`acceptRefinement()`** — `useDraftRefineStore.ts` **72–77** → calls **`onResponse(refinedDraftText)`** registered in **`connect`** (e.g. **`setCapsulePublicText` / `setCapsuleEncryptedText` / `setDraft`+`setEditedDraft`**). |

---

## 4. Context Badge

| Item | Finding |
|------|---------|
| **Controlled by** | Derived **`uiFocusContext`** — `HybridSearch.tsx` **`useMemo` **346–355** (`UiFocusContext` type **8–12**). **Does not** read **`useDraftRefineStore.connected`**. |
| **"Message" context set by** | Default branch **`return { kind: 'message', messageId: msgId }`** — **354** when not draft/attachment sub-focus for **`beap-inbox`**. |
| **"Draft" context (✏️ Draft chip) set by** | **`inboxSubFocus.kind === 'draft'`** && same **`messageId`** — **350** → **`{ kind: 'draft', messageId }`**. **`subFocus`** set by **`setEditingDraftForMessageId`** — `useEmailInboxStore.ts` **626–641** (typically textarea **focus**). |
| **Needs change for capsule** | **Yes.** Extend **`uiFocusContext`** (or badge logic) to use **`draftRefineConnected`**, **`draftRefineMessageId`**, **`selectedMessageId`**, and **`refineTarget`** so **“Draft: Public / Encrypted”** can show while refining **without** textarea focus. See **`native-beap-draft-refinement-section-3-design-spec.md` §2**. |

---

## 5. "AI capsule draft" Button

| Item | Finding |
|------|---------|
| **Handler** | **`handleDraftReply`** — `EmailInboxView.tsx` **562–595**; button **`onClick={() => void handleDraftReply()}`** — **1231**. |
| **IPC call** | **`inbox:aiDraftReply`** (via **`aiDraftReply`**) — **not** missing. Early exit if no bridge: **`563`** (`return` with no UI). |
| **Result processing** | **`const native = data?.isNativeBeap && data.capsuleDraft`** — **571**; if **`res.ok && native`** → **572–581**; else **`res.ok && data?.draft`** → **582–585**; else **587** / catch **590**. |
| **Fields populated** | **Yes** when **`res.ok && data?.isNativeBeap && data.capsuleDraft`** → **`setCapsulePublicText`**, **`setCapsuleEncryptedText`**. **Gap:** plain **`data.draft`** path updates **`draft`/`editedDraft`** only — **capsule UI stays empty** if main returns non-native shape (e.g. **`email_plain`** row misclassified, Ollama-off early return **without** `isNativeBeap`). See **`native-beap-draft-refinement-section-2-ai-capsule-draft-button.md` §4**. |

---

## 6. Selection Mechanism

| Item | Finding |
|------|---------|
| **Current** | **Mixed:** (1) **Zustand** **`connected`** via **`connect`/`disconnect`**; (2) **focus/blur** drives **`draftSubFocused`** and **`useEmailInboxStore.subFocus`** (**`setEditingDraftForMessageId`**); (3) **document `mousedown`** outside **`draftRef`** calls **`disconnect`**. |
| **Bug cause** | **Clicking the chat bar:** (a) **`mousedown`** target is **outside** **`draftRef`** → **`draftRefineDisconnect()`** (**430–440**); (b) textarea **blur** → **`setEditingDraftForMessageId(null)`** → scope chip shows **“Message”** (**1302–1305**, **1084–1086**, **1130–1132**). |
| **Recommended fix** | **State-based capsule selection** (**`capsuleSelection: 'none' \| 'public' \| 'encrypted'`**), **exclude HybridSearch DOM from outside-click disconnect**, **decouple badge from blur** — **`native-beap-draft-refinement-section-3-design-spec.md` §1, §5, §7–8**. |

---

## 7. Recommended Design for Capsule Fields

*(Summary of Section 3; full detail in `native-beap-draft-refinement-section-3-design-spec.md`.)*

| Topic | Recommendation |
|-------|----------------|
| **Selection** | **State-based toggle** — no blur as source of truth; **`connect`** on explicit field selection; chat focus does not deselect. |
| **Context badge** | Extend **`uiFocusContext`** with **draft capsule public / encrypted** using **`useDraftRefineStore`** + **`refineTarget`**; labels **“Draft: Public”** / **“Draft: Encrypted”** vs **“Message”** when disconnected. |
| **Routing** | Keep **`refineTarget`** **`'capsule-public' \| 'capsule-encrypted'`**; **`onResponse`** in **`connect`** routes **Accept** to the correct setter. |
| **Accept / Reject** | Single pending **`refinedDraftText`**; **✓ Accept** + **USE ↓**; optional **Discard** clears preview. |
| **Deselection** | Mutual exclusive pBEAP/qBEAP; click same field toggles off; **chat bar clicks do not disconnect**; outside (non-chat) + **Escape** disconnect. |
| **Visuals** | **`capsule-draft-field--selected`**, **`capsule-draft-textarea--refine-connected`**, header **👉**, **“Connected to chat ↑”** on active field only (`App.css` ~6222–6260). |

**State variables (target):** **`capsuleSelection`**, existing **`useDraftRefineStore`** fields, extended **`uiFocusContext`**.

**Handlers (target):** Field **`onClick`**/selection handlers; **narrowed `mousedown` outside**; **`HybridSearch`** **`handleClearMessageSelection`** remains full clear.

**CSS:** Reuse classes in §6 of Section 3 design spec.

---

## Related documents

| Doc | Content |
|-----|---------|
| `native-beap-draft-refinement-architecture-analysis.md` | Section 1 pipeline (stream + IPC) |
| `native-beap-draft-refinement-1b-chat-bar-connection.md` | Connection / disconnect mechanics |
| `native-beap-draft-refinement-1c-message-vs-draft-context.md` | Badge vs refine store |
| `native-beap-draft-refinement-1d-usedraftrefine-store.md` | Zustand inventory |
| `native-beap-draft-refinement-section-2-ai-capsule-draft-button.md` | AI capsule draft button |
| `native-beap-draft-refinement-section-3-design-spec.md` | Full design Q&A |

---

*SECTION 4 — Filled report template. Last updated to match analysis trace.*
