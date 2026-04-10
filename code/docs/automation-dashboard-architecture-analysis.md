# Automation Dashboard Architecture Analysis

**Scope:** Current merged codebase (Electron `electron-vite-project` + extension `extension-chromium`), code-grounded.  
**Purpose:** Plan a safe, incremental refactor toward a premium, high-density, automation-first dashboard without breaking fragile contracts.

---

## 1. Executive Summary

### Current merged UI state

- **Analysis** (`AnalysisCanvas.tsx`) is a **three-band** layout: (1) full-width **`IntelligenceDashboard`** (four metric cards: Security, Autosort, Transport, Status), (2) left **hero** (~60% grid column) that is **either** `DashboardAutomationHome` **or** the **Project Assistant** workspace (`ProjectOptimizationPanel` wrapped in `analysis-pa-workspace`), (3) right **`ActivityFeedColumn`** (~340px fixed in CSS).
- **Default hero** when the user is not in the PA workspace is **`DashboardAutomationHome`**: in-code **four** starter cards (Reply to Incoming Letter, Email Composer, Document Actions, BEAP Composer) plus a **secondary** section **“Your Project Assistants”** listing persisted projects from `useProjectStore`.
- **Project Assistant / optimization** runtime lives in **`ProjectOptimizationPanel`**. Create/edit uses **`ProjectAssistantConfigModal`** (portal) — not inline in the hero. Header **`WrMultiTriggerBar`** (extension UI embedded in `App.tsx`) provides **Scam Watchdog**, **per-project rows** (projects with icons via `GET /api/projects/trigger-list`), **+ Add Automation** (`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`), and **+ Add Project Assistant** (`WRDESK_OPEN_PROJECT_ASSISTANT_CREATION`).
- **Workspace visibility** is controlled in **`AnalysisCanvas`**: `showProjectAssistantWorkspace` is true only when `projectAssistantWorkspaceOpen` is set and the trigger is **auto-optimizer** or a **pending Add-PA session**; **dismiss ref** logic prevents re-opening immediately after **← Automation home** until the trigger key changes or the user re-enters from home/Add PA.

### Why the hero can still feel structurally wrong

1. **Vertical competition:** **`IntelligenceDashboard`** occupies a **full-width row above** the hero with **four** large cards (Security, Autosort, Transport, Status). That pushes the **automation-first** surface **below the fold** on many viewports and competes visually with the monetizable starter area.
2. **Hero copy + card sizing:** **`DashboardAutomationHome`** includes a **hero header** (badge + H2 + paragraph) and **pinned** cards with **`min-height: 168px`**, **`description`** paragraphs, and a **secondary** Project Assistants section with its own lede — consistent with “starter” UX but **not yet** minimal or density-first.
3. **Starters are navigation shells:** Starter **`AutomationCardDef`** items only call **`onNavigateInbox` / `onNavigateWrChat` / `onNavigateBulkInbox`** — they do **not** invoke new automation pipelines. “Premium starter” product intent implies **clearer value** and possibly **dedicated flows**; today the architecture is **honestly** “deep links to existing app surfaces.”
4. **Naming vs product:** The UI says **“Project Assistants”**; product direction says **“Project WIKI”** — **no** `WIKI` string exists in the analyzed hero code; rename is **copy/store** concern, not a separate route yet.

### Biggest opportunities (architecture-level)

- **Tighten the default hero** without touching fragile POP/HybridSearch wiring: refactor **`DashboardAutomationHome`** + **`DashboardAutomationHome.css`** first (density, copy, card component).
- **Reduce Intelligence row dominance** selectively (collapse, compact strip, or reorder) — **higher risk** if KPIs are relied on for trust; plan metrics preservation.
- **Unify launcher patterns:** Top bar already exposes **Add Automation** (wizard) and **Add Project Assistant** (desktop event). Making user-created automations **discoverable** is mostly **UX + optional** surfacing of `useCustomModesStore` modes in the bar or hero — **not** yet wired in code as first-class rows.
- **Preserve** all **§9** contracts when moving DOM; **wrap** rather than reimplement POP internals.

---

## 2. Current Dashboard Composition

| Zone | Component(s) | Source file(s) |
|------|----------------|-----------------|
| **App shell header** | Brand, nav tabs (Analysis, Handshakes, Inbox…), **`WrMultiTriggerBar`**, **`HybridSearch`** | `App.tsx` |
| **Top control bar (WR Chat context)** | **`WrMultiTriggerBar`** — dropdown (Watchdog + icon projects), **`WrChatWatchdogButton`** / **`TriggerButtonShell`** modes, **`AddModeWizardHost`** (sibling under `main`, listens for wizard event) | `extension-chromium/.../WrMultiTriggerBar.tsx`, `AddModeWizardHost.tsx` |
| **Hero / workspace (Analysis left column)** | **`DashboardAutomationHome`** **or** **`ProjectOptimizationPanel`** inside **`analysis-pa-workspace`** | `AnalysisCanvas.tsx`, `DashboardAutomationHome.tsx`, `ProjectOptimizationPanel.tsx` |
| **Pinned starters / cards** | Four **`AutomationCardDef`** entries in **`starterCards`** useMemo | `DashboardAutomationHome.tsx` |
| **Project Assistant / optimization / future WIKI** | **`ProjectOptimizationPanel`** — selector, repeat toggle, snapshot, roadmap, modal form; **not** a separate “wiki” module | `ProjectOptimizationPanel.tsx`, `ProjectAssistantConfigModal.tsx` |
| **Status / transport / inbox (intel strip)** | **`IntelligenceDashboard`** — Security, Autosort, Transport, **Status** (repeat toggle duplicate-suppressed when PA open) | `IntelligenceDashboard.tsx` |
| **Side column** | **`ActivityFeedColumn`** — priority inbox + PoAE artifacts from snapshot | `ActivityFeedColumn.tsx` |

**Merged refactor composition (actual):** `AnalysisCanvas` passes **`suppressProjectAssistantDuplicateSurface={showProjectAssistantWorkspace}`** into **`IntelligenceDashboard`** so Status card does not duplicate **Repeat linked session** when POP is visible.

---

## 3. Current Automation Surface Inventory

### Mail Composer (“Email Composer” card)

| | |
|--|--|
| **Where** | `DashboardAutomationHome` — id `email-composer`; **Run** → `onNavigateWrChat`, **Edit** → `onNavigateInbox` |
| **Backend** | None in hero — **navigation only** to existing views (`App` sets `activeView`) |
| **Hero-ready** | Yes as a **launcher card**; **not** a distinct composer pipeline in this component |
| **Gap for premium** | Needs **product-defined** composer flow if “Mail Composer” is more than WR Chat + inbox; currently **reuse** of shell navigation |

### BEAP Composer

| | |
|--|--|
| **Where** | Card id `beap-composer`; **Run** → bulk inbox, **Edit** → WR Chat |
| **Backend** | Navigation only |
| **Hero-ready** | Same as above — **pattern** matches other cards |
| **Gap** | **BEAP-specific** orchestration not represented in `starterCards` beyond routing |

### Scam Watchdog

| | |
|--|--|
| **Where** | **Not** on `DashboardAutomationHome`. **Header** `WrMultiTriggerBar` — **`WrChatWatchdogButton`**, HTTP **`/api/wrchat/watchdog/*`**, continuous checkbox in **monitor** `TriggerButtonShell` mode |
| **Backend** | `electron/watchdog/watchdogService.ts`, HTTP routes in `main.ts` |
| **Hero-ready** | **Already first-class in the bar**, not in the automation grid |
| **Gap** | Product wants it **also** as a starter automation — would be **second surface** unless hero links to **same** watchdog row (risk: duplicate controls unless carefully unified) |

### Project Assistant / Project Optimization (Project WIKI scaffold)

| | |
|--|--|
| **Where** | **`ProjectOptimizationPanel`**, modal **`ProjectAssistantConfigModal`**, **`useProjectStore`**, optional **`ActiveAutomationWorkspace`** (barrel legacy wrapper, not used in `AnalysisCanvas`) |
| **Backend** | Zustand **`wr-desk-projects`**, optimizer HTTP + **`autoOptimizationEngine`**, linked sessions, display grids via **`openSessionDisplayGridsFromDashboard`** |
| **Hero-ready** | **Secondary** by design — list under **“Your Project Assistants”** on automation home |
| **Gap** | Rename to **Project WIKI** is **copy + future** IA; **data model** is still “project” with milestones, not wiki pages |

### Custom mode / automation wizard

| | |
|--|--|
| **Where** | **`AddModeWizardHost`** mounts **`CustomModeWizard`**; opened by **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`** from **`WrMultiTriggerBar`** (“+ Add Automation”) |
| **Backend** | **`useCustomModesStore`** — persists custom modes; **`syncCustomModeDiffWatcher`** |
| **Hero-ready** | **Indirect** — users must use dropdown; **no** hero tile for “your automations” list in Electron shell |

### Action cards / reusable shell

| | |
|--|--|
| **Pattern** | **`AutomationCardDef`** + CSS **`dash-auto-home__card`** — **not** a shared exported component; **inline** map in one file |
| **Run / Edit / sub-triggers** | **Implemented** — primary/ghost buttons + optional **`subTriggers`** chips |

---

## 4. Hero / Workspace Rendering Logic

### Selection rules (actual code)

- **`showProjectAssistantWorkspace`** = `projectAssistantWorkspaceOpen && (activeTriggerFunctionId.type === 'auto-optimizer' || pendingProjectAssistantCreateSession)` (`AnalysisCanvas.tsx`).
- **Effects** set `projectAssistantWorkspaceOpen` when: **auto-optimizer** selected (unless **dismissed** after **← Automation home**), **pending Add PA**, or **Watchdog** clears workspace (unless pending).
- **Hero default:** when the above is false, **`DashboardAutomationHome`** renders.

### What made PA “dominate” historically vs today

- **Before** exclusive hero + modal refactor, risk was **inline form** consuming the column. **Today** the **runtime** panel still **dominates the left column** when open — **by design** when the user selects PA.
- **Duplicate** risk: **`IntelligenceDashboard` Status** vs POP **repeat** — mitigated by **`suppressProjectAssistantDuplicateSurface`**.

### Making default hero “more automation-first”

- **Layout/CSS:** Reduce **`IntelligenceDashboard`** height or defer to collapse — **does not** require POP changes.
- **`DashboardAutomationHome`:** Reduce hero header text, card **`min-height`**, grid **`minmax`** — **safe** if POP unchanged.
- **No** unified **`activeWorkspace`** enum beyond boolean + trigger type — **partial** scaffolding only (`showProjectAssistantWorkspace` + dismiss ref).

---

## 5. Top Control Bar Analysis

### Architecture

- **`WrMultiTriggerBar`** (`extension-chromium/.../WrMultiTriggerBar.tsx`): builds **`buildDropdownRows`** = Watchdog + **`fetchTriggerProjects()`** (icon projects only).
- **Pinned entries:** Not “pinned” in React state — **dropdown list** + **active row** drives **`emitChatFocus`** and optimizer snapshot for project rows.
- **`+ Add Automation`:** dispatches **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`** → **`AddModeWizardHost`** opens **`CustomModeWizard`**.
- **`+ Add Project Assistant`:** dispatches **`WRDESK_OPEN_PROJECT_ASSISTANT_CREATION`** → **`App.tsx`** bumps **`projectAssistantCreateToken`** → **`AnalysisCanvas`** opens PA workspace + **`openCreateMode`**.

### Safe reuse vs risk

| Safe | Risky |
|------|--------|
| Add **another** dropdown row that dispatches a **new** `CustomEvent` (mirror Add PA / Add Automation pattern) | Renaming **`WRCHAT_*` / `WRDESK_*`** strings without updating all listeners |
| **`TriggerFunctionId`** only has **watchdog** and **auto-optimizer** — adding types needs **chat focus store** + bar + App sync | Coupling **AnalysisCanvas** to extension internal state beyond **`activeTriggerFunctionId`** props |

### Future “+ Add Project WIKI”

- **If** WIKI is **rename + same POP**: **no** new row needed — **copy** only.
- **If** separate surface: new event + **`App.tsx`** handler pattern (same as **`WRDESK_OPEN_PROJECT_ASSISTANT_CREATION`**).

---

## 6. Starter Automation Card Architecture

### Generic abstraction?

- **In-code:** **`AutomationCardDef`** type + **`starterCards`** `useMemo` — **not** exported from a shared package.
- **Metadata source:** **Hardcoded** in `DashboardAutomationHome.tsx` (no JSON/API).

### Desired capabilities vs today

| Capability | Today |
|------------|--------|
| Editable starters | **No** — constants in source |
| Runnable | **Yes** — buttons call navigation callbacks |
| Duplicatable | **N/A** |
| Pinnable | **Fixed** list — section title “Pinned starters” only |
| Sub-triggers | **Yes** — `subTriggers` array |

### To reach “dense + premium”

- **Likely:** extract **`StarterAutomationCard`** presentational component + **drive list** from **config array** (still static or later persisted).
- **CSS:** `DashboardAutomationHome.css` controls perceived size (**`min-height: 168px`**, padding, subtitle **`max-width`**).

---

## 7. Existing Execution Paths for High-Value Automations

### 7.1 Mail Composer

- **Exists:** Card **“Email Composer”** — **Run** → WR Chat view, **Edit** → Inbox navigation (`App` callbacks).
- **Wiring:** `AnalysisCanvas` props **`onNavigateToWrChat`**, **`onOpenInbox`** passed from **`App.tsx`**.
- **Output surfaces:** WR Chat / Inbox — **not** a dedicated composer route in the hero file.

### 7.2 BEAP Composer

- **Exists:** Card routes to **bulk inbox** and **WR Chat** / **Inbox** via same pattern.
- **Reuse:** Same **`AutomationCardDef`** pattern; **BEAP** logic lives in **BEAP/inbox** views, not hero.

### 7.3 Reply to Incoming Letter

- **Exists:** Card **“Reply to Incoming Letter”** — **Run** → **`onNavigateInbox`**, **Edit** → **`onNavigateWrChat`**.
- **Blocks for “true” reply workflow:** No hero-local **draft** or **letter** entity — **inbox** view must supply UX.
- **Display grid:** Optimization pipeline uses **`openSessionDisplayGridsFromDashboard`** + **`DomSnapshot`** / **`DomSlotCapture`** with **`textDigest`** — **text-oriented** capture for LLM. **Not** proven in this pass that **grid** = “text only” for **all** features — see **§10**.
- **Feasibility:** Incremental — **new** starter action can **chain** existing IPC **if** product defines steps; **hero** changes alone do not add pipeline.

### 7.4 Document Actions

- **Current:** Routes to **bulk inbox** / **inbox** / **WR Chat** — **no** document upload in `DashboardAutomationHome`.
- **Hooks elsewhere:** Attachments in **POP** use **file input + parse** — **different** surface.

### 7.5 Scam Watchdog

- **Exists:** **`WrChatWatchdogButton`**, **`/api/wrchat/watchdog/scan`**, **`/continuous`**, **`/status`**.
- **System vs editable:** **Continuous** + **scan** are **security** flows; **editable “starter”** in hero would be **UX** (shortcut) not a second backend unless spec changes.
- **Surface as starter:** Add card that **navigates** to WR Chat + **sets chat focus** to scam-watchdog — would reuse **`useChatFocusStore`** / **`WRCHAT_CHAT_FOCUS_REQUEST_EVENT`** pattern from **`WrMultiTriggerBar.emitChatFocus`** — **touches focus pipeline** → **medium risk**, test carefully.

### 7.6 Reputation Scanner

- **Code search:** **No** `ReputationScanner`, **reputation** feature module, or dedicated route found in the analyzed TS/TSX set (only **generic** “reputation” wording in unrelated docs/comments).
- **Conclusion:** **Net new** capability — **backend + orchestration + UI**; **not** low-hanging from current dashboard code alone.

### 7.7 Social Media Drafting

- **Code search:** No **social media drafting** connector; **sanitizer** / **ipc** comments mention **social** in **email** context only.
- **Conclusion:** **Not** present as automation surface — would be **new integration** work.

---

## 8. Project WIKI Analysis (from current Project Assistant scaffold)

| Aspect | Reality in code |
|--------|------------------|
| **Configuration** | **`ProjectOptimizationPanel`** create/edit modal — fields, milestones, linked session, attachments, icon |
| **Runtime** | Same panel — roadmap, repeat toggle, snapshot, orchestrator linking |
| **Milestones / snapshots / AI fields** | **Core** — tied to **`useProjectStore`** and **§9** contracts |
| **Rename to Project WIKI** | **Strings** in `DashboardAutomationHome`, `ProjectOptimizationPanel` headers, docs — **preserve** store keys and **`wr-desk-projects`** shape |
| **Secondary hero placement** | **“Your Project Assistants”** section — already **below** pinned starters; can stay **collapsed** or **compact** without removing POP |

---

## 9. AI-Edited Field Wiring (Detailed)

| Mechanism | Behavior | Files |
|-----------|----------|-------|
| **Field selection** | **`handleFieldSelect`** sets **`selectedField`**, clears chat attachments/conversation, sets **`window.__wrdeskInsertDraft`** closure for title/description/goals/milestone bulk | `ProjectOptimizationPanel.tsx` |
| **Deselection** | Clicking same field toggles off — **`__wrdeskInsertDraft = undefined`** | same |
| **Milestone targeting** | **`handleQuickEditMilestone`**, **`data-milestone-id`**, **`quickEditMilestoneId`** | same |
| **`WRDESK_FOCUS_AI_CHAT_EVENT`** | **`focusHeaderAiChat()`** dispatches **`wrdesk:focus-ai-chat`** | `ProjectOptimizationPanel.tsx`, **`HybridSearch.tsx`** listens |
| **HybridSearch insertion** | Calls **`window.__wrdeskInsertDraft?.(text, mode)`** for append/replace | `HybridSearch.tsx` |
| **`data-field` / `data-milestone-id`** | Required for **flash** helpers + **DEV** asserts | `projectAssistantAiFieldContracts.ts` |
| **`useProjectSetupChatContextStore`** | Drafts + **`activeMilestoneContext`** for **HybridSearch** prefix | `useProjectSetupChatContextStore.ts`, **`HybridSearch`** consumers |

**Must not break on UI move:** **`__wrdeskInsertDraft`** lifecycle (set/clear on mode change/unmount), **store** sync effects, **querySelector** targets for flash.

**Safe to wrap:** Modal **portal** already wraps form — **moving** POP in the tree is OK if **portal still mounts under `document.body`** and **field DOM** remains in React subtree **or** same document.

**DOM dependence:** **Flash** uses **`querySelector`/`data-*`** — **structural** coupling.

---

## 10. Display Grid / Output Surface Analysis

- **Bridge:** **`openSessionDisplayGridsFromDashboard.ts`** calls **`window.analysisDashboard.presentOrchestratorDisplayGrid`** when available.
- **LLM serialization:** **`DomSnapshot`** / **`DomSlotCapture`** include **`textDigest`**, **`truncated`** — **text-centric** model for optimization (**`optimizationTypes.ts`**).
- **Multiple drafts / slider / tone:** **Not** validated in this document from grid HTML alone (extension **build output** lists **`grid-display.html`**, **`grid-script*.js`** — **behavior** would require reading those assets or runtime testing). **Assumption:** extending **grid** UX is **extension-side** work; **Electron** dashboard **triggers** opening via **existing** bridge.

**Easy:** Opening **same** session grids from **POP** (already wired).  
**Hard:** New **layout modes** or **non-text** media without extension changes.

---

## 11. Wizard / Add Automation Analysis

- **Launch:** **`WrMultiTriggerBar`** → **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`** → **`AddModeWizardHost`** → **`CustomModeWizard`** **`open={phase==='custom'}`**.
- **Persistence:** **`useCustomModesStore.addMode`** on save; switches workspace to **WR Chat** and **mode** to new id.
- **Discoverability gap:** **No** first-class list in **Electron** header of **user modes** — users rely on **WR Chat ModeSelect** / extension UX.
- **Shared launcher with starters:** **Possible** — both could dispatch events or navigate; **starters** today **do not** use **`useCustomModesStore`**.
- **Separate creation for WIKI vs PA:** **Today** PA uses **POP modal** + **Zustand projects**; custom modes use **CustomModeWizard** + **different store** — **intentionally separate** per **`AddModeWizardHost`** comments.

---

## 12. Interval / Trigger / Scheduler Semantics

| Mechanism | Meaning | Where |
|-----------|---------|--------|
| **Watchdog continuous** | **Screen-scan** interval via **`watchdogService`**, HTTP **`/api/wrchat/watchdog/continuous`** | **`WrChatWatchdogButton`**, **`TriggerButtonShell`** monitor mode |
| **Project auto-optimization** | **`autoOptimizationEnabled`** + **`autoOptimizationIntervalMs`** on **`Project`**, **`startAutoOptimization`/`stopAutoOptimization`**, repeat on **linked WR Chat session** | **`useProjectStore`**, **`ProjectOptimizationPanel`**, **`autoOptimizationEngine.ts`** |
| **Extension bar project row** | **`TriggerButtonShell`** **`mode="snapshot"`** — **no** interval UI; **snapshot** via **`triggerOptimizerSnapshot`** | **`WrMultiTriggerBar.tsx`** |
| **Custom mode wizard** | **No** `schedule`/`interval` strings in **`CustomModeWizard.tsx`** from grep — **scheduler step** not confirmed in that file; **may** live in **draft** types elsewhere — **verify** before claiming schedule UX |

**UI mixing:** Historically **two “interval” concepts** (watchdog vs project optimizer) — **partially separated** by **`TriggerButtonShell`** modes and docs in **`wrDeskOptimizerHttpBridge.ts`**.

---

## 13. Density / Premium UI Opportunities (Code-grounded)

- **`IntelligenceDashboard`:** Four **full cards** in a row — **large** fixed visual weight (`IntelligenceDashboard.css` + card internals).
- **`DashboardAutomationHome`:** **`dash-auto-home__subtitle`** + **`section-lede`** + **`min-height: 168px`** cards — **explicit** vertical cost.
- **Grid:** **`analysis-dashboard__main-grid`** — **`340px`** activity column; intel row **auto** height — **reducing** intel or hero padding **frees** space without touching POP logic.
- **Side column:** Fixed **340px** — **shrinking** requires **`AnalysisCanvas.css`** grid template change — **test** `ActivityFeedColumn` overflow.

---

## 14. Safe Reuse Opportunities

- **`AutomationCardDef`** pattern + **`dash-auto-home__*`** CSS classes.
- **`StatusToggle`**, **`TriggerButtonShell`**, **`WrMultiTriggerBar`** event constants.
- **`WRDESK_TRIGGER_SYNC_AUTO_OPTIMIZER_PROJECT`** for **project row sync** from hero.
- **`openSessionDisplayGridsFromDashboard`** for **session** output.
- **`useCustomModesStore`** for listing **user modes** (read-only display) if UI needs it.

---

## 15. High-Risk Areas

- **`window.__wrdeskInsertDraft`** / **`window.__wrdeskOptimizerHttp`** — **global contracts** with **main** HTTP.
- **Event strings:** **`WRDESK_FOCUS_AI_CHAT_EVENT`**, **`WRCHAT_CHAT_FOCUS_REQUEST_EVENT`**, **`WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT`**, **`WRDESK_OPEN_PROJECT_ASSISTANT_CREATION`**.
- **`wr-desk-projects`** **persist** + **`migrate`** in **`useProjectStore`**.
- **POP** **field** / **milestone** **DOM** attributes.
- **Trigger bar** **`ChatFocusMode`** + **`useChatFocusStore`**.
- **Watchdog** HTTP + **IPC** **`watchdog-alert`**.
- **`fetchTriggerProjects`** / **`GET /api/projects/trigger-list`** — **icon-gated** project list.

---

## 16. Recommended Refactor Boundaries (Conservative)

**First pass (lower risk):**

1. **`DashboardAutomationHome` + CSS** — density, copy, optional **remove** hero paragraph; **add** starter row for **Watchdog** as **navigation + focus** only if spec’d.
2. **Intel strip** — **one** measurable compaction (padding, font, or collapsible region) **without** removing data dependencies.

**Wait:**

- **Reputation / social** automations until **backend** exists.
- **Deep** `IntelligenceDashboard` data model changes.

**Do not change in pass one:**

- **`ProjectOptimizationPanel`** insert/flash/store wiring (**unless** pure presentational wrappers).
- **Event** string values and **bridge** method names.
- **`wr-desk-projects`** shape without **migration**.

---

## 17. Appendix

### A. Relevant files (abbrev.)

| File | Role |
|------|------|
| `apps/electron-vite-project/src/components/AnalysisCanvas.tsx` | Dashboard layout, PA vs automation home, dismiss ref |
| `.../dashboard/DashboardAutomationHome.tsx` | Starter cards + project list |
| `.../dashboard/DashboardAutomationHome.css` | Card/grid/hero sizing |
| `.../dashboard/ProjectOptimizationPanel.tsx` | PA runtime + modal form |
| `.../dashboard/ProjectAssistantConfigModal.tsx` | Create/edit portal shell |
| `.../dashboard/IntelligenceDashboard.tsx` | Four intel cards |
| `.../components/HybridSearch.tsx` | Insert draft + focus listener |
| `.../lib/wrdeskUiEvents.ts` | **`WRDESK_FOCUS_AI_CHAT_EVENT`** |
| `.../lib/wrDeskOptimizerHttpBridge.ts` | **`__wrdeskOptimizerHttp`** |
| `.../lib/projectAssistantAiFieldContracts.ts` | **`data-field`** / **`data-milestone-id`** |
| `.../stores/useProjectStore.ts` | **`wr-desk-projects`** |
| `.../stores/useProjectSetupChatContextStore.ts` | Header chat context |
| `apps/extension-chromium/.../WrMultiTriggerBar.tsx` | Trigger bar + events |
| `apps/extension-chromium/.../AddModeWizardHost.tsx` | Wizard host |
| `apps/extension-chromium/src/types/triggerTypes.ts` | **`TriggerFunctionId`**, **`ChatFocusMode`** |

### B. Key stores / hooks / functions

- **`useProjectStore`**, **`useProjectSetupChatContextStore`**, **`useChatFocusStore`** (extension), **`useCustomModesStore`** (extension).
- **`buildProjectSetupChatPrefix`** (referenced in canvas comments), **`registerWrDeskOptimizerHttpBridge`**.

### C. Open questions / verify before build

- **`CustomModeWizard`** full step list (any **schedule** UI in other files).
- **Grid** multi-draft / tone — **requires** extension **`grid-*`** source review or manual QA.
- **Exact** product definition of **“Reputation Scanner”** vs **existing threat metrics** in **Security** card.

### D. Assumptions stated explicitly

- Analysis reflects **repository state at documentation time**; line numbers may drift.
- **“Project WIKI”** is **not** implemented as separate data model — **naming** only unless product adds schema later.
