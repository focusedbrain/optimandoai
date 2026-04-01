# 05 — AI Agent Form Contract

**Status:** Analysis-only.  
**Date:** 2026-04-01  
**Scope:** Full contract analysis of the AI Agent UI, schema, and config model.

---

## Purpose

This document maps the full AI Agent configuration surface — every section, tab, field, and toggle visible in the UI — against the canonical schema, the TypeScript types, and confirmed runtime consumption. It distinguishes what is stored, what is wired into orchestration, and what is UI-only, decorative, or future-facing.

---

## Agent Creation Flow

### Entry points

1. **`openAddNewAgentDialog(parentOverlay)`** (`content-script.tsx` ~25639): simple "Add New Agent" sheet. Collects name, icon, creates the agent record in the session, then opens `openAgentConfigDialog` on the new agent.
2. **`openAgentConfigDialog(agentName, type, parentOverlay, agentScope, agentNumber)`** (~12082): full multi-tab config dialog. `agentScope` defaults to `'session'`.

### Agent identity fields (collected at creation)

| Field | UI element | Persisted? | Schema field |
|---|---|---|---|
| Name | text input | Yes → `agent.key` / `agent.name` | `name` (required) |
| Icon | icon grid picker | Yes → `agent.icon` | `icon` |
| Number | derived from `localStorage['optimando-agent-number-map']` fallback | Yes → `agent.number` | `number` |
| Scope | toggle on agent card (session / account) | Yes → `agent.scope` | — (not in CanonicalAgentConfig; runtime-only) |
| Platform | Desktop / Mobile checkboxes on card | Yes → `agent.platforms.desktop/mobile` | — (not in CanonicalAgentConfig schema) |
| Enabled | defaults to `true` on save | Yes → `agent.enabled` | `enabled` (required) |

---

## Major Tabs and Sections

The config dialog is multi-tab. The primary tab that maps to `CanonicalAgentConfig` is `type === 'instructions'`. Other tabs (`context`, `settings`, `memory`) are separate save calls that set `agent.config['context']`, `agent.config['settings']` etc. as raw JSON strings on the agent record.

### Tab: Instructions (`type === 'instructions'`)

This tab contains all Listener / Reasoning / Execution content. See `06-listener-reasoning-execution-runtime-usage.md` for detailed field analysis.

Core sections within this tab:

| Section | UI controls | Schema path |
|---|---|---|
| Capabilities | Checkboxes: Listener, Reasoning, Execution | `capabilities[]` |
| Listener | Trigger config, website, sources, expected context | `listening` |
| Reasoning | N sections — goals, role, rules, custom, applyFor | `reasoningSections[]` |
| Execution | N sections — executionMode, destinations, workflows | `executionSections[]` |

### Tab: Context (`type === 'context'`)

Contains `contextSettings` toggles and the agent context files (upload surface).

| Field | UI | Schema field | Runtime consumed? |
|---|---|---|---|
| Agent Context enabled | `#AC-agent` checkbox | `contextSettings.agentContext` | No — not read in `wrapInputForAgent` or `InputCoordinator` |
| Session Context enabled | `#AC-session` (hidden, default true) | `contextSettings.sessionContext` | No — same |
| Account Context enabled | `#AC-account` (hidden, default true) | `contextSettings.accountContext` | No — same |
| Agent Context Files | File upload / display list | `agentContextFiles[]` | **No** — persisted, not read by `wrapInputForAgent` or `processFlow` |

**Note:** `contextSettings` booleans have a default conflict. The TypeScript `toCanonicalAgent` defaults `accountContext: true`; the JSON schema defaults `accountContext: false`. The runtime does not enforce either — the field is not consumed.

### Tab: Memory (`type === 'memory'`)

Contains `memorySettings` and per-reasoning-section memory toggles.

| Field | UI | Schema field | Runtime consumed? |
|---|---|---|---|
| Session memory enabled | `R-MEM-session` checkbox | `memorySettings.sessionEnabled` | No confirmed wiring |
| Session memory read | `R-MEM-session-read` | Not in `CanonicalMemorySettings` — extra field | No |
| Session memory write | `R-MEM-session-write` | Not in `CanonicalMemorySettings` — extra field | No |
| Account memory enabled | `R-MEM-account` | `memorySettings.accountEnabled` | No confirmed wiring |
| Account memory read/write | `R-MEM-account-read/write` | Extra fields | No |
| Agent memory enabled | `R-MEM-agent` (disabled, always on) | `memorySettings.agentEnabled` | No confirmed wiring |

**Critical finding:** The form persists additional `memorySettings` fields (`sessionRead`, `sessionWrite`, `accountRead`, `accountWrite`) that are **not** in `CanonicalMemorySettings` or the JSON schema. These are form-only extensions not represented in any schema type.

### Tab: Settings (`type === 'settings'`)

UI details not fully traced in this analysis. Likely contains miscellaneous agent-level toggles. Stored as raw JSON string under `agent.config['settings']`.

---

## Global vs Session Scope

| Concept | Mechanism | Stored where |
|---|---|---|
| Session-scoped agent | Default. `agent.scope = 'session'`. Stored in `session.agents[]`. | Session blob (chrome.storage / SQLite) |
| Account-scoped agent | `toggleAgentScope` sets `agent.scope = 'account'`. `normalizeSessionAgents` strips them from `session.agents`. | Separate `accountAgents` storage via `getAccountAgents` / `saveAccountAgents` |
| Global constants | Not represented as a separate concept in current schema | — |

**`normalizeSessionAgents`** (content-script.tsx ~3151–3183): agents with `scope === 'account'` are removed from the session blob and stored separately. This means account-scoped agents do **not** travel with session exports.

---

## Desktop vs Mobile Platform Flags

Platform checkboxes (Desktop / Mobile) appear on agent cards in the agents list, **not** inside the config dialog itself.

- Stored on `agent.platforms.desktop` and `agent.platforms.mobile`.
- Not in `CanonicalAgentConfig` schema.
- Not consumed by `InputCoordinator` or `processFlow`.
- Present in UI only. **UI-only fields.**

---

## Agent Number System

- Agent numbers are managed via a `localStorage['optimando-agent-number-map']` fallback in the config dialog opener.
- The schema defines `number` as an integer linking agent to agent boxes (1–12 per JSON schema description).
- Numbers are padded to 2 digits for display (e.g. `01`, `02`).
- Agent boxes link via `agentBox.agentNumber === agent.number`.
- **Risk:** Number allocation via `localStorage` is separate from the session blob. If sessions are imported on a different machine, number conflicts can arise.

---

## Auto-Save vs Commit Save

The config dialog uses a debounced **auto-save** mechanism that writes a `draft` JSON blob to `chrome.storage.local` under an `autoSaveDraftKey`. This is separate from the final committed save.

The final committed save:
1. Collects `dataToSave` from DOM elements.
2. Calls `saveAgentConfig(agentName, agentScope, type, dataToSave, callback)`.
3. Which calls `ensureActiveSession` → finds/creates `session.agents[]` entry → sets `agent.config[configType] = configData` (raw string) → `ensureSessionInHistory` → `storageSet` → also sends `SAVE_SESSION_TO_SQLITE`.

**Agent config is stored as raw stringified JSON** under `agent.config.instructions`, `agent.config.context`, etc. — not as fully typed `CanonicalAgentConfig` at the storage level.

---

## `agentContextFiles`

- The field exists in `CanonicalAgentConfig` as `agentContextFiles?: any[]` (line 391–392).
- The UI has a file upload surface in the Context tab.
- Files are staged and persisted via `agentContextFiles` on the agent.
- **`wrapInputForAgent` does not read `agentContextFiles`** — these files are not injected into the LLM system prompt in the current WR Chat path.
- This is a **persistence-only placeholder** for future retrieval-augmented context injection.

---

## Field-by-Field Reality Check: Runtime-Backed vs UI-Only vs Unclear

| Field / Concept | Persisted | Runtime-Backed | Status |
|---|---|---|---|
| `name` | Yes | Yes — used in routing display, agent identification | **Runtime-backed** |
| `description` | Yes (inferred, in schema) | No confirmed consumption | **UI-only / future** |
| `icon` | Yes | Display only | **UI-only** |
| `number` | Yes | Yes — agent/box link via `agentNumber` | **Runtime-backed** |
| `enabled` | Yes | Yes — `InputCoordinator` skips disabled agents | **Runtime-backed** |
| `capabilities[]` | Yes | Partially — `listening` capability gates `evaluateAgentListener` (~line 210–248) | **Partially runtime-backed** |
| `listening.tags` | Yes | Yes — trigger extraction uses tag matching | **Runtime-backed** |
| `listening.expectedContext` | Yes | Yes — substring match in `evaluateAgentListener` | **Runtime-backed** |
| `listening.sources[]` | Yes | No confirmed consumption in current WR Chat path | **Unclear / future** |
| `listening.website` | Yes | Yes — `evaluateAgentListener` website filter | **Runtime-backed** |
| `listening.unifiedTriggers[]` | Yes | Yes — parsed and matched in `InputCoordinator` | **Runtime-backed** |
| `listening.exampleFiles` | Yes (schema) | No consumption found | **UI-only / future** |
| `listening.reportTo` | Yes | Yes — `findAgentBoxesForAgent` parses string to box number | **Runtime-backed** |
| `reasoningSections[].goals` | Yes | Yes — `wrapInputForAgent` reads `[Goals]` from top-level `reasoning.goals` | **Runtime-backed (top-level only)** |
| `reasoningSections[].role` | Yes | Yes — `[Role: …]` in system prompt via `wrapInputForAgent` | **Runtime-backed (top-level only)** |
| `reasoningSections[].rules` | Yes | Yes — `[Rules]` block in system prompt | **Runtime-backed (top-level only)** |
| `reasoningSections[].custom[]` | Yes | Yes — `[Context]` block in system prompt | **Runtime-backed (top-level only)** |
| `reasoningSections[].applyFor` | Yes | Yes — `matchesApplyFor` in `evaluateAgentListener` (top-level `reasoning.applyFor`) | **Partially runtime-backed** |
| `reasoningSections[].applyForList` | Yes | Yes — event-tag path only via `resolveReasoningConfig` | **Runtime-backed (event-tag path only)** |
| `reasoningSections[].acceptFrom` | Yes | **No** — not evaluated in `InputCoordinator` or `processFlow` | **UI-only / schema gap** |
| `reasoningSections[].memoryContext` | Yes | No confirmed runtime consumption | **Unclear / future** |
| `reasoningSections[].reasoningWorkflows` | Yes | No confirmed runtime consumption | **UI-only / future** |
| `executionSections[].executionMode` | Yes | No confirmed consumption — `processWithAgent` does not branch on this | **UI-only / future** |
| `executionSections[].destinations[]` | Yes | Partially — `resolveExecutionConfig` uses for event-tag path | **Partially runtime-backed** |
| `executionSections[].executionWorkflows` | Yes | No confirmed runtime consumption | **UI-only / future** |
| `contextSettings.*` | Yes | No consumption in `wrapInputForAgent` or routing | **UI-only** |
| `memorySettings.agentEnabled` | Yes | No confirmed runtime consumption | **Unclear** |
| `memorySettings.sessionEnabled` | Yes | No confirmed runtime consumption | **Unclear** |
| `memorySettings.accountEnabled` | Yes | No confirmed runtime consumption | **Unclear** |
| `memorySettings.sessionRead/Write` | Yes (form extra fields) | No — not in schema or runtime | **Form-only extension** |
| `agentContextFiles[]` | Yes | No — not injected into system prompt | **Persistence placeholder / future** |
| `agent.scope` | Yes | Partially — gates account vs session storage | **Partially runtime-backed** |
| `agent.platforms.desktop/mobile` | Yes | No — not in schema, not in routing | **UI-only** |
| `description` (inferred) | Likely | No confirmed consumption | **UI-only / future** |

---

## Abstractions That Are Strong

- **Agent identity** (name, number, enabled): well-defined, consumed consistently across routing, box linking, and session management.
- **Listener triggers** (unified trigger model, expected context, website): consistently consumed in `InputCoordinator.evaluateAgentListener`.
- **Reasoning system prompt assembly** (role, goals, rules, custom): `wrapInputForAgent` reliably assembles these into the LLM system message.
- **Agent/box number linking**: `agent.number === agentBox.agentNumber` is a clean, consistent contract.
- **Canonical schema types** (`CanonicalAgentConfig` v2.1.0, `CanonicalAgentBoxConfig` v1.0.0): well-structured, versioned, with normalization helpers.

## Abstractions That Are Underspecified or Drifting

- **Multi-section reasoning** (`reasoningSections[]`) is in the schema but the WR Chat runtime path (`wrapInputForAgent`) reads only the **top-level `agent.reasoning`** object — sections are only honored in the event-tag path.
- **`acceptFrom`**: schema field, UI field, never enforced at runtime.
- **`executionMode`**: four modes defined (`agent_workflow`, `direct_response`, `workflow_only`, `hybrid`); none are branched on in `processWithAgent`.
- **Memory and context toggles**: rich UI with read/write granularity; the schema has only three simple booleans; neither is consumed by the LLM call path.
- **`agentContextFiles`**: stored but not injected — the intended RAG-style context is absent from the runtime.
- **Platform flags** (`desktop`, `mobile`): not in canonical schema; not in routing; pure UI.
- **`accountContext` default conflict**: TS says `true`, JSON schema says `false`. Runtime consumes neither, so the conflict is dormant but will matter when context is wired.
