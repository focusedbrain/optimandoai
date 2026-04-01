# 13 — Final Blocker Summary

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–3 (docs 01–12)  
**Purpose:** The definitive list of true blockers. Everything on this list prevents the first end-to-end orchestrator test from being valid or complete.

---

## Definition of a True Blocker

A true blocker is a condition where the system either:
- produces wrong output silently (no error, wrong behavior — test results are invalid), or
- produces no output where output is expected (feature structurally absent), or
- makes a structural assumption that is false (a path that appears wired but isn't)

Items that produce degraded output but still surface a visible result are not blockers — they are gaps for later passes.

---

## Blocker 1: `'Local AI'` Provider Not Recognized at Runtime
**Type:** Silent wrong output  
**Severity:** Critical — invalidates every local model test

**What happens:** UI saves box provider as `'Local AI'`. `resolveModelForAgent` in `processFlow.ts` recognizes `'ollama'`, `'local'`, `''` — not `'local ai'` (lowercased). Every Agent Box configured with `Local AI` provider silently executes the hardcoded fallback model instead of the configured model. The box populates with output. The output is from the wrong model. There is no error.

**Why it's a blocker and not a gap:** No test result involving a local model can be attributed to the configured model until this is fixed. The system appears to work; it is working — just with the wrong model. All test conclusions are invalid.

**Code location:** `processFlow.ts::resolveModelForAgent` lines 1210–1245  
**Fix type:** Hotfix + provider constants file

---

## Blocker 2: No Cloud Provider Execution Path
**Type:** Feature structurally absent  
**Severity:** Critical — cloud tests cannot run

**What happens:** `resolveModelForAgent` hits "API not yet connected" for all cloud providers. `processWithAgent` posts to Electron `/api/llm/chat` which is Ollama-only. When a cloud brain is configured, the system silently falls back to local Ollama (if local is available) or produces an error. No cloud API is called regardless of which provider or model is configured.

**Why it's a blocker:** Cloud provider execution is a stated requirement for the first E2E tests. It is not a missing feature that can be observed and accepted — it makes T4 (cloud model test) impossible to run.

**Code location:** `processFlow.ts::resolveModelForAgent`; Electron `main.ts` `/api/llm/chat`  
**Fix type:** Structural refactor (Electron dispatch + provider registry)

---

## Blocker 3: API Key Split-Brain (Extension vs Electron)
**Type:** Structural false assumption  
**Severity:** Critical — blocks cloud execution even when B2 is fixed

**What happens:** Extension settings UI saves API keys to `localStorage['optimando-api-keys']`. Electron backend reads keys from its SQLite orchestrator store. These two stores have no confirmed sync path. A user who sets an OpenAI key in the extension UI will have it in `localStorage` but not in the SQLite store that Electron checks.

**Why it's a blocker:** Blocker 2 (cloud execution) cannot work correctly even after the dispatch path is built, because the API key will not reach the Electron backend from the canonical location.

**Code location:** `content-script.tsx::saveApiKeys` → `localStorage`; Electron `main.ts::handshake:getAvailableModels` → SQLite  
**Fix type:** Medium refactor (unify key store)

---

## Blocker 4: Display-Grid Boxes Invisible to Routing Engine
**Type:** Structural false assumption (routing blind spot)  
**Severity:** Critical — all grid box tests produce no output

**What happens:** `loadAgentBoxesFromSession` in `processFlow.ts` reads `chrome.storage.local` only. Grid boxes are saved via `SAVE_AGENT_BOX_TO_SQLITE` — directly to SQLite, bypassing `chrome.storage`. The routing engine literally cannot see grid boxes. `findAgentBoxesForAgent` returns no matches for grid-configured agents. Output delivery has no destination. Silent drop.

**Why it's a blocker:** Grid box equivalence is a product requirement for the first tests. Currently, no amount of correct configuration of a grid Agent Box will produce output. The routing engine is blind to its existence.

**Code location:** `processFlow.ts::loadAgentBoxesFromSession`; `background.ts` `SAVE_AGENT_BOX_TO_SQLITE` handler  
**Fix type:** Medium refactor (box persistence unification)

---

## Blocker 5: Grid Pages Have No Live Output Handler
**Type:** Feature structurally absent for grid surfaces  
**Severity:** Critical — grid output delivery incomplete even after Blocker 4 is fixed

**What happens:** When output is delivered, `updateAgentBoxOutput` sends `UPDATE_AGENT_BOX_OUTPUT` via `chrome.runtime.sendMessage`. The sidepanel has a handler (`setAgentBoxes` React state update). Grid pages (`grid-script.js`, `grid-script-v2.js`, `grid-display.js`) have no equivalent handler. Even if Blocker 4 is resolved (routing finds the grid box, writes output to storage), the grid DOM is never updated. The user must reload the grid page to see the output — if they ever do.

**Why it's a blocker:** Grid equivalence requires live output. A grid page that must be reloaded to show output is not equivalent to a sidepanel box.

**Code location:** `grid-script.js`, `grid-script-v2.js`, `grid-display.js` (no `UPDATE_AGENT_BOX_OUTPUT` handler)  
**Fix type:** Medium refactor (additive listener)

---

## Blocker 6: OCR Runs After Routing Decision
**Type:** Sequencing error — wrong output for image triggers  
**Severity:** Critical — all image-triggered agent activations fail silently

**What happens:** `routeInput` (the authoritative routing call) runs at `sidepanel.tsx:2925`. `processMessagesWithOCR` runs at line 2943, 18 lines later. Any trigger that only appears in OCR-extracted text (from an uploaded image) is never found by the routing engine. The agent does not activate. The LLM message does receive the OCR text — but the routing decision is already final.

The correct OCR-aware routing code already exists: `routeClassifiedInput` at line 2983 sees OCR-enriched input and produces correct agent allocations. But its result is wired to a console.log, not the execution loop.

**Why it's a blocker:** OCR-aware routing is explicitly part of the product goal for the first tests. An image-only trigger is a core scenario. Without this fix, every image-based agent activation silently fails.

**Code location:** `sidepanel.tsx::handleSendMessage` lines 2925, 2943; line 2992 (discarded result)  
**Fix type:** Foundational refactor (OCR resequencing + routing authority change)

---

## Blocker 7: No Shared Provider/Model Identity Constants
**Type:** Architectural drift source  
**Severity:** High — not immediately breaking but causes Blocker 1 to recur for every new provider

**What happens:** There is no canonical source of provider identity strings. The UI uses `'Local AI'`, `'OpenAI'`, etc. The runtime uses `'ollama'`, `'openai'`, etc. This mismatch caused Blocker 1. Without a shared constants file, implementing cloud providers (Blocker 2 fix) will immediately create the same mismatch for cloud strings.

**Why it's a blocker:** Building Blocker 2's fix without this creates the next mismatch immediately. Blocker 1 must be fixed with this, not without it.

**Code location:** `processFlow.ts::resolveModelForAgent` (string comparisons); all UI box dialogs (label storage)  
**Fix type:** Hotfix (new constants file)

---

## Blocker Summary Table

| # | Blocker | Type | Severity | Fix Type |
|---|---|---|---|---|
| 1 | `'Local AI'` not recognized at runtime | Silent wrong output | Critical | Hotfix + constants |
| 2 | No cloud execution path | Feature absent | Critical | Structural refactor |
| 3 | API key split-brain | False structural assumption | Critical | Medium refactor |
| 4 | Grid boxes invisible to routing | Routing blind spot | Critical | Medium refactor |
| 5 | No grid live output handler | Feature absent | Critical | Medium refactor (additive) |
| 6 | OCR runs after routing | Sequencing error | Critical | Foundational refactor |
| 7 | No provider identity constants | Drift source | High | Hotfix |

---

## What Is NOT a Blocker (for First E2E)

These are real gaps but do not prevent a valid first E2E test:

- `reasoningSections[]` not wired — flat reasoning works for first tests
- `agentContextFiles` not injected — first tests don't use context files
- `memorySettings` not consumed — first tests don't test memory
- `executionMode` not branched — single box output is the only behavior needed
- `listening.sources[]` not evaluated — first tests use keyword triggers only
- `acceptFrom` not evaluated — single-agent scenarios for first tests
- Session schema versioning absent — no schema changes planned in this pass
- Account-scoped agent storage path unconfirmed — first tests use session-scoped agents
- `hasImage` full-history scan — causes false positives but doesn't prevent correct agent activation

These items must be addressed but can wait until after the first E2E baseline is established.
