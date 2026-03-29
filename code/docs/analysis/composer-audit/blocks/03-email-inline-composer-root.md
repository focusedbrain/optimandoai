# EmailInlineComposer root

## Purpose
Two-column grid parallel to BEAP: form + hints aside for plain email.

## Files
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` ~186–230

## Ownership
`EmailInlineComposer` component.

## Rendering path
`composeMode === 'email'` in inbox parents.

## Inputs and outputs
`replyTo` prefill; `onSent`/`onClose`.

## Dependencies
`EMAIL_SIGNATURE` from `EmailComposeOverlay.tsx`; `useDraftRefineStore` for body.

## Data flow
`body` + signature on send; draft refine syncs `updateDraftText(body)`.

## UX impact
Same width constraints as BEAP; professional modal theme from overlay **not** applied.

## Current issues
Hints aside duplicates static copy.

## Old vs new comparison
`EmailComposeOverlay` used modal + optional light theme.

## Reuse potential
Share layout shell with BEAP.

## Change risk
Low — isolated send path.

## Notes
Default export + named export both exist.
