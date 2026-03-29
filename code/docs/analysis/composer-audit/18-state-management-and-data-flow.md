# State management and data flow

## Purpose
Maps local vs global state for compose and AI features.

## Files
- `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` (list, selection — not form)
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx`
- `apps/electron-vite-project/src/components/HybridSearch.tsx` — `contextDocs`, chat UI state

## Ownership
- **Composers:** `useState` only for form data — **no** Redux/Zustand form store.
- **Draft refine:** Zustand singleton `useDraftRefineStore` — global; one active session.
- **Inbox:** Zustand `useEmailInboxStore` for messages; selection cleared when opening compose (handlers in parents).

## Rendering path
Parent `composeMode` gates visibility; children unmount on close → local state lost (**no draft persistence** across close).

## Inputs and outputs
`useDraftRefineStore.connect` / `disconnect` / `updateDraftText` bridge fields to HybridSearch.

## Dependencies
Zustand 4.x pattern; `useShallow` not used in composers.

## Data flow
```
composeMode (parent) → mount composer → local state
Field click → connect(messageId|null, …) → HybridSearch reads store
HybridSearch submit → chatWithContextRag → deliverResponse → acceptRefinement → callback → local state
```

## UX impact
Closing composer **drops** unsent work — same as typical modal unless we add persistence.

## Current issues
Global draft refine store shared with **inbox message** refine — race if user opens compose while inbox refine active (mitigated by UX flows — **uncertainty** on edge cases).

## Old vs new comparison
Popup likely held more state in UI store — **uncertainty**.

## Reuse potential
Optional `useComposerDraftStore` for autosave — future.

## Change risk
Singleton store changes affect `EmailInboxView`, `EmailInboxBulkView`, `HybridSearch`, `EmailInboxView` AI panel.

## Notes
`contextDocs` in HybridSearch is **not** in Zustand — ephemeral until page reload.
