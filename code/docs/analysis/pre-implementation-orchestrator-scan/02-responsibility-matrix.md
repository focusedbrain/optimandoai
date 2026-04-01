# 02 — Responsibility Matrix

**Purpose:** For each major module or file cluster, document what it owns, what it should own, what it leaks into, and whether it is a stable extension point or a fragile hotspot.  
**Status:** Analysis-only.  
**Date:** 2026-04-01

---

## Summary Table

| Module / Cluster | Owns (Current) | Should Own | Leaks Into | Stability |
|---|---|---|---|---|
| `sidepanel.tsx` | LLM orchestration loop, NLP call, route dispatch, processWithAgent, OCR enrichment, session load, agent box rendering | WR Chat runtime only; routing should delegate to service layer | Everything — session, UI, LLM, routing, OCR | Fragile hotspot |
| `popup-chat.tsx` | Auth-gated UI shell, session picker display, model fetch | UI shell only (correct) | Nothing critical | Stable extension point (UI layer) |
| `content-script.tsx` | Injected page UI, agent form dialogs, session create/load, API key store, box add/edit | Injected page UI + form rendering only | Session persistence, API key management | Fragile hotspot |
| `background.ts` | Service worker, RPC proxy, session SQLite proxy, GRID_SAVE merge | RPC proxy + message routing | Merge logic (GRID_SAVE) duplicates storageWrapper concern | Medium risk |
| `processFlow.ts` | Agent/box loaders, routing decision types, resolveModelForAgent, wrapInputForAgent, updateAgentBoxOutput | Agent resolution + routing coordination | Nothing beyond own scope | Stable extension point |
| `InputCoordinator.ts` | Agent matching (trigger/NLP/context/website), box resolution, execution config resolution | Agent matching + allocation | Partial execution config building (overlaps processFlow) | Medium risk |
| `NlpClassifier.ts` | Text classification (triggers, entities, intents) | Text classification only | Nothing | Stable extension point |
| `electronRpc.ts` | RPC registry, HTTP client, method routing to Electron API | RPC transport only | Nothing | Stable extension point |
| Electron `main.ts` (HTTP routes) | HTTP API surface: OCR, LLM, sessions, handshake | HTTP API surface only | IPC handlers and HTTP mixed in one file (scale risk) | Medium risk (file size) |
| OCR router (`ocr/router.ts`) | Cloud vs local OCR routing, provider selection, fallback | OCR routing + cloud fallback | Nothing | Stable extension point |
| Model/provider discovery (`ollama-manager.ts` + `main.ts` IPC) | Ollama model listing, status, active model; cloud model list via hardcoded map | Local model management | Cloud model list leaked into `handshake:getAvailableModels` as hardcoded CLOUD_MODEL_MAP | Medium risk |
| Session import/export | Partial: `CanonicalAgentConfig.ts`, `CanonicalAgentBoxConfig.ts`, `AgentWithBoxesExport` type | Canonical schema + import/export serialization | Not clearly owned by any file; schema types exist but no dedicated import/export service found | Fragile (no single owner) |
| Agent Box rendering surfaces | `content-script.tsx` (add/edit dialogs), `grid-script.js`, `grid-script-v2.js` (slot editors) | Box config UI rendering | Persistence calls inline in UI code; model loading inline in event handlers | Fragile hotspot |

---

## Detailed Module Profiles

---

### `sidepanel.tsx`

**File:** `apps/extension-chromium/src/sidepanel.tsx`

**What it owns:**
- The primary WR Chat UI and input handling loop
- Calls `nlpClassifier.classify` → `inputCoordinator.routeClassifiedInput` → `processWithAgent`
- `processMessagesWithOCR` (OCR pre-enrichment of messages before LLM call)
- `loadAgentsFromSession` and `loadAgentBoxesFromSession` to refresh agent data
- `resolveModelForAgent` → LLM API calls
- `updateAgentBoxOutput` to push results to Agent Box display
- Session load on startup (`GET_SESSION_FROM_SQLITE`)
- Provider/model UI (calls `electronRpc('llm.status')` at ~1003 and ~1036)

**What it should own:**
- WR Chat input handling
- UI state (tabs, panels, mode toggles)
- Delegating orchestration to processFlow/InputCoordinator service layer

**What it leaks into:**
- Business logic that belongs in service layer (`processWithAgent` is inline, not in processFlow)
- Session persistence decisions mixed with UI rendering
- OCR enrichment logic inline (should be a service call)
- Provider/model refresh logic (should be centralized)

**Stability:** **Fragile hotspot.** This file is the main orchestration engine AND the main UI component. Changes to routing, model selection, session, or OCR all require edits here. Very high coupling.

---

### `popup-chat.tsx`

**File:** `apps/extension-chromium/src/popup-chat.tsx`

**What it owns:**
- Auth-gated UI shell for the popup window
- Workspace switcher (WR Chat / BEAP / WRGuard / etc.)
- Session picker (reads `chrome.storage.local` for `session_*` keys)
- Local model refresh via `electronRpc('llm.status')` (for model display only)
- `CommandChatView` rendering — but **without an `onSend` handler**

**What it should own:**
- Exactly what it owns (UI shell) — this is appropriate scope

**What it leaks into:**
- Nothing critical. It does not perform orchestration.

**Critical gap (inferred):** `CommandChatView` receives no `onSend`; the fallback mock reply in `CommandChatView.tsx` lines 106–116 means **all user chat input in the popup produces mock assistant responses**. This is not a leak, it is an unimplemented feature.

**Stability:** **Stable as a UI shell.** Safe to modify in isolation. Becomes fragile only when real orchestration wiring is added.

---

### `content-script.tsx`

**File:** `apps/extension-chromium/src/content-script.tsx`

**What it owns:**
- Injected orchestrator page UI (agents list, agent form dialogs, Agent Box add/edit dialogs)
- `ensureActiveSession`: session create/load on injected page load
- Agent form rendering and save (Listener / Reasoning / Execution sections)
- API key management UI (`loadApiKeys`, `saveApiKeys` → `localStorage['optimando-api-keys']`)
- Agent Box model selector UI (calls `electronRpc` / background for local model list)
- `storageGet` / `storageSet` wrappers for session blob access

**What it should own:**
- Injected page UI and form rendering
- Delegating persistence to a dedicated storage service

**What it leaks into:**
- Session persistence: directly reads/writes session blob and `chrome.storage.local`
- API key storage: writes directly to `localStorage` without sync to Electron store
- Inline provider/model loading logic (now partially fixed by `localOllamaModels.ts`)

**Stability:** **Fragile hotspot.** Extremely large file (~32,000+ lines). Mixes UI, persistence, and business logic. High risk of regression on any edit.

---

### `background.ts`

**File:** `apps/extension-chromium/src/background.ts`

**What it owns:**
- Service worker lifecycle
- All `chrome.runtime.onMessage` dispatching
- `ELECTRON_RPC` proxy: validates launch secret, delegates to `handleElectronRpc`
- `GET_SESSION_FROM_SQLITE` / `SAVE_SESSION_TO_SQLITE` proxy handlers
- `GRID_SAVE` handler: reads session from `storageWrapper`, merges `displayGrids` + `agentBoxes`, writes back
- `_electronHeaders()` builder (Content-Type + X-Launch-Secret)

**What it should own:**
- Message routing and RPC proxy (correct)
- Session proxy (appropriate)

**What it leaks into:**
- `GRID_SAVE` merge logic: implements session merge rules (merge by `sessionId`, dedup by `identifier`) that arguably belong in a session-management service

**Unresolved:** `SAVE_AGENT_BOX_TO_SQLITE` message — sent by grid scripts, but handler location in `background.ts` not confirmed in this analysis round. Needs verification in Prompt 2.

**Stability:** **Medium risk.** Core proxy function is stable. `GRID_SAVE` merge logic is a hotspot. Large file with accumulated handlers.

---

### `processFlow.ts`

**File:** `apps/extension-chromium/src/services/processFlow.ts`

**What it owns:**
- Type definitions: `AgentMatch`, `AgentConfig`, `AgentBox`, `RoutingDecision`
- `loadAgentsFromSession`: reads agents from SQLite via background message
- `loadAgentBoxesFromSession`: reads agent boxes from `chrome.storage.local` **only** (inconsistency with SQLite path)
- `matchInputToAgents`: delegates to `inputCoordinator.routeToAgents`
- `routeInput`, `routeEventTagInput`, `processEventTagMatch`: event-tag and raw-input routing
- `wrapInputForAgent`: builds structured input for agent LLM call
- `updateAgentBoxOutput`: writes LLM output to Agent Box display element
- `resolveModelForAgent`: resolves provider + model from AgentBox config

**What it should own:**
- Everything it currently owns, plus `processWithAgent` (which currently lives inline in sidepanel)
- `loadAgentBoxesFromSession` should use the same path as `loadAgentsFromSession` (SQLite)

**What it leaks into:**
- Nothing beyond own scope. Well-bounded.

**Stability:** **Stable extension point.** Clean types, well-scoped functions. Primary risk: `loadAgentBoxesFromSession` reads wrong persistence layer (see source-of-truth doc).

---

### `InputCoordinator.ts`

**File:** `apps/extension-chromium/src/services/InputCoordinator.ts`

**What it owns:**
- `routeToAgents`: full agent iteration + `evaluateAgentListener` per agent
- `evaluateAgentListener`: website filter → trigger match → keyword → context → `applyFor`
- `findAgentBoxesForAgent`: resolves which Agent Boxes an agent routes to
- `routeClassifiedInput`: NLP-output routing path
- `routeEventTagTrigger`: event-tag-driven routing with condition evaluation
- `resolveExecutionConfig` / `resolveReasoningConfig`: builds execution + reporting destinations per agent

**What it should own:**
- Agent matching logic (correct)
- Execution config resolution (appropriate)

**What it leaks into:**
- Partial overlap with `processFlow.ts` in execution config building; `processEventTagMatch` in processFlow also assembles execution data

**Known gap:** `acceptFrom` in `CanonicalAgentConfig.reasoningSections[].acceptFrom` is not evaluated in `evaluateAgentListener` or `routeClassifiedInput`. Schema/UI declares it; runtime ignores it.

**Stability:** **Medium risk.** Core matching logic is well-structured but the file is large (1400+ lines). Event-tag vs classified-input paths are separate code branches with partial overlap. `resolveExecutionConfig` is complex.

---

### `NlpClassifier.ts`

**File:** `apps/extension-chromium/src/nlp/NlpClassifier.ts`

**What it owns:**
- `classify(rawText)`: full pipeline from text to `ClassifiedInput`
- wink-nlp initialization + dynamic import
- Regex fallback when wink fails
- Trigger extraction (`#word`), entity extraction, optional intent detection
- `ClassificationResult` / `ClassifiedInput` types

**What it should own:**
- Exactly what it owns. Well-scoped.

**What it leaks into:**
- Nothing.

**Stability:** **Stable extension point.** Self-contained. Only risk: wink-nlp dynamic import failure silently downgrades to regex; intents are optional and may not be populated consistently.

---

### Electron `main.ts` HTTP Routes

**File:** `apps/electron-vite-project/electron/main.ts`

**What it owns:**
- `GET /api/llm/status` → `ollamaManager.getStatus()`
- `GET /api/llm/models` → `ollamaManager.listModels()`
- `GET /api/orchestrator/get` / `POST /api/orchestrator/set` → SQLite via orchestrator-db service
- `POST /api/ocr/process` → `OCRRouter.processImage`
- `handshake:getAvailableModels` IPC handler → unified local + cloud model list

**What it should own:**
- HTTP API surface only (correct in principle)

**What it leaks into:**
- `handshake:getAvailableModels` implements cloud model list building inline (hardcoded `CLOUD_MODEL_MAP`); this logic should live in a provider registry service
- API key reading from orchestrator store inside IPC handler mixes session persistence with model discovery

**Stability:** **Medium risk.** The file is very large. HTTP and IPC handlers are interleaved. Each individual route handler is relatively self-contained, but the file is a scaling risk.

---

### OCR Router (`ocr/router.ts`)

**File:** `apps/electron-vite-project/electron/main/ocr/router.ts`

**What it owns:**
- `shouldUseCloud(options, cloudConfig)`: routing decision (local vs cloud)
- `processImage(input, options)`: dispatches to cloud (`processWithCloud`) or local Tesseract
- Cloud error → local fallback
- `CloudAIConfig` type: `apiKeys`, `preference`, `useCloudForImages`

**What it should own:**
- Exactly what it owns. Well-scoped.

**What it leaks into:**
- Nothing.

**Stability:** **Stable extension point.** OCR routing is a clean strategy pattern. The main risk is external: OCR runs after routing in the extension pipeline (architectural gap, not a code quality issue).

---

### Model / Provider Discovery

**Files:** `ollama-manager.ts`, `main.ts` (IPC), `electronRpc.ts`, `localOllamaModels.ts`, `LlmSettings.tsx`

**What it owns (collectively):**
- Ollama model listing and status (`ollama-manager.ts`)
- HTTP endpoints for status/models (`main.ts`)
- Extension-side RPC call to `llm.status` (`electronRpc.ts` + `localOllamaModels.ts`)
- Cloud model list (`main.ts` IPC — hardcoded `CLOUD_MODEL_MAP`)
- Active model management (`ollama-manager.ts` `setActiveModelPreference`)

**What it leaks into:**
- Cloud model list building is inline in `handshake:getAvailableModels`; not a reusable service
- API key availability check mixed into model discovery in IPC handler
- `LlmSettings.tsx` re-implements installed model display logic that `localOllamaModels.ts` now partially abstracts

**Stability:** **Medium risk.** Local model path is now cleaner (post-stabilization pass). Cloud model path is fragile (hardcoded list, no single registry).

---

### Session Import / Export

**Files:** `CanonicalAgentConfig.ts`, `CanonicalAgentBoxConfig.ts` (types only), background.ts session proxy

**What it owns:**
- Canonical schema types for agents and boxes (v2.1.0 / v1.0.0)
- HTTP proxy for session read/write (`background.ts`)

**What it should own:**
- A dedicated session service that handles create, load, save, merge, import, export for all session data

**What it leaks into:**
- Session blob assembly is scattered: content-script creates sessions, sidepanel loads them, grid-scripts update box entries, background merges grid data
- No single module coordinates the full session lifecycle

**Stability:** **Fragile (no single owner).** This is the most structurally diffuse area. The schema types are solid but there is no dedicated session service.

---

### Agent Box Rendering Surfaces

**Files:** `content-script.tsx` (add/edit dialogs), `grid-script.js`, `grid-script-v2.js`

**What they own:**
- UI for creating and editing Agent Box configurations (provider, model, color, title, placement)
- Reading session for existing box data
- Writing box to session (via `SAVE_AGENT_BOX_TO_SQLITE`)
- Provider/model dropdown population (local models from `llm.status`, cloud from static lists)

**What they leak into:**
- Model loading logic duplicated across three files (now partially unified by `localOllamaModels.ts` / `fetchLocalModelNamesV2`)
- Persistence calls (`SAVE_AGENT_BOX_TO_SQLITE`, `SAVE_SESSION_TO_SQLITE`) embedded in UI event handlers
- No shared "AgentBoxEditor" component or utility — each surface re-implements the same form

**Stability:** **Fragile hotspot.** Three separate implementations of the same conceptual editor. Any schema change to `CanonicalAgentBoxConfig` requires three simultaneous updates.
