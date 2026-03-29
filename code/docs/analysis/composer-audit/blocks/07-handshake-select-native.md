# Handshake native `<select>` block

## Purpose
Dropdown for private-mode handshake selection in `BeapInlineComposer`.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~458–532

## Ownership
`BeapInlineComposer`.

## Rendering path
Conditional on `recipientMode === 'private'`.

## Inputs and outputs
Options from `handshakeRows`; value `selectedHandshakeId`.

## Dependencies
`listHandshakes`, `labelForHandshakeRow`.

## Data flow
Selection → `selectedRecipient` memo → send config.

## UX impact
Native OS select — minimal branding.

## Current issues
Product calls out weak visual design.

## Old vs new comparison
vs `RecipientHandshakeSelect` in extension.

## Reuse potential
Replace with extension component.

## Change risk
Medium — accessibility and keyboard behavior.

## Notes
See `07-handshake-selector.md` (parent doc).
