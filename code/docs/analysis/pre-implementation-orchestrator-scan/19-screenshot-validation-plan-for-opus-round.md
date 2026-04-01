# 19 — Screenshot Validation Plan for Opus Round

**Status:** Analysis-only. Handoff preparation for Opus Thinking + screenshot-assisted round.  
**Date:** 2026-04-01  
**Basis:** All prior documents (00–18) in this analysis series.

---

## How to Use This Document

Each scenario below defines:
1. **What to do** — exact UI steps
2. **What to capture** — which screenshots and devtools panels
3. **Label convention** — filename / annotation format
4. **What it proves** — the runtime truth being verified
5. **When to capture** — before or after implementation

Screenshots should be captured in Chrome with the sidepanel open. DevTools should be on the **Application** tab (for storage) or **Network** tab (for HTTP) unless otherwise noted.

---

## Label Convention

All screenshots follow this naming pattern:

```
[SCENARIO_ID]-[PHASE]-[SURFACE]-[STATE].png
```

Examples:
- `S01-before-sidepanel-no-agent-wake.png`
- `S03-after-devtools-network-llm-call.png`
- `S07-before-devtools-storage-box-not-found.png`

Phase values: `before` (pre-implementation) | `after` (post-implementation)  
Surface values: `sidepanel` | `grid` | `devtools-network` | `devtools-storage` | `devtools-console`

---

## Scenario Groups

---

### Group A: OCR and Image Input

#### S01 — OCR-Only Trigger, Image Input, No Typed Text
**Steps:**
1. Create an agent with trigger keyword `invoice_total` and no other trigger rules.
2. Upload an image containing the text "Invoice Total: $350".
3. Do NOT type any text. Send the message.
4. Observe whether the agent wakes up.

**Capture:**
- `S01-before-sidepanel-no-agent-wake.png` — sidepanel showing no agent activation
- `S01-before-devtools-console-route-log.png` — console showing `routeInput` called before OCR log
- `S01-before-devtools-console-ocr-result.png` — console showing OCR extracting "Invoice Total: $350"

**What it proves:**  
Before implementation: OCR runs after routing, agent does not wake up.  
After implementation: agent activates because OCR result reaches routing.

**Capture:** Before AND after.

---

#### S02 — Image Plus Typed Text, Mixed Trigger
**Steps:**
1. Create an agent with trigger `analyze_receipt`.
2. Type "Please analyze_receipt" + attach a receipt image.
3. Send. Observe agent activation.

**Capture:**
- `S02-before-sidepanel-agent-activated.png` — agent activated from typed trigger
- `S02-before-devtools-console-routing.png` — routing decision log, shows typed text trigger hit

**What it proves:** Agent activates from typed text even without OCR-aware routing. Confirms the baseline.  
**Capture:** Before only (regression baseline).

---

#### S03 — Image-Only Input, No Matching Agent
**Steps:**
1. Upload an image. No agents configured.
2. Observe inline chat response or empty state.

**Capture:**
- `S03-before-sidepanel-inline-fallback.png` — shows "no agent matched" inline response

**What it proves:** Routing failure mode is visible, not silent. Confirms no crash.  
**Capture:** Before only.

---

### Group B: Typed Trigger and Agent Wake-Up

#### S04 — Typed Trigger, Agent Wakes, Sidepanel Box Populated
**Steps:**
1. Configure an agent with trigger `summarize`, linked to a sidepanel Agent Box.
2. Type "Please summarize this report" and send.
3. Wait for box to populate.

**Capture:**
- `S04-before-sidepanel-box-populated.png` — Agent Box showing LLM output
- `S04-before-devtools-network-llm-call.png` — Network tab showing POST to `/api/llm/chat`
- `S04-before-devtools-console-model-resolved.png` — log showing which model was resolved

**What it proves:** Basic routing → reasoning → LLM call → output path is functional for local agents.  
**Capture:** Before (prove baseline) AND after Phase 1 (prove provider string fix).

---

#### S05 — Multiple Agents Matching the Same Trigger
**Steps:**
1. Configure two agents both with trigger `analyze`.
2. Type "analyze this" and send.
3. Observe which agents activated.

**Capture:**
- `S05-before-sidepanel-multi-agent-output.png` — both boxes populated (or one populated, one missing)
- `S05-before-devtools-console-routing-multi.png` — routing log showing both agent matches

**What it proves:** Multi-agent routing is structurally functional; identifies any silent drop of second agent.  
**Capture:** Before AND after.

---

### Group C: Agent Box Configuration

#### S06 — Multiple Boxes Linked to One Agent
**Steps:**
1. Create one agent with identifier `email_writer`.
2. Create two Agent Boxes both referencing `email_writer` (agentNumber same, boxNumber different).
3. Send a message that triggers `email_writer`.

**Capture:**
- `S06-before-sidepanel-two-boxes-one-agent.png` — show both boxes present
- `S06-before-sidepanel-box-output-routing.png` — show which box (if any) received output

**What it proves:** Multi-box fan-out behavior. Does the routing engine deliver to both or only the first?  
**Capture:** Before AND after.

---

#### S07 — Grid Box vs Sidepanel Box for Same Agent
**Steps:**
1. Create an agent.
2. Create one Agent Box in the sidepanel AND one in the display grid, both linked to the same agent.
3. Send a message triggering the agent.

**Capture:**
- `S07-before-sidepanel-box-populated.png` — sidepanel box receives output
- `S07-before-grid-box-empty.png` — grid box does NOT receive output
- `S07-before-devtools-storage-box-keys.png` — Application > Local Storage or IndexedDB, show box key presence in each store

**What it proves:** AR-4 and AR-5 — grid box is invisible to routing engine; no live update delivered to grid.  
**Capture:** Before (prove the bug) AND after Phase 3 (prove fix).

---

### Group D: Local Model State

#### S08 — No Local Models Installed
**Steps:**
1. With Ollama stopped or no models installed, open an Agent Box dialog.
2. Switch provider to Local AI.

**Capture:**
- `S08-before-sidepanel-model-selector-empty.png` — model dropdown shows empty or "No models found"
- `S08-before-devtools-console-ollama-error.png` — console showing llm.status error or empty array

**What it proves:** Empty state is handled gracefully; no crash; no stale static list shown.  
**Capture:** Before AND after stabilization pass verification.

---

#### S09 — New Local Model Installed After Box Was Configured
**Steps:**
1. Configure an Agent Box with model `mistral:7b` (assume installed).
2. Install `llama3.2:3b` via Ollama.
3. Reopen the Agent Box dialog.

**Capture:**
- `S09-after-sidepanel-new-model-visible.png` — new model appears in selector on reopen
- `S09-before-sidepanel-old-model-still-selected.png` — previously selected model still shown when reopening

**What it proves:** Model list refreshes dynamically; saved selection is preserved.  
**Capture:** After stabilization pass verification.

---

### Group E: API Key and Cloud Provider Visibility

#### S10 — API Key Set, Cloud Model Not Shown in Execution
**Steps:**
1. Go to extension settings, set an OpenAI API key.
2. Configure an Agent Box with provider `OpenAI` and model `gpt-4o`.
3. Send a message that triggers the agent.

**Capture:**
- `S10-before-devtools-network-no-openai-call.png` — no call to `api.openai.com`; only local Ollama call
- `S10-before-devtools-console-cloud-fallback.png` — console showing "API not yet connected" or model fallback log
- `S10-before-devtools-storage-api-key.png` — Application > Local Storage showing key present

**What it proves:** AR-3 and AR-6 — cloud provider routes to local fallback silently despite key being set.  
**Capture:** Before (prove the bug). After Phase 6, capture successful cloud call.

---

#### S11 — API Key in Extension vs Electron Storage
**Steps:**
1. Set API key in extension settings (localStorage).
2. Open Electron settings / check Electron orchestrator SQLite.
3. Compare key presence in both stores.

**Capture:**
- `S11-before-devtools-storage-extension-key.png` — extension localStorage showing key
- `S11-before-electron-settings-no-key.png` — Electron settings UI (if any) NOT showing the same key

**What it proves:** AR-6 — the key split-brain between localStorage and SQLite.  
**Capture:** Before (prove the bug). After F-4 normalization, capture both stores having the same value.

---

### Group F: Sidepanel vs Grid Output Equivalence

#### S12 — Sidepanel Agent Box Live Update
**Steps:**
1. Configure a sidepanel Agent Box.
2. Send a message. Watch the box update without page reload.

**Capture:**
- `S12-before-sidepanel-box-live-update.gif` or two screenshots (before/after send)
- `S12-before-devtools-console-update-message.png` — `UPDATE_AGENT_BOX_OUTPUT` message log

**What it proves:** Sidepanel output delivery is functional baseline.  
**Capture:** Before (confirm baseline).

---

#### S13 — Display Grid Box No Live Update
**Steps:**
1. Configure a display grid Agent Box.
2. Open the grid in a Chrome tab. Send a WR Chat message that targets this agent.
3. Observe grid tab — box should NOT update.

**Capture:**
- `S13-before-grid-box-static.png` — grid box still empty after WR Chat processing
- `S13-before-devtools-console-grid-no-handler.png` — console showing no `UPDATE_AGENT_BOX_OUTPUT` handler in grid context

**What it proves:** AR-5 is confirmed visually.  
**Capture:** Before (confirm the bug). After M-5, capture live update working.

---

### Group G: Session and Import/Export

#### S14 — Session Reload After Navigate
**Steps:**
1. Configure agents and boxes in sidepanel.
2. Navigate to a new page. Return to sidepanel.
3. Verify agents and boxes are still present.

**Capture:**
- `S14-before-sidepanel-session-restored.png` — agents/boxes present after navigation
- `S14-before-devtools-storage-session-key.png` — session key visible in chrome.storage or IndexedDB

**What it proves:** Session persistence baseline is functional.  
**Capture:** Before (baseline) and after F-3 (confirm persistence authority doesn't regress).

---

#### S15 — Import / Export Session Round-Trip
**Steps:**
1. Configure agents and boxes. Export session JSON (if UI is available).
2. Clear storage. Import the JSON. Verify all agents and boxes restored.

**Capture:**
- `S15-before-sidepanel-after-import.png` — restored state matches original
- `S15-before-devtools-console-import-log.png` — any warnings about unknown fields

**What it proves:** Session schema is stable; unknown fields are handled gracefully.  
**Capture:** Before and after any schema versioning work.

---

## DevTools / Network / Storage Evidence Checklist

For any scenario involving storage, always capture:
- **Application > Storage > Local Storage** — extension-context localStorage
- **Application > IndexedDB** (or the chrome.storage equivalent) — service worker storage
- Electron orchestrator SQLite: query `SELECT * FROM settings WHERE key LIKE 'session_%'` and screenshot result

For any scenario involving LLM calls, capture:
- **Network tab** filtered by `/api/llm/` — show request payload (model, messages) and response

For any routing scenario, capture:
- **Console** filtered by keyword `routeInput`, `matchInputToAgents`, `evaluateAgentListener`, `resolveModelForAgent`

---

## Capture Timing Summary

| Scenario | Before Implementation | After Implementation |
|---|---|---|
| S01 — OCR-only trigger | Required (prove bug) | Required (prove fix) |
| S02 — Mixed trigger baseline | Required | No (regression only) |
| S03 — No matching agent | Required | No (regression only) |
| S04 — Typed trigger, box populated | Required | After Phase 1 |
| S05 — Multiple agents | Required | After Phase 2 |
| S06 — Multiple boxes one agent | Required | After Phase 3 |
| S07 — Grid vs sidepanel | Required (prove bug) | After Phase 3 |
| S08 — No local models | Required | After stabilization |
| S09 — New model installed | No | After stabilization |
| S10 — Cloud key set, fallback used | Required (prove bug) | After Phase 6 |
| S11 — API key split-brain | Required (prove bug) | After F-4 |
| S12 — Sidepanel live update | Required | No (regression only) |
| S13 — Grid no live update | Required (prove bug) | After Phase 2/3 |
| S14 — Session reload | Required | After F-3 |
| S15 — Import/export round-trip | Required | After schema versioning |

---

## Which Runtime States Matter Most for Opus

The Opus round should focus on the following states as they carry the most diagnostic value:

1. **State: OCR result available, routing already complete** — proves the timing bug
2. **State: `resolveModelForAgent` returning fallback** — proves the provider mismatch
3. **State: grid box absent from `loadAgentBoxesFromSession` result** — proves split persistence
4. **State: `reasoningSections[]` populated on agent, flat `agent.reasoning` used in system prompt** — proves reasoning harness gap
5. **State: API key in localStorage, undefined in SQLite** — proves split-brain key store

These five states together define whether the orchestrator can be called "reliably end-to-end" or not. Screenshots and console logs confirming each state are the minimum evidence package for a productive Opus round.
