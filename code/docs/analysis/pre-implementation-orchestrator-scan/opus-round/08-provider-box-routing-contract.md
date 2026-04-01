# 08 — Provider, Box, and Routing Contract

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Round Prompt 2 — runtime contracts  
**Focus:** How an agent gets its brain. How providers and models are resolved. How cloud and local are represented. How box identity survives sidepanel/grid equivalence. How output targets one or many boxes.

---

## Framing

This document defines the required runtime contracts — not code patches. These contracts are the authoritative reference for the questions: "What should the system do here?" and "How should this concept be represented?" Implementation may choose the best code path to satisfy these contracts.

---

## Contract 1: How an Agent Gets Its Brain

### The Question

When an agent activates in response to user input, what determines which brain (provider + model) executes?

### Current State

The current chain is:
1. `findAgentBoxesForAgent(agentNumber, boxes)` returns the first matched box
2. `AgentMatch.agentBoxProvider` and `AgentMatch.agentBoxModel` are set from that box
3. `resolveModelForAgent(provider, model)` attempts to map provider string to a call configuration
4. The provider string `'Local AI'` is not recognized → fallback model used

The Agent Box is intended to be the brain container. The intent is correct. The implementation is broken at step 3.

### Required Contract

An agent gets its brain through its assigned Agent Box. The contract is:

```
Agent → AgentNumber → AgentBox (by agentNumber match) → ProviderId + ModelId → LLMCallConfig
```

Every step is explicit and typed. No step produces a fallback silently.

**Step 1: Agent → AgentNumber**  
An agent's number (`agent.number`) is its stable identity across the session. It is assigned at creation and does not change. This is already correctly implemented.

**Step 2: AgentNumber → AgentBox**  
`findAgentBoxesForAgent` resolves the box by matching `agentNumber`. This is already correctly implemented, with fallback paths for `reportTo` strings and `specialDestinations`. The only issue is the source of boxes it searches — must be the canonical store (resolved by NB-5).

**Step 3: AgentBox → ProviderId + ModelId**  
The Agent Box fields `provider` and `model` are read directly. `provider` must be a `ProviderId` constant — not a UI display label. This conversion must happen at save time, not resolve time.

```
AgentBox.provider: ProviderId   // 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'grok'
AgentBox.model: string          // exact model identifier, e.g. 'llama3.2:3b', 'gpt-4o'
```

**Step 4: ProviderId + ModelId → LLMCallConfig**  
This is the brain resolution contract. It is not a string comparison — it is a dispatch:

```typescript
function resolveBrain(provider: ProviderId, model: string, keyStore: ApiKeyStore): BrainResolution

type BrainResolution =
  | { ok: true; config: LLMCallConfig }
  | { ok: false; error: BrainResolutionError }

interface LLMCallConfig {
  provider: ProviderId;
  model: string;
  endpoint: 'local' | 'cloud';   // determines Electron routing
  apiKey?: string;               // required for cloud; absent for local
}

type BrainResolutionError =
  | { code: 'no_key'; provider: ProviderId }
  | { code: 'local_unavailable' }
  | { code: 'unsupported_provider'; provider: string }
  | { code: 'no_box_assigned'; agentNumber: number }
```

**The contract guarantee:** `resolveBrain` never returns a different model than what was configured. It either returns the configured model with a valid call configuration, or it returns a typed error. The caller decides what to do with the error (display to user, skip execution, etc.).

---

## Contract 2: How a Provider/Model Should Be Resolved

### The Provider Identity Contract

A provider is identified by a `ProviderId` — a lowercase, hyphen-free string constant. `ProviderId` is the only string that travels through the runtime. UI display labels are strictly presentation-layer and are never stored or compared at runtime.

```
ProviderId values:
  'ollama'      → local Ollama (any model)
  'openai'      → OpenAI API
  'anthropic'   → Anthropic API
  'gemini'      → Google Gemini API
  'grok'        → xAI Grok API
```

**Conversion rule:** UI display label → `ProviderId` conversion happens exactly once — when the user saves an Agent Box configuration. The stored value is `ProviderId`. Reading the stored value requires no conversion.

**Enforcement:** `CanonicalAgentBoxConfig.provider` is typed as `ProviderId`. Any UI code that saves a box must pass through a conversion function:

```typescript
function toProviderId(uiLabel: string): ProviderId | null {
  const map: Record<string, ProviderId> = {
    'Local AI': 'ollama',
    'OpenAI': 'openai',
    'Anthropic': 'anthropic',
    'Gemini': 'gemini',
    'Grok': 'grok',
    'Grok / xAI': 'grok',
    // ... additional aliases for robustness
  };
  return map[uiLabel] ?? null;
}
```

If `toProviderId` returns `null`, the save is rejected with a visible error — it does not silently store a string that the runtime won't recognize.

### The Model Identity Contract

A model identifier is an opaque string. The runtime passes it verbatim to the LLM backend. The backend is responsible for knowing whether the model identifier is valid for the given provider.

```
Local models: exact Ollama name, e.g. 'llama3.2:3b', 'qwen2.5:7b'
Cloud models: provider-specific ID, e.g. 'gpt-4o', 'claude-3-5-sonnet-20241022'
```

The model string displayed in the Agent Box selector is the same string stored and passed to the LLM call. No transformation.

### The Key Store Contract

API keys are stored in one canonical location accessible to both the extension and the Electron backend:

```
Canonical key store: SQLite orchestrator store, keyed by ProviderId
  key: 'api_key_openai'   value: 'sk-...'
  key: 'api_key_anthropic' value: 'sk-ant-...'
  etc.
```

The extension's settings UI writes to this store via the adapter chain (same path as session data). Electron reads from it directly. No `localStorage['optimando-api-keys']` for cloud keys.

```typescript
interface ApiKeyStore {
  getKey(provider: ProviderId): Promise<string | null>;
  setKey(provider: ProviderId, key: string): Promise<void>;
  hasKey(provider: ProviderId): Promise<boolean>;
}
```

`resolveBrain` calls `keyStore.getKey(provider)`. If `null` → `{ ok: false, error: { code: 'no_key', provider } }`.

---

## Contract 3: How Cloud vs Local Is Represented

### The Distinction

Cloud and local are not different types. They are different dispatch targets for the same `LLMCallConfig`. The `endpoint` field on `LLMCallConfig` determines routing:

```typescript
interface LLMCallConfig {
  provider: ProviderId;
  model: string;
  endpoint: 'local' | 'cloud';
  apiKey?: string;
}
```

`endpoint: 'local'` → Electron routes to Ollama. No API key needed.  
`endpoint: 'cloud'` → Electron routes to the provider's API. `apiKey` required.

The `endpoint` field is derived from `ProviderId`:

```typescript
function getEndpoint(provider: ProviderId): 'local' | 'cloud' {
  return provider === 'ollama' ? 'local' : 'cloud';
}
```

This is the complete distinction. There is no need for separate code paths, separate message types, or separate UI treatment beyond the key requirement.

### The Electron Routing Contract

Electron's `/api/llm/chat` endpoint receives `LLMCallConfig` and routes based on `provider`:

```
POST /api/llm/chat
{
  "provider": "openai",
  "model": "gpt-4o",
  "endpoint": "cloud",
  "apiKey": "sk-...",
  "messages": [...]
}

Electron dispatch:
  provider === 'ollama'    → Ollama.chat(model, messages)
  provider === 'openai'    → OpenAI.chat(apiKey, model, messages)
  provider === 'anthropic' → Anthropic.chat(apiKey, model, messages)
  provider === 'gemini'    → Gemini.chat(apiKey, model, messages)
  provider === 'grok'      → xAI.chat(apiKey, model, messages)
  default                  → { error: 'unsupported_provider' }
```

Adding a new provider is one dispatch case in Electron and one entry in `PROVIDER_IDS`. Nothing else changes.

### API Key Visibility in the UI

The Agent Box provider selector must gate cloud providers by key availability:

```
If hasKey('openai') === false:
  OpenAI option → shown but labeled "Requires API key" or dimmed
  OR hidden entirely until key is added
```

The decision between "show with warning" and "hide until key added" is a UX choice. Either is acceptable provided the user cannot select a cloud provider, configure a model, and then see silent Ollama fallback. The contract is: **no cloud provider activates silently without a key**.

---

## Contract 4: How Box Identity Survives Sidepanel/Grid Equivalence

### The Problem

Sidepanel boxes and grid boxes are the same schema type (`CanonicalAgentBoxConfig`) but are currently different runtime citizens. Their identity (for routing and output delivery) depends on `boxId` — but the stores that hold them are different.

### The Box Identity Contract

A box's identity is its `id` field — a stable UUID assigned at creation. This identity must survive across:
- Session reloads
- Surface changes (a box moved from sidepanel to grid)
- Storage adapter changes (chrome.storage to SQLite)

```typescript
interface CanonicalAgentBoxConfig {
  id: string;              // UUID, stable identity — NEVER reassigned
  boxNumber: number;       // user-visible slot number
  agentNumber: number;     // links to the agent this box serves
  provider: ProviderId;    // normalized — not UI label
  model: string;
  surface: 'sidepanel' | 'grid';   // which display surface owns this box
  gridPosition?: { row: number; col: number };   // grid placement if surface === 'grid'
  // ... other config fields
}
```

The `surface` field is new but required for the output delivery contract. When routing finds a box, it knows whether to send `UPDATE_AGENT_BOX_OUTPUT` to a sidepanel handler or a grid handler.

### The Canonical Box Store

There is one canonical box store. All boxes — regardless of surface — are read from and written to the same store. The store is:

```
When Electron running: SQLite (via storageWrapper adapter)
When Electron not running: chrome.storage.local
```

This is the same rule as session data. Box records are part of the session blob, stored under the session key.

**Write path (all surfaces):**  
UI (sidepanel dialog or grid dialog) → sends box config → service worker → `storageWrapper.setItem(sessionKey, updatedSession)` → adapter chain

**Read path (routing):**  
`loadAgentBoxesFromSession` → `storageWrapper.getItem(sessionKey)` → returns all boxes for active session, regardless of surface

There is no surface-specific write path. The `surface` field on the box config tells the output delivery layer where to send the output — but it does not determine which store the box lives in.

### Box Registration for Live Output

Grid pages must register their rendered box slots with the message channel on mount:

```javascript
// On grid page mount
chrome.runtime.sendMessage({
  type: 'REGISTER_BOX_SLOT',
  boxId: '<uuid>',
  surface: 'grid'
});

// And listen for output
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_AGENT_BOX_OUTPUT' && msg.target.boxId === boxId) {
    updateBoxDOM(msg.content, msg.status);
  }
});
```

The sidepanel React component already does an equivalent of this — it maintains `agentBoxes` state and updates on `UPDATE_AGENT_BOX_OUTPUT`. The grid page must implement the same pattern in plain JS.

---

## Contract 5: How Output Targets One Box, Multiple Boxes, or Inline Chat

### The Output Target Resolution Contract

Every matched agent produces exactly one `OutputTarget`. The target is resolved during routing — not during output delivery. By the time output delivery runs, the target is already known.

```typescript
interface OutputTarget {
  type: 'box' | 'inline_chat';
  boxId?: string;              // present when type === 'box'
  surface?: 'sidepanel' | 'grid';  // present when type === 'box'
  agentNumber: number;
  boxNumber?: number;
}
```

**Resolution priority for box targets:**
1. `specialDestinations` on the agent (explicit box assignments by label)
2. `reportTo` string parse (agent config field)
3. First box with matching `agentNumber`
4. If no box found → `type: 'inline_chat'`

**No silent drop.** If a box cannot be found for a matched agent, the output must go to inline chat (the user sees a response) or a visible error must be shown. It must never silently disappear.

### Single Box Output

The default case: one agent → one box. One `AgentMatch` → one `OutputTarget` → one `OutputEvent` sent. The box with matching `boxId` renders the output.

### Multiple Boxes for One Agent

Not required for the first pass but the contract must not prevent it. The routing result can return multiple matches for one agent if `findAgentBoxesForAgent` returns multiple boxes. Each match produces its own `AgentMatch` with its own `OutputTarget`. The execution loop runs once per `AgentMatch` — each producing its own LLM call and its own `OutputEvent`.

**Note:** Multiple LLM calls for one user input is expensive and likely not the intended behavior for most agents. The routing logic should return a primary box and allow multi-box fan-out as an opt-in behavior. This is a future concern — but the `AgentMatch` type should be designed to allow it.

### Multiple Agents Matching the Same Input

Multiple agents can match the same input (e.g., two agents with overlapping triggers). This is already handled: the execution loop iterates all matched agents sequentially. Each runs its own LLM call with its own box. This is intentional — the orchestrator is designed for multi-agent output.

The output contract for this case is unchanged: each `AgentMatch` → one `OutputEvent` → one box update. No agent's output is combined with another's before delivery.

### Inline Chat (No Box Assigned)

When no box is found for a matched agent, output goes to inline chat:

```typescript
interface OutputTarget {
  type: 'inline_chat';
  agentNumber: number;
}
```

The sidepanel renders this as a regular chat message. The grid is not involved. This is the fallback for session configurations where agents exist but boxes have not been assigned.

**Important:** `type: 'inline_chat'` is not an error state. It is a valid output target for the initial setup where users have configured agents but not yet assigned Agent Boxes. The system should be usable in this state.

### The OutputEvent Message Contract

Every output delivery — regardless of target type or surface — uses the same event structure:

```typescript
interface OutputEvent {
  type: 'UPDATE_AGENT_BOX_OUTPUT';
  turnId: string;                // links to originating TurnInput
  agentRunId: string;            // unique per agent execution within the turn
  target: OutputTarget;
  content: string;
  status: 'complete' | 'streaming' | 'error';
  errorMessage?: string;
  timestamp: number;
}
```

**Subscribers:**
- Sidepanel: existing `chrome.runtime.onMessage` handler — updated to use `OutputEvent` type
- Grid pages: new `chrome.runtime.onMessage` handler — added per NB-6 normalization
- Both filter by `target.surface` ('sidepanel' vs 'grid') to avoid cross-surface noise

**For inline chat:** `type: 'inline_chat'` targets are handled by the existing chat message list update in sidepanel — no box update needed.

---

## Contract Dependency Map

```
TurnInput
    ↓ (OCR enrichment)
EnrichedInput
    ↓ (routing)
RoutingDecision
    ├── AgentMatch[]
    │       ├── agent identity
    │       ├── triggeredBy (for reasoning section selection)
    │       ├── ProviderId (normalized at routing time from AgentBox)
    │       ├── model: string
    │       └── OutputTarget (resolved at routing time)
    │
    ↓ (brain resolution)
BrainResolution
    ├── ok: true → LLMCallConfig → POST /api/llm/chat
    │                                   ↓ (Electron dispatch by ProviderId)
    │                               LLMResponse
    │                                   ↓
    │                               OutputEvent (with content, status)
    │                                   ↓
    │       ┌──────────────────────────────────────────┐
    │       │ target.surface === 'sidepanel'             │
    │       │   → sidepanel onMessage → setAgentBoxes   │
    │       │ target.surface === 'grid'                  │
    │       │   → grid onMessage → update slot DOM       │
    │       │ target.type === 'inline_chat'              │
    │       │   → chat message append                   │
    │       └──────────────────────────────────────────┘
    │
    └── ok: false → error surfaced to user → no LLM call
```

---

## Summary: What Must Be True for These Contracts to Hold

| Contract | Prerequisite |
|---|---|
| Agent gets brain via AgentBox | Box must be findable in canonical store (NB-5) |
| Provider resolved via ProviderId | `providers.ts` constants, save-time conversion (NB-4) |
| Cloud vs local routing correct | Electron dispatch by ProviderId, key store unified |
| Box identity survives surface changes | `surface` field on box config, canonical store rule |
| Output reaches correct surface | `OutputEvent` contract, grid subscriber added (NB-6) |
| No silent failures | `BrainResolution` typed error, no fallback model |
| Multiple agents work | `AgentMatch[]` iteration already implemented — just needs correct data |
