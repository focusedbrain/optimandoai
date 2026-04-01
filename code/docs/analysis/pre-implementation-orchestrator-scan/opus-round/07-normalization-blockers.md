# 07 — Normalization Blockers

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Round Prompt 2 — runtime contracts  
**Focus:** What must be normalized before the orchestrator can be implemented coherently. Ranked by severity.

---

## Definition of a Normalization Blocker

A normalization blocker is not a bug in one function. It is a place where the system lacks a shared definition — of a type, a store, a contract, a constant — that multiple parts of the codebase depend on independently. Without normalization, each part develops its own interpretation of the shared concept, producing drift that accumulates silently.

Fixing a bug removes a defect. Normalizing a blocker removes the condition that makes the defect recur.

---

## Ranked Normalization Blockers

---

### NB-1: No Canonical Enriched Input Type
**Severity: Critical — must be resolved first**

**What is missing:**  
There is no shared type that carries the full state of a user turn through the pipeline. Input is passed as raw strings between functions. Each function independently re-derives `hasImage`, `ocrText`, `sourceType`, and `combinedText` from its own parameters.

**Why it blocks coherence:**  
Every stage of the pipeline — OCR, routing, listener evaluation, reasoning assembly, output delivery — needs to know: what did the user send? Did it have an image? What did OCR extract? What did NLP find? Without a shared type, every function answers these questions differently. When OCR is resequenced before routing, there is no object to thread the result through. When NLP is wired into routing, its output has no home. Adding any new input modality (voice, DOM event) requires adding new parameters to every function in the chain.

**What normalization requires:**  
Define `TurnInput` and `EnrichedInput` as canonical types in a shared location. All stages receive `EnrichedInput` after assembly. No stage re-derives its fields.

```typescript
// Minimum viable definition for first pass
interface TurnInput {
  turnId: string;
  rawText: string;
  imageUrls: string[];   // current turn only
  hasImage: boolean;     // imageUrls.length > 0
  hasInlineText: boolean;
  sourceType: 'wrchat' | 'event_tag' | 'screenshot';
  timestamp: number;
}

interface EnrichedInput extends TurnInput {
  ocrResults: OcrResult[];
  ocrText: string;          // concatenated from all ocrResults
  ocrSkipped: boolean;
  classification: ClassifiedInput;
  combinedText: string;     // rawText + '\n\n' + ocrText
}
```

**Why it must come first:**  
Every other normalization in this document either produces a field that goes on `EnrichedInput`, or consumes a field from it. The OCR resequencing is meaningless without a typed object to carry the result. Routing unification requires a canonical input. Brain resolution receives provider and model from a routing result that was derived from `EnrichedInput`. Thread the type first, then connect the stages.

**Where this affects the codebase:**  
- `sidepanel.tsx::handleSendMessage` — assembles the input, must produce `TurnInput` then `EnrichedInput`
- `InputCoordinator.ts::evaluateAgentListener` — currently takes `string`; must take `EnrichedInput`
- `processFlow.ts::matchInputToAgents` — currently takes `string`; must take `EnrichedInput`
- `processFlow.ts::wrapInputForAgent` — currently takes `string` + `ocrText`; merges into `buildSystemPrompt(agent, enrichedInput, match)`

---

### NB-2: No Routing Authority — Three Computations, One Execution Consumer
**Severity: Critical**

**What is missing:**  
There is no single routing function designated as the authority for execution. Three routing computations run per WR Chat send. Only the first (pre-OCR, pre-NLP) drives agent execution. The other two are architecturally more complete but have no execution consequence.

**Why it blocks coherence:**  
When OCR is resequenced (NB-1 and NB-3 addressed), there will be a moment where OCR-enriched input is available. Without a single routing authority, the implementation question becomes: which of the three routing functions should now be the canonical one? Answering this wrongly means the fix is partial — OCR runs first but still feeds the wrong routing function. Answering this correctly but without defining authority explicitly means a future developer adds a fourth routing computation and the problem recurs.

**What normalization requires:**  
Designate one function as the canonical routing authority. Define its input and output types. All other routing computations must be explicitly marked as diagnostic/audit-only, or retired.

The best candidate is `routeClassifiedInput` (InputCoordinator.ts). It:
- Already accepts post-OCR input (by design)
- Already runs `evaluateAgentListener` per agent
- Already calls `findAgentBoxesForAgent` for destination resolution
- Already uses `resolveReasoningConfig` for per-trigger reasoning selection (the richer path)
- Returns `agentAllocations` with box LLM fields

The required change is elevating `routeClassifiedInput` from secondary-and-discarded to primary-and-executed.

**Routing authority contract:**
```typescript
function routeInput(input: EnrichedInput, session: SessionSnapshot): RoutingDecision
// One function. One output. One consumer (the execution loop).
// Internal implementation may delegate to NLP, evaluateAgentListener, etc.
// External callers never need to know which internal strategy was used.
```

**Where this affects the codebase:**  
- `processFlow.ts::routeInput` — current pre-OCR authority; must be replaced or wrapped
- `InputCoordinator.ts::routeClassifiedInput` — should become the canonical implementation
- `sidepanel.tsx::handleSendMessage` — execution loop must consume the new authority's output
- Diagnostic logging of secondary routing computations can remain, but must be clearly marked

---

### NB-3: OCR Timing — Execution Decision Before Image Content
**Severity: Critical**

**What is missing:**  
A rule establishing that OCR must complete before any routing call that drives agent execution. Currently, the opposite is true: routing drives execution, and OCR runs 18 lines later in `handleSendMessage`.

**Why it blocks coherence:**  
Without an explicit timing rule, every developer who reads `handleSendMessage` sees three routing computations and cannot determine which one is canonical or why they appear in their current order. The OCR-before-routing requirement must be a stated contract, not just a code ordering — otherwise a future refactor reintroduces the bug.

**What normalization requires:**  
A documented, enforced rule:

> `EnrichedInput` must always have `ocrSkipped === false OR ocrSkipped === true` (i.e., the OCR attempt must be made or explicitly skipped) before the input is passed to the routing function. The routing function must never be called with a `TurnInput` — it must always receive an `EnrichedInput`.

This is enforced by type: the routing function accepts `EnrichedInput`, not `TurnInput`. A caller cannot skip OCR and go straight to routing without either performing OCR or explicitly constructing an `EnrichedInput` with `ocrSkipped: true`.

Additionally: define a timeout. If Electron OCR does not respond in N milliseconds, the pipeline proceeds with `ocrSkipped: true`. This prevents image processing latency from hanging the UI.

**Where this affects the codebase:**  
- `sidepanel.tsx::handleSendMessage` — resequence OCR and routing
- `processFlow.ts::routeInput` (new canonical version) — input type is `EnrichedInput`
- Electron `/api/ocr/process` — no change, but the calling code must await it before routing

---

### NB-4: No Provider/Model Registry — UI and Runtime Use Different Strings
**Severity: Critical**

**What is missing:**  
There is no shared constants file for provider identities. The UI uses `'Local AI'`, `'OpenAI'`, `'Anthropic'`, `'Gemini'`, `'Grok'`. The runtime recognizes `'ollama'`, `'local'`, `''`. The consequence is a silent mismatch that causes every `'Local AI'` box to use the fallback model.

**Why it blocks coherence:**  
Any implementation that wires cloud providers will face the same problem immediately. The first developer to add OpenAI support will write a string comparison for `'openai'`. A second developer will add `'OpenAI'` (capitalized, as the UI presents it). These will be different. The system will develop a growing list of provider string variations, each handled somewhere, none comprehensively.

**What normalization requires:**  
One source of truth for provider identities:

```typescript
// src/constants/providers.ts
export const PROVIDER_IDS = {
  LOCAL_OLLAMA: 'ollama',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  GROK: 'grok',
} as const;

export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS];

// The UI display label (what users see) is separate from the identity
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: 'Local AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  grok: 'Grok / xAI',
};
```

**Critical rule:** The `provider` field stored in `CanonicalAgentBoxConfig` must be a `ProviderId`, not the UI display label. The conversion from display label to `ProviderId` must happen at save time (in the UI), not at resolve time (in `resolveModelForAgent`). Never convert at resolve time — that is where the current mismatch lives.

**For grid scripts (plain JS):** These cannot import TypeScript types. They must duplicate the constants, or a shared JSON file must be published as part of the build. The provider IDs themselves are simple strings — duplicating the small constants object is acceptable with a comment pointing to the canonical source.

**Where this affects the codebase:**  
- New file: `src/constants/providers.ts`
- `processFlow.ts::resolveModelForAgent` — switch on `ProviderId`
- `content-script.tsx` Agent Box dialogs — save `ProviderId`, not label
- `grid-script.js`, `grid-script-v2.js` — inline constant copy
- `CanonicalAgentBoxConfig.ts` — `provider` field typed as `ProviderId`

---

### NB-5: Agent Box Persistence Split — Routing Cannot See Grid Boxes
**Severity: Critical**

**What is missing:**  
A contract defining where Agent Box records are stored and which store is authoritative for routing-time reads. Currently: sidepanel boxes write through the adapter chain (chrome.storage → SQLite); grid boxes write directly to SQLite only. `loadAgentBoxesFromSession` reads `chrome.storage.local` only.

**Why it blocks coherence:**  
This is a split ownership problem. There is no authoritative store for all boxes. The routing engine reads from one store; the grid UI writes to another. Any implementation that wires grid box output delivery will fail at the persistence layer. The failure is silent — there is no error, just no output.

**What normalization requires:**  

Define one canonical persistence path for all Agent Boxes regardless of surface:

> **Rule:** All Agent Box creates and updates must write to the same store that `loadAgentBoxesFromSession` reads from at routing time. There must be exactly one canonical box store per session.

Two valid implementation approaches — choose one:

**Option A (simpler):** Grid box saves write to `chrome.storage.local` (via the extension adapter chain, same as sidepanel). `SAVE_AGENT_BOX_TO_SQLITE` becomes a secondary sync, not the primary write. The routing engine reads from the adapter chain as it does now.

**Option B (cleaner):** `loadAgentBoxesFromSession` reads from the active storage adapter (SQLite when Electron is running), same as `loadAgentsFromSession`. Grid box saves write to SQLite (as they currently do). The read path is updated, not the write path.

Option B is architecturally preferable because it aligns box loading with agent loading (both from SQLite). But it requires changing the routing-time read path, which has broader impact. Option A is safer for the first pass if the adapter chain is confirmed to be consistent.

The choice is an implementation decision. The normalization requirement is: **one store, one read path, one write path — for all boxes.**

**Where this affects the codebase:**  
- `processFlow.ts::loadAgentBoxesFromSession` — must read from canonical store
- `background.ts` — `SAVE_AGENT_BOX_TO_SQLITE` handler must also write to chrome.storage if Option A
- Grid scripts — box save path must write to the canonical store
- Grid display pages — session loading must use storage proxy, not direct HTTP

---

### NB-6: No Output-Routing Contract — Delivery Is Surface-Specific
**Severity: High**

**What is missing:**  
A shared contract for how output reaches its destination. Currently, `updateAgentBoxOutput` is a single function that reads chrome.storage, updates one box, and sends `UPDATE_AGENT_BOX_OUTPUT`. The sidepanel handles it. The grid does not.

**Why it blocks coherence:**  
As soon as grid boxes are visible to routing (NB-5 resolved), output will be delivered to grid boxes — but grid pages have no handler. Adding a handler without a shared `OutputEvent` contract means the grid handler will be written to match the current `UPDATE_AGENT_BOX_OUTPUT` message format, which itself is undocumented. When streaming output is added, or when multi-box fan-out is added, each implementation creates a new message format.

**What normalization requires:**  
Define `OutputEvent` as a typed message contract that all output delivery uses, and all subscribers handle:

```typescript
interface OutputEvent {
  type: 'UPDATE_AGENT_BOX_OUTPUT';
  turnId: string;
  agentRunId: string;        // unique ID for this agent execution
  target: OutputTarget;
  content: string;
  status: 'complete' | 'streaming' | 'error';
  errorMessage?: string;     // populated when status === 'error'
  timestamp: number;
}

interface OutputTarget {
  type: 'sidepanel_box' | 'grid_box' | 'inline_chat';
  boxId: string;
  agentNumber: number;
  boxNumber: number;
  surface: 'sidepanel' | 'grid';
}
```

Subscribers (sidepanel and grid pages) filter by `target.surface` to determine if the event is relevant to them. Grid pages register their rendered box IDs on mount.

**Where this affects the codebase:**  
- `processFlow.ts::updateAgentBoxOutput` — emit typed `OutputEvent`
- `sidepanel.tsx` message handler — consume `OutputEvent`
- `grid-script.js`, `grid-script-v2.js` — add message listener for `OutputEvent`
- `grid-display.js` — add box ID registration on mount

---

### NB-7: Session Persistence Authority — Three Readers, No Owner
**Severity: High**

**What is missing:**  
A rule establishing which store is the canonical owner of session state at any given time, and which store all reads must go through.

**Why it blocks coherence:**  
- Sidepanel reads via storage adapter (chrome.storage → SQLite based on Electron availability)
- Grid display pages read via direct HTTP to Electron (`GET /api/orchestrator/get`)
- `loadAgentBoxesFromSession` reads `chrome.storage.local` directly (bypassing the adapter)

Three readers with three different paths produce three potentially different views of the same session. This is especially dangerous for box state: a grid page may load from SQLite and show boxes that the routing engine (reading chrome.storage) cannot find.

**What normalization requires:**  

Define one canonical session-read path per context:

```
Rule:
  When Electron is running → SQLite is the canonical store
  When Electron is not running → chrome.storage is the canonical store
  
  All reads must go through storageWrapper (the adapter chain)
  No component may read session state directly from chrome.storage
  No component may read session state directly via Electron HTTP
  Grid display pages must load session via storageWrapper (message to service worker)
```

Enforcing this requires:
1. `loadAgentBoxesFromSession` uses `storageWrapper.getItem` instead of `chrome.storage.local.get`
2. Grid display pages send a `GET_SESSION` message to the service worker, not a direct Electron HTTP call
3. `storageWrapper.ts` exposes a consistent `get/set` API that hides the adapter selection

**Where this affects the codebase:**  
- `processFlow.ts::loadAgentBoxesFromSession` — use adapter, not direct chrome.storage
- `grid-display.js` — message to service worker, not direct HTTP
- `storageWrapper.ts` — expose stable public API
- `background.ts` — handle `GET_SESSION` from grid context if not already present

---

### NB-8: No Runtime Agent Config Contract — Schema Presence ≠ Runtime Consumption
**Severity: Medium**

**What is missing:**  
A typed interface that declares exactly which fields of `CanonicalAgentConfig` are consumed by the runtime (i.e., read by `buildSystemPrompt`, `evaluateAgentListener`, `resolveModelForAgent`, and the execution loop). Currently, `CanonicalAgentConfig` has ~30 fields; the runtime reads perhaps 6.

**Why it blocks coherence:**  
Any developer reading `CanonicalAgentConfig` will assume all fields influence behavior. When they add support for `agentContextFiles`, they will write the injection code but may not know whether `memorySettings` should also be wired at the same time, or whether the two are independent. Without a `RuntimeAgentConfig` that declares the consumed subset, every feature addition risks mixing concerns.

**What normalization requires:**  

```typescript
// The subset of CanonicalAgentConfig that the runtime actually reads
interface RuntimeAgentConfig {
  number: number;
  name: string;
  enabled: boolean;
  role: string;
  goals: string;
  rules: string;
  reasoning: string;        // flat — first pass only
  listening: {
    triggers: Trigger[];
    website?: string;
    expectedContext?: string;
    applyFor?: string;
    // sources[] intentionally omitted — not yet evaluated
  };
  // Future fields added here as they are wired:
  // reasoningSections?: ReasoningSection[];
  // agentContextFiles?: ContextFile[];
}
```

`buildSystemPrompt` and `evaluateAgentListener` should accept `RuntimeAgentConfig`, not `CanonicalAgentConfig`. This makes the gap between schema and runtime explicit at the type level.

**Where this affects the codebase:**  
- New type: `RuntimeAgentConfig` (may live in `processFlow.ts` or a shared types file)
- `processFlow.ts::wrapInputForAgent` → `buildSystemPrompt` takes `RuntimeAgentConfig`
- `InputCoordinator.ts::evaluateAgentListener` — currently takes `AgentConfig`; could narrow to `RuntimeAgentConfig`
- `processFlow.ts::loadAgentsFromSession` — can return `RuntimeAgentConfig[]` for routing purposes

---

## Normalization Blocker Priority Table

| Rank | Blocker | Severity | Must precede |
|---|---|---|---|
| 1 | NB-1: No `EnrichedInput` type | Critical | All others — it is the pipeline's data carrier |
| 2 | NB-3: OCR timing (before routing) | Critical | NB-2 (routing authority must consume `EnrichedInput`) |
| 3 | NB-2: No routing authority | Critical | NB-6 (output contract), NB-8 (agent config contract) |
| 4 | NB-4: No provider/model registry | Critical | Any cloud provider wiring |
| 5 | NB-5: Agent Box persistence split | Critical | Grid box output delivery |
| 6 | NB-6: No output-routing contract | High | Grid live output, streaming |
| 7 | NB-7: Session persistence authority | High | Reliable session reload |
| 8 | NB-8: No `RuntimeAgentConfig` contract | Medium | Reasoning harness feature additions |

---

## Which Normalization Must Be Resolved First

**NB-1 (`EnrichedInput`) must be resolved first.** It is not the most visible bug, and it is not the most immediately painful gap — but it is the substrate for every other normalization. Here is why:

- NB-3 (OCR timing) is meaningless without an `EnrichedInput` to carry the OCR result through the pipeline. You can move `processMessagesWithOCR` earlier in `handleSendMessage`, but if there is no typed object to receive its output, the result is still a raw string variable passed ad hoc.
- NB-2 (routing authority) cannot be normalized until the routing function's input type is defined. `routeInput(EnrichedInput)` is a clean contract. `routeInput(rawText, hasImage, ocrText, classifiedInput, ...)` is a parameter accumulation.
- NB-4 (provider registry) can be done independently, but the `provider` field on `AgentMatch` (produced by routing) must be typed as `ProviderId` — which requires the routing contract to be defined.
- NB-6 (output contract) can only be defined after the routing contract because `OutputTarget` must reference the `agentNumber` and `boxNumber` that come from the routing result.

**The correct sequence for normalization is therefore:**

```
1. Define TurnInput and EnrichedInput (NB-1) — data carrier
2. Resequence OCR and thread into EnrichedInput (NB-3) — OCR timing
3. Define routing authority and its contract (NB-2) — one routing function
4. Define provider registry and ProviderId (NB-4) — provider constants
5. Unify box persistence path (NB-5) — grid box visibility
6. Define OutputEvent contract (NB-6) — output delivery
7. Define session authority rule (NB-7) — session consistency
8. Define RuntimeAgentConfig (NB-8) — agent config clarity
```

Steps 1–4 are prerequisites for the minimum viable first pass. Steps 5–6 are required for grid box equivalence. Steps 7–8 are required for reliable operation but do not block the first path from working in a controlled environment.
