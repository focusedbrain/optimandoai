# Entry points and routing

## Purpose
Maps how the user reaches the embedded BEAP and Email composers in the Electron dashboard: app shell, active view, bulk toggle, and local `composeMode` state.

## Files
- `apps/electron-vite-project/src/App.tsx`
- `apps/electron-vite-project/src/components/EmailInboxView.tsx`
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx`
- `apps/electron-vite-project/src/components/BeapInboxDashboard.tsx` (present in repo; **not** mounted from `App.tsx` for the default Inbox tab)
- `apps/electron-vite-project/src/components/BeapBulkInboxDashboard.tsx` (same)

## Ownership
- **Route-level:** `App.tsx` owns `activeView` (`'analysis' | 'handshakes' | 'beap-inbox' | 'settings'`) and `inboxBulkMode` (checkbox on Inbox nav).
- **Composer mode:** Each inbox surface owns local `composeMode: 'beap' | 'email' | null` — not a global store.

## Rendering path
1. User selects **Inbox** → `activeView === 'beap-inbox'`.
2. If `inboxBulkMode` → `EmailInboxBulkView`; else → `EmailInboxView`.
3. Floating buttons (or equivalent) call `setComposeMode('beap' | 'email')` after debounced `handleComposeClick`.
4. Center column conditionally renders `BeapInlineComposer` or `EmailInlineComposer` when `composeMode` matches.

**Evidence:** `App.tsx` ~215–271; `EmailInboxView.tsx` `composeMode` ~1719, grid `gridCols` ~2222, composer branch ~2526–2542.

## Inputs and outputs
- **Inputs:** `accounts`, `selectedMessageId`, callbacks from `App` (`onSelectMessage`, `onNavigateToHandshake`).
- **Outputs:** Composers receive `onClose`, `onSent`, optional `replyTo` / `replyToHandshakeId`.

## Dependencies
- No dedicated route library — single-page dashboard with conditional children.

## Data flow
`composeMode` is React `useState` in the parent; clearing selection (`selectMessage(null)`) often runs when opening compose (see `handleOpenBeapDraft` / `handleOpenEmailCompose` in `EmailInboxView.tsx`).

## UX impact
Primary user path for **unified inbox** is `EmailInboxView` / `EmailInboxBulkView`.

**`BeapInboxDashboard.tsx` / `BeapBulkInboxDashboard.tsx`:** Repository-wide TS/TSX grep (March 2026) shows **no import** of `BeapInboxDashboard` from any consumer other than its own file — it appears **unused** in the current Electron renderer tree. IPC and docs still reference “BeapInboxDashboard” notifiers in `main.ts`. Treat embedded composers there as **latent / alternate** implementations unless a hidden import path exists.

## Current issues
- **Dual shells:** BEAP-specific dashboards exist alongside mail-centric inbox; product may expect one mental model while code has two.

## Old vs new comparison
- **Old:** Extension popup (`popup-chat.tsx`) and/or modal `EmailComposeOverlay` for email; IPC `openBeapDraft` for separate window.
- **New:** Inline panels inside inbox grid or full overlay in bulk BEAP dashboard.

## Reuse potential
`composeMode` pattern is reusable; centralizing in a store would be a future refactor (not in scope).

## Change risk
Altering `App.tsx` branching affects all inbox users.

## Notes
`vite-env.d.ts` still exposes `analysisDashboard.openBeapDraft` for extension-only flows — dashboard paths prefer `setComposeMode`.
