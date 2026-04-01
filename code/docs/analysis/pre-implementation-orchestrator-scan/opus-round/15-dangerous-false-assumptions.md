# 15 — Dangerous False Assumptions

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–3 (docs 01–12)  
**Purpose:** The false assumptions an implementation model will make if it reads the UI, the schema, or the codebase surface without reading the confirmed-behavior analysis. Each one will cause a developer to build in the wrong place, trust the wrong component, or ship a feature that silently doesn't work.

---

## FA-1: A Visible UI Control Is Runtime-Backed

**The assumption:** If a user can interact with a control — toggle it, type into it, upload to it — then the control influences the system's behavior.

**Why it's false:** The following controls are fully visible, fully interactive, and have zero runtime effect:
- Memory settings toggles (`memorySettings.sessionEnabled`, `accountEnabled`, `agentEnabled`)
- Context file upload (`agentContextFiles[]`)
- Context settings toggles (`contextSettings.agentContext`, `sessionContext`, `accountContext`)
- `listening.sources[]` (source type selector: voice, screenshot, DOM, etc.)
- `acceptFrom` (agent chaining field)
- `executionMode` selector (4 modes: `agent_workflow`, `direct_response`, `workflow_only`, `hybrid`)
- Non-box execution destinations (email, webhook, storage, notification)
- Multi-section reasoning tabs (if separately configurable in UI)
- Platform flags (desktop/mobile)

All of these are saved to the session blob. None are read by `wrapInputForAgent`, `evaluateAgentListener`, `resolveModelForAgent`, or any part of the execution loop.

**Consequence if assumed true:** A developer adds a small runtime hook for `memorySettings.sessionEnabled` and believes memory is "wired" — but the hook reads a flag that has never had an effect, and the output is identical whether the toggle is on or off. The feature appears to work in testing because LLM outputs are non-deterministic.

**Ground truth:** Read `processFlow.ts::wrapInputForAgent` (lines 1089–1132). Count the fields it actually reads: `role`, `goals`, `rules`, `custom` key-value pairs, raw `input`, `ocrText`. Nothing else.

---

## FA-2: The Display-Grid Agent Box Is the Same as a Sidepanel Agent Box at Runtime

**The assumption:** Both use `CanonicalAgentBoxConfig`. The schema is identical. They must behave the same way.

**Why it's false:**
- Grid boxes are saved via `SAVE_AGENT_BOX_TO_SQLITE` → SQLite only. NOT to `chrome.storage.local`.
- `loadAgentBoxesFromSession` reads `chrome.storage.local` only. It never sees grid boxes.
- Grid pages have no handler for `UPDATE_AGENT_BOX_OUTPUT`. Output delivered to a grid box's `boxId` is written to storage but never rendered.
- Grid session loading bypasses the storage proxy and goes directly to Electron HTTP.

**Consequence if assumed true:** A developer wires output delivery to a grid Agent Box. They verify that `updateAgentBoxOutput` runs and writes to storage. They check the storage blob and confirm the output is there. They declare grid output "working." The grid page never updates because it has no handler and loads from a different path.

**Ground truth:** The schema is identical. The operational reality is entirely different. Three separate structural issues must all be resolved: write-path unification, read-path alignment, and a new grid message handler.

---

## FA-3: A Provider Shown in the Dropdown Is an Executable Provider

**The assumption:** The Agent Box dialog shows `Local AI`, `OpenAI`, `Anthropic`, `Gemini`, `Grok`. Selecting any of these and configuring a model means that provider can execute.

**Why it's false:**
- `resolveModelForAgent` hits "API not yet connected" for ALL cloud providers.
- `processWithAgent` always posts to Electron `/api/llm/chat` — which is Ollama-only.
- `'Local AI'` is not recognized by `resolveModelForAgent` (it falls through to the fallback model).
- The cloud provider entries in the dropdown are aspirational UI, not functional pathways.

**Consequence if assumed true:** A developer adds an API key for Anthropic, configures a Claude model, triggers the agent, sees the box populate with output — and believes Anthropic ran. The output is from the Ollama fallback model. The developer ships with confidence that cloud execution works.

**Ground truth:** The ONLY currently functional execution path is: box.provider recognized as local (which currently requires `'ollama'`, `'local'`, or `''`) + Electron Ollama running + model installed. Every other combination silently falls back.

---

## FA-4: OCR Text Participates in Routing

**The assumption:** The user uploads an image. OCR runs. The extracted text is combined with the typed text. Routing uses this combined text to match agents.

**Why it's false:** `routeInput` (the authoritative routing call) runs at `sidepanel.tsx:2925`. `processMessagesWithOCR` runs at line 2943. The routing decision is final before OCR text is available. OCR-enriched routing (`routeClassifiedInput`) exists and runs with combined text — but its result is wired to `console.log` at line 2992, not to the execution loop.

**Consequence if assumed true:** A developer tests OCR routing. They upload an image with trigger text. They see the OCR text in the message history. They see `routeClassifiedInput` called with the right combined text in the console. They see correct agent allocations in the console log. They conclude OCR routing works. It doesn't — the console output is from a discarded secondary routing computation. The execution loop uses the pre-OCR result.

**Ground truth:** OCR enriches the LLM message content. It enriches the system prompt (`ocrText` is appended in `wrapInputForAgent`). It does NOT enrich the routing decision that activates agents. An agent with a trigger keyword that only appears in an uploaded image will never activate via WR Chat.

---

## FA-5: A Saved API Key Can Execute a Cloud Model

**The assumption:** The user opens extension settings, enters an OpenAI API key, saves it. The system now has the key. Cloud models will work.

**Why it's false:**
1. The extension saves keys to `localStorage['optimando-api-keys']` (a browser localStorage entry in the extension context).
2. The Electron backend reads keys from its SQLite orchestrator store (`handshake:getAvailableModels` uses this path).
3. There is no confirmed synchronization between these two stores.
4. Even if the key were correctly synced, cloud execution is not implemented — `resolveModelForAgent` returns "API not yet connected" for all cloud providers.

**Consequence if assumed true:** A developer confirms the API key is saved (inspects `localStorage`). Implements the cloud dispatch path in Electron. Tests by triggering a cloud agent. Electron looks for the key in SQLite. It's not there. The call fails. The developer debugs the cloud dispatch code — the real problem is the key store split.

**Ground truth:** Setting an API key in the extension UI has no confirmed effect on any LLM execution path. The key is stored in a store that the runtime doesn't read.

---

## FA-6: The Routing Result in the Console Is the Routing Result That Drove Execution

**The assumption:** The console logs show detailed routing output — matched agents, agent allocations, resolved destinations. This is what ran.

**Why it's false:** There are three routing computations per WR Chat send:
1. `routeInput(rawText)` at line 2925 — pre-OCR, pre-NLP — **drives execution**
2. `routeClassifiedInput(classified)` at line 2983 — post-OCR+NLP — **logged only**
3. `routeEventTagInput(inputText)` at line 3015 — post-OCR+NLP — **logged only**

The console shows detailed output from computations 2 and 3 (they produce richer, more structured output). Computation 1 drives execution but logs less detail. A developer reading the console will see what appears to be a complete, accurate routing trace — and it is accurate, but it is the trace of the computation whose result is discarded.

**Consequence if assumed true:** A developer sees "matched agents: [OcrAgent, TextAgent]" in the console from `routeClassifiedInput`. They believe both agents executed. Only the agents matched by `routeInput` (computation 1, pre-OCR) actually ran. If `OcrAgent` only matches due to OCR text, it's in the console but not in the actual execution. The developer concludes the orchestrator is working when it isn't.

**Ground truth:** The only routing result that matters for execution is `routingDecision.matchedAgents` at line 3058 — derived from computation 1. Filter console logs for this specific variable to understand what actually ran.

---

## FA-7: Agent Configuration That Is Saved Is Configuration That Works

**The assumption:** If saving the agent form succeeds and the session contains the right values, the agent will behave according to that configuration.

**Why it's false:** The save path writes to `chrome.storage.local` (via adapter). The routing path reads from `chrome.storage.local` for boxes but from SQLite for agents (`loadAgentsFromSession`). If the adapter is SQLite (when Electron is running), agent saves go to SQLite. But `loadAgentBoxesFromSession` reads from `chrome.storage.local` directly — a different store.

Additionally: agent config is stored as raw stringified JSON per tab (`agent.config['instructions'] = '{"role":"..."}'`). Normalization to `CanonicalAgentConfig` happens at export/routing boundaries. If the stringification or the parse fails silently, the agent config is lost between save and routing.

**Consequence if assumed true:** A developer saves an agent with a new role. Triggers the agent. The old role appears in the system prompt. The developer assumes `wrapInputForAgent` has a bug. The actual issue is that the session read at routing time is from a different adapter (or a cached session) than the one the save wrote to.

**Ground truth:** Verify the round-trip: save agent → trigger → inspect Network request system prompt. Confirm the system prompt contains the value that was saved in the most recent config. If it doesn't, the storage adapter path has inconsistency.

---

## FA-8: `findAgentBoxesForAgent` Will Always Find the Right Box

**The assumption:** The box is configured correctly, the `agentNumber` matches, the session contains the box. `findAgentBoxesForAgent` will return it.

**Why it's false:** `findAgentBoxesForAgent` searches the boxes array returned by `loadAgentBoxesFromSession`. If `loadAgentBoxesFromSession` read from the wrong store (chrome.storage.local when the box is in SQLite), the boxes array is empty or incomplete. The function returns no matches. `AgentMatch.agentBoxId` is `null`. Output delivery has no destination. Silent drop.

**Consequence if assumed true:** A developer verifies the box configuration looks correct in the UI. Triggers the agent. Box is empty. They check `updateAgentBoxOutput` — it runs but returns `false` (box not found). They check `findAgentBoxesForAgent` — it returns no matches. They add logging and see the boxes array is empty or doesn't contain their box. They conclude there's a bug in box finding. The real issue is upstream: the box was never loaded into the array.

**Ground truth:** Before debugging `findAgentBoxesForAgent`, always verify the input it receives. Log the `agentBoxes` array at the routing call site. If the array is empty or missing the expected box, the problem is in `loadAgentBoxesFromSession`, not in `findAgentBoxesForAgent`.

---

## FA-9: The Schema Field That Exists Is the Feature That Works

**The assumption:** `CanonicalAgentConfig` has `reasoningSections[]`, `agentContextFiles[]`, `memorySettings`, `contextSettings`. These are part of the schema. The system must implement them.

**Why it's false:** Schema presence does not imply runtime consumption. The schema was designed ahead of implementation. The runtime is behind the schema. Fields that exist on the schema and are persisted through the form have no guaranteed runtime consumer.

The confirmed consumed fields in the WR Chat execution path are: `agent.role`, `agent.goals`, `agent.rules`, `agent.reasoning` (flat), `listening.triggers[]`, `listening.website`, `listening.expectedContext`, `listening.applyFor`. Everything else on `CanonicalAgentConfig` is schema-only or form-only.

**Consequence if assumed true:** A developer reads the schema, sees `reasoningSections[]`, assumes per-trigger reasoning is implemented, and builds on top of it. The build looks correct because the schema is correct. Runtime behavior is unchanged because nothing reads `reasoningSections[]` in the WR Chat path.

**Ground truth:** The ground truth is `processFlow.ts::wrapInputForAgent` (what it reads), `InputCoordinator.ts::evaluateAgentListener` (what it evaluates), and `processFlow.ts::resolveModelForAgent` (what it resolves). Everything else on the schema is aspirational until explicitly confirmed consumed.

---

## FA-10: Multi-Agent Chaining via `acceptFrom` Is Active

**The assumption:** Agent B has `acceptFrom: ['agent-a']`. When Agent A produces output, it triggers Agent B via the `acceptFrom` handoff.

**Why it's false:** `acceptFrom` is defined on `CanonicalAgentConfig`. It is persisted when the form is saved. It is never read by `evaluateAgentListener`. There is no confirmed handoff mechanism in the current codebase that evaluates `acceptFrom` and triggers a second agent.

**Consequence if assumed true:** A developer configures a two-agent chain. Agent A produces output. Agent B never fires. The developer debugs Agent B's listener, its triggers, its enabled state — all are correct. The actual issue is that `acceptFrom` is never evaluated and the handoff is never initiated.

**Ground truth:** Multi-agent chaining is a future feature. The current orchestrator runs each matched agent in its own independent execution path. There is no agent-to-agent message passing in the WR Chat pipeline.
