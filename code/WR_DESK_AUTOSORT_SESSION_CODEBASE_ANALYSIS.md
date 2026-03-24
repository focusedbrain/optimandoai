# WR Desk™ — AutoSort Session Feature: Codebase Analysis (Answers)

**Generated:** 2026-03-22  
**Repository scope:** `code/` monorepo — primary WR Desk desktop app: `apps/electron-vite-project/`  
**Method:** Static analysis of source + one-time CLI checks on the analysis machine (`ollama list` / `ollama ps`).

This document answers the prompt in **WR Desk — AutoSort Session Feature: Codebase Analysis Prompt**, section by section. Where the codebase is silent, that is called out explicitly.

---

## PART 1: Ollama & Local LLM Integration

### 1.1 — Current Ollama Setup

#### Files to share (locations found)

| Area | Path |
|------|------|
| Ollama manager (HTTP base URL, `listModels`, `pullModel`, `chat`) | `apps/electron-vite-project/electron/main/llm/ollama-manager.ts` |
| Inbox LLM calls (classify, summarize, draft, analyze) | `apps/electron-vite-project/electron/main/email/ipc.ts` |
| Streaming inbox analyze + direct `fetch` to Ollama | `apps/electron-vite-project/electron/main/email/ipc.ts` (`callInboxOllamaChatStream`) |
| Handshake Ollama provider defaults | `apps/electron-vite-project/electron/main/handshake/aiProviders.ts` (`DEFAULT_CHAT_MODEL = 'llama3.1:8b'`) |
| Handshake stream | `apps/electron-vite-project/electron/main/handshake/llmStream.ts` |
| Embeddings via Ollama | `apps/electron-vite-project/electron/main/handshake/embeddings.ts` |
| LLM hardware / suggested models list | `apps/electron-vite-project/electron/main/llm/hardware.ts`, `electron/main/llm/config.ts` |

**Not found in repo:** `.env` / `docker-compose` entries for Ollama — the app uses a **hardcoded** base URL `http://127.0.0.1:11434` (see `ollama-manager.ts` and `ipc.ts`).

#### Questions

1. **Which Ollama models are currently pulled?**  
   On the machine where analysis was run:
   ```
   NAME                       ID              SIZE      MODIFIED
   llama3.1:8b                46e0c10c039e    4.9 GB    12 days ago
   llama3:latest              365c0bd3c000    4.7 GB    12 days ago
   nomic-embed-text:latest    0a109f422b47    274 MB    12 days ago
   ```
   `ollama ps` showed no loaded models at query time (idle).

2. **What is Ollama used for today?**  
   - **Bulk inbox Auto-Sort:** `classifySingleMessage` in `ipc.ts` — JSON classification + DB updates + `ai_analysis_json`.  
   - **Per-message:** Summarize (`inbox:aiSummarize`), Draft (`inbox:aiDraftReply`), Analyze non-streaming (`inbox:aiAnalyzeMessage`), Analyze streaming (`inbox:aiAnalyzeMessageStream`).  
   - **Handshake / hybrid search:** separate paths (`OllamaProvider`, `streamOllamaChat`, RAG chat IPC).  
   - **Embeddings:** `nomic-embed-text` via `/api/embed` in handshake code.

3. **How does the orchestrator call Ollama?**  
   - **Primary inbox path:** `callInboxOllamaChat` uses **`ollamaManager.chat(modelId, messages)`** → HTTP **`POST /api/chat`** with **`stream: false`** (`ollama-manager.ts`, `chat` method).  
   - **Streaming analyze:** `fetch('http://127.0.0.1:11434/api/chat', { stream: true })` in `callInboxOllamaChatStream` (`ipc.ts`).  
   - **No** central job queue for inbox LLM — work is awaited per IPC handler / per renderer batch.

4. **Shared Ollama service module?**  
   - **`OllamaManager`** singleton (`ollama-manager.ts`) is the shared HTTP client for **non-stream** chat used by inbox.  
   - **Streaming** inbox path uses raw `fetch` in `ipc.ts` (duplicated pattern vs `handshake/llmStream.ts`).  
   - Different features do **not** all go through one wrapper; inbox vs handshake have parallel implementations.

5. **Prompt templates for current AI features**  
   - **Auto-Sort / classify:** System prompt = **`getInboxAiRulesForPrompt()`** (content from user-editable `WRExpert.md` in userData, comments stripped) + fixed JSON schema asking for `category`, `urgency`, `needsReply`, `summary`, `reason`, `draftReply`. User prompt: From, Subject, first **500 chars** of body. See `classifySingleMessage` in `ipc.ts`.  
   - **Default rules template:** `DEFAULT_WREXPERT_CONTENT` at top of `ipc.ts` and `electron/WRExpert.default.md`.  
   - **Analyze (bulk):** Large JSON schema (needsReply, summary, urgencyScore, actionItems, archiveRecommendation, draftReply, etc.) in `inbox:aiAnalyzeMessage` / stream.  
   - **Summarize:** Short system prompt: “Summarize… 2-3 sentences…”  
   - **Draft:** System prompt + optional tone/context from DB helpers `getToneAndSortForPrompts` / `getContextBlockForPrompts`.

6. **Structured JSON output via Ollama `format`?**  
   **No.** The code relies on **prompt instructions** (“Respond ONLY with valid JSON”) and **`parseAiJson`** (strip markdown fences, extract `{…}`). There is **no** `format: "json"` (or similar) in the Ollama request bodies in the paths reviewed.

7. **Typical response times for AutoSort?**  
   Not logged as metrics in-repo. Operational bounds: **`INBOX_LLM_TIMEOUT_MS = 45_000`** for classify/analyze streams; `ollamaManager.chat` uses **`AbortSignal.timeout(120000)`** (2 min) at HTTP level. Per-message classify races with 45s timeout in `classifySingleMessage`.

8. **How Ollama runs**  
   `OllamaManager` can **`spawn(ollamaPath, ['serve'])`** if not already running, and resolves binary from: bundled `resources/ollama`, Windows `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, macOS `/usr/local/bin/ollama`, else **`ollama` on PATH**. So: **either** user-installed/service **or** app-spawned **or** bundled copy — depends on packaging/installer.

---

### 1.2 — Available Models

**CLI output (this machine):** see §1.1 Q1 and `ollama ps` (empty when idle).

#### Questions

1. **Which model handles AutoSort today?**  
   **Whichever model is first** in `ollamaManager.listModels()` → `/api/tags` response order. **`callInboxOllamaChat`** sets `const modelId = models[0].name`. There is **no** inbox UI binding to “llama3.1:8b” for Auto-Sort — that default appears in **handshake** (`aiProviders.ts`) and **HybridSearch** fallbacks, not in `callInboxOllamaChat`.

2. **Size variant?**  
   On the dev machine, **llama3.1:8b** is present (~4.9 GB). Actual runtime model depends on tag order, not a hardcoded inbox ID.

3. **Machine spec?**  
   Not in codebase. (Embedding + 8B chat is consistent with typical 16 GB+ RAM / GPU optional.)

4. **Smaller/faster model already pulled?**  
   Only the three models listed in §1.1 on the analysis host; no phi/gemma/qwen in that list.

---

## PART 2: AutoSort Orchestrator

### 2.1 — Core AutoSort Flow

#### Files

| Role | Path |
|------|------|
| Toolbar click, target ID collection, outcome toast | `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` — `handleAiAutoSort`, `runAiCategorizeForIds` |
| IPC classify (single message) | `apps/electron-vite-project/electron/main/email/ipc.ts` — `inbox:aiClassifySingle` → `classifySingleMessage` |
| Batch IPC (legacy/alternate) | Same file — `inbox:aiCategorize` (chunks of 3 × `classifySingleMessage`) — **not** the path used by current bulk toolbar flow |

#### Questions

1. **Entry point when “AI Auto-Sort” is clicked**  
   **`handleAiAutoSort`** in `EmailInboxBulkView.tsx`. It guards concurrent runs (`isSortingRef`, `isSortingActive`), sets progress to “Gathering messages…”, resolves **target IDs** (see below), then **`await runAiCategorizeForIds(targetIds, true, false, { manageConcurrencyLock: false })`**.

2. **Batch loop**  
   - **Renderer:** **`runAiCategorizeForIds`** processes IDs in **chunks of `CONCURRENCY = 5`**, each chunk **`Promise.allSettled`** over **`window.emailInbox.aiClassifySingle(messageId)`** (one IPC per message, five parallel).  
   - **Main process:** **`classifySingleMessage`** does one Ollama round-trip per call.  
   - **Note:** `inbox:aiCategorize` still exists with **parallelism 3** and the same `classifySingleMessage`, but the **bulk UI uses `aiClassifySingle` only**, not `aiCategorize`.

3. **Data available per message at sort time**  
   Main process loads: **`from_address`, `from_name`, `subject`, `body_text`** (body truncated to **500 chars** in the classify user prompt). Not attaching full headers or attachment text in the classify prompt (attachments may exist on row but are not injected into this prompt).

4. **Sort categories / decisions**  
   LLM returns: `pending_delete` | `pending_review` | `archive` | `urgent` | `action_required` | `normal`. These map to **DB `sort_category`** (`spam`, `pending_review`, `newsletter`, `urgent`, `important`, `normal`) and flags (`pending_delete`, `pending_review`, `archived`, urgency threshold **≥7** forces “urgent” behavior).  
   **Recommended action** enum used in UI: `pending_delete`, `pending_review`, `archive`, `keep_for_manual_action`, `draft_reply_ready`.  
   **Tabs** in bulk UI: All, Urgent, Pending Delete, Pending Review, Archived (and related filters) — see toolbar buttons in `EmailInboxBulkView.tsx`.

5. **Where results are stored**  
   - **SQLite:** `inbox_messages` columns — `sort_category`, `sort_reason`, `urgency_score`, `needs_reply`, `pending_delete`, `pending_review_at`, `archived`, **`ai_analysis_json`**.  
   - **Renderer:** `bulkAiOutputs` in **Zustand** (`useEmailInboxStore` / local state in bulk view) for immediate UX; some cleared on moves.

6. **“Session” concept**  
   **No** first-class AutoSort session entity (no `autosort_runs` table). Each message is updated independently; the only “run-level” artifact is **transient UI**: `aiSortOutcomeSummary` string (toast, **auto-dismiss ~16s**) and console logs.

7. **When progress finishes**  
   `handleAiAutoSort` **finally** clears `aiSortProgress`, clears sorting flags, sets **`aiSortOutcomeSummary`** with aggregate line (`Auto-Sort: X moved · …`) and **16s timeout** to clear. No dedicated “100%” bar — see §2.2.

---

### 2.2 — Progress Bar

#### Files

- **UI:** `EmailInboxBulkView.tsx` — `aiSortProgress` state; status dock `bulk-view-sort-progress`.  
- **Styles:** `apps/electron-vite-project/src/App.css` (`.bulk-view-sort-progress`, `.bulk-view-sort-progress-text`).

#### Questions

1. **Framework:** **Electron + Vite + React 18** (`package.json`).

2. **Component:** **Not** a library progress bar — a **text status strip** inside `bulk-view-status-dock`.

3. **State:** React **`useState`** (`aiSortProgress: string | null`). Updates inside **`runAiCategorizeForIds`**: e.g. `` `Analyzing ${doneAfterBatch}/${ids.length}…` ``.

4. **CSS (current)**

```2498:2515:apps/electron-vite-project/src/App.css
.bulk-view-sort-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.2);
  border-radius: 6px;
}

.bulk-view-sort-progress-text {
  text-align: center;
  line-height: 1.35;
}
```

**Note:** A separate **thin indeterminate strip** `bulk-view-refresh-strip` exists for background refresh — not the same as Auto-Sort progress.

---

## PART 3: UI Architecture & Navigation

### 3.1 — Inbox Tab Bar

#### File

`EmailInboxBulkView.tsx` — `bulk-view-toolbar-tabs` with buttons calling **`setFilter({ filter: '…' })`**. Counts: **`tabCounts`** from store (**server COUNT** per tab), display pattern `filter.filter === 'x' ? total : (tabCounts.x ?? 0)`.

#### Questions

1. **Tabs:** **Static JSX** list; **counts** dynamic from **`fetchBulkTabCountsServer`** / store `tabCounts`.

2. **New icon (Session History):** Add a **sibling** control in **`bulk-view-toolbar-row--tabs`** or an extra toolbar row — same pattern as existing buttons.

3. **Icon library:** Bulk toolbar uses **text labels** (“All (n)”, etc.). Elsewhere the app uses **custom CSS** and components; **HybridSearch** has a model dropdown with styled spans — **no** FontAwesome/Lucide import found in the bulk inbox files reviewed.

---

### 3.2 — Modal / Overlay System

- **WR Expert:** Modal defined **inline** in `EmailInboxBulkView.tsx` (comment “WR Expert modal — edit AI inbox rules”) with local open state — **not** a shared generic modal component from a library.  
- **Pattern:** React conditional render + overlay styling (see same file around WR Expert button ~4085+).

**For a Session History feature:** Either reuse this **inline modal pattern** or extract a shared dialog — **no** dedicated global modal system was identified in the files searched.

---

### 3.3 — General UI Stack

| Topic | Answer |
|-------|--------|
| CSS | **Plain CSS** files (`App.css`, component CSS such as `HybridSearch.css`) |
| State | **Zustand** (`useEmailInboxStore`, etc.) + React local state |
| Component library | **No** MUI/Ant/Radix in `electron-vite-project` dependencies — **custom** components |
| Bundler | **Vite 5** |

---

## PART 4: Data & Storage

### 4.1 — Existing Database

#### Files

- Schema / migrations: **`apps/electron-vite-project/electron/main/handshake/db.ts`** (e.g. v29 `CREATE TABLE inbox_messages`, later `ALTER`s for AI columns).  
- Runtime DB access: **`better-sqlite3`** via email IPC and gateway code.

#### Questions

1. **Database:** **SQLite** (via `better-sqlite3`).

2. **ORM:** **No** Prisma/Drizzle — **prepared SQL** in handlers.

3. **Messages table (excerpt)**  
   Key columns: `id`, `source_type`, `account_id`, `email_message_id`, `from_address`, `from_name`, `subject`, `body_text`, `body_html`, `received_at`, `read_status`, `archived`, `deleted`, `sort_category`, `sort_reason`, `urgency_score`, `needs_reply`, `pending_delete`, `pending_review_at`, `ai_summary`, `ai_draft_response`, **`ai_analysis_json`**, `imap_remote_mailbox`, etc. (see `db.ts` and `InboxMessage` in `useEmailInboxStore.ts`).

4. **Runs / jobs / sessions**  
   **Remote orchestrator** queue tables exist for **IMAP sync/moves** — not AutoSort-specific “sessions”. **No** `autosort_session` table.

5. **Typical disk footprint**  
   Not documented in code. SQLite + attachments on disk — **no** metric in repo.

---

### 4.2 — Message Data Access

1. **“All messages sorted in the last run”**  
   There is **no** run ID. Approximations: query messages where **`ai_analysis_json`** is non-null / **`sort_category`** set / **`sort_reason`** updated recently — would require a **new** `sorted_at` or `run_id` column for precise “last run” semantics.

2. **Deep link to a message**  
   Internal identity is **`inbox_messages.id`** (string UUID-style). UI selection uses **`selectMessage(id)`** in store — a session feature could pass **`messageId`** to match existing flows.

3. **Indexed / queryable fields**  
   Indexes include `sort_category`, `received_at`, `pending_delete`, `archived`, etc. (`db.ts`). Search uses **LIKE** on subject/body/from.

---

## PART 5: Existing AI / Analysis Features

### 5.1 — Per-Message AI Actions

#### Files

- IPC: `ipc.ts` — `inbox:aiSummarize`, `inbox:aiDraftReply`, `inbox:aiAnalyzeMessage`, `inbox:aiAnalyzeMessageStream`.  
- Preload: `preload.ts` exposes `aiSummarize`, `aiDraftReply`, `aiAnalyzeMessage`, stream listeners.  
- UI: **`BulkActionCardStructured`** and handlers in `EmailInboxBulkView.tsx` (`handleSummarize`, `handleDraftReply`, `handleBulkAnalyze` / streaming).

#### Questions

1. **Ollama for Analyze / Summarize / Draft?** **Yes** — all use **`callInboxOllamaChat`** or **`callInboxOllamaChatStream`** (same model selection rule: **first model in list**).

2. **Model:** **First model** returned by Ollama `/api/tags` — **not** the HybridSearch dropdown selection.

3. **Shared infrastructure**  
   - **Prompt:** Tone/sort/context from DB (`getToneAndSortForPrompts`, `getContextBlockForPrompts`) for draft/analyze.  
   - **Parsing:** **`parseAiJson`** for JSON features.  
   - **Coherence:** **`reconcileInboxClassification`** / **`reconcileAnalyzeTriage`** (`src/lib/inboxClassificationReconcile.ts`).

4. **WR Expert**  
   Opens rules editor; content persists to **`WRExpert.md`** in **Electron `userData`**. **`getInboxAiRulesForPrompt()`** strips `#` comments and injects rules into **classify** (Auto-Sort). Button label **“WR Expert”** in bulk toolbar.

---

### 5.2 — The llama3.1:8b Badge

1. **User switch models?**  
   **HybridSearch** (`HybridSearch.tsx`) has **`selectedModel`** and **`availableModels`** — **RAG/chat** path. **Inbox Auto-Sort / classify / summarize / draft** use **`models[0]`** from Ollama — **no** linkage to that dropdown.

2. **Dynamic model to Ollama for inbox?**  
   **No** — inbox uses **first tag** from `listModels()`.

3. **Session summary feature**  
   Could **reuse HybridSearch model selection** only if new code wires a **chosen model id** into `callInboxOllamaChat` / `ollamaManager.chat` — **today** inbox does not.

---

## PART 6: Rendering & Infographic Generation

### 6.1 — Current Rendering Capabilities

| Package | In `electron-vite-project` `package.json`? |
|---------|---------------------------------------------|
| **satori** | **No** |
| **sharp** | **No** |
| **canvas** | **Yes** — `"canvas": "3.2.0"` (native; used in postinstall rebuild) |
| **dexie** | **No** |

**Reports / export:** No “infographic” pipeline found. **PDF:** `pdfjs-dist` present. **`capturePage`:** not found in quick grep.

---

### 6.2 — Electron-Specific

1. **Electron version:** **`^30.5.1`** (`package.json`).

2. **IPC for heavy tasks:** Email/AI run in **main process** via **`ipcMain.handle`**; renderer calls **`ipcRenderer.invoke`**.

3. **Infographic as HTML view:** **Feasible** — no technical blocker; would be a new **React route or modal** rendering HTML/CSS.

4. **Secondary windows:** Not fully audited; standard Electron patterns exist in `main.ts` (large file) — **new BrowserWindow** for session UI is viable.

---

## PART 7: Package & License Audit

### Commands (Windows PowerShell)

From `apps/electron-vite-project`:

```
npm list ollama satori @resvg/resvg-js dexie sharp better-sqlite3 node-llama-cpp
```

**Observed:** Only **`better-sqlite3@11.10.0`** appeared in the tree; **`ollama` npm package is not a dependency** — the app uses **native `fetch`** to the local Ollama HTTP API.

**Top-level dependencies excerpt** (`electron-vite-project/package.json`): React 18, Vite 5, Electron 30, **zustand**, **better-sqlite3**, **canvas**, **mailparser**, **imap**, **tesseract.js**, **zod**, etc.

---

## PART 8: Constraints & Preferences

| # | Question | Answer (codebase vs product) |
|---|----------|-------------------------------|
| 1 | Deployment / installer / updates | **electron-builder** builds artifacts; output dir configured in `electron-builder.config.cjs` (e.g. Windows `C:\build-output\build1003`). **Auto-update policy** not defined in files reviewed. |
| 2 | Platforms | **Builder config** references Windows + Linux/macOS paths — **not** Windows-only in tooling. |
| 3 | Minimum spec | **Not** codified. |
| 4 | Offline / Ollama | App checks **`isOllamaAvailable()`** (models list non-empty). If unavailable, classify returns **error-shaped** classifications; user sees failure states. **No** cloud fallback in these handlers. |
| 5 | Session volume (runs/day) | **Product** — unknown. |
| 6 | Batch size | **Unbounded** in principle: “All” mode drains **all IDs matching current filter** via paginated `listMessageIds`. **500+** possible. Chunk processing is **5 parallel** IPC calls. |
| 7 | Infographic: HTML vs PNG | **Not** specified in code — **HTML view** is lower friction given no Satori/sharp pipeline today. |
| 8 | Summary data after run | **Per-message** `ai_analysis_json` and sort columns **persist**. **Run-level** summary toast **expires** (~16s). **No** aggregate session record. |
| 9 | Multi-account Auto-Sort | **Inbox list filters do not include `account_id`** — “All” tab + `fetchMatchingIdsForCurrentFilter` pulls IDs across **all accounts** for that tab’s SQL. **Per-account** narrowing would need a **new filter** or account scoping in `listMessageIds`. |
| 10 | Localization | **Prompts and UI strings are English** in source; no i18n framework observed in inbox paths. |

---

## Summary Table: Reuse vs Build (for AutoSort Session feature)

| Item | Status |
|------|--------|
| Ollama HTTP + timeouts | **Reuse** `ollamaManager` / patterns in `ipc.ts` |
| Session storage | **Build** — new table or fields |
| Run-level summary LLM call | **Build** — new prompt; consider **fixing model selection** (today: first model only) |
| Progress UI | **Extend** — current control is **text**, not a true % bar |
| Infographic | **Build** — or **HTML panel** without new image deps |
| WR Expert rules | **Reuse** — same `WRExpert.md` pipeline for tone/rules if desired |

---

## File index (quick)

- `electron/main/email/ipc.ts` — inbox AI + `classifySingleMessage`, `aiCategorize`, list WHERE clause  
- `electron/main/llm/ollama-manager.ts` — Ollama lifecycle + `/api/chat`  
- `src/components/EmailInboxBulkView.tsx` — Auto-Sort UX, tabs, WR Expert modal  
- `src/stores/useEmailInboxStore.ts` — Zustand, `fetchMatchingIdsForCurrentFilter`  
- `electron/main/handshake/db.ts` — SQLite schema  
- `src/lib/inboxClassificationReconcile.ts` — post-LLM coherence  

---

*End of analysis.*
