# pBEAP textarea block

## Purpose
Required public message textarea with draft-refine click wiring.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~575–596

## Ownership
`BeapInlineComposer`.

## Rendering path
Stacked after subject; `rows={6}`.

## Inputs and outputs
`publicMessage` state; `handleFieldClick('public')`.

## Dependencies
`useDraftRefineStore` target `capsule-public`.

## Data flow
→ `messageBody` in package config.

## UX impact
Default height modest; width limited by grid.

## Current issues
Small feel — product feedback.

## Old vs new comparison
Popup likely larger editor region.

## Reuse potential
Keep `data-compose-field` for tests.

## Change risk
Low for pure CSS.

## Notes
Purple outline when refine active (`#7c3aed`).
