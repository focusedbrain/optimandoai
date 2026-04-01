# 15 — Gap Analysis vs Product Intent

**Status:** Analysis-only. Final synthesis.  
**Date:** 2026-04-01  
**Basis:** All prior documents (00–14) in this analysis series.

---

## Purpose

This document measures the current state of the orchestrator against each intended product behavior, using a strict classification for each area. Evidence references point to prior documents and confirmed code locations.

---

## Classification Legend

| Status | Meaning |
|---|---|
| **Implemented** | Working end-to-end as intended, code-proven |
| **Partially implemented** | Core logic exists but incomplete, misordered, or missing critical steps |
| **UI-only** | UI renders it correctly; runtime does not honor it |
| **Mismatched** | Code exists but does the wrong thing (behavior diverges from intent) |
| **Structurally blocked** | Cannot work correctly without resolving an architectural conflict first |
| **Unclear** | Insufficient evidence from current analysis round |

---

## 1. OCR-Aware Routing

**Intent:** OCR should enrich input before routing decisions are made. Image-derived text should influence which agents wake up.

**Classification: Mismatched**

**Evidence:**
- `routeInput` runs at sidepanel.tsx line 2925
- `processMessagesWithOCR` runs at line 2943 — **18 lines later**
- The routing decision that drives agent execution uses pre-OCR text
- `routeClassifiedInput` receives OCR-enriched text (line 2983) but its result is logged and discarded

**Gap:** OCR is correctly processed and enriches the LLM message content — but it arrives after the authoritative routing decision. An agent configured with a trigger that would only appear in OCR-extracted text from an image will never activate via the WR Chat path.

**What needs to change:** Move `processMessagesWithOCR` before `routeInput`. Pass `ocrText` into the routing call. Unify the execution routing onto `routeClassifiedInput` after OCR+NLP.

---

## 2. Listener Wake-Up

**Intent:** Listener determines when an agent wakes up based on triggers, context, input type, and website.

**Classification: Partially implemented**

**Evidence:**
- `evaluateAgentListener` (InputCoordinator lines 210–426) correctly evaluates: capability check, website filter, trigger name matching, expected context substring, `applyFor` input type
- Trigger matching works for unified triggers and legacy formats

**Gaps:**
- `listening.sources[]` (14 source types: voice, email, screenshot, DOM, API, etc.) — defined in schema, rendered in UI, **not evaluated in routing**
- `listening.exampleFiles` — schema field only, no runtime consumption
- DOM trigger types (`dom_event`, `dom_parser`, `augmented_overlay`) — defined in `TriggerTypeValues`, no confirmed runtime handler
- Listener wake-up runs on **pre-OCR text** (see gap 1)
- `hasImage` check uses full session chat history, not current turn

**What works:** Tag-based triggers, website filter, expected context, `applyFor` input type matching.  
**What doesn't:** Source filtering, DOM triggers, OCR-timed activation.

---

## 3. Reasoning Harness

**Intent:** Reasoning provides the full system harness: role, goals, rules, WR Experts, context files, memory signals, selectable by trigger.

**Classification: Partially implemented**

**Evidence:**
- `wrapInputForAgent` (processFlow.ts lines 1089–1132) assembles: role, goals, rules, custom fields, user input, ocrText
- This becomes the `role: 'system'` message in the LLM call

**Gaps:**
- `reasoningSections[]` (multi-section, per-trigger): ignored in WR Chat path — only flat `agent.reasoning` is read
- `agentContextFiles[]`: persisted, not injected into system prompt
- `memoryContext` toggles: persisted, no runtime consumption
- WR Experts: no field exists on agent config; email `WRExpert.md` is unrelated
- `acceptFrom`: declared in schema, never evaluated
- Multi-section reasoning only works via the event-tag path (`resolveReasoningConfig`) — which is itself only logged, not executed

---

## 4. Execution Routing

**Intent:** Execution decides how to deliver output: mode (agent_workflow, direct_response, workflow_only, hybrid), destination (box, chat, email, webhook, storage), execution workflows.

**Classification: Partially implemented (output destination only)**

**Evidence:**
- Output is written to the matched Agent Box via `updateAgentBoxOutput` ✓
- `findAgentBoxesForAgent` resolves destination box by agentNumber / reportTo / specialDestinations ✓
- `routeClassifiedInput` computes destination as box label or `'Inline Chat'` ✓

**Gaps:**
- `executionMode` (4 modes): not branched on anywhere in `processWithAgent`
- Non-box destinations (`email`, `webhook`, `storage`, `notification`): defined in schema, not implemented
- `executionWorkflows`: defined, not consumed
- `resolveExecutionConfig` (full typed destination resolution) only runs on event-tag path — not on WR Chat path
- WR Chat path uses simplified box-or-inline destination logic

---

## 5. Agent Box as Brain Container

**Intent:** Agent Box defines which brain (provider + model) is used. Later: tools, output behavior, special modes.

**Classification: Mismatched**

**Evidence:**
- Schema `CanonicalAgentBoxConfig` has `provider`, `model`, `tools: []` ✓
- UI correctly populates provider and model ✓
- `resolveModelForAgent` (processFlow.ts lines 1210–1245):
  - Recognizes `'ollama'`, `'local'`, `''` as local
  - `'Local AI'` (UI value, lowercased to `'local ai'`) → **NOT recognized** → fallback
  - All cloud providers → **"API not yet connected"** fallback

**Gaps:**
- `'Local AI'` provider string mismatch: UI string not matched by runtime
- Cloud execution: entirely unimplemented
- `executionMode` on box: not consumed
- `tools`: placeholder array, no wiring

---

## 6. Global Context / Global Memory Usage

**Intent:** Global context and global memory apply across agents, enriching the system prompt and memory retrieval.

**Classification: Unclear**

**Evidence:**
- `CanonicalAgentConfig` has `contextSettings` (`agentContext`, `sessionContext`, `accountContext`) and `memorySettings` (`agentEnabled`, `sessionEnabled`, `accountEnabled`)
- UI renders all toggles
- Not consumed in `wrapInputForAgent` or any confirmed runtime path
- No global context registry was found in this analysis

**Gap:** Neither the storage mechanism nor the runtime consumption for global context/memory is confirmed. The schema fields exist. There is no confirmed path where they influence LLM output.

---

## 7. Agent-Level Context / Memory Usage

**Intent:** Per-agent context files and memory settings enrich the agent's reasoning harness.

**Classification: UI-only**

**Evidence:**
- `agentContextFiles[]` is persisted via file upload UI ✓
- `memorySettings` values are persisted to session ✓
- `wrapInputForAgent` does not read either field
- No `agentContextFiles` references in `processFlow.ts`
- Form saves extra fields (`sessionRead`, `sessionWrite`) not in canonical schema

---

## 8. Local Model Sync

**Intent:** Local LLM model selectors must reflect backend reality. No static lists.

**Classification: Partially implemented (post-stabilization pass)**

**Evidence:**
- `localOllamaModels.ts` created to fetch real model names via `electronRpc('llm.status')` ✓
- `refreshModels` in content-script box dialogs calls `fetchInstalledLocalModelNames()` for Local AI ✓
- Grid scripts `fetchLocalModelNames` / `fetchLocalModelNamesV2` call `ELECTRON_RPC + llm.status` ✓
- `LlmSettings.tsx` displays real installed models ✓

**Remaining gap:** Even though the UI correctly fetches and displays real model names, `resolveModelForAgent` does not recognize `'Local AI'` as a local provider — so the fetched model name is stored correctly but discarded at runtime.

---

## 9. API Key / Provider Visibility

**Intent:** Cloud provider availability must reflect actual API key state. Selectors should not show providers without keys.

**Classification: Mismatched**

**Evidence:**
- Extension: `saveApiKeys` → `localStorage['optimando-api-keys']` (content-script)
- Electron: `handshake:getAvailableModels` reads orchestrator SQLite store as fallback
- Agent Box provider dropdowns: show all 4 cloud providers regardless of key state (static list)
- Cloud provider API calls: unimplemented regardless of key state
- `shouldUseCloud` in OCR router reads `CloudAIConfig.apiKeys` — origin unconfirmed

**Gaps:**
- Two separate API key stores (localStorage, SQLite) with no sync
- Provider dropdowns not gated by key presence
- Three separate read points for provider availability — all potentially inconsistent

---

## 10. Sidepanel / Display-Grid Equivalence

**Intent:** Agent Boxes in sidepanel and display grid are the same conceptual type. Output should land in either, live.

**Classification: Structurally blocked**

**Evidence:**
- Schema: both use `CanonicalAgentBoxConfig` ✓
- Write paths: content-script boxes → chrome.storage (adapter → SQLite); grid boxes → `SAVE_AGENT_BOX_TO_SQLITE` → SQLite only
- Read for routing: `loadAgentBoxesFromSession` reads chrome.storage.local only
- `UPDATE_AGENT_BOX_OUTPUT`: sidepanel handles it (setAgentBoxes); grid pages have no handler
- Grid boxes: invisible to routing engine; no live output update

**Structural blockers (all three required for equivalence):**
1. `loadAgentBoxesFromSession` must read SQLite
2. Grid box writes must reach chrome.storage (or adapter must mirror)
3. Grid pages must handle `UPDATE_AGENT_BOX_OUTPUT`

---

## 11. Session / Global Scoping

**Intent:** Sessions store structured JSON for agents, boxes, grids. Agents can be session-scoped or global (account-scoped).

**Classification: Partially implemented**

**Evidence:**
- Session-scoped agents: `session.agents[]` ✓ (in session blob)
- Account-scoped agents: separate `saveAccountAgents` / `getAccountAgents` storage
- `normalizeSessionAgents` strips account-scoped agents from session blob ✓
- Session blob: no `_schemaVersion` field — no migration support
- Account-scoped agents: not in session exports; storage location unconfirmed

**Gaps:**
- No confirmed import/export UI for full sessions
- Account agents' storage key and adapter path not confirmed
- `displayGrids` structure confirmed but grid session loading uses direct HTTP, bypassing proxy

---

## 12. Mobile Flags

**Intent:** Mobile is UI-only for MVP.

**Classification: UI-only (correct for MVP)**

**Evidence:**
- `agent.platforms.desktop` and `agent.platforms.mobile` checkboxes on agent cards
- Not in `CanonicalAgentConfig` schema
- Not consumed by `InputCoordinator` or `processFlow`

**Assessment:** Mobile flags are correctly scoped as UI-only for MVP. No action needed unless mobile routing is to be implemented.

---

## Summary Classification Table

| Area | Classification | Blocking Issue |
|---|---|---|
| OCR-aware routing | **Mismatched** | routeInput runs before OCR |
| Listener wake-up | **Partially implemented** | Sources not evaluated; OCR timing wrong |
| Reasoning harness | **Partially implemented** | Multi-sections ignored; context/memory/WR Experts absent |
| Execution routing | **Partially implemented** | Mode ignored; non-box destinations absent |
| Agent Box as brain | **Mismatched** | Provider string mismatch; cloud unimplemented |
| Global context/memory | **Unclear** | No confirmed runtime path |
| Agent context/memory | **UI-only** | Not read by prompt assembly |
| Local model sync | **Partially implemented** | UI correct; runtime provider mismatch |
| API key/provider visibility | **Mismatched** | Two key stores; dropdowns not key-gated |
| Sidepanel/grid equivalence | **Structurally blocked** | Box persistence split; no live grid update |
| Session/global scoping | **Partially implemented** | Account agent path unconfirmed; no session version |
| Mobile flags | **UI-only (intentional MVP)** | — |
