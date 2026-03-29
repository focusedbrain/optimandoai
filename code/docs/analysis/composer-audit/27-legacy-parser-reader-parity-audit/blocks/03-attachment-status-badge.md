# AttachmentStatusBadge

## Purpose

Small pill: **Extracting…** (amber), **Parsed** (green), **Failed** (red) for attachment parse status.

## Files

- `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`

## Rendering path

Inline `<span>`; used in **`popup-chat.tsx`**, **`sidepanel.tsx`**, **`CapsuleSection.tsx`** next to attachment rows.

## State ownership

**Parent** computes `AttachmentParseStatus` from **`processing`** + **`semanticExtracted`**.

## Inputs and outputs

**Props:** `status: 'pending' | 'success' | 'failed'`, optional `theme` (**theme is declared but unused** in component body as of audited file).

## Dependencies

None (pure presentational).

## Data flow

Status enum → `CONFIGS[status]` → inline styles for label/colors.

## Legacy behavior

Green **Parsed** maps to **`success`** → label **`Parsed`**, green text **`#16a34a`**.

## Current behavior

**Not referenced** in **`BeapInlineComposer.tsx`**.

## Regression

Inline attachment rows lack **parse status** affordance.

## Root cause

Inline composer never integrated badge when preview helper was added.

## Reuse potential

**Direct import** from `@ext/beap-builder/components` in Electron.

## Change risk

Low — purely visual; must align status derivation with async parse.

## Notes

Product copy “Text ready” in file header comment **does not match** actual **`pending`** label **`Extracting…`** — comment may be stale.
