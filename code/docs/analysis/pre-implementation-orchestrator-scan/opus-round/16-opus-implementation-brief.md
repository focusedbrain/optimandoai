# 16 — Opus Implementation Brief

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–3 + handoff package (docs 01–15)  
**Purpose:** The concise brief a strong coding model uses as the starting point for real work. Not a summary. An orientation contract.

---

## What This System Is

A Chromium extension orchestrator that sits on the WR (WorkRobot/WebRender) host page and processes WR Chat messages through configurable AI agents. Each agent has:
- A **Listener** (keyword triggers, expected context, source filters, website scope)
- A **Reasoning** section (system prompt built from role, goals, rules, and context)
- An **Execution** section (output destination, mode)

Each agent is paired with one or more **Agent Boxes**, which define the LLM brain (provider, model, API key) and the output surface (sidepanel slot or display-grid cell).

The extension communicates with a local **Electron** backend on `127.0.0.1:51248` for LLM calls (`/api/llm/chat`), session persistence, OCR, and API key storage. All calls to Electron use an `X-Launch-Secret` header.

Session state lives in `chrome.storage.local` or Electron SQLite depending on whether Electron is running. The storage adapter (`storageWrapper.ts`) handles routing.

---

## State of the System

The form layer is substantially complete. The runtime layer is partially wired. The following are confirmed broken:

1. **Local provider string mismatch** — UI saves `'Local AI'`, runtime expects `'ollama'`/`'local'`. Silent wrong-model execution.
2. **Cloud providers not executable** — all cloud paths return "not connected." Only Ollama runs.
3. **API keys in wrong store** — extension saves to `localStorage`; Electron reads from SQLite. Split-brain.
4. **Grid boxes invisible to routing** — `loadAgentBoxesFromSession` reads `chrome.storage.local`; grid saves go to SQLite. Routing never finds grid boxes.
5. **Grid pages have no live output handler** — even if routing found a grid box, no message handler updates the DOM.
6. **OCR runs after routing** — the authoritative routing call runs before image OCR; OCR-enriched routing exists but its result is discarded.
7. **No provider identity constants** — string comparisons scattered across codebase; every new provider creates a new mismatch.

---

## The First Runtime Truth to Establish

**A local model agent must execute the configured model, not a fallback.**

Before any other runtime property can be trusted, this must be true: when an Agent Box is configured with `Local AI / llama3.2:3b`, the Electron LLM call goes to `llama3.2:3b`. Not the default. Not a fallback. Confirmed via the network request body.

To establish this:
1. Create `src/constants/providers.ts` in the extension. Export `PROVIDER_IDS` (`ollama`, `openai`, `anthropic`, `gemini`, `grok`), `PROVIDER_LABELS` (UI display strings), and `toProviderId(label: string): ProviderId`.
2. Update the Agent Box save path (content-script, grid scripts) to call `toProviderId(selectedProviderLabel)` before writing the session box object. Save the `ProviderId` string, not the label.
3. Rewrite `resolveModelForAgent` to switch on `ProviderId` from the constants file. For `ollama`: construct the Ollama request. For all others: return `BrainResolutionError` with reason `'not_implemented'`.

Until this is true, every test produces wrong results without visible errors.

---

## The First Source-of-Truth Conflict to Eliminate

**Agent Box storage: `chrome.storage.local` vs. SQLite.**

Two write paths, one read path. Grid boxes go to SQLite via `SAVE_AGENT_BOX_TO_SQLITE`. Routing reads boxes from `chrome.storage.local`. Grid boxes are invisible to routing.

This conflict must be eliminated before any grid test is valid. Both sides are structurally intact — this is a wiring fix, not a feature build.

The fix: make `loadAgentBoxesFromSession` read from the `storageWrapper` active adapter — the same adapter that `loadAgentsFromSession` already uses. A single call: `storageWrapper.getItem('sessionBoxes')`. If the adapter is SQLite (Electron running), this returns boxes saved from all surfaces. If the adapter is `chrome.storage.local` (extension only), this returns boxes saved from the sidepanel.

Do not add a second read or a merge — pick one canonical adapter path and make all writers target it.

---

## The First Provider/Model Issue to Solve

**`resolveModelForAgent` must stop accepting ad-hoc string comparisons and start consuming `ProviderId`.**

Current function logic (simplified):
```
if (provider.toLowerCase().includes('ollama')) → local
if (provider === '') → local
if (provider === 'openai') → 'not connected'
else → fallback
```

This is how `'Local AI'` is never matched — it's not in the inclusion list and it's not empty. The function falls to the else case, which silently uses the hardcoded fallback.

Rewrite this function with a switch on `ProviderId` after:
1. `toProviderId(box.provider)` normalizes the stored label (handles legacy saves that stored labels instead of IDs)
2. The switch has one case per provider in `PROVIDER_IDS`
3. Local is fully implemented; cloud providers throw `BrainResolutionError('not_implemented')`

The `BrainResolutionError` result must write a visible message to the Agent Box output: `"Provider X is not yet connected. Configure a local model or wait for the cloud provider implementation."` This message appearing in the box is itself a test case.

---

## The First Grid/Sidepanel Equivalence Issue to Solve

**Output must reach the grid DOM when routing delivers to a grid box.**

This requires three changes to be simultaneous:
1. `loadAgentBoxesFromSession` reads from the storage adapter (not `chrome.storage.local` directly) — so routing finds the box
2. `updateAgentBoxOutput` can resolve a grid box's `boxId` to a message target — so the message is sent
3. Grid scripts have a `chrome.runtime.onMessage` handler for `UPDATE_AGENT_BOX_OUTPUT` that updates the DOM slot for `message.boxId`

The handler in the grid script must:
- Listen for `{ type: 'UPDATE_AGENT_BOX_OUTPUT', boxId: string, output: string, status: 'done' | 'streaming' | 'error' }`
- Find the DOM slot registered for `boxId` (stored in a local map during box render)
- Set the slot's inner content to the output

Do not implement streaming in this first pass. Deliver final output only. Streaming is a progressive enhancement for after E2E baseline is confirmed.

---

## The First Routing Issue to Solve

**OCR must run before the authoritative routing call, not after.**

In `handleSendMessage`, move `processMessagesWithOCR` before `routeInput`. The function must be awaited. The result (an array of extracted strings) must be concatenated into `combinedText = rawText + ' ' + ocrTexts.join(' ')`.

Then: replace the call to `routeInput(rawText)` with `routeInput(combinedText)` — or replace `routeInput` with `routeClassifiedInput` which already takes an `EnrichedInput` structure.

The current call to `routeClassifiedInput` (post-OCR, post-NLP, currently logging only) should become the authoritative routing call. Its existing console.log wiring should be replaced with actual agent activation.

**Do not refactor `handleSendMessage` beyond this change.** The function has too many orthogonal concerns. Scope this change exactly: OCR moves before routing call, routing call receives OCR-enriched input. Nothing else about the function changes.

**Prerequisite:** Define `TurnInput` and `EnrichedInput` types before editing `handleSendMessage`. This makes the refactor type-safe and prevents accidentally threading the OCR result through the wrong variable (`ocrText` vs `combinedText` vs session-level `ocrText` are already ambiguous).

---

## What Should Explicitly Wait Until After First E2E Success

The following are real gaps. None of them should be touched until the first E2E baseline is confirmed and documented (agents activate, local model executes, output lands in sidepanel and grid box, test matrix T-A1 through T-D3 pass):

| Item | Why it waits |
|---|---|
| Cloud provider execution (second provider and beyond) | Build one provider first, confirm it works, then add others from the same pattern |
| `reasoningSections[]` wiring | Flat reasoning works for first tests; multi-section is an enhancement |
| `agentContextFiles` injection | Context file upload has no file-handling backend; building this requires new Electron work |
| Memory settings (`memorySettings.*`) | All toggles are schema-only; wiring them requires session-scoped memory storage and retrieval |
| `acceptFrom` agent chaining | No handoff mechanism exists; this is a new feature, not a fix |
| `executionMode` branching | `direct_response` vs `agent_workflow` distinction; single output path works for first tests |
| `listening.sources[]` filter | Voice, screenshot, DOM routing; for first tests, all sources activate all matching agents |
| `acceptFrom` validation | Not evaluated at runtime; multi-agent scenarios are post-E2E |
| WR Experts context injection | Email-specific; the first tests don't involve WR Experts content |
| Session schema versioning | No schema changes planned in this pass |
| Account-scoped agent storage | Session-scoped agents are sufficient for first tests |
| Streaming output to grid boxes | Final output only for first tests; streaming adds complexity without changing the E2E result |
| Non-box output destinations (email, webhook, storage, notification) | Post-E2E; box output is the only required destination for first tests |

**Guidance for "hiding" unimplemented controls:** Any control that is persisted-only (the value is saved but never read at runtime) and creates a misleading UX expectation should be hidden or disabled with a `(coming soon)` label in the UI before the first E2E release. This is not cosmetic — it prevents support burden and test confusion. See doc `11-runtime-backed-vs-persisted-only-controls.md` for the full classification.

---

## Quick Reference: The Critical Files

| Concern | Primary File | What to Change |
|---|---|---|
| Provider identity | `src/constants/providers.ts` (new) | Create with `PROVIDER_IDS`, `toProviderId()` |
| Model resolution | `src/services/processFlow.ts::resolveModelForAgent` | Switch on ProviderId; visible errors |
| Box persistence | `src/services/processFlow.ts::loadAgentBoxesFromSession` | Use storageWrapper adapter |
| OCR sequencing | `src/sidepanel.tsx::handleSendMessage` | Move OCR before routing; highest risk |
| Routing authority | `src/sidepanel.tsx::handleSendMessage` | Route from enriched input result |
| Grid output handler | `public/grid-script.js`, `public/grid-script-v2.js` | Add `UPDATE_AGENT_BOX_OUTPUT` handler |
| API key store | `src/content-script.tsx::saveApiKeys` | Write to storageWrapper adapter |
| Box save ProviderId | `src/content-script.tsx` + `grid-script*.js` box save path | Call `toProviderId()` before writing |

---

## The Mandate

Build in this order. Do not skip steps. Do not touch `handleSendMessage` until Steps 1–5 are verified by tests. Test at each checkpoint. Document what passed and what failed — especially if a test is indeterminate (model output is non-deterministic; check the network request, not just the UI text).

The orchestrator is architecturally sound at the schema and intent level. The gaps are concrete and bounded. The implementation is primarily wiring and string normalization, with one significant sequencing fix (`handleSendMessage` OCR order) that carries real risk and must be saved for last among the critical items.

The first E2E success is achievable in a focused implementation session. Build the foundation first.
