# Parser service and result contracts

## Purpose

Contrast **`processAttachmentForParsing`** (extension `parserService.ts`) with **`extractTextForPackagePreview`** (Electron app).

## Files

- `apps/extension-chromium/src/beap-builder/parserService.ts` — `processAttachmentForParsing`, `extractPdfText`, pdfjs + orchestrator
- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts` — `runDraftAttachmentParseWithFallback`
- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts`
- `apps/electron-vite-project/src/lib/ingestAiContextFiles.ts` — same HTTP port **51248**

## Legacy / extension contract

### `processAttachmentForParsing(attachment, fileDataBase64)`

- Returns `{ attachment: CapsuleAttachment, provenance, error }`.
- Fills **`semanticContent`**, sets **`semanticExtracted`** on success.
- Uses **`extractPdfText`** internally — **pdfjs in browser** first, then **Electron HTTP** with **`getLaunchHeaders()`** (`chrome.runtime.sendMessage` `BEAP_GET_PQ_HEADERS`) per `parserService.ts` header comment.
- Hard timeout **120s** (`PARSING_HARD_TIMEOUT_MS`).
- Non-PDF parseable types: logic continues in file (not fully expanded in this audit).

### `runDraftAttachmentParseWithFallback`

- Wraps **`processAttachmentForParsing`**.
- If text insufficient → **`extractPdfTextWithVision`** when Anthropic key present (`draftAttachmentAutoParse.ts`).

## Electron inline contract

### `extractTextForPackagePreview({ name, mimeType, base64 })`

- **PDF**: `fetch('http://127.0.0.1:51248/api/parser/pdf/extract', …)` with JSON `{ base64, attachmentId }`.
- **Text-like** by extension / mime: UTF-8 decode from base64.
- **No** pdfjs in renderer for this helper.
- **No** vision fallback.
- Returns `{ text, error? }` — **not** `CapsuleAttachment`.

## Result contracts compared

| Aspect | parserService + draft auto-parse | extractTextForPackagePreview |
|--------|----------------------------------|------------------------------|
| Output type | `CapsuleAttachment` + provenance | Plain string + error |
| PDF engine | pdfjs + orchestrator + optional vision | Orchestrator HTTP only |
| Chrome headers | Uses `BEAP_GET_PQ_HEADERS` in extension path | N/A (Electron fetch) |
| Fallback depth | Higher | Lower |

## Legacy behavior

Unified builder path with **badge-ready** attachment updates.

## Current behavior

**Simpler** extract for preview; **send** still ships files with **`semanticContent: null`** in `BeapInlineComposer` (`capsuleAttachments.push` ~321–327 observed).

## Regression

**Not only “viewer missing”**: inline path **does not** invoke **`runDraftAttachmentParseWithFallback`**, so **vision** and **pdfjs-first** behaviors differ.

## Root cause

**Dual pipeline** by design in current code: dashboard helper vs extension parser service.

## Uncertainty

Whether orchestrator `/api/parser/pdf/extract` matches pdfjs output for the same file — **not verified** in this audit; would require runtime comparison.
