# Letter Composer — Compose Mode Diagnosis (read-only analysis)

This document answers why compose mode may feel broken after **Finish Mapping**, based solely on the current codebase. No source files were modified for this analysis.

**Note:** `letter:*` IPC handlers are registered in `apps/electron-vite-project/electron/main/letter/letterComposerIpc.ts` (loaded from `main.ts` via dynamic import), not inline in `main.ts`.

---

## Section 1 — What happens when "Finish Mapping" is clicked

### 1.1 Exact `onClick` handler (Finish Mapping button)

From `LetterTemplatePort.tsx`:

```tsx
<button
  type="button"
  className="finish-mapping-btn"
  onClick={handleFinishMapping}
  disabled={activeTemplate.fields.length === 0}
>
  Finish Mapping ({activeTemplate.fields.length} fields defined)
</button>
```

### 1.2 `handleFinishMapping` implementation

```ts
const handleFinishMapping = useCallback(() => {
  if (!activeTemplateId || !activeTemplate) return
  if (activeTemplate.fields.length === 0) return
  setSuggestionFields([])
  setTemplateMappingComplete(activeTemplateId, true)
}, [activeTemplateId, activeTemplate, setTemplateMappingComplete])
```

### 1.3 Store updates

- Calls **`setTemplateMappingComplete(activeTemplateId, true)`**, which maps to `useLetterComposerStore` → **`setTemplateMappingComplete`** and sets **`mappingComplete: true`** on that template.
- Does **not** call `createLetterComposeSession` directly here.

### 1.4 Session creation (`startComposeSession` / `createLetterComposeSession`)

There is **no** function named `startComposeSession`. The public helper is **`createLetterComposeSession(templateId)`** in `useLetterComposerStore.ts`.

After `mappingComplete` becomes true, a **`useEffect`** in `LetterTemplatePort.tsx` ensures a compose session exists:

```tsx
useEffect(() => {
  if (!activeTemplate?.mappingComplete) return
  const st = useLetterComposerStore.getState()
  let sess = st.composeSessions.find((c) => c.templateId === activeTemplate.id)
  if (!sess) {
    sess = createLetterComposeSession(activeTemplate.id)
    st.addComposeSession(sess)
  } else if (st.activeComposeSessionId !== sess.id) {
    st.setActiveComposeSession(sess.id)
  }
}, [activeTemplate?.id, activeTemplate?.mappingComplete])
```

So the transition relies on this effect running after render; briefly, **`activeComposeSession` can still be `null`** until the effect runs.

### 1.5 Conditional rendering after `mappingComplete`

Within `{activeTemplate ? ( <div className="template-display"> ...` )}`:

- **Mapping mode:** `activeTemplate && !activeTemplate.mappingComplete && previewImages.length > 0` → mapping UI + `FieldMappingOverlay` + Finish button.
- **Compose mode:** `activeTemplate.mappingComplete && previewImages.length > 0` → **`ComposeFieldsForm`** + export actions (for `.docx`) + collapsible read-only preview with `FieldMappingOverlay` **`readOnly`**.
- **Else:** `Generating PDF preview…` if no preview images.

There is **no** component named `ComposeView`. The compose UI is **`ComposeFieldsForm`**.

### 1.6 `ComposeFieldsForm` return structure (high level)

The component returns a single root `<div className="compose-fields-form">` containing:

- Header (“Compose letter” + subtitle about WR Chat / Template port).
- Optional version bar when `composeSession.versions.length > 0`.
- **“Draft reply with AI”** button (`handleAiDraftBody`).
- Grouped field sections with **`renderField`** (inputs/textareas).

---

## Section 2 — Compose field rendering

### 2.1 Mapped fields as inputs

Yes. **`ComposeFieldsForm`** renders each field as:

- `<textarea>` for `richtext`, `multiline`, `address`
- `<input type="date">` for `date`
- `<input type="text">` otherwiseValues come from **`field.value`**; updates go through **`updateFieldValue`** → **`updateTemplateField`** (and optionally **`updateDraftRefineText`** when draft refine is connected for the same field).

### 2.2 `ComposeField` component

There is **no** separate `ComposeField` component. Rendering is inline in **`renderField`** inside `ComposeFieldsForm.tsx`.

### 2.3 Field select/deselect for AI (no separate button)

There is **no** dedicated toggle button. Selection for AI is driven by:

- **`onClick={onSelect}`** and **`onFocus={onSelect}`** on each input/textarea, where **`onSelect = () => handleFieldSelect(field)`**.

`handleFieldSelect` calls **`connectDraftRefine`** with **`refineTarget: 'letter-template'`** and an **`onResponse`** that applies text via **`updateTemplateField`**.

### 2.4 `useDraftRefineStore` in compose view

**Yes.** `ComposeFieldsForm.tsx` imports and uses:

- `connect`, `disconnect`, `updateDraftText`
- selectors: `connected`, `refineTarget`

Cleanup on unmount: **`disconnectDraftRefine()`** and **`setFocusedTemplateField(null)`**.

---

## Section 3 — Draft refine store integration

### 3.1 Full store (`useDraftRefineStore.ts`)

**State shape:**

- `connected: boolean`
- `messageId: string | null`
- `messageSubject: string | null`
- `draftText: string`
- `refineTarget: DraftRefineTarget` — `'email' | 'email-subject' | 'capsule-public' | 'capsule-encrypted' | 'letter-template'`
- `refinedDraftText: string | null`
- `onResponse: ((text: string) => void) | null`

**Actions:**

- **`connect(messageId, messageSubject, draftText, onResponse, refineTarget?)`** — default `refineTarget` is `'email'`.
- **`updateDraftText(draftText: string)`**
- **`disconnect()`**
- **`deliverResponse(text: string)`** — sets `refinedDraftText` only (does not apply to field).
- **`acceptRefinement()`** — if `refinedDraftText` and `onResponse`, calls **`onResponse(refinedDraftText)`** and clears `refinedDraftText`.

### 3.2 `setActiveField`

**Does not exist** in `useDraftRefineStore`.

### 3.3 `context` field on the draft refine store

**No.** There is no `context` field on this store. Extra context for chat can be appended separately in `HybridSearch` via **`useAiDraftContextStore`** (`contextDocs`) when **`isDraftRefine`** is true (see Section 4).

### 3.4 `clearActiveField`

**Does not exist.** Closest behavior: **`disconnect()`** clears the whole draft-refine connection.

---

## Section 4 — HybridSearch ↔ draft refine connection

### 4.1 Reads from `useDraftRefineStore`

`HybridSearch.tsx` subscribes to:

- `draftRefineConnected`, `draftRefineMessageId`, `draftRefineMessageSubject`, `draftRefineTarget`
- `draftRefineDraftText`, `draftRefineDeliverResponse`, `draftRefineAcceptRefinement`, `draftRefineDisconnect`

### 4.2 When draft refine mode is active

Critical derived flag:

```ts
const isDraftRefineSession =
  draftRefineConnected &&
  (draftRefineMessageId === selectedMessageId ||
    (draftRefineMessageId === null && selectedMessageId == null))
```

Letter template **`connect`** uses **`messageId: null`**. Therefore:

- Draft refine runs as **`isDraftRefineSession === true`** only if **`selectedMessageId == null`** **or** `draftRefineMessageId === selectedMessageId` (never true when messageId is null and selected id is non-null).

**Implication:** If the user has **any inbox message selected** (`selectedMessageId` set), **`isDraftRefineSession` becomes false** even though **`connected`** is true. The chat bar then **does not** use the draft-refine prompt path or **`deliverResponse` / “Use”** wiring for that session.

### 4.3 Prompt construction when draft refine is active

When **`isDraftRefine`** is true:

- **`currentDraft`** is taken from **`useDraftRefineStore.getState().draftText`** (with fallback to subscribed `draftRefineDraftText`).
- For **`letter-template`**, the label in the prompt is **“letter template paragraph”**.
- If there is draft text, the user message is wrapped as: current draft in `---` blocks + user instruction + **“Output ONLY the revised text…”**.
- If **`contextDocs`** exist in **`useAiDraftContextStore`**, a **CONTEXT DOCUMENTS** block is **appended** to `chatQuery`.

There is **no** automatic injection of **`anchorText`**, OCR snippet, or full letter body into this prompt unless the user attached context docs or the draft text already contains it.

### 4.4 “Use” button

On successful chat with **`isDraftRefine`** and non-empty answer:

- **`draftRefineDeliverResponse(refined)`** stores the text.
- History entry includes **`showUseButton: true`** and **`onUse: () => draftRefineAcceptRefinement()`**.
- **`acceptRefinement`** calls the **`onResponse`** callback registered in **`connect`** — for letters, that is **`(refined) => updateTemplateField(template.id, field.id, refined)`** from `ComposeFieldsForm`.

---

## Section 5 — Export pipeline

### 5.1 `letter:exportDocx`

**There is no channel named `letter:exportDocx`.** The handler is **`letter:exportFilledDocx`** in `letterComposerIpc.ts` (full handler body fills DOCX via **`fillDocxPlaceholders`**, then **`dialog.showSaveDialog`**, then writes file). See file lines ~279–322 in the current tree.

### 5.2 `letter:exportPdf`

**No `letter:exportPdf` name.** The PDF path is **`letter:exportFilledPdf`**: fill DOCX in memory → temp filled `.docx` → **`convertToPdf`** (LibreOffice) → save PDF dialog → copy to user path.

### 5.3 Text replacement in DOCX / `anchorText`

**`fillDocxPlaceholders.ts`**:

- **`effectiveSearch`** prefers **trimmed `anchorText`**, else **placeholder**, else **`{{id}}`**.
- Replacement runs in **`word/*.xml`** using **`replaceFirstAcrossRuns`** (handles split `<w:t>` runs).

Export payload from UI **`buildExportFieldsPayload`**:

- `placeholder: f.defaultValue || \`{{${f.id}}}\``
- `anchorText: f.anchorText ?? ''`
- `value: f.value ?? ''`

### 5.4 Preload bridge

**`window.letterComposer.exportFilledDocx`** and **`exportFilledPdf`** — yes, in `preload.ts` (invoke `letter:exportFilledDocx` / `letter:exportFilledPdf`).

### 5.5 Export / Print button wiring in compose UI

In **`mappingComplete`** branch of `LetterTemplatePort.tsx`:

- **Export as DOCX / Export as PDF / Print** call **`handleExportDocx`**, **`handleExportPdf`**, **`handlePrint`** (compose row, `.docx` only for the second two).

**Toolbar** (visible whenever `activeTemplate` exists, including before mapping complete) also has **Export as DOCX** and **Print** with the same handlers.

**`handleExportDocx`:** calls **`api.exportFilledDocx`** with **`buildExportFieldsPayload()`** — only if template is **`.docx`**.

**`handleExportPdf`:** **`exportFilledPdf`**, `.docx` only.

**`handlePrint`:** If **`mappingComplete`** and **`.docx`** and **`printFilledLetter`**, uses filled-docx → PDF → system print; else falls back to printing **PNG preview images** in a **`window.open`** popup.

---

## Section 6 — Letter extraction + auto-fill

### 6.1 `letter:extractFromLetter`

**Does not exist.** Letter viewer uses **`letter:extractFromScan`** (raw extraction) and **`letter:normalizeExtracted`** (normalized fields + confidence).

### 6.2 Automatic extraction after upload

**Yes.** In `LetterViewerPort.tsx`, after building **`fullText`**, if **`api.extractFromScan`** and **`api.normalizeExtracted`** exist, the pipeline runs and results are stored on the **`ScannedLetter`** as **`extractedFields`** / **`confidence`**.

### 6.3 “Auto-fill from letter” / “Use as reply” button

No dedicated button with that label was required for this doc; auto-fill is implemented as a **`useEffect`** in **`ComposeFieldsForm`** when **`replyToLetter.extractedFields`** changes (runs once per letter id via **`lastReplyAutofillId`**).

### 6.4 Mapping incoming sender → reply recipient fields

In **`ComposeFieldsForm`**, **`findRecipientNameField`** / **`findRecipientAddressField`** are patched from **`ef.sender_name`** / **`ef.sender_address`**. So **incoming letter sender** is intentionally applied to **recipient**-named template fields (reply semantics).

---

## Section 7 — Checklist: missing vs exists

| Feature | Code exists? | Wired to UI? | Actually works? |
|--------|--------------|---------------|-----------------|
| Finish Mapping → compose transition | Yes (`mappingComplete` + `ComposeFieldsForm` branch) | Yes | **Mostly** — compose session is created in `useEffect`, not in the click handler; rare one-frame/null edge possible |
| Compose form with mapped fields | Yes (`ComposeFieldsForm`) | Yes | Yes for manual typing, subject to session existing |
| Field select/deselect for AI | Partial (focus/click only, no explicit toggle) | Yes (implicit) | **Fragile** — see HybridSearch `isDraftRefineSession` vs `selectedMessageId` |
| `useDraftRefineStore` connection | Yes | Yes from compose fields | **Conditional** — breaks when inbox message selected |
| HybridSearch reads selected field | Via `draftText` + `refineTarget` | Yes when `isDraftRefineSession` | **Often no** if `selectedMessageId != null` |
| “Use” writes back to field | Yes (`acceptRefinement` → `onResponse`) | Yes in draft-refine chat history | Only if draft-refine chat path ran |
| “Draft with AI” (`handleAiDraftBody`) | Yes | Yes (button in `ComposeFieldsForm`) | Depends on **`window.handshakeView.chatDirect`** + body field detection |
| `letter:extractFromLetter` IPC | **No** (use `extractFromScan`) | N/A | N/A |
| Auto-fill recipient from letter | Yes (`useEffect` + extracted fields) | Automatic | Yes if extraction populated `sender_*` |
| `letter:exportDocx` IPC | **No** (`exportFilledDocx`) | Via `exportFilledDocx` | Yes if DOCX search string matches document |
| Export button wired | Yes | Yes | **Data-dependent** — see `anchorText` |
| Print button wired | Yes | Yes | Yes for `.docx` filled path or image fallback |
| Text replacement in DOCX XML | Yes (`fillDocxPlaceholders`) | Yes | **Often weak** — see below |
| `letter:exportPdf` | **No** (`exportFilledPdf`) | Yes | Yes if LibreOffice + `.docx` |

### Likely root causes of reported symptoms

1. **Top chat bar “does nothing” for field refinement:**  
   **`isDraftRefineSession`** is false whenever **`draftRefineMessageId === null`** but **`selectedMessageId`** is set (inbox message still selected). Chat then uses the normal RAG path, not draft refine, so no **“Use”** / **`deliverResponse`** behavior for the letter field.

2. **Export / print “doesn’t include generated text”:**  
   **`FieldMappingOverlay`** always sets **`anchorText: ''`** for new fields. **`defaultValue`** is also **`''`** for mapped fields. **`buildExportFieldsPayload`** then searches for **`{{<uuid>}}`** in the DOCX XML, which **usually does not exist** in a normal Word template. **`fillDocxPlaceholders`** will not replace visible original text unless **`anchorText`** or **`placeholder`** matches real document text.

3. **Chat focus / LLM prefix for Letter Composer:**  
   **`LetterComposerView`** only pushes **`letter-composer`** chat focus when **`useLetterComposerStore.focusedPort`** is set. That comes from **`LetterComposerPortSelectButton`**, not from focusing a compose field. If the user never selects the **Template** port, **`getChatFocusLlmPrefix`** may omit letter-template context for generic chat (multi-version path is separate and trigger-phrase gated).

4. **Preview does not show filled values under boxes:**  
   The read-only **`FieldMappingOverlay`** in compose mode still shows **geometry + labels**, not a live raster of replaced text; replacing pixels is not implemented.

---

*Generated for internal debugging; align behavior with product intent before changing code.*
