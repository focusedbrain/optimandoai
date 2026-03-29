# WR Desk — Dashboard & Analysis Architecture

Read-only analysis of the **WR Desk** monorepo (`code/`), focused on the **Analysis** view (“Workflow queue”, “Latest AI sort”, “Transport”, “Project AI Optimization”, “Urgent queue”, “PoAE™ Registry”). No application source code was modified to produce this document.

---

## 1. Project structure

### 1.1 High-level repo layout

```
code/
├── apps/
│   ├── electron-vite-project/     # WR Desk Electron shell (primary dashboard host)
│   ├── extension-chromium/        # Chrome extension (handshake vault, BEAP UI, side panel, orchestration demo assets)
│   └── desktop/                   # Additional desktop packaging (see app’s package.json)
├── packages/
│   ├── coordination-service/
│   ├── ingestion-core/
│   ├── shared-beap-ui/
│   ├── shared-extension/
│   ├── shared/
│   ├── relay-server/
│   ├── beap-pod/
│   └── hello/
├── docs/                          # Markdown design/analysis notes
└── package.json                   # @repo/root (pnpm workspace)
```

### 1.2 Tech stack (Electron analysis app)

| Area | Choice |
|------|--------|
| UI | React 18 + TypeScript |
| Build | Vite 5, `vite-plugin-electron` / renderer |
| Desktop | Electron ~30 |
| State | Zustand (`useEmailInboxStore`, `useProjectSetupChatContextStore`, `useDraftRefineStore`, `useAiDraftContextStore`) |
| Native / DB | `better-sqlite3` (main process), SQLCipher vault (handshake DB) |
| Charts (dep) | `recharts` (present in `package.json`; not used by the slim dashboard cards described here) |
| Routing | **No React Router** for main tabs — view state in `App.tsx` |

### 1.3 Entry point and “router”

- **Renderer entry:** `apps/electron-vite-project/src/main.tsx` → `ReactDOM.createRoot(...).render(<App />)`.
- **Tab / view switching:** `apps/electron-vite-project/src/App.tsx` — local state `activeView: 'analysis' | 'handshakes' | 'beap-inbox' | 'settings'` with conditional render in `<main className="app-main">`. **Analysis** renders `AnalysisCanvas`.

### 1.4 Views / pages organization

| Path | Role |
|------|------|
| `src/components/AnalysisCanvas.tsx` | Analysis command center (dashboard) |
| `src/components/HandshakeView.tsx` | Handshakes workspace |
| `src/components/EmailInboxView.tsx` | Standard inbox |
| `src/components/EmailInboxBulkView.tsx` | Bulk inbox + **AI Auto-Sort** execution |
| `src/components/SettingsView.tsx` | Settings (tab exists in type; no nav button in header — reachable only if state set) |
| `src/components/analysis/dashboard/*` | Dashboard sections (cards, PoAE, urgent, project setup) |

### 1.5 Shared utilities, services, helpers (dashboard-relevant)

| Path | Role |
|------|------|
| `src/lib/useAnalysisDashboardSnapshot.ts` | React hook: load dashboard snapshot on mount + `refresh()` |
| `src/lib/fetchAnalysisDashboardSnapshot.ts` | Calls `window.emailInbox.dashboardSnapshot`, assembles `AnalysisDashboardSnapshot` |
| `src/types/analysisDashboardSnapshot.ts` | Wire + assembled snapshot types, IPC field mapping table in comments |
| `src/lib/buildProjectSetupChatPrefix.ts` | Builds tagged prefix for header chat from project setup drafts |
| `src/lib/wrdeskUiEvents.ts` | `WRDESK_FOCUS_AI_CHAT_EVENT` — focuses HybridSearch chat |
| `src/lib/inboxSessionReviewOpen.ts` | `workflowFilterFromSessionReviewRow` — maps session row → inbox tab |
| `electron/main/email/dashboardSnapshot.ts` | `collectReadOnlyDashboardSnapshot(db)` — SQLite aggregation for `inbox:dashboardSnapshot` |
| `electron/preload.ts` | Exposes `emailInbox.dashboardSnapshot` → `ipcRenderer.invoke('inbox:dashboardSnapshot', ...)` |

---

## 2. Dashboard component tree

**Root for this view:** `AnalysisCanvas`.

### 2.1 Tree (parent → children)

```
AnalysisCanvas
├── StatusBadge (from ./analysis/StatusBadge)
├── DashboardTopCardsRow
│   └── (articles only — no child React components)
├── div.analysis-dashboard__command-grid
│   ├── div.analysis-dashboard__command-primary
│   │   └── ProjectSetupSection
│   │       ├── (inline controls + details panel)
│   │       └── ProjectSetupModal (local to module — function component in same file)
│   └── div.analysis-dashboard__ops-stack
│       ├── UrgentAutosortSessionSection
│       └── PoaeArchiveSection
```

**[NOT FOUND] in current render tree:** `DashboardHandshakeSummarySection.tsx` exists under `analysis/dashboard/` but has **no imports** elsewhere; it is not mounted on the live dashboard.

### 2.2 Per-component notes

#### `AnalysisCanvas` — `apps/electron-vite-project/src/components/AnalysisCanvas.tsx`

| Aspect | Detail |
|--------|--------|
| **Props** | `deepLinkPayload?`, `onDeepLinkConsumed?`, `onOpenInboxMessage?`, `onOpenInbox?`, `emailAccounts?`, `onOpenBulkInboxForAnalysis?` |
| **Local state** | `_liveDeepLink` / `setLiveDeepLink` (reserved; deep link consumed mostly for future use) |
| **Data hooks** | `useAnalysisDashboardSnapshot({ urgentMessageLimit: 10 })` → `snapshot`, `loading`, `error`, `refreshDashboard` |
| **Other hooks** | `useCanvasState()` — only `helpers` used → `StatusBadge` ← `helpers.currentFlags` |
| **Store** | `useEmailInboxStore.getState().refreshMessages()` inside `refreshOperations` callback |
| **Connected vs presentational** | **Connected** (owns snapshot fetch + refresh orchestration) |

#### `StatusBadge` — `apps/electron-vite-project/src/components/analysis/StatusBadge.tsx`

| Aspect | Detail |
|--------|--------|
| **Props** | `flags: VerificationFlags`, optional `text`, `size`, `showWarning` |
| **Subscriptions** | None |
| **Connected** | Presentational; flags from parent |

#### `DashboardTopCardsRow` — `apps/electron-vite-project/src/components/analysis/dashboard/DashboardTopCardsRow.tsx`

| Aspect | Detail |
|--------|--------|
| **Props** | `snapshot`, `loading`, `error`, `onRetry` |
| **Local state** | None |
| **Data** | Reads `snapshot.top`, `snapshot.autosort.latestSession`, `top.autosortCategoryCounts` |
| **Connected** | Presentational (all data via props) |

#### `ProjectSetupSection` (+ `ProjectSetupModal`) — `.../ProjectSetupSection.tsx`

| Aspect | Detail |
|--------|--------|
| **Props** | `projectSetup`, `loading?`, `emailAccounts?`, `onRefreshOperations?`, `onOpenBulkInboxForAnalysis?`, `latestAutosortSession?` |
| **Local state** | `modalOpen`, `modalTab`, `snippetLabel`, `snippetText`, `runBusy`, `autoToggleBusy` |
| **Zustand** | `useProjectSetupChatContextStore` (shallow): drafts, snippets, `includeInChat`, mutators |
| **Zustand** | `useEmailInboxStore`: `autoSyncEnabled`, `toggleAutoSyncForActiveAccounts`, `refreshInboxSyncBackendState` |
| **Effects** | `refreshInboxSyncBackendState` when `accountIds` / `primaryAccountId` change |
| **Connected** | **Connected** (auto-sync IPC via store, chat context store, operational buttons) |

#### `UrgentAutosortSessionSection` — `.../UrgentAutosortSessionSection.tsx`

| Aspect | Detail |
|--------|--------|
| **Props** | `onOpenInboxMessage?`, `snapshot`, `loading`, `error`, `onRefresh` |
| **Local state** | None |
| **Data** | `snapshot.autosort.latestSession`, `snapshot.autosort.urgentSessionMessages` (capped at `VISIBLE_URGENT_CAP = 10`) |
| **Connected** | Presentational with callback props |

#### `PoaeArchiveSection` — `.../PoaeArchiveSection.tsx`

| Aspect | Detail |
|--------|--------|
| **Props** | `poae`, `loading?`, `onOpenInbox?`, `onOpenInboxMessage?` |
| **Local state** | None (uses module constant `EMPTY_POAE` when null) |
| **Connected** | Presentational |

---

## 3. Data flow & state management

### 3.1 How dashboard data is fetched

1. **`useAnalysisDashboardSnapshot`** (`src/lib/useAnalysisDashboardSnapshot.ts`) runs `refresh()` on **mount** (`useEffect` depending on `refresh`).
2. **`refresh`** sets `loading: true`, calls **`fetchAnalysisDashboardSnapshot`**, then updates `snapshot` / `error`.
3. **No websockets** and **no polling** for the dashboard hook itself — only initial load + explicit `refresh()` (e.g. Retry on cards, Refresh on urgent section, `refreshOperations` after “Run Analysis Now”).
4. **Background inbox freshness:** `App.tsx` subscribes to `subscribeInboxNewMessagesBackgroundRefresh` and `onBeapInboxUpdated` so **the inbox Zustand store** can refresh while the user is on Analysis; the **dashboard snapshot does not auto-refresh** from those events unless the user triggers `refresh` or navigates in a way that remounts/refetches.

**Bridge:** Renderer `window.emailInbox.dashboardSnapshot` (preload) → main `ipcMain.handle('inbox:dashboardSnapshot', ...)`.

**Main aggregation:** `collectReadOnlyDashboardSnapshot(db, { urgentMessageLimit })` in `electron/main/email/dashboardSnapshot.ts`.

### 3.2 Sort session data → UI

| Step | Mechanism |
|------|-----------|
| SQLite | Latest **completed** row from `autosort_sessions` (`status = 'completed'`, `ORDER BY started_at DESC LIMIT 1`) |
| Session meta | Mapped to `latestCompletedAutosort` on wire → `snapshot.autosort.latestSession` |
| Category histogram | SQL `GROUP BY` on `sort_category` for rows with `last_autosort_session_id = sessionId` → `top.autosortCategoryCounts` |
| Urgent rows | SQL filter: `sort_category` normalized to `'urgent'` **or** `urgency_score >= 7`, ordered by score / `received_at`, limited by `urgentMessageLimit` → `latestSessionUrgentMessages` → `snapshot.autosort.urgentSessionMessages` |

Renderer mapping: `fetchAnalysisDashboardSnapshot.ts` → `wireToSnapshot`.

### 3.3 Workflow queue counts (urgent, pending review, pending delete)

Sourced inside **`collectReadOnlyDashboardSnapshot`**: `countInbox(db, { filter })` for each tab using **`buildInboxMessagesWhereClause`** (same as `inbox:listMessages`). Wire field: `inboxTabs.urgent`, `.pending_review`, `.pending_delete`. UI: `DashboardTopCardsRow` reads `snapshot.top.inboxTabs` (wire preserves names: renderer type uses `pending_review` / `pending_delete` aligned with store).

### 3.4 Transport stats (Native BEAP, Depackaged)

From **`messageKindOnMainInbox`** in the same collector:

- `nativeBeap` → `countInbox(db, { filter: 'all', messageKind: 'handshake' })` (comment: handshake slice in `inboxWhereClause`).
- `depackagedEmail` → `countInbox(db, { filter: 'all', messageKind: 'depackaged' })`.

Displayed as independent totals (“All tab” cohort). They **do not** have to sum to `all`.

### 3.5 Urgent queue messages

From **`latestSessionUrgentMessages`** in `dashboardSnapshot.ts` (latest completed session only), not from live inbox “Urgent” tab. `UrgentAutosortSessionSection` slices to 10 for display.

### 3.6 PoAE registry data

SQL in `collectReadOnlyDashboardSnapshot`: recent `inbox_messages` where `beap_package_json` is non-null and non-empty after trim, `deleted = 0`, ordered by `received_at` DESC, limit 25 + truncation probe.

### 3.7 API / IPC / service functions the dashboard depends on

| Mechanism | Name | File / exposure |
|-----------|------|------------------|
| IPC | `inbox:dashboardSnapshot` | `electron/main/email/ipc.ts` handler; `electron/preload.ts` → `window.emailInbox.dashboardSnapshot` |
| Aggregation | `collectReadOnlyDashboardSnapshot(db, opts?)` | `electron/main/email/dashboardSnapshot.ts` |
| SQL filters | `buildInboxMessagesWhereClause` | `electron/main/email/inboxWhereClause.ts` |
| Renderer fetch | `fetchAnalysisDashboardSnapshot(options?)` | `src/lib/fetchAnalysisDashboardSnapshot.ts` |
| Renderer hook | `useAnalysisDashboardSnapshot` | `src/lib/useAnalysisDashboardSnapshot.ts` |
| Optional (disabled in hook) | `window.handshakeView.listHandshakes()` | Summarized only if `includeHandshakes !== false` — **current hook passes `includeHandshakes: false`**, so **`snapshot.handshakes` is always omitted/null from assembler’s perspective** (see §3.8). |

### 3.8 Handshake section on snapshot

`fetchAnalysisDashboardSnapshot` sets `handshakes` only when `includeHandshakes !== false`. **`useAnalysisDashboardSnapshot` always calls with `includeHandshakes: false`**, so the assembled snapshot **never** includes handshake counts in production dashboard loads.

---

## 4. Project AI Optimization — current implementation

### 4.1 Where project configuration is stored

- **`projectSetup` on snapshot:** Hard-coded placeholder in `fetchAnalysisDashboardSnapshot.ts` (`PROJECT_SECTION` constant: `mode: 'v1_activation_placeholder'`, headline/body strings). **Not loaded from DB or IPC.**
- **Draft fields (name, goals, milestones, context, snippets):** Zustand store **`useProjectSetupChatContextStore`** — **renderer memory only**; comments and UI copy state they are not persisted as project records.
- **“Select project”:** Modal tab shows “No saved projects / Persistence pending”.

### 4.2 “Auto Mode”

- **UI label:** “Auto Mode” with subtitle tooltip: *“Auto: scheduled mail sync only. Does not run Auto-Sort.”*
- **Behavior:** Tied to **`useEmailInboxStore`**: `autoSyncEnabled`, `toggleAutoSyncForActiveAccounts(enabled, accountIds, primaryAccountId)` which calls `window.emailInbox.toggleAutoSync` per account, then `refreshInboxSyncBackendState`.
- **Account list:** `activeEmailAccountIdsForSync(emailAccounts)` and `pickDefaultEmailAccountRowId` from shared helpers.
- **This is background mail sync**, not the AI sort pipeline.

### 4.3 “Run Analysis Now” — call chain

1. User clicks **Run Analysis Now** in `ProjectSetupSection` → `handleRunAnalysisNow`.
2. Guards: not `runBusy`, not `loading`, `onRefreshOperations` must exist.
3. **`await onRefreshOperations()`** — from `AnalysisCanvas`: `refreshOperations` = `refreshDashboard()` + `useEmailInboxStore.getState().refreshMessages()`.
4. **`onOpenBulkInboxForAnalysis?.()`** — from `App.tsx`: `setActiveView('beap-inbox')` and `setInboxBulkMode(true)`.
5. **User runs Auto-Sort inside Bulk Inbox** (`EmailInboxBulkView`) — not invoked automatically by this button.

### 4.4 Sort session connection to the analysis view

- **Last sort / session lines** in `ProjectSetupSection` read **`latestAutosortSession`** prop from `dashboardSnapshot?.autosort?.latestSession` (same source as “Latest AI sort” card).
- **No navigation** into a dedicated “session analysis” screen from the dashboard — only status copy and the urgent list from the same session.

### 4.5 “Sync off” toggle

- Checkbox bound to **`autoSyncEnabled && !autoDisabled`**; `onChange` → `onAutoToggle(checked)` → **`toggleAutoSyncForActiveAccounts`** (§4.2).
- Label toggles between “Sync on” / “Sync off”.

### 4.6 Drafts and snippets

- **Drafts:** Stored in **`useProjectSetupChatContextStore`**: `projectNameDraft`, `goalsDraft`, `milestonesDraft`, `setupTextDraft`.
- **Snippets:** `snippets[]` with `addSnippet` / `removeSnippet`; modal and inline “Drafts & snippets” share the same store bindings.
- **“Include in header AI / SendDrafts…”** controls `includeInChat` — consumed by **`buildProjectSetupChatPrefix`** in **`HybridSearch`** when `activeView === 'analysis'` and not in draft-refine mode.

### 4.7 Project settings persistence

**[NOT FOUND]** — No IPC or SQLite project entity for V1; UI explicitly states session drafts only.

---

## 5. Chat integration (top bar)

### 5.1 Connection to the dashboard

- **`HybridSearch`** is rendered in **`App.tsx`** inside `<header className="app-header">`**, above `<main>` — **global** to Analysis, Handshakes, and Inbox tabs.
- **Model selector:** Loaded once via `window.handshakeView.getAvailableModels()` (`HybridSearch.tsx` `useEffect`). Default selection prefers first **local** model, else first model.
- **Analysis-specific behavior:** When `activeView === 'analysis'`, `mode === 'chat'`, and not in draft-refine, submit path prepends **`buildProjectSetupChatPrefix(useProjectSetupChatContextStore.getState())`** if `includeInChat` and content exist.

### 5.2 Message sending mechanism

- **Chat mode:** `window.handshakeView.chatWithContextRag({ query: chatQuery, scope, model, provider, stream: true, ... })`.
- **Streaming:** `onChatStreamStart` / `onChatStreamToken` optional listeners.
- **Scope:** Derived from `selectedHandshakeId ?? selectedMessageId ?? scope` — on Analysis without selection, tends toward **`defaultScope('analysis')` → `'all'`** per `defaultScope` (only special-cases `handshakes`, `beap`, `beap-inbox`).

### 5.3 Crafting content for other components

**Existing pattern:** **Manual / copy-based.** The prefix explicitly instructs the model not to claim persistence; `buildProjectSetupChatPrefix.ts` states `write_back: user copies assistant output manually`. There is **no** automated injection of chat output into `ProjectSetupSection` fields or into dashboard cards.

**To inject goals/milestones automatically:** Would require new code (e.g. parse assistant output, confirm UX, write to store or future project API).

### 5.4 Focus from Project setup

- **`WRDESK_FOCUS_AI_CHAT_EVENT`** — `ProjectSetupSection` / modal call `focusHeaderAiChat()` → `window.dispatchEvent` → `HybridSearch` listener sets mode to `'chat'` and focuses input.

---

## 6. Orchestrator & DOM capture

### 6.1 “Orchestrator” in WR Desk (inbox / mail)

- **Primary production meaning:** **`syncOrchestrator.ts`** — **email sync orchestration** (IMAP/Gmail/Graph pulls, ingestion, `detectAndRouteMessage`, BEAP/plain processing, remote queue drain hooks). **Not** a browser DOM snapshot pipeline.
- **Remote mutation queue:** **`inboxOrchestratorRemoteQueue.ts`** + IPC diagnostics in **`electron/main/email/ipc.ts`** (`orchestrator` queue snapshot / reset) — server-side folder moves / lifecycle, not DOM.

### 6.2 DOM capture / snapshot

**[NOT FOUND]** — No dedicated “DOM capture” or “page snapshot” pipeline tied to **`AnalysisCanvas`** or the desktop dashboard. The analysis **dashboard snapshot** is **SQLite/read-only aggregation** (`collectReadOnlyDashboardSnapshot`), not a visual DOM capture.

### 6.3 Interval mechanism for auto-capture

**[NOT FOUND]** for DOM. For **mail sync**, intervals are driven by **`email_sync_state.sync_interval_ms`** (default **300_000** ms referenced in sync code / IPC) and auto-sync toggles — unrelated to dashboard rendering.

### 6.4 Relation to “moment capture optimization”

**[UNCLEAR]** — No code or doc reference in-repo under that exact phrase tied to the Electron analysis dashboard. The **`apps/extension-chromium/public/orchestration.html`** + **`orchestration.js`** bundle is a **standalone multi-agent demo UI** (German copy, local `OrchestrationUI` class), **not** imported by `AnalysisCanvas`.

---

## 7. Session & multi-agent architecture

### 7.1 Sessions (analysis canvas model)

- **Types / factory:** `canvasState.ts` — phases `dashboard | pre-execution | live | post-execution`, verification flags, pre/live/post substates.
- **React hook:** `useCanvasState.ts` — full mutable canvas state + helpers.
- **Usage on current dashboard:** **`AnalysisCanvas` only consumes `helpers.currentFlags`** for **`StatusBadge`**. The rich pre/live/post execution state, agent templates, live events, etc., are **not** wired to visible dashboard widgets in `AnalysisCanvas.tsx`.

### 7.2 Agent grid / multi-agent visualization

**[NOT FOUND]** on the live Analysis dashboard. **`focusLayoutEngine.ts`**, **`HeroKPI.tsx`**, **`computePriorityAction.ts`** export building blocks; they are **not** mounted from `AnalysisCanvas` in the current tree.

### 7.3 Agent configuration (risk, efficiency, security)

- **Conceptual model** exists in **`canvasState.ts`** / **`useCanvasState`** (e.g. `riskAnalysis`, consent, templates).
- **Live configuration UI** for those agents on this screen: **[NOT FOUND]** (state exists but unused in `AnalysisCanvas`).

### 7.4 Session ↔ project connection

**[NOT FOUND]** — No `projectId` linking autosort sessions to a “project” entity in types or DB usage from the dashboard UI.

### 7.5 Execution flow when an “analysis session” runs (product-relevant)

1. User enables bulk inbox and runs **AI Auto-Sort** from **`EmailInboxBulkView`** (toolbar / row actions; `runAiCategorizeForIds` and related flows).
2. Main process **autosort** IPC (`autosort:createSession`, `autosort:finalizeSession`, `autosort:getSessionMessages`, `autosort:generateSummary`, etc.) in **`electron/main/email/ipc.ts`** persists session stats and message fields.
3. Dashboard read model picks up results on next **`inbox:dashboardSnapshot`** refresh.

---

## 8. Business logic — DO NOT TOUCH (protected inventory)

The following areas implement inbox, handshake, BEAP, transport, classification, persistence, and auth. **Refactor scope per user brief: UI/presentation and dashboard-specific state only.**

### 8.1 Inbox processing (Electron main)

Non-exhaustive but representative **modules under** `apps/electron-vite-project/electron/main/email/`:

- **`ipc.ts`** — Large central handler registry: `inbox:listMessages`, `inbox:getMessage`, lifecycle, attachments, sync, autosort, dashboard snapshot, etc.
- **`syncOrchestrator.ts`** — Pull + ingest pipeline.
- **`messageRouter.ts`** — `detectAndRouteMessage`, routing raw mail.
- **`beapEmailIngestion.ts`**, **`plainEmailIngestion.ts`**, **`mergeExtensionDepackaged.ts`** — Ingest paths.
- **`gateway.ts`** & **`providers/*`** — Provider APIs.
- **`inboxOrchestratorRemoteQueue.ts`**, **`inboxLifecycleEngine.ts`**, **`imapLifecycleReconcile.ts`**, **`remoteDeletion.ts`** — Lifecycle + remote mutations.
- **`inboxWhereClause.ts`** — Shared SQL filter builder (also used by read-only dashboard counts).

### 8.2 Handshake logic

**Under** `apps/electron-vite-project/electron/main/handshake/` (104 `.ts` files including steps, tests): e.g. **`ipc.ts`**, **`db.ts`**, **`enforcement.ts`**, **`capsuleBuilder.ts`**, **`p2pTransport.ts`**, **`stateTransition`**, **`verifyCapsuleHash`**, **`ledger.ts`**, **`intentClassifier.ts`**, **`llmStream.ts`**, etc.

**Renderer shims:** `apps/electron-vite-project/src/shims/handshakeRpc.ts`, typed bridges in **`src/components/handshakeViewTypes.ts`**.

### 8.3 BEAP transport (native & depackaged)

- **Electron:** **`beapEmailIngestion.ts`**, **`decryptQBeapPackage.ts`** (and related BEAP under `electron/main/beap/`), depackaged merge helpers, inbox rows with `beap_package_json`.
- **Extension:** **`apps/extension-chromium/src/beap-messages/**`**, **`BeapPackageBuilder`**, ingress types, content script paths.

### 8.4 Email parsing & classification

- **`mailparser` / ingestion** usage across `plainEmailConverter.ts`, router, providers.
- **Spam / threat:** **[UNCLEAR]** as a single module name; detection/routing is embedded in **`messageRouter`** and related ingestion (search product docs for policies). No separate “threat dashboard” feed in the analyzed dashboard.

### 8.5 Sort session execution (AI sort engine)

- **UI driver:** **`EmailInboxBulkView.tsx`** — bulk Auto-Sort, `runAiCategorizeForIds`, session UX, moves.
- **Persistence / summary:** **`ipc.ts`** autosort handlers (`autosort:createSession`, `autosort:finalizeSession`, …, `autosort:generateSummary`).

### 8.6 Message persistence & database

- **`electron/main/handshake/db.ts`** — vault schema/migrations (includes inbox/autosort-related tables as used by product).
- **All** SQL writers in inbox IPC and sync orchestrator.

### 8.7 Authentication & authorization

- **Email OAuth / credentials:** `googleOAuthBuiltin.ts`, `gmailOAuthResolve.ts`, `oauth-server.ts`, `credentials.ts`, `secure-storage.ts`, provider auth flows.
- **Vault / handshake unlock:** handshake IPC, extension vault flows (**`apps/extension-chromium/src/vault/**`**).
- **Capabilities:** e.g. `src/auth/capabilities.ts` (renderer).

---

## 9. Styling architecture

### 9.1 Approach

- **Global base:** `src/index.css` (reset, `Inter` font stack).
- **App shell:** `App.css` — layout, nav tabs, theme via `data-ui-theme` on `documentElement` (`App.tsx` / extension theme bridge).
- **Per-component CSS:** Co-located files (e.g. `AnalysisCanvas.css`, `DashboardTopCardsRow.css`, `HybridSearch.css`, `ProjectSetupSection.css`, `StatusBadge.css`).
- **Not Tailwind-first:** No Tailwind utility layer observed as primary; mostly hand-authored CSS classes.
- **Tokens:** `src/styles/uiContrastTokens.ts` — `UI_BADGE`, `UI_TAB` objects for inline-friendly colors (used e.g. in `HybridSearch`).

### 9.2 Design system / component library

**[NOT FOUND]** — No Material/Chakra/Ant design dependency; **custom** components.

### 9.3 Premium enterprise look (what would change)

- Unify **spacing, radius, elevation, and typography scale** (today split across many CSS files).
- Introduce **semantic color tokens** (beyond `data-ui-theme` + local purple accents) and consistent **data-density** rules for dashboard cards.
- **HybridSearch** + header could be restyled as a single **command bar** system.
- Consider **CSS variables** for theme instead of scattered rules — would require coordinated edits to `App.css` / dashboard CSS / tokens.

---

## 10. Integration points summary

| UI Component | Data Source | API / Service | Update Mechanism | File Path |
|--------------|-------------|---------------|------------------|-----------|
| Workflow queue counts | SQLite inbox tab filters | `inbox:dashboardSnapshot` → `collectReadOnlyDashboardSnapshot` | Manual refresh (`useAnalysisDashboardSnapshot.refresh`) or remount | `DashboardTopCardsRow.tsx` ← `dashboardSnapshot.ts` |
| Latest AI sort (time, totals) | `autosort_sessions` latest completed | Same IPC | Same | `DashboardTopCardsRow.tsx` |
| Run composition (categories) | Derived from latest session messages | Same IPC (pre-aggregated counts) | Same | `DashboardTopCardsRow.tsx` |
| Transport Native BEAP / Depackaged | `countInbox` + `messageKind` | Same IPC | Same | `DashboardTopCardsRow.tsx` |
| Project AI headline/body | **Static placeholder** in fetch layer | **None** (assembled in renderer) | N/A | `ProjectSetupSection.tsx` ← `fetchAnalysisDashboardSnapshot.ts` |
| Auto Mode / sync state | `email_sync_state` via IPC | `window.emailInbox.toggleAutoSync`, `getSyncState` | Toggle + `refreshInboxSyncBackendState` | `ProjectSetupSection.tsx` → `useEmailInboxStore.ts` |
| Last sort / session status | Latest autosort session | `inbox:dashboardSnapshot` | Refresh | `ProjectSetupSection.tsx` |
| Run Analysis Now side effect | N/A (navigation) | `refreshDashboard` + `refreshMessages`, then bulk view | User click | `App.tsx`, `AnalysisCanvas.tsx`, `ProjectSetupSection.tsx` |
| Drafts / snippets | Zustand (memory) | None | User edit | `useProjectSetupChatContextStore.ts`, `ProjectSetupSection.tsx` |
| Urgent queue list | Latest session urgent SQL slice | `inbox:dashboardSnapshot` | Refresh | `UrgentAutosortSessionSection.tsx` |
| PoAE registry rows | `beap_package_json` messages | `inbox:dashboardSnapshot` | Refresh | `PoaeArchiveSection.tsx` |
| Open message from dashboard | App state | Sets inbox filter + `selectedMessageId` | Callback | `App.tsx` handlers |
| Status badge | Canvas verification flags (defaults) | **No backend** in current path | `useCanvasState` initial flags only | `StatusBadge.tsx`, `AnalysisCanvas.tsx` |
| Header chat models | Extension/backend | `handshakeView.getAvailableModels` | On mount | `HybridSearch.tsx` |
| Header chat send | Vault + RAG pipeline | `handshakeView.chatWithContextRag` | User submit | `HybridSearch.tsx` |
| Project drafts → chat | Zustand | `buildProjectSetupChatPrefix` (string prepend) | On submit when `includeInChat` | `HybridSearch.tsx`, `buildProjectSetupChatPrefix.ts` |

---

## Refactor surface area

### Safe to fully rewrite (mostly pure UI / CSS)

- **`*.css`** co-located with dashboard components (`DashboardTopCardsRow.css`, `UrgentAutosortSessionSection.css`, `PoaeArchiveSection.css`, `ProjectSetupSection.css`, `AnalysisCanvas.css`, `StatusBadge.css`).
- **`DashboardTopCardsRow.tsx`**, **`UrgentAutosortSessionSection.tsx`**, **`PoaeArchiveSection.tsx`** — if props contracts and callbacks stay stable.
- Unused **`DashboardHandshakeSummarySection.tsx`** — either wire up or delete in a UI-only pass (currently dead).

### Partial changes (mixed UI + logic — extract carefully)

- **`AnalysisCanvas.tsx`** — coordinates snapshot hook + navigation props; keep IPC contract and child prop shapes when restyling.
- **`ProjectSetupSection.tsx`** — heavy: Zustand + auto-sync + modal; split **presentational** subtree from **connectors** if rewriting layout.
- **`App.tsx`** — header/layout and view switching; touching **`HybridSearch`** placement affects all tabs.
- **`HybridSearch.tsx`** — large; chat/search/actions + many stores; refactor in slices (e.g. model menu, submit handler) to avoid regressions.
- **`fetchAnalysisDashboardSnapshot.ts`** — safe to adjust **assembly** only if wire types stay aligned; avoid changing meaning of counts without updating **`dashboardSnapshot.ts`** in lockstep.

### Must not touch (business logic / integrity)

- **`electron/main/email/ipc.ts`** autosort, listMessages, ingest, sync handlers.
- **`syncOrchestrator.ts`**, **`messageRouter.ts`**, **`beapEmailIngestion.ts`**, **`inboxOrchestratorRemoteQueue.ts`**, providers, gateway.
- **`electron/main/handshake/**`** (handshake engine, DB crypto, P2P).
- **`EmailInboxBulkView.tsx`** sort engine paths (when refactoring dashboard only).
- **`collectReadOnlyDashboardSnapshot`** SQL semantics — treat as **contract** with the dashboard; changes are “product” not “skin”.

### Estimated component count (new dashboard)

- **Current mounted tree:** ~**6** named React components (+ **1** modal sub-component in-file) for the analysis dashboard body, plus **StatusBadge** and global **HybridSearch**.
- **A reorganized enterprise layout** typically lands at **12–20** leaf/presentational pieces if splitting cards, skeletons, toolbars, and chat-adjacent panels — **estimate ~15–25** components assuming similar feature scope without adding new product capabilities.

---

*End of document.*
