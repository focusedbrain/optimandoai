# UI Refactor Analysis

This document maps the **current** architecture for the WR Desk™ Electron dashboard and the extension UI it embeds (`@ext/...`). It is based on direct inspection of the codebase only. No speculative redesigns.

**Primary app root:** `apps/electron-vite-project/`  
**Shared extension UI:** `apps/extension-chromium/` (aliased as `@ext` in Vite)

---

## 1. Executive Summary

### What the current UI architecture is doing

- **Electron shell (`App.tsx`)** owns top-level navigation: Analysis, Handshakes, Inbox (with bulk checkbox), and implicitly **WR Chat** via the header control strip—not a primary nav tab. `activeView` state selects which main pane renders (`'analysis' | 'wr-chat' | 'handshakes' | 'beap-inbox' | 'settings'`).
- **Analysis view** is **`AnalysisCanvas`**: a CSS grid dashboard with (1) a full-width **IntelligenceDashboard** strip, (2) **ProjectOptimizationPanel** (~60% width) for Project AI Optimization, and (3) **ActivityFeedColumn** for inbox/PoAE-style activity. Data comes from `useAnalysisDashboardSnapshot`, `useProjectStore`, and `useEmailInboxStore`.
- **WR Chat–related “modes”** in the conversational sense are implemented in the **extension** via **`useChatFocusStore`** (`ChatFocusMode`: `default` | `scam-watchdog` | `auto-optimizer`). The **header multi-trigger bar** (`WrMultiTriggerBar`) selects **Scam Watchdog** vs **per-project auto-optimizer** (projects that have an **icon** allocated) and drives chat focus + optional snapshot/continuous controls.
- **Custom WR Chat modes** (user-created) use **`useCustomModesStore`** and the **Add Mode wizard** (`AddModeWizard` / `CustomModeWizard` alias). Saving a mode switches UI store workspace/mode (`useUIStore`)—separate from `ChatFocusMode` but both affect WR Chat behavior.
- **Auto-optimization runtime** for projects lives in the Electron renderer: **`autoOptimizationEngine`** (interval `setInterval`), **`optimizationRunCoordinator.executeOptimizationRun`** (full pipeline), and **`registerWrDeskOptimizerHttpBridge`** exposing `window.__wrdeskOptimizerHttp` so the **main-process HTTP server** can invoke snapshot/continuous/status via `executeJavaScript`.

### Concepts that exist in code

| Concept | Where it appears |
|--------|-------------------|
| **Project / milestone / attachments** | `useProjectStore`, `types/projectTypes.ts`, persisted key `wr-desk-projects` |
| **Project AI Optimization (dashboard)** | `ProjectOptimizationPanel.tsx`, `IntelligenceDashboard` StatusCard toggles |
| **Trigger bar “mode” (Watchdog vs optimizer project)** | `TriggerFunctionId`, `WrMultiTriggerBar` |
| **WR Chat focus / conversational context** | `ChatFocusMode`, `chatFocusStore`, `getChatFocusLlmPrefix` |
| **Custom chat modes (wizard)** | `CustomModeDraft`, `useCustomModesStore`, `AddModeWizard` steps |
| **Scam Watchdog (security scan)** | `watchdogService` (main), `WrChatWatchdogButton`, HTTP `/api/wrchat/watchdog/*` |
| **Optimizer snapshot / continuous (HTTP from extension bar)** | `fetchOptimizerTrigger.ts`, main `invokeOptimizer*` → `__wrdeskOptimizerHttp` |

### Biggest structural tensions

1. **Two different “interval” semantics** share similar **checkbox UI** (`TriggerButtonShell`) but call **different backends**: Watchdog **continuous** (`/api/wrchat/watchdog/continuous`) vs project **auto-optimization** (`/api/projects/:id/optimize/continuous` → Zustand + `startAutoOptimization`). Conflating them in a refactor would break behavior.
2. **Trigger list for projects** is derived from **main reading renderer `localStorage`** (`readTriggerProjectEntriesFromRenderer`), not a single shared IPC API—duplicated logic with `fetchTriggerProjects` response shaping in the extension.
3. **“Hero” is not one component name**: the **top intelligence strip** is `IntelligenceDashboard`; the **Project AI Optimization** panel has its own **`pop__head` header** and inline form. Legacy **`ProjectSetupSection`** still contains `project-setup-section__hero` styles but is **not** in the dashboard barrel (reference-only per `dashboard/index.ts`).
4. **Chat focus** is wired in **PopupChatView** (extension) with **`getChatFocusLlmPrefix`**; dashboard **HybridSearch** uses **`useProjectSetupChatContextStore`** for project setup drafts—related UX but different stores and insertion mechanics.

---

## 2. Terminology Map

### User-facing terms (observed in UI strings)

| User-facing | Typical location |
|-------------|------------------|
| **Scam Watchdog** | `WrMultiTriggerBar.buildDropdownRows` label; intro text says “ScamWatchdog Mode” |
| **+ Add Mode** | Dropdown row in `WrMultiTriggerBar` |
| **PROJECT AI OPTIMIZATION** | `ProjectOptimizationPanel` `pop__cap-label` |
| **Auto-Optimization** | `ProjectOptimizationPanel`, `IntelligenceDashboard` StatusCard |
| **Snapshot-Optimization** | Button in `ProjectOptimizationPanel` |
| **Auto-Sync** | Status card / email sync |
| **Watchdog** (short) | Tooltips / `WrChatWatchdogButton` |

### Internal terms

| Internal | Meaning |
|----------|---------|
| `ChatFocusMode.mode: 'scam-watchdog'` | WR Chat LLM prefix for fraud focus (`chatFocusLlmPrefix.ts`) |
| `ChatFocusMode.mode: 'auto-optimizer'` | Focus tied to `projectId`, milestone, run id |
| `TriggerFunctionId` | `{ type: 'watchdog' }` or `{ type: 'auto-optimizer', projectId }` |
| `autoOptimizationEnabled` / `autoOptimizationIntervalMs` | On `Project` in `useProjectStore` |
| `CustomModeDefinition` / `custom:` ids | Persisted custom modes (`useCustomModesStore`) |

### Mismatches

- UI says **“Scam Watchdog”** but internal mode is **`scam-watchdog`** and intro uses **“ScamWatchdog”** (one word) in `WrMultiTriggerBar.emitChatFocus`.
- **“Add Mode”** creates a **custom WR Chat mode** (`useCustomModesStore`), not a **TriggerFunctionId** row. It does not add an optimizer project.
- **“Auto-Optimization”** in the dashboard toggles **`useProjectStore.setAutoOptimization`**; the **header bar checkbox** for optimizer projects calls **`setOptimizerContinuous`** which maps to **`__wrdeskOptimizerHttp.setContinuous`**—intended to stay in sync with the same project flags but **different code paths**.
- **Watchdog** in **`useInboxPreloadQueue`** / **orchestrator** code refers to **unrelated stall watchdogs** (not Scam Watchdog).

### Hardcoded strings tied to logic

- `getChatFocusLlmPrefix`: English system strings for scam and auto-optimization context.
- Guard toasts: `wrdesk:optimization-guard-toast` event payload messages from `autoOptimizationGuards` / HTTP failures.
- `WATCHDOG_SYSTEM_PROMPT`, `MIN_SCAN_INTERVAL_MS` in `watchdogService.ts` (main).

---

## 3. Top Control Bar Analysis

### Components involved

- **`App.tsx`**: Renders `WrMultiTriggerBar` inside `app-header__wr-watchdog` (only header control that opens WR Chat view via `onEnsureWrChatOpen`).
- **`WrMultiTriggerBar.tsx`** (`extension-chromium`): Dropdown built from **Watchdog** + **projects with icons**; **TriggerButtonShell** for optimizer projects; **WrChatWatchdogButton** for Watchdog row; **SpeechBubbleButton** toggles `ChatFocusMode` via `emitChatFocus`.
- **`TriggerButtonShell.tsx`**: Shared chrome for **scan icon**, **interval checkbox**, **speech bubble** slot.
- **`WrChatWatchdogButton.tsx`**: Watchdog-specific scan + **GET/POST watchdog HTTP** + `chrome.runtime.onMessage` for `WATCHDOG_ALERT` / `WATCHDOG_SCAN_CLEAN`.

### Data source for icons/items

- **Projects:** `fetchTriggerProjects()` → `GET http://127.0.0.1:51248/api/projects/trigger-list` with `X-Launch-Secret`.
- **Main process** implements the route by **`readTriggerProjectEntriesFromRenderer`** (`electron/main/projects/triggerProjectList.ts`): executes JS in the **main BrowserWindow** to read **`localStorage['wr-desk-projects']`**, filters projects **`icon` non-empty**, derives **active milestone title** and **`linkedSessionIds`**.

### Selection logic

- Local React state `activeFunctionId: TriggerFunctionId`; default `{ type: 'watchdog' }`.
- Dropdown row click: if same key as active → **`emitChatFocus()`** (toggle chat focus); else set `activeFunctionId` to the row’s function.

### Activation logic

- **Speech bubble:** `emitChatFocus` → `useChatFocusStore.setChatFocusWithIntro` or `clearChatFocusMode`, dispatches `WRCHAT_CHAT_FOCUS_REQUEST_EVENT`, optionally **`onEnsureWrChatOpen`** so App switches to `wr-chat` before focus.
- **Optimizer icon:** `triggerOptimizerSnapshot(projectId)` → HTTP POST snapshot (via `fetchOptimizerTrigger.ts`).
- **Optimizer checkbox:** `setOptimizerContinuous` → HTTP POST continuous → bridge in renderer.

### Where interval checkbox visibility / meaning is controlled

- **Watchdog row:** `WrChatWatchdogButton` always uses `TriggerButtonShell` with checkbox = **`/api/wrchat/watchdog/continuous`** (main `watchdogService`).
- **Optimizer row:** Checkbox = **project auto-optimization** via HTTP bridge (**not** Watchdog). Visibility is tied to **`activeFunctionId.type === 'auto-optimizer'`** (see `WrMultiTriggerBar` render branch).

### Reusable vs brittle

- **Reusable:** `TriggerButtonShell` (visual + checkbox pattern), theme tokens inline in bar.
- **Brittle:** Dual fetch paths for launch secret (`chrome.runtime.sendMessage` vs `handshakeView.pqHeaders`); **main window** must exist for trigger-list; **dropdown + state** duplicated conceptually with **IntelligenceDashboard** project selector (different component tree).

---

## 4. Add Mode / Wizard Analysis

### Components / files

- **`AddModeWizard.tsx`**: Modal, step state, validation, `CustomModeDraft` state.
- **`AddModeWizardStepBody.tsx`**, steps: `StepBasics`, `StepModel`, `StepSession`, `StepFocus`, `StepRun`, `StepReview`, `WizardFieldError`.
- **`addModeWizardTypes.ts`**: Steps: Basics → Model → Session → Focus → **Schedule** → Review.
- **`addModeWizardValidation.ts`**, **`customModeDraftDirty.ts`** (not fully traced here—used for dirty check).
- **`CustomModeWizard.tsx`**: Re-exports **`AddModeWizard`** as `CustomModeWizard` (**deprecated** alias).
- **`AddModeWizardHost.tsx`**: Listens for **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`**, opens **`CustomModeWizard`**, on save: **`useCustomModesStore.addMode`**, **`syncCustomModeDiffWatcher`**, **`setWorkspace('wr-chat')`**, **`setMode(id)`**.

### Creation flow

1. User clicks **+ Add Mode** in `WrMultiTriggerBar` → `window.dispatchEvent(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT)`.
2. **`AddModeWizardHost`** sets `open` true.
3. On successful save, new mode id (e.g. `custom:...`) becomes active in **`useUIStore`**.

### Types / configurations today

- Driven by **`CustomModeDraft`** / **`buildCustomModeFromDraft`** in `shared/ui/customModeTypes` (extension shared). Steps include **Schedule** (wizard metadata—distinct from project optimization interval).

### Forms assembly

- **`AddModeWizardStepBody`** switches on step index and renders step components; data merged into single **`CustomModeDraft`**.

### Where Project Optimization could “mirror” (analysis only)

- Both wizards use **multi-step drafts** and validation, but **different types** (`CustomModeDraft` vs inline `ProjectOptimizationPanel` local state + `useProjectStore`). **No shared form framework** beyond generic patterns.

### Shared validation / handlers

- **`validateAddModeWizardStep`** default in `AddModeWizard`; **ProjectOptimizationPanel** uses inline handlers + `canRunOptimization` for toggles—**no shared module** between the two.

---

## 5. Hero Section Analysis

### What renders the “hero” area today

There is **no single exported component named “Hero”** for the dashboard. Relevant regions:

1. **Intelligence strip (top row):** **`IntelligenceDashboard`** — four cards: Security, Autosort, Transport, **Status** (project selector + Auto-Optimization + Auto-Sync + BEAP/account rows). This is the closest thing to a **dashboard-wide hero / KPI strip**.
2. **Project AI Optimization panel header:** **`ProjectOptimizationPanel`** — `pop__head` with cap label **PROJECT AI OPTIMIZATION** and **+ New Project** when the inline form is collapsed.
3. **Legacy / reference:** **`ProjectSetupSection.tsx`** uses CSS classes like **`project-setup-section__hero`**; **`dashboard/index.ts`** explicitly states legacy components are **not** re-exported and should not be imported in new code.

### How active section / mode is chosen

- **Dashboard layout:** Fixed grid in **`AnalysisCanvas`**; no tab switching inside the hero.
- **Project panel:** `setupMode`: `'collapsed' | 'creating' | 'editing'` controls whether the large inline form appears; **`onSetupModeChange`** propagates to **`AnalysisCanvas`** `isFormEditing` for grid CSS class **`analysis-dashboard__main-grid--editing`**.

### How Project AI Optimization is “injected”

- Not injected into IntelligenceDashboard; it is a **sibling column** below the intel strip in the grid. **`IntelligenceDashboard`** receives **project list + activeProjectId + autoOptimizationEnabled** from the same **`useProjectStore`** selectors as **`ProjectOptimizationPanel`**.

### Dependencies / props / state paths

- **`AnalysisCanvas`** passes `snapshot`, `projects`, `activeProjectId`, handlers into **`IntelligenceDashboard`**; **`ProjectOptimizationPanel`** reads **`useProjectStore`** directly and receives `latestAutosortSession`, `emailAccounts`, callbacks.

### Safe extraction / recomposition (observed coupling)

- **StatusCard** and **ProjectOptimizationPanel** both manipulate **auto-optimization** and **project selection**—must stay consistent if split.
- **`isFormEditing`** is layout-only coupling between **`ProjectOptimizationPanel`** and **`AnalysisCanvas`**.

---

## 6. Project AI Optimization Analysis

### Component map (primary)

| Layer | Files |
|-------|--------|
| Dashboard UI | `ProjectOptimizationPanel.tsx`, `StatusToggle.tsx`, `IntelligenceDashboard.tsx` (StatusCard) |
| Project state | `useProjectStore.ts`, `types/projectTypes.ts` |
| Chat ↔ setup drafts | `useProjectSetupChatContextStore.ts` |
| Guards | `autoOptimizationGuards.ts` |
| Interval + snapshot entry (renderer) | `autoOptimizationEngine.ts` |
| Full run | `optimizationRunCoordinator.ts`, `optimizationContextAssembler.ts`, `optimizationAgentRunner.ts`, `optimizationChainRunner.ts`, `optimizationLlmAdapter.ts` |
| HTTP bridge for extension bar | `wrDeskOptimizerHttpBridge.ts` |
| Main HTTP | `electron/main.ts` routes, `optimizerHttpInvoke.ts`, `triggerProjectList.ts` |

### Features supported (from code paths)

- Create/edit **projects** inline; **milestones** with active/done; **attachments** (BEAP parsing); **linked orchestrator session(s)** for optimization.
- **Auto-Optimization** toggle + **interval** select (`AUTO_OPTIMIZATION_INTERVALS` in `projectTypes.ts`).
- **Snapshot-Optimization** button → `triggerSnapshotOptimization` / `handleRunAnalysisNow` pattern in panel.
- **AI-assisted fields:** select field → push context to **`useProjectSetupChatContextStore`** → user chats in **`HybridSearch`** → **`window.__wrdeskInsertDraft`** inserts into focused field.
- **Open session** / display grids: `handleOpenLinkedSessionDisplayGrids` (extension Chrome).

### Settings and fields

- From **`Project`**: `title`, `description`, `goals`, `milestones[]`, `attachments[]`, `icon`, `linkedSessionIds`, `autoOptimizationEnabled`, `autoOptimizationIntervalMs`, `acceptedSuggestions`, timestamps.

### Milestone handling

- **Store:** `setActiveMilestone`, `toggleMilestoneComplete`, etc.
- **Chat context:** `useProjectSetupChatContextStore.setActiveMilestoneContext` when active milestone changes in **`ProjectOptimizationPanel`** (effect on `activeMilestone`).

### Snapshot-related actions

- **Dashboard:** `triggerSnapshotOptimization` with triggers `'dashboard_snapshot'` / guards.
- **Extension bar:** `fetchOptimizerTrigger.triggerOptimizerSnapshot` → main invokes **`__wrdeskOptimizerHttp.snapshot`** → **`triggerSnapshotOptimization(..., 'extension_snapshot')`**.

### AI-edited fields wiring

- Documented in file header of **`ProjectOptimizationPanel.tsx`**: single selected field, **`WRDESK_FOCUS_AI_CHAT_EVENT`**, **`__wrdeskInsertDraft`**, HybridSearch “Use in …” buttons (see **`HybridSearch.tsx`** grep locations for `__wrdeskInsertDraft`).

### Internal data model

- **`Project`** in `projectTypes.ts`; persisted via Zustand **`persist`** to **`wr-desk-projects`**.

### Must remain untouched for a safe refactor (behavior-critical)

- **`window.__wrdeskInsertDraft`** contract and **`useProjectSetupChatContextStore`** field mapping.
- **`registerWrDeskOptimizerHttpBridge`** assignment to **`window.__wrdeskOptimizerHttp`** and method shapes (`snapshot`, `setContinuous`, `getStatus`).
- **`optimizationRunCoordinator.executeOptimizationRun`** sequence: guard → session → **`WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS`** → **`enterOptimizationFocus`** → LLM → **`exitOptimizationFocus`** on failures/skip paths.
- **`canRunOptimization`** trigger matrix and **`linkedSessionIds`** requirements.

### Presentation-only (lower risk if styling changes)

- CSS classes under **`ProjectOptimizationPanel.css`**, **`IntelligenceDashboard.css`**, **`dashboard-*.css`**, grid modifiers in **`AnalysisCanvas`**.

---

## 7. Monitor / Scam Watchdog Analysis

### What makes a monitor different

- **Scam Watchdog** is **`watchdogService`** in the **main process**: multi-display capture + DOM snapshots from extensions + LLM parse → **`WatchdogThreat[]`**. Exposed over **`/api/wrchat/watchdog/*`**.
- **UI:** **`WrChatWatchdogButton`** uses **`TriggerButtonShell`** with **WatchdogIcon**, not project emoji. Checkbox calls **`/api/wrchat/watchdog/continuous`**. Scan calls **`/api/wrchat/watchdog/scan`**.
- **Alerts:** Main broadcasts to extensions; renderer may receive **`watchdog-alert`** IPC (`preload.ts`); **`App.tsx`** forwards to **`wrchat-watchdog-alert`** custom event for embedded WR Chat.

### Interval-related logic

- **Watchdog:** `WatchdogConfig.intervalMs` in service; auto-adjust when scans slow (`watchdogService.ts`); **continuous** loop separate from project **`autoOptimizationEngine`** interval.

### Alert / status logic

- **WrChatWatchdogButton:** dedupes alerts by `scanId`; **`WATCHDOG_SCAN_CLEAN`** triggers green “clean” flash; runtime messages for `WATCHDOG_ALERT`.

### Shared vs dedicated

- **Shared:** **`TriggerButtonShell`** visual/checkbox pattern.
- **Dedicated:** All HTTP paths under **`/api/wrchat/watchdog/`** vs **`/api/projects/.../optimize/`**.

### What breaks if interval UI were generalized incorrectly

- **Watchdog continuous** could be mistaken for **project auto-optimization**—would call wrong API or toggle wrong Zustand state.
- **Optimizer** checkbox in the bar **requires** `activeFunctionId.type === 'auto-optimizer'`; hiding it for “clean UI” without that guard would leave users unable to sync continuous state.

---

## 8. WR Chat Mode Focus Analysis

### How active mode influences WR Chat

- **`useChatFocusStore`** holds **`chatFocusMode`** and **`focusMeta`**.
- **`getChatFocusLlmPrefix`** (`extension-chromium/src/utils/chatFocusLlmPrefix.ts`) builds a **prefix string** from focus state; for **`auto-optimizer`** it merges **`focusMeta`** with **`localStorage`** `wr-desk-projects` for description/goals if needed.

### Prompt / session / model / context switching

- **`PopupChatView.tsx`**: Before routing to agents/LLM, reads **`getChatFocusLlmPrefix(useChatFocusStore.getState())`** and prepends to user content / hidden context (see ~1059+). Multiple code paths (e.g. ~1252, ~1471) repeat **`getChatFocusLlmPrefix`** for different flows.
- **`WRCHAT_APPEND_ASSISTANT_EVENT`**: Fired from **`setChatFocusWithIntro`** to append intro assistant message when entering focus.

### Listeners / reactive dependencies

- **`WrMultiTriggerBar`**: `WRCHAT_CHAT_FOCUS_REQUEST_EVENT` (custom event).
- **`AddModeWizardHost`**: `WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`.

### Coupling to mode system

- **`useUIStore`** (built-in + custom modes) controls **which WR Chat mode definition** is active for the shell.
- **`ChatFocusMode`** controls **LLM prefix + intro** for Scam Watchdog / optimizer context. **Orthogonal axes**: a user can have a **custom mode** selected in UI store while **`chatFocusMode`** is **`auto-optimizer`**—exact product precedence if they conflict is **not fully enumerated in one file** (flag as **unclear** if both inject system context).

---

## 9. State Management and Data Flow

### Main stores / containers

| Store | Role |
|-------|------|
| **`useProjectStore`** | Projects, milestones, attachments, auto-opt flags, `wr-desk-projects` persist |
| **`useProjectSetupChatContextStore`** | Header AI bridge drafts for project setup |
| **`useEmailInboxStore`** | Auto-sync, inbox refresh |
| **`useChatFocusStore`** (extension) | WR Chat focus + optimization run metadata display |
| **`useCustomModesStore`** | Saved custom modes |
| **`useUIStore`** | Workspace (`wr-chat` vs …) and mode id |
| **`useAnalysisDashboardSnapshot`** | IPC/snapshot for intelligence + activity columns |

### Key objects / schemas

- **`Project`**, **`ChatFocusMode`**, **`TriggerFunctionId`**, **`CustomModeDefinition`** / **`CustomModeDraft`**.

### UI → config → execution

1. **Dashboard toggle:** `setAutoOptimization` → **`startAutoOptimization` / `stopAutoOptimization`** when enabled/disabled from panel (and engine reacts to project).
2. **Run:** `executeOptimizationRun` pulls **`Project`**, fetches session, **`activateSessionForOptimization`**, dispatches session keys to **`localStorage`** via **`WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS`**, enters **`chatFocusStore.enterOptimizationFocus`**, runs agents/LLM.
3. **Extension bar:** HTTP → **`__wrdeskOptimizerHttp`** → same **`triggerSnapshotOptimization` / `startAutoOptimization`** as appropriate.

### Derived state

- **Active milestone** in panel: first `isActive`, else first incomplete (`ProjectOptimizationPanel`).
- **Trigger project list:** derived in main from persisted projects + icon filter.

### Fragile coupling

- **`localStorage` key `wr-desk-projects`** is read by **main** (`triggerProjectList.ts`) **and** **`chatFocusLlmPrefix`** in extension—**shape must stay aligned** with `useProjectStore` persist middleware.
- **`optimizationRunCoordinator`** dynamic imports **`@ext/stores/chatFocusStore`** from Electron renderer bundle—path alias must remain resolvable.

---

## 10. AI-Edited Fields and Smart Form Wiring

### Components / hooks / functions

- **`ProjectOptimizationPanel.tsx`**: sets **`window.__wrdeskInsertDraft`**, `data-field` / `data-milestone-id` attributes, **`flashFieldEl` / `flashMilestoneEl`**.
- **`HybridSearch.tsx`**: listens **`WRDESK_FOCUS_AI_CHAT_EVENT`**; calls **`__wrdeskInsertDraft`** when user applies AI output; subscribes to **`useProjectSetupChatContextStore`** for include-in-chat / setup text.
- **`useProjectSetupChatContextStore`**: drafts for name, goals, milestones, setup text, snippets, active milestone context.
- **`buildProjectSetupChatPrefix`** (if used—referenced in `AnalysisCanvas` header comment): verify consumers when refactoring.

### How AI-assisted editing is triggered

- User clicks **“Select for AI”** on a field → store updated + **`focusHeaderAiChat()`** (`WRDESK_FOCUS_AI_CHAT_EVENT`).

### Forms reusing mechanisms

- **Project optimization inline form** is the **primary** consumer of **`__wrdeskInsertDraft`**. **`ProjectSetupSection`** / modal flows (legacy) duplicate similar **Header AI** patterns—**not** the current barrel path.

### Wiring to preserve

- Global **`window.__wrdeskInsertDraft`** callback registration lifecycle (must be current when HybridSearch inserts).
- **`data-field` / `data-milestone-id`** selectors used by flash helpers.
- **`includeInChat`** + **`projectSetupChatHasBridgeableContent`** gating in **`HybridSearch`** for when to show setup context.

---

## 11. Interval / Scheduler Logic

### Interval checkbox (UI)

| Surface | Behavior |
|---------|----------|
| **ProjectOptimizationPanel** | **Auto-Optimization** `StatusToggle` + interval `<select>` (`AUTO_OPTIMIZATION_INTERVALS`) updating **`setAutoOptimizationInterval`** (via store—verify in panel handlers). |
| **WrMultiTriggerBar** (optimizer) | Checkbox reflects **`getOptimizerStatus`** / **`setOptimizerContinuous`**; does **not** use Watchdog API. |
| **WrChatWatchdogButton** | Checkbox → **`/api/wrchat/watchdog/continuous`**. |

### Recurring execution definition

- **Projects:** `autoOptimizationEngine.startAutoOptimization` → `setInterval` with **`project.autoOptimizationIntervalMs`** (default 300000).
- **Watchdog:** `watchdogService` internal continuous scanning (see `startContinuous` / `intervalMs` in config).

### Automation types using interval UI

- **Project auto-optimization:** yes (dashboard + bar).
- **Watchdog:** separate continuous control.
- **Custom mode wizard** includes a **Schedule** step—**distinct** from project intervals (`addModeWizardTypes`).

### UI ↔ runtime coupling

- **Dashboard:** Direct store + engine (no HTTP for interval toggle).
- **Header bar optimizer:** HTTP → **`__wrdeskOptimizerHttp.setContinuous`** → **`setAutoOptimization` + `startAutoOptimization`** (`wrDeskOptimizerHttpBridge.ts`).

### Isolating monitor-only interval later

- Keep **`WrChatWatchdogButton`** HTTP base **`/api/wrchat/watchdog/`** separate from **`fetchOptimizerTrigger`** **`/api/projects/`**—already separate modules.

---

## 12. Dependency Graph (high level)

```
App.tsx
  ├── WrMultiTriggerBar ── fetchTriggerProjects, fetchOptimizerTrigger
  │       ├── useChatFocusStore
  │       ├── WrChatWatchdogButton → /api/wrchat/watchdog/*
  │       └── TriggerButtonShell
  ├── AnalysisCanvas
  │       ├── useAnalysisDashboardSnapshot
  │       ├── useProjectStore
  │       ├── useEmailInboxStore
  │       ├── IntelligenceDashboard
  │       └── ProjectOptimizationPanel
  │               ├── useProjectSetupChatContextStore
  │               ├── autoOptimizationEngine / guards
  │               └── optimization triggers
  ├── HybridSearch (header) ↔ useProjectSetupChatContextStore, __wrdeskInsertDraft
  ├── AddModeWizardHost → useCustomModesStore, useUIStore
  └── registerWrDeskOptimizerHttpBridge → window.__wrdeskOptimizerHttp

electron/main.ts
  ├── GET /api/projects/trigger-list → readTriggerProjectEntriesFromRenderer
  └── POST/GET /api/projects/:id/optimize/* → invokeOptimizer* → executeJavaScript(__wrdeskOptimizerHttp.*)

optimizationRunCoordinator.ts
  ├── useProjectStore (project data)
  ├── useChatFocusStore (enter/exit optimization focus)
  ├── @ext/services/sessionActivationForOptimization
  └── LLM + agent runners
```

**Parent/child:** `AnalysisCanvas` is parent to **`IntelligenceDashboard`** and **`ProjectOptimizationPanel`**; **`StatusCard`** is **child** of **`IntelligenceDashboard`**, not of the project panel.

---

## 13. Safe Refactor Boundaries

### UI-only renames (low risk if no string keys)

- CSS class names in **`ProjectOptimizationPanel`** / **`IntelligenceDashboard`** if tests/snapshots updated.
- Labels in **`WrMultiTriggerBar`** (watch copy for **`getChatFocusLlmPrefix`** consistency if marketing strings change).

### Move without changing runtime (if imports updated)

- Presentational subcomponents extracted from **`IntelligenceDashboard`** cards.
- **`TriggerButtonShell`** theming moved to CSS modules—behavior hooks unchanged.

### Wrap instead of rewrite

- **`registerWrDeskOptimizerHttpBridge`**: keep public **`window.__wrdeskOptimizerHttp`** API.
- **`getChatFocusLlmPrefix`**: wrap to add telemetry; do not change return format without updating **`PopupChatView`** injection points.

### Do not touch in phase 1 (without full regression)

- **`optimizationRunCoordinator.executeOptimizationRun`** ordering and guard events.
- **`wr-desk-projects`** persist shape and **`readTriggerProjectEntriesFromRenderer`** parsing.
- **`__wrdeskInsertDraft`** and HybridSearch insertion paths.
- Main **HTTP invoke** bridge **`optimizerHttpInvoke.ts`**.

---

## 14. High-Risk Areas

| Risk | Location |
|------|----------|
| Silent break if **`localStorage`** shape drifts | `triggerProjectList.ts`, `chatFocusLlmPrefix.ts`, `useProjectStore` |
| **Two interval systems** confused | `WrMultiTriggerBar` vs `ProjectOptimizationPanel` vs Watchdog |
| **`ChatFocusMode`** / **`useUIStore`** double context | `PopupChatView` + mode shell |
| **Guard toast** only visible on Electron **`App.tsx`** listener | `WRDESK_OPTIMIZATION_GUARD_TOAST` |
| **`executeJavaScript` bridge** failure | `invokeOptimizer*` returns **bridge not ready** |
| **Stale `__wrdeskInsertDraft`** | If panel unmounts without clearing callback |

---

## 15. Recommended Refactor Strategy (Analysis Only)

### Phase 1 — safest structural changes

- Document and freeze **public contracts**: `__wrdeskOptimizerHttp`, `__wrdeskInsertDraft`, `WRDESK_*` event names, `wr-desk-projects` schema.
- Extract **pure presentational** chunks from **`IntelligenceDashboard`** / **`ProjectOptimizationPanel`** with **no prop signature changes** initially.
- Add **developer-facing diagram** of **Watchdog vs Project optimizer** checkboxes (documentation only).

### Phase 2 — medium-risk cleanup

- Consolidate **duplicate** “active milestone title” logic between **`triggerProjectList.ts`** and UI (single helper, same algorithm).
- Centralize **launch secret** header building if duplicated strings cause maintenance bugs (keep fallbacks).

### Phase 3 — later architectural cleanup

- Replace **main reading localStorage** for trigger list with an explicit **IPC or shared service** if product accepts migration cost—**not** required for UI-only hero refactor if boundaries respected.
- Evaluate merging **`ChatFocusMode`** UX with **`useUIStore`** mode selection—**high conceptual risk**; needs dedicated design after Phase 1–2 stability.

---

## 16. Appendix

### File list (short descriptions)

| File | Description |
|------|-------------|
| `electron-vite-project/src/App.tsx` | Top-level views, `WrMultiTriggerBar`, `AddModeWizardHost`, optimization toast listener |
| `electron-vite-project/src/components/AnalysisCanvas.tsx` | Dashboard grid composition |
| `electron-vite-project/src/components/analysis/dashboard/IntelligenceDashboard.tsx` | Security/Autosort/Transport/Status cards |
| `electron-vite-project/src/components/analysis/dashboard/ProjectOptimizationPanel.tsx` | Main Project AI Optimization UI + AI field wiring |
| `electron-vite-project/src/components/analysis/dashboard/index.ts` | Barrel; lists legacy exclusions |
| `electron-vite-project/src/components/HybridSearch.tsx` | Header AI chat, `__wrdeskInsertDraft`, setup context |
| `electron-vite-project/src/stores/useProjectStore.ts` | Project persistence + actions |
| `electron-vite-project/src/stores/useProjectSetupChatContextStore.ts` | Header AI draft bridge |
| `electron-vite-project/src/lib/autoOptimizationEngine.ts` | Interval scheduler for auto-optimization |
| `electron-vite-project/src/lib/optimizationRunCoordinator.ts` | Full optimization pipeline |
| `electron-vite-project/src/lib/wrDeskOptimizerHttpBridge.ts` | `window.__wrdeskOptimizerHttp` |
| `electron-vite-project/src/lib/wrdeskUiEvents.ts` | Custom event name constants |
| `electron-vite-project/electron/main.ts` | HTTP routes for projects + watchdog |
| `electron-vite-project/electron/main/projects/triggerProjectList.ts` | Trigger list from renderer localStorage |
| `electron-vite-project/electron/main/projects/optimizerHttpInvoke.ts` | Bridge invoke helpers |
| `extension-chromium/src/ui/components/wrMultiTrigger/WrMultiTriggerBar.tsx` | Header mode + optimizer controls |
| `extension-chromium/src/ui/components/WrChatWatchdogButton.tsx` | Watchdog scan + continuous |
| `extension-chromium/src/ui/components/wrMultiTrigger/TriggerButtonShell.tsx` | Shared button row shell |
| `extension-chromium/src/services/fetchOptimizerTrigger.ts` | HTTP client for optimizer snapshot/continuous/status |
| `extension-chromium/src/services/fetchTriggerProjects.ts` | HTTP client for trigger list |
| `extension-chromium/src/stores/chatFocusStore.ts` | WR Chat focus state |
| `extension-chromium/src/utils/chatFocusLlmPrefix.ts` | LLM prefix from focus + localStorage |
| `extension-chromium/src/ui/components/PopupChatView.tsx` | Injects `getChatFocusLlmPrefix` into send pipeline |
| `extension-chromium/src/ui/components/addModeWizard/*` | Add Mode wizard |
| `extension-chromium/src/ui/components/AddModeWizardHost.tsx` | Wizard host + `useCustomModesStore` |
| `electron-vite-project/electron/watchdog/watchdogService.ts` | Scam Watchdog scanner service |

### Key functions / hooks summary

- **`canRunOptimization`**, **`applyOptimizationGuardFallback`**: entry guards.
- **`startAutoOptimization` / `stopAutoOptimization` / `triggerSnapshotOptimization`**: renderer-side automation.
- **`executeOptimizationRun`**: end-to-end run.
- **`fetchTriggerProjects`**, **`readTriggerProjectEntriesFromRenderer`**: project rows for bar.
- **`getChatFocusLlmPrefix`**: WR Chat LLM context injection.
- **`emitChatFocus`** (inside `WrMultiTriggerBar`): toggles chat focus + intros.

### Open questions / unclear areas

- **Exact precedence** when **`useUIStore`** selects a **custom mode** and **`chatFocusMode`** is **`auto-optimizer`**—both may affect **`PopupChatView`**; full resolution would require tracing **mode shell** rendering vs **focus prefix** in all branches.
- **`ProjectSetupModal.tsx`** is re-exported from `dashboard/index.ts` but **no other file** in `electron-vite-project` imports it (only the barrel references it)—likely **unused** in the current surface; confirm before deletion.
- **Schedule step** in Add Mode wizard: how it maps to runtime scheduling—**not** traced in this document.

---

## 17. Locked constraints (refactor step)

These rules apply to incremental UI refactors unless a change request **explicitly** overrides them (and should be reviewed as a pair).

### Runtime and contracts

- Preserve all existing runtime behavior **unless** this step explicitly changes it.
- **Do not break or rename** these public contracts:
  - `window.__wrdeskInsertDraft`
  - `window.__wrdeskOptimizerHttp`
  - `WRDESK_FOCUS_AI_CHAT_EVENT` (see `wrdeskUiEvents.ts`)
  - `WRCHAT_CHAT_FOCUS_REQUEST_EVENT` (`WrMultiTriggerBar.tsx`)
  - `WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT` (`WrMultiTriggerBar.tsx` / `AddModeWizardHost.tsx`)
  - `wr-desk-projects` persisted shape (`useProjectStore` persist)

### AI-assisted field editing (Project UI + HybridSearch)

- Preserve behavior **exactly**: fields remain **selectable and deselectable** from the Project UI.
- Top chat / **HybridSearch** must still be able to target the **selected** field.
- **Milestone** field targeting must keep working.
- **`data-field`** and **`data-milestone-id`** wiring must remain valid (including flash/insert helpers that query these attributes).

### Stores and bridges

- Preserve **`useProjectSetupChatContextStore`** wiring; **do not** replace it with a new abstraction in this phase.
- Preserve **optimizer HTTP bridge** behavior and **method signatures** (`wrDeskOptimizerHttpBridge.ts`).

### Watchdog vs project optimization

- Preserve **Scam Watchdog** behavior as implemented today.
- **Do not** merge Watchdog **interval / continuous** semantics with **project auto-optimization** semantics.

### Process

- Prefer **wrapping** and **reusing** existing components over rewriting them.
- If a **risky rewrite** seems necessary, **stop and explain** first instead of implementing.
- Keep changes **incremental**, **reviewable**, and **file-scoped**.

---

*Generated for manual review. Update this file when code changes materially.*
