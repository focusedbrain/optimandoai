# 02 — Gap Map Against First E2E Goal

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Basis:** Prior analysis series (docs 00–19), confirmed code locations.

---

## Classification Key

| Status | Definition |
|---|---|
| **Working** | Confirmed end-to-end in code. No changes needed for first E2E. |
| **Partially wired** | Core logic exists. Missing one or two connections. Works in narrow conditions. |
| **Broken** | Code exists but actively produces wrong output. Silent failure common. |
| **Structurally blocked** | Cannot work without resolving a persistent/architectural conflict first. |
| **UI-only** | UI renders the control. Runtime ignores it. No error surfaced to user. |
| **Unclear** | Insufficient confirmed evidence to classify with confidence. |

---

## 1. API Key Handling

**Status: Broken**

**Why it matters:** API keys are how cloud providers are authenticated. Without them reaching the Electron backend, no cloud execution is possible.

**What's wrong:**
- Extension settings UI saves keys to `localStorage['optimando-api-keys']`.
- Electron backend reads keys from its own SQLite store via `handshake:getAvailableModels`.
- No confirmed sync path exists between these two stores.
- Cloud execution is currently unimplemented in any case — but even when implemented, keys would not reach it.

**Blocks first E2E?** Yes — blocks T4 (cloud provider test). Does NOT block T1–T3 (local path).

**Code location:** `content-script.tsx::saveApiKeys` → `localStorage`; `main.ts::handshake:getAvailableModels` → SQLite.

**Fix category:** Medium refactor (define one key store; sync extension saves to SQLite via adapter).

---

## 2. Cloud Provider Execution

**Status: Broken (not implemented)**

**Why it matters:** The product goal requires at least one cloud provider to work end-to-end for the first tests.

**What's wrong:**
- `resolveModelForAgent` (processFlow.ts lines 1210–1245) hits "API not yet connected" for all cloud providers.
- `processWithAgent` posts to `Electron /api/llm/chat`, which is an Ollama-only endpoint.
- There is no separate cloud API dispatch path in either extension or Electron backend.
- This is not a wiring gap — it is an unimplemented feature.

**Blocks first E2E?** Yes — blocks T4 (cloud provider test). Does NOT block T1–T3.

**Code location:** `processFlow.ts::resolveModelForAgent`; `sidepanel.tsx::processWithAgent`; Electron `main.ts` `/api/llm/chat`.

**Fix category:** Structural refactor — Electron must route cloud calls. Extension `resolveModelForAgent` must dispatch by provider. API key sync (gap 1) must be resolved first.

---

## 3. Local Model Execution

**Status: Broken (provider string mismatch)**

**Why it matters:** Local Ollama is the only currently available execution path. If it is broken, nothing works.

**What's wrong:**
- UI saves provider as `'Local AI'` (string).
- `resolveModelForAgent` recognizes `'ollama'`, `'local'`, `''` as local — but NOT `'local ai'` (after lowercasing).
- Result: every Agent Box configured with `Local AI` provider silently falls back to a hardcoded fallback model identifier, discarding the user's model selection.
- The model the user sees in the dropdown is not the model that runs.

**Blocks first E2E?** Yes — blocks T1, T2, T3. This is the single most critical bug.

**Code location:** `processFlow.ts::resolveModelForAgent` lines 1210–1245.

**Fix category:** Hotfix — add `'local ai'` to the local provider string check. One line change, but should be done as part of a full `providers.ts` constant file to avoid creating the next mismatch.

---

## 4. Agent Box Provider/Model Binding

**Status: Broken (provider string mismatch + cloud unimplemented)**

**Why it matters:** The Agent Box is the intended brain container. If provider/model binding doesn't work, the agent runs with the wrong brain regardless of configuration.

**What's wrong:**
- Provider string `'Local AI'` is not recognized (see gap 3).
- Cloud providers are unimplemented (see gap 2).
- The model string saved to the box IS correct and IS stored correctly by the UI.
- The saved model string is discarded at runtime by `resolveModelForAgent` before it can be used.

**Blocks first E2E?** Yes — a dependency of T1–T4.

**Code location:** `processFlow.ts::resolveModelForAgent`; `CanonicalAgentBoxConfig.ts`.

**Fix category:** Hotfix for local (string fix). Structural refactor for cloud (provider dispatch).

---

## 5. Sidepanel Agent Boxes

**Status: Partially wired**

**Why it matters:** Sidepanel boxes are the primary output surface for the first tests.

**What works:**
- Box creation, storage to session, retrieval via `loadAgentBoxesFromSession` ✓
- `findAgentBoxesForAgent` resolves destination by agentNumber ✓
- `updateAgentBoxOutput` writes output to session and sends live message ✓
- Sidepanel `UPDATE_AGENT_BOX_OUTPUT` handler updates React state → live render ✓

**What's broken:**
- `resolveModelForAgent` discards the configured model (gap 3/4)
- `loadAgentBoxesFromSession` reads `chrome.storage.local` only — if adapter is SQLite, may miss boxes saved via SQLite-only path

**Blocks first E2E?** Partially. With the provider string fix (gap 3), sidepanel boxes would work for local agents. The storage adapter issue is lower risk if the sidepanel consistently writes through chrome.storage.

**Code location:** `processFlow.ts::loadAgentBoxesFromSession`, `updateAgentBoxOutput`; `sidepanel.tsx` line 1576.

**Fix category:** Hotfix (provider string). Verify adapter chain for sidepanel writes to confirm no hidden split.

---

## 6. Display-Grid Agent Boxes

**Status: Structurally blocked**

**Why it matters:** Grid boxes are part of the stated E2E goal. If they don't work at all, the test set is incomplete.

**What's wrong (three independent blockers):**
1. **Grid boxes are invisible to routing.** `loadAgentBoxesFromSession` reads `chrome.storage.local` only. Grid box saves go to SQLite via `SAVE_AGENT_BOX_TO_SQLITE` — not to chrome.storage. The routing engine cannot find them. Output has no destination.
2. **No live update handler.** Grid pages (grid-script.js, grid-script-v2.js, grid-display.js) have no `chrome.runtime.onMessage` handler for `UPDATE_AGENT_BOX_OUTPUT`. Output that is delivered never reaches the DOM.
3. **Grid session loading bypasses storage proxy.** Grid display pages load session data via direct HTTP to Electron, bypassing the service worker adapter chain. Even if routing were fixed, grid pages could have a different session view than sidepanel.

**Blocks first E2E?** Yes — blocks T3 (grid box equivalence test).

**Code location:** `processFlow.ts::loadAgentBoxesFromSession`; `background.ts` (SAVE_AGENT_BOX_TO_SQLITE handler); grid-script.js / grid-script-v2.js / grid-display.js.

**Fix category:** Medium refactor (all three blockers). The second fix (adding the message listener) is additive and low risk. The first and third are storage chain changes that require careful testing.

---

## 7. WR Chat Send Path

**Status: Partially wired**

**Why it matters:** It is the primary user interface for sending input to agents.

**What works:**
- Message assembly, sending, basic text routing ✓
- Agent execution loop (`processWithAgent`) ✓
- OCR processing runs and appends text to the message ✓
- System prompt assembly with role/goals/rules ✓

**What's broken:**
- `routeInput` runs **before** OCR. Agents triggered by OCR-extracted text will not activate (gap 8).
- Three routing computations per send; only the pre-OCR one drives execution (gaps 7, 8).
- `hasImage` checks full session history, not current turn — false positives possible.
- `resolveModelForAgent` discards the configured model (gap 3).

**Blocks first E2E?** The basic typed-trigger path (T1) works at this layer. T2 (OCR trigger) is blocked at this layer. T1's provider bug is a different layer.

**Code location:** `sidepanel.tsx::handleSendMessage` lines 2813+.

**Fix category:** Hotfix (hasImage history check). Medium refactor (OCR order resequence for T2).

---

## 8. OCR-Aware Routing

**Status: Broken (sequencing)**

**Why it matters:** The product goal explicitly includes OCR as part of routing. Image-based agent activation is a core scenario.

**What's wrong:**
- `routeInput` (line 2925) — the authoritative routing call — runs before `processMessagesWithOCR` (line 2943).
- `routeClassifiedInput` sees OCR-enriched text and produces the correct agent allocations — but these allocations are logged and discarded, never used for execution.
- This is not a missing feature; the OCR-aware routing logic EXISTS and is CORRECT. The problem is solely that its output is wired to a logger instead of the execution loop.

**Blocks first E2E?** Yes — blocks T2 (OCR trigger test).

**Code location:** `sidepanel.tsx::handleSendMessage` lines 2925 and 2943 (ordering); line 2992 (discarded result).

**Fix category:** Medium refactor. Requires resequencing `handleSendMessage` and threading `ocrText` into the routing call. High-risk function (most loaded in codebase) — worth a feature flag approach.

---

## 9. Listener Wake-Up

**Status: Partially wired**

**Why it matters:** Listener is how agents decide whether to activate for a given input. Incorrect listener behavior means wrong agents fire (or right agents don't fire).

**What works:**
- Capability check ✓
- Website filter ✓
- Trigger keyword matching (unified + legacy formats) ✓
- Expected context substring check ✓
- `applyFor` input type (text/image/mixed) ✓

**What doesn't:**
- `listening.sources[]` (14 source types: voice, screenshot, DOM, email, etc.) — field exists in schema, UI renders it, runtime ignores it
- DOM trigger types (`dom_event`, `dom_parser`, `augmented_overlay`) — no confirmed runtime handler
- Listener runs on pre-OCR text (gap 8 dependency)

**Blocks first E2E?** The working subset (keyword triggers) is sufficient for T1, T5. Source filtering absence means agents with source constraints activate incorrectly — but for first tests, source constraints are not required.

**Code location:** `InputCoordinator.ts::evaluateAgentListener` lines 210–426.

**Fix category:** Not blocking. Source filtering is a P2 item. The listener works for trigger-based activation.

---

## 10. Reasoning Harness

**Status: Partially wired**

**Why it matters:** The reasoning harness is what the LLM actually receives as its system prompt. Misconfigured or incomplete prompt delivery means the agent behaves incorrectly regardless of capability.

**What works:**
- `agent.role`, `agent.goals`, `agent.rules` are assembled into system prompt ✓
- `ocrText` is appended when present ✓
- Custom fields are included ✓

**What doesn't:**
- `reasoningSections[]` — multi-section per-trigger reasoning — ignored. Only flat `agent.reasoning` is read.
- `agentContextFiles[]` — persisted, never injected.
- `memorySettings` — persisted, never consumed.
- WR Experts — no confirmed integration point.

**Blocks first E2E?** No — for the first pass, flat reasoning is sufficient. The gap is that users configuring multi-section reasoning get flat behavior silently. This is misleading UI but not a blocking runtime gap.

**Code location:** `processFlow.ts::wrapInputForAgent` lines 1089–1132.

**Fix category:** Medium refactor for `reasoningSections[]` wiring. Non-blocking for first E2E. Dangerous from UX perspective (misleading).

---

## 11. Execution Routing

**Status: Partially wired (single box output only)**

**Why it matters:** Execution routing determines what happens to the LLM output.

**What works:**
- Output delivered to the first matching Agent Box ✓
- `findAgentBoxesForAgent` resolves destination by agentNumber, reportTo, specialDestinations ✓
- Box receives output via `updateAgentBoxOutput` ✓

**What doesn't:**
- `executionMode` (4 modes: `agent_workflow`, `direct_response`, `workflow_only`, `hybrid`) — not branched on anywhere
- Non-box destinations (email, webhook, storage, notification) — not implemented
- `resolveExecutionConfig` only runs on event-tag path, not WR Chat path

**Blocks first E2E?** No — single box output is sufficient for first tests. Execution mode and alternate destinations are P3.

**Code location:** `processFlow.ts::updateAgentBoxOutput`, `findAgentBoxesForAgent`; `InputCoordinator.ts::resolveExecutionConfig`.

**Fix category:** Non-blocking. Deferred.

---

## 12. Output Delivery

**Status: Partially wired (sidepanel working; grid blocked)**

**Why it matters:** Output delivery is the visible result of the orchestrator. If output doesn't land in the right place, the system appears broken even when the LLM ran correctly.

**What works:**
- Sidepanel boxes: `UPDATE_AGENT_BOX_OUTPUT` → React state update → live render ✓
- Session blob updated in chrome.storage ✓

**What doesn't:**
- Grid boxes: no live update handler → must reload page
- Grid boxes: often not found by routing engine (gap 6)
- LLM failure: no visible error in box — silent empty state
- Multiple boxes per agent: only first matched box receives output

**Blocks first E2E?** Grid output is blocking for T3. Sidepanel output works once provider string is fixed.

**Code location:** `processFlow.ts::updateAgentBoxOutput` lines 1137–1195; `sidepanel.tsx` line 1576; grid-script.js (missing handler).

**Fix category:** Medium refactor for grid. Hotfix for error surfacing.

---

## 13. Session Persistence

**Status: Partially wired**

**Why it matters:** Sessions carry agents, boxes, and conversation history. If session persistence is unreliable, agents disappear between sessions.

**What works:**
- Session-scoped agents persist to session blob ✓
- `storageWrapper.ts` routes to SQLite when Electron is running ✓
- Sidepanel reads session correctly via adapter chain ✓

**What doesn't:**
- Session blob has no `_schemaVersion` — schema evolution will silently break existing sessions
- Account-scoped agents: separate store, path unconfirmed
- Grid session loading bypasses adapter proxy (direct HTTP to Electron)
- Session authority is ambiguous: three distinct read paths with no conflict resolution

**Blocks first E2E?** Low risk for first tests if Electron is consistently running and no schema changes are made. The version field absence is latent risk.

**Code location:** `storageWrapper.ts`; `background.ts::GET_SESSION_FROM_SQLITE`; `grid-display.js` (direct HTTP).

**Fix category:** Medium refactor (session authority). Non-blocking for first E2E in controlled conditions.

---

## 14. Global vs Session Scoping

**Status: Partially wired**

**Why it matters:** Account-scoped agents should be available across sessions. Session-scoped agents should be isolated. Confusion between these causes agents to appear or disappear unexpectedly.

**What works:**
- Session-scoped agents in `session.agents[]` ✓
- `normalizeSessionAgents` strips account agents from session blob ✓

**What doesn't:**
- Account agent storage key and adapter path not confirmed
- Account agents do not appear in session exports
- No confirmed round-trip: create account agent → reload → verify still present

**Blocks first E2E?** No — first tests can use session-scoped agents only.

**Code location:** `content-script.tsx::saveAccountAgents / getAccountAgents`.

**Fix category:** Non-blocking. Deferred.

---

## 15. Context/Memory Usage

**Status: UI-only**

**Why it matters:** The UI presents context files, memory toggles, and session context as live controls. Users who configure them expect them to affect LLM behavior.

**What works:** Persistence to session blob (context files, memory toggles are saved).

**What doesn't:** `wrapInputForAgent` does not read `agentContextFiles`, `memorySettings`, or `contextSettings`. Nothing configured here reaches the LLM. There is no error — the agent simply ignores the configuration silently.

**Blocks first E2E?** No — does not prevent the basic path from working. **Dangerous from UX perspective** — see document 05 for deferral classification.

**Code location:** `processFlow.ts::wrapInputForAgent` lines 1089–1132; `content-script.tsx` agent config tabs.

**Fix category:** Medium refactor for context files. Non-blocking but misleading.

---

## Gap Summary Table

| Area | Status | Blocks First E2E? | Fix Category |
|---|---|---|---|
| API key handling | **Broken** | Yes (cloud only) | Medium refactor |
| Cloud provider execution | **Broken (not implemented)** | Yes (for T4) | Structural refactor |
| Local model execution | **Broken (string mismatch)** | Yes (T1–T3) | Hotfix + provider registry |
| Agent Box provider/model binding | **Broken** | Yes | Hotfix + structural |
| Sidepanel Agent Boxes | **Partially wired** | Partially | Hotfix |
| Display-grid Agent Boxes | **Structurally blocked** | Yes (T3) | Medium refactor (3 blockers) |
| WR Chat send path | **Partially wired** | Partially | Hotfix + medium refactor |
| OCR-aware routing | **Broken (sequencing)** | Yes (T2) | Medium refactor |
| Listener wake-up | **Partially wired** | No (for first tests) | Not blocking |
| Reasoning harness | **Partially wired** | No | Medium refactor |
| Execution routing | **Partially wired** | No | Deferred |
| Output delivery | **Partially wired** | Yes (grid) | Medium refactor |
| Session persistence | **Partially wired** | Low risk | Medium refactor |
| Global vs session scoping | **Partially wired** | No | Deferred |
| Context/memory usage | **UI-only** | No (but misleading) | Medium refactor + UX warning |
