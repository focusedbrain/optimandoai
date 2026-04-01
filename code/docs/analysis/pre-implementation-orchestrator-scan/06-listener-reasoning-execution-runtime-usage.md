# 06 — Listener, Reasoning, and Execution: Runtime Usage Analysis

**Status:** Analysis-only.  
**Date:** 2026-04-01  
**Scope:** Contract-level analysis of the three core AI Agent sections and how they are (or are not) honored by the current orchestrator runtime.

---

## Overview

The AI Agent config model defines three orthogonal sections:

- **Listener**: when and why the agent wakes up
- **Reasoning**: how the agent thinks about its task — what context, goals, and rules it uses
- **Execution**: where and how the agent's response goes

In the intended product, these three sections are independent and composable. An agent can listen for a specific trigger, apply a particular reasoning harness based on that trigger, and route the result to a specific destination. This document traces how deeply each section is honored by the current orchestrator runtime.

---

## 1. Listener

### What the UI suggests

The Listener section defines when an agent is activated. It contains:

- **Tags / unified triggers**: `#word` or `@word` tokens that wake the agent when present in input
- **Trigger type**: direct tag, tag-and-condition, workflow condition, DOM event, DOM parser, augmented overlay, agent, miniapp, manual
- **Trigger conditions**: `body_keywords`, `excludeKeywords`, optional semantic conditions
- **Expected context**: free-form keyword substring that must be present
- **Listening sources**: `all`, `chat`, `voice`, `email`, `screenshot`, `dom`, `api`, etc. (14 source types)
- **Website filter**: URL pattern that restricts activation to a specific site
- **Report-to**: string destinations like "Agent Box 01"
- **Example files**: `CanonicalListener.exampleFiles` (schema field, no UI description found)

### What the code currently does

**Primary path: `InputCoordinator.evaluateAgentListener` (lines 210–426)**

Evaluation order:
1. **Capability check** (210–248): if agent lacks `listening` capability or listener is inactive → `matchType: 'no_listener'`. Crucially, this still returns `matchesApplyFor: true` — meaning agents without a listener are forwarded to reasoning anyway.
2. **Website filter** (251–264): if `listening.website` is set and does not match `currentUrl` → `matchType: 'none'`.
3. **Trigger matching** (266–381): extracts `#word` / `@word` tokens from input; matches against unified triggers + `checkTriggerKeywords`; supports legacy passive/active branches for old-format agents. Success → `passive_trigger` or `active_trigger`.
4. **Expected context** (383–396): substring match of `listening.expectedContext` in raw input → `expected_context`.
5. **`applyFor` (reasoning input type)** (398–413): if `reasoning.applyFor` is set and not `__any__`, checks input type (text/image/mixed) → `apply_for`.
6. **Default no-match** (415–425): `matchType: 'none'`.

### What is currently missing

- **`listening.sources`**: The 14 source types (voice, email, screenshot, DOM, API, etc.) are defined in the schema and rendered in the UI but are **not evaluated** in `evaluateAgentListener`. There is no routing path that checks `ClassifiedInput.source` against `listening.sources`.
- **`listening.exampleFiles`**: Schema field only. Not consumed anywhere.
- **DOM trigger types** (`dom_event`, `dom_parser`, augmented overlay): defined in `TriggerTypeValues` but no confirmed runtime handler for these in the current WR Chat path.
- **Re-routing after OCR**: OCR-enriched text (from `processMessagesWithOCR`) appends to message content **after** `routeClassifiedInput` has run. Listener matching is performed on pre-OCR text.

### Listener wake-up logic (confirmed)

```
Input arrives →
  nlpClassifier.classify(rawText) → ClassifiedInput (triggers extracted)
  inputCoordinator.routeClassifiedInput(classifiedInput) →
    per agent: evaluateAgentListener →
      website filter → trigger name match → keyword check → expected context → applyFor
```

Trigger names are `#word` tokens extracted by NLP from raw text. The unified trigger model matches these names against `agent.listening.unifiedTriggers[].name` (case-insensitive). The event-tag path (`routeEventTagTrigger`) is a separate mechanism for structured `#tag`-type event routing; it is not part of the primary WR Chat send flow in the current implementation.

---

## 2. Reasoning

### What the UI suggests

The Reasoning section is the "thinking harness" for the agent. It defines:

- **Apply-for** (`applyFor` / `applyForList`): which trigger or input type activates this reasoning section
- **Goals**: what the agent is trying to accomplish
- **Role**: the system persona ("You are a...")
- **Rules**: constraints and behavioral guardrails
- **Custom fields**: arbitrary key/value context injected as `[Context]` in the prompt
- **Memory & context toggles**: session/account/agent memory read/write flags
- **Reasoning workflows**: structured automation sequences (future)
- **`acceptFrom`**: source agent filter (defined, never enforced)
- **Multiple sections** (`reasoningSections[]`): different reasoning configs per trigger/context

### What the code currently does

**Primary path: `wrapInputForAgent` (`processFlow.ts` lines 1089–1132)**

```
wrapInputForAgent(input, agent, ocrText?) →
  reads agent.reasoning (TOP-LEVEL ONLY):
    [Role: {role}]
    [Goals]
      {goals}
    [Rules]
      {rules}
    [Context]
      {custom[0].key}: {custom[0].value}
      ...
    [User Input]
      {input}
    [Extracted Image Text]  (if ocrText)
      {ocrText}
```

This assembled string becomes the **`role: 'system'` message content** in the LLM call inside `processWithAgent` (sidepanel.tsx ~2505–2514):

```javascript
messages: [
  { role: 'system', content: reasoningContext },
  ...processedMessages.slice(-3)
]
```

**Critical finding**: `wrapInputForAgent` reads `agent.reasoning` — a **flat top-level object** on the `AgentConfig` type (processFlow.ts lines 170–222). It does **not** iterate `agent.reasoningSections[]`. The `reasoningSections[]` array (the canonical multi-section structure) is only honored in the **event-tag path** via `resolveReasoningConfig`.

### How reasoning maps into orchestration

| Reasoning field | Consumed where | How |
|---|---|---|
| `reasoning.role` | `wrapInputForAgent` | Prepended as `[Role: ...]` in system message |
| `reasoning.goals` | `wrapInputForAgent` | `[Goals]` block |
| `reasoning.rules` | `wrapInputForAgent` | `[Rules]` block |
| `reasoning.custom[]` | `wrapInputForAgent` | `[Context]` block |
| `reasoning.applyFor` | `evaluateAgentListener` | Input-type gating (text/image/mixed) |
| `reasoningSections[].applyForList` | `resolveReasoningConfig` (event-tag only) | Section selection by trigger ID |
| `reasoningSections[].memoryContext` | No confirmed consumption | — |
| `reasoningSections[].reasoningWorkflows` | No confirmed consumption | — |
| `reasoning.acceptFrom` | **Never** | Not in `evaluateAgentListener` or `processWithAgent` |

### What is currently missing for reliable reasoning

1. **Multi-section reasoning is not wired into WR Chat path**: `reasoningSections[]` exist in the schema and UI, but the WR Chat path reads only `agent.reasoning` (flat). Adding a second reasoning section in the UI has no runtime effect via WR Chat.
2. **`acceptFrom` is completely unimplemented**: Schema, UI, and types all define it; zero runtime enforcement.
3. **`memoryContext` toggles have no runtime effect**: The schema supports per-section memory context; it is not read by `wrapInputForAgent` or any confirmed downstream consumer.
4. **`agentContextFiles` not injected**: The intent appears to be RAG-style context injection; currently `wrapInputForAgent` does not read these files.
5. **`reasoningWorkflows`**: Defined in schema; not consumed.

---

## 3. Execution

### What the UI suggests

The Execution section defines **where and how** agent output is delivered:

- **`executionMode`**: one of `agent_workflow`, `direct_response`, `workflow_only`, `hybrid`
- **Destinations** (`CanonicalDestination[]`): `agentBox`, `chat`, `email`, `webhook`, `storage`, `notification`
- **`executionWorkflows`**: structured automation sequences (future)
- **`applyFor` / `applyForList`**: which trigger this execution section applies to
- **`specialDestinations`**: parsed in `resolveExecutionConfig` to determine output routing

### What the code currently does

**Primary path: `processWithAgent` + `updateAgentBoxOutput` (sidepanel.tsx ~2468–2533, processFlow.ts ~1137–1195)**

The execution section's runtime role is almost entirely determined by **which Agent Box was resolved** during listener matching:

1. `findAgentBoxesForAgent` → identifies the target Agent Box (by `agentNumber` / `specialDestinations` / `reportTo`)
2. Box identifier is carried on `AgentMatch.agentBoxId` / `agentBoxNumber`
3. `updateAgentBoxOutput` writes LLM output to the DOM element and `chrome.storage.local` for that box

**`executionMode` is not evaluated**: `processWithAgent` does not branch on `executionMode`. All executions follow the same path regardless of whether the mode is `direct_response`, `agent_workflow`, `workflow_only`, or `hybrid`.

**Event-tag path: `resolveExecutionConfig` (InputCoordinator ~1239–1362)**

The event-tag path does honor execution sections. It:
1. Selects the applicable `executionSection` by `applyForList` / trigger ID
2. Builds a typed `reportTo: OutputDestination[]` from `specialDestinations`, `listening.reportTo`, found Agent Boxes, or defaults to `inline_chat`
3. Returns structured execution config including `applyFor`, `workflows`, `reportTo`

But the WR Chat primary path does **not** call `resolveExecutionConfig`.

### Destination logic (confirmed)

**WR Chat path** (routeClassifiedInput, ~705–712):
```javascript
destination: primaryBox 
  ? `Agent Box ${String(primaryBox.boxNumber).padStart(2, '0')}`
  : agent.listening?.reportTo?.[0] || 'Inline Chat'
```

**Event-tag path** (`resolveExecutionConfig`):
- Iterates `specialDestinations` (kind: `agentBox` / `wrChat` / `inlineChat`)
- Parses `listening.reportTo` string like "Agent Box 01" → box number
- Falls back to first connected box via `findAgentBoxesForAgent`
- Falls back to `{ type: 'inline_chat', label: 'Inline Chat' }`

### What is currently missing

1. **`executionMode` is ignored in WR Chat path**: No branching on `direct_response` vs `agent_workflow` vs `hybrid`.
2. **Non-box destinations are unimplemented**: `email`, `webhook`, `storage`, `notification` destination kinds are defined in the schema but `resolveExecutionConfig` and `updateAgentBoxOutput` only handle box/chat destinations.
3. **`executionWorkflows` not consumed**: Defined, not wired.
4. **WR Chat path does not call `resolveExecutionConfig`**: The richer typed destination resolution only runs on the event-tag path.

---

## Does the Current Orchestrator Actually Honor the Conceptual Separation Between Listener, Reasoning, and Execution?

**Short answer: partially, and inconsistently across routing paths.**

### What IS honored

| Separation | Honored? | Where |
|---|---|---|
| Listener gates activation | **Yes** | `evaluateAgentListener` correctly uses only `listening.*` to decide whether to activate an agent |
| Reasoning provides LLM system prompt | **Yes** | `wrapInputForAgent` uses only `reasoning.*` fields; no listener or execution fields bleed in |
| Execution routes output to Agent Box | **Partially** | Box routing works; destination type, mode, and workflow do not |

### What is NOT honored

**1. Multi-section reasoning is flattened in WR Chat path.**
The schema allows per-trigger reasoning sections (`reasoningSections[]` with `applyForList`). In the WR Chat path, only the flat top-level `agent.reasoning` is read. A user can configure three reasoning sections in the UI; all are ignored.

**2. Execution mode is never used.**
`executionMode: 'direct_response'` vs `'agent_workflow'` has no behavioral difference in the current runtime. There is no branching code.

**3. The two routing paths are not equivalent.**
- **WR Chat path** (`routeClassifiedInput` → `processWithAgent`): reads flat `agent.reasoning`, simple destination resolution, no section selection.
- **Event-tag path** (`routeEventTagTrigger` → `processEventTagMatch`): honors `reasoningSections[].applyForList`, calls `resolveReasoningConfig` and `resolveExecutionConfig`, supports typed destination arrays.

The intended system treats the three sections as a unified composable contract. The current system implements that contract only on the event-tag path, and a simpler flat reading on the primary WR Chat path.

**3. `acceptFrom` creates a phantom contract.**
The concept "this agent only accepts input from agent X" is in the schema, in the UI, and in the type definitions. It is never evaluated. An agent configured with `acceptFrom = 'AgentA'` will still receive all routed inputs.

### Diagram: Intended vs Actual

```
INTENDED:
Input → Listener (wake up?) → Reasoning (which section? apply-for?) → Execution (which mode? which destination?)

ACTUAL (WR Chat path):
Input → Listener (wake up? — partial, sources not checked) 
      → Reasoning (flat agent.reasoning only, no section selection) 
      → Execution (box number resolution only, no mode, no typed destinations)

ACTUAL (Event-tag path):
Input → Listener (tag match) 
      → Reasoning (resolveReasoningConfig honors sections + applyForList) 
      → Execution (resolveExecutionConfig builds typed destinations)
```

The event-tag path is architecturally closer to the intended design. The WR Chat path is a simpler, earlier implementation that was not updated as the schema evolved.

---

## Memory and Context Toggles — Runtime Meaning

| Toggle | Location | What the UI suggests | Runtime effect |
|---|---|---|---|
| Session memory enabled | `memorySettings.sessionEnabled` | Agent can read/write session memory | **None** — not consumed |
| Account memory enabled | `memorySettings.accountEnabled` | Agent can access account-level memory | **None** |
| Agent memory enabled | `memorySettings.agentEnabled` (always on in UI) | Agent-local memory | **None** |
| Per-section memory context | `reasoningSections[].memoryContext` | This section should include memory context in its prompt | **None** |
| Agent context enabled | `contextSettings.agentContext` | Agent context files are injected | **None** |
| Session context | `contextSettings.sessionContext` | Session-level context shared | **None** |
| Account context | `contextSettings.accountContext` | Account-level context shared | **None** |

All memory and context toggles are persisted to the session blob but have zero confirmed runtime wiring. They represent the intended architecture for a memory/RAG layer that does not yet exist in the runtime.
