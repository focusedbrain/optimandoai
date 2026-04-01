# 12 — First E2E Test Matrix

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–2 (docs 01–08)  
**Focus:** Exact, executable test scenarios for verifying the first end-to-end orchestrator pass.

---

## How to Use This Matrix

Each test scenario includes:
- **Setup** — what must be configured before the test
- **Action** — the exact user action to perform
- **Expected result** — the observable outcome that proves the test passes
- **Evidence to capture** — which DevTools panel, console log, or storage view confirms the result
- **Phase required** — which implementation phase must be complete before this test can pass
- **What it proves** — the specific architectural guarantee being verified

Tests are ordered from lowest risk (typed trigger, local model) to highest complexity (cloud, grid, OCR). Run them in this order to build confidence before reaching higher-risk paths.

---

## Group A: Local Model Path

### A1 — Local Agent, Typed Trigger, Sidepanel Box, Correct Model
**Phase required:** Phase 0 (HF-1, HF-2, HF-4)

**Setup:**
1. Ollama running with `llama3.2:3b` installed
2. Session open in sidepanel
3. Agent "TestAgent-A1" created with trigger keyword `test_local`
4. Reasoning: Role = "You are a test agent. When asked anything, respond with: [RESPONSE FROM TEST AGENT]"
5. Agent Box in sidepanel: provider `Local AI`, model `llama3.2:3b`, assigned to TestAgent-A1

**Action:** Type "test_local — please respond" in WR Chat and send.

**Expected result:**
- TestAgent-A1's sidepanel box populates with output containing "[RESPONSE FROM TEST AGENT]" (or a paraphrase — LLM output is non-deterministic but the role should influence the response)
- Box updates without page reload

**Evidence to capture:**
- Network tab: POST to `/api/llm/chat`. Request body shows `"model": "llama3.2:3b"` (not a fallback model)
- Network tab: Response shows LLM output text
- Console: `evaluateAgentListener` log shows TestAgent-A1 matched

**What it proves:** Provider string fix works. Configured model runs, not fallback. Box receives output. Sidepanel live update path is functional.

**Fail modes to watch for:**
- Box is empty → `agentBoxId` undefined; box not found in session; check storage
- Box shows output from wrong model → check Network request `model` field; Phase 0 fix incomplete
- Box shows warning message → check if HF-4 is triggering; check Ollama is running

---

### A2 — Local Agent, No Trigger Match, Fallback to Butler
**Phase required:** Phase 0

**Setup:** Same as A1

**Action:** Type "hello, how are you?" (no trigger keyword) in WR Chat and send.

**Expected result:**
- TestAgent-A1 does NOT activate
- Response appears as inline chat (butler/fallback response)
- Sidepanel box for TestAgent-A1 remains empty or retains previous output

**Evidence to capture:**
- Console: `evaluateAgentListener` log shows TestAgent-A1 as `matchType: 'none'`
- No Network call to `/api/llm/chat` from agent path (or only from butler path)

**What it proves:** Listener trigger matching works. Agents don't fire on every message.

---

### A3 — Local Agent, Trigger Changed, Old Trigger No Longer Fires
**Phase required:** Phase 0

**Setup:** Same as A1. TestAgent-A1 has trigger `test_local`.

**Action (Part 1):** Type "test_local" → confirm agent fires (regression of A1)  
**Action (Part 2):** Edit agent. Change trigger to `test_local_v2`. Save.  
**Action (Part 3):** Type "test_local" → agent should NOT fire  
**Action (Part 4):** Type "test_local_v2" → agent SHOULD fire

**Expected result:** Only the new trigger activates the agent.

**Evidence to capture:**
- Part 3: Console shows TestAgent-A1 `matchType: 'none'` on "test_local"
- Part 4: Console shows TestAgent-A1 matched on "test_local_v2"

**What it proves:** Listener configuration is live. Trigger changes take effect without session reload.

---

### A4 — Multiple Local Agents, Independent Triggers
**Phase required:** Phase 0

**Setup:**
- Agent "Alpha" with trigger `alpha_trigger`, box Alpha (Local AI, llama3.2:3b)
- Agent "Beta" with trigger `beta_trigger`, box Beta (Local AI, llama3.2:3b)

**Action (Part 1):** Type "alpha_trigger" → only Alpha fires  
**Action (Part 2):** Type "beta_trigger" → only Beta fires  
**Action (Part 3):** Type "alpha_trigger beta_trigger" → both fire

**Expected result:**
- Part 1: Alpha box updates; Beta box unchanged
- Part 2: Beta box updates; Alpha box unchanged
- Part 3: Both boxes update

**Evidence to capture:**
- Console: routing log shows correct agent matches for each send
- Network tab: separate `/api/llm/chat` calls for each matched agent in Part 3

**What it proves:** Multi-agent routing works. Trigger scope is agent-specific. Fan-out executes for multiple matches.

---

## Group B: Cloud Model Path

### B1 — Cloud Agent (OpenAI), Valid Key, Correct Provider Called
**Phase required:** Phase 3 (MR-3, MR-5)

**Setup:**
1. OpenAI API key set in extension settings
2. Agent "CloudAgent-B1" with trigger `cloud_test`
3. Agent Box in sidepanel: provider `OpenAI`, model `gpt-4o`, assigned to CloudAgent-B1
4. Role = "You are a cloud test agent. When asked anything, respond with: [CLOUD RESPONSE]"

**Action:** Type "cloud_test" in WR Chat.

**Expected result:**
- CloudAgent-B1's box populates with output (LLM response)
- Network tab shows HTTP call to `api.openai.com` (or Electron proxy endpoint for OpenAI)
- Ollama is NOT called (no `/api/llm/chat` request with Ollama model)

**Evidence to capture:**
- Network tab: request to OpenAI API or Electron-proxied cloud endpoint. Response present.
- Network tab: no Ollama call (no fallback)
- Box output shows model response (not a warning message)

**What it proves:** Cloud execution path is wired. API key reaches Electron. Provider dispatch routes to correct API.

---

### B2 — Cloud Agent, No API Key Set
**Phase required:** Phase 0 (HF-4 provides the error surfacing)

**Setup:**
1. No OpenAI API key in extension settings (or key cleared)
2. Agent "CloudAgent-B2" with trigger `cloud_nokey`
3. Agent Box: provider `OpenAI`, model `gpt-4o`

**Action:** Type "cloud_nokey" in WR Chat.

**Expected result:**
- Box shows a visible warning/error message such as "OpenAI key not configured" or "Provider unavailable"
- Ollama is NOT called silently
- No LLM output appears as if cloud ran

**Evidence to capture:**
- Box output contains an error message (not empty, not LLM output)
- Console: `BrainResolution` error `code: 'no_key'` logged

**What it proves:** Key-missing condition surfaces correctly. No silent Ollama fallback when cloud is configured.

---

### B3 — Local and Cloud Agents, Independent Execution
**Phase required:** Phase 3

**Setup:**
- LocalAgent with `local_trigger`, Local AI box
- CloudAgent with `cloud_trigger`, OpenAI box + valid key

**Action (Part 1):** Type "local_trigger" → only local Ollama call  
**Action (Part 2):** Type "cloud_trigger" → only OpenAI call  
**Action (Part 3):** Type "local_trigger cloud_trigger" → both fire, each calls the right API

**Expected result:** Each agent uses its own provider. No cross-contamination.

**Evidence to capture:**
- Part 3: Network tab shows two API calls — one Ollama, one OpenAI

**What it proves:** Provider isolation works across agents in the same session.

---

## Group C: Sidepanel Box Output

### C1 — Output Persistence in Sidepanel Box
**Phase required:** Phase 0

**Setup:** TestAgent-A1 + sidepanel box from A1.

**Action:**
1. Send "test_local". Box populates.
2. Close and reopen the sidepanel.
3. Observe box.

**Expected result:** Box retains the last output from step 1 after sidepanel close/reopen.

**Evidence to capture:**
- Application > Storage (chrome.storage or IndexedDB): session blob contains `boxes[n].output` with the text from step 1
- After reopen: box shows same output

**What it proves:** Box output is persisted to session storage, not only held in React state.

---

### C2 — Multiple Sidepanel Boxes, Output Isolation
**Phase required:** Phase 0

**Setup:**
- Alpha agent + Alpha box in sidepanel
- Beta agent + Beta box in sidepanel (from A4 setup)

**Action:**
1. Trigger Alpha. Alpha box shows output. Beta box empty.
2. Trigger Beta. Beta box shows output. Alpha box retains prior output (not cleared by Beta).

**Expected result:** Each box maintains its own output. Triggering one agent does not affect other boxes.

**Evidence to capture:**
- Console: `updateAgentBoxOutput` called with correct `agentBoxId` for each agent

**What it proves:** Box targeting by `agentBoxId` is correct. No cross-contamination between boxes.

---

## Group D: Display-Grid Box Output

### D1 — Grid Agent Box, Typed Trigger, Live Output
**Phase required:** Phase 1 (MR-1, MR-2)

**Setup:**
1. Agent "GridAgent-D1" with trigger `grid_test`
2. Agent Box in the display grid (not sidepanel): provider `Local AI`, model `llama3.2:3b`
3. Open the grid display tab in a browser tab (separate from sidepanel)

**Action:** From WR Chat (sidepanel), type "grid_test" and send.

**Expected result:**
- The grid tab's box slot for GridAgent-D1 updates with LLM output live (without page reload)
- The sidepanel does NOT show output in a box (no sidepanel box configured for this agent)

**Evidence to capture:**
- Grid tab DOM: box slot updated with output text without reload
- Console (grid page): `UPDATE_AGENT_BOX_OUTPUT` message received and handled
- Network tab: `/api/llm/chat` called with `llama3.2:3b`

**What it proves:** Grid box persistence unification works (routing engine finds the box). Grid live handler works.

---

### D2 — Grid Box Not Found → Output Falls Through to Inline Chat
**Phase required:** Phase 0 (behavior before Phase 1)

**Setup:**
1. Agent "NoBoxAgent" with trigger `nobox_test`
2. NO Agent Box assigned to this agent anywhere

**Action:** Type "nobox_test" and send.

**Expected result:**
- Agent activates (matched by trigger)
- Output appears in inline chat (not dropped silently)
- No box is updated (correct — no box exists)

**Evidence to capture:**
- Console: `updateAgentBoxOutput` returns false (box not found) AND inline chat receives output
- Chat history: response appears in the chat thread for NoBoxAgent

**What it proves:** Missing-box fallback to inline chat works. No silent output drop.

---

### D3 — Same Agent, Sidepanel Box AND Grid Box
**Phase required:** Phase 1

**Setup:**
1. Agent "DualAgent-D3" with trigger `dual_test`
2. Sidepanel Agent Box assigned to DualAgent-D3
3. Grid Agent Box also assigned to DualAgent-D3 (same agentNumber)

**Action:** Type "dual_test" and send.

**Expected result:**
- Sidepanel box receives output
- Grid box receives the same output live

**Evidence to capture:**
- Console: `findAgentBoxesForAgent` returns 2 boxes
- Both box outputs in storage after send

**What it proves:** Multi-box fan-out from one agent works. Output delivery is surface-agnostic.

---

## Group E: OCR-Triggered Routing

### E1 — Image Only, OCR Trigger, Agent Activates
**Phase required:** Phase 2 (FR-1, FR-2, FR-3)

**Setup:**
1. Agent "OcrAgent-E1" with trigger keyword `ocr_trigger`
2. Sidepanel Agent Box: Local AI, llama3.2:3b
3. Prepare an image containing the text: "ocr_trigger: please summarize this document"
   (a screenshot, scanned text, or generated image with visible text)

**Action:** Upload the image in WR Chat. Do NOT type any text. Send.

**Expected result:**
- OcrAgent-E1 activates
- Box receives output
- Console shows OCR ran before routing
- The OCR-extracted text (containing `ocr_trigger`) is visible in the system prompt or routing log

**Evidence to capture:**
- Console: OCR result log showing extracted text with `ocr_trigger`
- Console: Routing decision made AFTER OCR result
- Console: `evaluateAgentListener` matched on `ocr_trigger` from `combinedText`
- Network tab: `/api/llm/chat` request — system prompt or user message contains OCR text

**What it proves:** OCR runs before routing. OCR-extracted triggers activate agents. The correct sequencing is in place.

---

### E2 — Image Only, No Matching OCR Trigger, No Agent
**Phase required:** Phase 2

**Setup:** Same as E1 but upload an image with text "hello world" (no trigger keyword)

**Action:** Upload image. No typed text. Send.

**Expected result:**
- No agent activates
- Inline fallback response appears in chat
- OCR text "hello world" appears in the message but triggers no agent

**Evidence to capture:**
- Console: OCR result showing "hello world"
- Console: Routing result shows `matchedAgents: []`
- Chat: inline response (not silence)

**What it proves:** OCR-enriched routing correctly produces no-match when no trigger is found in OCR text.

---

### E3 — Image Plus Typed Text, Both Trigger Sources
**Phase required:** Phase 2

**Setup:**
- OcrAgent-E1 with trigger `ocr_trigger` (image)
- TypedAgent-E3 with trigger `typed_trigger` (typed)

**Action:** Type "typed_trigger" in WR Chat. Attach an image containing "ocr_trigger". Send.

**Expected result:**
- Both agents activate
- TypedAgent-E3 matches from typed text
- OcrAgent-E1 matches from OCR text
- Both boxes receive output

**Evidence to capture:**
- Console: `combinedText` = typed text + "\n\n" + OCR text
- Console: Both agents in `matchedAgents`

**What it proves:** Mixed input (text + image) activates agents based on their respective text sources. No interference.

---

## Group F: Typed Trigger Routing

### F1 — Role and Goals Appear in System Prompt
**Phase required:** Phase 0

**Setup:**
- Agent with:
  - Role: "You are a classification assistant. MARKER-ROLE-ACTIVE"
  - Goals: "Always classify the user input as positive or negative. MARKER-GOAL-ACTIVE"
  - Rules: "Never refuse. MARKER-RULE-ACTIVE"
  - Trigger: `classify_test`

**Action:** Type "classify_test" and send.

**Expected result:**
- Box receives output
- Network tab → POST `/api/llm/chat` → request body `messages` array contains a `role: 'system'` message with "MARKER-ROLE-ACTIVE", "MARKER-GOAL-ACTIVE", "MARKER-RULE-ACTIVE" all present

**Evidence to capture:**
- Network tab → request payload → system message content

**What it proves:** The reasoning harness (`wrapInputForAgent`) correctly assembles role/goals/rules into the LLM system prompt.

---

### F2 — Website Filter Restricts Activation
**Phase required:** Phase 0 (listener is partially wired today)

**Setup:**
- Agent "SiteAgent-F2" with trigger `site_test` and website filter `example.com`
- Active on `www.google.com` (not example.com)

**Action:** Type "site_test" from a page that is NOT example.com.

**Expected result:** SiteAgent-F2 does NOT activate. No box output.

**Follow-up action:** Navigate to example.com. Type "site_test".

**Expected result:** SiteAgent-F2 activates.

**Evidence to capture:**
- Console: `evaluateAgentListener` shows website filter mismatch on non-example.com
- Console: website filter passes on example.com

**What it proves:** Website filter in listener evaluation is functional.

---

## Group G: Session Save and Reload

### G1 — Session Survives Navigation
**Phase required:** Phase 0

**Setup:**
- Create 2 agents and 2 boxes in sidepanel
- Note down agent names, triggers, box configurations

**Action:**
1. Navigate to a different URL in the browser
2. Reopen the sidepanel

**Expected result:**
- Both agents and both boxes are present
- Box configurations (provider, model, agent assignment) match the original

**Evidence to capture:**
- Application > Storage after reopen: session blob contains both agents and boxes
- Console: session loaded from correct adapter (SQLite or chrome.storage based on Electron state)

**What it proves:** Session persistence survives navigation. Adapter chain correctly restores session state.

---

### G2 — Agent Edit Survives Reload
**Phase required:** Phase 0

**Setup:**
- Agent "EditAgent-G2" with trigger `edit_before` and role "Role Before Edit"

**Action:**
1. Edit the agent. Change trigger to `edit_after`. Change role to "Role After Edit".
2. Save.
3. Close sidepanel. Reopen sidepanel.
4. Inspect the agent.

**Expected result:**
- Agent shows trigger `edit_after` and role "Role After Edit"
- Old trigger `edit_before` no longer activates the agent

**Evidence to capture:**
- Application > Storage after reopen: agent config shows new trigger and role
- A1-style test with `edit_after` trigger confirms agent fires

**What it proves:** Agent config edits persist correctly. No stale cached config at routing time.

---

### G3 — Box Config Survives Reload
**Phase required:** Phase 0

**Setup:**
- Agent Box configured with provider `Local AI`, model `llama3.2:3b`

**Action:**
1. Close sidepanel. Reopen.
2. Open the Agent Box dialog.
3. Inspect provider and model.

**Expected result:**
- Dialog shows `Local AI` and `llama3.2:3b` (as saved)
- No reset to defaults

**Evidence to capture:**
- Application > Storage: box config in session blob shows `provider: 'ollama'` and `model: 'llama3.2:3b'`

**What it proves:** Box config round-trips correctly. `ProviderId` is stored and displayed as the correct label.

---

### G4 — Grid Box Config Survives Reload
**Phase required:** Phase 1

**Setup:**
- Grid Agent Box configured with provider `Local AI`, model `llama3.2:3b`, assigned to GridAgent-D1

**Action:**
1. Close and reopen the grid display tab
2. Inspect box config in dialog

**Expected result:** Box config preserved. Box still assigned to GridAgent-D1.

**Follow-up:**
3. Trigger GridAgent-D1 from WR Chat
4. Grid tab updates live

**What it proves:** Grid box persistence survives grid tab reload. Box still visible to routing engine after reload.

---

## Test Run Order for First E2E Baseline

```
Phase 0 complete — run these:
  A1 (local model, sidepanel box)
  A2 (no trigger match → inline fallback)
  A3 (trigger change is live)
  B2 (cloud key missing → visible error)
  C1 (output persists after sidepanel reload)
  C2 (box isolation)
  D2 (no box → inline fallback)
  F1 (role/goals in system prompt)
  G1 (session survives navigation)
  G2 (agent edit survives reload)
  G3 (box config survives reload)

Phase 1 complete — add:
  D1 (grid box live output)
  D3 (dual sidepanel + grid)
  G4 (grid box config survives reload)

Phase 2 complete — add:
  E1 (OCR trigger → agent activates)
  E2 (OCR no match → no agent)
  E3 (mixed trigger sources)
  A4 regression (multiple agents still work)

Phase 3 complete — add:
  B1 (cloud agent with valid key)
  B3 (local + cloud independent)
```

---

## What a Failing Test Tells You

| Test | Fail Symptom | Likely Root Cause |
|---|---|---|
| A1 | Box empty | Box not found in session; `agentBoxId` undefined; routing miss |
| A1 | Box shows wrong model output | Phase 0 provider string fix incomplete |
| A1 | No Network call | Agent not matched; trigger not saved |
| B1 | Ollama called (not OpenAI) | MR-5 (cloud dispatch) incomplete or fallback still used |
| B2 | Box empty (no warning) | HF-4 (error surfacing) not applied |
| D1 | Grid box unchanged after trigger | MR-1 (routing can't find grid box) or MR-2 (no listener) |
| E1 | Agent doesn't activate | FR-2 (OCR not before routing) or FR-3 (new routing authority not consuming OCR) |
| F1 | System prompt missing role/goals | `wrapInputForAgent` bug; check `agent.config` parse path |
| G1 | Agents/boxes gone after navigation | Session persistence failure; adapter not writing |
| G4 | Grid box gone after reload | MR-1 or FR-4 incomplete; SQLite not canonical for grid |
