# runDraftAttachmentParseWithFallback (draftAttachmentAutoParse)

## Purpose

Unified **PDF/text extraction** for **draft attachments**: primary **`processAttachmentForParsing`**, optional **Anthropic Vision** for difficult PDFs.

## Files

- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts`
- `apps/extension-chromium/src/beap-builder/visionExtractionService.ts` (imported)
- `apps/extension-chromium/src/beap-builder/anthropicApiKeyStorage.ts` (imported)

## Rendering path

Not a UI module — **async helper** called from **`popup-chat.tsx`**, **`sidepanel.tsx`**, etc.

## State ownership

Callers update **`DraftAttachment.capsuleAttachment`** and **`processing`** from returned **`DraftAttachmentParseUpdate`**.

## Inputs and outputs

**Input:** `DraftAttachmentParseItem` — `id`, `dataBase64`, `capsuleAttachment`.

**Output:** `DraftAttachmentParseUpdate` — updated **`capsuleAttachment`**, **`processing`** (parsing flags, optional **error**).

## Dependencies

- `processAttachmentForParsing` (`parserService.ts`)
- `extractPdfTextWithVision` when API key present

## Data flow

Base64 → primary parse → if weak text → vision → set **`semanticContent`** / errors.

## Legacy behavior

**Popup** auto-invokes for new PDFs; **Retry** re-invokes same function.

## Current behavior

**`BeapInlineComposer` does not import this module** — uses **`extractTextForPackagePreview`** instead.

## Regression

**Vision** and **pdfjs-first** behavior **not available** on inline path.

## Root cause

Intentional **thin** Electron preview helper vs full extension pipeline (see `07-parser-service-and-result-contracts.md`).

## Reuse potential

**High** if inline can supply **base64** + **`CapsuleAttachment`** shape; must validate **Electron** environment (no `chrome.runtime` in some parser paths — `parserService` may still run pdfjs in renderer).

## Change risk

Medium–high: ties inline to **extension crypto/vision** policies and **user API keys**.

## Notes

`draftAttachmentParseRejectedUpdate` helper standardizes **catch** handling.
