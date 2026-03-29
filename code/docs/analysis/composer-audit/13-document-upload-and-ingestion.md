# Document upload and ingestion (dashboard)

## Purpose
Traces user-uploaded **text for LLM context** in the chat bar (Prompt 5) vs **BEAP package attachments** vs **email attachments**.

## Files
- `apps/electron-vite-project/src/components/HybridSearch.tsx` — `contextDocs`, `handleContextUpload`, `uploadRef`, chips UI (~349, ~707+, ~952+, ~1086+)
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — package attachments (separate flow)
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — email File attachments

## Ownership
- **AI context (chat):** HybridSearch local state only — **not persisted**.
- **BEAP send attachments:** `BeapInlineComposer` local state.
- **Email send:** `EmailInlineComposer` File / path attachments.

## Rendering path
HybridSearch: hidden `<input type="file">` + 📎 button in `hs-bar`.  
Composers: attachment buttons inside form.

## Inputs and outputs
HybridSearch accepts `.pdf,.txt,.md,.csv,.json` — reads text or calls PDF API; stores `{ name, text }[]`.

## Dependencies
Fetch to `http://127.0.0.1:${PORT}/api/parser/pdf/extract` with JSON `{ base64, attachmentId: 'context-upload' }`.

## Data flow
Files → trimmed text slices (8000 chars per doc in prompt) → appended to `chatQuery` in `handleSubmit` — never sent as raw bytes to LLM.

## UX impact
Context upload is **top-of-screen**, not co-located with composer fields — product mismatch.

## Current issues
Conceptual **duplication risk:** users may attach PDFs to BEAP for sending vs upload to chat for AI — different pipelines.

## Old vs new comparison
Extension may use different upload flows — not unified with Electron HybridSearch in this audit.

## Reuse potential
A dedicated `AiContextStore` could feed HybridSearch and a future right rail.

## Change risk
Changing `attachmentId` or endpoint contract affects PDF extraction.

## Notes
See `14-pdf-parser-and-text-extraction.md` for server-side details.
