# 03 — Priority Order: High to Low

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Basis:** Gap map (doc 02), normalization requirements (doc 17), risk map (doc 16).

---

## Framing

This is not a code diff plan. It is an implementation ordering plan that answers: "What must exist before the next thing can be built or tested, and in what order should implementation proceed to maximize validated progress?"

Each item includes what would remain broken if it were skipped.

---

## P0 — Hard Blockers

These must be resolved before any meaningful end-to-end test is possible. Nothing else in the system can be verified as working without these.

---

### P0-A: Fix the `'Local AI'` Provider String Mismatch

**The problem:**  
`resolveModelForAgent` in `processFlow.ts` does not recognize `'Local AI'` as a local provider. After lowercasing, `'local ai'` matches none of the recognized strings (`'ollama'`, `'local'`, `''`). Every Agent Box configured with `Local AI` silently falls back to a hardcoded fallback model, discarding the user's configured model name. The user sees output — just from the wrong model. No error is shown.

**Why it comes first:**  
This is the only thing preventing the simplest possible path (typed trigger → local agent → sidepanel box) from working correctly. Every other test depends on this being fixed. It also pollutes all test results until corrected — you cannot trust any output to be from the configured model.

**Dependencies:** None. This can be done immediately.

**What can be validated:**  
After this fix, a Network tab capture of a WR Chat send should show the exact model name from the Agent Box config in the `/api/llm/chat` request payload. This is the first verifiable baseline.

**What remains broken if skipped:**  
Every local model test result is invalid. Cloud tests cannot distinguish "cloud not implemented" from "wrong model used." All test output is from the fallback model, not the configured one.

---

### P0-B: Establish a Provider Constants File

**The problem:**  
There is no shared definition of provider identity strings. The UI uses `'Local AI'`. The runtime uses `'ollama'`. This mismatch will recur for every new provider added unless the strings are normalized in one place. Fixing P0-A as a one-line string add without this produces the next mismatch.

**Why it comes with P0-A:**  
P0-A and P0-B should be done together. P0-A without P0-B is a band-aid that will break again. P0-B without P0-A leaves the system broken.

**Dependencies:** None beyond P0-A.

**What can be validated:**  
After this, `resolveModelForAgent` and the UI provider selectors use the same value for every provider. Adding a new provider later means one edit in `providers.ts` and one dispatch case — no hidden string mismatches.

**What remains broken if skipped:**  
Cloud provider wiring (P1-C) will immediately create the same string mismatch problem. Every future provider integration risks the same silent fallback behavior.

---

### P0-C: Make Grid Boxes Visible to the Routing Engine

**The problem:**  
`loadAgentBoxesFromSession` reads `chrome.storage.local` only. Grid boxes are saved to SQLite via `SAVE_AGENT_BOX_TO_SQLITE` — bypassing chrome.storage. The routing engine has no knowledge of grid boxes. Output targeting a grid box has no destination, silently drops or never reaches `updateAgentBoxOutput`.

**Why it comes in P0:**  
Without this, any test involving a display-grid Agent Box produces no output regardless of all other fixes. It is a structural silent failure — no error, no feedback, no way to know the routing engine simply doesn't see the box.

**Dependencies:** Understanding of the current `SAVE_AGENT_BOX_TO_SQLITE` handler in `background.ts`. Implementation choice: either (a) make grid box saves also write to chrome.storage, or (b) make `loadAgentBoxesFromSession` read from the active adapter (SQLite). Option (b) is architecturally cleaner but requires adapter-aware reads. Option (a) is faster but maintains two write paths.

**What can be validated:**  
After this fix, `loadAgentBoxesFromSession` returns grid boxes. A console log of the boxes array should include boxes created in the grid dialog. A routing decision for a grid-configured agent should produce a valid `agentBoxId`.

**What remains broken if skipped:**  
All grid box tests (T3) produce no output. The grid box equivalence claim cannot be tested at all.

---

### P0-D: Add Live Output Handler to Grid Pages

**The problem:**  
Even after P0-C (routing can find grid boxes), the display-grid pages have no `chrome.runtime.onMessage` listener for `UPDATE_AGENT_BOX_OUTPUT`. Output is sent but no page subscribes to it. Grid boxes would receive output in storage but not render it live.

**Why it comes immediately after P0-C:**  
P0-C ensures routing delivers output to storage. P0-D ensures the grid page renders it. These two fixes are necessary together for grid equivalence to work. P0-D is additive (a new listener) and lower risk than P0-C — but worthless without P0-C.

**Dependencies:** P0-C (routing must find the box and write output to it first).

**What can be validated:**  
After P0-C + P0-D: send a message that triggers a grid-assigned agent. The grid tab updates live without page reload. The output content matches the LLM response.

**What remains broken if skipped:**  
Grid boxes are found and written by routing but the DOM never updates. User must reload the grid page to see output. Effectively non-functional for real use.

---

## P1 — Needed for Reliable First Tests

These items are required for the test suite to be reliable and complete. The system can produce some output without them, but the test results would be inconclusive or incomplete.

---

### P1-A: Resequence OCR Before Routing in `handleSendMessage`

**The problem:**  
`routeInput` runs before `processMessagesWithOCR` in `handleSendMessage`. The authoritative routing decision happens before OCR text is available. Agents whose triggers only appear in OCR-extracted text (from uploaded images) will never activate via the WR Chat path.

The correct routing logic already exists in `routeClassifiedInput` — it receives OCR-enriched input and produces correct agent allocations. The problem is that its output is wired to a console log, not the execution loop.

**Why it comes in P1:**  
OCR-aware routing is explicitly part of the product goal. Without this, T2 (image-only trigger) cannot pass. However, T1 (typed trigger) and T3 (grid box) work independently of this fix. Resequencing `handleSendMessage` is high-risk (it's the most loaded function in the codebase) — it should be done deliberately, not rushed before the simpler fixes.

**Dependencies:** P0-A and P0-B must be done first. After P0, at least T1 should be working so there is a regression baseline before touching `handleSendMessage`.

**What can be validated:**  
After this fix: upload an image containing trigger keyword `X`. No typed text. Send. The agent configured with trigger `X` activates. Console shows OCR text containing `X` before the routing decision. Network tab shows LLM call with OCR text in the message.

**What remains broken if skipped:**  
All image-triggered agent scenarios (T2) fail silently. Users uploading screenshots or documents to trigger OCR-based processing see no agent response. The OCR feature appears to work (images are processed, text is appended to messages) but it has zero routing effect.

---

### P1-B: Fix `hasImage` to Check Current Turn Only

**The problem:**  
`hasImage` is set by scanning all prior messages in the session: `chatMessages.some(msg => msg.imageUrl)`. Any session that has ever had an image will set `hasImage = true` for all subsequent text-only sends. This creates false positives for image-type trigger matching.

**Why it comes in P1:**  
This is a small, contained fix that affects routing correctness. It should be done alongside P1-A since both are in `handleSendMessage`. Doing it separately wastes a touch of the most fragile function. After P0, this should be the next change to `handleSendMessage`.

**Dependencies:** P0-A (baseline must work first).

**What can be validated:**  
Text-only send in a session with prior image messages → `hasImage` is `false` in routing call. Agent with `applyFor: 'image'` does NOT activate on text-only input in such a session.

**What remains broken if skipped:**  
Image-type agents activate on text sends in sessions with prior images. Spurious agent activation. Test results for listener `applyFor` are unreliable.

---

### P1-C: Cloud Provider Execution — Minimum One Provider

**The problem:**  
All cloud providers hit "API not yet connected" in `resolveModelForAgent`. `processWithAgent` posts to `/api/llm/chat` which is Ollama-only. Cloud execution is structurally absent.

**Why it comes in P1:**  
The product goal requires at least one cloud provider for the first E2E tests. However, this is the most complex item in the list — it requires Electron backend changes (a cloud API dispatch route), API key sync (gap 1), and `resolveModelForAgent` refactoring. It should not be rushed before the local path is proven stable.

**Dependencies:**  
- P0-A and P0-B (provider constants must be established first)
- API key sync must be resolved as part of this: keys entered in extension UI must reach Electron
- Electron `/api/llm/chat` or a new endpoint must route by provider ID

**What can be validated:**  
Network tab shows a call to `api.openai.com` (or equivalent) after configuring an OpenAI box with a valid key. Box receives cloud model output. Fallback model is NOT used.

**What remains broken if skipped:**  
T4 (cloud provider test) cannot pass. Cloud-configured Agent Boxes silently use local Ollama. Users who configure cloud agents see local model output with no indication.

---

### P1-D: Surface Model Resolution Failures to User

**The problem:**  
When `resolveModelForAgent` falls back to the fallback model (wrong provider string, cloud not connected, etc.), it does so silently. The box fills with output, but from the wrong model. There is no warning, no indicator, nothing to help the user understand what happened.

**Why it comes in P1:**  
This is purely additive — a warning injected into the box output or a console note. It makes all other test scenarios debuggable. Without it, test failures look like agent failures rather than model resolution failures.

**Dependencies:** P0-A (so the warning is only for actual fallbacks, not for every send).

**What can be validated:**  
Configure a cloud agent without a key → box output shows "[Warning: configured model unavailable — using fallback]". No silent failure.

**What remains broken if skipped:**  
Test failures related to model selection are invisible. Any time a model resolution issue occurs (misconfigured provider, Ollama not running, cloud key missing), the system produces output silently from the wrong source with no diagnostic information.

---

### P1-E: Validate and Stabilize Session Persistence for Boxes

**The problem:**  
`loadAgentBoxesFromSession` reads `chrome.storage.local` directly. Sidepanel boxes are written through the adapter chain (chrome.storage → SQLite when Electron is running). The question is whether the write path and read path are always consistent for sidepanel boxes, not just grid boxes.

**Why it comes in P1:**  
P0-C resolved the grid box split. But the sidepanel box persistence path also needs confirmation. If sidepanel boxes are sometimes written to SQLite only (via the adapter) and read from chrome.storage only (by `loadAgentBoxesFromSession`), boxes would silently disappear at routing time even for sidepanel tests.

**Dependencies:** P0-C understanding (same storage chain analysis).

**What can be validated:**  
Create a sidepanel Agent Box. Reload. Send a trigger message. `loadAgentBoxesFromSession` should return the box. No routing failure due to box not found.

**What remains broken if skipped:**  
Intermittent test failures where sidepanel boxes appear in UI but are not found by routing — agent runs but output is silently dropped.

---

## P2 — Important but Can Wait

These items improve the system meaningfully but their absence does not prevent the first E2E test suite from running.

---

### P2-A: Wire `reasoningSections[]` in WR Chat Path

**Problem:** `wrapInputForAgent` reads flat `agent.reasoning` only. Multi-section reasoning sections exist in the schema and are configurable in the UI. They have no runtime effect in the WR Chat path.

**Why it can wait:** Flat reasoning works for first tests. The UI is misleading (see doc 05 classification) but the system produces correct output from flat reasoning. This should be wired before real users configure multi-section agents.

**Validation after fix:** Network request system prompt shows the trigger-selected reasoning section, not the flat `agent.reasoning` string.

---

### P2-B: Inject `agentContextFiles` into Prompts

**Problem:** Context files are uploaded and persisted but never read by `wrapInputForAgent`. Agents with context files behave identically to agents without them.

**Why it can wait:** First tests don't require context files. Requires understanding the file storage format (blob URL, base64, plain text) before implementation.

**Validation after fix:** System prompt in Network request contains context file content as a "Reference Documents" section.

---

### P2-C: API Key Store Normalization

**Problem:** Extension saves keys to `localStorage`. Electron reads keys from SQLite. No confirmed sync. This was noted as a dependency for P1-C (cloud execution) — it can be resolved as part of that work, or independently if cloud execution is deferred.

**Why it can wait:** If cloud execution (P1-C) is deferred, this is also deferrable. If P1-C is in scope, this becomes a P0/P1 dependency.

---

### P2-D: Fix `ocrText` Race Condition (Multiple Images)

**Problem:** `processMessagesWithOCR` with multiple image messages overwrites `ocrText` for each, keeping only the last. Earlier image context is lost.

**Why it can wait:** First tests typically involve one image at a time. This is an edge case for multi-image conversations.

---

### P2-E: Session Persistence Authority (single source of truth)

**Problem:** Three session read paths exist. Dynamic adapter selection without conflict resolution. Grid pages bypass proxy.

**Why it can wait:** In a controlled test environment with Electron consistently running, the SQLite adapter path is consistently selected. This becomes critical when testing session reload scenarios or when Electron availability is variable.

---

## P3 — Future-Facing / Intentionally Deferred

These are architecturally important but explicitly out of scope for first E2E tests.

---

### P3-A: `listening.sources[]` Evaluation

14 source types defined in schema, not evaluated at runtime. Agents with source constraints fire for all input. Deferring is acceptable because first-pass agents should not rely on source filtering.

---

### P3-B: `executionMode` Branching

4 execution modes defined. Runtime has one behavior (box output). Deferring is acceptable because single box output is the first-pass target.

---

### P3-C: Non-Box Execution Destinations

Email, webhook, storage, notification destinations are defined but not implemented. Not needed for first tests.

---

### P3-D: `acceptFrom` Multi-Agent Chaining

Field persisted, never evaluated. Multi-agent workflow chaining is a future feature. Deferring is safe.

---

### P3-E: WR Experts Integration

The email-side `WRExpert.md` and the orchestrator's `agentContextFiles` share a name but are separate features. No integration point exists in the agent config. Deferring is safe — but the UI/name collision should be clarified before users are confused.

---

### P3-F: Session Schema Versioning

No `_schemaVersion` on session blobs. Schema evolution will silently break existing sessions. This is critical to address before any schema changes are made, but is not blocking for first tests if no schema changes are planned.

---

### P3-G: Streaming, Structured Output, Tool-Use

None are implemented. Not needed for first tests.

---

## Priority Summary

```
P0 (must do before any valid E2E test):
  P0-A  Fix 'Local AI' provider string mismatch
  P0-B  Establish provider constants file (providers.ts)
  P0-C  Make grid boxes visible to routing engine
  P0-D  Add live output handler to grid pages

P1 (needed for complete and reliable first test set):
  P1-A  Resequence OCR before routing in handleSendMessage
  P1-B  Fix hasImage to check current turn only
  P1-C  Cloud provider execution — minimum one provider
  P1-D  Surface model resolution failures to user
  P1-E  Validate sidepanel box persistence round-trip

P2 (important but does not block first E2E):
  P2-A  Wire reasoningSections[] in WR Chat path
  P2-B  Inject agentContextFiles into prompts
  P2-C  API key store normalization (also a P1 if cloud is in scope)
  P2-D  Fix ocrText race condition for multiple images
  P2-E  Session persistence authority

P3 (deferred, intentionally out of scope):
  P3-A  listening.sources[] evaluation
  P3-B  executionMode branching
  P3-C  Non-box execution destinations
  P3-D  acceptFrom multi-agent chaining
  P3-E  WR Experts integration
  P3-F  Session schema versioning
  P3-G  Streaming / structured output / tool-use
```
