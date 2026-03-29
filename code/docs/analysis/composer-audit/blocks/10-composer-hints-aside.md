# Composer hints aside (static)

## Purpose
Right column in BEAP/Email inline composers with static help text.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — `<aside>` ~652+
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — `<aside>` ~424+

## Ownership
Respective composer.

## Rendering path
Second grid column `280px`.

## Inputs and outputs
None — static JSX copy.

## Dependencies
None.

## Data flow
None.

## UX impact
Occupies space product wants for **AI context rail**; currently no drag-drop or document list.

## Current issues
Misaligned with product vision for contextual AI.

## Old vs new comparison
Modal overlay used footer/sidebar patterns differently.

## Reuse potential
Replace content wholesale with `AiContextRail` shell.

## Change risk
Low — copy-only today.

## Notes
Prompt 6 updated hint text for BEAP (click fields for refine).
