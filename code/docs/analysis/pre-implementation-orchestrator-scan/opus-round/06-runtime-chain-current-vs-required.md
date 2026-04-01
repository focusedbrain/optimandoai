# 06 — Runtime Chain: Current vs Required

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Round Prompt 1 (docs 01–05)  
**Focus:** The full runtime pipeline — what it does today versus what it must do for the orchestrator to behave coherently end to end.

---

## Framing

This document treats the pipeline as a chain of distinct stages, each with a defined input contract and output contract. For each stage, the current implementation is described honestly, the required behavior is defined clearly, and the delta between them is named precisely. The goal is not to produce a patch plan — it is to make every gap a named, bounded problem that implementation can address intelligently.

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

### Current

```
rawText    = chatInput or pendingInboxAiRef.current.query
hasImage   = chatMessages.some(msg => msg.imageUrl)  ← full session history
imageUrls  = derived per-message in processMessagesWithOCR (later)
```

The `hasImage` flag reads the entire session message history, not the current turn. A session that has ever had an image will permanently have `hasImage = true` for all subsequent sends.

There is no structured input object. Raw strings are passed between functions. Every subsequent stage re-derives `hasImage`, `ocrText`, `source`, and related properties from its own heuristics.

### Required

Input collection must produce a single, typed object that travels through the entire pipeline. All downstream stages consume this object — they do not re-derive its fields.

```typescript
interface TurnInput {
  turnId: string;            // unique per send action
  rawText: string;           // user-typed text, trimmed
  imageUrls: string[];       // images in THIS turn only (not session history)
  hasImage: boolean;         // derived from imageUrls.length > 0
  hasInlineText: boolean;    // rawText.length > 0
  sourceType: 'wrchat' | 'event_tag' | 'screenshot' | 'voice'; // entry point
  timestamp: number;
}
```

`hasImage` must be scoped to the current turn. The full session history may contain images — that is irrelevant to whether this turn has an image that should trigger OCR.

### Delta

| Property | Current | Required |
|---|---|---|
| `hasImage` | Full session history scan | Current turn only |
| Structured input object | None — raw strings | `TurnInput` type |
| `turnId` | None | Required for output delivery to identify the right run |
| `sourceType` | Implicit from call site | Explicit field |

---

## Stage 2: OCR Enrichment

### Current

```
// sidepanel.tsx line 2925
routeInput(llmRouteText, hasImage)   ← authoritative routing — NO OCR YET

// sidepanel.tsx line 2943
processMessagesWithOCR(newMessages)  ← OCR happens AFTER routing
ocrText = result.data.text           ← race condition: only last image's text captured
```

OCR runs after the routing decision that drives agent execution. The correct OCR-aware routing path (`routeClassifiedInput`) does receive OCR-enriched input — but its result is logged and discarded. It has no execution consequence.

Additionally, when multiple images exist in the current turn, `ocrText` is reassigned for each in a `Promise.all` loop — keeping only the last successful result. Earlier images' text is appended to message content but lost from the `ocrText` variable used for routing and reasoning.

### Required

OCR must complete before any routing call that determines agent execution. The output of OCR enriches `TurnInput` and produces an `EnrichedInput`:

```typescript
interface EnrichedInput extends TurnInput {
  ocrResults: OcrResult[];         // one per image, preserving all results
  ocrText: string;                 // concatenated text from all images
  ocrConfidence?: number;          // lowest confidence across results (weakest link)
  ocrMethod?: 'cloud_vision' | 'local_tesseract';
  ocrSkipped: boolean;             // true if hasImage=false or OCR timed out
}
```

The OCR stage must also define a timeout contract: if OCR exceeds a threshold (e.g., 5 seconds), routing proceeds with `ocrSkipped: true` and `ocrText = ''`. This prevents OCR latency from blocking the entire pipeline.

### Delta

| Property | Current | Required |
|---|---|---|
| OCR timing | After routing | Before routing |
| Multi-image handling | Last result only | All results concatenated |
| OCR timeout | None defined | Explicit timeout + fallback |
| OCR result type on input object | String variable only | `OcrResult[]` on `EnrichedInput` |

---

## Stage 3: Enriched Input Assembly

### Current

There is no explicit assembly stage. After OCR, the following are computed ad hoc in `handleSendMessage`:

```javascript
inputTextForNlp = llmRouteText + (ocrText ? '\n\n' + ocrText : '')
classifiedInput = nlpClassifier.classify(inputTextForNlp)
// classifiedInput is used by routeClassifiedInput, result discarded
```

NLP classification runs on OCR-enriched text (correctly). But because routing already happened before OCR, the NLP result is used only by the discarded secondary routing paths.

### Required

After OCR enrichment, NLP classification runs and its result is attached to `EnrichedInput`:

```typescript
interface EnrichedInput extends TurnInput {
  // ... OCR fields ...
  classification: ClassifiedInput;  // NLP result: triggers, entities, intents
  combinedText: string;             // rawText + '\n\n' + ocrText (the routing surface)
}
```

This assembled `EnrichedInput` is the single object passed to the routing stage. No stage after this point needs to re-derive `combinedText` or re-run NLP.

### Delta

| Property | Current | Required |
|---|---|---|
| NLP timing relative to routing | After routing (discarded) | Before routing (feeds routing) |
| Combined text assembly | Ad hoc in handleSendMessage | Explicit field on `EnrichedInput` |
| NLP result on input object | Local variable, unused | `classification` field, consumed by routing |

---

## Stage 4: Routing Decision

### Current

Three routing computations exist. Only the first (pre-OCR) drives agent execution:

```
1. routeInput(rawText, hasImage)              ← pre-OCR, pre-NLP — AUTHORITATIVE
2. routeClassifiedInput(classifiedInput)       ← post-OCR+NLP, logged, discarded
3. routeEventTagTrigger(inputTextForNlp)       ← post-OCR+NLP, logged, discarded
```

The execution loop iterates `routingDecision.matchedAgents` from call 1. Calls 2 and 3 produce architecturally richer results (respecting NLP triggers, typed destinations, `reasoningSections` resolution) but have zero execution consequence.

### Required

One canonical routing decision. It must:
- Run after OCR enrichment and NLP classification
- Accept `EnrichedInput` as its input contract
- Return a typed `RoutingDecision` with agent matches and their resolved box targets
- Be the only result consumed by the execution loop

```typescript
interface RoutingDecision {
  turnId: string;          // links back to the originating TurnInput
  matchedAgents: AgentMatch[];
  routingMethod: 'trigger' | 'nlp' | 'tag' | 'fallback';
  hadOcr: boolean;
  timestamp: number;
}

interface AgentMatch {
  agentId: string;
  agentNumber: number;
  matchType: 'trigger' | 'context' | 'applyFor' | 'tag';
  triggeredBy: string;     // the specific trigger that fired, for reasoning section selection
  agentBoxId: string | null;
  agentBoxProvider: string;   // normalized provider ID from providers.ts
  agentBoxModel: string;
  destination: OutputTarget;  // where output goes
}
```

The routing authority question: `routeClassifiedInput` already contains the richer logic (NLP-based trigger matching, destination resolution, `reasoningSections` selection via `resolveReasoningConfig`). It should be the canonical routing function, elevated from secondary to primary.

### Delta

| Property | Current | Required |
|---|---|---|
| Routing input | raw strings | `EnrichedInput` |
| Routing authority | pre-OCR `routeInput` | post-OCR+NLP single function |
| Number of routing computations | 3 (1 used, 2 discarded) | 1 (used for execution) |
| `triggeredBy` field on match | Not present | Required for reasoning section selection |
| Provider on match | Present but not normalized | Normalized to `ProviderId` constants |

---

## Stage 5: Agent Selection and Listener Evaluation

### Current

`evaluateAgentListener` correctly evaluates:
- Capability check (listener enabled)
- Website filter
- Trigger keyword matching (unified + legacy format)
- Expected context substring
- `applyFor` input type (text/image/mixed)

Not evaluated:
- `listening.sources[]` (14 source types)
- `listening.exampleFiles`
- `acceptFrom`

This logic is sound for the first pass. Its main defect is that it evaluates against `rawText` only — it does not have access to `ocrText`. After OCR resequencing, the routing function should pass `combinedText` (rawText + ocrText) to `evaluateAgentListener` so trigger matching can fire on OCR-extracted content.

### Required

`evaluateAgentListener` must receive `combinedText` as its text argument, not just `rawText`. The listener contract signature becomes:

```typescript
evaluateAgentListener(
  agent: AgentConfig,
  input: EnrichedInput,   // not just a string
  context: EvaluationContext
): ListenerMatch
```

Where `EvaluationContext` carries website, session context, and any other routing-time context needed.

This change is scoped: the evaluation logic itself does not change. Only the text that trigger matching runs against changes from `rawText` to `input.combinedText`.

### Delta

| Property | Current | Required |
|---|---|---|
| Text evaluated for trigger matching | `rawText` only | `combinedText` (rawText + ocrText) |
| Input parameter type | `string` | `EnrichedInput` |
| `listening.sources[]` evaluation | Not implemented | Deferred (out of first-pass scope) |
| `acceptFrom` evaluation | Not implemented | Deferred |

---

## Stage 6: Brain Resolution (Agent Box → Provider + Model)

### Current

`resolveModelForAgent` (processFlow.ts lines 1210–1245):
- Recognizes `'ollama'`, `'local'`, `''` as local
- Does NOT recognize `'Local AI'` (UI string, lowercased to `'local ai'`)
- All cloud providers hit "API not yet connected" → fallback
- Fallback is a hardcoded model identifier
- No error surfaced when fallback is used

The Agent Box `provider` and `model` fields are correctly stored — the problem is in the resolution function that reads them.

### Required

Brain resolution is not a string-matching hack. It is a dispatch contract:

```
ProviderId (normalized) → LLMBackend
LLMBackend + model → LLMCallConfig

LLMCallConfig {
  endpoint: string           // /api/llm/chat for local; cloud API URL for cloud
  apiKey?: string            // required for cloud
  model: string              // exact model identifier
  provider: ProviderId       // for Electron-side routing
}
```

Resolution logic:
1. Read `agentBox.provider` — this must be a `ProviderId` constant (normalized from UI string at save time, not at resolution time)
2. Switch on `ProviderId`:
   - `'ollama'` → Electron `/api/llm/chat`, no API key needed, `model` passed as-is
   - `'openai'` → cloud endpoint or Electron proxy, OpenAI key required
   - `'anthropic'` → cloud endpoint, Anthropic key required
   - (etc.)
3. If cloud and no key available → return `{ error: 'no_key', provider }` (not a fallback model)
4. If local and Ollama not running → return `{ error: 'local_unavailable' }` (not a fallback model)
5. Never silently return a different model than configured

The resolution function must return a result type, not a raw model string:

```typescript
type BrainResolution =
  | { ok: true; config: LLMCallConfig }
  | { ok: false; error: 'no_key' | 'local_unavailable' | 'unsupported_provider'; provider: ProviderId }
```

### Delta

| Property | Current | Required |
|---|---|---|
| Provider input | Raw UI string (not normalized) | `ProviderId` constant |
| Cloud provider handling | "API not yet connected" → fallback | Explicit dispatch per provider |
| Error model | Silent fallback | Typed `BrainResolution` result |
| API key access | Not implemented | Read from canonical key store |
| Fallback behavior | Silent wrong model | Explicit error returned to caller |

---

## Stage 7: Reasoning Harness Assembly

### Current

`wrapInputForAgent` reads from `agent.reasoning` (flat string) only:

```
[Role]
[Goals]
[Rules]
[Custom fields]
[User Input]
[Extracted Image Text]  ← ocrText, if present
```

Not read: `reasoningSections[]`, `agentContextFiles`, `memorySettings`, WR Experts.

### Required (for first pass)

For the minimum viable first pass, the current assembly is acceptable with two additions:
1. The system prompt must confirm which reasoning section was used (flat or per-trigger) — even if only flat is supported now, the `triggeredBy` field from `AgentMatch` is available to select the right `reasoningSection` in a future pass.
2. `ocrText` must be passed correctly (already done but at risk from the race condition in stage 2).

The reasoning harness assembly function contract:

```typescript
function buildSystemPrompt(
  agent: RuntimeAgentConfig,  // only the fields that are actually consumed
  input: EnrichedInput,
  match: AgentMatch
): string
```

`RuntimeAgentConfig` is a narrowed type — it declares only what `buildSystemPrompt` actually reads. This is a normalization requirement (N-7 from doc 17), not a feature addition.

### Delta

| Property | Current | Required (first pass) |
|---|---|---|
| Function name | `wrapInputForAgent` | `buildSystemPrompt` or same with stricter types |
| Consumed fields | `agent.reasoning`, role, goals, rules | Same, plus `triggeredBy` for future section selection |
| `agentContextFiles` | Not consumed | Deferred — but function signature should anticipate it |
| `reasoningSections[]` | Not consumed | Deferred — but `triggeredBy` available from `AgentMatch` |

---

## Stage 8: LLM Execution

### Current

`processWithAgent` posts to Electron `/api/llm/chat` — Ollama-only. There is no routing to cloud providers at the Electron level. The model name in the request is whatever `resolveModelForAgent` returned — which is currently the fallback model for any `'Local AI'` box.

### Required

LLM execution must be provider-aware. The extension sends a `LLMCallConfig` (from stage 6) to Electron. Electron routes based on `provider`:

```
Electron /api/llm/chat:
  body.provider === 'ollama'     → Ollama API
  body.provider === 'openai'     → OpenAI API (with apiKey from key store)
  body.provider === 'anthropic'  → Anthropic API
  body.provider === 'gemini'     → Gemini API
  body.provider === 'grok'       → xAI API
```

The extension does not need to know which cloud URL to use — that responsibility belongs entirely to Electron. The extension's contract with Electron is:

```typescript
POST /api/llm/chat
{
  provider: ProviderId,
  model: string,
  messages: LLMMessage[],
  apiKey?: string   // passed from key store if Electron doesn't hold it
}
```

### Delta

| Property | Current | Required |
|---|---|---|
| Provider routing | Ollama only | Provider-aware dispatch in Electron |
| Model in request | Fallback model (due to stage 6 bug) | Configured model |
| Error handling | Silent | Returns error to extension for display |

---

## Stage 9: Output Delivery

### Current

`updateAgentBoxOutput`:
1. Reads session from `chrome.storage.local`
2. Finds box by `agentBoxId` — returns `false` silently if not found
3. Writes `box.output` and `box.lastUpdated`
4. Sends `UPDATE_AGENT_BOX_OUTPUT` message
5. Sidepanel handles it (React state update → live render)
6. Grid pages: no handler — no live update

Key gap: the box lookup reads `chrome.storage.local`. Grid boxes are in SQLite. If a grid box is the target, it is not found, the write silently fails, and no output is delivered.

### Required

Output delivery must:
1. Locate the target box from the same store that routing used to find it (ensuring consistency)
2. Write to that box's storage record
3. Emit an `OutputEvent` that all potential subscribers can receive
4. Both sidepanel and grid page subscribers handle the event and update their DOM

```typescript
interface OutputEvent {
  type: 'UPDATE_AGENT_BOX_OUTPUT';
  turnId: string;
  agentRunId: string;
  target: OutputTarget;
  content: string;
  status: 'complete' | 'error';
  timestamp: number;
}

interface OutputTarget {
  type: 'sidepanel_box' | 'grid_box' | 'inline_chat';
  boxId: string;
  agentNumber: number;
  boxNumber: number;
}
```

Grid pages must register their rendered box slots on mount, and subscribe to `OutputEvent`. When an event arrives with a matching `boxId`, the DOM slot updates. This is additive — it does not change the sidepanel path.

### Delta

| Property | Current | Required |
|---|---|---|
| Box lookup source | `chrome.storage.local` only | Same adapter used for routing |
| Silent failure on missing box | Returns `false` | Returns typed error, surfaced to user |
| Grid subscriber | None | Grid pages subscribe to `OutputEvent` |
| `turnId` on output event | None | Required for matching output to input |
| `status` field | Not present | `'complete' \| 'error'` |

---

## Full Pipeline Comparison

### Current Pipeline (What Actually Runs)

```
[1] Input collected — hasImage = full session history
[2] routeInput(rawText, hasImage) ← AUTHORITATIVE, no OCR, no NLP
[3] processMessagesWithOCR ← OCR after routing
[4] NLP classify(rawText + ocrText) ← after routing, unused
[5] routeClassifiedInput(classified) ← post-OCR, result discarded ⚠
[6] routeEventTagInput ← post-OCR, result discarded ⚠
[7] for each match in routeInput.matchedAgents:
       resolveModelForAgent(provider)
          → 'Local AI' not recognized → fallback model ⚠
          → cloud provider → fallback model ⚠
       wrapInputForAgent(flat agent.reasoning)
       POST /api/llm/chat (Ollama only)
       updateAgentBoxOutput → chrome.storage.local read
          → grid box not found → silent drop ⚠
          → sidepanel: live render ✓
          → grid: no handler → no render ⚠
```

### Required Pipeline (What Must Run)

```
[1] Collect TurnInput — hasImage = current turn only
[2] if hasImage: await OCR on all images → OcrResult[]
[3] NLP classify(rawText + ocrText) → ClassifiedInput
[4] assemble EnrichedInput (TurnInput + OCR + NLP)
[5] one routing call(EnrichedInput) → RoutingDecision with AgentMatch[]
       each AgentMatch carries: normalized provider, model, agentBoxId,
       triggeredBy, OutputTarget
[6] for each match in RoutingDecision.matchedAgents:
       BrainResolution = resolveModelForAgent(match.agentBoxProvider, match.agentBoxModel)
          → ok: LLMCallConfig with correct provider + model
          → error: surface to user, skip LLM call
       systemPrompt = buildSystemPrompt(agent, enrichedInput, match)
       POST /api/llm/chat with LLMCallConfig
          → Electron routes to Ollama or cloud API by provider
       OutputEvent → both sidepanel handler and grid handler
          → box found in canonical store → DOM update
```

---

## Summary of Stage Deltas

| Stage | Current State | Required State | Severity |
|---|---|---|---|
| 1. Input Collection | `hasImage` from full history; no typed input object | `TurnInput` with per-turn `hasImage` | High |
| 2. OCR Enrichment | After routing; race condition on multiple images | Before routing; all results concatenated on `EnrichedInput` | Critical |
| 3. Enriched Input Assembly | Ad hoc; NLP output unused | Explicit `EnrichedInput` type; NLP feeds routing | Critical |
| 4. Routing Decision | 3 computations, only pre-OCR one used | 1 canonical post-OCR+NLP routing function | Critical |
| 5. Listener Evaluation | Runs on `rawText` only | Runs on `combinedText` (rawText + ocrText) | High |
| 6. Brain Resolution | String mismatch; silent fallback | Typed `BrainResolution`; dispatch by `ProviderId` | Critical |
| 7. Reasoning Assembly | Flat `agent.reasoning` only | Same for first pass, but typed `RuntimeAgentConfig` | Medium |
| 8. LLM Execution | Ollama-only; wrong model name | Provider-aware dispatch; correct model name | Critical |
| 9. Output Delivery | `chrome.storage` only; grid blind; no error | Same adapter as routing; `OutputEvent`; grid subscriber | Critical |
