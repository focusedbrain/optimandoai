# Legacy parser & reader parity — complete audit (single document)

**Consolidates:** `00-index.md`, `01`–`12`, and all files under `blocks/`.  
**Nature:** Analysis-only; no code changes.  
**Primary code roots:** `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`, `apps/extension-chromium/src/popup-chat.tsx`, `apps/extension-chromium/src/beap-builder/`.

---

## Table of contents

1. [Scope & quick answers](#1-scope--quick-answers)
2. [Current inline attachment flow](#2-current-inline-attachment-flow)
3. [Legacy capsule-builder attachment flow](#3-legacy-capsule-builder-attachment-flow)
4. [Parsed state model](#4-parsed-state-model)
5. [Parsed badge rendering](#5-parsed-badge-rendering)
6. [Text reader and raw text view](#6-text-reader-and-raw-text-view)
7. [Page thumbnail navigation](#7-page-thumbnail-navigation)
8. [Parser service and result contracts](#8-parser-service-and-result-contracts)
9. [Current vs legacy parity map](#9-current-vs-legacy-parity-map)
10. [Contrast and readability audit](#10-contrast-and-readability-audit)
11. [Selected-field indicator hook points](#11-selected-field-indicator-hook-points)
12. [Root cause summary](#12-root-cause-summary)
13. [Restoration recommendation](#13-restoration-recommendation)
14. [Deep dives — components & helpers](#14-deep-dives--components--helpers)

---

## 1. Scope & quick answers

### Scope

Analysis-only documentation comparing **legacy BEAP capsule-builder / popup-chat attachment UX** with the **Electron inline `BeapInlineComposer`**, plus **contrast**, **parsed-state models**, and **AI refine field indicators**.

### Quick answers

1. **Green “Parsed” badge:** `AttachmentStatusBadge` success config — `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`.
2. **Raw text reader:** `BeapDocumentReaderModal` — `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx`.
3. **Page navigation / “thumbnails”:** Left rail in `BeapDocumentReaderModal` — **synthetic** pages from `splitToSyntheticPages`, not image thumbnails.
4. **Legacy reader model:** Single `semanticContent` string (plus modal paging), not per-page OCR bitmaps.
5. **Inline composer:** Different extract path (`extractTextForPackagePreview` in Electron); not the same as `processAttachmentForParsing` + `CapsuleAttachment` state machine.

---

## 2. Current inline attachment flow

### Purpose

Trace how **`BeapInlineComposer`** (`apps/electron-vite-project/src/components/BeapInlineComposer.tsx`) handles package attachments from pick → preview → send.

### Files

- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts`
- `apps/electron-vite-project/src/lib/ingestAiContextFiles.ts` (shared `CONTEXT_UPLOAD_HTTP_PORT` = 51248)
- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx` (imported via `@ext`)

### Rendering path

1. User clicks **`ComposerAttachmentButton`** → `addAttachments()` → `window.emailInbox.showOpenDialogForAttachments()`.
2. For each file, `window.emailInbox.readFileForAttachment(path)` yields base64 + mime.
3. **`extractTextForPackagePreview`** runs (PDF → POST `/api/parser/pdf/extract` on `127.0.0.1:51248`; text-like extensions → UTF-8 decode).
4. State: `LocalAttachment[]` with `previewText`, `previewError`.
5. Optional **`BeapDocumentReaderModal`**: opened when first attachment has `previewText`; per-row **View text** calls `openAttachmentReader`.
6. **Send path**: `handleSend` rebuilds `CapsuleAttachment[]` from files again via `readFileForAttachment`; **`semanticContent` / `semanticExtracted` are set to null/false** in the inline mapping.

### State ownership

- **React local state** in `BeapInlineComposer`: `attachments`, `readerOpen`, `readerFilename`, `readerText`.
- **No** `CapsuleAttachment.semanticExtracted` progression in UI state for attachments.
- **No** shared Zustand store for package parse status (unlike AI context `useAiDraftContextStore`).

### Data flow (summary)

```
Dialog → readFileForAttachment → extractTextForPackagePreview → LocalAttachment.preview*
     → optional BeapDocumentReaderModal
Send → readFileForAttachment → CapsuleAttachment (semantic* null) → executeDeliveryAction
```

### vs legacy

Legacy popup-chat stores **`CapsuleAttachment`** + **`processing`** and uses **`runDraftAttachmentParseWithFallback`** → **`processAttachmentForParsing`**.

### Root cause

**Architectural fork**: inline composer uses **`beapPackageAttachmentPreview.ts`** instead of **`draftAttachmentAutoParse.ts`** + **`CapsuleAttachment`** + badge + reader state machine from popup-chat.

---

## 3. Legacy capsule-builder attachment flow

### Files

- `apps/extension-chromium/src/popup-chat.tsx` (BEAP draft attachments ~1355–1470, reader modal ~2372–2385)
- `apps/extension-chromium/src/beap-builder/components/CapsuleSection.tsx`
- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts`
- `apps/extension-chromium/src/beap-builder/parserService.ts`

### Popup-chat (WR Chat)

**Add:** FileReader → base64 on **`DraftAttachment`**. For **PDF**, **`processing.parsing: true`** and **`runDraftAttachmentParseWithFallback`** in `onChange`.

**Parse:** **`runDraftAttachmentParseWithFallback`** → **`processAttachmentForParsing`** (+ optional Vision).

**UI:** **`AttachmentStatusBadge`** when `showPdfBadge`; **Open reader** when success + `semanticContent`; **Retry** on error; error strip for `processing.error`.

**Reader:** `beapDraftReaderModalId` → **`BeapDocumentReaderModal`** with `semanticContent` from `capsuleAttachment`.

### CapsuleSection

Manual **Parse**, **`attachmentDataMap`** for base64, **`AttachmentStatusBadge`**.

### Summary table

| Feature | Popup-chat | CapsuleSection |
|---------|------------|----------------|
| Auto-parse PDF on add | Yes | No (manual Parse) |
| Badge | Yes | Yes |
| Reader | Yes | Yes (where wired) |

**Note:** `sidepanel.tsx` duplicates a similar BEAP draft block.

---

## 4. Parsed state model

### CapsuleAttachment (`canonical-types.ts`)

- `semanticContent`, `semanticExtracted`, plus `encryptedRef`, `encryptedHash`, etc.
- Filled by **`processAttachmentForParsing`**, optionally vision via **`runDraftAttachmentParseWithFallback`**.

### Draft attachment (popup)

- `capsuleAttachment`, `processing: { parsing, rasterizing, error? }`, `dataBase64`.

### LocalAttachment (inline)

- `previewText`, `previewError`; no separate `semanticExtracted`.

### Mapping

| Concept | Legacy | Inline |
|---------|--------|--------|
| Parsed text | `semanticContent` | `previewText` |
| Success flag | `semanticExtracted` | implied by `previewText` |
| In progress | `processing.parsing` | not modeled (await in `addAttachments`) |
| Vision fallback | `draftAttachmentAutoParse.ts` | not called |

**Uncertainty:** Whether send pipeline requires `semanticContent` for attachments — inline sets **null** in observed `handleSend`; confirm against `BeapPackageBuilder` / `executeDeliveryAction`.

---

## 5. Parsed badge rendering

### Component

`apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`

- **`success`** → label **`Parsed`**, green styling (`#16a34a`, green-tint bg/border).
- **`pending`** → **`Extracting…`**, **`failed`** → **`Failed`**.
- **`theme` prop is declared but unused** in the component body.

### Popup derivation

`isPdf`, `isParsing`, `isSuccess` (`semanticExtracted`), `showPdfBadge`, `parseStatus` → badge.

### Inline

**Does not import `AttachmentStatusBadge`.**

---

## 6. Text reader and raw text view

### BeapDocumentReaderModal

- **Popup:** portal when `beapDraftReaderModalId` set and attachment has `semanticContent`.
- **Inline:** `readerText` from `previewText`.

**Display:** `<pre>` with `whiteSpace: 'pre-wrap'`, monospace — **normalized text only**, not raw bytes.

**Backdrop:** `rgba(0,0,0,0.55)` on overlay — separate from composer rail issues.

---

## 7. Page thumbnail navigation

### What the left rail is

- Buttons **P1…Pn** + **~42 char text snippet** per **synthetic** page from **`splitToSyntheticPages(semanticContent)`** (`charsPerPage` default 3000).
- **Not** raster PDF images, **not** OCR thumbnails, **not** PDF engine page count.

### Footer

Page X of Y, Prev/Next, Search, Copy page/all; disclaimer that page boundaries are approximate.

### Regression note

True **image** thumbnails would be **new work** — not in current `BeapDocumentReaderModal`.

---

## 8. Parser service and result contracts

### `processAttachmentForParsing` (extension)

- Returns `CapsuleAttachment` + provenance + error.
- **pdfjs** in browser, then orchestrator HTTP, **`BEAP_GET_PQ_HEADERS`** via `chrome.runtime`.
- Hard timeout 120s.

### `runDraftAttachmentParseWithFallback`

- Wraps above; **Vision** if Anthropic key present.

### `extractTextForPackagePreview` (Electron)

- PDF: `fetch` to `http://127.0.0.1:51248/api/parser/pdf/extract`.
- Text files: UTF-8 decode from base64.
- **No** pdfjs in this helper, **no** vision.
- Returns `{ text, error? }`, not `CapsuleAttachment`.

### Comparison

| Aspect | parserService + auto-parse | extractTextForPackagePreview |
|--------|------------------------------|------------------------------|
| Output | `CapsuleAttachment` + provenance | plain string + error |
| PDF | pdfjs + HTTP + vision | HTTP only |

**Uncertainty:** Orchestrator vs pdfjs output parity for same file — not runtime-verified in audit.

---

## 9. Current vs legacy parity map

| Behavior | Status | Note |
|----------|--------|------|
| PDF extract (some path) | Partial | Inline: HTTP 51248; legacy: pdfjs + HTTP + vision |
| Green “Parsed” badge | Missing / unwired | Component exists; not in inline |
| Extracting/Failed badge | Missing | No `processing.parsing` on inline rows |
| BeapDocumentReaderModal | Partial | Inline uses `previewText` |
| Synthetic P1/P2 rail | Preserved | Same component |
| Open reader | Partial | Legacy: “Open reader”; inline: “View text” |
| Auto-open modal | Partial | Popup: manual; inline: auto-opens first `previewText` |
| Vision fallback | Missing (inline) | |
| Retry parse | Missing (inline) | |
| semanticExtracted on send | Partial | Inline sets false / null |
| AI refine indicator | Partial | `DraftRefineLabel` sparkle, not 👆 |
| Popup lavender encrypted field | Legacy styling | Low-contrast risk |
| Inline main textareas | White/dark text | Observed in audited inline file |
| Right rail | Partial | Solid colors in audited `AiDraftContextRail` |

---

## 10. Contrast and readability audit

**Evidence-based** (see `BeapInlineComposer.tsx`, `AiDraftContextRail.tsx`, `popup-chat.tsx`, `BeapDocumentReaderModal.tsx`).

### BeapInlineComposer (examples)

- `rgba(255,255,255,0.04)` delivery details — translucent “wash”.
- `rgba(59,130,246,0.08)` email panel.
- Distribution toggles: `rgba(124,58,237,0.35)` / `rgba(59,130,246,0.3)` with `fg` `#e2e8f0` — can feel low-contrast.
- `fg` / `muted` for chrome vs `#0f172a` main fields.

### Popup-chat

- Encrypted textarea: `rgba(139,92,246,0.15)` etc., light `textColor` on tint.
- Helpers `#c4b5fd`, info boxes muted on purple tint.

### BeapDocumentReaderModal

- Copy buttons: purple tint + `#c4b5fd` text — softer contrast.

**Uncertainty:** Parent dashboard CSS variables not fully traced.

---

## 11. Selected-field indicator hook points

### Store

`apps/electron-vite-project/src/stores/useDraftRefineStore.ts` — `connected`, `refineTarget: 'email' | 'capsule-public' | 'capsule-encrypted'`.

### BEAP inline

- Public: `DraftRefineLabel` + `handleFieldClick('public')`.
- Encrypted: same for `'encrypted'`.

### Email inline

- Body: `DraftRefineLabel` + `refineTarget === 'email'`.

### Best hook

**`DraftRefineLabel`** — swap sparkle for pointing-finger (or product icon) in **one** component.

### Legacy popup

**No** `useDraftRefineStore` in `popup-chat.tsx` for this pattern.

---

## 12. Root cause summary

1. **Parser backend:** Two pipelines; failures can be **51248 down** vs **pdfjs** path differences — not automatically “parser deleted.”
2. **Missing UI wiring:** No `AttachmentStatusBadge`, no `runDraftAttachmentParseWithFallback` in inline.
3. **Missing in inline UI:** Retry, `processing` model, badge; send sets `semanticContent: null`.
4. **Contrast:** Translucent panels and toggles in inline; lavender/muted in popup.
5. **Active field:** `DraftRefineLabel` + sparkle exists; 👆 is product delta.

**Conclusion:** **Combination** of display-layer regression (badge/state machine), **pipeline fork**, **contrast debt**, and **partial** refine indicator (sparkle vs 👆).

---

## 13. Restoration recommendation

**Order (phased):**

1. **Contrast** — opaque panels, solid toggles, align popup lavender if needed.
2. **Active-field icon** — change `DraftRefineLabel` icon.
3. **Parsed badge** — `AttachmentStatusBadge` + row state.
4. **Reader parity** — align auto-open vs manual “Open reader.”
5. **Page rail** — if synthetic P1/P2 is enough, only ensure modal reachable; true image thumbnails = new scope.
6. **Parser unify** — only if vision + `CapsuleAttachment` on send are required; high risk.

**Reuse priority:** `AttachmentStatusBadge` → `BeapDocumentReaderModal` → `DraftRefineLabel` → `runDraftAttachmentParseWithFallback` (after contract review).

---

## 14. Deep dives — components & helpers

The following sections mirror `blocks/*.md` (full structure: Purpose, Files, Rendering path, State, I/O, Dependencies, Data flow, Legacy/Current, Regression, Root cause, Reuse, Risk, Notes).

### 14.1 BeapDocumentReaderModal (`blocks/01-beap-document-reader-modal.md`)

- Portal modal; `semanticContent` → `splitToSyntheticPages` → P1/P2 rail + `<pre>`.
- Callers: `popup-chat.tsx`, `BeapInlineComposer.tsx`.
- Reuse: direct via `@ext`.

### 14.2 runDraftAttachmentParseWithFallback (`blocks/02-draft-attachment-auto-parse.md`)

- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts`
- `processAttachmentForParsing` + optional Vision (`visionExtractionService`, `anthropicApiKeyStorage`).
- **Not** used by `BeapInlineComposer`.

### 14.3 AttachmentStatusBadge (`blocks/03-attachment-status-badge.md`)

- Extracting… / Parsed / Failed pills.
- Header comment “Text ready” may be stale vs **`Extracting…`** for pending.

### 14.4 Page thumbnail rail — synthetic (`blocks/04-page-thumbnail-rail.md`)

- Left column in `BeapDocumentReaderModal` (~203–244); **not** image thumbnails.

### 14.5 processAttachmentForParsing — parserService (`blocks/05-parser-service-process-attachment.md`)

- `apps/extension-chromium/src/beap-builder/parserService.ts`
- pdfjs + HTTP + `BEAP_GET_PQ_HEADERS`; security invariants in file header.

### 14.6 extractTextForPackagePreview (`blocks/06-beap-inline-preview-helper.md`)

- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts`
- `PACKAGE_PREVIEW_ATTACHMENT_ID = 'beap-inline-package-preview'`.

### 14.7 useDraftRefineStore (`blocks/07-use-draft-refine-store.md`)

- `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`
- Targets: email, capsule-public, capsule-encrypted; default `refineTarget` `'email'` on disconnect.

---

## Document history

- **Source folder:** `docs/analysis/composer-audit/27-legacy-parser-reader-parity-audit/`
- **This file:** single merged view of the same content as `00-index.md`, `01`–`12`, and `blocks/01`–`blocks/07`.

For line-level duplicate detail, the per-file markdowns remain available alongside this document.
