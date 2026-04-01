# 18 — Flexible Implementation Blueprint

**Status:** Analysis-only. Intended as a handoff to a strong implementation model.  
**Date:** 2026-04-01  
**Basis:** All prior documents (00–17) in this analysis series.

---

## Framing

This blueprint is not a line-by-line patch plan. It provides implementation guidance at the level of phases, priorities, extension points, and caution zones. A strong model (e.g., Opus Thinking) should read this alongside the gap analysis (doc 15), risk map (doc 16), and normalization requirements (doc 17) to implement intelligently.

**Core constraint:** Each phase must leave the system in a runnable, testable state. No phase should require disabling existing features to complete.

---

## Hotfixes

Hotfixes are isolated, low-risk corrections that can be applied immediately without structural changes. Each can be verified in isolation.

### H-1: Fix Provider String Mismatch
**File:** `processFlow.ts::resolveModelForAgent`  
**Change:** Add `'local ai'` to the recognized-as-local list alongside `'ollama'`, `'local'`, `''`.  
**Risk:** Minimal. This is a string comparison fix.  
**Test:** Configure an agent box with provider `'Local AI'`, send a WR Chat message, confirm Ollama is called with the configured model name.

### H-2: Declare `providers.ts` Constant File
**New file:** `src/constants/providers.ts`  
**Change:** Define `PROVIDER_IDS` with all provider key strings used in UI selectors, storage, and runtime.  
**Risk:** Minimal. Import into `resolveModelForAgent`, grid scripts (as a copy for non-TS contexts), and `content-script.tsx` dialogs.  
**Test:** No functional change; build must pass with no new TS errors.

### H-3: Remove `hasImage` Full-History Check
**File:** `sidepanel.tsx`  
**Change:** `hasImage` in `handleSendMessage` currently scans all prior messages. Change to check only the current turn's attachments.  
**Risk:** Low. May change behavior if prior OCR is intended to re-trigger — but that is not a documented intent.  
**Test:** Image in current turn → `hasImage: true`. No image in current turn, prior image exists → `hasImage: false`.

### H-4: Surface `resolveModelForAgent` Errors to User
**File:** `sidepanel.tsx::processWithAgent`  
**Change:** When `resolveModelForAgent` returns a fallback, add a warning to the Agent Box output or console instead of silently proceeding. Do not block execution.  
**Risk:** Minimal. Purely additive.  
**Test:** Configure unsupported cloud provider → user sees "[Warning: Using fallback model — cloud not yet connected]" in box output.

---

## Medium Refactors

Medium refactors require touching 2–4 files but do not restructure the pipeline. Each improves a specific feature area.

### M-1: Move OCR Before Routing
**Files:** `sidepanel.tsx::handleSendMessage`  
**Change:** Move the `processMessagesWithOCR` call before `routeInput`. Pass `ocrText` into `routeInput` and ultimately into `evaluateAgentListener`.  
**Scope:** Requires updating `routeInput` signature to accept `ocrText?: string`, and threading it into `matchInputToAgents` → `evaluateAgentListener`.  
**Risk:** Medium. This is the most impactful single change. The call chain touches processFlow and InputCoordinator. Should be done as a discrete PR.  
**Test:** Agent with OCR-only trigger text → activates after image upload, does not activate with text-only input.

### M-2: Unify Routing to One Execution Path
**Files:** `sidepanel.tsx`, `InputCoordinator.ts`, `processFlow.ts`  
**Change:** After M-1, retire `routeInput` as the execution authority in favor of `routeClassifiedInput` (post-OCR, post-NLP). Update `processWithAgent` to consume the result of `routeClassifiedInput`.  
**Scope:** This requires `routeClassifiedInput` to return `AgentMatch[]` in the same format as `routeInput`. Currently the types differ slightly.  
**Risk:** High relative complexity. Requires careful type alignment before switching the authority.  
**Test:** Same agent/trigger test cases as M-1 must pass. Also confirm multi-agent matching still works.

### M-3: Inject `agentContextFiles` into `wrapInputForAgent`
**Files:** `processFlow.ts::wrapInputForAgent`  
**Change:** Read `agent.agentContextFiles[]`, load file content (from storage or passed content), append to system prompt as a "Reference Documents" section.  
**Scope:** 2 files, requires defining how files are stored and retrieved (path? inline blob? storage key?).  
**Risk:** Depends on file storage mechanism, which is currently unconfirmed. Resolve storage path first before implementing.  
**Test:** Agent with context file uploaded → system prompt contains file content. LLM response references it.

### M-4: Grid Box Visibility Fix
**Files:** `processFlow.ts::loadAgentBoxesFromSession`, `background.ts`, grid save paths  
**Change:** Update `loadAgentBoxesFromSession` to read from the active adapter (SQLite when Electron running) rather than `chrome.storage.local` directly.  
**Scope:** Requires `storageWrapper` to expose a `getItem` API for box records, or a new `loadAgentBoxesFromAdapter` function.  
**Risk:** Medium. Storage adapter contract change affects all box reads. Test with both Electron running and Electron not running.  
**Test:** Create box in grid dialog → routing engine finds it → output is routed to that box.

### M-5: Grid Live Output Handler
**Files:** `grid-script.js`, `grid-script-v2.js`  
**Change:** Add `chrome.runtime.onMessage` listeners in grid pages for `UPDATE_AGENT_BOX_OUTPUT`. When received, update the matching box DOM slot.  
**Scope:** 2 files, primarily additive. Requires matching the box ID from the message to a rendered slot.  
**Risk:** Low. Additive listener.  
**Test:** Run agent targeting a grid box → box updates live without page reload.

### M-6: Wire `reasoningSections[]` in WR Chat Path
**Files:** `processFlow.ts::wrapInputForAgent`, `InputCoordinator.ts::resolveReasoningConfig`  
**Change:** In `wrapInputForAgent`, call `resolveReasoningConfig` to select the correct section for the current trigger, and use that section's content as the system prompt instead of flat `agent.reasoning`.  
**Scope:** Small. `resolveReasoningConfig` already exists; just needs to be called on the WR Chat path.  
**Risk:** Low if called correctly. Requires `triggerId` or context to be available at this point.  
**Test:** Agent with two reasoning sections → correct section selected based on matched trigger.

---

## Foundational Refactors

Foundational refactors change the shape of the system. They should be planned carefully, ideally one at a time, and each requires broad testing before merging.

### F-1: Define and Thread `EnrichedInput`
**Scope:** `src/types/EnrichedInput.ts` (new), threading through `handleSendMessage`, `routeInput` → `evaluateAgentListener` → `wrapInputForAgent` → `updateAgentBoxOutput`.  
**Purpose:** Eliminate the 4–5 independent re-derivations of `hasImage`, `ocrText`, `source`, and `classified` across the pipeline.  
**Migration path:** Start by defining the type and constructing it in `handleSendMessage`. Thread it incrementally — each function that accepts a string `input` gets a parallel `enrichedInput?: EnrichedInput` parameter first, then the string version is deprecated.  
**Risk:** High surface area. Must be done before cloud provider wiring to avoid duplicating the schema problem.  

### F-2: Provider/Model Registry + Cloud Execution Skeleton
**Scope:** `providers.ts` (from H-2), Electron `/api/llm/chat` extension to support provider routing, `resolveModelForAgent` rewrite.  
**Purpose:** Make cloud model calls structurally possible. This does not need to implement all providers — it needs to define the correct abstraction (provider → API call dispatch) so individual providers can be added cleanly.  
**Migration path:** F-2 requires H-1 and H-2 as prerequisites. Electron backend must define a `CloudCallConfig` type and one reference implementation (e.g., OpenAI).  
**Risk:** Requires Electron changes. API key sync (AR-6) must be resolved at the same time or cloud calls will fail.

### F-3: Session Persistence Authority
**Scope:** `storageWrapper.ts`, `background.ts`, grid display page loading.  
**Purpose:** Define one authoritative owner for session state. All reads at routing time go through the same path.  
**Migration path:** Introduce a `SessionAuthority` singleton that wraps the adapter decision, exposes `get/set` with consistent semantics, and is used by all consumers.  
**Risk:** Broad impact. Recommended to do this before adding any new session features.

### F-4: API Key Normalization
**Scope:** `content-script.tsx` (saveApiKeys), Electron `main.ts` (getAvailableModels), `storageWrapper.ts`.  
**Purpose:** Define one API key store accessible to both extension and Electron. Eliminate the localStorage / SQLite split.  
**Migration path:** Recommended approach: extension writes keys to SQLite via the proxy adapter. Electron reads from SQLite directly. Remove `localStorage['optimando-api-keys']` as the primary store.  
**Risk:** Breaking change for users who set keys before migration. Requires migration logic or key re-entry.

---

## Recommended Implementation Order

```
Phase 1 — Immediate stability (no pipeline changes)
  H-1  Fix 'Local AI' provider string
  H-2  Declare providers.ts constants
  H-3  Fix hasImage to current-turn only
  H-4  Surface model resolution warnings

Phase 2 — OCR and routing correctness (pipeline reorder)
  M-1  Move OCR before routeInput
  M-2  Unify routing to post-OCR path (depends on M-1)
  M-5  Add grid live output handlers (independent, safe)

Phase 3 — Box visibility and output routing
  M-4  Fix grid box visibility (depends on F-3 or interim adapter fix)
  M-5  Already done in Phase 2

Phase 4 — Reasoning harness richness
  M-6  Wire reasoningSections[] to WR Chat path
  M-3  Inject agentContextFiles (depends on storage path confirmation)

Phase 5 — Foundational normalization
  F-1  Define and thread EnrichedInput
  F-3  Session persistence authority
  F-4  API key normalization

Phase 6 — Cloud execution
  F-2  Provider/model registry + cloud call skeleton
       (depends on F-1, F-4, H-1, H-2)
```

---

## Fragile Areas Where Patching Is Risky

### FA-1: `resolveModelForAgent` (processFlow.ts)
This function currently produces silent fallbacks for every misconfigured case. Any change that adds a new provider string or changes the fallback logic will affect all cloud agents globally. **Do not patch this incrementally — rewrite it against `providers.ts` in one shot (H-1 + F-2).**

### FA-2: `loadAgentBoxesFromSession` (processFlow.ts)
This function reads `chrome.storage.local` directly, bypassing the adapter. Changing it to use the adapter will change behavior for all box reads. **Test with both Electron running and not running.** Grid boxes depend on this becoming correct before M-5 will do anything useful.

### FA-3: `handleSendMessage` (sidepanel.tsx, ~line 2813)
This is the most heavily loaded function in the pipeline. It manages message assembly, OCR, routing, agent loop, NLP classification, event-tag routing, and output. **Any change to execution order risks breaking orthogonal features.** M-1 (OCR timing) is the highest-risk change in the entire blueprint — implement it behind a feature flag if possible.

### FA-4: `wrapInputForAgent` (processFlow.ts)
This assembles the LLM system prompt. Any changes here affect output quality for all agents globally. M-3 (context file injection) and M-6 (multi-section reasoning) both touch this function. **Implement them sequentially, not in parallel.**

### FA-5: Grid Scripts (`grid-script.js`, `grid-script-v2.js`)
These are plain-JS files loaded in Chromium extension page contexts. They share no module system with TypeScript source. Provider constants from `providers.ts` cannot be imported directly — they must be duplicated or inlined. **Any refactor that requires cross-file type sharing will require a build step or a shared JSON constant file.**

---

## Best Extension Points

| Feature to Add | Best Extension Point |
|---|---|
| New cloud provider | `providers.ts` (add constant) + Electron `/api/llm/chat` dispatch + `resolveModelForAgent` switch |
| New listening source type | `evaluateAgentListener` (InputCoordinator.ts) — add source check after `applyFor` check |
| WR Experts / context files | `wrapInputForAgent` — add "Reference Documents" block before user input |
| Agent output streaming | `updateAgentBoxOutput` — add `status: 'streaming'` field + partial content updates |
| New execution destination | Define `OutputTarget` type, add new case in `updateAgentBoxOutput` routing |
| Session import/export | `storageWrapper.ts` — add `exportSession()` / `importSession()` above the adapter layer |
| Multi-agent fan-out | `matchInputToAgents` return → loop already exists in `processWithAgent`, just ensure all matched agents fire |

---

## What Should Be Tested After Each Phase

**Phase 1:**
- Local agent with Local AI provider activates and calls correct Ollama model
- Warning appears in box output when fallback is used
- `hasImage` is false for text-only input

**Phase 2:**
- Image-only input with OCR-extractable trigger → correct agent activates
- Text-only input → OCR is not called (no regression)
- Grid box shows live output when routing sends to it (with M-5 done)

**Phase 3:**
- Grid box created in grid dialog → appears in routing engine's box list
- Agent assigned to grid box → output appears in grid without page reload

**Phase 4:**
- Agent with two reasoning sections → logs or output shows which section was selected
- Agent with context file → system prompt contains file content

**Phase 5 (regression test):**
- Full WR Chat flow with local agent → all Phase 1–4 features still work
- Session save/reload → box configurations survive
- Agent matching still works with EnrichedInput threading

**Phase 6:**
- Cloud agent with valid API key → cloud API is called (not Ollama fallback)
- Cloud agent without API key → clear error, not silent fallback
