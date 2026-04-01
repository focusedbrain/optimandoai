# 15–19 — Final Architecture Synthesis
## Orchestrator Implementation-Oriented Blueprint

**Status:** Final synthesis. Handoff package for Opus Thinking + screenshot-assisted implementation round.  
**Date:** 2026-04-01  
**Series:** Documents 15 through 19 unified.  
**Basis:** Full prior analysis series (documents 00–14), stabilization pass, codebase deep-reads.

---

# Part I: Gap Analysis vs Product Intent
*(Source: 15-gap-analysis-vs-product-intent.md)*

## Classification Legend

| Status | Meaning |
|---|---|
| **Implemented** | Working end-to-end as intended, code-proven |
| **Partially implemented** | Core logic exists but incomplete, misordered, or missing critical steps |
| **UI-only** | UI renders it correctly; runtime does not honor it |
| **Mismatched** | Code exists but does the wrong thing |
| **Structurally blocked** | Cannot work without resolving an architectural conflict first |
| **Unclear** | Insufficient evidence from current analysis round |

---

## 1. OCR-Aware Routing — **Mismatched**

`routeInput` runs at sidepanel.tsx line 2925; `processMessagesWithOCR` runs at line 2943. The routing decision that drives agent execution uses pre-OCR text. `routeClassifiedInput` receives OCR-enriched text but its result is logged and discarded.

**Gap:** OCR correctly processes images but arrives after the authoritative routing decision. An agent configured with a trigger only found in OCR text will never activate in the WR Chat path.

---

## 2. Listener Wake-Up — **Partially implemented**

`evaluateAgentListener` correctly evaluates capability check, website filter, trigger name matching, expected context, and `applyFor` input type. Tag-based triggers, website filter, expected context, and `applyFor` work.

**What doesn't:** `listening.sources[]` (14 source types) is never evaluated. DOM trigger types (`dom_event`, `dom_parser`, `augmented_overlay`) have no confirmed runtime handler. Listener runs on pre-OCR text.

---

## 3. Reasoning Harness — **Partially implemented**

`wrapInputForAgent` assembles role, goals, rules, custom fields, user input, and ocrText into the LLM system message.

**Gaps:** `reasoningSections[]` (multi-section, per-trigger) is ignored in WR Chat path — only flat `agent.reasoning` is read. `agentContextFiles[]` is persisted, not injected. `memoryContext` toggles are persisted, not consumed. WR Experts have no confirmed integration point in agent config. `acceptFrom` is never evaluated.

---

## 4. Execution Routing — **Partially implemented (output destination only)**

Output is written to the matched Agent Box via `updateAgentBoxOutput`. `findAgentBoxesForAgent` resolves destination box by agentNumber / reportTo / specialDestinations.

**Gaps:** `executionMode` (4 modes) is not branched on in `processWithAgent`. Non-box destinations (email, webhook, storage, notification) are defined but not implemented. `resolveExecutionConfig` only runs on the event-tag path, not the WR Chat path.

---

## 5. Agent Box as Brain Container — **Mismatched**

Schema `CanonicalAgentBoxConfig` has provider, model, tools. UI correctly populates them.

**Gap:** `resolveModelForAgent` treats `'Local AI'` (lowercased to `'local ai'`) as unrecognized — fallback. All cloud providers → "API not yet connected" fallback.

---

## 6. Global Context / Global Memory Usage — **Unclear**

`contextSettings` and `memorySettings` exist on schema and UI. Not consumed in `wrapInputForAgent`. No global context registry was found.

---

## 7. Agent-Level Context / Memory Usage — **UI-only**

`agentContextFiles[]` is persisted. `memorySettings` values are persisted. `wrapInputForAgent` reads neither.

---

## 8. Local Model Sync — **Partially implemented (post-stabilization pass)**

`localOllamaModels.ts` fetches real model names via `electronRpc('llm.status')`. UI correctly shows real installed models.

**Remaining gap:** `resolveModelForAgent` does not recognize `'Local AI'` as a local provider — the fetched model name is stored correctly but discarded at runtime.

---

## 9. API Key / Provider Visibility — **Mismatched**

Extension: `saveApiKeys` → `localStorage`. Electron: `handshake:getAvailableModels` → SQLite. Agent Box dropdowns show all 4 cloud providers regardless of key state (static list). Cloud provider API calls are unimplemented regardless of key state. Two key stores with no sync.

---

## 10. Sidepanel / Display-Grid Equivalence — **Structurally blocked**

Both use `CanonicalAgentBoxConfig`. But:
- `loadAgentBoxesFromSession` reads `chrome.storage.local` only
- Grid boxes are saved directly to SQLite
- `UPDATE_AGENT_BOX_OUTPUT`: sidepanel handles it; grid pages have no handler

Three structural blockers:
1. `loadAgentBoxesFromSession` must read SQLite
2. Grid box writes must reach chrome.storage (or adapter must mirror)
3. Grid pages must handle `UPDATE_AGENT_BOX_OUTPUT`

---

## 11. Session / Global Scoping — **Partially implemented**

Session-scoped agents: `session.agents[]` ✓. Account-scoped agents: `saveAccountAgents` / `getAccountAgents`. Session blob has no `_schemaVersion` field. Account agent storage key and adapter path unconfirmed.

---

## 12. Mobile Flags — **UI-only (intentional MVP)**

`desktop` and `mobile` checkboxes on agent cards. Not in canonical schema. Not consumed. Correct for MVP scope.

---

## Summary Classification Table

| Area | Classification | Blocking Issue |
|---|---|---|
| OCR-aware routing | **Mismatched** | routeInput runs before OCR |
| Listener wake-up | **Partially implemented** | Sources not evaluated; OCR timing wrong |
| Reasoning harness | **Partially implemented** | Multi-sections ignored; context/memory/WR Experts absent |
| Execution routing | **Partially implemented** | Mode ignored; non-box destinations absent |
| Agent Box as brain | **Mismatched** | Provider string mismatch; cloud unimplemented |
| Global context/memory | **Unclear** | No confirmed runtime path |
| Agent context/memory | **UI-only** | Not read by prompt assembly |
| Local model sync | **Partially implemented** | UI correct; runtime provider mismatch |
| API key/provider visibility | **Mismatched** | Two key stores; dropdowns not key-gated |
| Sidepanel/grid equivalence | **Structurally blocked** | Box persistence split; no live grid update |
| Session/global scoping | **Partially implemented** | Account agent path unconfirmed; no session version |
| Mobile flags | **UI-only (intentional MVP)** | — |

---

# Part II: Risk Map and Failure Modes
*(Source: 16-risk-map-and-failure-modes.md)*

## Severity Scale

| Level | Meaning |
|---|---|
| **Critical** | Will silently fail or produce wrong output; user has no visibility |
| **High** | Feature broken under common conditions; visible failure or degraded result |
| **Medium** | Feature degrades under edge conditions; intermittent or low-visibility |
| **Low** | Cosmetic or fallback acceptable for current scope |

---

## Architectural Risks

### AR-1: OCR Runs After Authoritative Routing
**Severity:** Critical | **Category:** Sequencing | **Location:** `sidepanel.tsx:2925,2943`

Any agent whose trigger would be found only in OCR-extracted text will silently fail to activate in the WR Chat path.

### AR-2: Provider String Mismatch (`'Local AI'` vs `'local'`)
**Severity:** Critical | **Category:** Abstraction mismatch | **Location:** `processFlow.ts::resolveModelForAgent:1210–1245`

UI stores `'Local AI'`. Runtime recognizes `'ollama'`, `'local'`, `''`. After lowercasing, `'local ai'` matches none. Every local model call silently falls back.

### AR-3: Cloud Provider Execution Is Entirely Absent
**Severity:** Critical | **Category:** Backend/frontend mismatch | **Location:** `processFlow.ts::resolveModelForAgent`

All cloud providers hit "API not yet connected". Every cloud brain silently routes to local Ollama.

### AR-4: Display-Grid Boxes Are Invisible to Routing Engine
**Severity:** Critical | **Category:** State drift | **Location:** `processFlow.ts::loadAgentBoxesFromSession`

`loadAgentBoxesFromSession` reads `chrome.storage.local` only. Grid boxes are in SQLite. Routing engine has a structural blind spot.

### AR-5: `UPDATE_AGENT_BOX_OUTPUT` Not Handled by Grid Pages
**Severity:** Critical | **Category:** Backend/frontend mismatch | **Location:** `grid-script.js / grid-script-v2.js`

Sidepanel listens and updates React state. Grid pages have no handler. No live update ever reaches the grid.

### AR-6: Two API Key Stores with No Sync
**Severity:** High | **Category:** State drift | **Location:** `content-script.tsx::saveApiKeys` → `localStorage`; `main.ts` → SQLite

Keys saved in extension go to `localStorage`. Keys potentially read by Electron backend come from SQLite. No confirmed synchronization.

### AR-7: Session Schema Has No Version Field
**Severity:** High | **Category:** Schema drift | **Location:** `storageWrapper.ts`, `orchestrator-db/service.ts`

No `_schemaVersion` on session blobs. Any schema evolution silently breaks deserialization.

### AR-8: `reasoningSections[]` Ignored in Main Execution Path
**Severity:** High | **Category:** Abstraction mismatch | **Location:** `processFlow.ts::wrapInputForAgent`

`wrapInputForAgent` reads only flat `agent.reasoning`. Multi-section reasoning harness only exercised on the event-tag path, not WR Chat.

### AR-9: `agentContextFiles` and `memorySettings` Are Silent No-Ops
**Severity:** High | **Category:** UI drift | **Location:** `processFlow.ts::wrapInputForAgent`

Users upload context files and toggle memory settings. Neither is read by `wrapInputForAgent`.

### AR-10: No Authoritative Session Ownership
**Severity:** High | **Category:** State drift | **Location:** `storageWrapper.ts`, `background.ts`, `main.ts`

Three distinct session readers with dynamic adapter selection and no conflict resolution.

### AR-11: NLP/OCR-Enriched Routing Results Discarded
**Severity:** Medium | **Category:** Sequencing | **Location:** `sidepanel.tsx:2967–3030`

`routeClassifiedInput` and `routeEventTagInput` run after OCR, compute allocations — results logged only.

### AR-12: `acceptFrom` Field Never Evaluated
**Severity:** Medium | **Category:** UI drift | **Location:** `InputCoordinator.ts::evaluateAgentListener`

Multi-agent chaining via `acceptFrom` has no effect silently.

### AR-13: `ocrText` Race Condition in `processMessagesWithOCR`
**Severity:** Medium | **Category:** Sequencing | **Location:** `sidepanel.tsx::processMessagesWithOCR`

Multiple prior images → `ocrText` only captures last result. Earlier context lost from the variable.

### AR-14: Grid Session Loading Bypasses Storage Proxy
**Severity:** Medium | **Category:** Backend/frontend mismatch | **Location:** `grid-display.js`

Grid pages load session data via direct HTTP to Electron, bypassing the service worker proxy.

### AR-15: No Confirmed WR Experts Integration Point
**Severity:** Low (architecture risk for upcoming work) | **Category:** Abstraction mismatch

Email `WRExpert.md` and orchestrator `agentContextFiles` share a concept name but are entirely separate features.

---

## Likely Runtime Failure Modes

| ID | Failure | Severity | Root Cause |
|---|---|---|---|
| FM-1 | Image input, agent doesn't wake up | Critical | AR-1 |
| FM-2 | Local agent calls wrong model | Critical | AR-2 |
| FM-3 | Cloud agent silently uses Ollama | Critical | AR-3 |
| FM-4 | Grid box never receives output | Critical | AR-4 + AR-5 |
| FM-5 | Context files set but not used in reasoning | High | AR-9 |
| FM-6 | Multi-section reasoning collapses to flat | High | AR-8 |
| FM-7 | API key present, cloud call still fails | High | AR-6 |
| FM-8 | After session reload, box outputs gone | High | AR-7 + AR-4 |
| FM-9 | Agent with source filter fires on all input | Medium | AR-1 + unimplemented sources[] |
| FM-10 | Multi-agent chain never fires | Medium | AR-12 |

---

## Risk Classification Matrix

| ID | Risk | Severity | Category | Code Location |
|---|---|---|---|---|
| AR-1 | OCR after routing | Critical | Sequencing | sidepanel.tsx:2925,2943 |
| AR-2 | Provider string mismatch | Critical | Abstraction mismatch | processFlow.ts:resolveModelForAgent |
| AR-3 | Cloud execution absent | Critical | Backend/frontend mismatch | processFlow.ts:resolveModelForAgent |
| AR-4 | Grid boxes invisible | Critical | State drift | processFlow.ts:loadAgentBoxesFromSession |
| AR-5 | No grid live update | Critical | Backend/frontend mismatch | grid-script.js (missing handler) |
| AR-6 | API key split-brain | High | State drift | content-script.tsx / main.ts |
| AR-7 | No session schema version | High | Schema drift | storageWrapper.ts |
| AR-8 | reasoningSections ignored | High | Abstraction mismatch | processFlow.ts:wrapInputForAgent |
| AR-9 | Context files silent no-op | High | UI drift | processFlow.ts:wrapInputForAgent |
| AR-10 | Session owner ambiguous | High | State drift | storageWrapper.ts / background.ts |
| AR-11 | NLP/OCR enrichment discarded | Medium | Sequencing | sidepanel.tsx:2967–3030 |
| AR-12 | acceptFrom not evaluated | Medium | UI drift | InputCoordinator.ts |
| AR-13 | ocrText race condition | Medium | Sequencing | sidepanel.tsx:processMessagesWithOCR |
| AR-14 | Grid bypasses storage proxy | Medium | Backend/frontend mismatch | grid-display.js |
| AR-15 | WR Experts name collision | Low | Abstraction mismatch | agentContextFiles / email WRExpert.md |

---

# Part III: Normalization Requirements Before Full Wiring
*(Source: 17-normalization-requirements-before-full-wiring.md)*

---

## What Must Be Normalized Before Building the Real Orchestrator

---

### N-1: Routing Contract

**Current state:** Three routing paths co-exist without a clear execution authority.

**Required normalization:**
- Define a single canonical `RoutingInput` object carrying rawText, ocrText, hasImage, sourceType, sessionContext
- Define where routing authority lives: one function, one output type, one execution consumer
- Retire or explicitly demote secondary routing paths to audit-only

**Risk if skipped:** Two or three partially-wired routing paths, each partially correct, producing false confidence that routing "works."

---

### N-2: Enriched Input Object

**Current state:** Input passed as raw strings. Each function re-derives `hasImage`, `ocrText`, `source` independently.

**Required normalization:**
```typescript
interface EnrichedInput {
  rawText: string;
  ocrText?: string;
  hasImage: boolean;
  hasInlineText: boolean;
  classified?: ClassifiedInput;
  sourceType: 'wrchat' | 'event_tag' | 'voice' | ...;
  sessionSnapshot: SessionSnapshot;
  turnId: string;
}
```

Define this type, thread through routing → listener evaluation → reasoning assembly → output routing.

**Risk if skipped:** Every new feature adds another ad-hoc property to function signatures with conflicting defaults.

---

### N-3: OCR Timing

**Current state:** OCR runs after `routeInput`.

**Required normalization:**
- OCR must complete before any routing call that drives execution
- Define a timeout and fallback behavior for slow OCR
- The handoff from OCR → `EnrichedInput` → routing must be explicit

**Risk if skipped:** Developer "fixes" OCR routing but doesn't thread `ocrText` into `EnrichedInput`, so trigger matching still uses raw text.

---

### N-4: Provider / Model Registry

**Current state:** UI uses `'Local AI'`. Runtime recognizes `'ollama'`, `'local'`, `''`. No shared constants.

**Required normalization:**
```typescript
export const PROVIDER_IDS = {
  LOCAL_OLLAMA: 'ollama',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  GROK: 'grok',
} as const;
```

UI selectors, storage values, and `resolveModelForAgent` must all use these constants.

**Risk if skipped:** Every provider feature creates a new mismatch. Cloud integration will be built using UI strings that never match the call paths.

---

### N-5: Agent Box Contract

**Current state:** Sidepanel boxes and grid boxes have different write paths. `loadAgentBoxesFromSession` reads only `chrome.storage.local`. Grid boxes in SQLite.

**Required normalization:**
- Define one write path for all box types to the same adapter chain
- `loadAgentBoxesFromSession` must read from the same adapter
- Box saves must be idempotent writes to the same chain

**Risk if skipped:** Grid box wiring built on wrong store. All grid-targeted agent output silently drops.

---

### N-6: Session Persistence Authority

**Current state:** Three possible sources for session state: `chrome.storage.local`, SQLite via proxy, SQLite via HTTP.

**Required normalization:**
- Electron running → SQLite is canonical; no Electron → `chrome.storage`
- Grid pages must go through the same proxy as sidepanel
- `storageWrapper.ts` must expose a `getSessionOwner()` or the decision must be frozen

**Risk if skipped:** Grid session returns a different view than sidepanel — two diverging views of the same workspace.

---

### N-7: Runtime Consumption of Agent Settings

**Current state:** `agent.reasoningSections[]`, `agentContextFiles[]`, `memorySettings.*`, `contextSettings.*`, `listening.sources[]`, `executionSection.mode` — all ignored.

**Required normalization:**
- Define a `RuntimeAgentConfig` interface declaring only what the runtime actually reads
- Classify every field as: *consumed*, *persisted-only*, or *future*
- Build `wrapInputForAgent` against `RuntimeAgentConfig`
- Add TODO annotation on any schema field persisted but not consumed

**Risk if skipped:** Partial implementation of each feature, each barely working, with no developer able to tell which configuration actually has runtime effect.

---

### N-8: Output-Routing Contract

**Current state:** `updateAgentBoxOutput` finds a box by `agentBoxId`, updates storage, sends `UPDATE_AGENT_BOX_OUTPUT`. Sidepanel handles it. Grid does not.

**Required normalization:**
```
OutputTarget {
  type: 'sidepanel_box' | 'grid_box' | 'inline_chat' | 'email' | 'webhook'
  boxId?: string
}

OutputEvent {
  agentRunId: string
  target: OutputTarget
  content: string
  status: 'streaming' | 'complete' | 'error'
  timestamp: number
}
```

Both sidepanel and grid pages subscribe to the same output channel. Grid pages register their box IDs on mount.

**Risk if skipped:** Streaming output, multi-box fan-out, and display-grid wiring each get their own ad-hoc message formats.

---

## Normalization Priority Order

| Priority | Normalization | Reason |
|---|---|---|
| 1 | N-3: OCR timing | Nothing image-based works until this is resolved |
| 2 | N-2: EnrichedInput | Prerequisite for coherent routing and reasoning |
| 3 | N-1: Routing contract | One path, one output type, one execution consumer |
| 4 | N-4: Provider/model registry | Prevents provider string mismatch from propagating |
| 5 | N-5: Agent Box contract | Grid box visibility requires write-path unification |
| 6 | N-8: Output-routing contract | Grid live updates, streaming, multi-box fan-out |
| 7 | N-6: Session persistence authority | Prevents dual-session drift |
| 8 | N-7: Runtime agent settings | Clears ambiguity about what config is "live" |

---

## What Can Be Skipped for the First Wiring Pass

- `acceptFrom` multi-agent chaining
- `listening.sources[]` filtering
- `executionMode` branching (beyond box output)
- WR Experts / `agentContextFiles` injection
- API key sync (if cloud is confirmed as future scope)
- Schema versioning / migration (if no import/export in this pass)
- Mobile flags

---

# Part IV: Flexible Implementation Blueprint
*(Source: 18-flexible-implementation-blueprint.md)*

---

## Hotfixes

### H-1: Fix Provider String Mismatch
**File:** `processFlow.ts::resolveModelForAgent`  
Add `'local ai'` to the recognized-as-local list. Minimal string comparison fix.

### H-2: Declare `providers.ts` Constant File
**New file:** `src/constants/providers.ts`  
Define `PROVIDER_IDS` for all provider key strings used in UI, storage, and runtime.

### H-3: Remove `hasImage` Full-History Check
**File:** `sidepanel.tsx`  
Check only current turn's attachments, not all prior messages.

### H-4: Surface `resolveModelForAgent` Errors to User
**File:** `sidepanel.tsx::processWithAgent`  
When fallback is used, add a warning to box output instead of silently proceeding.

---

## Medium Refactors

### M-1: Move OCR Before Routing
**Files:** `sidepanel.tsx::handleSendMessage`, `processFlow.ts`, `InputCoordinator.ts`  
Move `processMessagesWithOCR` before `routeInput`. Thread `ocrText` into routing chain.  
**Risk:** High impact. Discrete PR. Consider feature flag.

### M-2: Unify Routing to One Execution Path
**Files:** `sidepanel.tsx`, `InputCoordinator.ts`, `processFlow.ts`  
After M-1, retire `routeInput` as execution authority in favor of `routeClassifiedInput`.

### M-3: Inject `agentContextFiles` into `wrapInputForAgent`
**Files:** `processFlow.ts::wrapInputForAgent`  
Append context file content to system prompt as "Reference Documents" section.

### M-4: Grid Box Visibility Fix
**Files:** `processFlow.ts::loadAgentBoxesFromSession`, `background.ts`  
Update to read from active adapter rather than `chrome.storage.local` directly.

### M-5: Grid Live Output Handler
**Files:** `grid-script.js`, `grid-script-v2.js`  
Add `chrome.runtime.onMessage` listeners for `UPDATE_AGENT_BOX_OUTPUT`. Purely additive.

### M-6: Wire `reasoningSections[]` in WR Chat Path
**Files:** `processFlow.ts::wrapInputForAgent`, `InputCoordinator.ts::resolveReasoningConfig`  
Call `resolveReasoningConfig` for trigger-based section selection instead of flat `agent.reasoning`.

---

## Foundational Refactors

### F-1: Define and Thread `EnrichedInput`
Define type in `src/types/EnrichedInput.ts`. Thread incrementally through `handleSendMessage` → routing → listener → reasoning → output.

### F-2: Provider/Model Registry + Cloud Execution Skeleton
Rewrite `resolveModelForAgent` against `providers.ts`. Extend Electron `/api/llm/chat` for provider routing. One reference cloud implementation (e.g., OpenAI).

### F-3: Session Persistence Authority
Introduce `SessionAuthority` singleton. All session reads/writes through one path. Grid pages use proxy not direct HTTP.

### F-4: API Key Normalization
Define one key store (SQLite via proxy adapter). Remove `localStorage['optimando-api-keys']` as primary store. Migration logic for existing users.

---

## Recommended Implementation Order

```
Phase 1 — Immediate stability (no pipeline changes)
  H-1  Fix 'Local AI' provider string
  H-2  Declare providers.ts constants
  H-3  Fix hasImage to current-turn only
  H-4  Surface model resolution warnings

Phase 2 — OCR and routing correctness
  M-1  Move OCR before routeInput
  M-2  Unify routing to post-OCR path
  M-5  Add grid live output handlers

Phase 3 — Box visibility and output routing
  M-4  Fix grid box visibility
  (M-5 already complete)

Phase 4 — Reasoning harness richness
  M-6  Wire reasoningSections[] to WR Chat path
  M-3  Inject agentContextFiles

Phase 5 — Foundational normalization
  F-1  Define and thread EnrichedInput
  F-3  Session persistence authority
  F-4  API key normalization

Phase 6 — Cloud execution
  F-2  Provider/model registry + cloud call skeleton
```

---

## Fragile Areas Where Patching Is Risky

### FA-1: `resolveModelForAgent`
Silent fallbacks for all misconfigured cases. **Do not patch incrementally — rewrite against `providers.ts` in one shot (H-1 + F-2).**

### FA-2: `loadAgentBoxesFromSession`
Direct `chrome.storage.local` read. Changing to adapter changes behavior for all box reads. **Test with and without Electron running.**

### FA-3: `handleSendMessage` (sidepanel.tsx ~line 2813)
Most heavily loaded function. Manages message assembly, OCR, routing, agent loop, NLP, event-tag routing, output. **Any change to execution order risks breaking orthogonal features. Implement M-1 behind a feature flag if possible.**

### FA-4: `wrapInputForAgent`
Assembles LLM system prompt for all agents globally. M-3 and M-6 both touch this function. **Implement sequentially, not in parallel.**

### FA-5: Grid Scripts (`grid-script.js`, `grid-script-v2.js`)
Plain JS in extension page contexts. No TypeScript module system. Provider constants from `providers.ts` cannot be imported — must be duplicated or inlined via a shared JSON constant file.

---

## Best Extension Points

| Feature to Add | Best Extension Point |
|---|---|
| New cloud provider | `providers.ts` + Electron dispatch + `resolveModelForAgent` switch |
| New listening source type | `evaluateAgentListener` — add source check after `applyFor` |
| WR Experts / context files | `wrapInputForAgent` — "Reference Documents" block |
| Agent output streaming | `updateAgentBoxOutput` — add `status: 'streaming'` + partial content |
| New execution destination | Define `OutputTarget` type, add case in `updateAgentBoxOutput` |
| Session import/export | `storageWrapper.ts` — `exportSession()` / `importSession()` above adapter |
| Multi-agent fan-out | `matchInputToAgents` return → loop already exists in `processWithAgent` |

---

# Part V: Screenshot Validation Plan for Opus Round
*(Source: 19-screenshot-validation-plan-for-opus-round.md)*

---

## Label Convention

```
[SCENARIO_ID]-[PHASE]-[SURFACE]-[STATE].png
```

Phase values: `before` | `after`  
Surface values: `sidepanel` | `grid` | `devtools-network` | `devtools-storage` | `devtools-console`

---

## Scenario Summary

### Group A: OCR and Image Input

**S01 — OCR-Only Trigger, Image Input**
- Steps: Agent with trigger `invoice_total`. Upload image with that text. No typed text. Send.
- Capture: sidepanel showing no agent activation (before) + console showing routeInput called before OCR + OCR result extraction
- **Capture: Before AND after M-1**

**S02 — Mixed Trigger (typed + image)**
- Steps: Agent with trigger `analyze_receipt`. Type trigger + attach image. Send.
- Capture: agent activated from typed text, routing log confirming typed trigger hit.
- **Capture: Before only (regression baseline)**

**S03 — Image-Only, No Matching Agent**
- Steps: Upload image, no agents configured. Observe fallback.
- **Capture: Before only**

---

### Group B: Typed Trigger and Agent Wake-Up

**S04 — Typed Trigger, Sidepanel Box Populated**
- Capture: box output + Network tab POST to `/api/llm/chat` + console model resolved log
- **Capture: Before (baseline) AND after Phase 1 (provider string fix)**

**S05 — Multiple Agents Matching Same Trigger**
- Capture: both boxes populated (or one missing) + routing log showing both matches
- **Capture: Before AND after Phase 2**

---

### Group C: Agent Box Configuration

**S06 — Multiple Boxes Linked to One Agent**
- Capture: both boxes present, which box received output
- **Capture: Before AND after Phase 3**

**S07 — Grid Box vs Sidepanel Box for Same Agent**
- Capture: sidepanel box receives output; grid box empty; Application storage showing box key presence in each store
- **Capture: Before (prove AR-4/AR-5) AND after Phase 3**

---

### Group D: Local Model State

**S08 — No Local Models Installed**
- Capture: model dropdown empty or "No models found"; console showing llm.status error
- **Capture: Before AND after stabilization verification**

**S09 — New Local Model Installed After Box Configured**
- Capture: new model appears in selector on reopen; prior selection preserved
- **Capture: After stabilization pass verification**

---

### Group E: API Key and Cloud Provider

**S10 — API Key Set, Cloud Model Still Routes to Ollama**
- Capture: Network tab showing no `api.openai.com` call; console showing fallback; Application storage showing key present
- **Capture: Before (prove AR-3/AR-6). After Phase 6 — successful cloud call**

**S11 — API Key in Extension vs Electron Storage**
- Capture: extension localStorage showing key; Electron settings NOT showing same key
- **Capture: Before (prove AR-6). After F-4 — both stores showing same value**

---

### Group F: Sidepanel vs Grid Output Equivalence

**S12 — Sidepanel Agent Box Live Update**
- Capture: box updating without page reload; `UPDATE_AGENT_BOX_OUTPUT` message in console
- **Capture: Before (confirm baseline)**

**S13 — Display Grid Box No Live Update**
- Capture: grid box still empty after WR Chat processing; console showing no handler in grid context
- **Capture: Before (confirm AR-5). After Phase 2/3 — live update working**

---

### Group G: Session and Import/Export

**S14 — Session Reload After Navigate**
- Capture: agents/boxes present after navigation; session key in storage
- **Capture: Before (baseline) and after F-3**

**S15 — Import / Export Session Round-Trip**
- Capture: restored state matches original; any warnings about unknown fields
- **Capture: Before and after schema versioning**

---

## DevTools / Network / Storage Evidence Checklist

For storage scenarios:
- Application > Storage > Local Storage (extension localStorage)
- Application > IndexedDB (chrome.storage equivalent)
- Electron SQLite: `SELECT * FROM settings WHERE key LIKE 'session_%'`

For LLM call scenarios:
- Network tab filtered by `/api/llm/` — request payload (model, messages) and response

For routing scenarios:
- Console filtered by: `routeInput`, `matchInputToAgents`, `evaluateAgentListener`, `resolveModelForAgent`

---

## Which Runtime States Matter Most for Opus

The five highest-diagnostic-value states:
1. **OCR result available, routing already complete** — proves AR-1 timing bug
2. **`resolveModelForAgent` returning fallback** — proves AR-2 provider mismatch
3. **Grid box absent from `loadAgentBoxesFromSession` result** — proves AR-4 split persistence
4. **`reasoningSections[]` populated on agent, flat `agent.reasoning` used in prompt** — proves AR-8
5. **API key in localStorage, undefined in SQLite** — proves AR-6 split-brain key store

---

# Final Section: If I Were Handing This to Opus Thinking Next, What Would I Want It to Focus on First?

---

## The Most Important Runtime Truth to Establish

**Does a single end-to-end path from WR Chat input to local Ollama call to sidepanel Agent Box output actually work correctly — with the right model, right agent, right box, no silent fallback?**

This is the baseline. Before any enrichment (OCR, multi-section reasoning, context files, cloud providers), the simplest path must be proven clean. Right now, it has a provider string bug (AR-2) that silently uses the fallback model instead of the configured one. Fix that first and prove the clean baseline with a Network tab capture of the actual Ollama call, confirming the model name matches what the box was configured with.

---

## The Most Important Normalization Decision

**Whether to thread `EnrichedInput` before or after unifying the routing paths.**

The two most impactful structural changes (OCR timing reorder and routing consolidation) converge on the same question: what object carries input state through the pipeline? If a developer fixes OCR timing without defining `EnrichedInput`, they'll add an `ocrText` parameter to every function in the chain — and the next feature (voice, DOM trigger) will add another. The normalization decision on `EnrichedInput` must be made before Phase 2, even if only a minimal version is defined initially.

---

## The Most Dangerous Source-of-Truth Conflict

**`loadAgentBoxesFromSession` reads `chrome.storage.local` only, while grid box saves go to SQLite.**

This is structurally dangerous because it produces a silent asymmetry: the routing engine has a coherent view of sidepanel boxes and a completely blind spot for grid boxes. A developer who looks at the UI and sees boxes in both places, looks at the schema and sees one `CanonicalAgentBoxConfig` type, will reasonably assume routing sees all boxes. They will wire up grid box output routing, test it, and see nothing happen — without any error to debug. This conflict must be resolved (N-5) before any grid box wiring work is attempted.

---

## The Most Likely False Assumption a Model Could Make Looking Only at the UI

**That the reasoning harness, context files, and memory settings are live configuration that influences LLM behavior.**

The UI presents Listener, Reasoning, and Execution as three active sections of a configured agent. Context file uploads have a UI affordance. Memory toggles have a UI affordance. A model that reads the UI forms, the agent schema, and the form save logic will conclude these features are wired. They are persisted to storage — which makes them look implemented.

The `wrapInputForAgent` function is the reveal: it reads only `agent.reasoning` (flat string), `agent.role`, `agent.goals`, and `agent.rules`. Nothing else from the agent config reaches the LLM. Context files, memory toggles, and multi-section reasoning sections are dead config stored in a live schema. An implementation model that doesn't read `wrapInputForAgent` line-by-line before attempting to wire reasoning harness features will build on a false foundation.

---

*End of 15–19 final synthesis.*  
*This document, together with the annotated screenshots defined in Part V, constitutes the full handoff package for the Opus Thinking implementation round.*
