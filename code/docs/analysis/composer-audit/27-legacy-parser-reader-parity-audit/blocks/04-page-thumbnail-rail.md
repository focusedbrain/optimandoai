# Page thumbnail rail (BeapDocumentReaderModal)

## Purpose

Left column in **`BeapDocumentReaderModal`**: **page** buttons **P1…Pn** with **short text previews** — implements **navigation** for **synthetic** pages, **not** raster PDF thumbnails.

## Files

- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx` (sidebar ~203–244)
- `splitToSyntheticPages` in same file

## Rendering path

Child of modal flex row; buttons **`map`** over **`pages`** from **`splitToSyntheticPages(semanticContent)`**.

## State ownership

**Internal:** `currentPage` state; **`pages`** derived from **`semanticContent`** prop.

## Inputs and outputs

**Input:** Full **`semanticContent`** string from parent.

**Output:** UI navigation only; **click** sets **`currentPage`**.

## Dependencies

- `splitToSyntheticPages` (character/paragraph chunking, default 3000 chars)

## Data flow

Long string → array of page strings → each button shows **P{n}** + **42-char** text preview.

## Legacy behavior

Same as current — **no image pipeline** in this component.

## Current behavior

Identical when inline composer opens modal.

## Regression

If product expects **image thumbnails**, this component **never** provided them.

## Root cause

**Spec mismatch** between “thumbnail rail” language and **text-snippet** implementation.

## Reuse potential

N/A — already part of **`BeapDocumentReaderModal`**; **restore by opening modal**, not by new rail.

## Change risk

Low for **parity**; high if building **true** PDF render thumbnails.

## Notes

Active page styling uses **purple** accent (`rgba(139,92,246,…)`).
