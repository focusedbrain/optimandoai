# 09 — First Implementation Phases

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–2 (docs 01–08)  
**Focus:** Ordered implementation phases for bringing the orchestrator to first end-to-end functionality with minimum architectural damage.

---

## Framing

Each phase must leave the system in a verifiable, testable state. No phase disables existing functionality to complete. Phases are ordered by dependency: each phase's output is the regression baseline for the next phase.

The implementation order is chosen to minimize the risk of invalidating prior work. Foundational changes (types, constants, storage contracts) come before behavioral changes. Behavioral changes in the most fragile function (`handleSendMessage`) come last among the critical items.

---

## Phase 0: Stabilize the Foundation
**Target state:** The simplest local agent → sidepanel box path produces verifiable, correct, trustworthy output. No silent fallbacks.

### Objective
Eliminate the silent-failure conditions that prevent any test result from being trusted:
1. The `'Local AI'` provider string must be recognized
2. A shared provider constants file must exist so this mismatch cannot recur
3. Model resolution failures must surface a visible warning

Without this phase, every subsequent test is inconclusive. The system may appear to work while running the wrong model.

### What Becomes Newly Functional
- An Agent Box configured with `Local AI` + a specific Ollama model (e.g., `llama3.2:3b`) executes with that exact model
- The Network tab shows the configured model name in the `/api/llm/chat` request payload
- When brain resolution falls back (misconfigured provider, no key, cloud unimplemented), the box output shows a visible warning instead of silent wrong-model output

### Dependencies
- None external. This is the first phase because it has no dependencies.
- Ollama must be running and at least one model installed for verification.

### Scope (what changes)
1. Create `src/constants/providers.ts` — define `PROVIDER_IDS`, `ProviderId`, and `PROVIDER_LABELS`
2. In `processFlow.ts::resolveModelForAgent` — switch on `ProviderId` constants; add `'local ai'` recognition; add typed `BrainResolutionError` return type
3. In `content-script.tsx` Agent Box dialogs — save `ProviderId` at save time, not UI label
4. In `grid-script.js` and `grid-script-v2.js` — inline provider constants (plain JS; no TypeScript import)
5. In `sidepanel.tsx::processWithAgent` — when brain resolution returns an error, write the error message to the box output; do not silently proceed

### What Should Be Tested Right After
- T0.1: Create Agent Box with `Local AI`, model `llama3.2:3b`. Send typed trigger. Verify Network tab shows `model: "llama3.2:3b"` in the request.
- T0.2: Create Agent Box with `Local AI`, model `llama3.2:3b`. Stop Ollama. Send trigger. Verify box shows error message, not empty.
- T0.3: Create Agent Box with `OpenAI`, any model. Send trigger. Verify box shows "provider not yet connected" message (or equivalent), not silent Ollama fallback.
- T0.4: Reload the sidepanel. Send trigger again. Verify same behavior — Phase 0 fix survives session reload.

### Fragility Notes
`processFlow.ts::resolveModelForAgent` is called for every agent match on every send. Any regression here is global. Test T0.1–T0.4 before proceeding to Phase 1.

---

## Phase 1: Grid Box Visibility and Live Output
**Target state:** Agent Boxes in the display grid are found by the routing engine and receive live output equivalent to sidepanel boxes.

### Objective
Resolve the structural split between sidepanel and grid box persistence. Both surfaces must write to and be read from the same canonical store. Grid pages must render output live on receiving `UPDATE_AGENT_BOX_OUTPUT`.

### What Becomes Newly Functional
- A grid Agent Box is visible to `loadAgentBoxesFromSession` at routing time
- When an agent assigned to a grid box is triggered, `updateAgentBoxOutput` finds the box
- The grid tab updates live (without page reload) when the agent's LLM output is ready
- The sidepanel box path is not broken (regression test from Phase 0)

### Dependencies
- Phase 0 complete. The grid path needs correct brain resolution to produce real output.
- Understanding of the `SAVE_AGENT_BOX_TO_SQLITE` handler in `background.ts` — the choice between Option A (also write to chrome.storage) and Option B (update `loadAgentBoxesFromSession` to read from adapter) must be made here.

### Scope (what changes)
1. **Box persistence unification** — choose one of:
   - Option A: `SAVE_AGENT_BOX_TO_SQLITE` also writes to `chrome.storage.local` (via adapter), so `loadAgentBoxesFromSession` finds it with zero read-path change
   - Option B: `loadAgentBoxesFromSession` reads from `storageWrapper` (adapter chain) instead of `chrome.storage.local` directly — aligns with how `loadAgentsFromSession` works
   - Recommendation: Option B is architecturally cleaner and doesn't duplicate write paths. Option A is safer if the adapter chain has any uncertainty. This is an implementation choice; the contract (one store, one read path) is the requirement.
2. **Add `surface` field to `CanonicalAgentBoxConfig`** — `'sidepanel' | 'grid'`; saved when box is created
3. **Grid page live handler** — in `grid-script.js` and `grid-script-v2.js`: add `chrome.runtime.onMessage.addListener` for `UPDATE_AGENT_BOX_OUTPUT`; match on `boxId`; update the slot DOM
4. **Grid session loading** — grid display pages should load session via service worker message (`GET_SESSION`), not direct Electron HTTP. This removes the third session reader.
5. **Update `OutputEvent`** — add `surface` to the message so grid pages can filter efficiently

### What Should Be Tested Right After
- T1.1: Create a grid Agent Box assigned to an agent with a typed trigger. Send the trigger from WR Chat. Verify the grid tab shows output live.
- T1.2: Sidepanel path from Phase 0 still works (regression).
- T1.3: Agent assigned to both a sidepanel box and a grid box. Send trigger. Both boxes update.
- T1.4: Close grid tab, send trigger, reopen grid tab. Verify output is present (persisted in storage, rendered on reopen).
- T1.5: Reload page. Grid box config still present and assigned correctly.

### Fragility Notes
`loadAgentBoxesFromSession` is called on every send. If Option B is chosen, the adapter chain must consistently return grid box records. Test with Electron running (SQLite path) and with Electron stopped (chrome.storage fallback path). Both must find boxes.

---

## Phase 2: OCR Before Routing
**Target state:** Image-triggered agents activate based on OCR-extracted text, not only typed text.

### Objective
Fix the sequencing error in `handleSendMessage`: OCR must run before the routing call that drives agent execution. Thread OCR results into the routing chain via `EnrichedInput`. Unify the execution loop onto the post-OCR routing result.

This is the highest-risk phase because it touches `handleSendMessage` — the most loaded function in the codebase. It must be done after Phases 0 and 1 are stable, so a clean regression baseline exists.

### What Becomes Newly Functional
- An agent with trigger keyword `invoice_total` activates when the user uploads an image containing that text (with no typed text)
- The NLP-classified routing result (`routeClassifiedInput`) drives the execution loop instead of the pre-OCR `routeInput`
- `hasImage` reflects current-turn attachments only (not full session history)

### Dependencies
- Phases 0 and 1 complete and verified. Both must be stable before touching `handleSendMessage`.
- `EnrichedInput` type defined (NB-1 from doc 07). Even a minimal definition is required as the typed carry object.
- Decision on which routing function becomes canonical (elevate `routeClassifiedInput` or extend `routeInput`).

### Scope (what changes)
1. Define `TurnInput` and `EnrichedInput` in a shared types file
2. In `handleSendMessage`:
   - Fix `hasImage` to check current-turn `imageUrls` only
   - Await `processMessagesWithOCR` before calling routing
   - Assemble `EnrichedInput` with OCR results and NLP classification
   - Call the canonical routing function with `EnrichedInput`
   - Execution loop consumes `RoutingDecision.matchedAgents` from the new routing call
3. In `InputCoordinator.ts`:
   - `evaluateAgentListener` receives `EnrichedInput`; trigger matching runs against `combinedText`
   - `routeClassifiedInput` (or the new canonical function) returns `AgentMatch[]` as the authoritative execution set
4. Retire `routeInput` (old pre-OCR call) as execution authority — keep for debugging only, clearly marked
5. Keep `ocrText` concatenated from all images (fix the race condition)

### What Should Be Tested Right After
- T2.1: Image-only input with trigger in image text → agent activates. No typed text.
- T2.2: Typed trigger (no image) → same agent activates as before Phase 2. Regression pass.
- T2.3: Text input after a session with prior images → `hasImage: false` in routing (Phase 0/1 regression pass).
- T2.4: Image + typed text with both containing trigger words → agent activates; both triggers contribute; OCR text in Network request.
- T2.5: All Phase 0 and Phase 1 tests still pass (full regression sweep).

### Fragility Notes
This is the highest-risk phase. `handleSendMessage` is 200+ lines managing message assembly, state, OCR, routing, NLP, execution, and rendering. The OCR resequencing changes the function's internal execution order. Strongly recommend:
- Implement behind a feature flag initially if the codebase supports it
- Commit Phase 0 and Phase 1 separately before starting Phase 2
- Write the Phase 2 change as a single atomic commit so it can be reverted cleanly if a regression appears

---

## Phase 3: Cloud Provider Execution
**Target state:** An Agent Box configured with a cloud provider (minimum: OpenAI) executes with the cloud model when a valid API key is present.

### Objective
Implement the cloud execution path end-to-end: API key reaches Electron; Electron dispatches to the cloud API; output returns to the box. Failure (missing key, invalid key, network error) surfaces a visible error.

This phase is the most structurally novel — it adds new code rather than fixing existing code.

### Dependencies
- Phase 0 complete (`providers.ts` constants, `BrainResolution` typed result)
- API key storage normalization: extension settings UI must write to the same store Electron reads from (the current split between `localStorage` and SQLite must be resolved as part of this phase or immediately before it)

### Scope (what changes)
1. **API key store unification**:
   - Extension settings `saveApiKeys` writes to SQLite via adapter chain (same as session data)
   - Remove `localStorage['optimando-api-keys']` as the primary key store
   - `resolveBrain` reads keys from the unified store via `ApiKeyStore` interface
2. **Electron `/api/llm/chat` extension**:
   - Add `provider` field to the request body
   - Dispatch to Ollama (existing) or cloud API based on `provider`
   - Implement minimum one cloud provider (OpenAI recommended as reference implementation)
   - Return structured error responses (not HTTP 500 or silently wrong output)
3. **`resolveBrain` completion**:
   - Add cloud key lookup
   - Add cloud-specific `LLMCallConfig` construction
   - Return typed `BrainResolutionError` for missing key, unsupported provider
4. **Provider selector gate in UI**:
   - Cloud provider options labeled "Requires API key" or gated until key is set
   - No silent Ollama fallback when cloud is selected with no key (Phase 0 warning already handles the runtime side; this is the UI side)

### What Should Be Tested Right After
- T3.1: Set OpenAI key. Create Agent Box with `OpenAI`, `gpt-4o`. Send trigger. Network tab shows call to `api.openai.com` (or Electron proxy). Box shows cloud model output.
- T3.2: Create Agent Box with `OpenAI`, no key set. Send trigger. Box shows key-missing warning. Ollama is NOT called.
- T3.3: Set OpenAI key. Make request with invalid key. Box shows API error message.
- T3.4: All Phase 0–2 tests still pass. Local path unaffected by cloud addition.
- T3.5: Both local box and cloud box assigned to different agents. Send triggers for both. Each uses its own provider.

### Fragility Notes
This phase is additive on the Electron side. The key risk is the API key store migration: users who had keys in `localStorage` before the change will lose them. Either implement a one-time migration or document that keys must be re-entered.

---

## Phase 4: Reasoning Harness Richness (Post-First-E2E)
**Target state:** Per-trigger reasoning sections (`reasoningSections[]`) are used in WR Chat. Agent context files are injected into system prompts.

### Objective
Upgrade the reasoning harness from flat `agent.reasoning` to the full schema-backed multi-section system. Wire `agentContextFiles` injection. This phase is explicitly deferred until after the first E2E test suite passes.

### What Becomes Newly Functional
- An agent configured with multiple reasoning sections uses the section corresponding to the matched trigger
- Context files uploaded to an agent appear in its system prompt as a "Reference Documents" section
- `wrapInputForAgent` → `buildSystemPrompt` is now typed against `RuntimeAgentConfig`

### Dependencies
- Phases 0–2 complete. `triggeredBy` field available from `AgentMatch` (Phase 2 output).
- Context file storage format confirmed (blob URL, base64, or plain text) before injection logic is written.

### What Should Be Tested Right After
- T4.1: Agent with two reasoning sections (different triggers). Trigger A fires → section A in system prompt. Trigger B fires → section B in system prompt.
- T4.2: Agent with context file uploaded. Send trigger. Network request system prompt contains file content in "Reference Documents" section.
- T4.3: All Phase 0–3 tests still pass.

---

## Phase Summary Table

| Phase | Objective | New Capability | Highest Risk |
|---|---|---|---|
| 0 | Stabilize brain resolution | Correct local model execution; visible errors | `resolveModelForAgent` global impact |
| 1 | Grid box equivalence | Grid boxes receive live output | Box persistence write-path change |
| 2 | OCR before routing | Image-triggered agents activate | `handleSendMessage` resequencing |
| 3 | Cloud execution | Cloud providers execute | API key migration; Electron changes |
| 4 | Reasoning harness | Per-trigger reasoning; context files | `buildSystemPrompt` used globally |

---

## Decision Checkpoint Between Phases

At the end of Phase 2, all nine test scenarios from doc 01 should be runnable. Scenarios T1–T3 (local path, OCR trigger, grid box) should pass. T4 (cloud) requires Phase 3. Before beginning Phase 3, a complete test run of T1–T3 plus all regression tests from Phase 0–2 should be documented. This is the first E2E baseline.
