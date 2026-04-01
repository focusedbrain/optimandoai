# 01 — First E2E Goal Definition

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Basis:** Prior analysis series (docs 00–19), codebase deep-reads.

---

## What Must Be True for the First End-to-End Test to Count as Successful

The following criteria define "working end to end" for the first real test pass. These are not aspirational targets — they are the minimum observable behaviors that must be simultaneously true during a single session.

---

### Minimum Required Runtime Behaviors

**1. Typed-trigger agent activation**  
A user types text containing a configured trigger keyword in WR Chat. The matching agent is identified. If no agent matches, a clear fallback (butler/inline) response appears. This must be verifiable via console logs and Agent Box output.

**2. Image-trigger agent activation (OCR path)**  
A user uploads an image containing text that includes a configured trigger keyword. The agent whose trigger appears in the OCR-extracted text activates — not an agent whose trigger was in the typed text (or with no typed text at all). This proves OCR enriches routing, not just the LLM message.

**3. Correct model execution — local provider**  
An Agent Box is configured with provider `Local AI` and a specific installed Ollama model (e.g., `llama3.2:3b`). The Network tab shows a POST to `/api/llm/chat` with that exact model name in the request payload. Not the fallback model. The response is the output of the configured model.

**4. Correct model execution — at least one cloud provider**  
An Agent Box is configured with a cloud provider (e.g., `OpenAI`, `gpt-4o`) and the corresponding API key is set. The Network tab shows a POST to the appropriate cloud API endpoint (or Electron-proxied equivalent). Output in the box reflects the cloud model. Silent Ollama fallback must NOT occur when a valid key is present.

**5. Output lands in the correct Agent Box — sidepanel**  
A configured agent with a sidepanel Agent Box receives LLM output in that box without page reload. The output is visible and matches the agent's output (not another agent's output, not a generic response).

**6. Output lands in the correct Agent Box — display grid**  
A configured agent with a display-grid Agent Box receives LLM output in that box live (without page reload) in the grid tab. Same agent, different box surface — the behavior must be equivalent to item 5.

**7. Basic listener configuration has observable runtime effect**  
Setting a trigger keyword on an agent causes it to activate only for matching input. Changing the trigger causes activation to follow the new trigger. An agent with no trigger and no other listener rules either activates on all input or does not activate — the behavior must be consistent and explicable from configuration.

**8. Reasoning section content reaches the LLM**  
The agent's role, goals, and rules fields appear in the system prompt captured in the Network tab request payload. The content typed into the agent form is the content delivered to the model.

**9. Session persistence across navigation**  
Agents and boxes configured in one session survive a page navigation and sidepanel re-open. The storage adapter (SQLite when Electron is running) is the canonical source. Agents created in the session are still present and functional after reload.

**10. API key visible to execution path**  
An API key entered in the extension's settings UI is the key used by the Electron backend when making a cloud provider call. The key is not lost in transit between localStorage and the backend.

---

### Minimum Required UI Behaviors

**1. Agent Box model selector shows real installed Ollama models**  
When provider is `Local AI`, the model dropdown lists currently installed models from Ollama, not a static hardcoded list. If Ollama is not running, the dropdown shows an empty/error state, not stale options.

**2. Cloud provider selection shows only providers with valid keys, or clearly indicates missing key**  
A user selecting `OpenAI` without a key set should receive either a disabled state or a visible warning — not a silent fallback to Ollama.

**3. Agent configuration form saves correctly and visibly**  
Changes to agent name, trigger, role, goals, and rules are saved and survive panel close/reopen. The agent card reflects the saved state.

**4. Agent Box configuration saves correctly**  
Provider, model, and agent assignment survive dialog close/reopen. The box correctly shows the assigned provider and model on next open.

**5. Controls that are not yet wired are either hidden or labeled**  
The memory toggles, context file upload, WR Experts, execution modes, and listening sources that are currently persistence-only must either be absent from the UI, visually dimmed, or carry a clear "not yet active" label. They must not silently do nothing while appearing functional.

---

### Minimum Required Persistence Behaviors

**1. Session contains agents and boxes after creation**  
Inspecting `chrome.storage.local` (or the SQLite sessions table) after creating agents and boxes shows a session blob containing both. No data is lost between creation and storage.

**2. Agent Box saves reach the same store that routing reads from**  
Whether a box is created in the sidepanel or the display grid, it must be findable by `loadAgentBoxesFromSession` at routing time. Both stores must be the same adapter chain.

**3. Session survives extension context reset**  
Reloading the page or triggering a service worker restart does not erase the session. The session can be retrieved from the canonical store after reset.

---

### Minimum Required Cloud/Local Provider Behaviors

**Local:**
- `'Local AI'` as the UI provider string must map to Ollama at runtime.
- The model string saved to the box must be passed as-is to `/api/llm/chat`.
- Ollama being unavailable must produce a visible error, not a silent drop.

**Cloud (minimum one provider for first pass):**
- API key entered in extension UI must reach the Electron backend for the corresponding cloud call.
- Electron must route the chat request to the cloud provider API when the box provider is cloud.
- Cloud call failure (bad key, network error) must surface a visible error.

---

### Explicit Non-Goals for This First Pass

These items explicitly do NOT need to work for the first E2E test to count as successful:

- `reasoningSections[]` per-trigger selection — flat `agent.reasoning` is sufficient for first pass
- `agentContextFiles` RAG injection into prompts
- `memorySettings` consumption at runtime
- `contextSettings` consumption at runtime
- WR Experts orchestrator integration
- `listening.sources[]` evaluation
- `executionMode` branching (beyond single box output)
- Multiple non-box destinations (email, webhook, storage, notification)
- `acceptFrom` multi-agent chaining
- Streaming output
- Structured output / tool-use
- Session import/export
- Session schema versioning / migration
- Mobile platform routing
- DOM trigger types
- `outputId` or multi-box fan-out

---

### Success Validation Test Matrix

| Test | Pass Condition | What It Proves |
|---|---|---|
| T1: Typed trigger → local agent → sidepanel box | Box shows output; Network shows configured Ollama model | End-to-end local path works |
| T2: Image-only input → OCR trigger → sidepanel box | Agent activates only after OCR extraction; box shows output | OCR is in routing path |
| T3: Same agent, grid box | Grid box shows output live without reload | Grid box equivalence |
| T4: Cloud agent (OpenAI) with valid key | Network shows call to OpenAI; box shows output | Cloud execution works |
| T5: Agent trigger changed | Only new trigger activates agent | Listener configuration is live |
| T6: Role/goals changed | Network request system prompt reflects new content | Reasoning reaches LLM |
| T7: Navigate away, return | Agents and boxes still present | Session persistence |
| T8: No Ollama running, local agent | Box shows visible error, not silent empty | Failure mode is visible |
| T9: Cloud key missing, cloud agent | Warning shown, not silent Ollama fallback | Provider gate works |
