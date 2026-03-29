# useDraftRefineStore (Zustand)

## Purpose
Global bridge between focused textarea (composer or inbox) and HybridSearch LLM draft refinement.

## Files
- `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`
- Consumers: `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx`, `HybridSearch.tsx`, `EmailInboxView.tsx` (AI panel paths)

## Ownership
Zustand singleton store.

## Rendering path
N/A — state only.

## Inputs and outputs
`connect`, `disconnect`, `updateDraftText`, `deliverResponse`, `acceptRefinement`.

## Dependencies
Zustand `create`.

## Data flow
See `18-state-management-and-data-flow.md`.

## UX impact
Enables ✏️ draft mode in top bar when field connected.

## Current issues
Global singleton — one active session per app.

## Old vs new comparison
New store for Prompt 4 — not in old popup.

## Reuse potential
Central to future AI rail — keep API stable.

## Change risk
High — many consumers.

## Notes
`DraftRefineTarget`: `'email' | 'capsule-public' | 'capsule-encrypted'`.
