# AttachmentStatusBadge

## Purpose

Shows attachment **parse status** as a **pill**: **Extracting…** (amber), **Parsed** (green), **Failed** (red).

## Files

- `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`

## Rendering path

Used in **`popup-chat.tsx`**, **`sidepanel.tsx`**, **`CapsuleSection.tsx`** next to attachment rows when PDF / badge visibility rules apply.

## State ownership

Parent attachment row holds `parseStatus: AttachmentParseStatus`.

## Inputs and outputs

- **Props:** `status`, optional `theme` (unused in implementation).
- **Output:** Visual only.

## Dependencies

None (pure presentational).

## Data flow

`runDraftAttachmentParseWithFallback` (or equivalent) updates `parseStatus` → badge re-renders.

## Legacy behavior

Green **Parsed** label from `CONFIGS.success`.

## Current behavior

**`BeapInlineComposer`** does **not** import or render this component.

## Regression

No **at-a-glance** parse state; user sees **View text** or error string only.

## Root cause

Inline attachment model uses `previewText` / `previewError` without **badge** layer.

## Reuse potential

**Direct** import from `@ext/beap-builder` in Electron (same as `BeapDocumentReaderModal`).

## Change risk

**Low** once `parseStatus` is derived during async extract.

## Notes

`theme` prop is **dead** — future fix could branch colors for dark/light.
