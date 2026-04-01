# Opus Round — Final Synthesis: First E2E Implementation Readiness

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Basis:** All prior analysis documents (00–19) plus Opus analysis round (docs 01–05).  
**Purpose:** Unified implementation handoff. Covers E2E goal definition, gap map, priority ordering, minimum viable slice, deferral classification, and a plain-language brief.

---

# Part I: First E2E Goal Definition
*(Source: opus-round/01-first-e2e-goal-definition.md)*

---

## What Must Be True for the First End-to-End Test to Count as Successful

### Minimum Required Runtime Behaviors

1. **Typed-trigger agent activation** — a trigger keyword in WR Chat activates the matching agent
2. **Image-trigger agent activation (OCR path)** — OCR extracts trigger from image before routing; agent activates based on OCR text, not just typed text
3. **Correct model execution — local provider** — Network tab shows configured Ollama model name in `/api/llm/chat` request; not fallback model
4. **Correct model execution — at least one cloud provider** — Network tab shows call to cloud API; Ollama fallback does NOT occur when valid key is present
5. **Output lands in correct sidepanel Agent Box** — live, without page reload, matching the triggering agent
6. **Output lands in correct display-grid Agent Box** — live, equivalent behavior to sidepanel
7. **Listener configuration has observable runtime effect** — trigger keyword change changes which agent fires
8. **Reasoning content reaches the LLM** — role/goals/rules appear in system prompt in Network request
9. **Session persistence across navigation** — agents and boxes survive page reload
10. **API key visible to execution path** — key from extension UI is the key used by Electron for cloud calls

### Minimum Required UI Behaviors

1. Agent Box model selector shows real installed Ollama models (not static list)
2. Cloud provider selection shows missing key warning (not silent fallback)
3. Agent configuration saves correctly and survives panel close/reopen
4. Agent Box configuration saves correctly
5. **Controls not yet wired are either hidden or labeled — not silently non-functional**

### Minimum Required Persistence Behaviors

1. Session blob contains agents and boxes after creation
2. Grid box saves reach the same store that routing reads from
3. Session survives extension context reset

### Minimum Required Provider Behaviors

**Local:** `'Local AI'` maps to Ollama at runtime. Configured model name is passed to LLM call. Ollama unavailable → visible error.  
**Cloud:** At minimum one cloud provider: key from extension UI reaches Electron backend; routing dispatches to cloud API; failure surfaces visible error.

### Explicit Non-Goals for First Pass

Context files (RAG), memory settings, `reasoningSections[]` selection, WR Experts, `listening.sources[]`, `executionMode`, non-box destinations, `acceptFrom`, streaming, structured output, tool-use, mobile routing, session import/export, schema versioning.

### Success Validation Test Matrix

| Test | Pass Condition |
|---|---|
| T1: Typed trigger → local agent → sidepanel box | Network shows configured Ollama model; box shows output |
| T2: Image-only input → OCR trigger → sidepanel box | Agent activates only from OCR text; box shows output |
| T3: Same agent → grid box | Grid box updates live without reload |
| T4: Cloud agent with valid key | Network shows cloud API call; correct model output |
| T5: Trigger changed | New trigger activates agent; old trigger does not |
| T6: Role/goals changed | System prompt in Network reflects new content |
| T7: Navigate away, return | Agents and boxes still present |
| T8: No Ollama running | Visible error, not silent empty |
| T9: Cloud key missing | Warning shown, not silent Ollama fallback |

---

# Part II: Gap Map Against First E2E Goal
*(Source: opus-round/02-gap-map-against-first-e2e-goal.md)*

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
| Context/memory usage | **UI-only** | No (but misleading) | UX label + future wiring |

---

## Most Critical Gap Details

### Local Model Execution — Broken (Provider String Mismatch)
UI saves provider as `'Local AI'`. `resolveModelForAgent` recognizes `'ollama'`, `'local'`, `''` — not `'local ai'`. Every Agent Box with `Local AI` provider silently falls back to hardcoded fallback model. User configures `llama3.2:3b`; a different model runs. No error shown.  
**Location:** `processFlow.ts::resolveModelForAgent` lines 1210–1245.

### Display-Grid Boxes — Structurally Blocked (Three Independent Blockers)
1. `loadAgentBoxesFromSession` reads `chrome.storage.local` only. Grid boxes saved to SQLite via `SAVE_AGENT_BOX_TO_SQLITE` — not in chrome.storage. Routing engine blind spot.
2. Grid pages have no `chrome.runtime.onMessage` handler for `UPDATE_AGENT_BOX_OUTPUT`. Output sent, never rendered.
3. Grid session loading bypasses storage proxy — direct HTTP to Electron.  
**Location:** `processFlow.ts::loadAgentBoxesFromSession`; grid-script.js / grid-script-v2.js / grid-display.js.

### OCR-Aware Routing — Broken (Sequencing)
`routeInput` runs at sidepanel.tsx line 2925. `processMessagesWithOCR` runs at line 2943. OCR-aware routing logic exists and is correct in `routeClassifiedInput` — but its output is wired to a console.log at line 2992, not the execution loop.  
**Location:** `sidepanel.tsx::handleSendMessage` lines 2925, 2943, 2992.

### Cloud Provider Execution — Not Implemented
`resolveModelForAgent` hits "API not yet connected" for all cloud providers. `/api/llm/chat` on Electron is Ollama-only. Cloud execution is an absent feature, not a wiring gap.  
**Location:** `processFlow.ts::resolveModelForAgent`; Electron `main.ts`.

---

# Part III: Priority Order — High to Low
*(Source: opus-round/03-priority-order-high-to-low.md)*

---

## P0 — Hard Blockers

No valid E2E test is possible without these.

**P0-A: Fix `'Local AI'` Provider String Mismatch**  
One targeted fix to `resolveModelForAgent`. Add `'local ai'` to the recognized-local list. Zero dependencies.

**P0-B: Establish `providers.ts` Constants File**  
Canonical provider identity strings for UI, storage, and runtime. Done with P0-A. Prevents the next mismatch.

**P0-C: Make Grid Boxes Visible to Routing Engine**  
`loadAgentBoxesFromSession` must be able to find boxes saved by the grid. Either: grid saves write to chrome.storage too, or `loadAgentBoxesFromSession` reads from the active adapter. Implementation choice. High importance.

**P0-D: Add Live Output Handler to Grid Pages**  
Add `chrome.runtime.onMessage` listener for `UPDATE_AGENT_BOX_OUTPUT` in grid scripts. Additive. Required alongside P0-C.

---

## P1 — Needed for Reliable First Tests

**P1-A: Resequence OCR Before Routing in `handleSendMessage`**  
Move `processMessagesWithOCR` before `routeInput`. Thread `ocrText` into routing. Consider feature flag. High-risk function.  
**Dependency:** P0 complete (regression baseline needed before touching handleSendMessage).

**P1-B: Fix `hasImage` to Check Current Turn Only**  
`chatMessages.some(msg => msg.imageUrl)` → check only current turn's messages. Done with P1-A.

**P1-C: Cloud Provider Execution — Minimum One Provider**  
Electron backend must route to cloud API for cloud-provider boxes. Requires API key sync and provider dispatch. Most complex item.  
**Dependency:** P0-A, P0-B, API key sync.

**P1-D: Surface Model Resolution Failures to User**  
Additive warning in box output when fallback model is used. Fully observable test failures.  
**Dependency:** P0-A (so warning only fires for actual fallbacks).

**P1-E: Validate Sidepanel Box Persistence Round-Trip**  
Confirm sidepanel box write path and read path use the same adapter. Prevents intermittent "box not found" failures.

---

## P2 — Important but Can Wait

- P2-A: Wire `reasoningSections[]` in WR Chat path
- P2-B: Inject `agentContextFiles` into prompts
- P2-C: API key store normalization (accelerates P1-C)
- P2-D: Fix `ocrText` race condition for multiple images
- P2-E: Session persistence authority (single canonical source)

---

## P3 — Intentionally Deferred

- `listening.sources[]` evaluation
- `executionMode` branching (beyond single box)
- Non-box execution destinations
- `acceptFrom` multi-agent chaining
- WR Experts integration
- Session schema versioning
- Streaming / structured output / tool-use

---

# Part IV: Minimum Viable Orchestrator Slice
*(Source: opus-round/04-minimum-viable-orchestrator-slice.md)*

---

## The One Slice That Must Work First

> A user types text containing a trigger keyword into WR Chat. The agent configured with that trigger activates. The Agent Box assigned to that agent (whether in the sidepanel or the display grid) executes with the configured provider and model. The LLM output lands in the correct box, live, without page reload.

Plus the OCR variant:

> A user uploads an image. OCR extracts a trigger keyword. The correct agent activates based on OCR text. Output lands in the configured box.

---

## Canonical Path

```
Extension side:
  handleSendMessage
    → if image: OCR runs FIRST
    → routeInput (or routeClassifiedInput post-OCR) with enriched text
    → evaluateAgentListener matches agent by trigger
    → findAgentBoxesForAgent → agentBoxId
    → wrapInputForAgent → system prompt (role + goals + rules + ocrText)
    → resolveModelForAgent(normalized provider constant) → correct model
    → processWithAgent → POST /api/llm/chat (or cloud endpoint)
    → updateAgentBoxOutput → UPDATE_AGENT_BOX_OUTPUT message
    → sidepanel OR grid handler → live DOM update

Electron side:
  /api/llm/chat routes to Ollama (local) or provider API (cloud)
  API key from extension's storage reaches Electron for cloud calls
  /api/ocr/process runs BEFORE routing call on extension side
```

---

## Provider Support for First Slice

- **Required:** Local AI / Ollama
- **Recommended:** One cloud provider (OpenAI) — proves architecture is not Ollama-hardcoded
- **Implementation pattern:** `providers.ts` constants + one dispatch case per provider → adding more providers is additive

---

## Box Surfaces for First Slice

Both sidepanel and display-grid boxes must work. Sequence: prove sidepanel (after P0-A), then prove grid (after P0-C + P0-D).

---

## Controls That Must Have Runtime Effect

| Control | Required Effect |
|---|---|
| Trigger keyword | Agent activates when trigger appears in input (typed or OCR) |
| Agent enabled/disabled | Disabled agent does not activate |
| Agent Box provider | Determines which API endpoint is called |
| Agent Box model | Model name appears in LLM request payload |
| Agent → Box assignment | Box receives output from its assigned agent |
| Role / Goals / Rules | Appear in system prompt in LLM request |

---

## Controls That May Remain Persisted-Only

`reasoningSections[]`, `agentContextFiles`, `memorySettings`, `contextSettings`, `executionMode`, `listening.sources[]`, `acceptFrom`, `platforms.mobile`.

**These must be labeled or hidden — not silently ignored.**

---

# Part V: Can Defer vs Cannot Defer
*(Source: opus-round/05-can-defer-vs-cannot-defer.md)*

---

## Cannot Defer for First E2E

| Item | Why |
|---|---|
| Local model execution (`resolveModelForAgent` fix) | All local tests invalid without it |
| Provider constants file | Prevents provider mismatch from recurring for cloud |
| Grid box routing visibility (3 blockers) | Grid equivalence is a product requirement |
| Grid page live output handler | Grid tests incomplete without it |
| OCR resequencing before routing | T2 (image trigger) cannot pass without it |
| Error surfacing when model resolution falls back | All test failures become invisible without it |

---

## Can Defer Until After First E2E

`reasoningSections[]`, `agentContextFiles`, `acceptFrom`, `listening.sources[]`, `executionMode`, non-box destinations, session schema versioning, mobile flags, streaming, structured output, tool-use, session import/export, account-scoped agent confirmation.

---

## Dangerous to Defer (Creates Misleading UX)

These are **persisted but not wired** — and the UI presents them as active configuration. They contaminate test results and erode user trust.

| Control | Why it's dangerous | Action required |
|---|---|---|
| Memory toggles | User believes agent has memory; it doesn't | Hide or label "Not yet active" |
| Context file upload | User believes agent reads the file; it doesn't | Hide or label "Not yet active" |
| WR Experts in orchestrator context | Name collision with email feature; completely misleading | Remove or relabel |
| Global/account context toggles | Active-looking controls with no effect | Hide or label "Not yet active" |
| Multi-section reasoning (if UI exposed) | User believes per-trigger reasoning fires; it doesn't | Collapse to flat or label "Coming soon" |

---

## Should Be Hidden or Clearly Marked If Deferred

| Control | Action |
|---|---|
| Memory toggles | Hide or label "Not yet active" |
| Context file upload | Hide or label "Not yet active" |
| WR Experts (orchestrator) | Remove or relabel distinctly from email WR Expert |
| Global/account context toggles | Hide or label "Not yet active" |
| Multi-section reasoning | Collapse to flat or label "Coming soon" |
| Execution mode selector | Hide or label "Coming soon" |
| Non-box destination selectors | Hide or label "Coming soon" |
| `acceptFrom` field | Hide or label "Coming soon" |
| `listening.sources[]` | Hide or label "Coming soon" |
| Structured output / tool-use | Hide or label "Coming soon" |

---

## The Principle

> If a user can click it, it must do something — or it must say it doesn't do something yet.

In an AI system, the relationship between configuration and output is non-deterministic. Users cannot distinguish "the model was random" from "the context file I uploaded had no effect" without explicit system feedback. Every silently non-functional control is a false negative waiting to be blamed on the wrong component.

---

# Final Section: What Must Be Fixed First, in Plain Language

---

**The system has one critical bug that prevents any meaningful local test:** the `'Local AI'` provider string is not recognized by the runtime. Every agent box configured with `Local AI` silently runs the wrong model. Fix this first. It is one targeted change in `processFlow.ts::resolveModelForAgent`. Do it alongside a `providers.ts` constant file so the same mistake doesn't recur for cloud providers.

**The system has one structural gap that prevents grid boxes from ever receiving output:** `loadAgentBoxesFromSession` reads from `chrome.storage.local` only, but grid boxes are saved to SQLite. The routing engine literally cannot see grid boxes. This is three fixes: unify the box write/read store, add a message listener in the grid page scripts. None of them are complex — the complexity is in doing them carefully without breaking sidepanel boxes.

**The system has a sequencing error in OCR routing:** the authoritative routing decision happens before OCR runs. The correct OCR-aware routing logic already exists and is correct — it just wires its output to a console log instead of the execution loop. Moving OCR before routing and switching the execution loop to consume the enriched routing result is the right fix. This is medium-complexity and touches the most loaded function in the codebase — do it after the provider and grid fixes so there is a stable baseline to regression-test against.

**The system has several UI controls that are fully visible but have zero runtime effect.** Memory toggles, context file upload, and WR Experts in particular look like live features. They are not. Before real user testing, either wire them or hide them. A test result produced by someone who enabled memory or uploaded a context file and got results cannot be attributed to those features — the results would have been identical without them.

**For cloud providers:** the execution path does not exist yet. It's not a wiring gap — it's an unimplemented feature. The API key store is also split between localStorage (extension) and SQLite (Electron) with no sync. Cloud execution requires building the dispatch path in Electron and syncing the key store. Do this after local is proven clean. Use the `providers.ts` constant file as the foundation so each new cloud provider is just one dispatch case.

**The correct implementation order:**
1. Fix `'Local AI'` string + create `providers.ts`
2. Fix grid box persistence split (both write-path unification and live update listener)
3. Move OCR before routing in `handleSendMessage`
4. Add cloud provider execution (one provider, one dispatch pattern)
5. Surface all model resolution failures with visible warnings

After step 3, run all nine test scenarios in document 01. Every scenario should produce a pass or a clear, diagnosable failure. At that point, the orchestrator has its first real end-to-end test foundation.
