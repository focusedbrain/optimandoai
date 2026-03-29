# Parsed badge rendering

## Purpose

Document where the green **“Parsed”** label comes from and how status is computed.

## Files

- `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`
- Consumers: `popup-chat.tsx`, `sidepanel.tsx`, `CapsuleSection.tsx`

## Component

`AttachmentStatusBadge`:

- **`success`** → label **`Parsed`**, colors: `bg: 'rgba(34,197,94,0.12)'`, `color: '#16a34a'`, `border: 'rgba(34,197,94,0.35)'` (lines 14–17).
- **`pending`** → **`Extracting…`** (amber).
- **`failed`** → **`Failed`** (red).

**Note:** `theme` prop is declared on the interface but **not used** in the component body — only `status` affects rendering (`AttachmentStatusBadge.tsx` lines 20–35).

## Popup-chat derivation

From `popup-chat.tsx` (approximate lines 1371–1375):

- `isPdf` from mime/filename.
- `isParsing` = `a.processing?.parsing`
- `isSuccess` = `a.capsuleAttachment?.semanticExtracted`
- `showPdfBadge` = PDF && (parsing || success || error)
- `parseStatus` = parsing ? `pending` : success ? `success` : `failed`

So the green **Parsed** badge appears when **`semanticExtracted`** is true for a PDF row (and badge row is shown).

## Inline BeapInlineComposer

**Does not import or render `AttachmentStatusBadge`.** No equivalent green badge in attachment list.

## Legacy behavior

Badge reflects **`CapsuleAttachment.semanticExtracted`** + **`processing.parsing`**.

## Current behavior

No badge; optional **View text** button when `previewText` is set.

## Regression

**Missing UI component wiring**, not necessarily missing HTTP extract.

## Root cause

Inline composer never integrated **`AttachmentStatusBadge`** + **`CapsuleAttachment`** parse flags for rows.
