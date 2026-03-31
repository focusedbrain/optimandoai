# Bulk Auto-Sort performance regression — consolidated engineering analysis

This document merges the former split reports (`00`–`09`) into one file for review. Analysis is **static / code-traced** unless noted; no runtime profiling was performed as part of writing this.

**Table of contents**

1. [Executive summary](#1-executive-summary)
2. [System architecture overview](#2-system-architecture-overview)
3. [Auto-sort pipeline analysis (end-to-end)](#3-auto-sort-pipeline-analysis-end-to-end)
4. [LLM runtime and model resolution](#4-llm-runtime-and-model-resolution)
5. [Renderer and state update analysis](#5-renderer-and-state-update-analysis)
6. [IPC, DB, and main-process analysis](#6-ipc-db-and-main-process-analysis)
7. [Background contention analysis](#7-background-contention-analysis)
8. [Regression hypotheses and root-cause ranking](#8-regression-hypotheses-and-root-cause-ranking)
9. [Recommended fix sequence (plan only)](#9-recommended-fix-sequence-plan-only--no-implementation)
10. [Open questions and required instrumentation](#10-open-questions-and-required-instrumentation)

---

## 1. Executive summary

### Purpose

This note summarizes the **most likely causes** of bulk Auto-Sort becoming much slower after recent refactors, based on **static tracing of the current codebase** (not runtime profiling).

### Top findings (ranked by likely impact)

| Rank | Finding | Confidence | Why it hurts |
|------|---------|------------|--------------|
| 1 | **Per-message tab-count refresh in bulk mode** | **High (code-proven)** | Each classified message triggers `fetchBulkTabCountsServer`, which runs **five sequential `listMessages` IPC calls** (one per workflow tab). For chunk size *C*, that is **5×C extra IPC round-trips per batch chunk**, plus **C async completions** each calling `set({ tabCounts, total })` → renderer churn. |
| 2 | **Main-process LLM concurrency = chunk width** | **High (code-proven)** | `inbox:aiClassifyBatch` runs `Promise.all` over `classifySingleMessage` for every ID in the chunk. With local Ollama, **many parallel `generateChat` calls** often queue behind a **single inference worker**, increasing wall time and tail latency vs a small capped pipeline. |
| 3 | **Per-message main-process work under parallelism** | **Medium–high** | Each classify still does **DB read**, **LLM call**, **multiple `UPDATE`s**, **`enqueueRemoteOpsForLocalLifecycleState`**, and logging. Running *N* of these concurrently increases **SQLite lock / orchestrator queue** contention versus serial or low-fixed concurrency. |
| 4 | **Post-run `refreshMessages` in bulk mode** | **Medium** | Resolves to `fetchAllMessages({ soft: true })` → `loadBulkInboxSnapshotPaginated` → again **`fetchBulkTabCountsServer` (5 IPC) + `listMessages`**. Correctness-friendly but expensive at end of a long run. |
| 5 | **Follow-on remote sync IPC (two calls)** | **Medium** | After a run, renderer fires `enqueueRemoteSync` / `enqueueRemoteLifecycleMirror` **and** `fullRemoteSyncForMessages` over **all** classified IDs — extra main-process work overlapping the tail of sorting. |
| 6 | **“Missed ID” completeness retry** | **Lower (conditional)** | Second pass only when IDs lack terminal outcome; when triggered, **duplicates** another chunk loop (same architecture, multiplies cost). |

### Conclusion (why it feels ~10× slower)

The regression is **unlikely to be “the model got 10× slower” alone**. The architecture now combines:

1. **Batch IPC** (good — one round-trip per chunk for classify), **with**
2. **Renderer-side per-message store updates** that each kick off **five IPC tab-count queries** in bulk mode (very bad — multiplies load sharply with chunk size),

3. **Main-process unbounded-with-chunk LLM parallelism** that can **serialize or thrash** on Ollama/SQLite anyway.

Together, those explain **large multiplicative slowdown** that scales with **user “sort concurrency” / chunk size** and inbox size.

### What is *not* the primary story (from code)

- **Background preload queue**: `BACKGROUND_PRELOAD_ANALYSIS_ENABLED = false` in `useInboxPreloadQueue.ts` — continuous idle analysis is off; `triggerAnalysisRestart` is mostly inert for preload when that flag is false.
- **Per-chunk `preResolveInboxLlm`**: Intentionally **once per chunk** in `inbox:aiClassifyBatch` — this is an **optimization vs per-message** resolution, not a regression source.

### Recommended first validation

Before changing code, add **short-lived timings** (or enable existing `DEBUG_AUTOSORT_DIAGNOSTICS` flags) to measure:

- Time in **renderer** inside the per-result loop vs **await aiClassifyBatch**
- Count of **`listMessages` IPC** during one Auto-Sort run (expect explosion if hypothesis 1 holds)
- Ollama queue depth / concurrent requests during a run

See [§10 Open questions and required instrumentation](#10-open-questions-and-required-instrumentation).

---

## 2. System architecture overview

### Scope

Components that participate in **bulk inbox Auto-Sort** (toolbar) and adjacent flows.

### High-level map

```mermaid
flowchart TB
  subgraph renderer [Renderer - React]
    BulkView[EmailInboxBulkView]
    Store[useEmailInboxStore Zustand]
    Preload[useInboxPreloadQueue - mostly disabled]
  end
  subgraph preload [Preload]
    Bridge[window.emailInbox bridge]
  end
  subgraph main [Electron main]
    IPC[inbox:aiClassifyBatch handler]
    Classify[classifySingleMessage]
    LLM[inboxLlmChat / aiProviders]
    DB[(SQLite inbox DB)]
    RemoteQ[inboxOrchestratorRemoteQueue]
  end
  subgraph external [External]
    Ollama[Ollama HTTP]
    Cloud[Cloud LLM APIs]
  end
  BulkView -->|aiClassifyBatch(ids, sessionId, runId)| Bridge
  Bridge -->|ipcRenderer.invoke| IPC
  IPC --> Classify
  Classify --> DB
  Classify --> LLM
  LLM --> Ollama
  LLM --> Cloud
  Classify --> RemoteQ
  Classify -->|results| IPC
  IPC --> Bridge
  Bridge --> BulkView
  BulkView --> Store
  Store -->|commitClassifyMainResultToLocalState| Store
```

### Renderer

| Piece | Role |
|-------|------|
| `EmailInboxBulkView.tsx` | User clicks Auto-Sort; builds target IDs; calls `runAiCategorizeForIds` → chunked `aiClassifyBatch`; merges results into `bulkAiOutputs`; optional pause/stop; post-run `refreshMessages`. |
| `useEmailInboxStore.ts` | Holds messages, filters, tab counts, bulk AI outputs. **`applyClassifyMainResultToLocalState` → `commitClassifyMainResultToLocalState`** updates rows and, in **`bulkMode`**, kicks off **`fetchBulkTabCountsServer`**. |
| `useInboxPreloadQueue.ts` | Normal-inbox background analysis; **disabled** (`BACKGROUND_PRELOAD_ANALYSIS_ENABLED = false`). |

### Preload

| API | IPC channel |
|-----|-------------|
| `aiClassifyBatch(ids, sessionId?, runId?)` | `inbox:aiClassifyBatch` |
| `autosortDiagSync({ runId, bulkSortActive })` | `inbox:autosortDiagSync` |
| `enqueueRemoteSync` / `fullRemoteSyncForMessages` | Various inbox remote queue IPCs (see `handshakeViewTypes.ts` / `preload.ts`) |

### Electron main

| Piece | File | Role |
|-------|------|------|
| Batch handler | `electron/main/email/ipc.ts` — `ipcMain.handle('inbox:aiClassifyBatch', …)` | `resolveDbCore`, `preResolveInboxLlm()`, `Promise.all(classifySingleMessage(…))`, `scheduleOrchestratorRemoteDrain`. |
| Single classify | `ipc.ts` — `classifySingleMessage` | Load row, optional session stamp, build prompts, **`inboxLlmChat`**, parse JSON, **`reconcileInboxClassification`**, attachment guard, **SQL `UPDATE`s**, **`enqueueRemoteOpsForLocalLifecycleState`**. |
| LLM stack | `electron/main/email/inboxLlmChat.ts` | `preResolveInboxLlm`, `inboxLlmChat` with **45s default timeout**, `AbortController`, `provider.generateChat` non-streaming. |
| Remote mirror | `electron/main/email/inboxOrchestratorRemoteQueue.ts` | `enqueueRemoteOpsForLocalLifecycleState` per message (from classify). |
| Autosort diagnostics | `electron/main/autosortDiagnostics.ts` | Tracks bulk run id for logs; vault lock recency for error classification. |

### Data stores

- **SQLite** (inbox): authoritative for `sort_category`, flags, `ai_analysis_json`, etc. **Updated in main** during classify.
- **Zustand**: mirror of list UI + derived tab counts. **Updated from renderer** after each batch result (and heavily via `fetchBulkTabCountsServer` in bulk mode).

### Extension

Bulk Auto-Sort as described here is **Electron renderer + main**; the Chromium extension is **out of the hot path** for this pipeline unless shared resources (Ollama, GPU) are contended at the OS level (hypothesis, not code-proven here).

### Design tension (current)

- **Goal of batch IPC**: fewer process hops and **one** LLM model resolution per chunk (`ipc.ts` comments near `inbox:aiClassifyBatch`).
- **Coupled renderer behavior**: per-message **local** state sync triggers **heavy tab recount** work in bulk mode — **not** reduced by batch IPC.

This tension is the architectural root of a large class of regressions: **main path got more efficient; renderer/store path got proportionally more expensive.**

---

## 3. Auto-sort pipeline analysis (end-to-end)

### Entry: toolbar Auto-Sort

**File:** `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx`  
**Function:** `handleAiAutoSort` (search for `const handleAiAutoSort`)

#### Steps (evidence-based)

1. **Session (optional)** — `window.autosortSession?.create()` if present.
2. **Target ID collection** — If `bulkBatchSize === 'all'`: `useEmailInboxStore.getState().fetchAllMessages({ soft: true })` and `fetchMatchingIdsForCurrentFilter()` (paginated `listMessageIds` until exhausted). Else: unique IDs from `multiSelectIds`.
3. **Progress UI** — `setAiSortProgress({ phase: 'sorting', … })`.
4. **Core pipeline** — `runAiCategorizeForIds(targetIds, true, false, { manageConcurrencyLock: false }, sessionId)` from Auto-Sort (`manageConcurrencyLock: false` because outer handler manages sorting state — see call site).
5. **Post-run** (inside `handleAiAutoSort`, after aggregate returns) — Summaries, banners, optional `refreshMessages`, session finalize (see same file after `sortAgg`).

### Core loop: `runAiCategorizeForIds`

**File:** `EmailInboxBulkView.tsx` (large `useCallback`).

#### Guard / setup

- Requires `window.emailInbox.aiClassifyBatch`; otherwise early-return empty aggregate.
- Sets `useEmailInboxStore.setSortingActive(true)` and progress unless suppressed.
- Generates `sortRunId`, optional `autosortDiagSync({ runId, bulkSortActive: true })`.

#### Chunking

- **While** index `< ids.length`: stop/pause boundaries: busy-wait **200ms** when paused (`setTimeout` loop).
- `chunkSize = max(1, sortConcurrencyRef.current)` — user slider **1–8** persisted under `wrdesk_sortConcurrency` (`SORT_CONCURRENCY_STORAGE_KEY`).
- `batch = ids.slice(_i, _i + chunkSize)`.

#### Single IPC per chunk

- `await window.emailInbox.aiClassifyBatch(batch, sessionId, sortRunId)`.

#### Result handling (renderer)

For **each** `result` in `batchResults`:

1. **Failures:** push `failedIds`, build `batchUiUpdates[messageId]` with failure copy.
2. **Success:** **`useEmailInboxStore.getState().applyClassifyMainResultToLocalState({…})`** — **critical**; see [§5 Renderer and state update analysis](#5-renderer-and-state-update-analysis). Derive `BulkAiResult` fields, possibly `addRemoteSyncLog`. Branch on urgent / pending_delete / pending_review / archive / draft_reply / retained.
3. **After loop:** **One** `setBulkAiOutputs(prev => ({...prev, ...batchUiUpdates}))`. **`await sortFeedbackPaintDwell()`** — ~2 rAF + **72ms** timer (`SORT_LIVE_FEEDBACK_DWELL_MS`). Update `setAiSortProgress` with cumulative stats string.

#### Completeness retry

- Computes `missedIdsPass1 = ids` not in `processedIds` or `failedIds`. If non-empty and not already retry and not stopped: **recursive** `runAiCategorizeForIds(toRetry, false, true, { manageConcurrencyLock: false, sortRunId, diagAcc })`. Comment says older behavior re-ran LLM for explicit failures; now only “missed” — still doubles work when misses happen.

#### Remote mirror (async, non-blocking)

- Fire-and-forget IIFE: `enqueueRemoteSync` or `enqueueRemoteLifecycleMirror` on **all** `classifiedIdsForRemote`, then **`fullRemoteSyncForMessages`** — second IPC path.

#### `refreshMessages`

- Unless `skipEndRefresh`: **`await refreshMessages()`** — in bulk mode this is **`fetchAllMessages({ soft: true })`** (see store).

### Main process: `inbox:aiClassifyBatch`

**File:** `apps/electron-vite-project/electron/main/email/ipc.ts`

1. Early out if no DB → `batchError` + per-id errors.
2. **`preResolveInboxLlm()`** once.
3. **`Promise.all(ids.map(id => classifySingleMessage(id, sessionId, { resolvedLlm, batchIndex, runId })))`**.
4. **`scheduleOrchestratorRemoteDrain(resolveDb)`** after batch.
5. Return `{ results }`.

### `classifySingleMessage` (per message)

Same file: for each message:

- `resolveDbWithDiag` (wrapper over `getDb`; logs if autosort diagnostics on).
- `SELECT` body metadata.
- Optional `UPDATE inbox_messages SET last_autosort_session_id`.
- If no `resolvedLlm`: `isLlmAvailable()` (skipped in batch path — **good**).
- Build prompts: `getInboxAiRulesForPrompt()` (cached file mtime in `getInboxAiRules`).
- **`inboxLlmChat`** — **45s** timeout default (`INBOX_LLM_TIMEOUT_MS` in `inboxLlmChat.ts`).
- Parse + **`reconcileInboxClassification`** + attachment guard.
- **Multiple SQL updates** on `inbox_messages`.
- **`enqueueRemoteOpsForLocalLifecycleState(db, [messageId])`**.
- Return payload including `pending_*_at`, `archived`, `remoteEnqueue`.

### Where time is spent (qualitative)

| Phase | Dominant cost driver |
|-------|----------------------|
| IPC batch wait | **Sum of slowest parallel LLMs** in chunk + DB + enqueue for all messages in chunk |
| Renderer loop | **Per-message `applyClassifyMainResultToLocalState`** → tab count IPC storm in bulk mode |
| Post-run | Full bulk snapshot refresh + optional remote reconcile IPC |

### Inefficiency introduced by refactor pattern (inference, code-structured)

Comments in `ipc.ts` (~4084–4091) describe the **batch** handler as replacing **N× `aiClassifySingle`** for **IPC efficiency** and **single LLM resolve per chunk**. That is internally consistent.

The **renderer** comment (~2626–2629 in `EmailInboxBulkView.tsx`) says results come back together so the renderer can apply **one React state update per batch** for **`bulkAiOutputs`**, which is true for **`setBulkAiOutputs`**.

However, **`applyClassifyMainResultToLocalState` is still invoked once per message inside the same loop**, and **that path** triggers **`fetchBulkTabCountsServer`** when `bulkMode` is true — **not** batched. That breaks the “one update per batch” story for **store-driven side effects**.

**Confidence:** **High** — direct read of `commitClassifyMainResultToLocalState` in `useEmailInboxStore.ts` (lines ~617–665).

### Coupling of “analyze” vs “sort”

- **Analyze-only** bulk path: `handleBulkAnalyzeOne` uses stream / one-shot IPC; **does not** write sort columns (documented in component).
- **Auto-Sort**: classify in main **writes DB** and returns classification; renderer **mirrors** into Zustand for UX.

Coupling is **intentional**; inefficiency is in **how often** the mirror triggers **global recounts**.

---

## 4. LLM runtime and model resolution

### Model resolution path

#### Single pre-resolve per batch chunk

**File:** `apps/electron-vite-project/electron/main/email/inboxLlmChat.ts`  
**Function:** `preResolveInboxLlm()`

- Reads **backend preference** via `resolveInboxLlmSettings()` (`ocrRouter.getCloudConfig()`, local vs cloud).
- **Ollama:** `ollamaManager.getEffectiveChatModelName()`.
- **Cloud:** require vision provider + API key; uses `settings.model` when set.

**Batch caller:** `ipc.ts` → `inbox:aiClassifyBatch` assigns `resolvedLlm` **once**, then passes `resolvedLlm` into every `classifySingleMessage`.

**Batch vs single-message:** If `resolvedLlm` is present, **`classifySingleMessage` skips `isLlmAvailable()`** (`ipc.ts` ~3939–3943). **`inboxLlmChat` skips redundant model list** when `resolvedContext` is passed (~185–188).

**Conclusion:** Model resolution is **not** likely the dominant regression vs an older “N IPC × resolve” design **for Auto-Sort**; batching explicitly optimizes this.

### Runtime chat

**Function:** `inboxLlmChat(params)`

- **`timeoutMs` default:** `INBOX_LLM_TIMEOUT_MS = 45_000` (45s).
- Uses **`AbortController`**; on timeout, throws `InboxLlmTimeoutError` → classify maps to **`error: 'timeout'`**.
- **`stream: false`** in `provider.generateChat`.

#### Implication for bulk

Each message in a chunk still pays **full sequential model latency** from the model’s perspective; **`Promise.all`** only helps if the backend **actually parallelizes**. Ollama commonly **queues** concurrent requests to one or few GPU workers — **wall time can approach sum-of-queue** rather than `max(individual)`.

**Confidence (behavioral):** **Medium** — depends on installed Ollama version, GPU, model size; **architecture** `Promise.all` makes worst-case contention **explicit**.

### Concurrency knob (renderer)

**File:** `EmailInboxBulkView.tsx` — `sortConcurrency` state, persisted `wrdesk_sortConcurrency`, **ref** `sortConcurrencyRef` read at **each chunk boundary**. Default load path uses `localStorage` (fallback **3** in initial state read ~1890).

**Effect:** Chunk width equals number of **parallel** `classifySingleMessage` / `inboxLlmChat` calls per batch.

**Hypothesis:** Increasing default or UX exposure of concurrency from an older **fixed small** value (e.g. `inbox:aiCategorize` uses **`CONCURRENCY = 3`** — see `ipc.ts` ~4185) to **up to 8** could **worsen** Ollama queueing while **increasing** IPC/renderer side work (see [§5](#5-renderer-and-state-update-analysis)).

**Note:** `inbox:aiCategorize` is a **different** IPC (legacy/tooling) but shows historical **main-process** preference for **3-wide** parallelism.

### Cancellation / stop

- Renderer: `sortStopRequestedRef` checked **between chunks**, not mid-IPC.
- A running `aiClassifyBatch` **cannot be aborted** from the button until the main invoke returns (no `AbortSignal` plumbed through IPC for batch).
- Individual LLM timeout still applies per message (**45s**).

**Inefficiency:** Stop is **chunk-boundary**-best-effort; long single chunk can still burn work.

### Chunking of email body

**File:** `ipc.ts` — user prompt uses **`body_text` first 500 chars** (`slice(0, 500)`).

Reduces tokens vs full-body classify; **not** obviously slower than a prior version without reading git history.

### Summary table

| Topic | Regression risk | Evidence |
|-------|-----------------|----------|
| `preResolve` per chunk | Low for Auto-Sort | Explicit in `inbox:aiClassifyBatch` |
| Parallel LLM per chunk | **High** if Ollama serializes | `Promise.all` + user concurrency |
| 45s timeout | Medium — tail latency | `INBOX_LLM_TIMEOUT_MS` |
| Model “heavier” than before | **Unproven without metrics** | Need wall-time A/B same commit |

---

## 5. Renderer and state update analysis

### Intended batching (bulk AI card state)

**File:** `EmailInboxBulkView.tsx` — inside `runAiCategorizeForIds`

- Builds `batchUiUpdates: AiOutputs` for all messages in chunk.
- Applies **`setBulkAiOutputs((prev) => ({ ...prev, ...batchUiUpdates }))` once** per chunk.
- **`sortFeedbackPaintDwell()`** after: two `requestAnimationFrame` + **72ms** `setTimeout` (`SORT_LIVE_FEEDBACK_DWELL_MS`).

**Verdict:** Card merge **is** batched as claimed in comments.

### Unintended per-message store work (critical)

**Same loop** also calls, for **each successful** classify result:

```ts
inboxStore.applyClassifyMainResultToLocalState({ messageId, category, ... })
```

**Implementation:** `useEmailInboxStore.ts` → `commitClassifyMainResultToLocalState`

#### What happens in `bulkMode`

Inside the `set((s) => { ... })` updater, when `s.bulkMode` is true:

1. **Maps** messages to apply classify columns.
2. **Filters** by `filterByInboxFilter` (row may disappear from current tab).
3. **`void fetchBulkTabCountsServer(s.filter).then((tc) => { set({ tabCounts: tc, total: tc[fk] ?? 0 }) })`** — **fired once per message**.

#### What `fetchBulkTabCountsServer` does

**File:** `useEmailInboxStore.ts` ~704–725

- Loops **five** tab keys: `'all' | 'urgent' | 'pending_delete' | 'pending_review' | 'archived'`.
- For **each**, awaits `bridge.listMessages({ ...filter, limit: 1, offset: 0 })` and reads `data.total` (COUNT semantics).

**Cost per classified message in bulk mode:** **5 sequential IPC `listMessages` calls** + **1 extra `set()`** when the promise resolves.

**For chunk size C:** **5×C `listMessages`** **per chunk**, *in addition to* the single `aiClassifyBatch` IPC.

#### React render implications

- Zustand `set` from the **synchronous** updater runs in one turn; React 18 may batch **some** updates.
- **Each** `fetchBulkTabCountsServer` completion triggers an **async** `set({ tabCounts, total })` → **up to C extra renders per chunk** from tab count alone.

**Confidence:** **High** — direct code.

### Progress indicator updates

**File:** `EmailInboxBulkView.tsx` — after each chunk: `setAiSortProgress` with string built from **runDiag** counters. Frequency: **once per chunk**, not per message — **reasonable**.

### Pause busy-loop

While paused: **200ms** `setTimeout` loop updates label via `setAiSortProgress`. Low CPU but **does** schedule periodic state updates while paused.

### `triggerAnalysisRestart` (finally block)

**File:** `EmailInboxBulkView.tsx` — `finally` of `runAiCategorizeForIds` calls `useEmailInboxStore.getState().triggerAnalysisRestart()`. **Store:** increments `analysisRestartCounter`. **Consumer:** `useInboxPreloadQueue.ts` — **all effects early-return** when `BACKGROUND_PRELOAD_ANALYSIS_ENABLED === false`.

**Verdict:** **Likely negligible** for bulk slowdown today unless the flag is flipped to `true` in a branch.

### Post-run `refreshMessages`

**Store:** `refreshMessages` → **`fetchAllMessages({ soft: true })`** in bulk mode. **`loadBulkInboxSnapshotPaginated`:** calls **`fetchBulkTabCountsServer`** again (**5 IPC**) + **paged `listMessages`** for first page.

**Verdict:** One **heavy** refresh at end; amortized over full run but still **O(API tab count + list)**.

### Renderer-side inefficiency summary

| Pattern | Batch-friendly? | Notes |
|---------|-----------------|-------|
| `setBulkAiOutputs` per chunk | Yes | Single merge object |
| `applyClassifyMainResultToLocalState` per message | **No** | Triggers **5× listMessages** per call in bulk |
| `sortFeedbackPaintDwell` | Neutral | ~72ms / chunk |
| `refreshMessages` after run | Expensive | Full bulk snapshot + tab counts |

**Primary renderer-side regression hypothesis:** **`commitClassifyMainResultToLocalState` + `fetchBulkTabCountsServer` per message** overwhelms wins from batched `aiClassifyBatch`.

---

## 6. IPC, DB, and main-process analysis

### IPC round-trips — nominal “happy path” per chunk

#### Classify (renderer → main)

| Call | Count per chunk | Notes |
|------|-----------------|-------|
| `inbox:aiClassifyBatch` | **1** | Carries `ids.length = chunkSize` |

Inside main for that single invoke: **`classifySingleMessage` × chunkSize** (in-process, **not** separate IPC).

#### Hidden IPC from renderer during result loop (bulk mode)

| Call | Count per **classified** message | Source |
|------|----------------------------------|--------|
| `listMessages` (tab total) | **5** | `fetchBulkTabCountsServer` via `commitClassifyMainResultToLocalState` |

**Effective IPC multiplier (bulk):** roughly **1 + 5×C** **`listMessages`-family calls per chunk** (plus `aiClassifyBatch` = +1 invoke) → **dominated by tab counts** when C ≥ 2.

**Confidence:** **High**.

### Main-process DB access per message (`classifySingleMessage`)

**File:** `ipc.ts`

| Operation | Count/message (typical success) |
|-----------|--------------------------------|
| `resolveDbWithDiag` | 1 await of `getDb` |
| `SELECT` inbox row | 1 |
| `UPDATE last_autosort_session_id` | 0–1 (if `sessionId`) |
| `UPDATE` lifecycle / sort columns | 1 (one of several prepared variants) |
| `UPDATE ai_analysis_json` | 1 |
| **`enqueueRemoteOpsForLocalLifecycleState(db, [messageId])`** | 1 (**plus** internal selects / queue writes) |

#### Parallelism

Batch uses **`Promise.all`** over messages → **interleaved** DB work in the same process.

**SQLite:** single-writer semantics — concurrent writes **serialize** or contend; can **inflate** wall time vs sequential small transactions.

**Confidence (contention):** **Medium** — SQLite behavior depends on WAL / busy timeout config (not traced here).

### `scheduleOrchestratorRemoteDrain`

Called **once** after each **`aiClassifyBatch`** completes (`ipc.ts` ~4122–4124). **Effect:** Schedules **background** remote queue processing — can add **CPU/IO** load **overlapping** next chunk’s LLM/DB work. **Impact:** **Medium** — depends on queue depth and IMAP/M365 latency.

### `inbox:aiCategorize` (related, different UX)

**File:** `ipc.ts` ~4149+ — uses **`CONCURRENCY = 3`** outer loop with **`preResolveInboxLlm` once** per **categorize call**, then **`Promise.all` on slices of 3**.

Shows an alternate **main-side** throttling strategy **smaller than** user-chosen **bulk chunk up to 8**. **Inference:** Bulk Auto-Sort may be **more aggressive** than this legacy categorization path.

### Redundant phase-2?

- Renderer **also** calls `enqueueRemoteSync` / `fullRemoteSyncForMessages` after run (`EmailInboxBulkView.tsx`).
- Main **already** enqueues per message in `classifySingleMessage` via `enqueueRemoteOpsForLocalLifecycleState`.

**Hypothesis:** Some **duplicate reconciliation** possible (second pass enqueues **skipped** rows efficiently — **not proven** without reading enqueue idempotency). **Impact:** **Low–medium** dependent on skip rate.

### Serial bottlenecks introduced by refactors

| Potential bottleneck | Mechanism |
|---------------------|-----------|
| Single `ipcRenderer.invoke` waits for **whole** batch | Tail latency = slowest message in chunk + DB + enqueue |
| Many renderer→main `listMessages` | **Main thread / handler queue** saturation |
| Tab count pattern | **5× sequential** awaits in `fetchBulkTabCountsServer` **per trigger** |

### Summary

- **Batch classify IPC** is efficient.
- **`fetchBulkTabCountsServer` from renderer** is **anti-efficient** at per-message frequency — likely the **IPC regression** users feel as “10×”.

---

## 7. Background contention analysis

### Flows evaluated

#### 1. `aiAnalyzeMessageStream` (manual analyze)

**File:** `ipc.ts` — `ipcMain.handle('inbox:aiAnalyzeMessageStream', …)` — manages `activeAiAnalyzeMessageStreams` map; streams chunks to renderer.

**Vs bulk Auto-Sort:** Different IPC path. **Contention** arises only if same **Ollama/GPU** saturates or **main event loop** is busy with classify + stream concurrently. **Confidence:** **Medium**.

#### 2. IMAP brute-force auto-sync interval

**File:** `ipc.ts` — `ensureImapBruteForceAutoSyncIntervalRegistered` (~1525 region). Periodic `syncAccountEmails` / pull. **Risk:** Overlaps long Auto-Sort → extra DB + network. **Impact:** **Medium** when IMAP accounts active.

#### 3. `scheduleOrchestratorRemoteDrain`

Triggered after **each** batch classify. **Risk:** Remote work **during** classify burst. **Medium**.

#### 4. Extension traffic

Bulk Auto-Sort is **Electron inbox**; extension **not** in direct IPC path for `aiClassifyBatch`. **Exception:** Shared **Ollama** if extension also drives local LLM (out of repo scope).

#### 5. Vault / session

**File:** `autosortDiagnostics.ts` — vault lock recency for error classification. If vault locks mid-run, batch returns errors — **failure** path, not steady-state slowdown.

#### 6. Preload queue (`useInboxPreloadQueue`)

**`BACKGROUND_PRELOAD_ANALYSIS_ENABLED = false`** — idle continuous streaming **off**. **Verdict:** **Unlikely** contributor **in current code**.

### autosortDiagSync

**IPC:** `inbox:autosortDiagSync` → in-memory struct. **Cost:** **Negligible**.

### Ranking (background vs primary)

For “steady bulk Auto-Sort got slower” reports:

1. **Primary:** Renderer **tab recount** IPC + main **parallel classify** (see §5–6).
2. **Secondary:** `scheduleOrchestratorRemoteDrain` + IMAP interval + optional manual **stream analyze** overlap.
3. **Tertiary:** Extension / OS-level GPU.

---

## 8. Regression hypotheses and root-cause ranking

Legend: **Confirmed** = directly from reading source. **Inference** = plausible from architecture; needs timings.

### Ranked list

#### 1. Per-message `fetchBulkTabCountsServer` in bulk classify loop

| Field | Detail |
|-------|--------|
| **Code path** | `EmailInboxBulkView.tsx` → `applyClassifyMainResultToLocalState` → `commitClassifyMainResultToLocalState` → `fetchBulkTabCountsServer` when `s.bulkMode` |
| **Why worse** | Refactor added **“sync main classify to local Zustand”** (good for UX) but tied it to **full tab recount** (5× `listMessages`) **per message** instead of **once per chunk** or **debounced**. |
| **Confidence** | **Confirmed** |
| **Est. impact** | **Very high** |

#### 2. Uncapped LLM parallelism = chunk width (Ollama queueing)

| Field | Detail |
|-------|--------|
| **Code path** | `ipc.ts` `Promise.all` in `inbox:aiClassifyBatch`; chunk width from `sortConcurrency` (1–8) in `EmailInboxBulkView.tsx` |
| **Why worse** | Parallel requests may **queue** in Ollama; **wall time** approaches **sum** or **worse** than small fixed concurrency (e.g. legacy **`CONCURRENCY = 3`** in `inbox:aiCategorize`). |
| **Confidence** | **Inference** (model/runtime dependent) |
| **Est. impact** | **High** on local models; **lower** on highly parallel cloud APIs. |

#### 3. SQLite / orchestrator contention from parallel classify

| Field | Detail |
|-------|--------|
| **Code path** | `classifySingleMessage` × N parallel: multiple `UPDATE`s + `enqueueRemoteOpsForLocalLifecycleState` each |
| **Why worse** | Single-writer DB + queue writes **interleave** under `Promise.all`. |
| **Confidence** | **Inference** |
| **Est. impact** | **Medium–high** for large N. |

#### 4. End-of-run `refreshMessages` → full bulk snapshot

| Field | Detail |
|-------|--------|
| **Code path** | `runAiCategorizeForIds` tail: `refreshMessages` → `fetchAllMessages({ soft })` → `loadBulkInboxSnapshotPaginated` |
| **Why worse** | Forces **tab counts + first page** reload after **already** doing many tab counts during run. |
| **Confidence** | **Confirmed** path; **impact** depends on inbox size |
| **Est. impact** | **Medium** |

#### 5. Completeness retry pass

**Code path:** `missedIdsPass1` → second `runAiCategorizeForIds`. **Confidence:** **Confirmed** when triggered. **Est. impact:** **Low–medium** (conditional).

#### 6. Dual remote sync IPC after run

**Code path:** `enqueueRemoteSync` then `fullRemoteSyncForMessages` on all classified IDs. **Confidence:** **Confirmed**. **Est. impact:** **Medium** (tail latency).

#### 7. `sortFeedbackPaintDwell` 72ms per chunk

**Confidence:** **Confirmed**. **Est. impact:** **Low** unless chunk size = 1 repeatedly.

#### 8. Heavier coherence / guard rails (`reconcileInboxClassification`, attachment guard)

**Confidence:** **Inference**. **Est. impact:** **Low**.

### What “recent refactors” likely changed (without git bisect)

**Inference only:**

- Introduction or expansion of **`applyClassifyMainResultToLocalState`** for bulk while keeping tabs accurate.
- Introduction of **`inbox:aiClassifyBatch`** — **succeeded** for classify IPC, **masked** by **new per-message recount**.
- User-facing **sort concurrency** slider exposing higher parallelism than older fixed caps.

### Not supported as primary causes (current code)

- Continuous **`aiAnalyzeMessageStream`** preload (**disabled**).
- **`preResolveInboxLlm` per message** in batch path (**not** — once per chunk).

---

## 9. Recommended fix sequence (plan only — no implementation)

Aligned with [§8](#8-regression-hypotheses-and-root-cause-ranking).

### Stage 0 — Baseline instrumentation (1–2 hours engineering)

**Goal:** Split **LLM vs app overhead** without guessing.

| What to measure | Where |
|-----------------|--------|
| `inbox:aiClassifyBatch` wall time (main) | Wrap handler in main with timestamps per batch + per-id substages if feasible |
| Renderer time between batch return and next invoke | Chunk loop in `runAiCategorizeForIds` |
| Count of `listMessages` during a sort run | Log from preload bridge **or** temporarily count in `fetchBulkTabCountsServer` |
| Ollama queue depth / latency | Ollama `/api/ps` or server logs (external) |

**Success criterion:** If **non-classify time** ≫ **classify time**, hypothesis 1 (tab recount) is quantitatively confirmed.

### Stage 1 — Highest-value fix: debounce / coalesce tab counts in bulk

**Problem:** `commitClassifyMainResultToLocalState` → `fetchBulkTabCountsServer` on **every** message in bulk.

**Direction (conceptual):** After applying **chunk** results: **one** recount; or incremental `tabCounts` (harder).

**Validate first:** A/B with flag disabling `fetchBulkTabCountsServer` in `bulkMode` commit path on dev build — expect **large** speedup if hypothesis holds.

**Risk:** Tab badges **stale** until periodic refresh — acceptable during running sort if progress UI still correct.

### Stage 2 — Cap effective LLM concurrency for local backends

Separate “LLM slot” cap (e.g. 2–3) from “batch IPC size”, or auto-tune when `resolvedLlm.provider === 'ollama'`. **Validate:** `sortConcurrency = 1` vs `8`.

### Stage 3 — SQLite / enqueue contention

After Stage 1–2 if still slow: serialize classify writes or batch remote enqueue; profile SQLite WAL/busy timeout.

### Stage 4 — Post-run refresh policy

Soften `refreshMessages` / defer `fullRemoteSyncForMessages` where safe.

### Stage 5 — Retry / idempotency hygiene

Log `missedIdsPass1` frequency; investigate if frequent.

### Order summary

1. **Measure** (Stage 0).  
2. **Coalesce tab recounts** (Stage 1).  
3. **Tune local LLM concurrency** (Stage 2).  
4. **DB/orchestrator** (Stage 3).  
5. **Refresh/sync tail** (Stage 4).  
6. **Retry hygiene** (Stage 5).

---

## 10. Open questions and required instrumentation

### What code review **cannot** prove

| Question | Why |
|----------|-----|
| Exact **10×** factor | Needs timestamps on representative hardware + inbox size. |
| Ollama **actual** parallelism vs queueing | External runtime; depends on GPU, model, Ollama version. |
| Historical “before refactor” behavior | No git bisect in this analysis; **inference** from patterns only. |
| Duplicate remote ops **cost** | `enqueueRemoteOpsForLocalLifecycleState` idempotency not fully audited here. |
| Worst-case SQLite stalls | WAL, busy_handler, migration state not traced. |

### Recommended diagnostics

1. **Structured autosort trace (single runId):** `chunkIndex`, `chunkSize`, `batchInvokeMs`, per-id `llmMs` / `dbMs` / `enqueueMs`, renderer `tabCountFetchMs` count.
2. **IPC histogram:** `listMessages` tagged by call site.
3. **React profiler:** spikes aligned with `set({ tabCounts })`.
4. **Ollama metrics:** concurrent `/api/chat`, queue wait.

### Product / UX questions

- Are **tab badge counts** required **live** per message during sort, or only at **chunk** or **run** boundaries?
- Is **post-run** `refreshMessages` mandatory for correctness, or **cache invalidation** habit?

### Security note

Any new logging must **redact** email bodies and tokens.

### Files worth deeper read (next pass)

- `enqueueRemoteOpsForLocalLifecycleState` implementation and call frequency.  
- `fullRemoteSyncForMessages` — scope of network round-trips.  
- `getDb` / SQLite pragmas in Electron main bootstrap.
