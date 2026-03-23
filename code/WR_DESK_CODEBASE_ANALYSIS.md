# WR Desk — Codebase Analysis for Email Inbox Feature

**Date:** 2025-03-15  
**Purpose:** Architectural reference for building the Email Inbox feature set — email pulling, BEAP depackaging, inbox views, message/attachment chat integration, and remote mailbox deletion.

---

## 1. PROJECT STRUCTURE & BUILD SYSTEM

### Directory Tree (2–3 levels of `apps/electron-vite-project/src`)

```
src/
├── main.tsx                    # Renderer entry
├── App.tsx                     # Root component, view routing
├── ErrorBoundary.tsx
├── index.css
├── App.css
├── vite-env.d.ts
├── auth/                       # OIDC/Keycloak auth
│   ├── capabilities.ts
│   ├── discovery.ts
│   ├── jwtVerify.ts
│   ├── login.ts
│   ├── logout.ts
│   ├── loopback.ts
│   ├── oidcConfig.ts
│   ├── pkce.ts
│   ├── refresh.ts
│   ├── session.ts
│   ├── tokenStore.ts
│   └── README.md
├── components/
│   ├── analysis/               # Analysis canvas
│   ├── AnalysisCanvas.tsx
│   ├── BeapBulkInboxDashboard.tsx
│   ├── BeapInboxDashboard.tsx
│   ├── BeapInboxFirstRun.tsx
│   ├── BeapInboxView.tsx
│   ├── BeapMessageImportZone.tsx
│   ├── BeapMessageUploadZone.tsx
│   ├── CapsuleUploadZone.tsx
│   ├── HandshakeChatSidebar.tsx
│   ├── HandshakeContextSection.tsx
│   ├── HandshakeInitiateModal.tsx
│   ├── HandshakeView.tsx
│   ├── HandshakeWorkspace.tsx
│   ├── HybridSearch.tsx
│   ├── EmailComposeOverlay.tsx
│   ├── ComposeButtons.tsx
│   ├── SettingsView.tsx
│   └── ...
├── shims/                      # Extension shims for Electron
│   ├── handshakeRpc.ts
│   ├── hsContextProfilesRpc.ts
│   ├── ingress.ts
│   ├── envelope-evaluation.ts
│   ├── audit.ts
│   └── reconstruction.ts
└── utils/
```

**Electron main:** `apps/electron-vite-project/electron/main.ts`  
**Preload:** `apps/electron-vite-project/electron/preload.ts` → built as `dist-electron/preload.cjs`  
**Renderer entry:** `index.html` loads `/src/main.tsx` → `ReactDOM.createRoot(...).render(<App />)` with `ErrorBoundary`  
**Build tool:** Vite 5.1.6 (`vite.config.ts`)  
**Config:** `electron-builder.config.cjs`, `electron-builder.json`  
**Package manager:** pnpm (monorepo root at `code/`)  
**tsconfig.json:** `target: ES2020`, `strict: true`, paths for `@ext/*` shims to extension-chromium

### Key Dependencies

| Category | Package | Version |
|----------|---------|---------|
| React | react, react-dom | ^18.2.0 |
| State | zustand | ^5.0.11 |
| Router | None | View switching via `activeView` in App.tsx |
| UI | Custom | No MUI/Ant/Chakra |
| HTTP | node-fetch | 2.7.0 |
| IPC | Electron `ipcMain` / `ipcRenderer` via `contextBridge` | — |
| Email | imap, nodemailer, mailparser | ^0.8.19, ^7.0.11, ^3.9.0 |
| DB | better-sqlite3 | ^11.10.0 |
| Crypto | jose, libsodium-wrappers, @noble/post-quantum | — |
| Other | @repo/ingestion-core, tesseract.js, canvas, express, ws | — |

---

## 2. ELECTRON IPC ARCHITECTURE

### Renderer ↔ Main Communication

- **contextBridge** exposes typed bridges; no `ipcRenderer` exposed directly.
- **Invoke pattern:** `ipcRenderer.invoke('channel', ...args)` → `ipcMain.handle('channel', ...)`
- **Send pattern:** `ipcRenderer.send('REQUEST_THEME')` → `ipcMain.on('REQUEST_THEME', ...)`
- **Main→renderer:** `ipcMain.on(...)` or `BrowserWindow.webContents.send(...)`; preload uses `ipcRenderer.on('channel', handler)`.

### Preload Exposed Bridges

| Bridge | Purpose |
|--------|---------|
| `LETmeGIRAFFETHATFORYOU` | Screen capture (selectScreenshot, capturePreset, onCapture, onHotkey) |
| `analysisDashboard` | onOpen, onThemeChange, requestTheme, setTheme, openBeapInbox, openBeapDraft, openEmailCompose, openHandshakeRequest |
| `handshakeView` | listHandshakes, submitCapsule, importCapsule, acceptHandshake, declineHandshake, deleteHandshake, getPendingP2PBeapMessages, ackPendingP2PBeap, getPendingPlainEmails, ackPendingPlainEmail, importBeapMessage, vault ops, semanticSearch, chatWithContext, chatWithContextRag, initiateHandshake, buildForDownload, downloadCapsule, etc. |
| `emailAccounts` | listAccounts, getAccount, deleteAccount, sendEmail, sendBeapEmail, onAccountConnected |

### IPC Channel Naming

- `handshake:*` — handshake CRUD, vault, chat, semantic search
- `vault:*` — vault unlock, document pages, HS context profiles
- `email:*` — account management, list, send, sync (see `electron/main/email/ipc.ts`)
- `p2p:*` — P2P health, queue
- `relay:*` — relay setup
- `auth:*` — auth status
- `lmgtfy/*` — screen capture

### IPC Handler Registration

- **Main:** `main.ts` registers handlers inline (around lines 2149–4969). `registerEmailHandlers()` in `electron/main/email/ipc.ts` registers email handlers.
- **Typed IPC:** No shared TypeScript layer; preload uses runtime validators (`assertString`, `assertTheme`, etc.) and throws on invalid input.

### Long-Running Tasks

- **Chat streaming:** `handshake:chatWithContextRag` sends `handshake:chatStreamStart` and `handshake:chatStreamToken` via `event.sender.send()`.
- **Error propagation:** Errors thrown in handlers are caught and returned as `{ ok: false, error: message }` in email handlers; handshake handlers may throw.

---

## 3. STATE MANAGEMENT & DATA FLOW

### State Management

- **Zustand** in `useBeapInboxStore` (extension-chromium) for BEAP inbox messages.
- **No global Redux/RTK.** App state is mostly `useState` in `App.tsx` and passed down:
  - `activeView`, `selectedHandshakeId`, `selectedDocumentId`, `selectedMessageId`, `selectedAttachmentId`, `bulkMode`

### Store Structure (useBeapInboxStore)

- **Location:** `apps/extension-chromium/src/beap-messages/useBeapInboxStore.ts`
- **Core state:** `messages: Map<string, BeapMessage>`, `packages: Map<string, SanitisedDecryptedPackage>`, `selectedMessageId`, `newMessageIds`
- **Derived:** `getInboxMessages()`, `getHandshakeMessages(handshakeId)`, `getBulkViewPage(batchSize, pageIndex)`, `getPendingDeletionMessages()`
- **Actions:** `addMessage`, `selectMessage`, `archiveMessage`, `deleteMessage`, etc.

### Data Fetch Pattern

1. Component calls `window.handshakeView?.listHandshakes()` (or `emailAccounts?.listAccounts()`)
2. IPC invoke → main process
3. Main returns data; component `setState`/`setHandshakes`
4. UI re-renders

### Loading / Error / Success

- Components use `useState` for loading flags and error messages.
- Email handlers return `{ ok: true, data }` or `{ ok: false, error }`.
- No React Query; no optimistic updates in handshake/inbox flows.

### Example: Handshakes Data Flow

1. `HandshakeView` loads: `handshakeView.listHandshakes()` → IPC `handshake:list`
2. Main: `listHandshakeRecords(db, filter)` → returns rows
3. Component: `setHandshakes(records)`, `setContextBlockCounts(counts)`
4. `HandshakeWorkspace` receives `selectedHandshakeId`, `handshakes`; renders detail panel

---

## 4. HANDSHAKES FEATURE — FULL ARCHITECTURE (Reference Implementation)

### 4a. Data Model

**HandshakeRecord** (from `HandshakeView.tsx` and `db.ts`):

```ts
interface HandshakeRecord {
  handshake_id: string
  relationship_id: string
  state: 'PENDING_ACCEPT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
  sharing_mode: string | null
  created_at: string
  activated_at: string | null
  expires_at: string | null
  last_seq_received: number
  last_seq_sent?: number
  last_capsule_hash_received: string
  last_capsule_hash_sent?: string
  initiator_context_commitment?: string | null
  acceptor_context_commitment?: string | null
  p2p_endpoint?: string | null
  receiver_email?: string | null
  context_sync_pending?: boolean
  policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean }
}
```

**Storage:** SQLite vault DB (`handshake/db.ts`). Tables: `handshakes`, `context_blocks`, `context_block_versions`, `context_embeddings`, `seen_capsule_hashes`, `audit_log`, `outbound_capsule_queue`, `p2p_config`, `p2p_pending_beap`, `plain_email_inbox`.

**Attachments:** `context_blocks` store `payload` (JSON); documents are stored in vault with `payload_ref` for large content.

### 4b. BEAP Format

**Handshake capsules:** JSON with `schema_version`, `capsule_type` in `['initiate','accept','refresh','revoke']`.

**Message packages (qBEAP/pBEAP):** JSON with `header`, `metadata`, `envelope` or `payload` — no `capsule_type`.

**Depackaging:** Extension sandbox (`sandboxDepackage`) in `apps/extension-chromium/src/beap-messages/sandbox`. Stages: parse → validate → decrypt → policy gates → sandbox output.

**Parsing:** `parseBeapFile` in `beapDecrypt.ts`; `validateCapsule` in ingestion-core for handshake capsules.

**Ingestion:** `importBeapMessage` → `verifyImportedMessage` → `sandboxDepackage` → `useBeapInboxStore.addMessage(pkg, handshakeId)`.

### 4c. UI Components

| Component | Path | Purpose |
|-----------|------|---------|
| HandshakeView | `src/components/HandshakeView.tsx` | Three-panel layout: left list, center detail, right pending |
| HandshakeWorkspace | `src/components/HandshakeWorkspace.tsx` | Center detail + chat sidebar |
| HandshakeChatSidebar | `src/components/HandshakeChatSidebar.tsx` | Chat scoped to handshake |
| PendingSlideOut | `src/components/PendingSlideOut.tsx` | PENDING_ACCEPT items |
| CapsuleUploadZone | `src/components/CapsuleUploadZone.tsx` | .beap upload for handshake |
| AcceptHandshakeModal | `src/components/AcceptHandshakeModal.tsx` | Accept/decline UI |

**Left sidebar:** Non-virtualized list; `selectedHandshakeId` from parent; `StateBadge` for state; `shortId(id)` for display.

**Right panel:** `HandshakeWorkspace` + `HandshakeContextSection`; message content as plain text or structured data.

**Search:** `HybridSearch.tsx` — semantic search via `handshakeView.semanticSearch(query, scope, 20)`; `SearchScope`: 'context-graph' | 'capsules' | 'attachments' | 'all'.

### 4d. Chat Integration

- **Selection:** `selectedDocumentId`, `selectedAttachmentId` passed from parent to `HybridSearch`; `chatWithContextRag` sends `selectedDocumentId`, `selectedAttachmentId` to backend.
- **Chat component:** `HandshakeChatSidebar` — simple message list; `HandshakeChatSidebar` in HandshakeView is a minimal placeholder; RAG chat is in `HybridSearch` "Actions" tab.
- **AI model:** Ollama (default `llama3`) at `http://127.0.0.1:11434/api/chat`; also OpenAI, xAI, Anthropic, Google via `llmStream.ts`.
- **RAG:** `blockRetrieval.ts` + `hybridSearch.ts`; embeddings in `context_embeddings`; `chatWithContextRag` uses `blockRetrieval` with `selectedDocumentId`/`selectedAttachmentId`.

---

## 5. EMAIL PROVIDER CONNECTION (Current Implementation)

### Connection UI

- **BeapInboxDashboard:** `EmailConnectWizard` from `@ext/shared/components/EmailConnectWizard`; `EmailProvidersSection` from `@ext/wrguard/components/EmailProvidersSection`.
- **BeapInboxFirstRun:** "Connect Email" CTA in `BeapInboxFirstRun.tsx`.
- **EmailComposeOverlay:** Uses `emailAccounts.listAccounts` for account selector.

### OAuth / Auth

- **Gmail:** `email:connectGmail`, `email:setGmailCredentials`; OAuth flow via popup/loopback.
- **Outlook:** `email:connectOutlook`, `email:setOutlookCredentials`; Microsoft OAuth.
- **IMAP:** `email:connectImap` with config (host, port, user, password).

### Credentials Storage

- **Vault:** `credentials.ts` — `saveCredentials`, `checkExistingCredentials`; keytar for secure storage when vault unlocked.
- **Fallback:** Plain file when vault not available.

### Supported Providers

- Gmail (OAuth)
- Microsoft 365 / Outlook (OAuth)
- IMAP (presets in `IMAP_PRESETS`)

### Where "Pull Emails" Fits

- `email:syncAccount` exists; `email:listMessages` lists messages.
- `beapSync.ts` polls `runBeapSyncCycle` every 30s; fetches emails, detects BEAP, inserts into `p2p_pending_beap` or `plain_email_inbox`.
- A "Pull emails" button would call `email:syncAccount` or trigger a manual sync cycle.

### Existing Email Fetching

- `emailGateway.listMessages(accountId, options)` — `electron/main/email/gateway.ts`.
- `beapSync.ts` uses injected `_emailListFn`, `_emailGetFn`, `_emailExtractAttachmentTextFn`.

---

## 6. DATABASE / PERSISTENCE LAYER

### Database

- **SQLite** via `better-sqlite3` (synchronous).

### Direct Queries

- No ORM; raw `db.prepare(...).run(...)` / `.all()` / `.get()`.

### Initialization

- Vault DB: `electron/main/vault/db.ts`.
- Handshake DB: same vault DB (handshake tables live in vault DB per `handshake/db.ts`).

### Tables (Handshake DB)

| Table | Purpose |
|-------|---------|
| handshakes | Handshake records |
| context_blocks | Context blocks (payload, embedding_status) |
| context_block_versions | Version tracking |
| context_embeddings | Embedding vectors |
| seen_capsule_hashes | Deduplication |
| audit_log | Audit trail |
| outbound_capsule_queue | Outbound capsule queue |
| p2p_config | P2P config |
| p2p_pending_beap | Pending BEAP message packages (id, handshake_id, package_json, created_at, processed) |
| plain_email_inbox | Plain emails (id, message_json, account_id, email_message_id, created_at, processed) |

### Migrations

- `HANDSHAKE_MIGRATIONS` array in `db.ts`; versioned; applied on open.

### Storage Path

- App data path: `app.getPath('userData')`; vault DB path derived from config.

### Full-Text Search

- `context_embeddings` for embeddings; `semanticSearch` uses vector similarity; no FTS5 in handshake schema.

---

## 7. FILE HANDLING & ATTACHMENTS

### Storage

- Files stored in vault; `payload_ref` in context_blocks for large content.
- Documents: `documentService` in vault; `getDocumentPage`, `getDocumentFullText` via IPC.

### Directory Structure

- Vault paths from config; no explicit attachment directory documented.

### Text Extraction

- **PDF:** `pdfjs-dist` (browser); `pdf.worker.mjs` copied to `dist-electron`.
- **Parser service:** `POST /api/parser/pdf/extract` in main (port 51248).
- **OCR:** `tesseract.js` for images.

### "Open Original"

- `handshakeView.requestOriginalDocument(documentId, acknowledgedWarning, handshakeId)` — IPC to main; opens via shell or external app.

### File Size Limits

- BeapMessageImportZone: 512KB max for .beap files.

### Thumbnails

- Raster pages; `rasterProof` in `BeapAttachment`; no generic thumbnail service documented.

---

## 8. UI PATTERNS & DESIGN SYSTEM

### CSS

- Global CSS; `App.css` with theme tokens.
- `:root` variables for Standard (light), Dark, Pro themes.
- `--purple-accent`, `--color-accent` for WR Desk branding.

### Theme

- `data-ui-theme` on root: `pro`, `dark`, `standard`.
- `extensionTheme` passed from extension; `analysisDashboard.requestTheme()` / `onThemeChange`.

### Layout

- Sidebar + main; `gridTemplateColumns` for 3-column (e.g. `280px 1fr 320px`).

### Components

- Custom buttons, inputs, modals; no shared component library.

### Icons

- Emoji and inline symbols; no lucide/heroicons.

### Toggle

- Inbox bulk mode: checkbox in nav (`bulkMode` state).

---

## 9. ROUTING & NAVIGATION

### Routing

- No React Router; `activeView` in `App.tsx`: `'analysis' | 'handshakes' | 'beap-inbox' | 'settings'`.

### Tab Switching

- Nav buttons: `onClick={() => setActiveView('analysis')}` etc.

### Deep Linking

- `OPEN_ANALYSIS_DASHBOARD` payload can set `deepLinkPayload`; no URL-based routing.

---

## 10. IMPORT / EXPORT PATTERNS

### .beap Import

- **BeapMessageImportZone:** `processFile` → `file.text()` → `JSON.parse` → `handshakeView.importBeapMessage(text)`.
- **Flow:** IPC `handshake:importBeapMessage` → `insertPendingP2PBeap` → `usePendingP2PBeapIngestion` polls → `importBeapMessage` → `verifyImportedMessage` → `sandboxDepackage` → `addMessage` (see `INGESTION_PATH_TRACE.md`).

### File Validation

- `.beap` or `.json`; max 512KB; must be valid JSON object.

### Export

- `handshakeView.downloadCapsule(capsuleJson, suggestedFilename)` — saves via Electron dialog.

### Import Errors

- `setStatus('error')`, `setStatusMessage(...)` on failure.

---

## 11. CHAT / AI ASSISTANT ARCHITECTURE

### Chat UI

- **HandshakeChatSidebar:** Simple message list; disabled when no handshake or no context blocks.
- **HybridSearch:** "Chat" and "Actions" modes; search + chat.

### Message History

- `useState<ChatMessage[]>` in component; no persistent store.

### AI Requests

- **Local:** Ollama at `http://127.0.0.1:11434/api/chat`.
- **Cloud:** OpenAI, Anthropic, xAI, Google via `llmStream.ts`.

### Llama 3.1 8B

- Hosted by Ollama; model name passed to `streamOllamaChat`.

### Context Injection

- `chatWithContextRag` receives `systemMessage`, `dataWrapper` (context blocks), `userMessage`; `selectedDocumentId`, `selectedAttachmentId` for RAG.

### Actions

- "Actions" tab in HybridSearch toolbar; draft mode.

---

## 12. ERROR HANDLING & LOGGING

### Error Boundary

- `ErrorBoundary.tsx` wraps `App`.

### Error Notification

- `setToast({ msg, type })` in BeapInboxDashboard; `setError` in components.
- No global toast library.

### Logging

- `console.log`, `console.error`; no electron-log/winston.

### IPC Errors

- Email handlers: `try/catch` → `return { ok: false, error }`.
- Handshake handlers: throw; renderer catches.

---

## 13. TESTING & QUALITY

### Test Framework

- **Vitest** (root `package.json`: `"test": "vitest --passWithNoTests"`).

### Test Locations

- `electron/main/handshake/__tests__/`
- `electron/main/email/__tests__/`
- `electron/main/ingestion/__tests__/`
- `electron/main/vault/*.test.ts`
- `electron/main/p2p/__tests__/`

### Linting

- ESLint in `package.json`; Prettier for format.

---

## 14. IMPLEMENTATION RECOMMENDATIONS

### Email Pulling

- **Recommended:** Polling via `syncAccount` (already exists); `beapSync` runs every 30s.
- **Optional:** Manual "Pull" button calling `email:syncAccount` or a one-off sync.
- **Gap:** `detectBeapInBody` only matches handshake capsules; **qBEAP/pBEAP message packages are not detected** from email. Add `detectBeapMessagePackage` in `beapSync.ts` and route to `p2p_pending_beap` (same as P2P path).

### Directory Structure for Email

- `electron/main/email/` — gateway, providers, beapSync, plainEmailConverter.
- `src/components/` — BeapInboxDashboard, BeapInboxFirstRun, EmailComposeOverlay.
- Extend `BeapInboxDashboard` for inbox-specific email UI.

### Reuse vs New

- **Reuse:** `useBeapInboxStore`, `BeapMessageImportZone`, `BeapMessageDetailPanel`, `sandboxDepackage`, `plainEmailConverter`, `email:listMessages`, `email:syncAccount`.
- **New:** Email inbox list view (distinct from BEAP inbox), "Pull emails" trigger, optional mailbox deletion UI.

### Risks / Blockers

- **qBEAP/pBEAP in email:** `detectBeapInBody` must be extended or a parallel detector added.
- **Plain email → BEAP:** `plainEmailConverter` exists; `plain_email_inbox` table exists; `getPendingPlainEmails`/`ackPendingPlainEmail` exist; need to wire `usePendingPlainEmailIngestion` and UI similar to P2P BEAP.

### Implementation Order

1. **Extend `beapSync`** for qBEAP/pBEAP in email attachments (detect + route to `p2p_pending_beap`).
2. **Wire plain email ingestion** — `usePendingPlainEmailIngestion` and UI.
3. **Add "Pull emails" button** — call `email:syncAccount` or trigger sync.
4. **Email inbox list** — new view or extend BeapInboxDashboard to show plain emails from `plain_email_inbox`.
5. **Remote mailbox deletion** — new IPC handler + provider API if supported.

### Complexity Estimates

| Component | Complexity |
|-----------|------------|
| Extend beapSync for qBEAP/pBEAP | Low |
| Plain email ingestion | Medium |
| Pull emails button | Low |
| Email inbox list | Medium |
| Remote mailbox deletion | Medium–High (provider-dependent) |

---

## CRITICAL FILES REFERENCE

| Purpose | Path |
|---------|------|
| Main entry | `electron/main.ts` |
| Preload | `electron/preload.ts` |
| App root | `src/App.tsx` |
| Handshake view | `src/components/HandshakeView.tsx` |
| Handshake DB | `electron/main/handshake/db.ts` |
| Handshake IPC | `electron/main/handshake/ipc.ts` |
| BEAP sync | `electron/main/email/beapSync.ts` |
| Email IPC | `electron/main/email/ipc.ts` |
| Email gateway | `electron/main/email/gateway.ts` |
| Plain email converter | `electron/main/email/plainEmailConverter.ts` |
| Import pipeline | `apps/extension-chromium/src/ingress/importPipeline.ts` |
| Sandbox depackage | `apps/extension-chromium/src/beap-messages/sandbox` |
| Beap inbox store | `apps/extension-chromium/src/beap-messages/useBeapInboxStore.ts` |
| Beap inbox types | `apps/extension-chromium/src/beap-messages/beapInboxTypes.ts` |
| Inbox dashboard | `src/components/BeapInboxDashboard.tsx` |
| Import zone | `src/components/BeapMessageImportZone.tsx` |
| Ingestion trace | `INGESTION_PATH_TRACE.md` |
