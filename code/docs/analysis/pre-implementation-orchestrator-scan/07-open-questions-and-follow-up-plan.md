# Open questions and follow-up plan (pre-scan synthesis)

**Purpose:** Consolidate the pre-implementation orchestrator scan into a **handoff package** for a stronger model and a **screenshot-assisted second round**. This document is **actionable and compact**; detail lives in `01–06` in this folder.

**Audience:** Senior implementer + product/QA validating behavior before a deep implementation pass.

---

## 1. Concise synthesis of key findings

| Theme | Finding |
|--------|---------|
| **Architecture** | Extension UX (`sidepanel`, `content-script`, `background`) talks to **Electron HTTP** on **`127.0.0.1:51248`** for LLM, OCR, and orchestrator session APIs. **Port is hardcoded** in extension and must match Electron `HTTP_PORT`. |
| **WR Chat “truth”** | The **production** WR Chat pipeline is **`sidepanel.tsx`** (`handleSendMessage`, OCR, routing, LLM). **`CommandChatView`** without `onSend` **mocks** responses (e.g. popup command submode). |
| **Routing vs NLP** | **`routeInput` → `matchInputToAgents` → `InputCoordinator.routeToAgents`** uses **regex on raw text** (`#` / `@`) **before OCR**. **`routeClassifiedInput`** runs after NLP but is **not** used to branch agent vs butler in `handleSendMessage` (logging only). |
| **OCR order** | **`processMessagesWithOCR`** runs **after** `routeInput`. **Inferred product gap:** hashtags visible only in OCR are **not** in `routeInput`’s string; NLP/event-tag **feedback** can still see them. |
| **Event tags** | **`routeEventTagInput`** may append **match feedback** to chat. **`processEventTagMatch`** exists in **`processFlow.ts`** but is **not** invoked from **`sidepanel`**; earlier scan notes it may **not call LLM yet** (placeholder). |
| **Execution path** | Matched agents → **`processWithAgent`** → **`POST /api/llm/chat`** (Ollama **`stream: false`**) → **`updateAgentBoxOutput`** → storage + **`UPDATE_AGENT_BOX_OUTPUT`**. |
| **State split** | Agents load **SQLite-first** (background → `/api/orchestrator/get`); agent boxes load **`chrome.storage.local`** for the session key. **SQLite may lag** box-only updates until a full session save. |
| **API keys / models** | Extension **`optimando-api-keys`** in **`localStorage`** (subscription-gated save). **WR Chat model list = Ollama only** via **`llm.status`**. Electron **`ocrRouter`** needs **`POST /api/ocr/config`** (or IPC) — **no extension caller** found for that path. **HybridSearch** can show cloud models via **`handshake:getAvailableModels`**. |
| **Grids** | Display-grid boxes filtered in sidepanel; **`GRID_SAVE`** merges boxes into session by **`identifier`**. |

---

## 2. Most important confirmed wiring paths

1. **WR Chat send:** `sidepanel.tsx` → `routeInput` (`processFlow.ts`) → `matchInputToAgents` / `InputCoordinator.routeToAgents` → (then) `processMessagesWithOCR` → NLP + optional `routeEventTagInput` → PATH A `processWithAgent` / PATH B system / PATH C `getButlerResponse`.
2. **LLM:** Extension `fetch` → `POST /api/llm/chat` → `ollama-manager.ts` → Ollama `11434` with **`stream: false`**.
3. **OCR:** `POST /api/ocr/process` → `ocrRouter.processImage` (local Tesseract vs cloud vision per **`CloudAIConfig`**).
4. **Agent output:** `updateAgentBoxOutput` (`processFlow.ts`) → `chrome.storage.local` session → message **`UPDATE_AGENT_BOX_OUTPUT`** → sidepanel **`agentBoxes` / `box.output`**.
5. **Session load:** `GET_SESSION_FROM_SQLITE` in `background.ts` → Electron **`/api/orchestrator/get`** with fallback to **`chrome.storage.local`**.

---

## 3. Most important unresolved questions

1. **Should `routeInput` incorporate OCR text (or NLP triggers) for agent matching?** Code today does not; product may expect OCR-only `#tags` to dispatch agents.
2. **What is the intended contract for `routeClassifiedInput`?** It is computed but **not** driving PATH A/B/C in WR Chat — incomplete wiring vs deliberate telemetry-only?
3. **Event Tag execution:** Should **`processEventTagMatch`** (or equivalent) run automatically after **`routeEventTagInput`** when matches exist, or is chat feedback sufficient?
4. **SQLite vs storage alignment:** Under which operations is **`chrome.storage`** guaranteed in sync with orchestrator SQLite for **agents** and **agentBoxes**?
5. **API key story:** How should extension-saved keys reach **`ocrRouter`** and/or orchestrator **`optimando-api-keys`** in production (manual, sync job, Electron UI only)?
6. **`processEventTagMatch` LLM:** Confirm whether placeholder / non-LLM behavior is still accurate in current `processFlow.ts`.
7. **Multi-image messages:** Last OCR wins in code — is that acceptable for product?

---

## 4. Ranked ambiguities requiring runtime validation

**P0 — blocks correct product behavior assumptions**

1. **Pre-OCR routing vs OCR-only triggers** — Does a `#tag` only in screenshot text route to an agent or only to butler + NLP feedback?
2. **Event Tag path** — Matches show in chat; does any **automatic** agent/LLM run occur outside PATH A?
3. **Extension keys vs Electron OCR** — With keys only in extension lightbox, does cloud OCR ever activate without **`/api/ocr/config`**?

**P1 — data correctness and UX**

4. **Agent SQLite vs box storage** — Repro mismatch: agent list from SQLite, boxes from storage — when can routing see stale or missing boxes?
5. **Box output vs SQLite** — After **`updateAgentBoxOutput`**, confirm persistence across reload and other machines (if applicable).
6. **Subscription gate** — Confirm **`optimandoHasActiveSubscription`** in real builds when testing BYOK save.

**P2 — edge cases**

7. **Multiple images in one send** — Confirm only last `ocrText` affects NLP and `wrapInputForAgent`.
8. **BEAP attachment prefix** — Confirm LLM sees prefix while bubble shows short display text only.
9. **Display grid boxes** — Confirm they never appear in sidepanel strip but still receive outputs if routing targets them (if applicable).

---

## 5. Screenshot collection plan (next round)

### 5.1 Which screens to capture

| # | Screen / surface | Why |
|---|------------------|-----|
| S1 | **Sidepanel WR Chat** (full: input, messages, model selector) | Baseline PATH A/B/C evidence. |
| S2 | **Admin / LLM Settings** (Electron or embedded tab per your build) | Installed models, Ollama status. |
| S3 | **Extension Settings → API Keys** (lightbox) | Save state, subscription messaging, masked keys. |
| S4 | **Agent Boxes strip** (sidepanel) | Box numbers, output area after a run. |
| S5 | **Content script orchestrator / master grid** (if used for box creation) | Source `master_tab` vs `display_grid`. |
| S6 | **Electron HybridSearch** (optional) | Cloud + local model groups — contrast with WR Chat. |
| S7 | **Popup command mode** (optional) | Shows **mock** behavior if `onSend` absent — avoid confusing with S1. |

### 5.2 State combinations that matter

- **Models:** No Ollama / one model / multiple models; active model selected.
- **Agents:** No agents; one agent with `#` listener; multiple agents with overlapping triggers.
- **Boxes:** No box; box linked to agent; multiple boxes for same agent (first box wins in code — verify visually).
- **Input:** Text only; image only; text + image; **hashtag in text vs only in OCR** (same scenario, two runs).
- **Keys:** No cloud keys; keys in extension only; **`ocrRouter`** configured via **`/api/ocr/config`** (devtools or test harness) vs not.
- **Sessions:** Fresh session vs after **`GRID_SAVE`** / display grid activity.

### 5.3 Exact UI evidence to capture in each shot

| Goal | Capture in frame |
|------|-------------------|
| **Routing path** | User message text, optional image thumbnail, **assistant messages in order** (butler confirmation → agent confirmation → box vs inline). |
| **OCR** | User message showing image; assistant/butler reply containing **“Local OCR” / “Cloud Vision”** snippet if returned. |
| **Model used** | Visible **active model** in WR Chat header/dropdown **at send time**. |
| **Box update** | **Agent Box N** panel showing **new output** and timestamp if shown. |
| **Event tag feedback** | Any **“Match Detected”** or coordinator feedback block **and** whether a second LLM response followed without user action. |
| **API keys** | Lightbox **before/after save**; if subscription blocks, include **toast or `#byok-requirement`** visible. |
| **Errors** | Full **red/error assistant** line and any **DevTools console** excerpt (separate crop if needed). |

**Naming convention (suggested):** `S1-PATHA-hashtag-typed.png`, `S1-PATHC-ocr-only-tag.png`, `S4-box02-after-run.png`.

---

## 6. Suggested second-round investigation strategy (stronger model)

1. **Freeze code revision** — Note commit SHA for screenshot round so prose matches behavior.
2. **P0 scenarios first** — Run the three P0 checks with screenshots; paste images into a short appendix or folder referenced by ticket.
3. **Trace only on discrepancy** — If behavior matches code narrative, skip deep dive; if not, use **`sidepanel.tsx` → `processFlow.ts` → `InputCoordinator.ts`** order to bisect.
4. **Cross-check Electron** — For OCR/cloud/model issues, confirm **`main.ts`** routes and **`ocrRouter`** state in the same session as the extension (same machine, same port).
5. **Document “expected vs actual”** — One table: scenario | code expectation | screenshot result | gap?.
6. **Defer refactors** — Second round is **evidence gathering**, not fixing, unless a P0 bug blocks testing.

---

## 7. Flexible implementation guidance for a high-capability model

### 7.1 Architectural goals and constraints

- **Single source of truth for routing decisions** — Today **`routeInput`** and NLP/event-tag paths **diverge**; any change should clarify whether **one** coordinator owns “who runs” or whether parallel paths are intentional (telemetry vs execution).
- **Preserve the extension ↔ Electron boundary** — Keep **`127.0.0.1:51248`** as the integration seam; avoid duplicating Ollama or OCR inside the extension renderer.
- **Session consistency** — Agents (SQLite) and boxes (storage) **should** eventually align; new code should prefer **one load path** or explicit sync after writes.
- **Security posture** — Keys remain sensitive; **`/api/ocr/config`** on localhost still assumes **host trust**; do not widen the surface without auth review.

### 7.2 Safe extension points

- **`wrapInputForAgent` / `getButlerSystemPrompt`** — Prompt shaping without changing routing topology.
- **`NlpClassifier`** — Richer entities/triggers **if** downstream consumers are updated consistently.
- **`updateAgentBoxOutput`** — Additional metadata (e.g. reasoning headers) if UI and storage schema tolerate it.
- **Electron `POST /api/llm/chat`** — Adapter layer for non-Ollama providers **if** product requires parity with HybridSearch (larger change; isolate behind interface).

### 7.3 Fragile areas (proceed with caution)

- **Reordering `handleSendMessage` steps** — Moving OCR before `routeInput` fixes OCR-only hashtags but **invalidates** all assumptions in docs/tests; must be a deliberate product decision.
- **`sidepanel.tsx` size** — High coupling; small patches multiply edge cases. **Prefer extracting** a “chat pipeline” module over another inline branch.
- **`InputCoordinator` + `processFlow`** — Dual paths (`routeToAgents` vs `routeEventTagTrigger`); touching one often requires contract updates for the other.
- **Placeholder flows** — **`processEventTagMatch`** and similar: verify current implementation before building features on top.

### 7.4 Where refactoring may beat patching

- **Unify routing inputs** — If product requires OCR+NLP in routing, introduce a **single** “enriched user turn” object built once per send instead of multiple string variants (`llmRouteText`, `inputTextForNlp`, `ocrText`).
- **Split WR Chat orchestration from UI** — `handleSendMessage` mixes React state, fetch, and policy; extraction improves testability.
- **Key propagation** — If extension and Electron must share cloud credentials, a **defined sync** (or one store) beats ad hoc **`localStorage`** + manual **`/api/ocr/config`**.

---

## 8. Most likely code locations for implementation changes later

| Change theme | Primary files |
|--------------|----------------|
| WR Chat send pipeline, OCR order, message assembly | `apps/extension-chromium/src/sidepanel.tsx` |
| Routing, `routeInput`, `processEventTagMatch`, `wrapInputForAgent`, box updates | `apps/extension-chromium/src/services/processFlow.ts` |
| Trigger matching, listeners, box resolution, event tags | `apps/extension-chromium/src/services/InputCoordinator.ts` |
| NLP triggers / entities | `apps/extension-chromium/src/nlp/NlpClassifier.ts` |
| Session load / SQLite bridge | `apps/extension-chromium/src/background.ts` |
| Agent/agent-box persistence and grid merge | `content-script.tsx` (grids, dialogs), `background.ts` (`GRID_SAVE`, orchestrator calls) |
| LLM HTTP, port, OCR routes | `apps/electron-vite-project/electron/main.ts` |
| Ollama | `apps/electron-vite-project/electron/main/llm/ollama-manager.ts` |
| OCR cloud vs local | `apps/electron-vite-project/electron/main/ocr/router.ts`, `ocr-service`, `types` |
| API keys UI (extension) | `apps/extension-chromium/src/content-script.tsx` (settings lightbox, `saveApiKeys`) |
| Cloud model list (Electron app) | `main.ts` (`handshake:getAvailableModels`), `HybridSearch.tsx` |
| Canonical types | `types/CanonicalAgentConfig.ts`, `CanonicalAgentBoxConfig.ts`, `schemas/*.schema.json` |

---

## References

Detailed scans: `01-repo-map-and-scan-plan.md`, `01-orchestrator-agents-input-coordinator.md`, `02-wr-chat-pipeline-and-sidepanel.md`, `02-ai-agent-form.md`, `03-electron-llm-and-orchestrator-http.md`, `03-agentboxes-and-display-grids.md`, `04-internal-wiring-end-to-end.md`, `05-api-key-management-and-model-provider-wiring.md`, `06-wrchat-pipeline-precheck.md`.

---

*End of follow-up package.*
