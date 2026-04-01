# 04 — Canonical vs Duplicate Surfaces

**Purpose:** Identify which surfaces are canonical (production-critical, reference behavior) and which are secondary, duplicate, mocked, or legacy.  
**Status:** Analysis-only.  
**Date:** 2026-04-01

---

## Surface Inventory

### 1. Sidepanel — WR Chat

**Files:** `apps/extension-chromium/src/sidepanel.tsx`

**Classification: CANONICAL — Production-Critical Runtime**

| Attribute | Finding |
|---|---|
| **Is it production-critical?** | Yes. This is the only surface where real orchestration occurs. |
| **NLP classification?** | Yes — `nlpClassifier.classify` at ~2661, ~2967 |
| **Agent routing?** | Yes — `inputCoordinator.routeClassifiedInput` at ~2675, ~2983 |
| **LLM calls?** | Yes — `processWithAgent` inline in this file |
| **OCR enrichment?** | Yes — `processMessagesWithOCR` pre-LLM |
| **Session management?** | Yes — `GET_SESSION_FROM_SQLITE`, `loadAgentsFromSession`, `loadAgentBoxesFromSession` |
| **Agent Box output?** | Yes — `updateAgentBoxOutput` called from here |
| **Model/provider fetch?** | Yes — `electronRpc('llm.status')` at ~1003, ~1036 |
| **Evidence of mock/stub?** | None |
| **Notes** | Everything real happens here. It is also the most overloaded file. |

**Reference behavior for future implementation:** All orchestration logic changes must treat sidepanel as the canonical runtime. Any new routing, session, or LLM call behavior should first be verified here.

---

### 2. Popup Chat

**Files:** `apps/extension-chromium/src/popup-chat.tsx`, `apps/extension-chromium/src/ui/components/CommandChatView.tsx`

**Classification: UI SHELL — Non-Canonical (Mocked)**

| Attribute | Finding |
|---|---|
| **Is it production-critical?** | For UI display and auth-gating: yes. For orchestration: no. |
| **NLP classification?** | No |
| **Agent routing?** | No |
| **LLM calls?** | No — `CommandChatView` has no `onSend` handler; falls through to mock reply |
| **OCR enrichment?** | No |
| **Session management?** | Partial — reads `session_*` keys from `chrome.storage.local` for session picker display only |
| **Model/provider fetch?** | Yes — `refreshPopupModels` at ~431–451, but for display only |
| **Evidence of mock/stub?** | **Confirmed.** `CommandChatView.tsx` lines 106–116: missing `onSend` → mock assistant reply |
| **Notes** | Popup is intentionally a limited preview/command shell. WR Chat in popup is not wired to the orchestration engine. |

**Reference behavior:** Do not use popup as a reference for orchestration behavior. Popup `CommandChatView` is a UI prototype, not a runtime surface.

---

### 3. Content-Script Orchestrator Page

**Files:** `apps/extension-chromium/src/content-script.tsx`

**Classification: CANONICAL — For Agent/Box Management UI; Secondary for Runtime Orchestration**

| Attribute | Finding |
|---|---|
| **Is it production-critical?** | Yes — agent form dialogs, Agent Box add/edit dialogs, session create/load are all here |
| **NLP classification?** | No |
| **Agent routing?** | No — `routeInput` not called from this file |
| **LLM calls?** | No — `processWithAgent` not in this file |
| **OCR enrichment?** | No |
| **Session management?** | Yes — `ensureActiveSession`, `storageGet/Set`, `CREATE_NEW_SESSION` handler |
| **Agent Box output?** | Partial — `updateAgentBox` (DOM update, not the processFlow function) |
| **Evidence of mock/stub?** | None for the management surfaces |
| **Notes** | This file is canonical for agent configuration and Agent Box configuration UI. It is NOT part of the live orchestration loop. |

**Reference behavior:** Agent form and Agent Box editor dialogs in content-script are the canonical UI for agent/box management. Any schema changes to `CanonicalAgentConfig` or `CanonicalAgentBoxConfig` must be reflected here.

---

### 4. Display Grid Pages (v1 and v2)

**Files:** `apps/extension-chromium/public/grid-script.js`, `apps/extension-chromium/public/grid-script-v2.js`

**Classification: CANONICAL for Agent Box Management in Grid Context; FRAGILE DUAL IMPLEMENTATION**

| Attribute | Finding |
|---|---|
| **Is it production-critical?** | Yes — grid pages are how display-grid boxes are configured |
| **NLP classification?** | No |
| **Agent routing?** | No |
| **LLM calls?** | No |
| **OCR enrichment?** | No |
| **Session management?** | Yes — read via `GET_SESSION_FROM_SQLITE` (v1) or direct HTTP (v2); write via `SAVE_AGENT_BOX_TO_SQLITE` |
| **Local model fetch?** | Yes — `ELECTRON_RPC` + `llm.status` (both versions, post-stabilization pass) |
| **Evidence of mock/stub?** | Partial — dead/unreachable `GRID_SAVE` + `window.opener.postMessage` block in v1 (~815+) |
| **v1 vs v2 relationship** | Same conceptual editor, two separate implementations. v2 adds explicit var declarations and direct HTTP fallback. Neither clearly deprecated. |
| **Notes** | Both versions must be kept consistent. Conceptually one editor; practically two code paths. |

**Reference behavior:** v2 (`grid-script-v2.js`) appears more robust (explicit var declarations, HTTP fallback). If one version is to become canonical, v2 is the better base. The dead code in v1 should be cleaned up but is not a blocker.

---

### 5. Settings Lightbox

**Files:** `apps/extension-chromium/src/components/LlmSettings.tsx` (LLM settings); API key UI in `content-script.tsx` (~32197)

**Classification: CANONICAL for Configuration; Isolated from Runtime**

| Attribute | Finding |
|---|---|
| **Is it production-critical?** | Yes for configuration (model activation, Ollama status) |
| **NLP / routing / LLM?** | No |
| **Session management?** | No |
| **Active model write?** | Yes — `handleActivateModel` → `llm:setActiveModel` IPC or `llm.activateModel` HTTP |
| **Installed model display?** | Yes — `status.modelsInstalled` from `electronRpc('llm.status')` |
| **API key management?** | `content-script.tsx` API key section: reads/writes `localStorage['optimando-api-keys']` |
| **Evidence of mock/stub?** | None |
| **Notes** | LlmSettings is a clean, well-scoped settings component. API key section in content-script is inline UI with no sync to Electron. |

**Reference behavior:** `LlmSettings.tsx` is the canonical UI for Ollama model management and active model selection. The API key section is functional but not synced to Electron (split-brain SB-2).

---

### 6. Electron Renderer Surfaces

**Files:** `apps/electron-vite-project/src/` (renderer React app)

**Classification: SECONDARY — Local Tool UI (Not Extension Runtime)**

| Attribute | Finding |
|---|---|
| **Is it production-critical?** | For Electron-native UI (if present): yes. For extension orchestration: no. |
| **Integration with extension?** | Via IPC and HTTP API only. Electron renderer does not participate in extension WR Chat pipeline. |
| **Notes** | Electron renderer (if it exists as a UI) is a separate product surface. Analysis of its internals is out of scope for this document — it provides backend services to the extension, not UI that competes with extension surfaces. |

---

## Classification Summary Table

| Surface | Classification | Production-Critical | Real Orchestration | Reference for |
|---|---|---|---|---|
| Sidepanel WR Chat | **Canonical** | Yes | Yes | All orchestration behavior |
| Popup chat | **UI Shell / Mocked** | Partial (auth/display) | No (mock replies) | Auth shell, session picker display only |
| Content-script page | **Canonical (Management)** | Yes | No | Agent + box configuration UI |
| Display grid v1 | **Canonical (Grid Boxes)** | Yes | No | Grid-slot box management |
| Display grid v2 | **Canonical (Grid Boxes)** | Yes | No | Grid-slot box management (preferred base) |
| Settings lightbox | **Canonical (Config)** | Yes | No | Model activation, Ollama status |
| API key section | **Functional / Unsynced** | Yes (user-facing) | No | Key storage (not synced to Electron) |
| Electron renderer | **Secondary** | Backend only | No | Backend service surfaces |

---

## What Appears Production-Critical

1. **Sidepanel** (`sidepanel.tsx`) — the entire live orchestration pipeline
2. **Content-script agent forms** (`content-script.tsx`) — agent and box configuration is here
3. **Display grid editors** (both v1 and v2) — grid box config write path
4. **Electron HTTP API** (`main.ts`) — session persistence, LLM, OCR
5. **`processFlow.ts` + `InputCoordinator.ts`** — routing and agent resolution logic
6. **`ollama-manager.ts`** — local LLM availability

---

## What Appears UI-Only

1. **Popup chat `CommandChatView`** — mock reply path; no real orchestration wiring
2. **Popup session picker** — display of session list only; no session management operations
3. **Model display in popup** (`refreshPopupModels`) — display only; not used for routing

---

## What Appears Legacy or Parallel

1. **`GRID_SAVE` + `window.opener.postMessage` block in `grid-script.js`** (~815+) — dead code after a `return` statement; unreachable in current execution flow; appears to be a replaced-but-not-removed save mechanism
2. **Passive/active trigger distinction** in `CanonicalAgentConfig` — the canonical schema v2.1.0 uses `unifiedTriggers` and removes legacy passive/active. Runtime `InputCoordinator` still has branches for unified/legacy/passive/active trigger modes — legacy branches may handle old config formats; new agents should use unified triggers only
3. **`processFlow.ts` local `AgentConfig` type** — parallel to `CanonicalAgentConfig`; a mapping layer that may not stay in sync with schema evolution

---

## What Must Be Treated as Reference Behavior for Future Implementation

### For routing logic:
Use **`sidepanel.tsx`** WR Chat path as ground truth. Any refactoring of the NLP → `routeClassifiedInput` → `processWithAgent` pipeline must preserve observable behavior from this file.

### For agent/box configuration:
Use **`content-script.tsx`** agent form dialogs + **`CanonicalAgentConfig.ts`** / **`CanonicalAgentBoxConfig.ts`** schema types as the canonical definition. All new agent/box fields must be added here first, then wired into the runtime.

### For session management:
The **SQLite path** (`GET_SESSION_FROM_SQLITE` / `SAVE_SESSION_TO_SQLITE` via `background.ts` → Electron HTTP) should be treated as the intended canonical store. `chrome.storage.local` is a fallback and cache layer. Future implementation should ensure all reads use the SQLite path when available.

### For Agent Box reads in routing:
**`processFlow.ts` `loadAgentBoxesFromSession`** must be updated to use the same SQLite path as `loadAgentsFromSession` before any Agent Box routing work begins. Until this is fixed, grid-configured boxes are invisible to the routing engine.

### For API keys:
The **extension `localStorage`** is the operative store for the current UI. A sync mechanism to the Electron orchestrator store (or a unified key registry) is required before cloud provider availability can be reliably determined at runtime.

---

## Most Important Questions That Prompt 2 Must Answer Next

1. **Is there any path where OCR output re-enters the routing pipeline as a routing signal?** Or is OCR permanently post-routing in the current architecture?

2. **Does `background.ts` have a `SAVE_AGENT_BOX_TO_SQLITE` message handler?** If not, where does that message terminate, and is it handled at all?

3. **What does `storageWrapper.ts` active adapter routing actually do?** Does it route `session_*` writes directly to SQLite, or only add SQLite as a read fallback?

4. **Are API keys ever synced from `localStorage` to the Electron orchestrator store?** Is there a settings save path that writes to both?

5. **Is there a `CLOUD_MODEL_MAP` or cloud model registry that could replace the hardcoded list in `handshake:getAvailableModels`?**

6. **What does `processWithAgent` in sidepanel actually do?** Is it a wrapper for `resolveModelForAgent` + LLM call + `updateAgentBoxOutput`, or does it have additional logic?

7. **Are passive/active trigger branches in `InputCoordinator` still active code paths for existing saved agents, or can they be removed?**

8. **What session key does the popup session picker use?** Is it the same `session_*` key structure as sidepanel, and if so, do they share a session at runtime?

9. **What is the full structure of the `displayGrids` field in the session blob?** How does a grid page know which session and which grid config to load?

10. **Is there a mechanism that prevents the `chrome.storage.local` and SQLite session stores from permanently diverging on a typical user's machine?**
