# Composer audit — consolidated

This single file merges every markdown document under `docs/analysis/composer-audit/`: the main series (`00`–`22`) and `blocks/01`–`10`. Each part is introduced by its **source path** (relative to that folder). Internal links in the index still point to the original split filenames.

---

## Source: `00-index.md`

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


---

## Source: `01-entrypoints-and-routing.md`

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


---

## Source: `02-layout-shell-and-screen-composition.md`

# Layout shell and screen composition

## Purpose
Describes the CSS grid/flex structure around the composers and why the message list remains visible during compose.

## Files
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` (primary reference)
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx`
- `apps/electron-vite-project/src/components/BeapInboxDashboard.tsx`
- `apps/electron-vite-project/src/components/BeapBulkInboxDashboard.tsx`
- `apps/electron-vite-project/src/App.tsx` (header + `HybridSearch` above main)

## Ownership
Parent grid is owned by each inbox component; `App.tsx` wraps `<main>` around the active view.

## Rendering path
**EmailInboxView** root (`~2224–2237`): `display: grid`, `gridTemplateColumns: gridCols` where  
`gridCols = composeMode || selectedMessageId ? '320px 1fr' : '320px 1fr 320px'` (`~2222`).

Structure:
1. **Column 1 (320px):** Toolbar + message list — **always rendered**; not hidden when `composeMode` is set (`~2277–2402`).
2. **Column 2:** When `composeMode === 'beap' | 'email'`, **only** the composer fills this column (`~2526–2542`). When not composing and a message is selected, split message + AI panel (`~2543+`).
3. **Column 3 (320px):** Shown only when `!selectedMessageId && !composeMode` — provider workspace + import zone (`~2396` region).

**EmailInboxBulkView:** Composer sits in an **absolute** `inset: 0` layer over the bulk grid when `composeMode` is set (`~5583–5625`), while the underlying list remains in the DOM beneath.

**BeapInboxDashboard:** Similar 3-column idea with `280px`; center shows composer or detail (`~518+`).

**BeapBulkInboxDashboard:** Full-size overlay for composers (`~291–323`).

## Inputs and outputs
Grid columns react to `composeMode`, `selectedMessageId`, and message presence.

## Dependencies
Inline styles; no shared `ComposerLayout` component.

## Data flow
Layout does not read global compose store — only local `composeMode`.

## UX impact
- **Reported issue (left list visible):** Root cause is **conditional rendering**: the left column is **never** unmounted or replaced when `composeMode` is true; only the center swaps to the composer. Composer effective width ≈ `1fr` of viewport minus **320px** list — feels cramped vs full-window popup.
- **Right column:** Third column **disappears** when composing or when a message is selected (`gridCols` collapses to two columns), so “Hints” rail in `BeapInlineComposer` is **inside** the composer’s own 2-column grid (`1fr` + `280px` aside), not the app-level third column.

## Current issues
- No “focus mode” that expands composer to full main area or hides list.
- Bulk view uses z-index overlay — better isolation than normal inbox, but still stacks over list UI.

## Old vs new comparison
- **Popup (`popup-chat.tsx`):** Dedicated window — full usable width for BEAP builder blocks.
- **EmailComposeOverlay:** Fixed centered modal (`maxWidth` in overlay) — focused chrome.

## Reuse potential
A shared layout wrapper could enforce “compose = hide list or full-width center.”

## Change risk
Changing `gridCols` or left-column visibility touches selection UX, keyboard shortcuts, and toolbar.

## Notes
`HybridSearch` lives in `App.tsx` header — always visible; composer does not own the top chat bar.


---

## Source: `03-new-beap-composer-overview.md`

# New BEAP composer overview (`BeapInlineComposer`)

## Purpose
Electron-only inline BEAP™ package composer: delivery method, recipient mode, handshake selection, subject, public (pBEAP) and optional encrypted (qBEAP) bodies, session, file attachments, send via `executeDeliveryAction`.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- Shared logic from `@ext/beap-messages` (`executeDeliveryAction`, `DeliveryMethodPanel` types, `RecipientModeSwitch` types)
- `apps/electron-vite-project/src/shims/handshakeRpc.ts` (`listHandshakes`)

## Ownership
Self-contained functional component; mounted by `EmailInboxView`, `EmailInboxBulkView`, `BeapInboxDashboard`, `BeapBulkInboxDashboard`.

## Rendering path
Imported as `{ BeapInlineComposer }`; rendered when parent `composeMode === 'beap'`.

## Inputs and outputs
**Props:** `onClose`, `onSent`, optional `replyToHandshakeId`.

**State:** Local `useState` for all form fields; `useDraftRefineStore` selectors for AI field wiring.

**Side effects:** `initBeapPqAuth()` on mount; `listHandshakes('active')`; orchestrator sessions fetch `GET .../api/orchestrator/sessions`; `window.emailAccounts.listAccounts` for email delivery.

## Dependencies
- **Crypto:** `getSigningKeyPair` from `@ext/beap-messages/services/beapCrypto`
- **Builder:** `BeapPackageBuilder` / `executeDeliveryAction`
- **AI refinement:** `useDraftRefineStore` — click public/encrypted textarea to `connect(null, 'New BEAP Message', …, 'capsule-public' | 'capsule-encrypted')`

## Data flow
Form → `BeapPackageConfig` → `executeDeliveryAction` → on success `onSent()`.

## UX impact
- **Layout:** Root `display: grid; gridTemplateColumns: 1fr 280px` (`~367–378`) — main form scrolls in left cell; static “Hints” aside right.
- **Field sizes:** Public textarea `rows={6}`, encrypted `rows={5}` (`~576–607`) — fixed small vertical space unless user drags resize.
- **Visual:** Borders `#e5e7eb`, draft-refine selection `#7c3aed` outline (Prompt 6 polish).

## Current issues
- Does not use shared extension components `RecipientHandshakeSelect` / rich BEAP panels from `popup-chat.tsx` — different UX tier.
- Orchestrator HTTP base hardcoded: `http://127.0.0.1:51248` (`~16`).

## Old vs new comparison
Extension `popup-chat.tsx` imports `RecipientModeSwitch`, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, document reader modal, attachment parsing — **much richer** UI. `BeapInlineComposer` uses plain `<select>` for handshake (`~471–530`).

## Reuse potential
Porting extension subcomponents into Electron would align look-and-feel.

## Change risk
`executeDeliveryAction` and config shape are security-sensitive; handshake mapping must stay consistent with `SelectedHandshakeRecipient`.

## Notes
Comment at top: “Mirrors popup-chat draft fields” — **partially true** for data model, not for UI parity.


---

## Source: `04-new-email-composer-overview.md`

# New Email composer overview (`EmailInlineComposer`)

## Purpose
Plain-email compose for Electron: To, Subject, Body, attachments, signature preview pattern, send via `window.emailAccounts.sendEmail`.

## Files
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx`
- `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` (exports `EMAIL_SIGNATURE`, `DraftAttachment` type only — overlay UI largely superseded for dashboard)

## Ownership
Same mounting pattern as `BeapInlineComposer` when `composeMode === 'email'`.

## Rendering path
Default export + named export; parents pass `replyTo` for reply prefill.

## Inputs and outputs
**Props:** `onClose`, `onSent`, optional `replyTo` (`to`, `subject`, `body`, `initialAttachments`).

**Output:** IPC `emailAccounts.sendEmail(accountId, { to, subject, bodyText, attachments })`.

## Dependencies
- `pickDefaultEmailAccountRowId` from `@ext/shared/email/pickDefaultAccountRow`
- `useDraftRefineStore` for body field AI refine (`connect(null, 'New Email', body, setBody, 'email')`)

## Data flow
Local state → validation → `sendEmail` → `onSent` on success.

## UX impact
- Same **1fr + 280px** grid as BEAP (`~187–199`) with hints aside.
- Body `minHeight: 160`, flexible textarea — somewhat larger default than BEAP public field but still constrained by column width.

## Current issues
- **Parity with `EmailComposeOverlay`:** Overlay used professional light theme option (`theme === 'professional'`) and modal framing; inline uses dark dashboard chrome only.

## Old vs new comparison
`EmailComposeOverlay.tsx` (`~34+`): full-screen dimmed overlay, `maxWidth` container, theme tokens for light “premium” sheet. **Inline** embeds in dashboard grid — different visual framing.

## Reuse potential
`EMAIL_SIGNATURE` and attachment MIME mapping are shared concepts; UI could import more overlay styling without bringing back modal.

## Change risk
Send pipeline must stay aligned with provider IPC contract.

## Notes
Bulk view removed modal path; reply flows use `composeReplyTo` + `EmailInlineComposer` (`EmailInboxBulkView.tsx`).


---

## Source: `05-old-builder-reference.md`

# Old builder reference

## Purpose
Catalog of “previous” compose experiences for parity discussion: extension popup BEAP builder, modal email overlay, IPC-opened windows.

## Files (Electron)
- `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` — **still in repo**; rendering commented out in `EmailInboxView.tsx` (~2635–2638) and removed from bulk view.
- `apps/electron-vite-project/electron/main.ts` — `ipcMain.on('OPEN_BEAP_DRAFT'|'OPEN_EMAIL_COMPOSE', …)` (lines ~1057–1101 per product docs — verify in repo if needed).
- `apps/electron-vite-project/electron/main.ts` / `preload.ts` — `analysisDashboard.openBeapDraft` exposure for extension.

## Files (Extension / shared)
- `apps/extension-chromium/src/popup-chat.tsx` — **large** entry (~2400+ lines): `RecipientModeSwitch`, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, `executeDeliveryAction`, `BeapDocumentReaderModal`, attachment parsing, `ConnectEmailFlow`, themes (`Theme` / `toBeapTheme`).
- `apps/extension-chromium/src/popup-chat.html` — popup entry HTML.

## Ownership
- **Popup:** Standalone window / extension routing — not the Electron renderer inbox tree.
- **Overlay:** Was child of `EmailInboxView` when `showEmailCompose` was true (disabled).

## Rendering path
- Popup: `createRoot` from `popup-chat.tsx` (standard Vite entry).
- IPC: Opens BrowserWindow or routes to dashboard — implementation in `main.ts` (not re-read in full for this audit).

## Inputs and outputs
Popup receives extension auth/UI store context; Electron inline composers receive only React props from parent.

## Dependencies
Popup pulls **many** `@ext/beap-messages` and `@ext/beap-builder` UI pieces that **BeapInlineComposer does not import**.

## Data flow
Same underlying send: `executeDeliveryAction` / email IPC — **functional** parity possible; **UI** parity not preserved in inline composer.

## UX impact
Old popup = dedicated surface, extension-themed controls, handshake select component. New inline = minimal HTML controls inside dashboard grid.

## Current issues
Product expectation “preserve old look and feel” implies **gap** between `popup-chat.tsx` richness and `BeapInlineComposer.tsx`.

## Old vs new comparison
| Aspect | Old (popup) | New (inline) |
|--------|-------------|--------------|
| Handshake UI | `RecipientHandshakeSelect` | Native `<select>` |
| Delivery | `DeliveryMethodPanel` | Native `<select>` |
| Attachments | Reader modal, size limits helpers | Simple file list |
| Layout | Popup window | Grid cell beside list |

## Reuse potential
Extract shared presentational components from extension into `packages/` consumed by Electron.

## Change risk
Importing extension into Electron increases bundle size and cross-target constraints.

## Notes
Multiple “candidates” for old builder: (1) `popup-chat.tsx`, (2) `EmailComposeOverlay`, (3) sidepanel docked mode (not fully traced here — `sidepanel.tsx` exists). **Uncertainty:** exact feature parity between docked sidepanel BEAP mode and popup.


---

## Source: `06-parity-old-vs-new.md`

# Parity: old vs new

## Purpose
Side-by-side view of behavior and UI parity between legacy surfaces and embedded composers.

## Files
See `05-old-builder-reference.md`, `03-new-beap-composer-overview.md`, `04-new-email-composer-overview.md`.

## Ownership
N/A (comparison doc).

## Rendering path
N/A.

## Inputs and outputs

| Capability | Extension popup (`popup-chat`) | `BeapInlineComposer` | `EmailInlineComposer` | `EmailComposeOverlay` |
|------------|-------------------------------|----------------------|------------------------|------------------------|
| pBEAP / public body | Rich form | Yes (`publicMessage`) | N/A | N/A |
| qBEAP / encrypted | Rich form | Yes (`encryptedMessage`) | N/A | N/A |
| Handshake pick | Component | `<select>` + `listHandshakes` | N/A | N/A |
| Email send | Various paths | N/A | `sendEmail` | `sendEmail` |
| Theme / density | Multiple themes | Dark inline styles | Dark inline | Light “professional” option |
| Modal framing | Window / popup | None | None | Centered overlay |
| AI draft refine | Sidepanel/search | Via `useDraftRefineStore` + HybridSearch | Same | Not wired in overlay |

## Dependencies
New composers depend on **Zustand** `useDraftRefineStore` + **HybridSearch** for AI; old popup had integrated search/command context in-extension.

## Data flow
Send pipelines converge on same services (`executeDeliveryAction`, `emailAccounts.sendEmail`).

## UX impact
**Functional:** Core send paths preserved. **Perceived premium:** Reduced — layout, controls, and density differ.

## Current issues
Explicit gaps: handshake UX, document reader, attachment validation UX, full-width layout.

## Old vs new comparison
This document **is** the comparison table.

## Reuse potential
High for shared components; medium for state architecture.

## Change risk
Parity work could over-import extension into Electron without code splitting.

## Notes
**Confidence:** High for files read; medium for IPC window behavior without reading full `main.ts` open handlers.


---

## Source: `07-handshake-selector.md`

# Handshake selector (inline BEAP)

## Purpose
Select active handshake for private (qBEAP) delivery; drives `SelectedHandshakeRecipient` mapping.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` (private mode block ~458–532)
- `apps/electron-vite-project/src/shims/handshakeRpc.ts` — `listHandshakes`

## Ownership
`BeapInlineComposer` local state: `handshakeRows`, `selectedHandshakeId`, `handshakesLoading`, `handshakesError`.

## Rendering path
Rendered only when `recipientMode === 'private'`; native `<select>` with `value={selectedHandshakeId}`.

## Inputs and outputs
**Input:** Ledger rows from `listHandshakes('active')`.  
**Output:** `selectedRecipient` via `useMemo` mapping `mapLedgerRecordToSelectedRecipient` (~98–103).

## Dependencies
- `@ext/handshake/rpcTypes` — `SelectedHandshakeRecipient`, `hasHandshakeKeyMaterial`
- No `RecipientHandshakeSelect` from extension

## Data flow
`refreshHandshakes` on mount → `setHandshakeRows` → user selects id → `selectedRecipient` used in `BeapPackageConfig` on send.

## UX impact
- **Visual:** Default `<select>` styling (`width: 100%`, padding, border ~`#e5e7eb`) — minimal chrome; matches “cheap” product feedback versus branded handshake picker.
- **Errors:** Loading and error states are text + retry button (~461–469).

## Current issues
- No avatars, trust badges, or handshake health indicators unlike extension.
- Fingerprint display is separate (“Your fingerprint” in delivery details ~565).

## Old vs new comparison
Extension `RecipientHandshakeSelect` (popup-chat imports) — **not** used in Electron inline.

## Reuse potential
Import extension component or replicate styling from `HandshakeView` / extension.

## Change risk
`mapLedgerRecordToSelectedRecipient` must stay aligned with qBEAP key material checks (`hasHandshakeKeyMaterial` on send ~235–237).

## Notes
`replyToHandshakeId` effect pre-selects handshake when rows load (~145–150).


---

## Source: `08-public-pbeap-field.md`

# Public pBEAP field

## Purpose
Required public / transport-visible capsule text (`messageBody` in `BeapPackageConfig`).

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — textarea ~575–596
- `data-compose-field="public-message"`

## Ownership
Local state `publicMessage`; AI refine via `useDraftRefineStore` target `capsule-public`.

## Rendering path
Label “BEAP™ message (required)” + textarea with `rows={6}`.

## Inputs and outputs
- **User input:** typing updates `publicMessage`.
- **AI:** Click textarea → `connect(null, 'New BEAP Message', publicMessage, setPublicMessage, 'capsule-public')`; `updateDraftText` sync on change (~177–181).
- **Validation:** Send requires `publicMessage.trim()` (~227–230).

## Dependencies
`useDraftRefineStore`; HybridSearch builds draft-refine prompts when `refineTarget === 'capsule-public'` (`HybridSearch.tsx` field labels).

## Data flow
State → package config `messageBody: publicMessage` (~287).

## UX impact
- **Small feel:** `rows={6}` in a **narrow center column** (grid `1fr` minus 320px list) — limited vertical space; user can resize vertically (`resize: 'vertical'`) but default is modest.
- **Premium:** Plain textarea; no rich preview or capsule metadata cards.

## Current issues
Product asks for larger editor — code fix is mostly layout (`rows`, `minHeight`, grid width), not logic.

## Old vs new comparison
Popup builder likely used larger flexible regions and companion panels.

## Reuse potential
Same `data-compose-field` attribute for automation/testing.

## Change risk
AI refine store assumes this field maps to `capsule-public`; HybridSearch prompt strings reference “preview summary of a reply.”

## Notes
Border highlights `#7c3aed` when draft refine active for this target.


---

## Source: `09-private-qbeap-field.md`

# Private qBEAP field

## Purpose
Optional encrypted payload when `recipientMode === 'private'`; becomes `encryptedMessage` on package config when non-empty.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~598–625
- `data-compose-field="encrypted-message"`

## Ownership
Local `encryptedMessage`; draft refine target `capsule-encrypted`.

## Rendering path
Only if `recipientMode === 'private'`; label “Encrypted message (private)”, `rows={5}`.

## Inputs and outputs
- **Send:** Included in config when `encryptedMessage.trim()` (~292–294).
- **AI:** Separate click handler from public field; `refineTarget === 'capsule-encrypted'`.

## Dependencies
`hasHandshakeKeyMaterial(selectedRecipient)` gate before send (~235–237).

## Data flow
Same as public field with different store target and styling (purple-tinted background ~619).

## UX impact
**Even smaller default** than public (`rows={5}` vs 6). Contributes to “text boxes too small” report.

## Current issues
Private mode only — switching to public hides field entirely (expected) but mode toggles are simple buttons (~418–455).

## Old vs new comparison
Extension may show encryption status / key indicators inline — not present here beyond error message on missing keys.

## Reuse potential
High — same draft refine pattern as public.

## Change risk
Encrypt path ties to handshake keys; UI changes must not skip validation.

## Notes
Click on textarea toggles draft refine — may compete with text selection UX (product may want explicit “Connect to AI” control).


---

## Source: `10-subject-session-attachments.md`

# Subject, session, and attachments (BEAP inline)

## Purpose
Non-body fields: subject line, optional orchestrator session, and capsule file attachments for package build.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
  - Subject: ~568–573
  - Session: ~628–639
  - Attachments: ~203–223 (add), `readFileForAttachment` / `showOpenDialogForAttachments` ~253–278, list UI ~592–621

## Ownership
All local React state inside `BeapInlineComposer`.

## Rendering path
Vertical stack in scrollable main column; attachments are **BEAP package** attachments (built into `CapsuleAttachment[]` / `originalFiles`).

## Inputs and outputs
- **Subject:** `subject` state → `BeapPackageConfig.subject`.
- **Session:** `sessionId` — logged in payload (`orchestratorSessionId`) ~299–301; **uncertainty:** whether orchestrator consumes it end-to-end without further IPC review.
- **Attachments:** Local paths via `window.emailInbox` APIs — **same channel as inbox attachments**, not AI context documents.

## Dependencies
`window.emailInbox?.readFileForAttachment`, `showOpenDialogForAttachments` (when available).

## Data flow
User picks files → read base64 → push to `capsuleAttachments` + `originalFiles` in config (~250–277).

## UX impact
Attachment UX is a simple list with remove — contrast with extension’s document reader / validation modals.

## Current issues
Mixing **user mental model**: product wants AI-only PDFs on a **right rail** — current design puts **package** attachments in-form; HybridSearch `contextDocs` is separate (see doc 13).

## Old vs new comparison
Popup-chat includes `BeapDocumentReaderModal`, `runDraftAttachmentParseWithFallback` — **not** in inline composer.

## Reuse potential
Attachment pipeline for **send** is sound; AI context should be a **separate** state bucket to avoid confusion.

## Change risk
Altering attachment shape affects `executeDeliveryAction` and crypto package.

## Notes
`ORCHESTRATOR_HTTP_BASE = 'http://127.0.0.1:51248'` for session list fetch (~152–171).


---

## Source: `11-left-column-list-coupling.md`

# Left-column list coupling

## Purpose
Documents why the inbox message list remains visible during compose and which code paths keep it mounted.

## Files
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` — left column ~2277–2402; **no** `composeMode` guard wrapping this block
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` — overlay composer ~5583+; list in scroll region **under** overlay (still mounted)

## Ownership
**By design** in current implementation: left column is unconditional sibling of center content in `EmailInboxView`.

## Rendering path
```text
grid [ list | center+optionalRight ]
```
When `composeMode` set: `gridCols` = `'320px 1fr'` — list **still first column**; center shows composer only.

## Inputs and outputs
List continues to receive `messages`, `selectedMessageId`, toolbar filters — independent of compose.

## Dependencies
`EmailInboxToolbar`, `InboxMessageRow`, store `useEmailInboxStore`.

## Data flow
Opening compose often clears message selection (`handleOpenBeapDraft` calls `selectMessage(null)`) — list shows unselected rows but **remains visible**.

## UX impact
**Primary regression:** composer shares horizontal space with 320px list → reduced width for form. **Product expectation:** list should hide or composer should use full main — requires layout branch.

## Current issues
No `if (composeMode) return <FullWidthComposer />` pattern at `EmailInboxView` level.

## Old vs new comparison
Modal overlay (`EmailComposeOverlay`) **obscured** the list; inline does not.

## Reuse potential
Conditional rendering or CSS grid area spanning could fix without new routes.

## Change risk
Keyboard shortcuts in `EmailInboxBulkView` already guard `composeMode` (~4142) — layout change must keep those consistent.

## Notes
`BeapBulkInboxDashboard` uses full overlay — closer to desired “focus” UX for that surface only.


---

## Source: `12-right-rail-hints-and-ai-context.md`

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


---

## Source: `13-document-upload-and-ingestion.md`

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


---

## Source: `14-pdf-parser-and-text-extraction.md`

# PDF parser and text extraction

## Purpose
Documents the HTTP PDF text extraction path used by HybridSearch context upload and the pdf.js-based extraction logic in main process.

## Files
- `apps/electron-vite-project/electron/main.ts` — `POST /api/parser/pdf/extract` ~8147–8278
- `apps/electron-vite-project/src/components/HybridSearch.tsx` — `handleContextUpload`, `arrayBufferToBase64`, `CONTEXT_PDF_ATTACHMENT_ID`, `CONTEXT_UPLOAD_HTTP_PORT` (51248)
- **Not used in audit scope:** `electron/main/email/pdf-extractor.ts` (user story) — verify if duplicate or legacy; **grep recommended** before refactor.

## Ownership
Express route in Electron **main** HTTP server; client is renderer `HybridSearch`.

## Rendering path
N/A (API).

## Inputs and outputs
**Request JSON:** `{ attachmentId: string, base64: string }` — `attachmentId` required by validator even for ad-hoc uploads (HybridSearch uses sentinel `'context-upload'`).

**Response JSON:** `{ success, extractedText, pageCount, … }` — client reads `extractedText` when `success`.

## Dependencies
- `pdfjs-dist` dynamic import in main
- Worker path: `pdf.worker.mjs` beside main bundle (`path.join(__dirname, 'pdf.worker.mjs')`)

## Data flow
PDF bytes → pdf.js `getDocument` → per-page `getTextContent` → concatenate `item.str` with limited newline handling from `hasEOL` (~8208–8218).

## UX impact
**Extraction quality:** Text-only PDFs work; complex layouts may lose ordering/spacing (typical pdf.js behavior). **Incorrect extraction** reports may stem from:
- Missing spaces between items (no explicit space insertion except EOL)
- Scanned PDFs without OCR — **no OCR fallback** in traced handler (only text content).

## Current issues
- **No OCR** in this endpoint — image-only PDFs → empty or garbage text.
- **Client/server mismatch risk:** Renderer must use same port as HTTP server (hardcoded 51248 — must match orchestrator/main listen port).

## Old vs new comparison
Extension may embed different PDF handling — separate code path.

## Reuse potential
Centralize port/config; add telemetry on empty extract.

## Change risk
Touching pdf.js worker paths breaks packaged app if `__dirname` layout changes.

## Notes
Build logs previously warned missing `tesseract.js-core` wasm copies for **builder** resources — distinct from this endpoint’s extraction quality.


---

## Source: `15-ai-draft-generation-flow.md`

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


---

## Source: `16-send-flow-validation-and-errors.md`

# Send flow, validation, and errors

## Purpose
Validation gates and error surfaces for BEAP inline send vs email inline send.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — `handleSend` ~225–315
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — `handleSend` (useCallback)
- `@ext/beap-messages/services/BeapPackageBuilder` — `executeDeliveryAction`

## Ownership
Composer-local; errors in `sendError` / `error` state; BEAP shows red banner ~623–625.

## Rendering path
Send button triggers async `handleSend`; failures set string state.

## Inputs and outputs
**BEAP checks:** public message non-empty; private mode requires `selectedRecipient` + `hasHandshakeKeyMaterial`; public+email requires `emailTo`; attachments read async.

**Email checks:** To required; account id; `sendEmail` availability.

## Dependencies
IPC `window.emailAccounts`, `window.emailInbox` for files.

## Data flow
Validation failure → early return with message; success → `onSent()`.

## UX impact
Inline error divs — functional, not “premium” toast system (except separate `sendEmailToast` in `EmailInboxView` for **AI panel send**, not composer).

## Current issues
No inline field-level validation summary; long error strings in one banner.

## Old vs new comparison
Popup may surface richer debug (`ClientSendFailureDebug`) — not wired in inline BEAP.

## Reuse potential
Align error display with inbox toast patterns.

## Change risk
Tight coupling to handshake key errors — copy changes affect support burden.

## Notes
Ctrl/Cmd+Enter shortcut sends (Prompt 6) — global window listener in composers.


---

## Source: `17-design-system-styling-and-spacing.md`

# Design system, styling, and spacing

## Purpose
How the embedded composers relate to dashboard design tokens and why “premium” feel may be absent.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — extensive inline `style={{}}`
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — same
- `apps/electron-vite-project/src/App.css` — `.app-root` (inheritance)
- `apps/electron-vite-project/src/components/HybridSearch.css` — chat bar

## Ownership
No shared `ComposerTheme` — each file duplicates border (`#e5e7eb`), muted text vars, purple accents.

## Rendering path
Inline styles override parent; `fontFamily: 'inherit'` set in Prompt 6 for root grids.

## Inputs and outputs
N/A.

## Dependencies
CSS variables: `--color-bg`, `--color-text`, `--color-text-muted` where referenced.

## Data flow
N/A.

## UX impact
- **Density:** Forms pack many controls in one scroll column — limited whitespace between sections.
- **Handshake / selects:** Native controls match OS — flatter than extension themed components.
- **Hierarchy:** Section labels uppercase 11px — consistent but not “marketing premium.”

## Current issues
Product feedback (“does not feel premium”) aligns with **lack of shared design layer** and **constrained width** (see layout doc).

## Old vs new comparison
`EmailComposeOverlay` professional theme used light card on dark overlay — **higher contrast** figure/ground than inline embed.

## Reuse potential
Extract `ComposerSection`, `ComposerSelect` from extension or design system.

## Change risk
Global CSS changes affect entire dashboard.

## Notes
HybridSearch and composers use different border treatments — slight visual fragmentation.


---

## Source: `18-state-management-and-data-flow.md`

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


---

## Source: `19-api-contracts-and-server-dependencies.md`

# API contracts and server dependencies

## Purpose
IPC, HTTP, and service boundaries touched by composers and AI context.

## Files
- `apps/electron-vite-project/electron/preload.ts` — `emailAccounts`, `emailInbox`, `handshakeView.chatWithContextRag`
- `apps/electron-vite-project/electron/main.ts` — HTTP `httpApp` routes including `/api/parser/pdf/extract`, orchestrator hooks
- `apps/electron-vite-project/src/shims/handshakeRpc.ts`
- `BeapInlineComposer` — `ORCHESTRATOR_HTTP_BASE` fetch sessions

## Ownership
Main process owns HTTP server; renderer calls via `window.*` bridges.

## Rendering path
N/A.

## Inputs and outputs
| Surface | API | Transport |
|---------|-----|-------------|
| Email send | `emailAccounts.sendEmail` | IPC |
| Inbox files | `emailInbox.readFileForAttachment` | IPC |
| Handshake list | `listHandshakes` shim → likely IPC/RPC | Async |
| PDF text (context) | POST `/api/parser/pdf/extract` | HTTP localhost |
| AI chat | `handshakeView.chatWithContextRag` | IPC invoke |
| Orchestrator sessions | GET/POST `127.0.0.1:51248/api/orchestrator/...` | HTTP |

## Dependencies
Electron version pinned in root `package.json` overrides; express in main for HTTP.

## Data flow
Renderer never talks to Ollama directly — always via main/handshake layer.

## UX impact
Port **51248** must match running orchestrator — mismatch → PDF extract fails silently (warn in console).

## Current issues
Hardcoded HTTP bases scattered (composer vs HybridSearch port constant).

## Old vs new comparison
Same IPC family as legacy dashboard.

## Reuse potential
Config module for ports and feature flags.

## Change risk
IPC signature changes require preload + main sync.

## Notes
**Uncertainty:** Full list of `httpApp` listen ports — search `listen(` in `main.ts` for authoritative port map.


---

## Source: `20-regression-map.md`

# Regression map

## Purpose
Maps reported product issues to code-level causes with severity and confidence.

| # | Reported issue | Root cause (code) | Affected files | Severity | Confidence | Likely fix area |
|---|----------------|-------------------|----------------|----------|------------|-----------------|
| 1 | Not premium feel | Inline styles; native controls; no modal framing; cramped grid | `BeapInlineComposer.tsx`, `EmailInlineComposer.tsx`, `EmailInboxView.tsx` grid | High | High | Layout shell + shared components from extension |
| 2 | pBEAP/qBEAP boxes too small | `rows={6}`/`{5}`; center column `1fr` with 320px list; no `minHeight` | `BeapInlineComposer.tsx` ~576–607; `EmailInboxView.tsx` `gridCols` | High | High | Increase rows/minHeight; full-width compose mode |
| 3 | Handshake select looks cheap | Plain `<select>` vs extension `RecipientHandshakeSelect` | `BeapInlineComposer.tsx` ~471–530 | Med | High | Import extension component or restyle |
| 4 | PDF parser wrong text | pdf.js text extraction concatenation; no OCR; layout PDFs | `main.ts` ~8204–8218; HybridSearch upload | Med | Med | Parser improvements + OCR path; user education |
| 5 | Old builder L&F lost | Electron inline does not import popup-chat UI stack | `popup-chat.tsx` vs `BeapInlineComposer.tsx` | High | High | Component reuse / design pass |
| 6 | Left list visible while composing | Left column always rendered; `gridCols` only 2 cols, list not hidden | `EmailInboxView.tsx` ~2277–2402, ~2222 | High | High | Conditional hide list or span columns |
| 7 | Right rail wrong use | Composer `aside` = static hints; AI context in HybridSearch bar | `BeapInlineComposer.tsx` ~652+; `HybridSearch.tsx` | Med | High | Replace aside with context rail; relocate `contextDocs` |
| 8 | AI context vs attachments confusion | Two pipelines: `contextDocs` (LLM) vs attachment state (send) | `HybridSearch.tsx`, `BeapInlineComposer.tsx` | Med | Med | Separate UI + naming; optional shared store |
| 9 | context-upload attachmentId hack | API requires `attachmentId`; sentinel `'context-upload'` | `HybridSearch.tsx` constants | Low | High | API allow optional id or dedicated route |

## Purpose (section)
Evidence-based mapping for planning; not implementation.

## Files
This document + all cross-referenced paths above.

## Ownership
N/A.

## Rendering path
N/A.

## Inputs and outputs
N/A.

## Dependencies
N/A.

## Data flow
N/A.

## UX impact
Table above.

## Current issues
See table.

## Old vs new comparison
Integrated in rows 5 and 7.

## Reuse potential
N/A.

## Change risk
Fixes may interact — e.g. full-width layout + HybridSearch position.

## Notes
Severity: **High** = blocks product goals; **Med** = noticeable; **Low** = technical debt.


---

## Source: `21-open-questions-and-risk-register.md`

# Open questions and risk register

## Purpose
Tracks uncertainties and risks before implementation.

## Files
N/A.

## Ownership
N/A.

## Rendering path
N/A.

## Inputs and outputs
N/A.

## Dependencies
N/A.

## Data flow
N/A.

## UX impact
N/A.

## Current issues

### Open questions
1. **`BeapInboxDashboard` usage** — Grep of `apps/electron-vite-project` shows **no** `import … BeapInboxDashboard` from other components (only the file itself + main/email notifier names). **Likely dead code** in the renderer; confirm before deleting — IPC `notifyBeapInboxDashboard` may still expect a future or alternate window.
2. **Orchestrator session:** Does `sessionId` change runtime behavior beyond logging? — Trace `orchestratorSessionId` in `executeDeliveryAction`.
3. **Sidepanel BEAP builder parity:** How much does docked extension match `popup-chat.tsx`? — Needs `sidepanel.tsx` read.
4. **PDF port:** Is orchestrator always on 51248 in dev and prod?
5. **Concurrent refine:** Can inbox + compose both set `useDraftRefineStore` in conflicting ways?

### Risk register
| Risk | Likelihood | Impact | Mitigation idea |
|------|------------|--------|-----------------|
| Full-width layout breaks keyboard shortcuts | Med | Med | Test `EmailInboxBulkView` key handler with compose |
| Reusing extension components bloats Electron bundle | Med | Low | Lazy load / separate chunk |
| PDF OCR request expands scope | High | Med | Phase OCR separately |
| Moving context upload breaks Prompt 5 flows | Med | High | Feature flag or dual-mount period |

## Old vs new comparison
N/A.

## Reuse potential
N/A.

## Change risk
N/A.

## Notes
Update this file after spikes.


---

## Source: `22-recommended-target-architecture.md`

# Recommended target architecture (structural only)

## Purpose
Future-state shape for full-width compose, hidden list, AI context rail, and attachment separation — **no implementation code**.

## Files
N/A (vision doc).

## Ownership
Proposed: inbox shell owns **layout mode** (`'browse' | 'compose-beap' | 'compose-email'`) instead of boolean `composeMode` only.

## Rendering path (target)
```text
App header [HybridSearch — optional scope when composing]

Main:
  browse:   [ Message list | Detail / empty + third rail ]
  compose:  [ Composer primary (span full main width) | AI context rail narrow ]
```
**Left list hidden** in compose modes — composer gains horizontal space.

## Inputs and outputs
- **AI context rail:** Dedicated store `aiContextDocuments[]` (name TBD) feeding HybridSearch LLM prompts **and** UI preview; **not** `BeapPackageConfig.attachments`.
- **Send attachments:** Remain in composer form state; clear labeling “Included in package.”

## Dependencies
- Reuse `useDraftRefineStore` + HybridSearch engine; optionally **lift** `contextDocs` from HybridSearch into shared store so rail and bar stay in sync.
- Extension components (handshake select, delivery panel) imported as **presentation** layer.

## Data flow
```
User drops PDF on rail → extract text → aiContextStore → HybridSearch chatQuery
User adds package file → composer attachment state → executeDeliveryAction only
```

## UX impact
Addresses: premium width, context placement, conceptual separation.

## Current issues
N/A — forward looking.

## Old vs new comparison
Preserves **old builder strengths** by **embedding extension-grade components** in the primary column, not by reopening popup as default.

## Reuse potential
Maximum reuse of `@ext/beap-messages` UI where Electron bundling allows.

## Change risk
**Phased delivery:** (1) layout hide list, (2) resize fields, (3) rail + store, (4) parser hardening.

## Notes
Align with `20-regression-map.md` priorities; validate each phase with QA checklist.


---

## Source: `blocks/01-email-inbox-view-grid-shell.md`

# EmailInboxView grid shell

## Purpose
Dashboard grid wrapper for normal inbox: left list, center workspace, optional right column; controls composer width.

## Files
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` ~2222–2542

## Ownership
`EmailInboxView` component.

## Rendering path
Root `div` CSS grid; children: left panel, then conditional center/right.

## Inputs and outputs
**Props:** `accounts`, `selectedMessageId`, callbacks. **State:** `composeMode`, `composeReplyTo`.

## Dependencies
`EmailInboxToolbar`, `InboxMessageRow`, `HybridSearch` (in App, not here).

## Data flow
`composeMode` switches center between composers and detail workspace.

## UX impact
**Primary regression driver:** list stays visible; composer only gets `1fr` center.

## Current issues
No compose-only layout branch.

## Old vs new comparison
Overlay path removed — list was obscured before.

## Reuse potential
Extract `InboxLayout` with mode prop.

## Change risk
High — touches all inbox navigation.

## Notes
`gridCols` formula at ~2222.


---

## Source: `blocks/02-beap-inline-composer-root.md`

# BeapInlineComposer root

## Purpose
Two-column grid (`1fr` + `280px`) containing scrollable form and static hints aside.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~366–378, ~380–650

## Ownership
`BeapInlineComposer` function component.

## Rendering path
Mounted from parents when `composeMode === 'beap'`.

## Inputs and outputs
Props: `onClose`, `onSent`, `replyToHandshakeId`.

## Dependencies
`useDraftRefineStore`, `executeDeliveryAction`, `listHandshakes`.

## Data flow
Local state drives `BeapPackageConfig`; aside is static text.

## UX impact
Hints consume 280px horizontal space that product may want for AI context.

## Current issues
Hints aside not interactive; no drag-drop.

## Old vs new comparison
Popup uses full window — no competing aside layout.

## Reuse potential
Swap `<aside>` for context rail component.

## Change risk
Medium — grid template changes affect all BEAP embeds.

## Notes
`height: '100%'`, `minHeight: 0` on scroll column (Prompt 6).


---

## Source: `blocks/03-email-inline-composer-root.md`

# EmailInlineComposer root

## Purpose
Two-column grid parallel to BEAP: form + hints aside for plain email.

## Files
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` ~186–230

## Ownership
`EmailInlineComposer` component.

## Rendering path
`composeMode === 'email'` in inbox parents.

## Inputs and outputs
`replyTo` prefill; `onSent`/`onClose`.

## Dependencies
`EMAIL_SIGNATURE` from `EmailComposeOverlay.tsx`; `useDraftRefineStore` for body.

## Data flow
`body` + signature on send; draft refine syncs `updateDraftText(body)`.

## UX impact
Same width constraints as BEAP; professional modal theme from overlay **not** applied.

## Current issues
Hints aside duplicates static copy.

## Old vs new comparison
`EmailComposeOverlay` used modal + optional light theme.

## Reuse potential
Share layout shell with BEAP.

## Change risk
Low — isolated send path.

## Notes
Default export + named export both exist.


---

## Source: `blocks/04-hybrid-search-chat-bar.md`

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


---

## Source: `blocks/05-use-draft-refine-store.md`

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


---

## Source: `blocks/06-extension-popup-chat-legacy-builder.md`

# Extension popup-chat (legacy BEAP builder reference)

## Purpose
Primary **rich** BEAP builder UI in the extension: imports delivery panels, handshake select, document reader, themes.

## Files
- `apps/extension-chromium/src/popup-chat.tsx` (entry)
- `apps/extension-chromium/src/popup-chat.html`

## Ownership
Extension popup window — separate from Electron renderer.

## Rendering path
Vite entry → `createRoot` mount.

## Inputs and outputs
Extension stores (`useUIStore`), handshake hooks, BEAP inbox store.

## Dependencies
`RecipientModeSwitch`, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, `executeDeliveryAction`, `BeapDocumentReaderModal`, `runDraftAttachmentParseWithFallback`, etc.

## Data flow
Same services as Electron for package build — **UI layer** differs.

## UX impact
**Reference standard** for “premium” builder per product.

## Current issues
Not reused by Electron inline composer — **intentional gap** in current architecture.

## Old vs new comparison
This **is** the old builder for extension users.

## Reuse potential
**High** if bundling constraints allow.

## Change risk
Bundle size + cross-environment (Chrome vs Electron) testing.

## Notes
Read only first ~80 lines in audit — full file is large; deeper field-by-field parity needs dedicated pass.


---

## Source: `blocks/07-handshake-select-native.md`

# Handshake native `<select>` block

## Purpose
Dropdown for private-mode handshake selection in `BeapInlineComposer`.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~458–532

## Ownership
`BeapInlineComposer`.

## Rendering path
Conditional on `recipientMode === 'private'`.

## Inputs and outputs
Options from `handshakeRows`; value `selectedHandshakeId`.

## Dependencies
`listHandshakes`, `labelForHandshakeRow`.

## Data flow
Selection → `selectedRecipient` memo → send config.

## UX impact
Native OS select — minimal branding.

## Current issues
Product calls out weak visual design.

## Old vs new comparison
vs `RecipientHandshakeSelect` in extension.

## Reuse potential
Replace with extension component.

## Change risk
Medium — accessibility and keyboard behavior.

## Notes
See `07-handshake-selector.md` (parent doc).


---

## Source: `blocks/08-pbeap-textarea.md`

# pBEAP textarea block

## Purpose
Required public message textarea with draft-refine click wiring.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~575–596

## Ownership
`BeapInlineComposer`.

## Rendering path
Stacked after subject; `rows={6}`.

## Inputs and outputs
`publicMessage` state; `handleFieldClick('public')`.

## Dependencies
`useDraftRefineStore` target `capsule-public`.

## Data flow
→ `messageBody` in package config.

## UX impact
Default height modest; width limited by grid.

## Current issues
Small feel — product feedback.

## Old vs new comparison
Popup likely larger editor region.

## Reuse potential
Keep `data-compose-field` for tests.

## Change risk
Low for pure CSS.

## Notes
Purple outline when refine active (`#7c3aed`).


---

## Source: `blocks/09-qbeap-textarea.md`

# qBEAP textarea block

## Purpose
Optional encrypted body for private mode; draft-refine `capsule-encrypted`.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~598–625

## Ownership
`BeapInlineComposer`.

## Rendering path
Only if `recipientMode === 'private'`; `rows={5}`.

## Inputs and outputs
`encryptedMessage`; `handleFieldClick('encrypted')`.

## Dependencies
`useDraftRefineStore` target `capsule-encrypted`.

## Data flow
→ `encryptedMessage` on config when set.

## UX impact
Smaller default than pBEAP row count.

## Current issues
Same width constraints as public field.

## Old vs new comparison
Extension may show more encryption context.

## Reuse potential
Align row counts and styling with public field.

## Change risk
Tied to key validation on send.

## Notes
Violet-tinted background when not in refine focus.


---

## Source: `blocks/10-composer-hints-aside.md`

# Composer hints aside (static)

## Purpose
Right column in BEAP/Email inline composers with static help text.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — `<aside>` ~652+
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — `<aside>` ~424+

## Ownership
Respective composer.

## Rendering path
Second grid column `280px`.

## Inputs and outputs
None — static JSX copy.

## Dependencies
None.

## Data flow
None.

## UX impact
Occupies space product wants for **AI context rail**; currently no drag-drop or document list.

## Current issues
Misaligned with product vision for contextual AI.

## Old vs new comparison
Modal overlay used footer/sidebar patterns differently.

## Reuse potential
Replace content wholesale with `AiContextRail` shell.

## Change risk
Low — copy-only today.

## Notes
Prompt 6 updated hint text for BEAP (click fields for refine).


---

