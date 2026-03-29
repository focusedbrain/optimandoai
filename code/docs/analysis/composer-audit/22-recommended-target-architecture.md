# Recommended target architecture (structural only)

## Purpose
Future-state shape for full-width compose, hidden list, AI context rail, and attachment separation — **no implementation code**.

## Files
N/A (vision doc).

## Ownership
Proposed: inbox shell owns **layout mode** (`'browse' | 'compose-beap' | 'compose-email'`) instead of boolean `composeMode` only.

## Rendering path (target)
```text
App header [HybridSearch — optional scope when composing]

Main:
  browse:   [ Message list | Detail / empty + third rail ]
  compose:  [ Composer primary (span full main width) | AI context rail narrow ]
```
**Left list hidden** in compose modes — composer gains horizontal space.

## Inputs and outputs
- **AI context rail:** Dedicated store `aiContextDocuments[]` (name TBD) feeding HybridSearch LLM prompts **and** UI preview; **not** `BeapPackageConfig.attachments`.
- **Send attachments:** Remain in composer form state; clear labeling “Included in package.”

## Dependencies
- Reuse `useDraftRefineStore` + HybridSearch engine; optionally **lift** `contextDocs` from HybridSearch into shared store so rail and bar stay in sync.
- Extension components (handshake select, delivery panel) imported as **presentation** layer.

## Data flow
```
User drops PDF on rail → extract text → aiContextStore → HybridSearch chatQuery
User adds package file → composer attachment state → executeDeliveryAction only
```

## UX impact
Addresses: premium width, context placement, conceptual separation.

## Current issues
N/A — forward looking.

## Old vs new comparison
Preserves **old builder strengths** by **embedding extension-grade components** in the primary column, not by reopening popup as default.

## Reuse potential
Maximum reuse of `@ext/beap-messages` UI where Electron bundling allows.

## Change risk
**Phased delivery:** (1) layout hide list, (2) resize fields, (3) rail + store, (4) parser hardening.

## Notes
Align with `20-regression-map.md` priorities; validate each phase with QA checklist.
