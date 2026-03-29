# AI draft generation flow

## Purpose
End-to-end path from user instruction in HybridSearch to refined draft text applied to composer fields.

## Files
- `apps/electron-vite-project/src/components/HybridSearch.tsx` — `handleSubmit`, `isDraftRefineSession`, `chatQuery` assembly, `draftRefineDeliverResponse`
- `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`
- `apps/electron-vite-project/electron/main.ts` — `ipcMain.handle('handshake:chatWithContextRag', …)` ~2998
- `apps/electron-vite-project/electron/preload.ts` — `chatWithContextRag` bridge ~543
- `apps/electron-vite-project/src/components/handshakeViewTypes.ts` — typing for `window.handshakeView.chatWithContextRag`

## Ownership
- **Session state:** Zustand `useDraftRefineStore`
- **LLM call:** HybridSearch only (not inside composers)

## Rendering path
User clicks field in `BeapInlineComposer` / `EmailInlineComposer` → `connect(...)` → HybridSearch forces chat mode → user types in top bar → `handleSubmit` builds `chatQuery` including draft text and optional `contextDocs`.

## Inputs and outputs
**Inputs:** `query`, `draftText` from store, `refineTarget`, `contextDocs`.  
**Outputs:** Streamed answer → `deliverResponse` → user clicks USE → `acceptRefinement` → `onResponse` updates textarea.

## Dependencies
Ollama/cloud via existing RAG handler — **not** modified per product prompts.

## Data flow
```
Field click → connect → draftText sync (useEffect in composer)
→ HybridSearch isDraftRefineSession true
→ chatWithContextRag({ query: chatQuery, scope, model, … })
→ answer → deliverResponse → history UI → accept → setPublicMessage / setBody / …
```

## UX impact
Premium feel depends on **HybridSearch** affordances (✏️ chip, placeholders) + **field** size — LLM path is sound; layout is not.

## Current issues
`contextDocs` + draft refine both alter `chatQuery` — large prompts possible; no token budget UI.

## Old vs new comparison
Inbox message draft refine shares same store — parity for AI mechanics.

## Reuse potential
Strong — keep store + HybridSearch; improve layout around them.

## Change risk
`isDraftRefineSession` logic is subtle (`messageId` null for compose) — regressions if refactored carelessly.

## Notes
See prior analysis docs in `docs/analysis-chat-ai-integration.md` for historical context.
