# Composer audit — index

Consolidated documentation for the embedded **BEAP** (`BeapInlineComposer`) and **Email** (`EmailInlineComposer`) composers in the Electron dashboard, plus AI context, layout, and legacy builder references. **No product code was changed** to produce this audit.

## Main series

| File | Summary |
|------|---------|
| [00-index.md](./00-index.md) | This file — catalog of all deliverables. |
| [01-entrypoints-and-routing.md](./01-entrypoints-and-routing.md) | App shell, Inbox view vs bulk, `composeMode`, where composers mount. |
| [02-layout-shell-and-screen-composition.md](./02-layout-shell-and-screen-composition.md) | Grid columns, why the message list stays visible, third column behavior. |
| [03-new-beap-composer-overview.md](./03-new-beap-composer-overview.md) | `BeapInlineComposer` responsibilities, deps, orchestrator HTTP, send path. |
| [04-new-email-composer-overview.md](./04-new-email-composer-overview.md) | `EmailInlineComposer`, parity notes vs `EmailComposeOverlay`. |
| [05-old-builder-reference.md](./05-old-builder-reference.md) | Popup-chat, overlay, IPC — candidate legacy surfaces. |
| [06-parity-old-vs-new.md](./06-parity-old-vs-new.md) | Capability matrix old vs new. |
| [07-handshake-selector.md](./07-handshake-selector.md) | Native select + `listHandshakes` mapping vs extension. |
| [08-public-pbeap-field.md](./08-public-pbeap-field.md) | Public textarea, rows, draft refine, `data-compose-field`. |
| [09-private-qbeap-field.md](./09-private-qbeap-field.md) | Encrypted field, private mode, refine target. |
| [10-subject-session-attachments.md](./10-subject-session-attachments.md) | Subject, orchestrator session, BEAP package attachments. |
| [11-left-column-list-coupling.md](./11-left-column-list-coupling.md) | Code-level reason list remains during compose. |
| [12-right-rail-hints-and-ai-context.md](./12-right-rail-hints-and-ai-context.md) | Hints aside vs HybridSearch `contextDocs` vs app columns. |
| [13-document-upload-and-ingestion.md](./13-document-upload-and-ingestion.md) | Context docs (LLM) vs attachment pipelines. |
| [14-pdf-parser-and-text-extraction.md](./14-pdf-parser-and-text-extraction.md) | `/api/parser/pdf/extract`, pdf.js, OCR gap. |
| [15-ai-draft-generation-flow.md](./15-ai-draft-generation-flow.md) | `useDraftRefineStore` → `chatWithContextRag` → accept. |
| [16-send-flow-validation-and-errors.md](./16-send-flow-validation-and-errors.md) | Validation and error UI for send. |
| [17-design-system-styling-and-spacing.md](./17-design-system-styling-and-spacing.md) | Inline styles, tokens, premium gap. |
| [18-state-management-and-data-flow.md](./18-state-management-and-data-flow.md) | Local vs Zustand vs HybridSearch ephemeral state. |
| [19-api-contracts-and-server-dependencies.md](./19-api-contracts-and-server-dependencies.md) | IPC, HTTP ports, bridges. |
| [20-regression-map.md](./20-regression-map.md) | Product issues → code causes, severity, fix areas. |
| [21-open-questions-and-risk-register.md](./21-open-questions-and-risk-register.md) | Uncertainties and risks. |
| [22-recommended-target-architecture.md](./22-recommended-target-architecture.md) | Structural target: full-width compose, context rail, separation. |

## Per-block deep dives (`blocks/`)

| File | Summary |
|------|---------|
| [blocks/01-email-inbox-view-grid-shell.md](./blocks/01-email-inbox-view-grid-shell.md) | `EmailInboxView` grid and `gridCols` coupling. |
| [blocks/02-beap-inline-composer-root.md](./blocks/02-beap-inline-composer-root.md) | BEAP composer two-column shell. |
| [blocks/03-email-inline-composer-root.md](./blocks/03-email-inline-composer-root.md) | Email composer two-column shell. |
| [blocks/04-hybrid-search-chat-bar.md](./blocks/04-hybrid-search-chat-bar.md) | Top bar, `contextDocs`, draft refine integration. |
| [blocks/05-use-draft-refine-store.md](./blocks/05-use-draft-refine-store.md) | Zustand store for field ↔ chat refinement. |
| [blocks/06-extension-popup-chat-legacy-builder.md](./blocks/06-extension-popup-chat-legacy-builder.md) | Extension `popup-chat.tsx` as rich legacy reference. |
| [blocks/07-handshake-select-native.md](./blocks/07-handshake-select-native.md) | Native handshake dropdown block. |
| [blocks/08-pbeap-textarea.md](./blocks/08-pbeap-textarea.md) | Public pBEAP textarea block. |
| [blocks/09-qbeap-textarea.md](./blocks/09-qbeap-textarea.md) | Private qBEAP textarea block. |
| [blocks/10-composer-hints-aside.md](./blocks/10-composer-hints-aside.md) | Static right-column hints aside. |

## Executive summary

- **Entry:** Inbox tab (`App.tsx` → `EmailInboxView` or `EmailInboxBulkView`) uses local `composeMode` to show `BeapInlineComposer` / `EmailInlineComposer`. **`BeapInboxDashboard.tsx` and `BeapBulkInboxDashboard.tsx`** have **no** importing parent in `apps/electron-vite-project/src` (only self-reference) — **likely dead** in current UI; composers inside them are not exercised unless another entry point exists outside this tree.
- **Layout regression:** `EmailInboxView` keeps the **320px message list** mounted while composing; composer only receives the center `1fr` column — primary cause of cramped, non-premium feel.
- **Old vs new:** Extension **`popup-chat.tsx`** provides the feature-rich BEAP builder; Electron **`BeapInlineComposer`** uses plain controls and smaller textareas (`rows` 6/5). **`EmailComposeOverlay`** remains in repo as reference for modal/light theme email UX; dashboard uses **`EmailInlineComposer`**.
- **AI context:** **`HybridSearch`** holds in-memory **`contextDocs`** (Prompt 5) for LLM prompts; **BEAP attachments** in the composer are a **separate** send pipeline — risk of user confusion until UI separates “package attachment” vs “AI-only context.”
- **PDF text:** Main process **`POST /api/parser/pdf/extract`** uses **pdf.js** text extraction without OCR; layout/scanned PDFs may explain “incorrect” extraction reports.

**Start here:** [20-regression-map.md](./20-regression-map.md) for issue-to-code mapping, then [22-recommended-target-architecture.md](./22-recommended-target-architecture.md) for structural direction.
