# Page thumbnail navigation

## Purpose

Clarify what the legacy reader’s **left rail** actually shows versus “PDF page thumbnails.”

## Files

- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx` (lines ~203–244, ~311–332)

## What is rendered

### Left sidebar (72px wide)

- For each **synthetic page** from **`splitToSyntheticPages(semanticContent)`**:
  - A **button** labeled **`P{n}`** (page number).
  - A **text snippet** preview: first ~42 chars of that page’s text, whitespace-collapsed.
- Styling: `fontSize: 9`, active page uses **purple** border/background (`rgba(139,92,246,0.6)` / `rgba(139,92,246,0.15)`), inactive uses `mutedColor`.

### Not rendered

- **No** rasterized PDF page images.
- **No** OCR bitmap thumbnails.
- **No** true PDF page count from the PDF engine — page count = **synthetic chunk count** (default `charsPerPage = 3000` in `splitToSyntheticPages`).

## Footer controls

- **Page X of Y**, **Prev** / **Next**, **Search** / **Find**, **Copy page** / **Copy all**.
- Disclaimer text: *“Page boundaries are approximate when text was extracted as a single stream.”* (`BeapDocumentReaderModal.tsx` ~372–374)

## Data model

- Input is a **single string** `semanticContent`.
- Pagination is **algorithmic** (paragraph/chunk), not structural PDF pages.

## Legacy behavior

**Navigation rail = synthetic page index**, not image thumbnails. Product language “thumbnail rail” maps to this implementation **only if** “thumbnail” means **text preview chips**.

## Current behavior

Same component in inline composer — **no change** to rail semantics.

## Regression

If product expectation is **visual page thumbnails** (rendered PDF pages), that **was not implemented** in `BeapDocumentReaderModal` in the code reviewed.

## Root cause

**Spec mismatch**: legacy reader never depended on per-page images; it depends on **extracted text** + **splitToSyntheticPages**.

## Uncertainty

Whether an **older** capsule builder revision used a different reader component — not found in this audit; **`BeapDocumentReaderModal`** is the active shared reader in `beap-builder/components`.
