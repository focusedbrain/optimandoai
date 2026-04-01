# 10 — Hotfixes vs Refactors

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–2 (docs 01–08)  
**Focus:** Classification of all identified gaps into hotfixes, medium refactors, and foundational refactors.

---

## Classification Criteria

**Hotfix:** A change confined to one function or one constant. Can be made and tested in isolation. Has no effect on the shape of surrounding code. Low risk of regression.

**Medium refactor:** A change that touches 2–5 files and adjusts how 2–3 components interact. Requires coordination across file boundaries. Risk of regression on the affected path.

**Foundational refactor:** A change that redefines a shared contract (a type, a store rule, a routing authority). Affects every component that touches that contract. High coordination required. Implementation must be deliberate and sequenced.

---

## Hotfixes

These can and should be applied first, independently, with zero dependencies on each other.

---

### HF-1: Fix `'Local AI'` Provider String Recognition
**File:** `processFlow.ts::resolveModelForAgent`  
**Change:** Add `'local ai'` to the set of strings recognized as the local Ollama provider.  
**Why hotfix:** One conditional check addition. No structural change. Zero external dependencies.  
**Test:** T0.1 — configured model name appears in Network request payload.  
**Warning:** Do NOT do this as a permanent fix without HF-2. It is a band-aid that HF-2 makes permanent.

---

### HF-2: Create `providers.ts` Constants File
**New file:** `src/constants/providers.ts`  
**Change:** Define `PROVIDER_IDS`, `ProviderId` type, `PROVIDER_LABELS` map, and `toProviderId(uiLabel)` conversion function.  
**Why hotfix:** Purely additive. Defines new types and constants. Nothing breaks until callers are updated to use them — and that update is incremental.  
**Test:** TypeScript compilation passes with zero new errors.

---

### HF-3: Fix `hasImage` to Current-Turn Scope
**File:** `sidepanel.tsx::handleSendMessage`  
**Change:** Replace `chatMessages.some(msg => msg.imageUrl)` with a check against only the current turn's attachments.  
**Why hotfix:** One-line replacement. Contained entirely within `handleSendMessage`. No external contract change.  
**Test:** Text-only send in a session with prior images → `hasImage: false` in routing log. Routing does not activate image-type agents.

---

### HF-4: Surface Brain Resolution Failures Visibly
**File:** `sidepanel.tsx::processWithAgent`  
**Change:** When `resolveModelForAgent` returns a fallback or error condition, write a warning to the Agent Box output. Do not silently proceed.  
**Why hotfix:** Additive. Adds one conditional output block. No path changes.  
**Test:** T0.2 (Ollama stopped), T0.3 (cloud without key) — box shows a message rather than empty or wrong-model output.

---

### HF-5: Add `surface` Field to `CanonicalAgentBoxConfig`
**File:** `src/types/CanonicalAgentBoxConfig.ts`; `content-script.tsx` box save path; grid dialog save path  
**Change:** Add `surface: 'sidepanel' | 'grid'` to the box config. Set it when a box is created based on where the dialog was opened.  
**Why hotfix:** Schema addition. Adding a new optional field with a default does not break existing box records. Downstream consumers that don't read `surface` yet are unaffected.  
**Test:** Create a sidepanel box → stored config has `surface: 'sidepanel'`. Create a grid box → stored config has `surface: 'grid'`.

---

## Medium Refactors

These require coordinating changes across 2–5 files. Each is a discrete unit of work with a clear before/after state.

---

### MR-1: Grid Box Persistence Unification
**Files:** `processFlow.ts::loadAgentBoxesFromSession`; `background.ts` (SAVE_AGENT_BOX_TO_SQLITE handler); grid dialog save path; `grid-display.js`  
**Change (Option B):** Update `loadAgentBoxesFromSession` to read from the `storageWrapper` adapter rather than `chrome.storage.local` directly. Grid session loading switches from direct Electron HTTP to service worker message.  
**Why medium:** Storage read-path change affects all routing calls. Requires testing in both Electron-running and Electron-stopped states.  
**Dependencies:** HF-5 (surface field). `storageWrapper` must expose a consistent `getItem` API for box records.  
**Test:** T1.1–T1.5 from Phase 1.

---

### MR-2: Grid Live Output Handler
**Files:** `grid-script.js`, `grid-script-v2.js`  
**Change:** Add `chrome.runtime.onMessage.addListener` for `UPDATE_AGENT_BOX_OUTPUT`. Match on `target.boxId` or `target.surface`. Update the slot DOM.  
**Why medium:** Additive in grid scripts but requires box ID awareness in the DOM — grid pages must know which DOM slot corresponds to which `boxId`. This may require the box ID to be written to the DOM at render time.  
**Dependencies:** MR-1 (boxes must be found by routing before output can be delivered). HF-5 (`surface` field for filtering).  
**Test:** T1.1 — grid box updates live. T1.3 — both sidepanel and grid update from same trigger.

---

### MR-3: API Key Store Unification
**Files:** `content-script.tsx::saveApiKeys`; `storageWrapper.ts`; `background.ts`; Electron `main.ts::handshake:getAvailableModels`  
**Change:** Extension settings UI writes API keys to SQLite via adapter chain. Remove `localStorage['optimando-api-keys']` as primary key store. Electron reads from SQLite.  
**Why medium:** The key path touches extension UI, service worker, adapter chain, and Electron backend — 4 files. The migration must not silently erase existing keys.  
**Dependencies:** None on prior phases (can be done in parallel with Phase 1), but must precede MR-5 (cloud execution needs keys).  
**Test:** Enter key in extension settings. Inspect SQLite: `SELECT * FROM settings WHERE key LIKE 'api_key_%'`. Key present. Reload. Key still present.

---

### MR-4: Save-Time `ProviderId` Conversion
**Files:** `content-script.tsx` Agent Box dialog save; `grid-script.js`; `grid-script-v2.js`  
**Change:** When an Agent Box is saved, convert the UI display label (`'Local AI'`, `'OpenAI'`, etc.) to a `ProviderId` constant using `toProviderId()`. Store `ProviderId`, not the UI label.  
**Why medium:** The conversion must happen consistently in every box save path — content-script, grid-script (2 files). Grid scripts must have the constant table inlined.  
**Dependencies:** HF-2 (`providers.ts` constants must exist). Requires schema migration consideration for existing boxes that stored UI labels.  
**Test:** Create a new box with `Local AI`. Inspect stored session blob: `provider === 'ollama'` (not `'Local AI'`). Reload and reopen dialog: provider selector shows `'Local AI'` (re-derived from stored `'ollama'` via `PROVIDER_LABELS`).

---

### MR-5: Cloud Provider Execution (One Provider)
**Files:** Electron `main.ts` or dedicated cloud handler; `processFlow.ts::resolveModelForAgent`; `sidepanel.tsx::processWithAgent`  
**Change:** Add OpenAI dispatch to Electron `/api/llm/chat`. Update `resolveModelForAgent` to construct `LLMCallConfig` for cloud providers. Update `processWithAgent` to send `LLMCallConfig` fields in the request body.  
**Why medium:** Additive to Electron (new dispatch case). Extension changes are limited to the call site and brain resolution. This is scoped — it does not restructure the entire call path.  
**Dependencies:** MR-3 (key store must work). HF-2 (provider constants). Phase 0 complete.  
**Test:** T3.1–T3.3 from Phase 3.

---

### MR-6: `RuntimeAgentConfig` Type Definition
**Files:** New type file (or added to `processFlow.ts`); `processFlow.ts::wrapInputForAgent` / `buildSystemPrompt`; `InputCoordinator.ts::evaluateAgentListener`  
**Change:** Define `RuntimeAgentConfig` as the narrow type subset of `CanonicalAgentConfig` that the runtime actually reads. Update `wrapInputForAgent` and `evaluateAgentListener` to accept `RuntimeAgentConfig`.  
**Why medium:** Touches two central functions. Narrowing the type is safe (existing callers can still pass `CanonicalAgentConfig` as a supertype). Adds clarity without breaking behavior.  
**Dependencies:** None urgent. Can be done at any phase. Recommended before Phase 4 work begins.  
**Test:** TypeScript compilation passes. Runtime behavior unchanged (unit test: `buildSystemPrompt` output is identical before and after type narrowing).

---

## Foundational Refactors

These define shared contracts that multiple components depend on. They must be done deliberately and sequenced correctly. Each is a normalization blocker from doc 07.

---

### FR-1: Define `TurnInput` and `EnrichedInput` (NB-1)
**Files:** New type file `src/types/EnrichedInput.ts`; `sidepanel.tsx::handleSendMessage`; `processFlow.ts`; `InputCoordinator.ts`  
**Change:** Define the canonical input carrier types. Thread them through the pipeline — `handleSendMessage` assembles `TurnInput`, OCR produces `EnrichedInput`, routing consumes `EnrichedInput`.  
**Why foundational:** Every other Phase 2 change depends on this type existing. Without it, OCR resequencing has no typed destination and routing unification has no typed input. This is the pipeline's data contract.  
**Dependencies:** None preceding it. Must precede OCR resequencing (FR-2) and routing unification (FR-3).  
**Test:** TypeScript compilation passes. `handleSendMessage` produces a valid `EnrichedInput` object that can be inspected in the console. All downstream functions receive it.

---

### FR-2: OCR Resequencing in `handleSendMessage` (NB-3)
**Files:** `sidepanel.tsx::handleSendMessage`  
**Change:** Move `processMessagesWithOCR` before any routing call. Await OCR completion. Concatenate all OCR results. Assemble `EnrichedInput`. Fix `hasImage` (can incorporate HF-3).  
**Why foundational:** This changes the execution order of `handleSendMessage`. It is the most loaded function in the codebase. The sequencing change is narrow (two calls swap order) but its effect is broad — every agent that processes images is affected.  
**Dependencies:** FR-1 (`EnrichedInput` type must exist). Phase 0 and Phase 1 must be stable.  
**Test:** T2.1–T2.5 from Phase 2. Full regression of Phase 0–1 tests.

---

### FR-3: Routing Authority Unification (NB-2)
**Files:** `sidepanel.tsx::handleSendMessage`; `processFlow.ts`; `InputCoordinator.ts::routeClassifiedInput`  
**Change:** Elevate `routeClassifiedInput` (or a refactored equivalent) to the canonical routing function. The execution loop in `handleSendMessage` consumes its output. `routeInput` (old pre-OCR call) is retired from the execution path — marked as diagnostic-only or removed.  
**Why foundational:** This changes which routing computation drives agent execution. Currently, the pre-OCR `routeInput` is authoritative. After this change, the post-OCR+NLP routing function is authoritative. This affects every agent activation on every WR Chat send.  
**Dependencies:** FR-1 (`EnrichedInput`). FR-2 (OCR before routing). `routeClassifiedInput` must return `AgentMatch[]` compatible with the execution loop.  
**Test:** Same as FR-2 — OCR trigger tests prove the new authority is working. Typed trigger tests prove the old path still works. All prior tests must pass.

---

### FR-4: Session Persistence Authority Rule (NB-7)
**Files:** `processFlow.ts::loadAgentBoxesFromSession`; `storageWrapper.ts`; `grid-display.js`; `background.ts`  
**Change:** Define and enforce: all session reads go through `storageWrapper`. No component reads `chrome.storage.local` directly for session data. Grid pages send `GET_SESSION` to service worker instead of direct Electron HTTP.  
**Why foundational:** This is the rule underlying MR-1. If MR-1 chooses Option B (adapter-based box loading), then FR-4 is partially implemented by MR-1. But FR-4 also covers grid session loading and any other components that currently bypass the adapter.  
**Dependencies:** MR-1 (box loading change is the largest piece). Should be done in the same phase as MR-1.  
**Test:** T1.5 (session reload preserves boxes). T7 (navigate away, return — session still correct). Both with Electron running and Electron stopped.

---

## Classification Summary

| ID | Item | Classification | Phase |
|---|---|---|---|
| HF-1 | Fix `'Local AI'` provider string | Hotfix | Phase 0 |
| HF-2 | Create `providers.ts` constants | Hotfix | Phase 0 |
| HF-3 | Fix `hasImage` to current-turn scope | Hotfix | Phase 0 (or Phase 2 with FR-2) |
| HF-4 | Surface brain resolution failures | Hotfix | Phase 0 |
| HF-5 | Add `surface` field to AgentBoxConfig | Hotfix | Phase 1 prep |
| MR-1 | Grid box persistence unification | Medium refactor | Phase 1 |
| MR-2 | Grid live output handler | Medium refactor | Phase 1 |
| MR-3 | API key store unification | Medium refactor | Phase 1–3 |
| MR-4 | Save-time `ProviderId` conversion | Medium refactor | Phase 0–1 |
| MR-5 | Cloud provider execution (OpenAI) | Medium refactor | Phase 3 |
| MR-6 | `RuntimeAgentConfig` type definition | Medium refactor | Phase 4 prep |
| FR-1 | Define `TurnInput` and `EnrichedInput` | Foundational | Phase 2 prereq |
| FR-2 | OCR resequencing in `handleSendMessage` | Foundational | Phase 2 |
| FR-3 | Routing authority unification | Foundational | Phase 2 |
| FR-4 | Session persistence authority rule | Foundational | Phase 1–2 |

---

## What Must NOT Be Done as a Hotfix

**Provider string normalization (HF-1) without a constants file (HF-2):**  
Adding `'local ai'` as a recognized local string in `resolveModelForAgent` without creating `providers.ts` is a temporary fix that creates the same problem for cloud providers. Both must be done together.

**Grid live output handler (MR-2) without box persistence unification (MR-1):**  
The grid handler will listen for `UPDATE_AGENT_BOX_OUTPUT` but the routing engine still cannot find grid boxes. The handler fires for boxes it knows about from the DOM — but if the routing engine never sent output for grid boxes (because it couldn't find them), the handler receives nothing. MR-1 must precede MR-2.

**Cloud execution (MR-5) without API key unification (MR-3):**  
Building the cloud dispatch path before unifying the key store means Electron will look for keys in SQLite that the extension has been writing to `localStorage`. Cloud calls will fail with key-not-found errors until MR-3 is also complete.

**OCR resequencing (FR-2) without `EnrichedInput` (FR-1):**  
Moving OCR earlier in `handleSendMessage` without a typed object to carry the result means `ocrText` remains a raw variable. Routing is still called with raw strings. The OCR fix is cosmetic — the pipeline behavior doesn't change without the type contract.
