# BeapDocumentReaderModal

## Purpose

Full-screen (portal) **document reader** for extracted **semantic text**: **synthetic paging**, **left sidebar** page list / navigation, search, copy page/all.

## Files

- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx`
- **`splitToSyntheticPages`** exported from same file

## Rendering path

- **Popup:** Opened from BEAP draft attachment actions.
- **Electron:** **`BeapInlineComposer`** mounts one instance at root; `open` toggled when user adds attachment with text or clicks **View text**.

## State ownership

**Modal internal:** `currentPage`, `searchQuery`, etc. **Parent:** `open`, `filename`, `semanticContent`.

## Inputs and outputs

- **Props:** `open`, `onClose`, `filename`, `semanticContent`, optional `theme`.
- **Output:** User reads/copies; closes via Escape or button.

## Dependencies

`createPortal`, `document.body` overflow lock.

## Data flow

Extracted text string → `semanticContent` → `splitToSyntheticPages` → pages → sidebar + main `<pre>`.

## Legacy behavior

Same component in extension; **page rail** is the **left** column in modal layout (see component for full JSX).

## Current behavior

Used with **`theme="standard"`** in inline composer while outer UI is **dark**.

## Regression

**Workflow** (badge, auto-open) differs; **component** itself is **not** missing.

## Root cause

Integration choices (theme, no badge), not absence of reader.

## Reuse potential

**Already reused** in Electron.

## Change risk

**Low** for `theme` flip; **medium** if modal layout changes affect tests.

## Notes

Paging is **text-based**, not PDF page thumbnails.
