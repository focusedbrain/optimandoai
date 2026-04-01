# Opus Round 3 — Implementation Map

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–2 (docs 01–08)  
**Purpose:** Unified synthesis of docs 09–12. Implementation phases, hotfix/refactor classification, control wiring status, and full E2E test matrix.

---

# Part I: First Implementation Phases
*(Source: 09-first-implementation-phases.md)*

---

## Phase 0: Stabilize the Foundation
**Goal:** The simplest local agent → sidepanel box path produces verifiable, correct, trustworthy output. No silent fallbacks.

**What becomes newly functional:**
- Agent Box configured with `Local AI` + specific Ollama model executes that exact model
- Network tab shows the configured model name in the LLM request payload
- Brain resolution failures surface a visible warning (not silent wrong-model output)

**Scope:**
- Create `src/constants/providers.ts` (PROVIDER_IDS, ProviderId, PROVIDER_LABELS, toProviderId)
- Fix `resolveModelForAgent` — switch on ProviderId constants; add `'local ai'` recognition; return typed error
- Content-script Agent Box dialogs — save `ProviderId` at save time, not UI label
- Grid scripts — inline provider constants (plain JS)
- `processWithAgent` — write visible warning to box when brain resolution fails

**Dependencies:** None. Run first.

**Tests:** T0.1 (Network shows configured model) · T0.2 (Ollama stopped → visible error) · T0.3 (cloud without key → visible error, not Ollama fallback)

---

## Phase 1: Grid Box Visibility and Live Output
**Goal:** Display-grid Agent Boxes are found by the routing engine and receive live output equivalent to sidepanel boxes.

**What becomes newly functional:**
- Grid box visible to `loadAgentBoxesFromSession` at routing time
- `updateAgentBoxOutput` finds and updates grid boxes
- Grid tab updates live on `UPDATE_AGENT_BOX_OUTPUT`
- Sidepanel path unaffected (regression)

**Scope:**
- Add `surface: 'sidepanel' | 'grid'` field to `CanonicalAgentBoxConfig`
- Unify box persistence path (Option A: also write to chrome.storage on grid save; or Option B: `loadAgentBoxesFromSession` reads from storageWrapper adapter — architecturally preferred)
- Grid scripts: add `chrome.runtime.onMessage` listener for `UPDATE_AGENT_BOX_OUTPUT`
- Grid display pages: load session via service worker message, not direct Electron HTTP

**Dependencies:** Phase 0 complete.

**Tests:** T1.1 (grid box live output) · T1.3 (both sidepanel and grid) · T1.5 (grid box survives reload)

---

## Phase 2: OCR Before Routing
**Goal:** Image-triggered agents activate based on OCR-extracted text.

**What becomes newly functional:**
- Agent with OCR-only trigger activates from image upload (no typed text needed)
- `routeClassifiedInput` (post-OCR+NLP) drives the execution loop
- `hasImage` scoped to current turn only
- `EnrichedInput` typed object threads through the pipeline

**Scope:**
- Define `TurnInput` and `EnrichedInput` in shared types file
- Fix `hasImage` to current-turn scope
- Await OCR before routing in `handleSendMessage`
- Assemble `EnrichedInput` with concatenated OCR results and NLP classification
- Elevate `routeClassifiedInput` as routing authority
- `evaluateAgentListener` receives `combinedText` (rawText + ocrText)
- Old `routeInput` execution authority retired (kept diagnostic only)

**Dependencies:** Phase 0 + Phase 1 complete and stable. `EnrichedInput` type defined first.

**Tests:** T2.1 (OCR-only trigger) · T2.2 (typed trigger regression) · T2.5 (full Phase 0–1 regression)

**Caution:** Highest-risk phase. `handleSendMessage` is the most loaded function in the codebase. Implement behind a feature flag if possible. Commit phases 0 and 1 separately before starting this.

---

## Phase 3: Cloud Provider Execution
**Goal:** Cloud Agent Box (minimum: OpenAI) executes with cloud model when valid API key is present.

**What becomes newly functional:**
- Cloud provider dispatch in Electron backend
- API key from extension settings reaches Electron
- Cloud call failure surfaces visible error (not silent Ollama fallback)

**Scope:**
- API key store unification (extension writes to SQLite via adapter; remove localStorage primary key store)
- Electron `/api/llm/chat` dispatches by `provider` field
- One reference cloud implementation (OpenAI recommended)
- `resolveBrain` returns `LLMCallConfig` with `apiKey` for cloud calls
- UI: cloud provider selector labels/gates providers without keys

**Dependencies:** Phase 0 complete. MR-3 (key store unification) must complete as part of or before this phase.

**Tests:** T3.1 (cloud call in Network tab) · T3.2 (no key → warning) · T3.4 (local path unaffected)

---

## Phase 4: Reasoning Harness Richness (Post-First-E2E)
**Goal:** Per-trigger reasoning sections wired. Context file injection.

**What becomes newly functional:** `reasoningSections[]` selected by `triggeredBy`. `agentContextFiles[]` injected into system prompt.

**Dependencies:** Phases 0–2 complete. `triggeredBy` available from `AgentMatch`. Context file storage format confirmed.

**Decision Checkpoint:** After Phase 2, run all nine scenarios from Phase 0–2 test suite. Document results. That is the first E2E baseline. Proceed to Phase 3 only after this baseline is clean.

---

# Part II: Hotfixes vs Refactors
*(Source: 10-hotfixes-vs-refactors.md)*

---

## Hotfixes (Self-Contained, No Dependencies)

| ID | Change | File(s) |
|---|---|---|
| HF-1 | Fix `'Local AI'` provider string recognition | `processFlow.ts::resolveModelForAgent` |
| HF-2 | Create `providers.ts` constants file | New: `src/constants/providers.ts` |
| HF-3 | Fix `hasImage` to current-turn scope | `sidepanel.tsx::handleSendMessage` |
| HF-4 | Surface brain resolution failures visibly | `sidepanel.tsx::processWithAgent` |
| HF-5 | Add `surface` field to `CanonicalAgentBoxConfig` | Type file + box save paths |

**Rules:**
- HF-1 without HF-2 is a band-aid. Do both together.
- HF-3 can be done standalone or folded into FR-2.
- HF-4 is additive. Zero structural risk.

---

## Medium Refactors (2–5 Files, Bounded Scope)

| ID | Change | Files |
|---|---|---|
| MR-1 | Grid box persistence unification | `processFlow.ts`, `background.ts`, grid scripts, `grid-display.js` |
| MR-2 | Grid live output handler | `grid-script.js`, `grid-script-v2.js` |
| MR-3 | API key store unification | `content-script.tsx`, `storageWrapper.ts`, `background.ts`, Electron `main.ts` |
| MR-4 | Save-time ProviderId conversion | Box save paths in content-script + grid scripts |
| MR-5 | Cloud provider execution (OpenAI) | Electron `main.ts`, `processFlow.ts`, `sidepanel.tsx` |
| MR-6 | `RuntimeAgentConfig` type definition | New type + `processFlow.ts::wrapInputForAgent`, `InputCoordinator.ts` |

---

## Foundational Refactors (Shared Contracts, Broad Impact)

| ID | Change | Impact |
|---|---|---|
| FR-1 | Define `TurnInput` + `EnrichedInput` | Pipeline data carrier — must precede all Phase 2 work |
| FR-2 | OCR resequencing in `handleSendMessage` | Execution order change in most loaded function |
| FR-3 | Routing authority unification | Changes which routing result drives agent execution |
| FR-4 | Session persistence authority rule | All session reads through storageWrapper |

**What must NOT be done as a hotfix:**
- HF-1 without HF-2 (string patch without constants = next mismatch ready)
- MR-2 before MR-1 (grid handler fires for nothing; routing still can't find boxes)
- MR-5 before MR-3 (cloud dispatch without key store unification = keys not found)
- FR-2 without FR-1 (OCR moved earlier but result has no typed home)

---

## Classification Summary

| ID | Item | Type | Phase |
|---|---|---|---|
| HF-1 | Fix `'Local AI'` string | Hotfix | Phase 0 |
| HF-2 | `providers.ts` constants | Hotfix | Phase 0 |
| HF-3 | Fix `hasImage` scope | Hotfix | Phase 0 / Phase 2 |
| HF-4 | Surface brain failures | Hotfix | Phase 0 |
| HF-5 | Add `surface` to AgentBoxConfig | Hotfix | Phase 1 prep |
| MR-1 | Grid box persistence | Medium | Phase 1 |
| MR-2 | Grid live handler | Medium | Phase 1 |
| MR-3 | API key store unification | Medium | Phase 1–3 |
| MR-4 | Save-time ProviderId conversion | Medium | Phase 0–1 |
| MR-5 | Cloud execution (OpenAI) | Medium | Phase 3 |
| MR-6 | `RuntimeAgentConfig` type | Medium | Phase 4 prep |
| FR-1 | `TurnInput` + `EnrichedInput` | Foundational | Phase 2 prereq |
| FR-2 | OCR resequencing | Foundational | Phase 2 |
| FR-3 | Routing authority unification | Foundational | Phase 2 |
| FR-4 | Session persistence authority | Foundational | Phase 1–2 |

---

# Part III: Runtime-Backed vs Persisted-Only Controls
*(Source: 11-runtime-backed-vs-persisted-only-controls.md)*

---

## Classification Key

| Class | Meaning |
|---|---|
| **E2E Required** | Must influence runtime for first tests to be valid |
| **Post-E2E** | Must be wired eventually; absence doesn't block first tests |
| **Persisted-only (acceptable)** | Saved without runtime effect; doesn't mislead users |
| **Persisted-only (dangerous)** | Saved, not wired, but UI implies it works → must be labeled or hidden |
| **Hidden/disabled** | Must not be visible in UI until wired |

---

## AI Agent Form

### Identity
| Control | Classification |
|---|---|
| Name | E2E Required |
| Enabled toggle | E2E Required |
| Agent number | E2E Required |
| Icon | Persisted-only (acceptable) |
| Scope toggle (session/account) | Persisted-only (acceptable) |
| Platform flags (desktop/mobile) | **Hidden/disabled** |

### Listener Section
| Control | Classification |
|---|---|
| Listener enabled | E2E Required |
| Trigger keywords | E2E Required |
| Website filter | E2E Required |
| Expected context | E2E Required |
| `applyFor` input type | E2E Required |
| `listening.sources[]` | **Persisted-only (dangerous)** → label "Source filtering not yet active" |
| `acceptFrom` | **Persisted-only (dangerous)** → label "Coming soon" or hide |
| Example files | **Hidden/disabled** |
| DOM trigger types | **Hidden/disabled** |

### Reasoning Section
| Control | Classification |
|---|---|
| Reasoning enabled | E2E Required |
| Role | E2E Required |
| Goals | E2E Required |
| Rules | E2E Required |
| Custom fields | E2E Required |
| Flat `agent.reasoning` | E2E Required |
| Multi-section reasoning tabs | **Persisted-only (dangerous)** → collapse to flat; label "Per-trigger sections: coming next phase" |
| Context file upload | **Persisted-only (dangerous)** → label "Files saved but not yet injected" or hide |
| Memory settings toggles | **Persisted-only (dangerous)** → label "Memory not yet active" or hide |
| Context settings toggles | **Persisted-only (dangerous)** → label "Context controls not yet active" or hide |
| WR Experts section | **Hidden/disabled** → remove from agent form or relabel clearly |

### Execution Section
| Control | Classification |
|---|---|
| Execution enabled | Post-E2E (acceptable) |
| Execution mode selector | **Persisted-only (dangerous)** → label "Mode not yet active" |
| Non-box destinations | **Persisted-only (dangerous)** → hide non-box options |
| Execution workflows | **Hidden/disabled** |
| Streaming toggle | **Hidden/disabled** |
| Structured output | **Hidden/disabled** |

## Agent Box Form
| Control | Classification |
|---|---|
| Provider selector | E2E Required |
| Model selector | E2E Required |
| Agent assignment | E2E Required |
| Box number / slot | E2E Required |
| Surface (sidepanel/grid) | E2E Required (set at creation, not user-editable) |
| Grid position | Post-E2E (acceptable) |
| Tools list | **Hidden/disabled** |
| `outputId` | Persisted-only (acceptable) |
| Special destinations | Verify if wired; if confirmed, mark E2E Required |

---

## "Show It or Hide It" Action Table

| Control | Action Before User Testing |
|---|---|
| Platform flags | Hide |
| `listening.sources[]` | Label "Source filtering not yet active" |
| `acceptFrom` | Hide or label "Coming soon" |
| DOM trigger types | Remove from type selector |
| Multi-section reasoning | Collapse to flat; label "Per-trigger sections: next phase" |
| Context file upload | Label "Not yet injected" or hide |
| Memory settings | Label "Not yet active" or hide |
| Context settings | Label "Not yet active" or hide |
| WR Experts | Remove or relabel (not email WR Expert) |
| Execution mode | Label "Mode not yet active" |
| Non-box destinations | Hide |
| Execution workflows | Hide |
| Streaming | Hide |
| Structured output | Hide |
| Tool-use | Hide |

**Key principle:** Every visible control must either work, or say it doesn't work yet. In an AI system, users cannot distinguish model non-determinism from silently ignored configuration. Every persisted-only control is a source of false attribution in test results.

---

# Part IV: First E2E Test Matrix
*(Source: 12-first-e2e-test-matrix.md)*

---

## Group A: Local Model Path

### A1 — Typed Trigger → Local Agent → Sidepanel Box → Correct Model
**Phase 0** · Setup: agent `test_local`, box `Local AI / llama3.2:3b` · Action: type "test_local" · Evidence: Network shows `"model": "llama3.2:3b"` · Proves: provider string fix works; correct model runs

### A2 — No Trigger → Inline Fallback
**Phase 0** · Action: type "hello" (no trigger) · Expected: agent does NOT activate; inline response appears · Proves: listener trigger matching works

### A3 — Trigger Changed → Old Trigger Dead
**Phase 0** · Change trigger from `test_local` to `test_local_v2` · "test_local" no longer fires; "test_local_v2" fires · Proves: listener config is live

### A4 — Multiple Agents, Independent Triggers
**Phase 0** · Alpha (trigger `alpha_trigger`) + Beta (trigger `beta_trigger`) · "alpha_trigger" → only Alpha fires · "alpha_trigger beta_trigger" → both fire · Proves: multi-agent routing and fan-out

---

## Group B: Cloud Model Path

### B1 — Cloud Agent (OpenAI), Valid Key
**Phase 3** · Setup: OpenAI key set; box `OpenAI / gpt-4o` · Evidence: Network shows call to OpenAI API; no Ollama call · Proves: cloud execution path wired

### B2 — Cloud Agent, No Key → Visible Error
**Phase 0** · Setup: no OpenAI key; box `OpenAI / gpt-4o` · Expected: box shows error message (not empty; not Ollama output) · Proves: key-missing condition surfaces

### B3 — Local and Cloud Independent
**Phase 3** · Trigger local agent + cloud agent in same send · Each calls its own API · Proves: provider isolation

---

## Group C: Sidepanel Box Output

### C1 — Output Persists After Sidepanel Reload
**Phase 0** · Send trigger, box populates · Close/reopen sidepanel · Box retains output · Proves: output persisted to storage

### C2 — Box Isolation (Multiple Boxes)
**Phase 0** · Alpha and Beta agents with separate boxes · Triggering Alpha does not affect Beta's box · Proves: `agentBoxId` targeting is correct

---

## Group D: Display-Grid Box Output

### D1 — Grid Box Live Output
**Phase 1** · Grid box assigned to agent · Trigger from WR Chat · Grid tab updates live without reload · Evidence: console shows `UPDATE_AGENT_BOX_OUTPUT` received in grid context

### D2 — No Box → Inline Fallback
**Phase 0** · Agent with no box assigned · Trigger fires · Output appears in inline chat (not silent drop) · Proves: missing-box fallback works

### D3 — Same Agent, Both Sidepanel + Grid
**Phase 1** · Agent has sidepanel box AND grid box · Trigger fires · Both boxes receive output

---

## Group E: OCR-Triggered Routing

### E1 — Image Only, OCR Trigger, Agent Activates
**Phase 2** · Image contains text "ocr_trigger ..." · No typed text · Expected: agent with trigger `ocr_trigger` activates · Evidence: console shows OCR ran before routing; routing matched from `combinedText`

### E2 — Image Only, No Match
**Phase 2** · Image with "hello world" (no trigger keyword) · No agent activates · Inline fallback response

### E3 — Image + Typed Text, Both Triggers
**Phase 2** · Typed trigger for Agent A + image trigger for Agent B · Both agents activate from their respective text sources

---

## Group F: Typed Trigger Routing

### F1 — Role and Goals in System Prompt
**Phase 0** · Agent with role containing "MARKER-ROLE-ACTIVE" · Send trigger · Network request system prompt contains the marker · Proves: `wrapInputForAgent` correctly builds system prompt

### F2 — Website Filter
**Phase 0** · Agent with website filter `example.com` · Send from non-example.com → agent does NOT fire · Send from example.com → agent fires

---

## Group G: Session Save and Reload

### G1 — Session Survives Navigation
**Phase 0** · Create agents and boxes · Navigate away · Return · Agents and boxes present

### G2 — Agent Edit Survives Reload
**Phase 0** · Edit agent trigger and role · Close/reopen sidepanel · New trigger active; old trigger dead; new role in system prompt

### G3 — Box Config Survives Reload
**Phase 0** · Box with `Local AI / llama3.2:3b` · Close/reopen · Dialog shows same provider and model

### G4 — Grid Box Config Survives Reload
**Phase 1** · Grid box configured · Grid tab reloaded · Box config present; routing finds it; trigger fires successfully

---

## Test Run Order for First E2E Baseline

```
Phase 0 complete:
  A1, A2, A3, B2, C1, C2, D2, F1, G1, G2, G3

Phase 1 complete (add):
  D1, D3, G4

Phase 2 complete (add):
  E1, E2, E3
  + full regression of Phase 0–1 suite

Phase 3 complete (add):
  B1, B3
```

## Failing Test Diagnostic Table

| Test | Fail Symptom | Root Cause |
|---|---|---|
| A1 | Box empty | Box not found; `agentBoxId` undefined; routing miss |
| A1 | Wrong model in Network request | Phase 0 provider string fix incomplete |
| B1 | Ollama called instead of OpenAI | MR-5 cloud dispatch incomplete |
| B2 | Box empty (no warning) | HF-4 not applied |
| D1 | Grid box unchanged | MR-1 (routing blind) or MR-2 (no listener) |
| E1 | Agent doesn't activate from image | FR-2 (OCR not before routing) or FR-3 (old authority still used) |
| F1 | Role/goals missing from system prompt | `wrapInputForAgent` bug; check agent config parse |
| G1 | Agents/boxes gone after navigation | Session persistence failure; adapter not writing |
| G4 | Grid box gone after reload | MR-1 or FR-4 incomplete |
