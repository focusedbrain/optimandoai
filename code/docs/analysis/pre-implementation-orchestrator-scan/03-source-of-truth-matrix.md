# 03 — Source-of-Truth Matrix

**Purpose:** For each important concept, document where it is stored, who writes it, who reads it, whether there are competing stores, and whether runtime can drift.  
**Status:** Analysis-only.  
**Date:** 2026-04-01

---

## Concept Table

### Sessions

| Attribute | Detail |
|---|---|
| **Primary store** | SQLite via `orchestrator-db/service` (Electron local) |
| **Key format** | `session_<timestamp>_<id>` |
| **Who writes** | `background.ts` `SAVE_SESSION_TO_SQLITE` handler → `POST /api/orchestrator/set`; `content-script.tsx` `ensureActiveSession` → `storageSet` (chrome.storage) |
| **Who reads** | `background.ts` `GET_SESSION_FROM_SQLITE` → `GET /api/orchestrator/get`; `content-script.tsx` `ensureActiveSession` → `storageGet`; `grid-script-v2.js` direct HTTP GET; `popup-chat.tsx` reads `session_*` keys from `chrome.storage.local` |
| **Competing stores** | `chrome.storage.local` (extension) AND SQLite (Electron). `storageWrapper.ts` routes `session_*` keys through an "active adapter" that may be SQLite — but fallback path in `background.ts` `GET_SESSION_FROM_SQLITE` falls back to `chrome.storage.local` if HTTP fails |
| **Runtime drift risk** | **High.** Sessions can be written to SQLite but read from chrome.storage (or vice versa) if adapters are not in sync. Grid-script-v2 reads directly from HTTP endpoint, bypassing background proxy and storage adapter |

---

### Agents

| Attribute | Detail |
|---|---|
| **Primary store** | Session blob field `session.agents[]` — stored wherever the session is stored |
| **Canonical schema** | `CanonicalAgentConfig` (v2.1.0) in `types/CanonicalAgentConfig.ts` |
| **Who writes** | `content-script.tsx` agent form dialogs → `storageSet` → session blob |
| **Who reads** | `processFlow.ts` `loadAgentsFromSession` → `GET_SESSION_FROM_SQLITE` (via background) → SQLite; `content-script.tsx` `getAllAgentsFromSession` → session blob from `storageGet` |
| **Competing stores** | None beyond the session blob itself; same session-storage duality applies |
| **Runtime drift risk** | **Medium.** If agent forms save to chrome.storage but `loadAgentsFromSession` reads from SQLite, newly saved agents may not be visible to the routing engine until SQLite sync occurs |

---

### Agent Config

| Attribute | Detail |
|---|---|
| **Primary store** | Embedded in `session.agents[]` as serialized `CanonicalAgentConfig` |
| **Canonical schema** | `CanonicalAgentConfig.ts`; fields: `listening`, `reasoningSections[]`, `executionSections[]`, `capabilities[]`, `contextSettings`, `memorySettings` |
| **Who writes** | Agent form dialogs in `content-script.tsx` |
| **Who reads** | `InputCoordinator` (via `evaluateAgentListener`), `processFlow.ts` (via loaded `AgentConfig` type — note: `AgentConfig` in processFlow.ts is a local mapping, not identical to `CanonicalAgentConfig`) |
| **Known gap** | `processFlow.ts` defines its own `AgentConfig` type (lines 170–222) that maps from the canonical schema. If this mapping is incomplete, fields like `acceptFrom` may be silently dropped at runtime |
| **Runtime drift risk** | **Medium.** Schema/UI is ahead of runtime in some places (`acceptFrom` not enforced in routing) |

---

### Agent Boxes

| Attribute | Detail |
|---|---|
| **Primary store** | Session blob field `session.agentBoxes[]` |
| **Canonical schema** | `CanonicalAgentBoxConfig` (v1.0.0) in `types/CanonicalAgentBoxConfig.ts` |
| **Who writes** | `content-script.tsx` add/edit dialogs → `storageSet`; grid-script.js and grid-script-v2.js → `SAVE_AGENT_BOX_TO_SQLITE` (background message); `background.ts` `GRID_SAVE` merges boxes by `identifier` |
| **Who reads** | `processFlow.ts` `loadAgentBoxesFromSession` → **`chrome.storage.local` only** (line 566–574); sidepanel `loadAgentBoxesFromSession`; content-script `ensureActiveSession` session load |
| **Competing stores** | **Critical conflict:** grid scripts write boxes via `SAVE_AGENT_BOX_TO_SQLITE` (SQLite path); `loadAgentBoxesFromSession` reads only from `chrome.storage.local`. Boxes saved from grid editors may never be visible to the routing engine |
| **Runtime drift risk** | **High.** This is the most clearly evidenced split-brain risk in the codebase |

---

### Display Grids

| Attribute | Detail |
|---|---|
| **Primary store** | Session blob field `session.displayGrids[]` |
| **Who writes** | `background.ts` `GRID_SAVE` handler (merges by `sessionId`); grid-script.js `SAVE_AGENT_BOX_TO_SQLITE` (writes individual box, not full grid config) |
| **Who reads** | Grid-script pages on load (`GET_SESSION_FROM_SQLITE` or direct HTTP); sidepanel for grid rendering (inferred) |
| **Competing stores** | Same session duality; `GRID_SAVE` goes through `storageWrapper` merge logic |
| **Runtime drift risk** | **Medium.** Merge logic in `GRID_SAVE` is background.ts-local and may not be consistent with SQLite writes from `SAVE_AGENT_BOX_TO_SQLITE` |

---

### API Keys

| Attribute | Detail |
|---|---|
| **Primary store (extension)** | `localStorage['optimando-api-keys']` — plain JSON, written by `content-script.tsx` `saveApiKeys` |
| **Primary store (Electron)** | Orchestrator SQLite store under key `optimando-api-keys` — read by `handshake:getAvailableModels` IPC handler as fallback |
| **Who writes** | Extension: `content-script.tsx` `saveApiKeys` → `localStorage.setItem`. Electron: unclear — the IPC fallback reads from orchestrator store but no confirmed write path from extension to Electron store |
| **Who reads** | Extension: `loadApiKeys` (content-script); Electron IPC: `handshake:getAvailableModels` reads orchestrator store as fallback for cloud model availability |
| **Competing stores** | **Two separate stores with no confirmed sync.** Extension `localStorage` and Electron SQLite orchestrator store can diverge |
| **Runtime drift risk** | **High.** A user who sets API keys in the extension settings UI (content-script) will have them in `localStorage`. Electron model discovery uses the orchestrator store as fallback. If these are different values, cloud provider availability determination can disagree between extension and Electron |

---

### Local LLM Models

| Attribute | Detail |
|---|---|
| **Primary store** | Ollama process (live state); `ollama-manager.ts` maintains a cache via `listModels()` |
| **Who writes** | Ollama itself (model install/remove); `ollamaManager.setActiveModelPreference` for active model |
| **Who reads** | `main.ts` `/api/llm/status` and `/api/llm/models`; extension via `electronRpc('llm.status')` (sidepanel, LlmSettings, localOllamaModels.ts); grid scripts via `ELECTRON_RPC` + `llm.status` |
| **Competing stores** | None — Ollama is the single ground truth. Cache in `ollama-manager.ts` is short-lived |
| **Runtime drift risk** | **Low** (post-stabilization pass). Model selectors now fetch dynamically. Only risk: Ollama process not running returns empty list with no error surfaced to user |

---

### Active Model

| Attribute | Detail |
|---|---|
| **Primary store** | `ollama-manager.ts` `getStoredActiveOllamaModelId` — persisted preference (location of persistence file TBD in Prompt 2) |
| **Who writes** | `llm:setActiveModel` IPC / `llm.activateModel` HTTP → `ollama-manager.setActiveModelPreference`; `LlmSettings.tsx` `handleActivateModel` |
| **Who reads** | `ollama-manager.getStatus()` → `activeModel` field; extension via `electronRpc('llm.status')` → `status.activeModel` |
| **Competing stores** | None confirmed. Single preference store in Electron |
| **Runtime drift risk** | **Low.** Single write path, single read path via `getStatus()` |

---

### Global Context

| Attribute | Detail |
|---|---|
| **Primary store** | Unknown / not clearly located in this analysis round |
| **Who writes** | (Inferred) agent form `contextSettings` fields in `CanonicalAgentConfig` |
| **Who reads** | (Inferred) reasoning harness during LLM call assembly |
| **Competing stores** | Unclear |
| **Runtime drift risk** | **Unknown.** Needs investigation in Prompt 2 |

---

### Global Memory

| Attribute | Detail |
|---|---|
| **Primary store** | `CanonicalAgentConfig.memorySettings` (per-agent); global memory not clearly separated from per-agent memory in schema |
| **Who writes** | Agent form dialogs |
| **Who reads** | (Inferred) reasoning harness |
| **Competing stores** | Unclear |
| **Runtime drift risk** | **Unknown.** Memory concept exists in schema but operational wiring not confirmed |

---

### Agent Memory / Context

| Attribute | Detail |
|---|---|
| **Primary store** | `CanonicalAgentConfig.memorySettings` + `reasoningSections[].memoryContext` |
| **Who writes** | Agent form (reasoning section editor) |
| **Who reads** | `resolveReasoningConfig` in `InputCoordinator` (inferred — not verified in detail) |
| **Competing stores** | Unclear |
| **Runtime drift risk** | **Medium (inferred).** If memory context is assembled inline during LLM call in sidepanel, there is no guarantee it uses the same schema-normalized form |

---

### Box Output

| Attribute | Detail |
|---|---|
| **Primary store** | DOM element with `id` derived from `agentBox.identifier` or `agentBox.boxNumber`; not persisted to session (in-memory/DOM only) |
| **Who writes** | `processFlow.ts` `updateAgentBoxOutput` — finds DOM element, writes LLM output text |
| **Who reads** | User (directly via DOM); no confirmed read-back into session |
| **Competing stores** | DOM only — no persistence. Each page reload clears box output |
| **Runtime drift risk** | **N/A for persistence.** Risk is that `updateAgentBoxOutput` cannot find the DOM element if the Agent Box UI is not present on the active page |

---

### Provider Availability

| Attribute | Detail |
|---|---|
| **Primary store** | Determined at runtime: API key presence in `localStorage['optimando-api-keys']` (extension) or orchestrator SQLite key (Electron) |
| **Who writes** | `saveApiKeys` (extension content-script); Electron orchestrator store (unclear write path) |
| **Who reads** | `handshake:getAvailableModels` IPC in Electron (checks orchestrator store for key presence); agent box UI provider dropdown (static list, not gated by key presence); OCR router `shouldUseCloud` (checks `CloudAIConfig.apiKeys`) |
| **Competing stores** | **Three separate reads:** extension `localStorage`, Electron orchestrator store, `CloudAIConfig.apiKeys` (unclear origin). No confirmed shared registry |
| **Runtime drift risk** | **High.** Provider dropdown in agent boxes shows all cloud providers regardless of whether a key exists. `shouldUseCloud` may allow cloud OCR even when no valid key is stored in the right place |

---

## Current Split-Brain Risks

The following are the highest-confidence confirmed or strongly-inferred split-brain risks in the system.

---

### SB-1: Agent Boxes — Grid Write vs Routing Read

**Severity: Critical**

Grid scripts (`grid-script.js`, `grid-script-v2.js`) save Agent Box configurations via `SAVE_AGENT_BOX_TO_SQLITE` → background → SQLite.

`processFlow.ts` `loadAgentBoxesFromSession` reads Agent Boxes from **`chrome.storage.local` only** (line 566–574 in processFlow.ts).

**Effect:** Agent Boxes configured or updated in display grid editors will never be seen by the routing engine in sidepanel until either:
- `loadAgentBoxesFromSession` is updated to use the SQLite path, or
- Grid scripts are updated to also write to `chrome.storage.local`

This means that in practice, if a user configures a box from a grid page, the agent routing engine will use stale/missing box data.

---

### SB-2: API Keys — Extension localStorage vs Electron SQLite

**Severity: High**

The extension saves API keys to `localStorage['optimando-api-keys']` (content-script `saveApiKeys`).

Electron's `handshake:getAvailableModels` IPC reads API key availability from the **orchestrator SQLite store** (same key name `optimando-api-keys`, but different storage location).

**Effect:** Cloud provider availability seen by the extension (which reads from `localStorage`) may differ from what Electron believes is available (which reads from SQLite). OCR routing (`shouldUseCloud`) uses `CloudAIConfig.apiKeys`, whose origin is not confirmed as either store — a third potential divergence point.

---

### SB-3: Session Persistence — chrome.storage vs SQLite

**Severity: High**

Session data has two stores. `storageWrapper.ts` routes `session_*` keys through an "active adapter," which may use SQLite. But the fallback in `background.ts` `GET_SESSION_FROM_SQLITE` returns `chrome.storage.local` data on HTTP failure.

Grid-script-v2 reads sessions directly from HTTP (`GET /api/orchestrator/get`) without going through the background proxy.

**Effect:** Under network/Electron failures, extension surfaces read from `chrome.storage.local` while grid pages see SQLite data (or fail silently). A session created offline in `chrome.storage.local` may not appear in SQLite when Electron is available.

---

### SB-4: Agent Config Schema vs Runtime Mapping

**Severity: Medium**

`CanonicalAgentConfig` (schema/UI) defines `reasoningSections[].acceptFrom` and `executionSections[].destinations` with full type safety.

`processFlow.ts` defines its own `AgentConfig` type (lines 170–222) that is a local mapping from the canonical schema. `InputCoordinator` operates on `AgentConfig`, not `CanonicalAgentConfig`.

**Effect:** If the `AgentConfig` mapping in `processFlow.ts` does not copy all fields from `CanonicalAgentConfig`, fields like `acceptFrom` will be silently dropped at runtime. The agent form UI will show them as configured but routing will not enforce them. This is confirmed for `acceptFrom` (not used in `InputCoordinator` routing).

---

### SB-5: Cloud Model List — Hardcoded vs Key-Gated

**Severity: Medium**

Cloud model selectors in Agent Box dialogs show all four providers (OpenAI, Claude, Gemini, Grok) as static lists regardless of API key state.

`handshake:getAvailableModels` in Electron filters cloud models by key presence — but this IPC call path is used only by certain surfaces (LlmSettings, possibly sidepanel model picker), not by the Agent Box provider/model dropdowns in content-script or grid-scripts.

**Effect:** A user with no OpenAI key will be able to select OpenAI models in an Agent Box. At runtime, `resolveModelForAgent` will return a provider/model pair that cannot execute successfully.

---

## Summary Risk Table

| Concept | Store Count | Drift Risk | Confirmed |
|---|---|---|---|
| Sessions | 2 (chrome.storage + SQLite) | High | Yes |
| Agents | 1 (session blob) | Medium | Yes |
| Agent Config | 1 (session blob, two type mappings) | Medium | Yes |
| Agent Boxes | 2 (chrome.storage read, SQLite write) | **Critical** | Yes |
| Display Grids | 2 (GRID_SAVE + SAVE_AGENT_BOX) | Medium | Yes |
| API Keys | 2 (localStorage + SQLite) | High | Yes |
| Local LLM Models | 1 (Ollama process) | Low | Yes |
| Active Model | 1 (Electron preference store) | Low | Yes |
| Global Context | Unknown | Unknown | No |
| Global Memory | Unclear | Unknown | No |
| Agent Memory/Context | 1 (session blob, partial) | Medium | Inferred |
| Box Output | DOM only | N/A | Yes |
| Provider Availability | 3+ (localStorage, SQLite, CloudAIConfig) | High | Yes |
