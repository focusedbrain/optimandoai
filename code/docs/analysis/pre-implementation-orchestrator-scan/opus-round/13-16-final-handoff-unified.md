# Opus Round — Final Handoff Package (docs 13–16)

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Package:** Opus Round Prompts 1–4, final deliverable  
**Contains:** docs 13, 14, 15, 16  
**Prior packages:** 00 (Opus Round Unified), 06-08 (Runtime Contracts), 09-12 (Implementation Map)

---

> This is the implementation handoff package. It combines the final blocker list, recommended implementation order, dangerous false assumptions, and the brief a coding model uses as the starting point for real work.
>
> These four documents are meant to be read as a unit. Implement in the sequence defined in doc 14. Do not skip the false assumptions review in doc 15 — it prevents the most common class of wasted implementation effort on this codebase.

---

# Part I — Final Blocker Summary (doc 13)

**Purpose:** The definitive list of true blockers. Everything on this list prevents the first end-to-end orchestrator test from being valid or complete.

---

## Definition of a True Blocker

A true blocker is a condition where the system either:
- produces wrong output silently (no error, wrong behavior — test results are invalid), or
- produces no output where output is expected (feature structurally absent), or
- makes a structural assumption that is false (a path that appears wired but isn't)

Items that produce degraded output but still surface a visible result are not blockers — they are gaps for later passes.

---

## Blocker 1: `'Local AI'` Provider Not Recognized at Runtime
**Type:** Silent wrong output  
**Severity:** Critical — invalidates every local model test

**What happens:** UI saves box provider as `'Local AI'`. `resolveModelForAgent` in `processFlow.ts` recognizes `'ollama'`, `'local'`, `''` — not `'local ai'` (lowercased). Every Agent Box configured with `Local AI` provider silently executes the hardcoded fallback model instead of the configured model. The box populates with output. The output is from the wrong model. There is no error.

**Why it's a blocker and not a gap:** No test result involving a local model can be attributed to the configured model until this is fixed. The system appears to work; it is working — just with the wrong model. All test conclusions are invalid.

**Code location:** `processFlow.ts::resolveModelForAgent` lines 1210–1245  
**Fix type:** Hotfix + provider constants file

---

## Blocker 2: No Cloud Provider Execution Path
**Type:** Feature structurally absent  
**Severity:** Critical — cloud tests cannot run

**What happens:** `resolveModelForAgent` hits "API not yet connected" for all cloud providers. `processWithAgent` posts to Electron `/api/llm/chat` which is Ollama-only. When a cloud brain is configured, the system silently falls back to local Ollama (if local is available) or produces an error. No cloud API is called regardless of which provider or model is configured.

**Why it's a blocker:** Cloud provider execution is a stated requirement for the first E2E tests. It is not a missing feature that can be observed and accepted — it makes T4 (cloud model test) impossible to run.

**Code location:** `processFlow.ts::resolveModelForAgent`; Electron `main.ts` `/api/llm/chat`  
**Fix type:** Structural refactor (Electron dispatch + provider registry)

---

## Blocker 3: API Key Split-Brain (Extension vs Electron)
**Type:** Structural false assumption  
**Severity:** Critical — blocks cloud execution even when B2 is fixed

**What happens:** Extension settings UI saves API keys to `localStorage['optimando-api-keys']`. Electron backend reads keys from its SQLite orchestrator store. These two stores have no confirmed sync path. A user who sets an OpenAI key in the extension UI will have it in `localStorage` but not in the SQLite store that Electron checks.

**Why it's a blocker:** Blocker 2 (cloud execution) cannot work correctly even after the dispatch path is built, because the API key will not reach the Electron backend from the canonical location.

**Code location:** `content-script.tsx::saveApiKeys` → `localStorage`; Electron `main.ts::handshake:getAvailableModels` → SQLite  
**Fix type:** Medium refactor (unify key store)

---

## Blocker 4: Display-Grid Boxes Invisible to Routing Engine
**Type:** Structural false assumption (routing blind spot)  
**Severity:** Critical — all grid box tests produce no output

**What happens:** `loadAgentBoxesFromSession` in `processFlow.ts` reads `chrome.storage.local` only. Grid boxes are saved via `SAVE_AGENT_BOX_TO_SQLITE` — directly to SQLite, bypassing `chrome.storage`. The routing engine literally cannot see grid boxes. `findAgentBoxesForAgent` returns no matches for grid-configured agents. Output delivery has no destination. Silent drop.

**Why it's a blocker:** Grid box equivalence is a product requirement for the first tests. Currently, no amount of correct configuration of a grid Agent Box will produce output. The routing engine is blind to its existence.

**Code location:** `processFlow.ts::loadAgentBoxesFromSession`; `background.ts` `SAVE_AGENT_BOX_TO_SQLITE` handler  
**Fix type:** Medium refactor (box persistence unification)

---

## Blocker 5: Grid Pages Have No Live Output Handler
**Type:** Feature structurally absent for grid surfaces  
**Severity:** Critical — grid output delivery incomplete even after Blocker 4 is fixed

**What happens:** When output is delivered, `updateAgentBoxOutput` sends `UPDATE_AGENT_BOX_OUTPUT` via `chrome.runtime.sendMessage`. The sidepanel has a handler (`setAgentBoxes` React state update). Grid pages (`grid-script.js`, `grid-script-v2.js`, `grid-display.js`) have no equivalent handler. Even if Blocker 4 is resolved (routing finds the grid box, writes output to storage), the grid DOM is never updated. The user must reload the grid page to see the output — if they ever do.

**Why it's a blocker:** Grid equivalence requires live output. A grid page that must be reloaded to show output is not equivalent to a sidepanel box.

**Code location:** `grid-script.js`, `grid-script-v2.js`, `grid-display.js` (no `UPDATE_AGENT_BOX_OUTPUT` handler)  
**Fix type:** Medium refactor (additive listener)

---

## Blocker 6: OCR Runs After Routing Decision
**Type:** Sequencing error — wrong output for image triggers  
**Severity:** Critical — all image-triggered agent activations fail silently

**What happens:** `routeInput` (the authoritative routing call) runs at `sidepanel.tsx:2925`. `processMessagesWithOCR` runs at line 2943, 18 lines later. Any trigger that only appears in OCR-extracted text (from an uploaded image) is never found by the routing engine. The agent does not activate. The LLM message does receive the OCR text — but the routing decision is already final.

The correct OCR-aware routing code already exists: `routeClassifiedInput` at line 2983 sees OCR-enriched input and produces correct agent allocations. But its result is wired to a console.log, not the execution loop.

**Why it's a blocker:** OCR-aware routing is explicitly part of the product goal for the first tests. An image-only trigger is a core scenario. Without this fix, every image-based agent activation silently fails.

**Code location:** `sidepanel.tsx::handleSendMessage` lines 2925, 2943; line 2992 (discarded result)  
**Fix type:** Foundational refactor (OCR resequencing + routing authority change)

---

## Blocker 7: No Shared Provider/Model Identity Constants
**Type:** Architectural drift source  
**Severity:** High — not immediately breaking but causes Blocker 1 to recur for every new provider

**What happens:** There is no canonical source of provider identity strings. The UI uses `'Local AI'`, `'OpenAI'`, etc. The runtime uses `'ollama'`, `'openai'`, etc. This mismatch caused Blocker 1. Without a shared constants file, implementing cloud providers (Blocker 2 fix) will immediately create the same mismatch for cloud strings.

**Why it's a blocker:** Building Blocker 2's fix without this creates the next mismatch immediately. Blocker 1 must be fixed with this, not without it.

**Code location:** `processFlow.ts::resolveModelForAgent` (string comparisons); all UI box dialogs (label storage)  
**Fix type:** Hotfix (new constants file)

---

## Blocker Summary Table

| # | Blocker | Type | Severity | Fix Type |
|---|---|---|---|---|
| 1 | `'Local AI'` not recognized at runtime | Silent wrong output | Critical | Hotfix + constants |
| 2 | No cloud execution path | Feature absent | Critical | Structural refactor |
| 3 | API key split-brain | False structural assumption | Critical | Medium refactor |
| 4 | Grid boxes invisible to routing | Routing blind spot | Critical | Medium refactor |
| 5 | No grid live output handler | Feature absent | Critical | Medium refactor (additive) |
| 6 | OCR runs after routing | Sequencing error | Critical | Foundational refactor |
| 7 | No provider identity constants | Drift source | High | Hotfix |

---

## What Is NOT a Blocker (for First E2E)

These are real gaps but do not prevent a valid first E2E test:

- `reasoningSections[]` not wired — flat reasoning works for first tests
- `agentContextFiles` not injected — first tests don't use context files
- `memorySettings` not consumed — first tests don't test memory
- `executionMode` not branched — single box output is the only behavior needed
- `listening.sources[]` not evaluated — first tests use keyword triggers only
- `acceptFrom` not evaluated — single-agent scenarios for first tests
- Session schema versioning absent — no schema changes planned in this pass
- Account-scoped agent storage path unconfirmed — first tests use session-scoped agents
- `hasImage` full-history scan — causes false positives but doesn't prevent correct agent activation

These items must be addressed but can wait until after the first E2E baseline is established.

---

# Part II — Recommended Implementation Order (doc 14)

**Purpose:** The recommended implementation sequence with rationale. Not patch instructions. The what and why, not the how.

---

## Framing

The ordering principle is: **each step produces a verifiable baseline that the next step depends on.** Implementation that skips ahead to a harder problem before easier ones are proven creates ambiguous failure modes — you can't tell if the hard problem is broken or if a prerequisite was missed.

A secondary principle: **changes to the most fragile function (`handleSendMessage`) come after all other changes are stable.** This function is the highest-risk point in the codebase. It should be touched last among the critical items, not first.

---

## Step 1: Provider Identity Foundation
**Priority: Highest — do before everything else**

Create a shared provider constants file (`providers.ts`). Define `PROVIDER_IDS` (the runtime strings), `PROVIDER_LABELS` (UI display strings), and a `toProviderId(uiLabel)` conversion function.

**Rationale:** Every other provider-related fix depends on having canonical strings. Fixing the `'Local AI'` bug (Step 2) without this produces a one-off string patch that will be bypassed for the next provider. Building cloud execution (Step 5) without this creates new string mismatches immediately. This step costs almost nothing — it's a new file with constants — and it makes every subsequent step architecturally sound.

**What this enables:** Steps 2, 5, and 6 all depend on having `ProviderId` constants.

**Validation:** TypeScript compilation passes. Constants are importable in TypeScript files. The constants object is duplicated or inlined in the plain-JS grid scripts.

---

## Step 2: Fix Local Provider String Recognition
**Priority: Highest — implement immediately after Step 1**

Update `resolveModelForAgent` to recognize `'Local AI'` (stored as `'ollama'` after Step 1's save-time conversion) as the local Ollama provider. Switch the resolution logic from ad-hoc string comparisons to switch-on-ProviderId from the constants file.

Alongside this: update the Agent Box save path in the content-script and grid scripts to store `ProviderId` (e.g., `'ollama'`) rather than the UI display label (`'Local AI'`). The conversion happens at save time using `toProviderId()` from Step 1.

**Rationale:** This is the single most impactful change for establishing a valid test baseline. Until this is done, no local model test can be trusted. The configured model never runs — a fallback model does. All test output is from the wrong model. No subsequent test result is meaningful while this is broken.

**What this enables:** All local model tests (A1–A4 in the test matrix). First verifiable baseline.

**Validation:** Create an Agent Box with `Local AI` and `llama3.2:3b`. Send a trigger. Network tab shows `"model": "llama3.2:3b"` in the `/api/llm/chat` request body. Not the fallback model.

---

## Step 3: Surface Brain Resolution Failures Visibly
**Priority: High — implement alongside or immediately after Step 2**

When `resolveModelForAgent` (or the new `resolveBrain` function) fails — wrong provider, no key, cloud not implemented, Ollama not running — write a visible message to the Agent Box output. Do not silently proceed.

**Rationale:** Without visible failure messages, test failures caused by misconfiguration are indistinguishable from test failures caused by bugs. A developer who sees an empty box cannot tell whether the agent didn't activate, the model resolution failed, the LLM call failed, or the output delivery failed. Visible error messages in the box make every other failure mode diagnosable. This is a debugging affordance, not a feature.

**What this enables:** Unambiguous test result interpretation for all subsequent steps.

**Validation:** Configure a box with `OpenAI` and no API key. Send a trigger. Box shows an error message — not empty, not a wrong-model response.

---

## Step 4: Grid Box Persistence Unification
**Priority: High — implement after Steps 1–3 are verified**

Make grid Agent Boxes visible to the routing engine. The core requirement: `loadAgentBoxesFromSession` must be able to return boxes that were saved from grid dialogs. Currently, grid boxes go to SQLite only; `loadAgentBoxesFromSession` reads `chrome.storage.local` only — a structural blind spot.

Implementation choice (both valid):
- **Option A:** Grid box saves also write to `chrome.storage.local` via the adapter chain, so the existing read path finds them
- **Option B:** `loadAgentBoxesFromSession` reads from the `storageWrapper` active adapter (SQLite when Electron runs), same as `loadAgentsFromSession` already does

Choose Option B if the adapter chain is well-understood and reliably consistent. Choose Option A if the adapter introduces uncertainty and you want to minimize the read-path change.

Additionally: grid display pages must load session state through the service worker proxy (a `GET_SESSION` message), not via direct Electron HTTP. This removes the third session reader and aligns grid session loading with the rest of the system.

**Rationale:** Grid box equivalence is a product requirement. Without this step, no grid test can produce output regardless of all other fixes. This is a structural blind spot — the routing engine is simply unaware that grid boxes exist.

**What this enables:** Steps 5 and all grid test scenarios (D1, D3, G4).

**Validation:** Create a grid Agent Box. Check that `loadAgentBoxesFromSession` returns it (add a temporary console log). The session storage should show the box in the adapter-resolved store.

---

## Step 5: Grid Live Output Handler
**Priority: High — implement immediately after Step 4**

Add a `chrome.runtime.onMessage` handler in the grid scripts for `UPDATE_AGENT_BOX_OUTPUT`. When received with a matching `boxId`, update the DOM slot. Grid pages must know their box IDs at render time — the box ID must be written to the DOM or registered in a local map during box render.

**Rationale:** Step 4 makes routing find the box. Step 5 makes the output land in the DOM. Without both, grid box equivalence is still not functional. Step 5 is additive — it adds a new listener and a DOM update. It does not change any existing path.

**What this enables:** Grid boxes updating live without page reload. T1.1, T1.3, D1, D3 in the test matrix.

**Validation:** After Step 4 + Step 5: trigger an agent assigned to a grid box from WR Chat. The grid tab updates live. Network tab shows the LLM call. Grid DOM shows the output.

---

## Step 6: Define `TurnInput` and `EnrichedInput` Types
**Priority: High — implement before touching `handleSendMessage`**

Define the canonical typed input carrier. `TurnInput` holds the current-turn facts (rawText, imageUrls scoped to this turn, hasImage, sourceType, timestamp). `EnrichedInput` extends it with OCR results, concatenated ocrText, NLP classification result, and combinedText.

**Rationale:** This is the prerequisite for Step 7. Moving OCR before routing in `handleSendMessage` (Step 7) without a typed object to carry the result is cosmetic — the raw `ocrText` variable still exists, the same ad-hoc threading still exists, and the fix is fragile. With `EnrichedInput`, the type system enforces that routing always receives an enriched input. The routing function's input type becomes `EnrichedInput`, not `string`. A caller cannot accidentally pass pre-OCR data.

**What this enables:** Step 7 (OCR resequencing) and Step 8 (routing authority). Both require a typed input contract.

**Validation:** TypeScript compilation passes. `handleSendMessage` constructs a `TurnInput` object before the OCR call.

---

## Step 7: OCR Resequencing in `handleSendMessage`
**Priority: Critical — highest-risk change, must be last among critical items**

Move `processMessagesWithOCR` before the routing call in `handleSendMessage`. Await OCR. Concatenate all image results into `EnrichedInput.ocrText`. Fix `hasImage` to check only the current turn's images. Pass `EnrichedInput` to the routing function.

**This is the highest-risk change in the entire implementation.** `handleSendMessage` is the most loaded function in the codebase — it manages message assembly, state, OCR, routing, NLP, the agent execution loop, and rendering. Changing its internal execution order can break any of these orthogonal concerns. It should only be touched after Steps 1–6 are stable and fully tested, providing a clean regression baseline.

**Rationale:** OCR-aware routing is a core product requirement. Without this step, no agent configured to activate on image content will ever activate via WR Chat. The correct routing logic already exists — `routeClassifiedInput` produces the right result with OCR-enriched input. Step 8 wires it. Step 7 puts the OCR in the right place.

**What this enables:** Image-triggered agent activation. All OCR test scenarios (E1–E3).

**Validation:** Upload an image with a trigger keyword. No typed text. Agent activates. Console shows OCR ran before routing.

---

## Step 8: Routing Authority Unification
**Priority: Critical — implement immediately after Step 7**

Make the post-OCR+NLP routing computation (`routeClassifiedInput` or a renamed equivalent) the sole authority for which agents execute. The execution loop in `handleSendMessage` must consume this result instead of the pre-OCR `routeInput` result.

The pre-OCR `routeInput` call is either removed from the execution path or demoted to a diagnostic-only log. It must not drive agent execution after this step.

**Rationale:** Step 7 puts OCR before routing. Step 8 makes the execution loop use the routing result that was computed with OCR. Without Step 8, OCR runs earlier but the execution loop still iterates the old pre-OCR routing result. The fix is sequentially incomplete without both steps.

**What this enables:** The routing result that drives execution now has OCR and NLP input. Trigger matching can fire on OCR-extracted text.

**Validation:** Same as Step 7 tests. Additionally: confirm the old `routeInput` is no longer in the execution path (console log showing it still being used for execution would be a regression).

---

## Step 9: API Key Store Unification
**Priority: Medium — implement before cloud execution**

Extension settings UI must write API keys to the same store that Electron reads from. The current split (localStorage for extension, SQLite for Electron) means cloud API calls will fail with key-not-found errors even after the cloud dispatch path is built.

This requires: the extension key save path writes to SQLite via the adapter chain; Electron reads from SQLite (already does); the old localStorage key store is deprecated (with a one-time migration or re-entry requirement noted for existing users).

**Rationale:** Cloud execution (Step 10) is the most complex implementation step. Building it before the key store is unified guarantees that T3.1 (cloud model with valid key) will fail for a separate reason. Debugging a cloud execution failure when the key store is also broken is extremely difficult.

**What this enables:** Step 10. Cloud execution becomes testable with valid key.

**Validation:** Set an API key in extension settings. Inspect SQLite: key present under `api_key_openai`. Reload. Key still present.

---

## Step 10: Cloud Provider Execution (One Provider First)
**Priority: Medium — implement after Steps 1–9 are stable**

Add cloud API dispatch to the Electron backend. Implement one provider as the reference (OpenAI recommended). The extension sends `provider`, `model`, `messages`, and `apiKey` in the LLM chat request. Electron routes to the correct API based on `provider`.

Build from the `ProviderId` constants (Step 1). Each additional cloud provider is one dispatch case — no new string matching.

**Rationale:** Cloud execution is the most structurally novel work in the implementation — it adds new code paths rather than fixing existing ones. It should come after all fixes to the local path are confirmed working. A regression on the local path during cloud implementation would be very hard to isolate.

**What this enables:** T3.1 (cloud model with valid key). Cloud provider agents functional.

**Validation:** OpenAI Agent Box, valid key. Network tab shows call to `api.openai.com` (or Electron proxy). Box shows cloud model output.

---

## Recommended Order Summary

```
1. Create providers.ts constants (foundation for all provider work)
2. Fix local provider string + save-time ProviderId conversion (valid local baseline)
3. Surface brain resolution failures (debuggable test results)
4. Grid box persistence unification (routing engine finds grid boxes)
5. Grid live output handler (grid DOM updates live)
6. Define TurnInput + EnrichedInput types (prerequisite for OCR sequencing)
7. OCR resequencing in handleSendMessage (HIGHEST RISK — do after 1–6 stable)
8. Routing authority unification (consume OCR-enriched routing result)
9. API key store unification (prerequisite for cloud execution)
10. Cloud provider execution — one provider first
```

**Mandatory checkpoints:**
- After Step 3: run A1–A4 test scenarios. All must pass before proceeding.
- After Step 5: run D1, D3 test scenarios. Grid equivalence must be confirmed before touching handleSendMessage.
- After Step 8: run full test suite (A1–A4, D1, D3, E1–E3). This is the first E2E baseline. Document results before proceeding to Step 9.
- After Step 10: run B1–B3 test scenarios.

---

# Part III — Dangerous False Assumptions (doc 15)

**Purpose:** The false assumptions an implementation model will make if it reads the UI, the schema, or the codebase surface without reading the confirmed-behavior analysis. Each one will cause a developer to build in the wrong place, trust the wrong component, or ship a feature that silently doesn't work.

---

## FA-1: A Visible UI Control Is Runtime-Backed

**The assumption:** If a user can interact with a control — toggle it, type into it, upload to it — then the control influences the system's behavior.

**Why it's false:** The following controls are fully visible, fully interactive, and have zero runtime effect:
- Memory settings toggles (`memorySettings.sessionEnabled`, `accountEnabled`, `agentEnabled`)
- Context file upload (`agentContextFiles[]`)
- Context settings toggles (`contextSettings.agentContext`, `sessionContext`, `accountContext`)
- `listening.sources[]` (source type selector: voice, screenshot, DOM, etc.)
- `acceptFrom` (agent chaining field)
- `executionMode` selector (4 modes: `agent_workflow`, `direct_response`, `workflow_only`, `hybrid`)
- Non-box execution destinations (email, webhook, storage, notification)
- Multi-section reasoning tabs (if separately configurable in UI)
- Platform flags (desktop/mobile)

All of these are saved to the session blob. None are read by `wrapInputForAgent`, `evaluateAgentListener`, `resolveModelForAgent`, or any part of the execution loop.

**Consequence if assumed true:** A developer adds a small runtime hook for `memorySettings.sessionEnabled` and believes memory is "wired" — but the hook reads a flag that has never had an effect, and the output is identical whether the toggle is on or off. The feature appears to work in testing because LLM outputs are non-deterministic.

**Ground truth:** Read `processFlow.ts::wrapInputForAgent` (lines 1089–1132). Count the fields it actually reads: `role`, `goals`, `rules`, `custom` key-value pairs, raw `input`, `ocrText`. Nothing else.

---

## FA-2: The Display-Grid Agent Box Is the Same as a Sidepanel Agent Box at Runtime

**The assumption:** Both use `CanonicalAgentBoxConfig`. The schema is identical. They must behave the same way.

**Why it's false:**
- Grid boxes are saved via `SAVE_AGENT_BOX_TO_SQLITE` → SQLite only. NOT to `chrome.storage.local`.
- `loadAgentBoxesFromSession` reads `chrome.storage.local` only. It never sees grid boxes.
- Grid pages have no handler for `UPDATE_AGENT_BOX_OUTPUT`. Output delivered to a grid box's `boxId` is written to storage but never rendered.
- Grid session loading bypasses the storage proxy and goes directly to Electron HTTP.

**Consequence if assumed true:** A developer wires output delivery to a grid Agent Box. They verify that `updateAgentBoxOutput` runs and writes to storage. They check the storage blob and confirm the output is there. They declare grid output "working." The grid page never updates because it has no handler and loads from a different path.

**Ground truth:** The schema is identical. The operational reality is entirely different. Three separate structural issues must all be resolved: write-path unification, read-path alignment, and a new grid message handler.

---

## FA-3: A Provider Shown in the Dropdown Is an Executable Provider

**The assumption:** The Agent Box dialog shows `Local AI`, `OpenAI`, `Anthropic`, `Gemini`, `Grok`. Selecting any of these and configuring a model means that provider can execute.

**Why it's false:**
- `resolveModelForAgent` hits "API not yet connected" for ALL cloud providers.
- `processWithAgent` always posts to Electron `/api/llm/chat` — which is Ollama-only.
- `'Local AI'` is not recognized by `resolveModelForAgent` (it falls through to the fallback model).
- The cloud provider entries in the dropdown are aspirational UI, not functional pathways.

**Consequence if assumed true:** A developer adds an API key for Anthropic, configures a Claude model, triggers the agent, sees the box populate with output — and believes Anthropic ran. The output is from the Ollama fallback model. The developer ships with confidence that cloud execution works.

**Ground truth:** The ONLY currently functional execution path is: box.provider recognized as local (which currently requires `'ollama'`, `'local'`, or `''`) + Electron Ollama running + model installed. Every other combination silently falls back.

---

## FA-4: OCR Text Participates in Routing

**The assumption:** The user uploads an image. OCR runs. The extracted text is combined with the typed text. Routing uses this combined text to match agents.

**Why it's false:** `routeInput` (the authoritative routing call) runs at `sidepanel.tsx:2925`. `processMessagesWithOCR` runs at line 2943. The routing decision is final before OCR text is available. OCR-enriched routing (`routeClassifiedInput`) exists and runs with combined text — but its result is wired to `console.log` at line 2992, not to the execution loop.

**Consequence if assumed true:** A developer tests OCR routing. They upload an image with trigger text. They see the OCR text in the message history. They see `routeClassifiedInput` called with the right combined text in the console. They see correct agent allocations in the console log. They conclude OCR routing works. It doesn't — the console output is from a discarded secondary routing computation. The execution loop uses the pre-OCR result.

**Ground truth:** OCR enriches the LLM message content. It enriches the system prompt (`ocrText` is appended in `wrapInputForAgent`). It does NOT enrich the routing decision that activates agents. An agent with a trigger keyword that only appears in an uploaded image will never activate via WR Chat.

---

## FA-5: A Saved API Key Can Execute a Cloud Model

**The assumption:** The user opens extension settings, enters an OpenAI API key, saves it. The system now has the key. Cloud models will work.

**Why it's false:**
1. The extension saves keys to `localStorage['optimando-api-keys']` (a browser localStorage entry in the extension context).
2. The Electron backend reads keys from its SQLite orchestrator store (`handshake:getAvailableModels` uses this path).
3. There is no confirmed synchronization between these two stores.
4. Even if the key were correctly synced, cloud execution is not implemented — `resolveModelForAgent` returns "API not yet connected" for all cloud providers.

**Consequence if assumed true:** A developer confirms the API key is saved (inspects `localStorage`). Implements the cloud dispatch path in Electron. Tests by triggering a cloud agent. Electron looks for the key in SQLite. It's not there. The call fails. The developer debugs the cloud dispatch code — the real problem is the key store split.

**Ground truth:** Setting an API key in the extension UI has no confirmed effect on any LLM execution path. The key is stored in a store that the runtime doesn't read.

---

## FA-6: The Routing Result in the Console Is the Routing Result That Drove Execution

**The assumption:** The console logs show detailed routing output — matched agents, agent allocations, resolved destinations. This is what ran.

**Why it's false:** There are three routing computations per WR Chat send:
1. `routeInput(rawText)` at line 2925 — pre-OCR, pre-NLP — **drives execution**
2. `routeClassifiedInput(classified)` at line 2983 — post-OCR+NLP — **logged only**
3. `routeEventTagInput(inputText)` at line 3015 — post-OCR+NLP — **logged only**

The console shows detailed output from computations 2 and 3 (they produce richer, more structured output). Computation 1 drives execution but logs less detail. A developer reading the console will see what appears to be a complete, accurate routing trace — and it is accurate, but it is the trace of the computation whose result is discarded.

**Consequence if assumed true:** A developer sees "matched agents: [OcrAgent, TextAgent]" in the console from `routeClassifiedInput`. They believe both agents executed. Only the agents matched by `routeInput` (computation 1, pre-OCR) actually ran. If `OcrAgent` only matches due to OCR text, it's in the console but not in the actual execution. The developer concludes the orchestrator is working when it isn't.

**Ground truth:** The only routing result that matters for execution is `routingDecision.matchedAgents` at line 3058 — derived from computation 1. Filter console logs for this specific variable to understand what actually ran.

---

## FA-7: Agent Configuration That Is Saved Is Configuration That Works

**The assumption:** If saving the agent form succeeds and the session contains the right values, the agent will behave according to that configuration.

**Why it's false:** The save path writes to `chrome.storage.local` (via adapter). The routing path reads from `chrome.storage.local` for boxes but from SQLite for agents (`loadAgentsFromSession`). If the adapter is SQLite (when Electron is running), agent saves go to SQLite. But `loadAgentBoxesFromSession` reads from `chrome.storage.local` directly — a different store.

Additionally: agent config is stored as raw stringified JSON per tab (`agent.config['instructions'] = '{"role":"..."}'`). Normalization to `CanonicalAgentConfig` happens at export/routing boundaries. If the stringification or the parse fails silently, the agent config is lost between save and routing.

**Consequence if assumed true:** A developer saves an agent with a new role. Triggers the agent. The old role appears in the system prompt. The developer assumes `wrapInputForAgent` has a bug. The actual issue is that the session read at routing time is from a different adapter (or a cached session) than the one the save wrote to.

**Ground truth:** Verify the round-trip: save agent → trigger → inspect Network request system prompt. Confirm the system prompt contains the value that was saved in the most recent config. If it doesn't, the storage adapter path has inconsistency.

---

## FA-8: `findAgentBoxesForAgent` Will Always Find the Right Box

**The assumption:** The box is configured correctly, the `agentNumber` matches, the session contains the box. `findAgentBoxesForAgent` will return it.

**Why it's false:** `findAgentBoxesForAgent` searches the boxes array returned by `loadAgentBoxesFromSession`. If `loadAgentBoxesFromSession` read from the wrong store (chrome.storage.local when the box is in SQLite), the boxes array is empty or incomplete. The function returns no matches. `AgentMatch.agentBoxId` is `null`. Output delivery has no destination. Silent drop.

**Consequence if assumed true:** A developer verifies the box configuration looks correct in the UI. Triggers the agent. Box is empty. They check `updateAgentBoxOutput` — it runs but returns `false` (box not found). They check `findAgentBoxesForAgent` — it returns no matches. They add logging and see the boxes array is empty or doesn't contain their box. They conclude there's a bug in box finding. The real issue is upstream: the box was never loaded into the array.

**Ground truth:** Before debugging `findAgentBoxesForAgent`, always verify the input it receives. Log the `agentBoxes` array at the routing call site. If the array is empty or missing the expected box, the problem is in `loadAgentBoxesFromSession`, not in `findAgentBoxesForAgent`.

---

## FA-9: The Schema Field That Exists Is the Feature That Works

**The assumption:** `CanonicalAgentConfig` has `reasoningSections[]`, `agentContextFiles[]`, `memorySettings`, `contextSettings`. These are part of the schema. The system must implement them.

**Why it's false:** Schema presence does not imply runtime consumption. The schema was designed ahead of implementation. The runtime is behind the schema. Fields that exist on the schema and are persisted through the form have no guaranteed runtime consumer.

The confirmed consumed fields in the WR Chat execution path are: `agent.role`, `agent.goals`, `agent.rules`, `agent.reasoning` (flat), `listening.triggers[]`, `listening.website`, `listening.expectedContext`, `listening.applyFor`. Everything else on `CanonicalAgentConfig` is schema-only or form-only.

**Consequence if assumed true:** A developer reads the schema, sees `reasoningSections[]`, assumes per-trigger reasoning is implemented, and builds on top of it. The build looks correct because the schema is correct. Runtime behavior is unchanged because nothing reads `reasoningSections[]` in the WR Chat path.

**Ground truth:** The ground truth is `processFlow.ts::wrapInputForAgent` (what it reads), `InputCoordinator.ts::evaluateAgentListener` (what it evaluates), and `processFlow.ts::resolveModelForAgent` (what it resolves). Everything else on the schema is aspirational until explicitly confirmed consumed.

---

## FA-10: Multi-Agent Chaining via `acceptFrom` Is Active

**The assumption:** Agent B has `acceptFrom: ['agent-a']`. When Agent A produces output, it triggers Agent B via the `acceptFrom` handoff.

**Why it's false:** `acceptFrom` is defined on `CanonicalAgentConfig`. It is persisted when the form is saved. It is never read by `evaluateAgentListener`. There is no confirmed handoff mechanism in the current codebase that evaluates `acceptFrom` and triggers a second agent.

**Consequence if assumed true:** A developer configures a two-agent chain. Agent A produces output. Agent B never fires. The developer debugs Agent B's listener, its triggers, its enabled state — all are correct. The actual issue is that `acceptFrom` is never evaluated and the handoff is never initiated.

**Ground truth:** Multi-agent chaining is a future feature. The current orchestrator runs each matched agent in its own independent execution path. There is no agent-to-agent message passing in the WR Chat pipeline.

---

# Part IV — Opus Implementation Brief (doc 16)

**Purpose:** The concise brief a strong coding model uses as the starting point for real work. Not a summary. An orientation contract.

---

## What This System Is

A Chromium extension orchestrator that sits on the WR (WorkRobot/WebRender) host page and processes WR Chat messages through configurable AI agents. Each agent has:
- A **Listener** (keyword triggers, expected context, source filters, website scope)
- A **Reasoning** section (system prompt built from role, goals, rules, and context)
- An **Execution** section (output destination, mode)

Each agent is paired with one or more **Agent Boxes**, which define the LLM brain (provider, model, API key) and the output surface (sidepanel slot or display-grid cell).

The extension communicates with a local **Electron** backend on `127.0.0.1:51248` for LLM calls (`/api/llm/chat`), session persistence, OCR, and API key storage. All calls to Electron use an `X-Launch-Secret` header.

Session state lives in `chrome.storage.local` or Electron SQLite depending on whether Electron is running. The storage adapter (`storageWrapper.ts`) handles routing.

---

## State of the System

The form layer is substantially complete. The runtime layer is partially wired. The following are confirmed broken:

1. **Local provider string mismatch** — UI saves `'Local AI'`, runtime expects `'ollama'`/`'local'`. Silent wrong-model execution.
2. **Cloud providers not executable** — all cloud paths return "not connected." Only Ollama runs.
3. **API keys in wrong store** — extension saves to `localStorage`; Electron reads from SQLite. Split-brain.
4. **Grid boxes invisible to routing** — `loadAgentBoxesFromSession` reads `chrome.storage.local`; grid saves go to SQLite. Routing never finds grid boxes.
5. **Grid pages have no live output handler** — even if routing found a grid box, no message handler updates the DOM.
6. **OCR runs after routing** — the authoritative routing call runs before image OCR; OCR-enriched routing exists but its result is discarded.
7. **No provider identity constants** — string comparisons scattered across codebase; every new provider creates a new mismatch.

---

## The First Runtime Truth to Establish

**A local model agent must execute the configured model, not a fallback.**

Before any other runtime property can be trusted, this must be true: when an Agent Box is configured with `Local AI / llama3.2:3b`, the Electron LLM call goes to `llama3.2:3b`. Not the default. Not a fallback. Confirmed via the network request body.

To establish this:
1. Create `src/constants/providers.ts` in the extension. Export `PROVIDER_IDS` (`ollama`, `openai`, `anthropic`, `gemini`, `grok`), `PROVIDER_LABELS` (UI display strings), and `toProviderId(label: string): ProviderId`.
2. Update the Agent Box save path (content-script, grid scripts) to call `toProviderId(selectedProviderLabel)` before writing the session box object. Save the `ProviderId` string, not the label.
3. Rewrite `resolveModelForAgent` to switch on `ProviderId` from the constants file. For `ollama`: construct the Ollama request. For all others: return `BrainResolutionError` with reason `'not_implemented'`.

Until this is true, every test produces wrong results without visible errors.

---

## The First Source-of-Truth Conflict to Eliminate

**Agent Box storage: `chrome.storage.local` vs. SQLite.**

Two write paths, one read path. Grid boxes go to SQLite via `SAVE_AGENT_BOX_TO_SQLITE`. Routing reads boxes from `chrome.storage.local`. Grid boxes are invisible to routing.

This conflict must be eliminated before any grid test is valid. Both sides are structurally intact — this is a wiring fix, not a feature build.

The fix: make `loadAgentBoxesFromSession` read from the `storageWrapper` active adapter — the same adapter that `loadAgentsFromSession` already uses. A single call: `storageWrapper.getItem('sessionBoxes')`. If the adapter is SQLite (Electron running), this returns boxes saved from all surfaces. If the adapter is `chrome.storage.local` (extension only), this returns boxes saved from the sidepanel.

Do not add a second read or a merge — pick one canonical adapter path and make all writers target it.

---

## The First Provider/Model Issue to Solve

**`resolveModelForAgent` must stop accepting ad-hoc string comparisons and start consuming `ProviderId`.**

Current function logic (simplified):
```
if (provider.toLowerCase().includes('ollama')) → local
if (provider === '') → local
if (provider === 'openai') → 'not connected'
else → fallback
```

This is how `'Local AI'` is never matched — it's not in the inclusion list and it's not empty. The function falls to the else case, which silently uses the hardcoded fallback.

Rewrite this function with a switch on `ProviderId` after:
1. `toProviderId(box.provider)` normalizes the stored label (handles legacy saves that stored labels instead of IDs)
2. The switch has one case per provider in `PROVIDER_IDS`
3. Local is fully implemented; cloud providers throw `BrainResolutionError('not_implemented')`

The `BrainResolutionError` result must write a visible message to the Agent Box output: `"Provider X is not yet connected. Configure a local model or wait for the cloud provider implementation."` This message appearing in the box is itself a test case.

---

## The First Grid/Sidepanel Equivalence Issue to Solve

**Output must reach the grid DOM when routing delivers to a grid box.**

This requires three changes to be simultaneous:
1. `loadAgentBoxesFromSession` reads from the storage adapter (not `chrome.storage.local` directly) — so routing finds the box
2. `updateAgentBoxOutput` can resolve a grid box's `boxId` to a message target — so the message is sent
3. Grid scripts have a `chrome.runtime.onMessage` handler for `UPDATE_AGENT_BOX_OUTPUT` that updates the DOM slot for `message.boxId`

The handler in the grid script must:
- Listen for `{ type: 'UPDATE_AGENT_BOX_OUTPUT', boxId: string, output: string, status: 'done' | 'streaming' | 'error' }`
- Find the DOM slot registered for `boxId` (stored in a local map during box render)
- Set the slot's inner content to the output

Do not implement streaming in this first pass. Deliver final output only. Streaming is a progressive enhancement for after E2E baseline is confirmed.

---

## The First Routing Issue to Solve

**OCR must run before the authoritative routing call, not after.**

In `handleSendMessage`, move `processMessagesWithOCR` before `routeInput`. The function must be awaited. The result (an array of extracted strings) must be concatenated into `combinedText = rawText + ' ' + ocrTexts.join(' ')`.

Then: replace the call to `routeInput(rawText)` with `routeInput(combinedText)` — or replace `routeInput` with `routeClassifiedInput` which already takes an `EnrichedInput` structure.

The current call to `routeClassifiedInput` (post-OCR, post-NLP, currently logging only) should become the authoritative routing call. Its existing console.log wiring should be replaced with actual agent activation.

**Do not refactor `handleSendMessage` beyond this change.** The function has too many orthogonal concerns. Scope this change exactly: OCR moves before routing call, routing call receives OCR-enriched input. Nothing else about the function changes.

**Prerequisite:** Define `TurnInput` and `EnrichedInput` types before editing `handleSendMessage`. This makes the refactor type-safe and prevents accidentally threading the OCR result through the wrong variable (`ocrText` vs `combinedText` vs session-level `ocrText` are already ambiguous).

---

## What Should Explicitly Wait Until After First E2E Success

The following are real gaps. None of them should be touched until the first E2E baseline is confirmed and documented (agents activate, local model executes, output lands in sidepanel and grid box, test matrix T-A1 through T-D3 pass):

| Item | Why it waits |
|---|---|
| Cloud provider execution (second provider and beyond) | Build one provider first, confirm it works, then add others from the same pattern |
| `reasoningSections[]` wiring | Flat reasoning works for first tests; multi-section is an enhancement |
| `agentContextFiles` injection | Context file upload has no file-handling backend; building this requires new Electron work |
| Memory settings (`memorySettings.*`) | All toggles are schema-only; wiring them requires session-scoped memory storage and retrieval |
| `acceptFrom` agent chaining | No handoff mechanism exists; this is a new feature, not a fix |
| `executionMode` branching | `direct_response` vs `agent_workflow` distinction; single output path works for first tests |
| `listening.sources[]` filter | Voice, screenshot, DOM routing; for first tests, all sources activate all matching agents |
| WR Experts context injection | Email-specific; the first tests don't involve WR Experts content |
| Session schema versioning | No schema changes planned in this pass |
| Account-scoped agent storage | Session-scoped agents are sufficient for first tests |
| Streaming output to grid boxes | Final output only for first tests; streaming adds complexity without changing the E2E result |
| Non-box output destinations (email, webhook, storage, notification) | Post-E2E; box output is the only required destination for first tests |

**Guidance for "hiding" unimplemented controls:** Any control that is persisted-only (the value is saved but never read at runtime) and creates a misleading UX expectation should be hidden or disabled with a `(coming soon)` label in the UI before the first E2E release. This is not cosmetic — it prevents support burden and test confusion. See doc `11-runtime-backed-vs-persisted-only-controls.md` for the full classification.

---

## Quick Reference: The Critical Files

| Concern | Primary File | What to Change |
|---|---|---|
| Provider identity | `src/constants/providers.ts` (new) | Create with `PROVIDER_IDS`, `toProviderId()` |
| Model resolution | `src/services/processFlow.ts::resolveModelForAgent` | Switch on ProviderId; visible errors |
| Box persistence | `src/services/processFlow.ts::loadAgentBoxesFromSession` | Use storageWrapper adapter |
| OCR sequencing | `src/sidepanel.tsx::handleSendMessage` | Move OCR before routing; highest risk |
| Routing authority | `src/sidepanel.tsx::handleSendMessage` | Route from enriched input result |
| Grid output handler | `public/grid-script.js`, `public/grid-script-v2.js` | Add `UPDATE_AGENT_BOX_OUTPUT` handler |
| API key store | `src/content-script.tsx::saveApiKeys` | Write to storageWrapper adapter |
| Box save ProviderId | `src/content-script.tsx` + `grid-script*.js` box save path | Call `toProviderId()` before writing |

---

## The Mandate

Build in this order. Do not skip steps. Do not touch `handleSendMessage` until Steps 1–5 are verified by tests. Test at each checkpoint. Document what passed and what failed — especially if a test is indeterminate (model output is non-deterministic; check the network request, not just the UI text).

The orchestrator is architecturally sound at the schema and intent level. The gaps are concrete and bounded. The implementation is primarily wiring and string normalization, with one significant sequencing fix (`handleSendMessage` OCR order) that carries real risk and must be saved for last among the critical items.

The first E2E success is achievable in a focused implementation session. Build the foundation first.
