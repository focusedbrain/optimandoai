# 04 — Minimum Viable Orchestrator Slice

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Basis:** Gap map (doc 02), priority order (doc 03), normalization requirements (doc 17).

---

## If We Only Make One Slice Work First, It Should Be This

**The minimum viable orchestrator slice is:**

> A user types text containing a trigger keyword into WR Chat. The agent configured with that trigger activates. The Agent Box assigned to that agent (whether in the sidepanel or the display grid) executes with the configured provider and model. The LLM output lands in the correct box, live, without page reload.

That's it. One agent. One box. One trigger. Typed text. The right model.  
Every other feature is additive from here.

The second required scenario — which should be proven in the same first pass — is:

> A user uploads an image. The image contains a trigger keyword. OCR extracts the trigger. The correct agent activates. Output lands in the configured box.

These two scenarios together prove that the full pipeline — input → OCR → routing → brain selection → LLM call → output delivery — is wired.

---

## What Exact Path Should Be Canonical

**Extension side:**
1. User sends from WR Chat (`handleSendMessage` in sidepanel.tsx)
2. If image present: OCR runs first, then routing
3. `routeInput` (or post-OCR equivalent) evaluates listener against enriched text
4. One matched agent produces one `AgentMatch` with a valid `agentBoxId`
5. `wrapInputForAgent` builds system prompt from `agent.role`, `agent.goals`, `agent.rules`, `ocrText`
6. `resolveModelForAgent` returns the configured model using normalized provider constants
7. `processWithAgent` posts to `/api/llm/chat` (local) or provider-appropriate endpoint (cloud)
8. Output returned and passed to `updateAgentBoxOutput`
9. `UPDATE_AGENT_BOX_OUTPUT` message sent and received by either sidepanel or grid handler

**Electron side:**
- `/api/llm/chat` routes to Ollama for local, to provider API for cloud
- OCR runs via `/api/ocr/process` before routing call on extension side
- API keys accessible from the store that the extension writes to

**This path must be clean, traceable, and testable.** Every step must produce observable output (console log, Network tab entry, or visible box update).

---

## Which Provider Types Should Be Supported in the First Working Slice

**Required for first pass:**
- **Local AI / Ollama** — this is the baseline. Must work without qualification.

**Recommended for first pass (if achievable without major scope creep):**
- **One cloud provider** — OpenAI is the most common integration target and provides the clearest API model. Even a single working cloud provider proves the architecture is not Ollama-hardcoded and validates the API key path end-to-end.

**Explicitly out of scope for first slice:**
- Anthropic, Gemini, Grok — add after OpenAI pattern is established
- Multiple cloud providers simultaneously — add individually

The implementation should use the provider constants file (P0-B) so adding cloud providers later is purely a dispatch case addition, not a new string to match.

---

## Which Box Surfaces Should Be Supported in the First Working Slice

**Both sidepanel boxes and display-grid boxes must work in the first slice.** This is a stated product requirement. However, the order of implementation should be:

1. **Sidepanel box** — fix the provider string bug (P0-A), verify basic path
2. **Display-grid box** — fix the persistence split (P0-C) and add live handler (P0-D)

The two surfaces require different fixes but should both be verified before the first test set is declared complete. Allowing grid boxes to fail without testing would allow the persistence split (the most dangerous structural issue) to remain hidden.

---

## Which Agent Controls Must Already Have Runtime Effect

For the minimum viable slice, these controls must have observable runtime effect:

| Control | What "works" means | Where it's consumed |
|---|---|---|
| **Trigger keyword** | Agent activates when trigger appears in input (typed or OCR) | `evaluateAgentListener` |
| **Agent enabled/disabled** | Disabled agent does not activate | `evaluateAgentListener` |
| **Agent Box provider** | Correct provider determines which API endpoint is used | `resolveModelForAgent` (after P0 fix) |
| **Agent Box model** | Configured model name is the model called | `resolveModelForAgent` + LLM request payload |
| **Agent → Box assignment** | Box linked to agent receives output from that agent | `findAgentBoxesForAgent` → `agentBoxId` |
| **Role / Goals / Rules** | These fields appear in the system prompt sent to the LLM | `wrapInputForAgent` |

---

## Which Controls May Remain Persisted-Only for This Slice

These controls should be saved and round-tripped correctly, but their runtime effect is explicitly deferred:

| Control | Status | Action required now |
|---|---|---|
| `reasoningSections[]` | Persisted only | Flat `agent.reasoning` used instead — acceptable for first pass |
| `agentContextFiles` | Persisted only | Not injected into prompt — must be clearly labeled in UI |
| `memorySettings` | Persisted only | Not consumed — must be clearly labeled or hidden |
| `contextSettings` | Persisted only | Not consumed — must be clearly labeled or hidden |
| `executionMode` | Persisted only | Single box output is the only behavior |
| `listening.sources[]` | Persisted only | Source filtering not evaluated |
| `acceptFrom` | Persisted only | Chaining not evaluated |
| `platforms.desktop/mobile` | Persisted only | Routing not affected |

**Critical point:** Controls that are persisted but not yet wired must be either (a) hidden from the UI for now, or (b) clearly labeled as "coming soon" or "not yet active." Presenting them as functional while they have no runtime effect is the single most misleading UX problem in the current system. If they cannot be wired in this pass, they should be made visually inactive.

---

## What the Test Scenarios Are for Proving the Slice Works

These are the minimum scenarios that must all pass before the first slice is declared working.

### Scenario 1: Typed Trigger → Local Agent → Sidepanel Box
1. Install Ollama. Have at least one model available (e.g., `llama3.2:3b`).
2. Create an agent named "Summarizer" with trigger keyword `summarize`.
3. Set role: "You are a concise summarizer."
4. Create a sidepanel Agent Box. Assign provider `Local AI`, model `llama3.2:3b`, linked to "Summarizer".
5. In WR Chat, type: "Please summarize this report" and send.
6. **Expected:** Agent "Summarizer" activates. Box populates live with output. Network tab shows POST to `/api/llm/chat` with model `llama3.2:3b` in the request body. System prompt contains "You are a concise summarizer."

### Scenario 2: Image Upload → OCR Trigger → Agent Activation
1. Same agent "Summarizer" with trigger `summarize_ocr` (distinct trigger).
2. Prepare an image containing the text "summarize_ocr: Please extract findings from this document".
3. Upload image in WR Chat. No typed text. Send.
4. **Expected:** OCR runs before routing. Trigger `summarize_ocr` is extracted. Agent activates. Box shows output. Network payload includes OCR text.

### Scenario 3: Typed Trigger → Local Agent → Grid Box
1. Same agent "Summarizer". Create a display-grid Agent Box (not sidepanel). Assign same provider/model.
2. Open the display grid in its tab.
3. In WR Chat, type: "Please summarize" and send.
4. **Expected:** Grid box updates live (without page reload) with agent output. No sidepanel box receives output for this send (the box is in the grid, not sidepanel).

### Scenario 4: Cloud Agent (if in scope)
1. Enter OpenAI API key in extension settings.
2. Create an agent "Cloud Writer" with trigger `write`.
3. Create a sidepanel Agent Box. Assign provider `OpenAI`, model `gpt-4o`.
4. Type "write a short summary" in WR Chat.
5. **Expected:** Network tab shows call to `api.openai.com` or Electron proxy to it. Box populates with GPT-4o output. Ollama is NOT called.

### Scenario 5: Wrong Model — Visible Error
1. Configure an Agent Box with provider `OpenAI` but no API key set.
2. Send a trigger message.
3. **Expected:** Box shows a visible warning or error message (not silent Ollama fallback, not empty). Message explains the issue.

### Scenario 6: Session Persistence
1. Create an agent and a box. Close and reopen the sidepanel.
2. Send a trigger message.
3. **Expected:** Agent is still present. Box is still configured. Routing finds the box. Output delivered.
