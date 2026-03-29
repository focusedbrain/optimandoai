# processAttachmentForParsing (parserService)

## Purpose

Main **extension** entry to fill **`CapsuleAttachment.semanticContent`** from **base64** file data: **PDF** via pdfjs + orchestrator HTTP + headers from **`BEAP_GET_PQ_HEADERS`**.

## Files

- `apps/extension-chromium/src/beap-builder/parserService.ts`
- `apps/extension-chromium/src/beap-builder/canonical-types.ts` — `CapsuleAttachment`

## Rendering path

N/A — service layer.

## State ownership

Returns **new** `attachment` object fields; caller merges into React state.

## Inputs and outputs

**Input:** `CapsuleAttachment`, `fileDataBase64`.

**Output:** `{ attachment, provenance | null, error | null }`.

## Dependencies

- `pdfjs-dist` (browser)
- `chrome.runtime.sendMessage` for launch headers
- Electron orchestrator HTTP (see `extractPdfText` implementation in same file)

## Data flow

Base64 → `extractPdfText` → **`semanticContent`** + **`semanticExtracted`**, or **error** string.

## Legacy behavior

**Popup** and **CapsuleSection** depend on this for **canonical** capsule text.

## Current behavior

**`BeapInlineComposer`** does **not** call **`processAttachmentForParsing`**; uses **`extractTextForPackagePreview`**.

## Regression

Different **fallback chain** and **no** `provenance` in inline preview helper.

## Root cause

Electron dashboard chose **direct HTTP** preview vs full extension service (see `07`).

## Reuse potential

Possible via **shared bundling** if `parserService` runs in Electron renderer — **verify** `chrome.runtime` availability in that context.

## Change risk

High if moving — **security invariants** in file header (extracted text capsule-bound only).

## Notes

Verify `parserService.ts` implementation completeness when editing (analysis did not run TypeScript).
