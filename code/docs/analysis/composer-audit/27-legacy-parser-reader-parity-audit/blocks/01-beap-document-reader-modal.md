# BeapDocumentReaderModal

## Purpose

Modal **text reader** for extracted attachment text: **synthetic paging**, search, copy, left **P1/P2** rail (text snippets, not image thumbnails).

## Files

- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx`
- `apps/extension-chromium/src/beap-builder/components/index.ts` (re-export)

## Rendering path

**Portal** to `document.body` when `open` is true. Invoked from **`popup-chat.tsx`** (reader id state) and **`BeapInlineComposer.tsx`** (reader open state).

## State ownership

**Caller-owned**: filename, full `semanticContent` string, open flag.

## Inputs and outputs

**Props:** `open`, `onClose`, `filename`, `semanticContent`, `theme`.

**Outputs:** UI only; **Copy** writes clipboard.

## Dependencies

- `splitToSyntheticPages` (same module)
- No direct `parserService` import.

## Data flow

`semanticContent` string → `splitToSyntheticPages` → `pages[]` → sidebar buttons + `<pre>` for current page.

## Legacy behavior

Popup opens when user clicks **Open reader** with successful **`capsuleAttachment.semanticContent`**.

## Current behavior

Inline passes **`readerText`** from **`LocalAttachment.previewText`**; may auto-open on first successful preview.

## Regression

If modal “missing,” likely **upstream string empty** or **not opening** — component itself is **shared**.

## Root cause

N/A for component in isolation; integration varies by caller.

## Reuse potential

**Direct reuse** — already imported in Electron via `@ext`.

## Change risk

Low for **wiring**; changing paging semantics affects **all** callers.

## Notes

Backdrop `rgba(0,0,0,0.55)` dims entire screen — distinct from composer rail styling.
