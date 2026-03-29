# EmailInboxView grid shell

## Purpose
Dashboard grid wrapper for normal inbox: left list, center workspace, optional right column; controls composer width.

## Files
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` ~2222–2542

## Ownership
`EmailInboxView` component.

## Rendering path
Root `div` CSS grid; children: left panel, then conditional center/right.

## Inputs and outputs
**Props:** `accounts`, `selectedMessageId`, callbacks. **State:** `composeMode`, `composeReplyTo`.

## Dependencies
`EmailInboxToolbar`, `InboxMessageRow`, `HybridSearch` (in App, not here).

## Data flow
`composeMode` switches center between composers and detail workspace.

## UX impact
**Primary regression driver:** list stays visible; composer only gets `1fr` center.

## Current issues
No compose-only layout branch.

## Old vs new comparison
Overlay path removed — list was obscured before.

## Reuse potential
Extract `InboxLayout` with mode prop.

## Change risk
High — touches all inbox navigation.

## Notes
`gridCols` formula at ~2222.
