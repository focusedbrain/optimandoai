# Layout shell and screen composition

## Purpose
Describes the CSS grid/flex structure around the composers and why the message list remains visible during compose.

## Files
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` (primary reference)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx`
- `apps/electron-vite-project/src/components/BeapInboxDashboard.tsx`
- `apps/electron-vite-project/src/components/BeapBulkInboxDashboard.tsx`
- `apps/electron-vite-project/src/App.tsx` (header + `HybridSearch` above main)

## Ownership
Parent grid is owned by each inbox component; `App.tsx` wraps `<main>` around the active view.

## Rendering path
**EmailInboxView** root (`~2224–2237`): `display: grid`, `gridTemplateColumns: gridCols` where  
`gridCols = composeMode || selectedMessageId ? '320px 1fr' : '320px 1fr 320px'` (`~2222`).

Structure:
1. **Column 1 (320px):** Toolbar + message list — **always rendered**; not hidden when `composeMode` is set (`~2277–2402`).
2. **Column 2:** When `composeMode === 'beap' | 'email'`, **only** the composer fills this column (`~2526–2542`). When not composing and a message is selected, split message + AI panel (`~2543+`).
3. **Column 3 (320px):** Shown only when `!selectedMessageId && !composeMode` — provider workspace + import zone (`~2396` region).

**EmailInboxBulkView:** Composer sits in an **absolute** `inset: 0` layer over the bulk grid when `composeMode` is set (`~5583–5625`), while the underlying list remains in the DOM beneath.

**BeapInboxDashboard:** Similar 3-column idea with `280px`; center shows composer or detail (`~518+`).

**BeapBulkInboxDashboard:** Full-size overlay for composers (`~291–323`).

## Inputs and outputs
Grid columns react to `composeMode`, `selectedMessageId`, and message presence.

## Dependencies
Inline styles; no shared `ComposerLayout` component.

## Data flow
Layout does not read global compose store — only local `composeMode`.

## UX impact
- **Reported issue (left list visible):** Root cause is **conditional rendering**: the left column is **never** unmounted or replaced when `composeMode` is true; only the center swaps to the composer. Composer effective width ≈ `1fr` of viewport minus **320px** list — feels cramped vs full-window popup.
- **Right column:** Third column **disappears** when composing or when a message is selected (`gridCols` collapses to two columns), so “Hints” rail in `BeapInlineComposer` is **inside** the composer’s own 2-column grid (`1fr` + `280px` aside), not the app-level third column.

## Current issues
- No “focus mode” that expands composer to full main area or hides list.
- Bulk view uses z-index overlay — better isolation than normal inbox, but still stacks over list UI.

## Old vs new comparison
- **Popup (`popup-chat.tsx`):** Dedicated window — full usable width for BEAP builder blocks.
- **EmailComposeOverlay:** Fixed centered modal (`maxWidth` in overlay) — focused chrome.

## Reuse potential
A shared layout wrapper could enforce “compose = hide list or full-width center.”

## Change risk
Changing `gridCols` or left-column visibility touches selection UX, keyboard shortcuts, and toolbar.

## Notes
`HybridSearch` lives in `App.tsx` header — always visible; composer does not own the top chat bar.
