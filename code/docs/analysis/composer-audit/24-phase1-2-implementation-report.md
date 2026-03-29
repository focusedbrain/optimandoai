# Phase 1–2 implementation report

## Changed files

| File | Change |
|------|--------|
| `apps/electron-vite-project/src/components/EmailInboxView.tsx` | Compose-mode grid: single column `1fr`; left inbox column not rendered while `composeMode` is set. |
| `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` | Full-width shell alignment (`minmax(0,1fr) 260px`); larger pBEAP/qBEAP editors; spacing; `RecipientHandshakeSelect` from `@ext/beap-messages`; `HandshakeRecord`-based recipient mapping; context-rail aside copy. |
| `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` | Matching grid/rail shell, larger body editor, typography/spacing parity with BEAP. |
| `docs/analysis/composer-audit/23-implementation-precheck.md` | Answers: BeapInboxDashboard import graph, `orchestratorSessionId` logging-only, multiple PDF paths. |

## What was implemented

### Phase 1 — layout recovery (`EmailInboxView`)

- **`gridCols`:** When `composeMode` is `'beap' | 'email'`, template is **`1fr`** only (no 320px list column).
- **Left column:** Toolbar + message list wrapper is **not mounted** during compose, so the inline composer is the sole main-region child and uses the full inbox workspace width (below `App` header / `HybridSearch`).
- **Bulk inbox:** No structural change — `EmailInboxBulkView` already uses a full-viewport overlay for compose; it inherits composer UI updates only.

### Phase 2 — field sizing and component parity

**BEAP (`BeapInlineComposer`)**

- Public editor: **`rows={14}`**, **`minHeight: 260`**, slightly larger type (`14px`) and padding.
- Encrypted editor: **`rows={12}`**, **`minHeight: 220`**, same typography treatment.
- Form **section spacing** increased (`gap: 20`, padding `18px 20px`).
- **Handshake UI:** Replaced native `<select>` with shared **`RecipientHandshakeSelect`** (`theme="dark"`) — same component family as extension/sidepanel, card-based selection and loading/error states.
- **Recipient mapping:** `listHandshakes('active')` is now typed as **`HandshakeRecord[]`**; `handshakeRecordToSelectedRecipient` maps to `SelectedHandshakeRecipient` for `executeDeliveryAction` (replaces legacy ledger-shaped mapper that did not match IPC records).
- **Right rail:** Narrow **260px** column; labeled **“CONTEXT RAIL”** with copy that AI document upload remains in the **top bar** (no upload in rail yet). Hints retained below.

**Email (`EmailInlineComposer`)**

- Same **grid** (`minmax(0,1fr) 260px`) and **context rail** treatment as BEAP.
- Body textarea **`minHeight: 280`**, `14px` / `lineHeight: 1.5`, increased padding.
- Header title styling aligned with BEAP composer.

### Intentionally deferred (per scope)

- **Parser:** No changes to `main.ts` PDF route, `pdf-extractor.ts`, or HybridSearch extraction.
- **AI context in composer rail:** No drag/drop, no `contextDocs` lift — rail is placeholder + hints only.
- **Orchestrator session:** Still not passed into `BeapPackageConfig` / `executeDeliveryAction` (precheck: logging only today).
- **Further extension parity:** `DeliveryMethodPanel`, document reader, etc. — not imported (higher bundle/UX scope).
- **BeapInboxDashboard:** Not removed; only documented as unused in renderer imports.

## Risks introduced

| Risk | Mitigation |
|------|------------|
| **Handshake mapping change** | IPC `HandshakeRecord` path is the documented contract for `listHandshakes`; old ledger-style mapper removed. If any runtime returned non-`HandshakeRecord` rows, send could regress — **QA private send + key checks**. |
| **`RecipientHandshakeSelect` in Electron** | Same package alias as other `@ext/beap-messages` imports; theme `dark` matches dashboard. |
| **Compose without list** | User cannot pick another message from the list without closing compose — acceptable for “focus compose” UX; **Esc** still closes compose. |

## Manual QA checklist

- [ ] **Inbox (normal):** Open BEAP compose — **no** left message list; composer spans main area; **Esc** closes.
- [ ] **Inbox (normal):** Open Email compose — same layout; send/cancel.
- [ ] **Inbox:** Close compose — list and three-column browse layout return when applicable.
- [ ] **BEAP private:** Handshake list loads; pick a card with keys; **Send** succeeds; invalid/incomplete handshake still blocked by existing validation.
- [ ] **BEAP public + email delivery:** To field + send still works.
- [ ] **Draft refine:** Click public / encrypted / email body — HybridSearch refine still connects; **USE** applies text.
- [ ] **Bulk inbox:** Open BEAP/Email compose — overlay still full screen; no layout regression.
- [ ] **Attachments:** BEAP package attachments and email attachments unchanged.
- [ ] **Reply flows:** Reply-driven compose still prefills (handshake / email) if used.

---

*See `23-implementation-precheck.md` for PDF path and orchestrator logging notes.*
