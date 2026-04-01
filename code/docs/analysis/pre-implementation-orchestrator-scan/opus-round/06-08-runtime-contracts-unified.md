# Opus Round 2 — Runtime Contracts and Normalization Blockers

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Round 1 (docs 01–05, 00-opus-round-unified.md)  
**Purpose:** Unified synthesis of docs 06–08. Defines runtime contracts, ranks normalization blockers, and specifies the provider/box/routing contract required for coherent orchestrator behavior.

---

# Part I: Runtime Chain — Current vs Required
*(Source: 06-runtime-chain-current-vs-required.md)*

---

## Stage Overview

```
[1] INPUT COLLECTION
       ↓
[2] OCR ENRICHMENT
       ↓
[3] ENRICHED INPUT ASSEMBLY
       ↓
[4] ROUTING DECISION
       ↓
[5] AGENT SELECTION & LISTENER EVALUATION
       ↓
[6] BRAIN RESOLUTION (Agent Box → Provider + Model)
       ↓
[7] REASONING HARNESS ASSEMBLY
       ↓
[8] LLM EXECUTION
       ↓
[9] OUTPUT DELIVERY
```

---

## Stage 1: Input Collection

**Current:** `hasImage` reads entire session history. No typed input object. Raw strings passed to all downstream stages.

**Required:** `TurnInput` type carrying current-turn-only data:
```typescript
interface TurnInput {
  turnId: string;
  rawText: string;
  imageUrls: string[];     // THIS turn only
  hasImage: boolean;       // imageUrls.length > 0
  hasInlineText: boolean;
  sourceType: 'wrchat' | 'event_tag' | 'screenshot';
  timestamp: number;
}
```

**Key delta:** `hasImage` scoped to current turn. Structured typed object replaces raw strings.

---

## Stage 2: OCR Enrichment

**Current:** OCR runs at `sidepanel.tsx:2943` — 18 lines after `routeInput` at line 2925. Multiple-image race condition: only last image's `ocrText` captured. OCR result has no typed home.

**Required:** OCR runs before any routing call that drives execution. All images processed. Results concatenated. `EnrichedInput` carries the result:
```typescript
interface EnrichedInput extends TurnInput {
  ocrResults: OcrResult[];     // all images, all results
  ocrText: string;             // concatenated
  ocrSkipped: boolean;         // true if no images OR OCR timed out
}
```

Timeout contract: if Electron OCR exceeds N ms, proceed with `ocrSkipped: true`.

---

## Stage 3: Enriched Input Assembly

**Current:** `inputTextForNlp` assembled ad hoc. NLP result is a local variable fed to the discarded routing paths.

**Required:** NLP runs after OCR; its result lives on `EnrichedInput`:
```typescript
interface EnrichedInput extends TurnInput {
  // ... OCR fields ...
  classification: ClassifiedInput;
  combinedText: string;    // rawText + '\n\n' + ocrText
}
```

`EnrichedInput` is the single object passed to routing. No stage re-derives `combinedText` or re-runs NLP.

---

## Stage 4: Routing Decision

**Current:** Three routing computations. Only pre-OCR `routeInput` drives execution. `routeClassifiedInput` (post-OCR+NLP, richer logic) discarded. `routeEventTagTrigger` discarded.

**Required:** One canonical routing authority. Accepts `EnrichedInput`, returns `RoutingDecision`:
```typescript
interface RoutingDecision {
  turnId: string;
  matchedAgents: AgentMatch[];
  routingMethod: 'trigger' | 'nlp' | 'tag' | 'fallback';
  hadOcr: boolean;
}

interface AgentMatch {
  agentId: string;
  agentNumber: number;
  matchType: 'trigger' | 'context' | 'applyFor' | 'tag';
  triggeredBy: string;          // specific trigger that fired
  agentBoxId: string | null;
  agentBoxProvider: ProviderId; // normalized
  agentBoxModel: string;
  destination: OutputTarget;
}
```

Best candidate for canonical authority: `routeClassifiedInput` (already accepts post-OCR input, already runs `resolveReasoningConfig`, already builds `AgentAllocation`). Elevation from secondary-and-discarded to primary-and-executed.

---

## Stage 5: Listener Evaluation

**Current:** `evaluateAgentListener` runs on `rawText` only. Trigger matching cannot fire on OCR-extracted text.

**Required:** `evaluateAgentListener` receives `EnrichedInput`; trigger matching runs against `input.combinedText`. Logic itself unchanged — only the text surface changes.

---

## Stage 6: Brain Resolution

**Current:** `resolveModelForAgent` — `'Local AI'` not recognized → fallback. All cloud providers → fallback. Silent. Wrong model runs.

**Required:** Typed `BrainResolution` result. No fallback model ever:
```typescript
type BrainResolution =
  | { ok: true; config: LLMCallConfig }
  | { ok: false; error: BrainResolutionError }

interface LLMCallConfig {
  provider: ProviderId;
  model: string;
  endpoint: 'local' | 'cloud';
  apiKey?: string;
}
```

If `ok: false`, the caller surfaces the error. The configured model either runs or the user sees why it didn't.

---

## Stage 7: Reasoning Harness Assembly

**Current:** `wrapInputForAgent` reads flat `agent.reasoning` only. `reasoningSections[]`, `agentContextFiles`, memory — not consumed.

**Required (first pass):** Same flat reasoning, but typed `RuntimeAgentConfig` input (only the fields actually consumed). `triggeredBy` from `AgentMatch` available for future reasoning section selection.

---

## Stage 8: LLM Execution

**Current:** Always POSTs to Electron `/api/llm/chat` (Ollama-only). Model name is the fallback.

**Required:** `LLMCallConfig` is sent to Electron. Electron dispatches by `provider`:
```
'ollama'    → Ollama.chat(model, messages)
'openai'    → OpenAI.chat(apiKey, model, messages)
'anthropic' → Anthropic.chat(apiKey, model, messages)
...
```

Extension does not know cloud URLs. Electron owns the dispatch.

---

## Stage 9: Output Delivery

**Current:** `updateAgentBoxOutput` reads `chrome.storage.local`. Grid boxes not found (in SQLite). Silent drop. No grid handler. Sidepanel: live. Grid: nothing.

**Required:** `OutputEvent` contract. Box lookup from canonical store. Grid pages subscribe:
```typescript
interface OutputEvent {
  type: 'UPDATE_AGENT_BOX_OUTPUT';
  turnId: string;
  agentRunId: string;
  target: OutputTarget;
  content: string;
  status: 'complete' | 'streaming' | 'error';
  errorMessage?: string;
  timestamp: number;
}
```

---

## Full Pipeline Comparison

### Current (What Actually Runs)
```
hasImage = full session history
routeInput(rawText, hasImage) ← AUTHORITATIVE, no OCR ⚠
processMessagesWithOCR ← after routing
NLP classify ← unused ⚠
routeClassifiedInput ← discarded ⚠
routeEventTagInput ← discarded ⚠
for each match in routeInput.matchedAgents:
  'Local AI' not recognized → fallback model ⚠
  flat agent.reasoning only
  POST /api/llm/chat (Ollama only)
  updateAgentBoxOutput → chrome.storage read
    grid box not found → silent drop ⚠
    sidepanel: live ✓
    grid: no handler ⚠
```

### Required (What Must Run)
```
hasImage = current turn only
await OCR on current turn images → ocrResults
NLP classify(rawText + ocrText)
assemble EnrichedInput
one routingCall(EnrichedInput) → RoutingDecision
for each match:
  resolveBrain(ProviderId, model) → LLMCallConfig | error
  buildSystemPrompt(RuntimeAgentConfig, enrichedInput, match)
  POST /api/llm/chat with LLMCallConfig
  Electron routes by provider → Ollama or cloud API
  OutputEvent → sidepanel handler OR grid handler
    box found in canonical store → DOM update
```

---

# Part II: Normalization Blockers
*(Source: 07-normalization-blockers.md)*

---

## What Is a Normalization Blocker

A normalization blocker is not a bug in one function — it is a missing shared definition that causes multiple independent parts of the codebase to develop their own incompatible interpretations of the same concept. Fixing a bug removes a defect. Normalizing a blocker removes the condition that makes the defect recur.

---

## Blockers — Ranked by Severity

### NB-1: No `EnrichedInput` Type (Critical — Must Be Resolved First)

No typed object carries turn state through the pipeline. Every function re-derives `hasImage`, `ocrText`, `combinedText` independently. When OCR is resequenced, its result has no typed home. When routing is unified, its input type is undefined.

**Defines:** `TurnInput` and `EnrichedInput`. All downstream stages consume `EnrichedInput`. No stage re-derives its fields.

**Why first:** Every other normalization either produces a field that goes on `EnrichedInput` or consumes one from it. Thread the type first; connect the stages.

---

### NB-2: No Routing Authority (Critical)

Three routing computations per send. Only the pre-OCR one drives execution. The richer post-OCR computation is discarded. No function is designated as authoritative.

**Defines:** One canonical routing function accepting `EnrichedInput`, returning `RoutingDecision`. Secondary computations explicitly demoted to diagnostic-only.

**Best candidate:** Elevate `routeClassifiedInput` from secondary to primary.

---

### NB-3: OCR Timing — Execution Before Image Content (Critical)

Routing authority runs before OCR. An explicit timing rule is absent. Without it, resequencing OCR is a fragile code-order fix that any future refactor can break.

**Defines:** `EnrichedInput` must be fully assembled (OCR attempted or explicitly skipped) before routing is called. Type enforcement: routing function accepts `EnrichedInput`, not `TurnInput`.

**Timeout:** If OCR exceeds threshold → `ocrSkipped: true`, pipeline proceeds.

---

### NB-4: No Provider/Model Registry (Critical)

UI stores `'Local AI'`. Runtime recognizes `'ollama'`. No shared constants. Will recur for every new provider.

**Defines:** `providers.ts` with `PROVIDER_IDS` and `PROVIDER_LABELS`. Conversion from UI label to `ProviderId` happens at save time, not resolve time. `CanonicalAgentBoxConfig.provider` typed as `ProviderId`.

---

### NB-5: Agent Box Persistence Split (Critical)

Sidepanel boxes and grid boxes write to different stores. `loadAgentBoxesFromSession` reads `chrome.storage.local` only. Grid boxes invisible to routing engine.

**Defines:** One canonical box store for all surfaces. One write path. One read path. The `surface` field on box config determines output delivery target, not which store holds the box.

---

### NB-6: No Output-Routing Contract (High)

`UPDATE_AGENT_BOX_OUTPUT` is an undocumented message format. Sidepanel handles it. Grid does not. No typed `OutputEvent`. Adding streaming or multi-box fan-out creates a new ad-hoc format each time.

**Defines:** `OutputEvent` type with `turnId`, `agentRunId`, `target` (including `surface`), `content`, `status`. Both sidepanel and grid subscribe to the same contract.

---

### NB-7: Session Persistence Authority (High)

Three session read paths: `chrome.storage.local` direct, SQLite via adapter proxy, SQLite via direct Electron HTTP. No canonical owner defined. Grid pages use the third path.

**Defines:** All session reads go through `storageWrapper`. Electron running → SQLite canonical. No component reads session state directly.

---

### NB-8: No `RuntimeAgentConfig` Contract (Medium)

`CanonicalAgentConfig` has ~30 fields. Runtime reads ~6. No declared subset. Developers adding features cannot tell which fields are "live."

**Defines:** `RuntimeAgentConfig` interface declaring only consumed fields. `buildSystemPrompt` and `evaluateAgentListener` accept `RuntimeAgentConfig`, not the full canonical type.

---

## Required Normalization Sequence

```
1. Define TurnInput + EnrichedInput (NB-1) — data carrier
2. Resequence OCR → thread into EnrichedInput (NB-3) — timing rule
3. Define routing authority contract (NB-2) — one function, one result
4. Define provider/model registry (NB-4) — ProviderId constants
5. Unify box persistence path (NB-5) — grid box visibility
6. Define OutputEvent contract (NB-6) — output delivery
7. Define session authority rule (NB-7) — session consistency
8. Define RuntimeAgentConfig (NB-8) — agent config clarity
```

Steps 1–4 = prerequisites for first working pass.  
Steps 5–6 = required for grid equivalence.  
Steps 7–8 = required for reliable operation.

---

# Part III: Provider, Box, and Routing Contract
*(Source: 08-provider-box-routing-contract.md)*

---

## How an Agent Gets Its Brain

```
Agent → agent.number → AgentBox (by agentNumber) → ProviderId + ModelId → BrainResolution
```

1. `agent.number` is the stable identity (unchanged at creation)
2. `findAgentBoxesForAgent(agentNumber, boxes)` from canonical store → first matched box
3. `agentBox.provider` (type: `ProviderId`) + `agentBox.model` (type: `string`)
4. `resolveBrain(provider, model, keyStore)` → `BrainResolution`

**Contract guarantee:** `resolveBrain` never returns a different model than configured. Returns either `{ ok: true; config: LLMCallConfig }` or `{ ok: false; error: BrainResolutionError }`.

---

## How Provider/Model Is Resolved

**Provider identity:** `ProviderId` is the only string that travels through the runtime. UI display labels are presentation-layer only — never stored or compared at runtime.

```typescript
// Conversion at save time (once), not at resolve time (never):
function toProviderId(uiLabel: string): ProviderId | null
// Returns null → save rejected with visible error
```

**Model identity:** Opaque string. Passed verbatim to LLM backend. No transformation.

**Key store:** One canonical store (SQLite via adapter chain). Keyed by `ProviderId`. Extension settings UI writes to it. Electron reads from it. No `localStorage` for cloud keys.

---

## How Cloud vs Local Is Represented

Not different types — different `endpoint` values on `LLMCallConfig`:

```typescript
interface LLMCallConfig {
  provider: ProviderId;
  model: string;
  endpoint: 'local' | 'cloud';    // derived from provider
  apiKey?: string;                  // required for cloud
}

function getEndpoint(provider: ProviderId): 'local' | 'cloud' {
  return provider === 'ollama' ? 'local' : 'cloud';
}
```

Electron dispatch on `provider` field. Extension does not know cloud URLs — Electron owns dispatch:
```
'ollama'    → Ollama.chat()
'openai'    → OpenAI.chat()
'anthropic' → Anthropic.chat()
'gemini'    → Gemini.chat()
'grok'      → xAI.chat()
```

Adding a new provider = one dispatch case + one `PROVIDER_IDS` entry.

**UI gate:** Cloud provider selector shows key requirement. No cloud provider activates silently without a key.

---

## How Box Identity Survives Sidepanel/Grid Equivalence

Box identity = UUID `id` field, stable from creation. Never reassigned.

```typescript
interface CanonicalAgentBoxConfig {
  id: string;                  // UUID — stable identity
  boxNumber: number;
  agentNumber: number;
  provider: ProviderId;        // normalized, not UI label
  model: string;
  surface: 'sidepanel' | 'grid';   // determines output delivery target
  gridPosition?: { row: number; col: number };
}
```

**Canonical store rule:** All boxes (regardless of surface) live in one store. `surface` field routes output delivery — not which store the box is in.

**Grid page registration on mount:**
```javascript
chrome.runtime.sendMessage({ type: 'REGISTER_BOX_SLOT', boxId: '<uuid>', surface: 'grid' });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_AGENT_BOX_OUTPUT' && msg.target.boxId === myBoxId) {
    updateBoxDOM(msg.content, msg.status);
  }
});
```

---

## How Output Targets One Box, Multiple Boxes, or Inline Chat

`OutputTarget` is resolved during routing, not during delivery:

```typescript
interface OutputTarget {
  type: 'box' | 'inline_chat';
  boxId?: string;
  surface?: 'sidepanel' | 'grid';
  agentNumber: number;
  boxNumber?: number;
}
```

**Resolution priority:**
1. `specialDestinations` on agent config (explicit)
2. `reportTo` string parse
3. First box matching `agentNumber`
4. Fallback → `type: 'inline_chat'` (NOT a silent drop — user sees a response)

**No silent drop:** If no box found, output goes to inline chat. The user always sees a result.

**Multiple agents, one input:** Each `AgentMatch` is independent. Each runs its own LLM call, produces its own `OutputEvent`, targets its own box. No output is combined before delivery.

**The OutputEvent contract (all cases):**
```typescript
interface OutputEvent {
  type: 'UPDATE_AGENT_BOX_OUTPUT';
  turnId: string;
  agentRunId: string;
  target: OutputTarget;
  content: string;
  status: 'complete' | 'streaming' | 'error';
  errorMessage?: string;
  timestamp: number;
}
```

Subscribers filter by `target.surface`. Both sidepanel and grid subscribe to the same event type. The message channel is the extension message bus.

---

## Contract Dependency Map

```
TurnInput (current turn, typed)
    ↓ OCR (before routing)
EnrichedInput (rawText + ocrText + classification + combinedText)
    ↓ one canonical routing call
RoutingDecision → AgentMatch[]
    each AgentMatch carries:
      ProviderId (normalized)
      model: string
      triggeredBy: string
      OutputTarget (resolved)
    ↓ for each match
BrainResolution
  ok:true  → LLMCallConfig → POST /api/llm/chat
                              Electron dispatch by ProviderId
                              LLMResponse → OutputEvent
                                → sidepanel handler (React state) OR
                                → grid handler (DOM slot update) OR
                                → inline chat append
  ok:false → error surfaced to user → no LLM call
```

---

## What Must Be True for These Contracts to Hold

| Contract | Prerequisite |
|---|---|
| Agent gets brain via AgentBox | Canonical box store (NB-5) |
| Provider resolved via ProviderId | `providers.ts`, save-time conversion (NB-4) |
| Cloud vs local routing | Electron dispatch by ProviderId, unified key store |
| Box identity survives surface changes | `surface` field, canonical store rule (NB-5) |
| Output reaches correct surface | `OutputEvent` contract, grid subscriber (NB-6) |
| No silent failures | `BrainResolution` error types, no fallback model |
| OCR influences routing | `EnrichedInput` typed (NB-1), OCR before routing (NB-3) |
