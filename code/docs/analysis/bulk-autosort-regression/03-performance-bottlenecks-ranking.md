# 03 — Performance Bottlenecks Ranking

All measurements are confirmed from static code analysis unless noted as "estimated." For a 90-message run with `sortConcurrency=4` (default), `ollamaParallelCap=4` (default).

---

## Bottleneck #1 — Local LLM Inference Time

**Rank:** 1 (dominant cost, mostly unavoidable)  
**Evidence:** Confirmed from `inboxLlmChat.ts`, `ollama-manager.ts`  
**Confidence:** High

### What it is

Each message requires one call to `/api/chat` on the local Ollama server. The model generates a JSON classification response.

- Prompt: ~800–1200 tokens (system rules + 500 chars body + from/subject)
- Response: ~80–150 tokens (JSON object with category, urgency, etc.)
- Model: varies by user config (gemma3:12b, mistral:7b, etc.)

### Estimated timing per message

| Hardware | Model | Time per message |
|----------|-------|-----------------|
| GPU (RTX 3080) | 7B Q4 | 1–3 s |
| GPU (RTX 3080) | 12B Q4 | 2–5 s |
| CPU (modern) | 7B Q4 | 5–15 s |
| CPU (modern) | 12B Q4 | 10–30 s |

### For 90 messages with `sortConcurrency=4`

- 23 chunks × (LLM time per message × 4 messages, serialized by Ollama internally)
- Best case (GPU, 7B): ~23 × 4 s ≈ 92 s total
- Worst case (CPU, 12B): ~23 × 80 s ≈ 1840 s total (~30 minutes)

### App-side vs. model-side

Ollama serializes concurrent requests to a single model (one KV cache). Sending 4 messages in parallel (`Promise.all`) vs. sequential does not improve throughput — it just means Ollama queues them internally. The chunk wall time is still ≈ `4 × single-inference time`.

**Verdict:** The actual LLM inference is the true performance floor. App overhead is additive on top of this.

---

## Bottleneck #2 — Blocking Prewarm (First Chunk Only)

**Rank:** 2 (highest app-side overhead, cold-start only)  
**File:** `electron/main/llm/ollamaBulkPrewarm.ts`  
**Lines:** `maybePrewarmOllamaForBulkClassify`, called from `inbox:aiClassifyBatch` at `ipc.ts:4464`  
**Confidence:** Confirmed

### What it does

On chunk index 1 (the first chunk of every run), sends a minimal LLM request (`num_predict: 1`) to force Ollama to load model weights before real classifies start.

### Cost

- **Model already warm (resident):** <200 ms (`load_duration` check in code). Skipped by 120 s cooldown on subsequent runs.
- **Model cold (weights not in memory):** 2–20 s on typical hardware. This is the `load_duration` of Ollama loading from disk.
- **Timeout:** 60 s abort.

### Why it's a bottleneck

The `await` in the IPC handler blocks the entire chunk. No messages are classified. Progress bar shows 0%. User sees nothing happening for up to 20 seconds.

### Is it necessary?

As written: not in blocking form. The intent (ensure model is loaded before parallel classify calls) is valid, but:
1. Ollama's `keep_alive: '15m'` on actual classifies means the first real classify call would have loaded the model anyway.
2. A non-blocking prewarm (fire-and-forget) would achieve the same effect: the model starts loading while the first classify call is being prepared.
3. The prewarm can be removed entirely if the system accepts that the first 1–4 classify calls on a cold model each pay the full load duration (but those calls run in parallel anyway, so Ollama only loads once).

---

## Bottleneck #3 — Session Summary LLM Call

**Rank:** 3 (high overhead, run end only)  
**File:** `electron/main/email/ipc.ts` — `autosort:generateSummary` handler  
**Called from:** `handleAiAutoSort` ~line 3640, `EmailInboxBulkView.tsx`  
**Confidence:** Confirmed

### What it does

After all classification is done, loads ALL session messages from DB, builds a summary prompt containing all their classifications, and calls `inboxLlmChat()` — a full inference request.

### Cost

- DB query: SELECT all messages with `last_autosort_session_id = ?` → fast
- LLM inference: one full generation, longer prompt (90 messages worth of data) → 5–60 s depending on model
- Adds to run completion time even when the user only wanted to sort

### Context

This was added as part of the session-tracking/review feature. The session review UI shows a summary of what was sorted. The problem is:
1. It runs synchronously before the `handleAiAutoSort` finally block marks the run complete.
2. The progress bar is set to `phase: 'summarizing'` (100% width) — users see the bar frozen at 100% for 5–60 additional seconds after all sorting is done.
3. The user did not explicitly request a summary.

---

## Bottleneck #4 — `BulkOllamaModelSelect` GPU Detection on Window Focus

**Rank:** 4 (moderate overhead, Windows-specific, intermittent during run)  
**File:** `src/components/BulkOllamaModelSelect.tsx`  
**Lines:** `useEffect` with `window.addEventListener('focus', onFocus)` + `api.getStatus()` call  
**Confidence:** Confirmed

### What it does

Every time the app window receives focus, `BulkOllamaModelSelect` calls `window.llm.getStatus()`, which calls:
1. `ollamaManager.checkInstalled()` → `execAsync("ollama --version")` — subprocess spawn
2. `ollamaManager.isRunning()` → `fetch /api/tags` (2 s timeout)
3. `ollamaManager.listModels()` → cached (120 s TTL) or another `/api/tags` fetch
4. `buildLocalLlmRuntimeInfo()` → `getGpuAccelerationHintsCached()`:
   - **Windows:** `wmic path win32_VideoController get Name` (5 s timeout)
   - **Windows:** `nvidia-smi --query-gpu=name --format=csv,noheader` (2.5 s timeout)
   - Cache TTL: **45 s**

### Cost per focus event

- Windows, GPU hints cache cold: potentially 5–7.5 s of subprocess execution in the main process.
- Windows, GPU hints cache warm (within 45 s): ~20–100 ms (just `ollama --version` + `/api/tags` fetch).

### Why it's a bottleneck during a run

During a long bulk classify run, the user may alt-tab or click elsewhere and return to the window. Each return triggers a focus event, which triggers this chain. The main process is simultaneously handling classify IPC calls. The subprocess calls compete with classify work on the main process Node.js thread.

With a 45 s cache TTL, a 3-minute run could trigger 3–4 full GPU detection cycles.

---

## Bottleneck #5 — Pre-Flight ID Gathering (Sequential IPCs)

**Rank:** 5 (fixed overhead per run, renderer-blocking)  
**File:** `src/components/EmailInboxBulkView.tsx` (handleAiAutoSort) + `src/stores/useEmailInboxStore.ts`  
**Confidence:** Confirmed

### What it does

Before any classification starts, `handleAiAutoSort` calls:
1. `fetchAllMessages({ soft: true })` → `loadBulkInboxSnapshotPaginated`:
   - `fetchBulkTabCountsServer()`: 5 sequential `inbox:listMessages` (limit=1) → 5 IPC round-trips
   - 1 more `inbox:listMessages` for first page → 1 IPC round-trip
2. `fetchMatchingIdsForCurrentFilter()`: paginated `inbox:listMessageIds` → 1+ IPC round-trips

### Cost

Each IPC round-trip: ~2–15 ms (same machine, SQLite). Six sequential calls: 12–90 ms.

For large inboxes (>500 messages), `fetchMatchingIdsForCurrentFilter` pages through the full list with multiple `listMessageIds` calls — could be 50–200 ms more.

### Why it's overhead

- The tab count data is not needed to classify. It's loaded to keep the badges accurate during the run.
- However, tab badges are NOT updated during the run anyway (all classify applies use `skipBulkTabCountRefresh: true`). They're only updated at the end.
- So the pre-flight tab count fetch is loading data that:
  1. Will be stale by the end of the run
  2. Will be re-fetched at the end anyway by `fetchAllMessages`

---

## Bottleneck #6 — End-of-Run `fetchAllMessages` (Second 6-IPC Serial Sequence)

**Rank:** 6 (moderate, fixed overhead, run end only)  
**File:** `src/components/EmailInboxBulkView.tsx` — `runAiCategorizeForIds` ~line 3281  
**Confidence:** Confirmed

### What it does

After all classification is complete, `runAiCategorizeForIds` calls:
```typescript
await useEmailInboxStore.getState().fetchAllMessages({ soft: true, skipTabCountFetch: false })
```

This runs the same `loadBulkInboxSnapshotPaginated` again: 5 tab-count IPCs + 1 page IPC.

### Cost

Same as the pre-flight: 12–90 ms. Acceptable in isolation.

### The problem

Combined with Phase 4 (session summary LLM call), the user experience at run end is:
1. Classification done (bar at 100%)
2. `generateSummary` LLM call — 5–60 s frozen
3. `fetchAllMessages` — 12–90 ms (fast, fine)

The end refresh is not the dominant problem but wastes time after an already-long run.

---

## Bottleneck #7 — Ollama Concurrency Model (No Actual Parallelism)

**Rank:** 7 (structural, affects all runs)  
**File:** `electron/main/email/ipc.ts` — `runClassifyBatchWithOptionalOllamaCap`  
**Confidence:** Confirmed

### What it does

With `sortConcurrency=4` (4 IDs per chunk) and `ollamaParallelCap=4`:
```
batchIds.length (4) <= ollamaMax (4) → Promise.all(4 × runOne)
```

All 4 classify calls hit Ollama simultaneously.

### Why this provides no benefit

Ollama (by default) uses a single model slot. When 4 requests arrive simultaneously:
1. Ollama processes request 1 (loads KV cache, generates)
2. Request 2 waits in Ollama's internal queue
3. Request 3 waits
4. Request 4 waits
5. Total wall time ≈ 4 × single inference time

This is identical to sequential. The `Promise.all` simply moves the serialization from the Node.js await chain to Ollama's internal queue.

**With Ollama `num_parallel` > 1 (experimental feature):** Requests could be batched. But this is not the default and may not be configured.

**Impact:** The current "parallelism" is an illusion. For single-GPU or CPU inference, the throughput is serial regardless of concurrency.

---

## Bottleneck #8 — DB Write Contention (Per-Message, 3 Writes)

**Rank:** 8 (minor, per-message)  
**File:** `electron/main/email/ipc.ts` — `classifySingleMessage`  
**Confidence:** Confirmed

### What it does

Per classified message:
1. `UPDATE inbox_messages SET last_autosort_session_id = ?` — always, even if session null
2. `UPDATE inbox_messages SET sort_category, sort_reason, urgency_score, needs_reply, …` — one of 4 branches
3. `UPDATE inbox_messages SET ai_analysis_json = ?`
4. `enqueueRemoteOpsForLocalLifecycleState(db, [messageId])` → potential INSERT + SELECT in orchestrator queue table

With `better-sqlite3` (synchronous), these execute in microseconds each. However:
- Multiple concurrent `classifySingleMessage` calls (e.g. 4 in parallel) will serialize on SQLite's write lock.
- The session stamp write (line 4105) fires even when `sessionId` is undefined (the guard is `if (sessionId)`), so it's conditional but still a synchronous call into the function.

### Cost

For 4 concurrent messages: ~0.5–2 ms per write × 3 writes × 4 messages = ~6–24 ms of serialized DB writes per chunk. Negligible compared to LLM inference time.

---

## Bottleneck #9 — Remote Sync Drain Scheduling

**Rank:** 9 (background, minimal direct impact on classify speed)  
**File:** `electron/main/email/ipc.ts`, `electron/main/email/inboxOrchestratorRemoteQueue.ts`  
**Confidence:** Confirmed

### What it does

After each chunk, `scheduleOrchestratorRemoteDrain(resolveDb)` is called. With `setSimpleOrchestratorRemoteDrainPrimary(true)` active (set at line 1872 during app initialization), the legacy chain-based drain is disabled. The simple drain runs every 10 seconds.

### Cost

The `scheduleOrchestratorRemoteDrain` call is fast (just schedules a timer). The actual drain happens asynchronously and does not block classify progress.

### Risk

After a 90-message run, 90 messages may have remote lifecycle ops queued. The drain processes up to 20 rows per batch. It takes multiple drain cycles to process the full queue. This is fine for non-blocking behavior, but means remote IMAP moves happen minutes after local classify.

---

## Summary Table

| Rank | Bottleneck | Estimated Impact | App-side? | Fixable? |
|------|-----------|-----------------|-----------|----------|
| 1 | Local LLM inference time | 90–1800+ s per run | No (inherent) | Partially (model choice) |
| 2 | Blocking prewarm (chunk 1) | 2–20 s one-time | Yes | Yes — make fire-and-forget |
| 3 | Session summary LLM call | 5–60 s per run | Yes | Yes — defer or skip |
| 4 | `BulkOllamaModelSelect` on focus | 0–7.5 s per focus | Yes | Yes — debounce / disable during run |
| 5 | Pre-flight ID gathering | 12–200 ms per run | Yes | Yes — lightweight ID query |
| 6 | End-of-run `fetchAllMessages` | 12–90 ms per run | Yes | Partially — skip or simplify |
| 7 | Fake parallelism (no Ollama gain) | 0 ms saved (0 benefit) | Yes | Yes — serialize or use true batching |
| 8 | DB write contention per message | <25 ms per chunk | Yes | Low priority |
| 9 | Remote drain scheduling | Negligible on classify | Mostly No | N/A |
