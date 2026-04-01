# 11 — Runtime-Backed vs Persisted-Only Controls

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–2 (docs 01–08)  
**Focus:** For every major control in the AI Agent form and Agent Box form — classify as must be runtime-backed, may remain persisted-only, or should be hidden/disabled if not yet wired.

---

## Classification Key

| Class | Meaning |
|---|---|
| **Runtime-backed (E2E required)** | This control must influence runtime behavior for the first E2E tests to be valid. Not wiring it invalidates test results. |
| **Runtime-backed (post-E2E)** | This control must eventually be wired, but its absence does not prevent the first E2E test suite from running. |
| **Persisted-only (acceptable)** | The control may be saved without runtime effect for now. Its absence from runtime does not mislead users during first tests. |
| **Persisted-only (dangerous)** | The control is saved but not wired. Its visible, active-looking UI creates false user expectations. It contaminates test results. Must be hidden or labeled. |
| **Hidden / disabled** | The control should not be visible in the UI until it is wired. Showing it implies it works. |

---

## AI Agent Form Controls

---

### Identity and Activation

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Agent name | `agent.name`, `agent.key` | **Runtime-backed (E2E required)** | Used for display, agent card identification, and routing logs |
| Agent enabled toggle | `agent.enabled` | **Runtime-backed (E2E required)** | `InputCoordinator` skips disabled agents — this is a live gate |
| Agent number | `agent.number` | **Runtime-backed (E2E required)** | Links agent to Agent Box via `agentNumber` matching — must be correct |
| Agent icon | `agent.icon` | Persisted-only (acceptable) | Display only; no routing or reasoning effect |
| Agent scope toggle (session/account) | `agent.scope` | Persisted-only (acceptable) | First tests use session-scoped agents only |
| Platform flags (desktop/mobile) | `agent.platforms.desktop/mobile` | **Hidden/disabled** | Not in canonical schema; not evaluated. Showing it implies routing based on platform. |

---

### Listener Section

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Listener enabled toggle | `capabilities.listening` | **Runtime-backed (E2E required)** | If disabled, the agent never activates via listener logic |
| Trigger keyword(s) | `listening.triggers[]` | **Runtime-backed (E2E required)** | The primary matching mechanism. Without this working, no agent activates. |
| Website filter | `listening.website` | **Runtime-backed (E2E required)** | If set, restricts activation to the configured site. Evaluated in `evaluateAgentListener`. |
| Expected context | `listening.expectedContext` | **Runtime-backed (E2E required)** | Substring check in raw text. Evaluated in `evaluateAgentListener`. Works today. |
| `applyFor` input type | `listening.applyFor` (or `reasoning.applyFor`) | **Runtime-backed (E2E required)** | Controls whether agent activates for text, image, or both. Evaluated today. |
| Listening sources | `listening.sources[]` | **Persisted-only (dangerous)** | 14 source types defined in schema; none evaluated at runtime. If a user sets `sources: ['screenshot']`, the agent fires on all inputs — the source constraint is silently ignored. Must be labeled "not yet active" or hidden. |
| `acceptFrom` (agent chaining) | `listening.acceptFrom` | **Persisted-only (dangerous)** | Multi-agent handoff. Field defined; never evaluated. Showing it implies chaining works. Label "coming soon" or hide. |
| Example files / training data | `listening.exampleFiles` | **Hidden/disabled** | Schema field. No UI affordance found. If shown anywhere, hide it. |
| DOM trigger types | `listening.triggers[].type === 'dom_event'` etc. | **Hidden/disabled** | No confirmed runtime handler. Configuring a DOM trigger does nothing. |

---

### Reasoning Section

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Reasoning enabled toggle | `capabilities.reasoning` | **Runtime-backed (E2E required)** | If disabled, the reasoning section is bypassed |
| Role | `agent.role` | **Runtime-backed (E2E required)** | Appears directly in system prompt via `wrapInputForAgent`. Wired today. |
| Goals | `agent.goals` | **Runtime-backed (E2E required)** | Appears directly in system prompt. Wired today. |
| Rules | `agent.rules` | **Runtime-backed (E2E required)** | Appears directly in system prompt. Wired today. |
| Custom fields | `agent.config.custom` | **Runtime-backed (E2E required)** | Appears in system prompt as key-value pairs. Wired today. |
| Flat `agent.reasoning` text | `agent.reasoning` | **Runtime-backed (E2E required)** | The primary flat reasoning field currently consumed by `wrapInputForAgent`. |
| Multi-section reasoning tabs | `reasoningSections[]` | **Persisted-only (dangerous)** | Schema supports per-trigger sections; WR Chat path ignores them, reads flat only. If sections can be configured in the UI, users will believe per-trigger reasoning is active. Must be labeled "coming in next phase" or collapsed to show only the flat field. |
| Context files upload | `agentContextFiles[]` | **Persisted-only (dangerous)** | Files are saved; `wrapInputForAgent` never reads them. Must be labeled "not yet injected" or hidden. This is one of the most misleading controls in the system. |
| Memory settings (session/account/agent toggles) | `memorySettings.*` | **Persisted-only (dangerous)** | All memory toggles saved; none consumed at runtime. Must be hidden or labeled "not yet active." |
| Context settings (agentContext/sessionContext/accountContext) | `contextSettings.*` | **Persisted-only (dangerous)** | Same as memory — saved, never consumed. |
| WR Experts section | (if in agent form) | **Hidden/disabled** | Name collision with email WRExpert.md. No confirmed integration point in agent form. If shown in the agent form, it must be clearly labeled as not the email WR Expert, and noted as "not yet injected." |

---

### Execution Section

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Execution enabled toggle | `capabilities.execution` | **Runtime-backed (post-E2E)** | Currently, the execution path runs regardless of this toggle (output goes to box unconditionally). For first E2E, acceptable. |
| Execution mode selector | `executionSection.mode` (4 modes) | **Persisted-only (dangerous)** | 4 modes: `agent_workflow`, `direct_response`, `workflow_only`, `hybrid`. None are branched on in `processWithAgent`. The current behavior is always `direct_response` to box. If selector is shown, label "mode not yet active." |
| Output destination(s) | `executionSection.destinations[]` | **Persisted-only (dangerous)** | Non-box destinations (email, webhook, storage, notification) not implemented. Box destination works (the only one). Hide non-box options or label "coming soon." |
| Execution workflows | `executionSection.workflows[]` | **Hidden/disabled** | Schema field. Not consumed anywhere. If shown in UI, hide it. |
| Streaming output toggle | (if present) | **Hidden/disabled** | Not implemented. Showing it implies streaming works. |
| Structured output / schema output | (if present) | **Hidden/disabled** | Not implemented. |
| Tool-use / function-calling | `tools[]` on AgentBox | **Hidden/disabled** | Placeholder array. Not connected to any runtime tool execution. |

---

## Agent Box Form Controls

---

### Brain Configuration

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Provider selector | `agentBox.provider` | **Runtime-backed (E2E required)** | Determines which API endpoint is called. After HF-1+HF-2, local works. After Phase 3, cloud works. |
| Model selector | `agentBox.model` | **Runtime-backed (E2E required)** | Model name passed directly to LLM request. After Phase 0, configured model is the model that runs. |
| Agent assignment | `agentBox.agentNumber` | **Runtime-backed (E2E required)** | Links box to agent. Used by `findAgentBoxesForAgent`. If unset or wrong, output has no destination. |
| Box number / slot | `agentBox.boxNumber` | **Runtime-backed (E2E required)** | Identifies which slot the box occupies. Used for display and multi-box disambiguation. |

---

### Surface and Position

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Surface (sidepanel vs grid) | `agentBox.surface` | **Runtime-backed (E2E required)** | After Phase 1, `surface` is used to route `OutputEvent` to the correct handler. Must be set correctly at creation. |
| Grid position (row/col) | `agentBox.gridPosition` | **Runtime-backed (post-E2E)** | Determines which visual slot in the grid the box occupies. Required for correct visual placement but not for first routing test. |
| Box label / display name | (if present) | Persisted-only (acceptable) | Display only. |

---

### Tools and Special Modes

| Control | Field(s) | Classification | Reason |
|---|---|---|---|
| Tools list | `agentBox.tools[]` | **Hidden/disabled** | Placeholder array. No tool execution wired. |
| Structured output schema | (if present) | **Hidden/disabled** | Not implemented. |
| Streaming mode toggle | (if present) | **Hidden/disabled** | Not implemented. |
| Output identifier (`outputId`) | `agentBox.outputId` | **Persisted-only (acceptable)** | May be used for future multi-box fan-out or direct DOM injection. No current runtime effect. |
| Special destinations | `agentBox.specialDestinations` | Persisted-only (acceptable) | Used by `findAgentBoxesForAgent` as a priority path — may already influence routing. Verify, then classify as runtime-backed if confirmed. |

---

## Summary: "Show It or Hide It" Decision Table

For implementation: every row marked **Hidden/disabled** or **Persisted-only (dangerous)** needs a UI action before user testing begins.

| Control | Action Required |
|---|---|
| Platform flags (desktop/mobile) | Hide from agent cards |
| `listening.sources[]` | Hide or label "Source filtering not yet active" |
| `acceptFrom` | Hide or label "Agent chaining not yet active" |
| DOM trigger types | Remove from trigger type selector |
| Multi-section reasoning tabs | Collapse to flat reasoning field; label "Per-trigger sections coming next phase" |
| Context files upload | Hide or label "File injection not yet active — files are saved but not yet used" |
| Memory settings toggles | Hide or label "Memory not yet active" |
| Context settings toggles | Hide or label "Context controls not yet active" |
| WR Experts in agent form | Remove or relabel clearly (not the email WR Expert) |
| Execution mode selector | Label "Mode selection not yet active — all output goes to Agent Box" |
| Non-box execution destinations | Hide or label "Coming soon" |
| Execution workflows | Hide |
| Streaming output toggle | Hide |
| Structured output | Hide |
| Tool-use list | Hide |
| Tools list on Agent Box | Hide |
| Structured output schema on Agent Box | Hide |

---

## The Test Contamination Risk

Every control marked **Persisted-only (dangerous)** is a source of test contamination. If a tester:
- Enables session memory → `memorySettings.sessionEnabled = true` → agent behaves identically
- Uploads a context file → `agentContextFiles = [...]` → agent behaves identically
- Selects "agent_workflow" execution mode → `executionMode = 'agent_workflow'` → agent behaves identically (still goes to box)

…they will attribute any output variation to these settings. When the variation is actually from model non-determinism, they will draw false conclusions about which controls are working. This is not a theoretical risk — it will happen in first-pass testing if the UI is left in its current state.

**The action is not to implement these features before testing. The action is to hide them so they cannot be touched before testing.**
