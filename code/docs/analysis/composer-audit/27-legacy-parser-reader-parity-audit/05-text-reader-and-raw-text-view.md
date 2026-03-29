# Text reader and raw text view

## Purpose

Describe **`BeapDocumentReaderModal`** — the shared reader used by legacy popup and (partially) by inline composer.

## Files

- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx`
- Exported from `apps/extension-chromium/src/beap-builder/components/index.ts`

## Rendering path

- **Popup-chat**: portal at end of `PopupChatApp` when `beapDraftReaderModalId` matches an attachment with non-empty **`capsuleAttachment.semanticContent`** (`popup-chat.tsx` ~2372–2384).
- **Inline composer**: `BeapDocumentReaderModal` with `semanticContent={readerText}` from **`LocalAttachment.previewText`** (`BeapInlineComposer.tsx`).

## State ownership

- **Popup**: `beapDraftReaderModalId` + attachment array.
- **Inline**: `readerOpen`, `readerFilename`, `readerText`.

## Inputs and outputs

Props:

- `open`, `onClose`, `filename`, `semanticContent` (full extracted string), `theme` (`standard` | `dark`).

## Raw text display

- Main column: `<pre>` with **`whiteSpace: 'pre-wrap'`**, monospace stack `CONTENT_FONT`.
- **Not** a separate “raw bytes” view — **always normalized text string**.

## Dependencies

- **`splitToSyntheticPages`** (same file) — chunks text for paging; **not** PDF.js page geometry.

## Legacy behavior

Full-string reader with **synthetic** pagination.

## Current behavior

Same component when opened from inline; source string from **`extractTextForPackagePreview`** instead of **`processAttachmentForParsing`**.

## Regression

If users expect **only** legacy popup behavior, inline now opens reader **only when** preview extract succeeded — same gating idea, different upstream pipeline.

## Root cause

Reader exists; **data source and badge pipeline** differ (see `01`, `03`, `07`).

## Notes

Overlay backdrop: `backgroundColor: 'rgba(0,0,0,0.55)'` on the full-screen click-catcher — **business UI** may object to dimming; separate from “right rail” translucency issues.
