# Regression map

## Purpose
Maps reported product issues to code-level causes with severity and confidence.

| # | Reported issue | Root cause (code) | Affected files | Severity | Confidence | Likely fix area |
|---|----------------|-------------------|----------------|----------|------------|-----------------|
| 1 | Not premium feel | Inline styles; native controls; no modal framing; cramped grid | `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx`, `EmailInboxView.tsx` grid | High | High | Layout shell + shared components from extension |
| 2 | pBEAP/qBEAP boxes too small | `rows={6}`/`{5}`; center column `1fr` with 320px list; no `minHeight` | `BeapInlineComposer.tsx` ~576–607; `EmailInboxView.tsx` `gridCols` | High | High | Increase rows/minHeight; full-width compose mode |
| 3 | Handshake select looks cheap | Plain `<select>` vs extension `RecipientHandshakeSelect` | `BeapInlineComposer.tsx` ~471–530 | Med | High | Import extension component or restyle |
| 4 | PDF parser wrong text | pdf.js text extraction concatenation; no OCR; layout PDFs | `main.ts` ~8204–8218; HybridSearch upload | Med | Med | Parser improvements + OCR path; user education |
| 5 | Old builder L&F lost | Electron inline does not import popup-chat UI stack | `popup-chat.tsx` vs `BeapInlineComposer.tsx` | High | High | Component reuse / design pass |
| 6 | Left list visible while composing | Left column always rendered; `gridCols` only 2 cols, list not hidden | `EmailInboxView.tsx` ~2277–2402, ~2222 | High | High | Conditional hide list or span columns |
| 7 | Right rail wrong use | Composer `aside` = static hints; AI context in HybridSearch bar | `BeapInlineComposer.tsx` ~652+; `HybridSearch.tsx` | Med | High | Replace aside with context rail; relocate `contextDocs` |
| 8 | AI context vs attachments confusion | Two pipelines: `contextDocs` (LLM) vs attachment state (send) | `HybridSearch.tsx`, `BeapInlineComposer.tsx` | Med | Med | Separate UI + naming; optional shared store |
| 9 | context-upload attachmentId hack | API requires `attachmentId`; sentinel `'context-upload'` | `HybridSearch.tsx` constants | Low | High | API allow optional id or dedicated route |

## Purpose (section)
Evidence-based mapping for planning; not implementation.

## Files
This document + all cross-referenced paths above.

## Ownership
N/A.

## Rendering path
N/A.

## Inputs and outputs
N/A.

## Dependencies
N/A.

## Data flow
N/A.

## UX impact
Table above.

## Current issues
See table.

## Old vs new comparison
Integrated in rows 5 and 7.

## Reuse potential
N/A.

## Change risk
Fixes may interact — e.g. full-width layout + HybridSearch position.

## Notes
Severity: **High** = blocks product goals; **Med** = noticeable; **Low** = technical debt.
