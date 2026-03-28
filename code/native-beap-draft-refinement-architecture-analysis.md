# Native BEAP Draft Refinement — Architecture Analysis

**Scope:** Analysis only (no code changes).  
**Primary source:** `apps/electron-vite-project/src/components/EmailInboxView.tsx` (`InboxDetailAiPanel`), `electron/main/email/ipc.ts`, `electron/preload.ts`, `apps/electron-vite-project/src/lib/inboxMessageKind.ts`.

**Terminology:**

- **Depackaged email (product/UI):** `message.source_type === 'email_plain'` — used for labels such as “Send via Email” and attachment affordances.
- **Message kind for AI routing:** `deriveInboxMessageKind(message)` returns `'handshake'` vs `'depackaged'` (`inboxMessageKind.ts`). Anything that is **not** Native BEAP handshake is treated as **non-handshake** for the draft pipeline (single-field email draft). Handshake messages use **capsule** fields (`capsulePublicText` / `capsuleEncryptedText`).

---

## 1. Depackaged email draft pipeline (`InboxDetailAiPanel`)

### 1.1 Does selecting a depackaged message auto-run AI analysis?

**Yes.** On `messageId` change, a `useEffect` resets local AI/draft state and calls `runAnalysisStream()`:

```336:361:apps/electron-vite-project/src/components/EmailInboxView.tsx
  useEffect(() => {
    if (!messageId) return
    manualSummaryOverrideRef.current = null
    setAnalysis(null)
    setReceivedFields(new Set())
    // ... resets draft, capsule fields, draftRefineDisconnect(), etc.
    draftFallbackAttemptedRef.current = false
    draftRefineDisconnect()
    runAnalysisStream()
    return () => {
      streamCleanupRef.current?.()
    }
  }, [messageId, runAnalysisStream, draftRefineDisconnect])
```

**Important:** The panel does **not** call `inbox:aiAnalyzeMessage` (non-streaming) from this component. It invokes **`window.emailInbox.aiAnalyzeMessageStream(messageId)`**, which maps to IPC **`inbox:aiAnalyzeMessageStream`**. The legacy handler `inbox:aiAnalyzeMessage` still exists in `ipc.ts` for other callers, but the detail panel’s automatic analysis is **streaming-only**.

### 1.2 Does analysis include `draftReply` for depackaged / non-handshake mail?

**Yes, when the stream parses successfully.** For non-handshake messages, `skipEmailDraft` is false, so `draftReply` from the partial/final JSON updates `draft` and `editedDraft`:

```181:184:apps/electron-vite-project/src/components/EmailInboxView.tsx
  const runAnalysisStream = useCallback(async () => {
    // ...
    const skipEmailDraft = !!(message && deriveInboxMessageKind(message) === 'handshake')
```

Streaming chunk path:

```257:265:apps/electron-vite-project/src/components/EmailInboxView.tsx
        if (
          !skipEmailDraft &&
          parsed.receivedKeys.includes('draftReply') &&
          parsed.partial.draftReply &&
          typeof parsed.partial.draftReply === 'string'
        ) {
          setDraft(parsed.partial.draftReply)
          setEditedDraft(parsed.partial.draftReply)
        }
```

Completion path (after triage reconciliation):

```296:305:apps/electron-vite-project/src/components/EmailInboxView.tsx
        if (!skipEmailDraft) {
          if (adjusted.draftReply && typeof adjusted.draftReply === 'string') {
            setDraft(adjusted.draftReply)
            setEditedDraft(adjusted.draftReply)
          } else {
            setDraft(null)
            setEditedDraft('')
          }
        }
```

**Cached analysis:** If `useEmailInboxStore.getState().analysisCache[messageId]` hits, `draftReply` is applied the same way (string → `setDraft` / `setEditedDraft`).

### 1.3 State variables for the depackaged (single-field) draft

| Concern | State |
|--------|--------|
| Raw + edited draft text | `draft: string \| null`, `editedDraft: string` — textarea is controlled as `value={editedDraft \|\| draft \|\| ''}` |
| Full analysis object (includes `draftReply` in type) | `analysis: NormalInboxAiResult \| null` — **`analysis.draftReply`** mirrors what came from the model but **editable text** is driven by `draft`/`editedDraft` |
| Loading / errors | `draftLoading`, `draftError` |
| Refine UI affordance (depackaged path) | `draftSubFocused` — toggled on textarea **focus/blur** (see §3) |

### 1.4 Automatic fallback: `aiDraftReply` when analysis says “needs reply” but no streamed draft

If the draft section is visible, analysis finished with `needsReply`, there is still no draft text, and no user edit yet, **`handleDraftReply()` is invoked once** via `draftFallbackAttemptedRef`:

```597:617:apps/electron-vite-project/src/components/EmailInboxView.tsx
  useEffect(() => {
    if (!messageId || !visibleSections.has('draft')) return
    if (isNativeBeap) return
    if (analysisLoading || !analysis?.needsReply) return
    if ((draft ?? '').trim() || draftLoading) return
    if (editedDraft.trim()) return
    if (draftFallbackAttemptedRef.current) return
    draftFallbackAttemptedRef.current = true
    void handleDraftReply()
  }, [
    messageId,
    visibleSections,
    isNativeBeap,
    analysisLoading,
    analysis?.needsReply,
    draft,
    draftLoading,
    editedDraft,
    handleDraftReply,
  ])
```

So depackaged users can get a draft from **either** the analysis stream **`draftReply`** **or** a follow-up **`inbox:aiDraftReply`** call.

---

## 2. “Draft” section toggle and manual “Draft” generation

### 2.1 Draft section checkbox (toolbar)

Toggling **“✎ Draft”** adds/removes `'draft'` in `visibleSections`. When the user **turns the draft section on** and there is no draft yet (non-Native-BEAP path), it calls **`handleDraftReply()`**:

```811:820:apps/electron-vite-project/src/components/EmailInboxView.tsx
        <button
          type="button"
          // ...
          onClick={() => {
            const willShow = !visibleSections.has('draft')
            toggleSection('draft')
            if (willShow && !draft && !draftLoading && !isNativeBeap) {
              void handleDraftReply()
            }
          }}
```

**Draft section default:** On message change, `visibleSections` is reset to `new Set(['summary', 'draft', 'analysis'])`, so the draft block is **shown by default** — not “collapsed until first open.”

### 2.2 IPC for manual draft: `inbox:aiDraftReply`

**Renderer:**

```562:595:apps/electron-vite-project/src/components/EmailInboxView.tsx
  const handleDraftReply = useCallback(async () => {
    if (!window.emailInbox?.aiDraftReply) return
    setDraftLoading(true)
    setDraft(null)
    setDraftError(false)
    setAttachments([])
    try {
      const res = await window.emailInbox.aiDraftReply(messageId)
      const data = res.data
      const native = data?.isNativeBeap && data.capsuleDraft
      if (res.ok && native) {
        setCapsulePublicText(data.capsuleDraft!.publicText)
        setCapsuleEncryptedText(data.capsuleDraft!.encryptedText)
        // ...
      } else if (res.ok && data?.draft) {
        setDraft(data.draft)
        setEditedDraft(data.draft)
        setDraftError(!!data.error)
      } else {
        setDraftError(true)
      }
    } catch {
      setDraftError(true)
    } finally {
      setDraftLoading(false)
    }
    draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messageId])
```

**Preload:** `aiDraftReply: (id: string) => ipcRenderer.invoke('inbox:aiDraftReply', id)`.

**Main process (depackaged / plain email branch):** Returns `{ ok: true, data: { draft } }` with plain string draft; persists `draftReply` into `ai_analysis_json` in SQLite (`ipc.ts` ~3408–3434).

**Shape for depackaged email:** Success path is **`res.ok && data?.draft`** → **`setDraft(data.draft)`**, **`setEditedDraft(data.draft)`**. Optional `data.error` flag sets `draftError`.

**Auto-expand:** `setVisibleSections` adds `'draft'` only in the **Native BEAP** branch of `handleDraftReply` when opening from empty; for plain email, the section is usually already visible from defaults. Scroll: **`draftRef.current?.scrollIntoView`**.

---

## 3. “Regenerate” vs “Draft” (first generation)

**Handler:**

```641:643:apps/electron-vite-project/src/components/EmailInboxView.tsx
  const handleRegenerateDraft = useCallback(() => {
    handleDraftReply()
  }, [handleDraftReply])
```

**UI (non-Native-BEAP draft toolbar):**

```1376:1378:apps/electron-vite-project/src/components/EmailInboxView.tsx
                        <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={handleRegenerateDraft}>
                          Regenerate
                        </button>
```

**Behavior:** **Regenerate is identical to calling `handleDraftReply()` again** — same IPC, same state updates. It **clears** `draft` at the start (`setDraft(null)`), shows loading, then sets the new `draft`/`editedDraft` from the response. There is no separate “regenerate” IPC or prompt variant in this component.

**Retry on failure:** `handleRetryDraft` clears `draftError` and also calls `handleDraftReply()`.

---

## 4. End-to-end chains (summary tables)

### 4.1 Select message → auto analysis + optional draft

1. User selects message → `messageId` changes.  
2. `useEffect` → `runAnalysisStream()`.  
3. `window.emailInbox.aiAnalyzeMessageStream(messageId)` → chunks → `tryParsePartialAnalysis` → **`setDraft` / `setEditedDraft`** when `draftReply` arrives (non-handshake).  
4. On done: final parse, triage, cache `setAnalysisCache`, **`setDraft` / `setEditedDraft`** from `adjusted.draftReply` if present.  
5. If draft section visible + `needsReply` + still empty draft + no user edit → **`handleDraftReply()`** once (`draftFallbackAttemptedRef`).

### 4.2 User opens draft section / Regenerate / fallback

**IPC:** `inbox:aiDraftReply`  
**Result (email):** `{ ok: true, data: { draft: string, error?: boolean } }`  
**State:** `setDraft(data.draft)`, `setEditedDraft(data.draft)`, `setDraftError(!!data.error)`  
**UI:** Textarea shows `editedDraft || draft`; loading via `draftLoading` and `readOnly={draftLoading}`.

---

## 5. Draft refinement (single field) — chat bar connection

**Connect:** `handleDraftRefineConnect` passes `messageId`, subject, current text `(editedDraft || draft)`, callback `(refined) => { setDraft(refined); setEditedDraft(refined) }`, target `'email'`.

**Depackaged draft textarea:**

- `onClick`: `handleDraftRefineConnect`  
- `onFocus`: `setDraftSubFocused(true)`, `setEditingDraftForMessageId(messageId)`, `handleDraftRefineConnect()`  
- `onBlur`: `setDraftSubFocused(false)`, `setEditingDraftForMessageId(null)`

**👉 indicator (depackaged):** Shown when **`draft && draftSubFocused`** — i.e. it tracks **textarea focus**, not the refine store alone.

**Click-outside disconnect:** Document `mousedown` listener disconnects refine if click is outside `draftRef.current` (draft row container).

---

## 6. Implications for Native BEAP capsule fields (pBEAP + qBEAP)

The **handshake / Native BEAP** path uses **`handleCapsulePublicRefineConnect`** / **`handleCapsuleEncryptedRefineConnect`** with refine targets `'capsule-public'` and `'capsule-encrypted'`.

**Reported bug (testing):** Selecting a capsule field then focusing the **top chat** causes **deselection** — consistent with **focus/blur on the textarea** driving connection or visual state, and/or **mousedown-outside** firing when interacting with the chat bar (if it is outside `draftRef`).

**Code facts:**

- Capsule textareas use **`onFocus` → `handleCapsule*RefineConnect()`** (and `setEditingDraftForMessageId`) and **`onBlur` → `setEditingDraftForMessageId(null)`** only — they do **not** set a `draftSubFocused`-style flag for the 👉 row; the 👉 in the header keys off **`draftRefineTarget === 'capsule-public' | 'capsule-encrypted'`**.  
- **`handleCapsulePublicRefineConnect` / `handleCapsuleEncryptedRefineConnect`** toggle disconnect if the same field is already connected (click again to deselect).  
- Global sync effect updates store draft text from `capsulePublicText` / `capsuleEncryptedText` while connected.

**Design direction (for a future implementation, not done here):** Match the product requirement **“stay selected until explicit deselect”** by **decoupling selection from focus/blur** — e.g. explicit selection state per field, and ensure the chat bar / top composer is **not** treated as “outside” the draft region for disconnect purposes (or only disconnect on explicit actions). The depackaged single-field path still ties the ✏️ indicator to **`draftSubFocused`**, which also **drops on blur** when moving focus to the chat — the same class of UX issue the product note describes for capsules.

---

## 7. File reference index

| Topic | Location |
|-------|----------|
| `InboxDetailAiPanel` | `EmailInboxView.tsx` (local function) |
| Stream analysis + `draftReply` | `runAnalysisStream`, `useEffect([messageId])` |
| `handleDraftReply` / Regenerate | same file |
| `inbox:aiDraftReply` handler | `electron/main/email/ipc.ts` |
| `deriveInboxMessageKind` | `src/lib/inboxMessageKind.ts` |
| Preload bridge | `electron/preload.ts` (`aiDraftReply`, `aiAnalyzeMessageStream`, chunk listeners) |

---

*Generated for Native BEAP draft refinement planning. Analysis reflects repository state at authoring time.*
