# Phase 3 implementation report — AI context store & composer rail

## Changed files

| File | Role |
|------|------|
| `apps/electron-vite-project/src/stores/useAiDraftContextStore.ts` | **New** — Zustand store for AI drafting context documents (`id`, `name`, `text`). |
| `apps/electron-vite-project/src/lib/ingestAiContextFiles.ts` | **New** — Shared PDF/text ingestion (same HTTP + `file.text()` behavior as former HybridSearch inline logic). |
| `apps/electron-vite-project/src/components/AiDraftContextRail.tsx` | **New** — Right-rail UI: list/remove/clear, add files, empty state, footer slot for composer hints. |
| `apps/electron-vite-project/src/components/HybridSearch.tsx` | Uses store instead of local `useState`; `handleSubmit` reads `useAiDraftContextStore.getState().documents`; chips use stable ids; 📎 tooltip clarifies AI-only. |
| `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` | Embeds `AiDraftContextRail` + footer copy separating **package attachments** vs AI context. |
| `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` | Same rail + footer copy separating **email attachments** vs AI context. |

## State ownership decisions

| Concern | Owner | Notes |
|--------|--------|--------|
| **AI drafting context** | `useAiDraftContextStore` | Single global singleton (same lifecycle as pre–Phase-3 `contextDocs` in HybridSearch: in-memory, survives navigation until cleared or app reload). |
| **Draft refine session** | `useDraftRefineStore` | Unchanged. |
| **BEAP send attachments** | `BeapInlineComposer` local `useState` | Unchanged — still builds `BeapPackageConfig` / `originalFiles` only from composer attachment UI. |
| **Email send attachments** | `EmailInlineComposer` local state | Unchanged. |
| **File ingestion implementation** | `ingestAiContextFiles()` | Stateless helper; appends to store via `addDocuments`. |

## How AI context and send attachments are separated

1. **Data model:** `useAiDraftContextStore.documents` holds `{ id, name, text }` for LLM prompt assembly only. It never feeds `executeDeliveryAction`, `sendEmail`, or attachment IPC for send.
2. **BEAP:** Composer “Add files…” / capsule attachments remain the only inputs to `capsuleAttachments` / `originalFiles` in `handleSend`. The rail explicitly states package attachments are separate from AI context.
3. **Email:** “+ Add files” in the main column still only populates `attachments` / path attachments for `sendEmail`. Footer text states main-column files are outgoing email attachments, not the AI rail list.
4. **HybridSearch / Prompt 5:** `handleSubmit` still injects context using the same `8000`-char-per-doc slices and the same `--- CONTEXT DOCUMENTS ---` / `Context:` prefixes, but reads documents from **`getState().documents`** at submit time so top bar and rail stay consistent.

## What was deferred

- **OCR** and **broad parser refactors** — out of scope (per Phase 3 instructions).
- **Auto-clearing** AI context when opening/closing compose — not implemented; behavior matches pre–Phase-3 global Prompt 5 semantics (context persists until user clears).
- **Drag-and-drop** onto the rail — not implemented (listing + add button + top bar only).
- **Config module** for port `51248` — still duplicated in `ingestAiContextFiles.ts` (same as previous HybridSearch constants).

## Risks

| Risk | Note |
|------|------|
| **Global context visibility** | Users may see documents added from Analysis/Handshakes views while composing — same as before when context lived in HybridSearch only. |
| **Large prompts** | Unchanged: many/large docs still inflate `chatQuery` (no token UI). |

## Manual QA checklist

- [ ] Top bar 📎 adds a PDF/text; document appears in **chips** and in **composer right rail** (inbox compose).
- [ ] Remove from rail removes from chips (same store); **Clear all** in rail clears chips.
- [ ] Remove from chip row removes from rail.
- [ ] **Draft refine** with context: instruction + context blocks still reach `chatWithContextRag` (spot-check response uses document facts).
- [ ] **Non–draft-refine chat** with message selected: `Context:` prefix still prepends when docs present.
- [ ] **BEAP send:** package attachments still send only files chosen via composer “Add files…” — not AI rail docs.
- [ ] **Email send:** attachments from main column only — not AI rail.
- [ ] **Bulk inbox** compose: rail + HybridSearch still share store (overlay composers include `AiDraftContextRail`).
- [ ] Empty rail shows **empty-state** copy; “Add reference files” uses same ingest path as top bar (PDF + text types).

---

*Aligned with `12`–`15`, `22`, and `24-phase1-2-implementation-report.md`.*
