# BeapInlineComposer root

## Purpose
Two-column grid (`1fr` + `280px`) containing scrollable form and static hints aside.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~366–378, ~380–650

## Ownership
`BeapInlineComposer` function component.

## Rendering path
Mounted from parents when `composeMode === 'beap'`.

## Inputs and outputs
Props: `onClose`, `onSent`, `replyToHandshakeId`.

## Dependencies
`useDraftRefineStore`, `executeDeliveryAction`, `listHandshakes`.

## Data flow
Local state drives `BeapPackageConfig`; aside is static text.

## UX impact
Hints consume 280px horizontal space that product may want for AI context.

## Current issues
Hints aside not interactive; no drag-drop.

## Old vs new comparison
Popup uses full window — no competing aside layout.

## Reuse potential
Swap `<aside>` for context rail component.

## Change risk
Medium — grid template changes affect all BEAP embeds.

## Notes
`height: '100%'`, `minHeight: 0` on scroll column (Prompt 6).
