# Right rail: hints vs AI context

## Purpose
Clarifies what occupies the right side today: composer-internal “Hints” aside vs app-level third column vs HybridSearch chat bar.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — `<aside>` hints ~652–668
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — hints aside ~424–437
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` — third column conditional ~2396–2514 (hidden when composing)
- `apps/electron-vite-project/src/components/HybridSearch.tsx` — top bar; `contextDocs` state for uploaded text (Prompt 5)
- `apps/electron-vite-project/src/App.tsx` — `HybridSearch` in header (~211+)

## Ownership
- **Hints:** Static copy inside each composer; not data-driven.
- **AI context upload:** `HybridSearch` component state — **global to dashboard**, not scoped to composer.
- **Draft refine:** `useDraftRefineStore` + HybridSearch `handleSubmit`.

## Rendering path
Composers: `gridTemplateColumns: '1fr 280px'` — right **280px** is hints, not draggable AI context rail.

## Inputs and outputs
Hints: none (static).  
HybridSearch `contextDocs`: file picker → extracted text → appended to LLM `chatQuery` — **not** tied to BEAP attachment model.

## Dependencies
HybridSearch uses orchestrator HTTP for PDF extract (`CONTEXT_UPLOAD_HTTP_PORT`); text files via `file.text()`.

## Data flow
**Two parallel “context” concepts:**
1. **LLM prompt context** — `contextDocs` in HybridSearch (in-memory).
2. **Capsule attachments** — `BeapInlineComposer` local attachment state.

No shared store between them.

## UX impact
Product wants **right rail = AI context** with drag-drop — current right column is **static hints** inside composer + **separate** 📎 in top bar. **Feels fragmented** (context upload not beside the fields).

## Current issues
No drag-drop on composer rail; no PDF preview strip in composer.

## Old vs new comparison
Popup / sidepanel may have had tighter integration between builder and chat — **uncertainty** without full sidepanel trace.

## Reuse potential
Replace `<aside>` content with a **ContextRail** component fed by dedicated store; keep HybridSearch as engine or merge.

## Change risk
Moving context upload from HybridSearch to composer touches Prompt 5 behavior and keyboard UX.

## Notes
`gridCols` in `EmailInboxView` **removes** app third column when composing — so **no** inbox-level right rail during compose; only composer’s 280px aside.
