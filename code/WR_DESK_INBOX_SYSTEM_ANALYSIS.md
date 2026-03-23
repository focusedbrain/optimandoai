# WR Desk™ Inbox System — Code & Architecture Analysis

**Date:** 2025-03-17  
**Scope:** Electron app inbox (Bulk + Normal), message types, AI features, compose flow

---

## Part 1 — Project Structure

### 1.1 Top-Level Directories and Files

```
code/
├── apps/                    # Electron app, extension-chromium
├── packages/                # ingestion-core, beap-pod, coordination-service, relay-server, shared, shared-extension, hello
├── scripts/
├── docs/
├── logs/
├── node_modules/
├── package.json             # Root monorepo (@repo/root)
└── ...

code/apps/electron-vite-project/
├── src/                     # React UI, components, stores
│   ├── components/          # EmailInboxView, EmailInboxBulkView, EmailMessageDetail, etc.
│   ├── stores/              # useEmailInboxStore.ts
│   └── App.tsx
├── electron/                # Main process, preload, IPC
│   └── main/
│       ├── email/           # ipc.ts, messageRouter.ts, plainEmailConverter.ts, gateway.ts, syncOrchestrator.ts, remoteDeletion.ts
│       ├── handshake/
│       ├── llm/              # config.ts, aiProviders.ts, llmStream.ts
│       └── vault/
├── package.json
└── electron-builder.config.cjs
```

### 1.2 Framework, State, Routing, Dependencies

```
FRAMEWORK: React 18 + Electron 30 + Vite 5
STATE MANAGEMENT: Zustand (useEmailInboxStore.ts, useBeapInboxStore in extension)
ROUTING: No router. View switching via `activeView` in App.tsx: 'analysis' | 'handshakes' | 'beap-inbox' | 'settings'
         Inbox toggle: `inboxBulkMode` boolean — when true renders EmailInboxBulkView, else EmailInboxView

KEY DEPENDENCIES:
  UI: react, react-dom, zustand
  AI/LLM: (no direct deps in package.json; main process uses Ollama, aiProviders, llmStream)
  Email: imap, mailparser, nodemailer, @types/imap, @types/nodemailer
  Message handling: pdfjs-dist, tesseract.js, jose, libsodium-wrappers
  DB: better-sqlite3
  Other: express, ws, node-fetch, canvas, keytar
```

**DIRECTORY TREE (2 levels deep):**

```
code/
├── apps/
│   ├── electron-vite-project/
│   ├── extension-chromium/
│   └── ...
├── packages/
│   ├── ingestion-core/
│   ├── beap-pod/
│   ├── coordination-service/
│   ├── relay-server/
│   ├── shared/
│   ├── shared-extension/
│   └── hello/
├── scripts/
├── docs/
├── logs/
├── node_modules/
├── package.json
└── ...
```

---

## Part 2 — Inbox Architecture

### COMPONENT: EmailInboxBulkView (Bulk Inbox)

| Field | Value |
|-------|-------|
| **FILE** | `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` |
| **STATE** | `expandedMessageId`, `providerSectionExpanded`, `providerAccounts`, `aiOutputs`, `pendingLinkUrl`; store: `useEmailInboxStore` (messages, bulkPage, bulkBatchSize, multiSelectIds, etc.) |
| **PROPS** | `accounts`, `selectedMessageId`, `onSelectMessage`, `selectedAttachmentId`, `onSelectAttachment` |
| **CHILDREN** | `EmailMessageDetail`, `EmailProvidersSection`, `EmailConnectWizard`, `LinkWarningDialog` |
| **STATUS** | `working` |
| **ISSUES** | AI output is placeholder; Augment button disabled; compose buttons not in this view |

### COMPONENT: EmailInboxView (Normal/Focused Inbox)

| Field | Value |
|-------|-------|
| **FILE** | `apps/electron-vite-project/src/components/EmailInboxView.tsx` |
| **STATE** | `providerAccounts`, `isLoadingProviderAccounts`, `selectedProviderAccountId`, `showEmailConnectModal`; store: `useEmailInboxStore` |
| **PROPS** | `accounts`, `selectedMessageId`, `onSelectMessage`, `selectedAttachmentId`, `onSelectAttachment` |
| **CHILDREN** | `EmailInboxToolbar`, `EmailMessageDetail`, `BeapMessageImportZone`, `EmailProvidersSection`, `EmailConnectWizard`, `InboxMessageRow`, `InboxDetailAiPanel` (inline) |
| **STATUS** | `working` |
| **ISSUES** | AI panel returns placeholder; compose buttons not in this view |

### COMPONENT: Message List (InboxMessageRow)

| Field | Value |
|-------|-------|
| **FILE** | `apps/electron-vite-project/src/components/EmailInboxView.tsx` (lines 94–268) |
| **STATE** | None (stateless row) |
| **PROPS** | `message`, `selected`, `bulkMode`, `multiSelected`, `onSelect`, `onToggleMultiSelect` |
| **CHILDREN** | None |
| **STATUS** | `working` |
| **ISSUES** | Body preview uses `.replace(/\s+/g, ' ')` — collapses line breaks |

### COMPONENT: Message Detail Panel

| Field | Value |
|-------|-------|
| **FILE** | `apps/electron-vite-project/src/components/EmailMessageDetail.tsx` |
| **STATE** | `beapPanelOpen`, `pendingLinkUrl`; store: `selectedAttachmentId`, `toggleStar`, `archiveMessages`, `deleteMessages`, `cancelDeletion` |
| **PROPS** | `message`, `selectedAttachmentId`, `onSelectAttachment` |
| **CHILDREN** | `InboxAttachmentRow`, `LinkWarningDialog` |
| **STATUS** | `working` |
| **ISSUES** | None |

### COMPONENT: Right-Side AI Panel (Normal Inbox)

| Field | Value |
|-------|-------|
| **FILE** | `apps/electron-vite-project/src/components/EmailInboxView.tsx` (lines 37–91) |
| **STATE** | `aiOutput`, `loading` (local state) |
| **PROPS** | `messageId` |
| **CHILDREN** | Buttons: Summarize, Draft Reply; output area |
| **STATUS** | `partially working` |
| **ISSUES** | Handlers call `window.emailInbox.aiSummarize` / `aiDraftReply` → IPC returns **placeholder** `'[AI summary]'` and `'[AI draft]'` in `ipc.ts:856–863`. No real LLM call. Panel shows empty state until user clicks; then shows placeholder text. |

### COMPONENT: Batch Selection Logic

| Field | Value |
|-------|-------|
| **FILE** | `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` |
| **STATE** | `multiSelectIds: Set<string>`, `bulkBatchSize: 10` (line 140) |
| **ACTIONS** | `toggleMultiSelect`, `clearMultiSelect`; `handleSelectAll` in `EmailInboxBulkView` |
| **BATCH SIZE** | `bulkBatchSize: 10` — hardcoded in store, no UI to change |
| **STATUS** | `working` |
| **ISSUES** | Batch size fixed at 10; no user config |

---

## Part 3 — Message Types & Routing

### Type A: Depackaged Email (email converted to BEAP)

| Field | Value |
|-------|-------|
| **Fetch** | `syncOrchestrator.ts`, `gateway.ts` → IMAP/Microsoft Graph API. `messageRouter.ts` detects plain vs BEAP. |
| **Conversion** | `plainEmailConverter.ts` → `plainEmailToBeapMessage`, `convertPlainToBeapFormat` → `PlainEmailDepackagedFormat` with `trustLevel: 'depackaged'` |
| **Storage** | `plainEmailIngestion.ts` → `inbox_messages.depackaged_json` |
| **Reply path** | Standard email via SMTP/Graph API. `EmailComposeOverlay` exists. |
| **Email composer** | `exists` — File: `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` |
| **Free-tier signature** | `EMAIL_SIGNATURE = '\n\n—\nAutomate your inbox. Try wrdesk.com\nhttps://wrdesk.com'` in `EmailComposeOverlay.tsx:8` and `extension-chromium/src/beap-messages/hooks/useReplyComposer.ts:50` |

### Type B: Native BEAP Message

| Field | Value |
|-------|-------|
| **Receive** | `messageRouter.ts` detects BEAP via `.beap` attachment, handshake capsule, qBEAP/pBEAP package, JSON attachment. Routes to `insertPendingP2PBeap` or `insertPendingPlainEmail`. |
| **Storage** | `inbox_messages` + `p2p_pending_beap` for BEAP; `plain_email_inbox` for plain. |
| **Reply path** | BEAP Capsule Builder. Extension: `BeapPackageBuilder.ts`, `BeapDraftComposer`, `useReplyComposer`. |
| **Capsule Builder** | `exists` — Extension: `BeapPackageBuilder.ts`, `BeapDraftComposer.tsx`; Electron: `capsuleBuilder.ts` (main), `window.analysisDashboard.openBeapDraft` |

### Compose Buttons (Bottom-Right Corner)

| Field | Value |
|-------|-------|
| **EMAIL COMPOSER** | `exists` — File: `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` |
| **CAPSULE BUILDER** | `exists` — Extension: `BeapPackageBuilder.ts`, `BeapDraftComposer.tsx`; Electron: `main.ts` openBeapPopup |
| **COMPOSE BUTTONS** | `removed from current view` — Buttons exist in `BeapInboxDashboard.tsx` (lines 492–518) and `BeapBulkInboxDashboard.tsx` (lines 183–209), but **App.tsx** renders `EmailInboxView` and `EmailInboxBulkView` for the inbox, **not** `BeapInboxDashboard` / `BeapBulkInboxDashboard`. So `[✉+] Email` and `[+ BEAP]` are **not in the current inbox UI**. |
| **REPLY ROUTING LOGIC** | Message type determines reply: depackaged → `EmailComposeOverlay`; native BEAP → `BeapDraftComposer` / `BeapPackageBuilder`. |
| **Re-insert location** | Add compose buttons to `EmailInboxView.tsx` (right panel when no message selected: "Import & Compose" area) and/or `EmailInboxBulkView.tsx` (floating bottom-right). Wire to `window.analysisDashboard?.openEmailCompose?.()` and `window.analysisDashboard?.openBeapDraft?.()`. |

---

## Part 4 — AI Features Audit

| Feature | Component/File | Wired? | Functional? | Notes |
|---------|---------------|--------|-------------|-------|
| **Chat with message** (search + ask) | `HybridSearch.tsx`, `HandshakeChatSidebar.tsx` | ✅ | ✅ | `chatWithContextRag` → `handshake:chatWithContextRag` in `main.ts`. Uses RAG, block retrieval, LLM streaming. |
| **Summarize** button | `InboxDetailAiPanel` (EmailInboxView), `EmailInboxBulkView` | ✅ | ❌ | Handler calls `window.emailInbox.aiSummarize` → IPC `inbox:aiSummarize` returns `{ summary: '[AI summary]' }` (placeholder). |
| **Draft Reply** button | Same | ✅ | ❌ | Handler calls `window.emailInbox.aiDraftReply` → IPC `inbox:aiDraftReply` returns `{ draft: '[AI draft]' }` (placeholder). |
| **AI Auto-Sort** (Bulk Inbox) | `EmailInboxBulkView` toolbar | ✅ | ❌ | Handler calls `window.emailInbox.aiCategorize` → IPC `inbox:aiCategorize` returns `{ categorized: count }`; no LLM call, no real categorization. |
| **Augment** button | `EmailInboxBulkView` line 684 | ✅ | ❌ | Button disabled, `title="Augment (coming soon)"`. |
| **Categorize** button | `EmailInboxToolbar`, `EmailInboxBulkView` | ✅ | ⚠️ | Manual: `window.prompt('Category name')` → `setCategory`. No AI. |

### Broken Feature Details

| Feature | Button rendered? | onClick? | Calls API/LLM? | Where it breaks |
|--------|------------------|----------|----------------|-----------------|
| Summarize | ✅ | ✅ | ❌ | `ipc.ts:856` — returns hardcoded `'[AI summary]'` |
| Draft Reply | ✅ | ✅ | ❌ | `ipc.ts:864` — returns hardcoded `'[AI draft]'` |
| AI Auto-Sort | ✅ | ✅ | ❌ | `ipc.ts:872` — returns `{ categorized: count }`; no LLM call, no `sort_category` update |

### LLM Configuration

| Field | Value |
|------|------|
| **LLM used** | Ollama (default; UI shows `llama3.1:8b` when available). |
| **Config** | `apps/electron-vite-project/electron/main/llm/config.ts` — `ollamaPort: 11434`, `activeModelId: 'mistral:7b-instruct-q4_0'`, `MODEL_CATALOG` with many models. |
| **Endpoint** | Ollama via `ollama-manager.ts`, `ollama-manager-enhanced.ts`; cloud via `aiProviders.ts` (OpenAI, Anthropic, Google, xAI). |
| **Prompt format** | Handshake chat: `main.ts` `handshake:chatWithContextRag` builds system message + context blocks from RAG. Inbox AI: **no prompts** — placeholders only. |

---

## Part 5 — AI Panel (Normal Inbox Right Side)

| Field | Value |
|-------|------|
| **Component** | Inline `InboxDetailAiPanel` in `EmailInboxView.tsx` (lines 37–91) |
| **Current content** | Empty state: "Summarize, draft reply, or augment this message." + "Use the buttons above to get started." After click: placeholder `[AI summary]` or `[AI draft]`. |
| **CSS** | `.inbox-detail-ai` (App.css:800–895): flex column, `rgba(255,255,255,0.02)`, rounded corners; `.inbox-detail-ai-output` scrollable; `.inbox-detail-ai-empty` centered, min-height 200px. |
| **Sectioning** | No tabs. Single output area for summary or draft. |

**Missing sections** (per spec): Summary, Urgency score, Draft reply, Strategic planning, Archive recommendation, Response necessity — none implemented; only one placeholder output area.

---

## Part 6 — Bulk Inbox Sorting & Auto-Sort

| Item | Status |
|------|--------|
| **AI Auto-Sort button** | Exists; wired to `handleAiAutoSort` → `window.emailInbox.aiCategorize`; returns placeholder. |
| **Batch processing** | `multiSelectIds` in store; `toggleMultiSelect`, `clearMultiSelect`, `handleSelectAll` in `EmailInboxBulkView`. |
| **Batch size** | `bulkBatchSize: 10` in `useEmailInboxStore.ts:140`; used for `options.limit` and `options.offset`. |

| Item | Status |
|------|--------|
| **Sorting logic** | `sort_category` in `InboxMessage`; badges shown. AI Auto-Sort does not update `sort_category` (placeholder only). |
| **Color coding** | Source badges: B (BEAP), ✉ (plain). Selection: `.bulk-view-row--multi`, `.bulk-view-row--focused` (purple). Deleted: red badge. |
| **Spam/irrelevant** | No dedicated spam detection. |
| **Auto-delete / grace period** | `remoteDeletion.ts` — `queueRemoteDeletion` sets `purge_after`; `executePendingDeletions` runs every 5 min. |
| **Remote mailbox sync** | `gateway.ts` → `syncAccount`; `remoteDeletion.ts` → `executePendingDeletions` calls provider delete. |

---

## Part 7 — Configuration & User Preferences

| Item | Status |
|------|--------|
| **AI behavior instructions** | No inbox-specific AI instructions. Handshake chat uses `chatWithContextRag` system prompts. |
| **Context uploads** | Extension: `user-context-pdf-upload`, `publisher-context-pdf-upload` in content-script. Handshake: `uploadHsProfileDocument`. No inbox-specific context upload. |
| **Sorting rules** | No configurable rules; only `sort_category` on messages. |
| **Batch size** | `bulkBatchSize: 10` in `useEmailInboxStore.ts`; no user setting. |

---

## Part 8 — Summary of Broken / Missing Features

### CRITICAL (blocks core workflow)

1. **Compose buttons missing** — `[✉+] Email` and `[+ BEAP]` are in `BeapInboxDashboard`/`BeapBulkInboxDashboard`, but the inbox uses `EmailInboxView`/`EmailInboxBulkView`, which do not render them.  
   - **Files:** `App.tsx`, `EmailInboxView.tsx`, `EmailInboxBulkView.tsx`  
   - **Fix:** Add `ComposeButtons` or equivalent to `EmailInboxView` (Import & Compose area) and `EmailInboxBulkView` (floating bottom-right). Wire to `window.analysisDashboard.openEmailCompose` and `openBeapDraft`.  
   - **Complexity:** small

### HIGH (important features not working)

2. **Summarize returns placeholder** — IPC returns `'[AI summary]'` in `ipc.ts:856`.  
   - **Files:** `electron/main/email/ipc.ts`  
   - **Fix:** Implement real LLM call (fetch message, build prompt, call Ollama/cloud provider, return summary).  
   - **Complexity:** medium

3. **Draft Reply returns placeholder** — IPC returns `'[AI draft]'` in `ipc.ts:864`.  
   - **Files:** `electron/main/email/ipc.ts`  
   - **Fix:** Implement real LLM call (fetch message, build reply prompt, return draft).  
   - **Complexity:** medium

4. **AI Auto-Sort does nothing** — No LLM call or `sort_category` update.  
   - **Files:** `electron/main/email/ipc.ts`  
   - **Fix:** Implement `inbox:aiCategorize` with LLM call, then update `inbox_messages.sort_category` via IPC.  
   - **Complexity:** medium

### MEDIUM (enhancements needed)

5. **AI panel lacks sections** — No summary, urgency, draft, strategic planning, archive recommendation, response necessity.  
   - **Files:** `EmailInboxView.tsx` (InboxDetailAiPanel)  
   - **Fix:** Add sectioned layout for each output type; wire to real AI handlers.  
   - **Complexity:** medium

6. **Augment button disabled** — "Augment (coming soon)".  
   - **Files:** `EmailInboxBulkView.tsx:684`  
   - **Fix:** Define and implement augment behavior (e.g. enrich with context).  
   - **Complexity:** large

7. **Batch size not configurable** — Fixed at 10.  
   - **Files:** `useEmailInboxStore.ts`  
   - **Fix:** Add user setting or UI control for `bulkBatchSize`.  
   - **Complexity:** small

### LOW (nice to have)

8. **Inbox AI instructions** — No custom instructions for AI tone/style.  
   - **Files:** `SettingsView.tsx`, `ipc.ts`  
   - **Fix:** Add settings field and pass to AI handlers.  
   - **Complexity:** medium

9. **Inbox context uploads** — No PDF/document context for inbox AI.  
   - **Files:** New component or extend Settings.  
   - **Fix:** Add upload + embedding pipeline for inbox context.  
   - **Complexity:** large

---

## Appendix: Key File Paths

| Area | Path |
|------|------|
| App entry | `apps/electron-vite-project/src/App.tsx` |
| Inbox store | `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` |
| Normal inbox | `apps/electron-vite-project/src/components/EmailInboxView.tsx` |
| Bulk inbox | `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` |
| Message detail | `apps/electron-vite-project/src/components/EmailMessageDetail.tsx` |
| Toolbar | `apps/electron-vite-project/src/components/EmailInboxToolbar.tsx` |
| Inbox IPC | `apps/electron-vite-project/electron/main/email/ipc.ts` |
| Message router | `apps/electron-vite-project/electron/main/email/messageRouter.ts` |
| Plain converter | `apps/electron-vite-project/electron/main/email/plainEmailConverter.ts` |
| Email compose | `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` |
| Compose buttons | `apps/electron-vite-project/src/components/ComposeButtons.tsx` |
| Legacy dashboards (not used) | `BeapInboxDashboard.tsx`, `BeapBulkInboxDashboard.tsx` |
| LLM config | `apps/electron-vite-project/electron/main/llm/config.ts` |
| Styles | `apps/electron-vite-project/src/App.css` |
