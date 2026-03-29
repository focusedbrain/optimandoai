# HybridSearch (chat bar + context upload)

## Purpose
Top dashboard bar: chat/search/actions modes, model picker, draft refine session, **📎 context document upload** (Prompt 5), LLM submit.

## Files
- `apps/electron-vite-project/src/components/HybridSearch.tsx`
- `apps/electron-vite-project/src/App.tsx` (placement)

## Ownership
`HybridSearch` component; `contextDocs` local React state.

## Rendering path
Rendered in `App.tsx` header for all `activeView` values.

## Inputs and outputs
Props: `activeView`, `selectedMessageId`, `selectedHandshakeId`, etc.  
**Outputs:** IPC `chatWithContextRag`; updates `useDraftRefineStore` on answer.

## Dependencies
`useDraftRefineStore`, `useEmailInboxStore` (subFocus), `window.handshakeView`.

## Data flow
See `15-ai-draft-generation-flow.md` and `13-document-upload-and-ingestion.md`.

## UX impact
AI context upload **not** beside composer fields — top bar only.

## Current issues
Context chips below bar — separate from composer visual group.

## Old vs new comparison
N/A for popup; extension has its own search/command UI.

## Reuse potential
Keep as engine; optionally **lift state** for rail UI.

## Change risk
High — shared by inbox, analysis, handshakes contexts.

## Notes
`isDraftRefineSession` logic for compose-with-null `messageId`.
