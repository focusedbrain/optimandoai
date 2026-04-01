# 17 — Normalization Requirements Before Full Wiring

**Status:** Analysis-only. Final synthesis.  
**Date:** 2026-04-01  
**Basis:** All prior documents (00–16) in this analysis series.

---

## Preface

This is the most operationally important document in the synthesis. It defines what must be normalized — not just patched — before building the real orchestrator wiring. The goal is to prevent the next round of implementation from embedding today's architecture debt into permanent interfaces.

Each section follows this format:
- **Current state** — what exists today
- **The problem** — why current state breaks real wiring
- **Required normalization** — what must be defined and stabilized first
- **Risk if skipped** — consequence if implementation proceeds on current base

---

## What Must Be Normalized Before Building the Real Orchestrator

---

### N-1: Routing Contract

**Current state:** Three routing paths co-exist:
1. `routeInput` (processFlow.ts) — authoritative for execution, pre-OCR
2. `routeClassifiedInput` (InputCoordinator.ts) — post-OCR, logged, not used for execution
3. `routeEventTagTrigger` (InputCoordinator.ts) — richer, post-OCR, also logged only

There is no single routing contract. The execution path and the analytical paths are different code chains that produce different data structures.

**The problem:** If a developer adds OCR-aware behavior to `routeClassifiedInput`, they'll think it's wired — it isn't. If they fix `routeInput` without understanding the other two, they'll duplicate logic or break the partial analysis.

**Required normalization:**
- Define a single canonical `RoutingInput` object that carries: rawText, ocrText (optional), hasImage, sourceType, sessionContext
- Define where routing authority lives: one function, one output type, one execution consumer
- Retire or explicitly demote the secondary routing paths to audit-only until they are properly integrated

**Risk if skipped:** Two or three partially-wired routing paths, each partially correct, producing false confidence that routing "works."

---

### N-2: Enriched Input Object

**Current state:** Input is passed as raw strings through most of the pipeline:
- `routeInput(userInput: string, session, agentBoxes)`
- `evaluateAgentListener(agent, input: string, ...)`
- `wrapInputForAgent(agent, box, input: string, ocrText?: string)`

There is no shared `EnrichedInput` type.

**The problem:** Each function re-derives properties (hasImage, isOCR, ocrText) from different heuristics. There is no single object that carries: user text, image presence, extracted OCR text, NLP classification, session context, timestamp. The same fields are computed independently 3–4 times, and some computations happen at different moments (pre/post OCR).

**Required normalization:**
```typescript
interface EnrichedInput {
  rawText: string;           // original user-typed text
  ocrText?: string;          // extracted from images in current turn
  hasImage: boolean;         // at least one image in current turn
  hasInlineText: boolean;    // user typed something beyond the image
  classified?: ClassifiedInput; // NLP output (may arrive post-OCR)
  sourceType: 'wrchat' | 'event_tag' | 'voice' | ...;
  sessionSnapshot: SessionSnapshot; // immutable at routing time
  turnId: string;            // unique per send action
}
```

Define this type in a shared location, pass it through routing, listener evaluation, reasoning assembly, and output routing. Replace `hasImage` re-derivation with a single authoritatve check.

**Risk if skipped:** Every new feature (OCR routing, voice, DOM trigger) adds another ad-hoc property to function signatures, producing an ever-longer list of optional parameters with conflicting defaults.

---

### N-3: OCR Timing

**Current state:** OCR runs after `routeInput`. The result is appended to the message history, and a second (discarded) routing pass uses it.

**The problem:** OCR must inform routing for the feature to work. Any implementation that does not move OCR before routing will break image-triggered agents.

**Required normalization:**
- OCR must complete before any routing call that drives execution
- If OCR is async and slow, the contract must define a timeout and fallback behavior (route on text-only if OCR exceeds threshold)
- The handoff from OCR → `EnrichedInput` → routing must be explicit in the call graph

**Risk if skipped:** A developer implementing "fix OCR routing" moves OCR earlier but does not thread `ocrText` into `EnrichedInput`, so trigger matching still uses only raw text.

---

### N-4: Provider / Model Registry

**Current state:**
- UI uses: `'Local AI'`, `'OpenAI'`, `'Anthropic'`, `'Gemini'`, `'Grok'`
- Runtime recognizes: `'ollama'`, `'local'`, `''`
- `resolveModelForAgent` hard-codes partial string matching
- No shared constant file for provider identifiers

**The problem:** The UI and runtime use different strings for the same concept. When the model registry is extended (new local backend, new cloud provider), there is no single place to update. The mismatch is currently silent and produces wrong model selection.

**Required normalization:**
```typescript
// providers.ts
export const PROVIDER_IDS = {
  LOCAL_OLLAMA: 'ollama',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  GROK: 'grok',
} as const;

export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS];
```

- The UI must use these constants in selectors and stored values
- `resolveModelForAgent` must switch on `ProviderId` values
- Grid scripts and content-script must import or duplicate these values consistently

**Risk if skipped:** Every provider feature added creates a new mismatch. Cloud integration will be built using UI strings that never match the call paths.

---

### N-5: Agent Box Contract

**Current state:** `CanonicalAgentBoxConfig` defines the schema. But:
- Sidepanel boxes and grid boxes have different write paths
- `loadAgentBoxesFromSession` reads only `chrome.storage.local`
- Grid boxes are saved directly to SQLite
- No guaranteed consistency between stores

**The problem:** The box contract says `identifier` and `agentNumber` determine which agent uses which box. In practice, grid boxes cannot be found by the routing engine because they are in the wrong store.

**Required normalization:**
- Define one write path for all box types: all boxes must reach `chrome.storage.local` (or the active adapter) as the routing-time read store
- OR: define `loadAgentBoxesFromSession` to read from SQLite directly via the adapter
- All box saves must be idempotent writes to the same adapter chain
- Box reads by the routing engine must use the same chain

**Risk if skipped:** Grid box wiring is built on top of the wrong store. All grid-targeted agent output silently drops.

---

### N-6: Session Persistence Authority

**Current state:** Three possible sources of truth for session state:
1. `chrome.storage.local` (direct)
2. SQLite via service worker proxy (adapter routing)
3. SQLite via Electron HTTP (grid display pages)

Adapter selection is runtime-dynamic. No conflict resolution strategy.

**The problem:** When building session persistence for orchestrator state (which boxes are active, what outputs have been delivered, which agents ran), there is no clear owner. Implementing "save session" or "restore session" on top of ambiguous authority produces write-after-read conflicts.

**Required normalization:**
- Define one authoritative session store per context: Electron-running → SQLite is canonical; no Electron → `chrome.storage`
- Grid pages must go through the same proxy as sidepanel — not direct HTTP
- `storageWrapper.ts` must expose a `getSessionOwner()` or the adapter decision must be documented and frozen

**Risk if skipped:** Grid session loading returns a different session than sidepanel session — two views of the same "workspace" that diverge over time.

---

### N-7: Runtime Consumption of Agent Settings

**Current state:** The runtime reads:
- `agent.reasoning` (flat string) — used ✓
- `agent.role`, `agent.goals`, `agent.rules` — used ✓
- `agent.reasoningSections[]` — ignored
- `agent.agentContextFiles[]` — ignored
- `agent.memorySettings.*` — ignored
- `agent.contextSettings.*` — ignored
- `agent.listening.sources[]` — ignored
- `agent.executionSection.mode` — ignored

**The problem:** The UI presents these as live configuration. Users configure them. None of them influence runtime. If a developer adds partial support for one (e.g., context files), they will not know which others are expected to work. The feature set of the runtime is undefined.

**Required normalization:**
- Define a `RuntimeAgentConfig` interface that declares only what the runtime actually reads
- Every field on `CanonicalAgentConfig` must be classified as: *consumed*, *persisted-only*, or *future*
- Build `wrapInputForAgent` against `RuntimeAgentConfig`, not the full canonical type
- Add a TODO annotation on any schema field that is persisted but not yet consumed

**Risk if skipped:** Implementation adds partial context-file support, partial memory support, partial multi-section reasoning — each layer barely works and no developer can tell which configuration actually has effect at runtime.

---

### N-8: Output-Routing Contract

**Current state:** `updateAgentBoxOutput` finds a box by `agentBoxId`, updates output in `chrome.storage.local`, sends `UPDATE_AGENT_BOX_OUTPUT`. Sidepanel handles it. Grid does not.

**The problem:** The output destination contract (which box receives which output, how live updates are delivered) is currently implicit and sidepanel-only. Building multi-box output, display-grid output, or streaming output on this base will produce separate ad-hoc implementations.

**Required normalization:**
Define an `OutputRoutingContract`:
```
OutputTarget {
  type: 'sidepanel_box' | 'grid_box' | 'inline_chat' | 'email' | 'webhook'
  boxId?: string
  agentNumber?: number
  boxNumber?: number
}

OutputEvent {
  agentRunId: string
  target: OutputTarget
  content: string
  status: 'streaming' | 'complete' | 'error'
  timestamp: number
}
```

- All output delivery goes through one emit path
- Both sidepanel and grid pages subscribe to the same output channel
- Grid pages register their box IDs with the output channel on mount
- `updateAgentBoxOutput` becomes the implementation of this contract, not its definition

**Risk if skipped:** Streaming output, multi-box fan-out, and display-grid wiring each get their own ad-hoc message format. No way to add an output destination without touching every consumer.

---

## Summary: Normalization Priority Order

| Priority | Normalization | Reason |
|---|---|---|
| 1 | N-3: OCR timing | Nothing image-based works until this is resolved |
| 2 | N-2: EnrichedInput | Prerequisite for coherent routing and reasoning |
| 3 | N-1: Routing contract | One path, one output type, one execution consumer |
| 4 | N-4: Provider/model registry | Prevents provider string mismatch from propagating |
| 5 | N-5: Agent Box contract | Grid box visibility requires write-path unification |
| 6 | N-8: Output-routing contract | Grid live updates, streaming, multi-box fan-out |
| 7 | N-6: Session persistence authority | Prevents dual-session drift on complex scenarios |
| 8 | N-7: Runtime agent settings | Clears ambiguity about what config is "live" |

---

## What Can Be Skipped for the First Wiring Pass

These are not blocking if the implementation focuses on the core WR Chat → local agent → sidepanel box path:

- `acceptFrom` multi-agent chaining
- `listening.sources[]` filtering
- `executionMode` branching (beyond box output)
- WR Experts / `agentContextFiles` injection
- API key sync (provided cloud is confirmed as future scope)
- Schema versioning / migration (provided no import/export is built in this pass)
- Mobile flags
