# AI Frame & Reply Composer Analysis

**Scope:** Current architecture only (read-only inventory). Two inbox surfaces exist in Electron: **Normal Inbox** (`EmailInboxView.tsx`) and the **BEAP store inbox** (`BeapInboxDashboard.tsx`), which embeds shared extension UI (`BeapMessageDetailPanel`). They differ materially.

---

## AI Frame Component

### Normal Inbox — `InboxDetailAiPanel` (structured email AI)

| Item | Detail |
|------|--------|
| **File** | `apps/electron-vite-project/src/components/EmailInboxView.tsx` |
| **Component** | `InboxDetailAiPanel` (local function, lines 80–854) |
| **Parent** | Default export `EmailInboxView` renders it inside `.inbox-detail-ai` when `selectedMessageId` is set (lines 1934–1956). |

**Sections (Response Needed, Summary, Urgency, Action Items, Suggested action, Draft Reply):**

- **Inside “Analysis” tab** (`visibleSections.has('analysis')`, lines 582–687): Response Needed (585–600), Summary (602–616), Urgency (618–634), Action Items (636–655), Suggested action (657–685). Labels use `inbox-detail-ai-row-label` / `inbox-detail-ai-row-value`.
- **Standalone Summary tab** (690–721): Shown when `visibleSections.has('summary') && !visibleSections.has('analysis')` — duplicate Summary + Urgency block without the other analysis rows.
- **Draft Reply** (723–850): Rendered when `visibleSections.has('draft')` — not inside the Analysis tab; it is its own scroll section with textarea, attachments (depackaged only), and toolbar.

**Draft section toggle (selectable / deselectable):**

- **State:** `visibleSections` — `useState<Set<string>>` initialized to `new Set(['summary', 'draft', 'analysis'])` at **line 94**.
- **Handler:** `toggleSection` **lines 490–502** — adds/removes section keys `'summary' | 'draft' | 'analysis'`; refuses to remove the last remaining section (`if (next.size > 1)` before delete).
- **UI:** Three `<button>` toggles in `.inbox-detail-ai-action-bar` (**lines 508–562**): Summary, Draft, Analysis. Each uses `onClick` calling `toggleSection(...)` and optionally triggers generation (e.g. showing Draft calls `handleDraftReply()` when turning on and draft empty — **lines 530–535**).
- **CSS:** Active state = class `inbox-detail-ai-section-toggle--active` (**lines 511, 529, 547**). Inactive toggles get reduced opacity; active uses purple tint — see `App.css` **1575–1626** (`inbox-detail-ai-section-toggle`, `--active`). Checkbox glyphs: `☑` / `☐` in `.inbox-detail-ai-section-toggle-check` (**lines 522–524, 540–542, 558–560**).

**Draft textarea “sub-focus” (chat refinement, separate from section toggle):**

- **State:** `draftSubFocused` **line 93**; `setDraftSubFocused` on textarea focus/blur **lines 764–770**.
- **Visual:** ✏️ when `draft && draftSubFocused` (**732–739**); purple connection chrome via `ai-draft-connected` when `draftRefineConnected && draftRefineMessageId === messageId` (**725–728**, `App.css` ~4810).

---

### BEAP Inbox dashboard — `BeapMessageDetailPanel` (split view)

| Item | Detail |
|------|--------|
| **File** | `apps/extension-chromium/src/beap-messages/components/BeapMessageDetailPanel.tsx` |
| **Parent** | `BeapInboxDashboard` (**lines 497–505** in `apps/electron-vite-project/src/components/BeapInboxDashboard.tsx`) when `effectiveSelectedId` is set. |

**Right “AI” column is not the same as Normal Inbox:**

- **Right panel:** `AiOutputPanel` (**lines 1239–1244** BeapMessageDetailPanel) — header **“AI Analysis”** (**727–732**), expandable query/response **entries** from `useBeapMessageAi`, empty state “AI analysis will appear here” (**801**). No Response Needed / Summary / Urgency / Action Items / Suggested action rows.
- **Reply composer** sits on the **left** in `MessageContentPanel` footer: `BeapReplyComposer` (**495–502**), driven by `useReplyComposer` (**1049–1051**).

---

## Reply Mode Detection

### Extension (canonical `getResponseMode`)

| Item | Detail |
|------|--------|
| **Function** | `getResponseMode(message: BeapMessage): ReplyMode` in `apps/extension-chromium/src/beap-messages/hooks/useReplyComposer.ts` **lines 73–75** |
| **Rule** | `'beap'` if `message.handshakeId !== null`, else `'email'`. |
| **Duplicate** | `useBeapInboxStore.getResponseMode` **lines 310–312** in `useBeapInboxStore.ts` — same rule. |
| **UI branch** | `useReplyComposer` sets `mode` **line 257**; `BeapReplyComposer` shows mode badge (**BeapReplyComposer.tsx** ~74–112). `MessageContentPanel` header shows “Reply via BEAP” vs “Reply via Email” from `hasHandshake = message.handshakeId !== null` (**224–325** BeapMessageDetailPanel). |

### Normal Inbox (Electron `InboxMessage`, not `BeapMessage`)

| Item | Detail |
|------|--------|
| **No `getResponseMode` import** | Mode is inferred inline: `isDepackaged = message?.source_type === 'email_plain'` **line 504** (`EmailInboxView.tsx` / `InboxDetailAiPanel`). |
| **Field** | `source_type === 'email_plain'` → email-style UI (attachments on draft, “Send via Email”). Otherwise BEAP-style **label** on send button only. |
| **BEAP path (current)** | **Does not** send a BEAP capsule from the AI panel. `handleSendDraft` (**1570–1628**) for non-depackaged: `navigator.clipboard.writeText(draft)`, `window.analysisDashboard?.openBeapDraft?.()`, returns `false`. |
| **Email path** | `window.emailAccounts.sendEmail(accountId, { to, subject, bodyText, attachments })` **1608–1614** — preload maps to IPC `email:sendEmail`. |

---

## Draft Composer

### Normal Inbox (`InboxDetailAiPanel`)

| Item | Detail |
|------|--------|
| **Hook/store** | Local `useState` for draft text (`draft`, `editedDraft`, **lines 87–90**), attachments (**91**), plus `useDraftRefineStore` for chat refinement (**105–112**). **Not** `useReplyComposer`. |
| **State shape (effective)** | `draft: string \| null`, `editedDraft: string`, `attachments: DraftAttachment[]`, loading/error flags; analysis from `NormalInboxAiResult` stream. |
| **Component** | Single **`<textarea>`** **lines 758–784** — not `CapsuleDraftEditor` / not capsule fields. |
| **Generate draft** | `window.emailInbox.aiDraftReply(messageId)` **389–410** → IPC `inbox:aiDraftReply` (main: `apps/electron-vite-project/electron/main/email/ipc.ts` ~3211+). |

**Send chains:**

| Mode | Button | Handler | Bridge | Main process |
|------|--------|---------|--------|--------------|
| **Depackaged (email)** | “Send via Email” **831** | `handleSend` **451–466** → `onSendDraft` | `window.emailAccounts.sendEmail` | `ipcMain.handle('email:sendEmail', …)` in `electron/main/email/ipc.ts` **~1140** → `emailGateway.sendEmail` |
| **BEAP-labelled (non–email_plain)** | “Send via BEAP” **834** | Same `handleSend` | Clipboard + `window.analysisDashboard.openBeapDraft()` | **No** inbox IPC send; opens external BEAP draft flow |

Parent `handleSendDraft` is defined on `EmailInboxView` **1570–1628**.

### Extension BEAP inbox (`useReplyComposer` + `BeapReplyComposer`)

| Item | Detail |
|------|--------|
| **Hook** | `useReplyComposer` — **React hook** in `useReplyComposer.ts` (**export lines 251–569**). |
| **State shape** | `ReplyComposerState`: `mode`, `draftText`, `attachments`, `isSending`, `isGeneratingDraft`, `sendResult`, `error`, `isDirty` (**91–115**). No separate encrypted field; single `draftText` textarea (**BeapReplyComposer**). |
| **BEAP send** | `sendReply` **342–454**: `buildPackage(packageConfig)` from extension `services`; on success `setDraftReply(..., { status: 'sent' })`. **Does not** call `executeEmailAction` on the BEAP branch (email branch does **421**). |
| **Email send** | Same `sendReply`: `buildPackage` + `executeEmailAction(buildResult.package, packageConfig)` **414–421**. |

---

## Capsule Builder Location

| Area | Path | Notes |
|------|------|--------|
| **Extension** | `apps/extension-chromium/src/beap-builder/` | Components: `CapsuleSection.tsx`, `EnvelopeSection.tsx`, `EnvelopeSummaryPanel.tsx`, `DeliveryOptions.tsx`, `ExecutionBoundaryPanel.tsx`, `ExecutionBoundarySection.tsx`, `BeapDocumentReaderModal.tsx`, `AttachmentStatusBadge.tsx`, `VisionFallbackButton.tsx`; plus services (`parserService`, `useEnvelopeGenerator`, etc.). **No** `CapsuleBuilder.tsx` / `BeapCapsuleComposer.tsx` filenames in repo (glob search). |
| **Electron renderer** | **No** full capsule builder parallel to extension. Related: `CapsuleUploadZone.tsx` (import `.beap` / initiate validation UX), `BeapMessageImportZone.tsx`. |
| **Electron main** | `electron/main/handshake/capsuleBuilder.ts`, `capsuleTransport.ts`, `capsuleHash.ts`, etc. — **main-process** packaging/transport, not a React “builder” UI. |

**Fields for native BEAP reply:** Extension `useReplyComposer` BEAP path uses **single** `messageBody: content` in `BeapPackageConfig` (**369–370**); attachments array passed empty (**373**). No public/encrypted split in composer state.

---

## Reusable Patterns

| Pattern | Description |
|---------|-------------|
| **Section visibility (Normal Inbox)** | `Set<string>` + `toggleSection` + `--active` CSS + minimum one section enforced. **Extendable** by adding new keys (e.g. `'encryptedDraft'`, `'session'`) and parallel toggle buttons — same handler pattern applies. |
| **Draft ↔ chat scope** | `draftSubFocused` + `editingDraftForMessageId` in `useEmailInboxStore` + `useDraftRefineStore.connect`. **Extendable** if each scoped region gets a parallel “connect” id or sub-focus key. |
| **Depackaged vs BEAP (Normal Inbox)** | `source_type === 'email_plain'` gates attachments and real email send vs clipboard + open BEAP draft. |
| **Extension BEAP reply** | `handshakeId` gates mode; `BeapReplyComposer` is presentational; all logic in `useReplyComposer`. |

**Selectable sections:** Normal Inbox uses **explicit section toggles** (Summary / Draft / Analysis), not a generic “multi-select” list. The **draft row** uses **focus** for refinement (✏️ / connected border), not the same mechanism as `visibleSections`.

---

## IPC / main-process index (Normal Inbox AI + email send)

| Channel | File (approx.) |
|---------|----------------|
| `inbox:aiSummarize` | `electron/main/email/ipc.ts` (~3179+) |
| `inbox:aiDraftReply` | same (~3211+) |
| `inbox:aiAnalyzeMessageStream` | same (+ chunk/done/error listeners in preload) |
| `email:sendEmail` | `electron/main/email/ipc.ts` ~1140; gateway `gateway.ts` `sendEmail` |

---

*Generated for Native BEAP™ Response — Analysis Prompt 1 of 4.*
