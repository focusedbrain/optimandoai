# 05 — Can Defer vs Cannot Defer

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Basis:** Gap map (doc 02), priority order (doc 03), minimum viable slice (doc 04).

---

## Structure

This document classifies every significant feature backlog item into one of four buckets:

1. **Cannot defer** — must be wired before any E2E test is valid
2. **Can defer** — absent from the minimum slice; safe to defer until after first tests
3. **Dangerous to defer** — absent from runtime, but the UI presents it as functional; creates misleading user experience and false test confidence
4. **Should be hidden or clearly marked** — if not wired in this pass, the control must be visually inactive

---

## Cannot Defer for First E2E

### Local Model Execution (`resolveModelForAgent` provider string fix)
**Why it cannot be deferred:** It is the only currently available execution path. Every single test that involves a local agent uses it. Without this fix, no test output can be trusted to come from the configured model. The system produces output, but from the wrong model, silently.  
**What "done" looks like:** Network tab shows the exact model name from the Agent Box config in the `/api/llm/chat` request payload.

### Provider Constants File (`providers.ts`)
**Why it cannot be deferred:** The provider string fix without a constants file is a temporary band-aid. Cloud provider wiring will immediately create the same mismatch if there is no canonical source for provider identity strings. Both fixes belong in the same change.

### Grid Box Routing Visibility
**Why it cannot be deferred:** Grid box equivalence is a product requirement for the first tests. A test suite that only verifies sidepanel boxes leaves the most dangerous architectural flaw (the storage split) unconfirmed. Every user who creates agents and assigns them to grid boxes will see nothing happen — and will blame the agents, the routing, or the LLM before discovering the box is invisible to the routing engine.

### Grid Page Live Output Handler
**Why it cannot be deferred:** Discovering that the routing engine now finds grid boxes but the page doesn't update is exactly as frustrating as the previous failure — but much harder to debug. This must be resolved alongside the routing visibility fix.

### OCR Resequencing Before Routing
**Why it cannot be deferred:** The product goal explicitly includes OCR as part of routing. Deferring this means T2 (image-triggered agent activation) cannot pass. Since OCR is structurally the most important differentiator of this system over a plain LLM chat interface, the first test set is incomplete without it. The resequencing is a medium refactor in a fragile function — but it's non-negotiable for the first tests.

### Error Surfacing When Model Resolution Falls Back
**Why it cannot be deferred:** Without visible fallback warnings, test failures caused by model misconfiguration, missing keys, or unimplemented providers are completely invisible. The same agent output appears whether the configured model ran or the fallback ran. Without error surfacing, debugging the rest of the system is guesswork.

---

## Can Defer Until After First E2E

### `reasoningSections[]` Per-Trigger Selection
Flat `agent.reasoning` is sufficient for the first tests. The UI correctly presents it as an optional enhancement. Its absence produces degraded (not wrong) behavior — the flat reasoning section still runs.  
**Deferred to:** P2-A.

### `agentContextFiles` RAG Injection
Context files are persisted but not injected. First tests don't require them. The file storage format needs to be confirmed before implementation anyway.  
**Deferred to:** P2-B.  
**Note:** UI must be marked (see "Dangerous to defer" section).

### `acceptFrom` Multi-Agent Chaining
Not evaluated. No active user flow depends on it. First tests use single-agent scenarios.  
**Deferred to:** P3-D.

### `listening.sources[]` Source Filtering
Not evaluated. First-test agents use keyword triggers only, no source constraints. The absence of source filtering means agents may activate in unexpected source contexts — but this is an edge case for first tests.  
**Deferred to:** P3-A.  
**Note:** If a user has `sources: ['screenshot']` configured, the agent will activate on all inputs, not just screenshots. This is surprising behavior but acceptable in a first-test environment.

### `executionMode` Branching
Single box output is the only behavior needed for first tests. Four modes exist in schema; one behavior exists at runtime. This is not misleading in the first pass because the single behavior is the expected default.  
**Deferred to:** P3-B.

### Non-Box Execution Destinations
Email, webhook, storage, notification destinations are not implemented. First tests use box output only.  
**Deferred to:** P3-C.

### Session Schema Versioning
No `_schemaVersion` on session blobs. This is latent risk, not active breakage. It becomes critical before any schema changes are made.  
**Deferred to:** P3-F — **but must be resolved before any schema field is renamed or removed.**

### Mobile Platform Flags
Not consumed by routing. Not needed for first tests.  
**Deferred to:** Indefinitely (MVP scope).

### Streaming Output
Not implemented. First tests use synchronous response. Deferred until basic synchronous output is proven.

### Structured Output / Tool-Use
Not implemented. No infrastructure for it. Deferred.

### Session Import/Export
Not needed for first tests. Deferred until session persistence itself is solid.

### Account-Scoped Agent Storage Confirmation
The account agent path exists but is unconfirmed. First tests use session-scoped agents.  
**Deferred to:** P2.

---

## Dangerous to Defer (Creates Misleading UX)

These items are not wired, but the UI presents them as active configuration controls. Users who configure them believe they are doing something. The system silently ignores their configuration. This erodes trust and produces incorrect test conclusions.

---

### Memory Settings Toggles (`memorySettings.*`)

**Current state:** UI presents session memory, account memory, and agent memory toggles with read/write controls. All of these are persisted to the session. None are consumed by `wrapInputForAgent`.

**Why it's dangerous:** A user who enables "session memory read" believes the agent will remember prior conversation content. The agent does not. This is not a "coming soon" state — it's a state where the UI gives active configuration feedback while the backend ignores the configuration entirely. Test conclusions based on "I enabled session memory and the agent performed better" are false.

**Action required:** Hide these toggles from the UI for this pass, OR add a clearly visible label: "Memory not yet active — coming in a future update."

---

### Context File Upload and `agentContextFiles`

**Current state:** UI has a file upload control that persists files to `agentContextFiles[]`. `wrapInputForAgent` never reads this array.

**Why it's dangerous:** A user who uploads a document as agent context believes the agent will have access to its contents. It doesn't. Unlike memory toggles (which affect behavior in a subtle way), context files have a very clear expectation: "the agent will use this document." This expectation is completely false.

**Action required:** Hide the context file upload UI for this pass, OR label it: "Context files not yet injected — upload feature is in preview."

---

### WR Experts Section

**Current state:** "WR Experts" appears in the UI. The email-side `WRExpert.md` is a separate feature unrelated to the orchestrator. There is no confirmed integration between the email WR Expert feature and the orchestrator's agent reasoning.

**Why it's dangerous:** Users who believe WR Experts are their orchestrator agents' domain knowledge files are completely mistaken. The email WR Expert affects email inbox rules, not agent reasoning. The name collision is severe.

**Action required:** If WR Experts appear in the orchestrator agent form UI, they must either be removed or clearly separated from the email feature with a distinct label. This is the most dangerous name collision in the current codebase.

---

### Global Context / Account Context Toggles

**Current state:** `contextSettings.agentContext`, `sessionContext`, `accountContext` are rendered as checkboxes. None are consumed at runtime.

**Why it's dangerous:** Slightly less severe than memory toggles because "context" is more abstract, but the same principle applies — the UI presents active controls that have no runtime effect.

**Action required:** Hide or label these controls.

---

### Multi-Section Reasoning Tabs (if accessible without clicking through)

**Current state:** The agent form has a `reasoningSections[]` configuration path. `wrapInputForAgent` uses only flat `agent.reasoning`. If users can configure multiple reasoning sections in the UI and see them saved, they believe per-trigger reasoning is active.

**Why it's dangerous:** A tester who configures different reasoning sections for different triggers and then sees no difference in behavior will blame the trigger system, not the reasoning section wiring.

**Action required:** For this pass, collapse the reasoning section to flat mode in the UI, or label multi-section configuration as "coming soon." Keep the flat role/goals/rules fields fully functional.

---

## Should Be Hidden or Clearly Marked If Deferred

A summary of UI elements that must be either hidden or labeled as inactive for the first test pass to produce reliable results:

| Control | Action |
|---|---|
| Memory toggles (session/account/agent read/write) | Hide or label "Not yet active" |
| Context file upload (`agentContextFiles`) | Hide or label "Not yet active" |
| WR Experts in orchestrator context | Remove or relabel to not conflict with email feature |
| Global/account context toggles | Hide or label "Not yet active" |
| Multi-section reasoning (if separate from flat reasoning) | Label "Coming soon" or collapse to flat |
| Execution mode selector (beyond default box output) | Hide or label "Coming soon" |
| Non-box destination selectors (email, webhook, etc.) | Hide or label "Coming soon" |
| `acceptFrom` field | Hide or label "Coming soon" |
| `listening.sources[]` selector | Hide or label "Coming soon" |
| Structured output / tool-use toggles | Hide or label "Coming soon" |
| Mobile platform flag | Label "MVP — not routing-active" |

---

## The Principle Behind This Classification

The test cannot be trusted if users or testers interact with controls that silently do nothing. Every control that a tester configures will be assumed to affect the outcome. If it does not, the test result is contaminated.

For the first E2E test to produce clean, trustworthy results:
- Every visible control must either work or be clearly labeled as non-functional.
- "Persisted but not wired" is not an acceptable middle ground for a control with a visible affordance.
- The principle is: **if you can click it, it must do something — or it must say it doesn't do something yet.**

This is especially important for AI systems where the relationship between configuration and output is already non-deterministic. Users cannot distinguish "the model was random" from "the context file I uploaded had no effect" without explicit system feedback.
