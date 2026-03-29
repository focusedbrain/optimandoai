# Executive Summary

**Audience:** Product owner, lead engineer, UI engineer, backend engineer.  
**Basis:** Synthesis of `docs/analysis/composer-audit/` (main series `00`–`22`, `blocks/01`–`10`, and `FULL-AUDIT.md`). **No product code was modified** for the underlying audit.  
**Purpose:** Single decision document for prioritizing layout, UX parity, parser, and AI-context work.

---

## 1. Current implementation in plain language

The Electron **dashboard** is a single-page app: `App.tsx` picks the active view (`analysis`, `handshakes`, `beap-inbox`, `settings`) and, for Inbox, whether the user sees **normal** or **bulk** inbox (`EmailInboxView` vs `EmailInboxBulkView`). There is **no** dedicated router; children swap by condition.

**Composer embedding:** “Compose” is **not** a global route. Each inbox surface keeps local React state `composeMode: 'beap' | 'email' | null`. When the user opens BEAP or Email compose, the parent renders **`BeapInlineComposer`** or **`EmailInlineComposer`** in the **center** of that surface’s layout. `App.tsx` always shows **`HybridSearch`** in the header for chat/search and **Prompt 5** context-document upload.

**BEAP (`BeapInlineComposer`):** A self-contained form: delivery method, recipient mode, handshake list (when private), subject, public pBEAP body, optional encrypted qBEAP body, orchestrator session picker, and **package** file attachments. Send goes through **`executeDeliveryAction`** from `@ext/beap-messages`. Handshakes load via `listHandshakes` (`handshakeRpc` shim). Sessions are fetched over **HTTP** to a hardcoded orchestrator base (`127.0.0.1:51248` per audit). Crypto/init paths match the shared BEAP stack.

**Email (`EmailInlineComposer`):** Plain email: To, Subject, Body, attachments, send via **`window.emailAccounts.sendEmail`**. Shares the same **two-column** shell idea as BEAP (form + right aside).

**AI draft refinement:** Clicking a composer field calls **`useDraftRefineStore.connect`**, which ties that field to **`HybridSearch`**. The user types the refinement **instruction in the top bar**; the app calls **`chatWithContextRag`** (IPC) and, on accept, writes back into the composer field. **LLM “context documents”** (uploaded PDF/text for chat) live in **`HybridSearch`’s `contextDocs` state**, not in the composer form store.

**Out of default path:** `BeapInboxDashboard` / `BeapBulkInboxDashboard` exist but audit grep found **no** renderer import of `BeapInboxDashboard` from other components—treat as **likely unused** alternate shells; IPC names may still reference them (`01-entrypoints-and-routing.md`, `21-open-questions-and-risk-register.md`).

---

## 2. What changed from the old builder

| Dimension | Old (reference surfaces) | New (embedded) |
|-----------|-------------------------|----------------|
| **Surface** | Extension **`popup-chat.tsx`** (large BEAP builder: themed controls, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, document reader, attachment parsing helpers); optional **modal** **`EmailComposeOverlay`** for email; IPC-opened drafts / separate window flows. | **Inline** composers inside **inbox grid** (`EmailInboxView`) or **overlay layer** (`EmailInboxBulkView`); dashboard chrome, not a dedicated popup window for the default path. |
| **Layout** | Popup = full usable width of the window; overlay = centered modal with defined `maxWidth`. | Composer sits in **grid column `1fr`** next to a **fixed-width message list** (320px) in normal inbox; third app column **hidden** when composing or when a message is selected (`02-layout-shell-and-screen-composition.md`). |
| **Handshake / delivery UI** | Rich extension components (`RecipientHandshakeSelect`, `DeliveryMethodPanel`, etc.). | **Native `<select>`** and minimal panels in `BeapInlineComposer` (`06-parity-old-vs-new.md`, `07-handshake-selector.md`). |
| **AI context** | Integrated search/command UX in extension (not identical to Electron). | **`HybridSearch`** bar at top: **`contextDocs`** for LLM; **separate** from BEAP **package** attachments (`12-right-rail-hints-and-ai-context.md`, `13-document-upload-and-ingestion.md`). |
| **State** | Extension UI stores (popup). | Composer form = **local `useState`** only; **no** persisted draft on close; draft refine = **global Zustand** singleton (`18-state-management-and-data-flow.md`). |

**Net:** Send **pipelines** can still converge on the same services (`executeDeliveryAction`, email IPC), but **presentation, layout, and where AI context lives** differ materially from the legacy “premium” surfaces (`05-old-builder-reference.md`, `06-parity-old-vs-new.md`).

---

## 3. Confirmed regressions

Issues below are **supported by the audit’s code-level notes** (primarily `20-regression-map.md` and cross-file evidence). Confidence is **audit confidence**, not statistical.

| Symptom | Root cause (code-level) | Affected files / modules | Confidence |
|--------|-------------------------|---------------------------|------------|
| **Non-premium look and feel** | Heavy **inline styles**; **native** controls; **no** modal framing; cramped **grid** next to list; different tier than extension-themed builder. | `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx`, `EmailInboxView.tsx` grid; contrast `popup-chat.tsx` (`20-regression-map` #1, `17-design-system-styling-and-spacing.md`) | **High** |
| **Reduced usable composer width** | Center column is **`1fr`** while **320px** message list **stays mounted**; composer never gets full main width in normal inbox. | `EmailInboxView.tsx` `gridCols` ~2222, left column ~2277–2402 (`11-left-column-list-coupling.md`, `20-regression-map` #6) | **High** |
| **Small pBEAP / qBEAP fields** | **`rows={6}`** / **`rows={5}`**; **no** strong `minHeight`; **same** narrow column as above. | `BeapInlineComposer.tsx` ~576–607 (`08-public-pbeap-field.md`, `09-private-qbeap-field.md`, `20-regression-map` #2) | **High** |
| **Weak handshake selector (styling/structure)** | **Plain `<select>`** vs extension **`RecipientHandshakeSelect`**; minimal chrome. | `BeapInlineComposer.tsx` ~471–530 (`07-handshake-selector.md`, `20-regression-map` #3) | **High** |
| **Left message list consuming composer space** | Left column **not** gated on `composeMode`; `gridCols` becomes two columns but **list remains first column**. | `EmailInboxView.tsx` (`11-left-column-list-coupling.md`, `20-regression-map` #6) | **High** |
| **Right-side hints panel underused** | Composer **`aside`** is **static copy** (not AI context); app **`HybridSearch`** holds **LLM** context **top-of-screen**; inbox **third column** **hidden** when composing—so no app-level “context rail” beside fields. | `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx` asides; `HybridSearch.tsx`; `EmailInboxView.tsx` (`12-right-rail-hints-and-ai-context.md`, `20-regression-map` #7) | **High** |
| **Parser / PDF text extraction quality concerns** | Main **`POST /api/parser/pdf/extract`** uses **pdf.js** `getTextContent` with **concatenation** of text items; **no OCR**; possible **missing spaces** between items; **scanned** PDFs → empty/garbage. HybridSearch uploads base64 + sentinel **`attachmentId: 'context-upload'`** to satisfy API. | `electron/main.ts` ~8147–8278; `HybridSearch.tsx` context upload; (`14-pdf-parser-and-text-extraction.md`, `20-regression-map` #4, #9) | **Med** (quality **Med** per map; mechanism **High**) |
| **Attachment flow vs AI-context flow not clearly separated** | **Two pipelines:** `contextDocs` in **`HybridSearch`** (trimmed text, **8000 chars** per doc into **`chatQuery`**) vs **BEAP package** attachments / **email** attachments in composers—**no shared store**, easy user confusion. | `HybridSearch.tsx`, `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx` (`13-document-upload-and-ingestion.md`, `20-regression-map` #8) | **Med** |

**Additional confirmed gap (legacy parity):** Electron inline BEAP does **not** import the popup **`popup-chat`** UI stack—**intentional architectural gap**, not an accidental omission of one file (`20-regression-map` #5, `05-old-builder-reference.md`).

---

## 4. Architecture findings

**Routing and screen composition**  
Single-page dashboard; Inbox is `activeView === 'beap-inbox'` with `EmailInboxView` or `EmailInboxBulkView`. **`composeMode`** is **local** to the parent; composers mount in the **center** (or bulk **overlay**). See `01-entrypoints-and-routing.md`, `02-layout-shell-and-screen-composition.md`.

**Layout ownership**  
Each inbox component owns its **CSS grid**; there is **no** shared `ComposerLayout`. `EmailInboxView` drives **`gridCols`** from `composeMode` and `selectedMessageId`; **left list always rendered** in normal inbox. `App.tsx` owns header + **`HybridSearch`** (`02-layout-shell-and-screen-composition.md`).

**State ownership**  
- **Composer form:** `useState` only; **lost on unmount** (close compose).  
- **Draft refine:** `useDraftRefineStore` (Zustand) **singleton**—one active session.  
- **Inbox list/selection:** `useEmailInboxStore`.  
- **AI context docs:** `HybridSearch` **local** `contextDocs`—**ephemeral** until reload (`18-state-management-and-data-flow.md`).

**API / service dependencies**  
- Email: `emailAccounts.sendEmail` (IPC).  
- Inbox files: `emailInbox.readFileForAttachment` (IPC).  
- Handshakes: `listHandshakes` shim.  
- AI: `handshakeView.chatWithContextRag` (IPC).  
- PDF context: HTTP `POST /api/parser/pdf/extract` (main).  
- Orchestrator sessions: HTTP `127.0.0.1:51248/api/orchestrator/...` from **`BeapInlineComposer`** (hardcoded base per audit).  
Renderer does **not** talk to Ollama directly (`19-api-contracts-and-server-dependencies.md`).

**Parser pipeline**  
Main process Express route; **pdf.js** dynamic import; worker path beside main bundle (`14-pdf-parser-and-text-extraction.md`). **Separate** file `electron/main/email/pdf-extractor.ts` noted as **not audited**—may duplicate; **verify before refactor**.

**Draft generation flow**  
Field → `connect` → **`HybridSearch`** builds `chatQuery` (draft + optional **`contextDocs`**) → **`chatWithContextRag`** → accept → field setter (`15-ai-draft-generation-flow.md`).

**Old / new reuse opportunities**  
- **Extension:** `RecipientHandshakeSelect`, `DeliveryMethodPanel`, document reader patterns from **`popup-chat.tsx`** (`05`, `06`).  
- **Shared packages:** `@ext/beap-messages` already used for send; more UI could move if bundle split allows (`22-recommended-target-architecture.md`, `21` risk: bundle size).

---

## 5. PDF parser diagnosis

**Which parser(s)**  
HybridSearch context PDFs go through **`POST /api/parser/pdf/extract`** in **`electron/main.ts`**, implemented with **`pdfjs-dist`** (`getDocument` → per-page `getTextContent`) (`14-pdf-parser-and-text-extraction.md`). A **different** path (`electron/main/email/pdf-extractor.ts`) exists but was **not** traced in this audit—**unverified** whether it duplicates or serves email-only flows.

**Where extraction may fail**  
- **No OCR** in the traced handler—**image-only / scanned** PDFs yield empty or garbage text.  
- **Layout-heavy** PDFs: typical pdf.js **ordering/spacing** loss; audit notes **missing spaces between text items** (concatenation ~8204–8218) except limited newline handling.  
- **Port mismatch:** renderer uses hardcoded **51248**; if main HTTP listen port differs, **extract fails** (console warning, silent failure from user POV) (`14`, `19`).

**Normalization / chunking corrupting output?**  
After extraction, **HybridSearch** stores **trimmed text** and appends **up to 8000 characters per document** into **`chatQuery`** for submit (`13-document-upload-and-ingestion.md`). That **truncation** can **drop** tail content for large PDFs—distinct from parser bugs but **can** present as “wrong” answers. **Chunking strategy** is simple slice, not semantic chunking—**verified as design choice in audit**, not a bug in pdf.js itself.

**Parser quality vs upload flow vs prompt assembly**  
- **Evidence for parser quality issues:** pdf.js text-only path; no OCR; concatenation semantics (`14`).  
- **Evidence for upload/contract issues:** `attachmentId` **required**; sentinel **`'context-upload'`** workaround (`14`, `20` #9).  
- **Evidence for prompt assembly:** `contextDocs` + draft refine both inflate **`chatQuery`**; no token budget UI (`15`).  
**Conclusion:** **All three layers** can contribute; the audit **strongest** code evidence is **main-process pdf.js extraction + OCR absence**; **client truncation** is a **confirmed** second-order limiter for long docs.

**Unverified**  
- Full **`httpApp` port map** (search `listen(` in `main.ts` per `19`).  
- Whether **`pdf-extractor.ts`** is legacy or active.  
- Production vs dev **always** 51248 (`21` #4).

---

## 6. Recommended target structure

Structural direction only (from `22-recommended-target-architecture.md`, aligned with `20-regression-map`).

- **Inbox shell** exposes explicit **layout modes** (e.g. `browse` vs `compose-beap` vs `compose-email`) instead of only a boolean compose flag—**clarity of ownership** for layout.
- **Composer** uses **full main width**: **left message list hidden** in compose modes (not merely overlapped by a modal).
- **Right rail** becomes a **narrow AI context rail** (preview, drag-drop target), fed by a **dedicated** `aiContextDocuments[]`-style store (name TBD), **not** `BeapPackageConfig.attachments`.
- **Send** attachments stay in **composer** state with explicit labeling (e.g. “included in package”).
- **HybridSearch** remains the **engine** for RAG/chat; optionally **`contextDocs` lifted** to the shared store so bar + rail stay in sync.
- **Extension-grade** components (handshake, delivery) imported as **presentation** where bundling allows—**reuse strengths without defaulting to popup** as primary UX.

---

## 7. Low-risk implementation sequence

| Phase | Goal | Affected modules (typical) | Risk | Dependencies | Recommended acceptance check |
|-------|------|----------------------------|------|--------------|------------------------------|
| **0 — Validation / instrumentation** | Confirm **ports** (51248), **empty-PDF** telemetry, **concurrent refine** edge cases; resolve **dead-code** question for `BeapInboxDashboard`. | `main.ts` (listen + PDF route), `HybridSearch.tsx`, `useDraftRefineStore`, `EmailInboxView` / bulk | **Low–Med** | None blocking | Logs/metrics show extract success rate; manual **compose + inbox refine** smoke; grep/import audit for Beap dashboards documented. |
| **1 — Layout recovery** | **Hide list** or span composer across main; **restore horizontal space** for compose. | `EmailInboxView.tsx`, possibly `EmailInboxBulkView.tsx`, `App.tsx` | **Med** | Phase 0 port clarity | Compose mode: composer **width** meets agreed breakpoint; **no** broken keyboard shortcuts (bulk) (`21` risk table). |
| **2 — Field sizing and component parity** | Increase **rows/minHeight**; replace **native** handshake block with **extension component** or **restyled** control; optional shared **ComposerSection** styling. | `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx`, `packages`/extension imports | **Med** | Phase 1 stable layout | Visual QA vs extension reference; **send** still passes `hasHandshakeKeyMaterial` gates. |
| **3 — Parser and AI-context separation** | **Harden** PDF path (OCR phased separately); **separate UI** for AI context vs send attachments; optional **lift** `contextDocs` to shared store + rail. | `main.ts`, `HybridSearch.tsx`, new store, `BeapInlineComposer.tsx` | **Med–High** | Phase 2 UX stable | **Prompt 5** flows still work (feature flag or dual-mount period per `21`); BEAP attachments still **executeDeliveryAction**-only. |
| **4 — Polish and cleanup** | Remove `context-upload` **hack** if API allows; centralize **HTTP bases**; lazy-load heavy extension chunks; **design-system** pass on borders/spacing. | `HybridSearch.tsx`, `main.ts` API, preload, `17-design-system-styling-and-spacing.md` targets | **Low–Med** | Phases 1–3 | Bundle size budget; **no** regression on IPC contracts. |

---

## 8. Open questions

From `21-open-questions-and-risk-register.md` and audit gaps:

1. **BeapInboxDashboard / BeapBulkInboxDashboard:** Confirm **dead vs alternate entry**; IPC `notifyBeapInboxDashboard` expectations.  
2. **Orchestrator `sessionId`:** Does it affect runtime beyond logging—trace `orchestratorSessionId` through `executeDeliveryAction`.  
3. **Extension sidepanel:** Parity with **`popup-chat.tsx`**—needs **`sidepanel.tsx`** read.  
4. **PDF port:** Is **51248** guaranteed in **all** shipped configs?  
5. **Concurrent refine:** Can inbox message refine and compose refine **conflict** on `useDraftRefineStore`?  
6. **`pdf-extractor.ts`:** Duplicate or legacy relative to `main.ts` route?  
7. **Full HTTP port map** in `main.ts` (`19` note).  
8. **Product/design:** Acceptable **tradeoff** if popup remains **secondary** for power users vs **full** inline parity.

---

## 9. Appendix — key audit files

| File | Use |
|------|-----|
| `00-index.md` | Catalog and executive summary bullets |
| `01-entrypoints-and-routing.md` | `composeMode`, `App.tsx`, inbox vs bulk |
| `02-layout-shell-and-screen-composition.md` | Grid, `gridCols`, third column |
| `03-new-beap-composer-overview.md` | `BeapInlineComposer` responsibilities |
| `04-new-email-composer-overview.md` | `EmailInlineComposer` vs overlay |
| `05-old-builder-reference.md` | `popup-chat.tsx`, `EmailComposeOverlay`, IPC |
| `06-parity-old-vs-new.md` | Capability matrix |
| `07-handshake-selector.md` | Native select vs extension |
| `08-public-pbeap-field.md` / `09-private-qbeap-field.md` | Fields and refine targets |
| `11-left-column-list-coupling.md` | Why list stays visible |
| `12-right-rail-hints-and-ai-context.md` | Hints vs `contextDocs` |
| `13-document-upload-and-ingestion.md` | Three attachment pipelines |
| `14-pdf-parser-and-text-extraction.md` | pdf.js route, OCR gap |
| `15-ai-draft-generation-flow.md` | Draft refine + RAG |
| `18-state-management-and-data-flow.md` | Zustand vs local state |
| `19-api-contracts-and-server-dependencies.md` | IPC, HTTP, ports |
| `20-regression-map.md` | Issue → code mapping |
| `21-open-questions-and-risk-register.md` | Risks and unknowns |
| `22-recommended-target-architecture.md` | Target layout and stores |
| `blocks/01`–`10` | Per-component deep dives |
| `FULL-AUDIT.md` | Concatenated full audit |

---

*This document synthesizes audit markdown; it does not replace line-level evidence in the source files.*
