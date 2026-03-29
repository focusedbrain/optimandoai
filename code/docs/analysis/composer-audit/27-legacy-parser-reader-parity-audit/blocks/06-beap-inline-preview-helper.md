# extractTextForPackagePreview (beapPackageAttachmentPreview)

## Purpose

Electron-only helper: extract **preview text** for **package attachments** using **orchestrator HTTP** for PDFs and UTF-8 decode for text-like files.

## Files

- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts`
- `apps/electron-vite-project/src/lib/ingestAiContextFiles.ts` — `CONTEXT_UPLOAD_HTTP_PORT`

## Rendering path

N/A — pure async function; called from **`BeapInlineComposer.addAttachments`**.

## State ownership

Caller maps results to **`LocalAttachment.previewText`** / **`previewError`**.

## Inputs and outputs

**Input:** `{ name, mimeType?, base64 }`.

**Output:** `{ text, error? }`.

## Dependencies

- `fetch` to `http://127.0.0.1:51248/api/parser/pdf/extract`
- No `chrome.runtime`, no vision.

## Data flow

Read file → base64 → POST JSON → **`extractedText`** or decode path for `.txt`/etc.

## Legacy behavior

**Not legacy** — parallel to **`processAttachmentForParsing`**.

## Current behavior

Sole extract path for **inline** attachment preview in audited code.

## Regression

**No badge**, **no** `semanticExtracted` on **`CapsuleAttachment`** from this helper.

## Root cause

Intentional **thin** helper for dashboard.

## Reuse potential

Keep for **fast** preview; **or** replace calls with **`runDraftAttachmentParseWithFallback`** for parity.

## Change risk

Low for **display**; medium if **send** must embed **`semanticContent`** from same pipeline.

## Notes

`PACKAGE_PREVIEW_ATTACHMENT_ID = 'beap-inline-package-preview'` for parser `attachmentId` field.
