# Left-column list coupling

## Purpose
Documents why the inbox message list remains visible during compose and which code paths keep it mounted.

## Files
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` — left column ~2277–2402; **no** `composeMode` guard wrapping this block
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` — overlay composer ~5583+; list in scroll region **under** overlay (still mounted)

## Ownership
**By design** in current implementation: left column is unconditional sibling of center content in `EmailInboxView`.

## Rendering path
```text
grid [ list | center+optionalRight ]
```
When `composeMode` set: `gridCols` = `'320px 1fr'` — list **still first column**; center shows composer only.

## Inputs and outputs
List continues to receive `messages`, `selectedMessageId`, toolbar filters — independent of compose.

## Dependencies
`EmailInboxToolbar`, `InboxMessageRow`, store `useEmailInboxStore`.

## Data flow
Opening compose often clears message selection (`handleOpenBeapDraft` calls `selectMessage(null)`) — list shows unselected rows but **remains visible**.

## UX impact
**Primary regression:** composer shares horizontal space with 320px list → reduced width for form. **Product expectation:** list should hide or composer should use full main — requires layout branch.

## Current issues
No `if (composeMode) return <FullWidthComposer />` pattern at `EmailInboxView` level.

## Old vs new comparison
Modal overlay (`EmailComposeOverlay`) **obscured** the list; inline does not.

## Reuse potential
Conditional rendering or CSS grid area spanning could fix without new routes.

## Change risk
Keyboard shortcuts in `EmailInboxBulkView` already guard `composeMode` (~4142) — layout change must keep those consistent.

## Notes
`BeapBulkInboxDashboard` uses full overlay — closer to desired “focus” UX for that surface only.
