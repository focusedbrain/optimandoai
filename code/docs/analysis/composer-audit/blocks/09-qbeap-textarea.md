# qBEAP textarea block

## Purpose
Optional encrypted body for private mode; draft-refine `capsule-encrypted`.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~598–625

## Ownership
`BeapInlineComposer`.

## Rendering path
Only if `recipientMode === 'private'`; `rows={5}`.

## Inputs and outputs
`encryptedMessage`; `handleFieldClick('encrypted')`.

## Dependencies
`useDraftRefineStore` target `capsule-encrypted`.

## Data flow
→ `encryptedMessage` on config when set.

## UX impact
Smaller default than pBEAP row count.

## Current issues
Same width constraints as public field.

## Old vs new comparison
Extension may show more encryption context.

## Reuse potential
Align row counts and styling with public field.

## Change risk
Tied to key validation on send.

## Notes
Violet-tinted background when not in refine focus.
