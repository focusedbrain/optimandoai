# 16 — Risk Map and Failure Modes

**Status:** Analysis-only. Final synthesis.  
**Date:** 2026-04-01  
**Basis:** All prior documents (00–15) in this analysis series.

---

## Severity Scale

| Level | Meaning |
|---|---|
| **Critical** | Will silently fail or produce wrong output. User has no visibility. |
| **High** | Feature broken under common conditions; visible failure or degraded result. |
| **Medium** | Feature degrades under edge conditions; intermittent or low-visibility. |
| **Low** | Cosmetic or fallback acceptable for current scope. |

---

## Architectural Risks

### AR-1: OCR Runs After Authoritative Routing
**Severity:** Critical  
**Location:** `sidepanel.tsx` lines 2925, 2943  
**Category:** Sequencing  

Any agent whose trigger would be found only in OCR-extracted text will silently fail to activate in the WR Chat path. The routing decision is complete before OCR executes. The user sees no error — agents simply don't respond to image-derived input.

---

### AR-2: Provider String Mismatch (`'Local AI'` vs `'local'`)
**Severity:** Critical  
**Location:** `processFlow.ts::resolveModelForAgent` lines 1210–1245; grid-script dialogs  
**Category:** Abstraction mismatch  

The UI stores provider as `'Local AI'`. The runtime recognizes `'ollama'`, `'local'`, `''`. After lowercasing, `'local ai'` matches none of these — every local model call silently falls back to a fallback model identifier. The user configured a local agent; it either never calls the model or calls the wrong one.

---

### AR-3: Cloud Provider Execution Is Entirely Absent
**Severity:** Critical  
**Location:** `processFlow.ts::resolveModelForAgent`; `sidepanel.tsx::processWithAgent`  
**Category:** Backend/frontend mismatch  

All cloud providers (`openai`, `anthropic`, `gemini`, `grok`) hit a comment "API not yet connected" in `resolveModelForAgent`. The LLM call path in `processWithAgent` always posts to `Electron /api/llm/chat` — the local Ollama endpoint. An agent configured with a cloud brain silently fails without user feedback.

---

### AR-4: Display-Grid Boxes Are Invisible to Routing Engine
**Severity:** Critical  
**Location:** `processFlow.ts::loadAgentBoxesFromSession`; `background.ts` (SAVE_AGENT_BOX_TO_SQLITE exists); grid save path  
**Category:** State drift  

`loadAgentBoxesFromSession` reads `chrome.storage.local` only. Grid boxes are saved directly to SQLite (`SAVE_AGENT_BOX_TO_SQLITE`), bypassing `chrome.storage`. Therefore the routing engine has a structural blind spot: grid boxes never appear in `findAgentBoxesForAgent`. Any output for those agents is silently discarded or falls back to inline chat.

---

### AR-5: `UPDATE_AGENT_BOX_OUTPUT` Not Handled by Grid Pages
**Severity:** Critical  
**Location:** `updateAgentBoxOutput` (processFlow.ts); grid-script.js / grid-script-v2.js  
**Category:** Backend/frontend mismatch  

The output pipeline sends `UPDATE_AGENT_BOX_OUTPUT` via `chrome.runtime.sendMessage`. Sidepanel listens and updates React state. Grid pages have no such handler. Even if grid boxes were visible to routing (AR-4 fixed), no live update would reach the grid display.

---

### AR-6: Two API Key Stores with No Sync
**Severity:** High  
**Location:** `content-script.tsx::saveApiKeys` → `localStorage`; `main.ts::handshake:getAvailableModels` → orchestrator SQLite  
**Category:** State drift  

Keys saved in the extension settings lightbox go to `localStorage['optimando-api-keys']`. Keys potentially read by the Electron LLM router come from SQLite. There is no confirmed synchronization. A user who sets their OpenAI key in the extension UI may have it unread when the backend needs it for a cloud call.

---

### AR-7: Session Schema Has No Version Field
**Severity:** High  
**Location:** `storageWrapper.ts`; `orchestrator-db/service.ts`  
**Category:** Schema drift  

Session blobs have no `_schemaVersion` field. There is no migration path. Any field rename, structural change, or schema evolution will silently break deserialization without errors — the old field simply goes undefined, the new field never gets populated.

---

### AR-8: `reasoningSections[]` Ignored in Main Execution Path
**Severity:** High  
**Location:** `processFlow.ts::wrapInputForAgent`; `InputCoordinator.ts::resolveReasoningConfig`  
**Category:** Abstraction mismatch  

`CanonicalAgentConfig` supports multi-section reasoning (`reasoningSections[]`) with per-trigger selection. `wrapInputForAgent` reads only flat `agent.reasoning`. The rich reasoning harness is only exercised on the event-tag path, which is not used by WR Chat sends. All users configuring multi-section reasoning via the form get flat-field behavior at runtime.

---

### AR-9: `agentContextFiles` and `memorySettings` Are Silent No-Ops
**Severity:** High  
**Location:** `content-script.tsx::openAgentConfigDialog`; `processFlow.ts::wrapInputForAgent`  
**Category:** UI drift  

Users can upload context files and toggle memory settings. These are persisted to the session. At runtime, `wrapInputForAgent` never reads them. The reasoning harness never contains context files or memory signals. The UI gives confidence that these are active; they are not.

---

### AR-10: No Authoritative Session Ownership Between Extension and Electron
**Severity:** High  
**Location:** `storageWrapper.ts`; `background.ts::GET_SESSION_FROM_SQLITE`; `main.ts` HTTP endpoint `/api/orchestrator/get`  
**Category:** State drift  

Three distinct readers for session state: `chrome.storage.local` (direct), SQLite via service worker proxy, SQLite via Electron HTTP. The active adapter is resolved at runtime from Electron availability. On startup or after navigation, a different adapter may be selected, producing a different session view. There is no confirmed conflict resolution strategy.

---

### AR-11: NLP/OCR-Enriched Routing Results Are Discarded
**Severity:** Medium  
**Location:** `sidepanel.tsx` lines 2967–3030  
**Category:** Sequencing  

`routeClassifiedInput` and `routeEventTagInput` run after OCR, receive enriched text, compute agent allocations — but their results are logged only. The agent execution loop uses `routingDecision.matchedAgents` from the earlier pre-OCR `routeInput` call. The enrichment work is done but thrown away.

---

### AR-12: `acceptFrom` Field Never Evaluated
**Severity:** Medium  
**Location:** `CanonicalAgentConfig`; `InputCoordinator.ts`  
**Category:** UI drift  

`listening.acceptFrom` defines which other agents may hand off tasks. The field is rendered in the AI Agent form, persisted to schema, but never read in `evaluateAgentListener`. Multi-agent chaining via `acceptFrom` silently has no effect.

---

### AR-13: `ocrText` Race Condition in `processMessagesWithOCR`
**Severity:** Medium  
**Location:** `sidepanel.tsx::processMessagesWithOCR`  
**Category:** Sequencing  

When multiple prior messages contain images, `processMessagesWithOCR` loops but assigns `ocrText` to the last processed result only. Earlier OCR results are discarded from the variable (though they are inserted into the message text). If context from a prior image is needed and the final image produces empty OCR, context is lost.

---

### AR-14: Grid Session Loading Bypasses Storage Proxy
**Severity:** Medium  
**Location:** `grid-display.js`; `background.ts`  
**Category:** Backend/frontend mismatch  

Grid display pages load session data via direct HTTP to Electron rather than through the service worker proxy / adapter chain. This bypasses any in-flight session state managed by the extension, and may return a stale view if the user has an active unsaved session.

---

### AR-15: No Confirmed WR Experts Integration Point
**Severity:** Low (architecture risk for upcoming work)  
**Location:** `agentContextFiles` in `CanonicalAgentConfig`; email `WRExpert.md`  
**Category:** Abstraction mismatch  

"WR Experts" in the product sense (domain knowledge files enriching reasoning) and "WR Expert" in the Electron email inbox are separate features that share a name. If a developer assumes email `WRExpert.md` is the orchestrator context-file system, they will build in the wrong place.

---

## Likely Runtime Failure Modes

### FM-1: Image-Only Input With No Typed Text, Agent Does Not Wake Up
**Severity:** Critical  
**Root cause:** AR-1 (OCR runs after routing). Trigger extracted from OCR never reaches `evaluateAgentListener`.  
**User experience:** WR Chat responds with inline fallback. Agent Box remains empty. No error shown.

---

### FM-2: Local Agent Calls Wrong Model or Produces API Error
**Severity:** Critical  
**Root cause:** AR-2 (provider string mismatch). `resolveModelForAgent` returns `'qwen2.5:7b'` fallback regardless of configured model.  
**User experience:** Agent responds but with the wrong brain. User sees output from a model they did not select, or sees a generic error if fallback model is not installed.

---

### FM-3: Cloud Agent Silently Falls Back to Local Ollama
**Severity:** Critical  
**Root cause:** AR-3 (cloud execution absent). `resolveModelForAgent` returns local fallback for all cloud providers.  
**User experience:** Agent responds using local Ollama instead of the cloud brain. User sees a response but it comes from the wrong model. No error is shown.

---

### FM-4: Agent Output Never Reaches Display-Grid Box
**Severity:** Critical  
**Root cause:** AR-4 + AR-5. Grid box invisible to routing + no live update handler.  
**User experience:** WR Chat appears to process input. Agent Box on display grid remains blank. No error shown.

---

### FM-5: Context Files Are Set But Never Used in Reasoning
**Severity:** High  
**Root cause:** AR-9. `agentContextFiles` not passed to `wrapInputForAgent`.  
**User experience:** Agent answers without the uploaded context. Domain-specific accuracy degrades. User assumes context is working because the form saved successfully.

---

### FM-6: Multi-Section Reasoning Agent Uses Only Flat `agent.reasoning`
**Severity:** High  
**Root cause:** AR-8. `reasoningSections[]` ignored in WR Chat path.  
**User experience:** Complex agent with per-trigger reasoning harnesses collapses to a single flat system prompt, losing specialized instructions for different trigger contexts.

---

### FM-7: API Key Present in Extension, Not Found by Cloud Call
**Severity:** High  
**Root cause:** AR-6. localStorage key vs SQLite key mismatch.  
**User experience:** Cloud model call fails with unauthorized error, or falls through to local fallback silently.

---

### FM-8: After Session Reload, Agent Box Output Gone
**Severity:** High  
**Root cause:** AR-7 (no schema version) + AR-4. Session loaded from different adapter; box outputs not versioned.  
**User experience:** User reopens sidepanel or navigates. Previously populated Agent Boxes are empty. No error.

---

### FM-9: Listener Trigger Matches Are Wrong After Source Filter Is Respected
**Severity:** Medium  
**Root cause:** AR-1 + unimplemented `listening.sources[]`. An agent with `sources: ['screenshot']` will currently wake up on any input because the source filter is ignored.  
**User experience:** Agents trigger in contexts they were not designed for; spurious outputs.

---

### FM-10: `acceptFrom` Chains Never Fire
**Severity:** Medium  
**Root cause:** AR-12. `acceptFrom` not evaluated.  
**User experience:** Multi-agent workflow chains silently drop — each agent operates independently regardless of handoff configuration.

---

## Risk Classification Matrix

| ID | Risk | Severity | Category | Code Location |
|---|---|---|---|---|
| AR-1 | OCR after routing | Critical | Sequencing | sidepanel.tsx:2925,2943 |
| AR-2 | Provider string mismatch | Critical | Abstraction mismatch | processFlow.ts:resolveModelForAgent |
| AR-3 | Cloud execution absent | Critical | Backend/frontend mismatch | processFlow.ts:resolveModelForAgent |
| AR-4 | Grid boxes invisible | Critical | State drift | processFlow.ts:loadAgentBoxesFromSession |
| AR-5 | No grid live update | Critical | Backend/frontend mismatch | grid-script.js (missing handler) |
| AR-6 | API key split-brain | High | State drift | content-script.tsx / main.ts |
| AR-7 | No session schema version | High | Schema drift | storageWrapper.ts |
| AR-8 | reasoningSections ignored | High | Abstraction mismatch | processFlow.ts:wrapInputForAgent |
| AR-9 | Context files silent no-op | High | UI drift | processFlow.ts:wrapInputForAgent |
| AR-10 | Session owner ambiguous | High | State drift | storageWrapper.ts / background.ts |
| AR-11 | NLP/OCR enrichment discarded | Medium | Sequencing | sidepanel.tsx:2967–3030 |
| AR-12 | acceptFrom not evaluated | Medium | UI drift | InputCoordinator.ts:evaluateAgentListener |
| AR-13 | ocrText race condition | Medium | Sequencing | sidepanel.tsx:processMessagesWithOCR |
| AR-14 | Grid bypasses storage proxy | Medium | Backend/frontend mismatch | grid-display.js |
| AR-15 | WR Experts name collision | Low | Abstraction mismatch | agentContextFiles / email WRExpert.md |
