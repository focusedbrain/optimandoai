# 02 — First-Call and Cold-Start Analysis

**Observed symptom:** First click on "⚡AI Auto-Sort" takes ~20 seconds before any progress.

---

## The first-call timeline (confirmed from code)

The following happens strictly serially before the first message is classified:

```
t=0        User clicks "⚡AI Auto-Sort"

t~1ms      handleAiAutoSort starts
           - isSortingRef = true
           - setSortingActive(true)
           - setAiSortProgress({ label: "Gathering messages…" })

t~5–50ms   autosortSession.create()  → IPC round-trip to main
           main: INSERT INTO autosort_sessions (status='running')
           → returns sessionId

t~50–500ms fetchAllMessages({ soft: true })
           → loadBulkInboxSnapshotPaginated:
             → fetchBulkTabCountsServer:
               5 × listMessages (limit=1) sequential IPC round-trips
               Each: renderer → IPC bridge → main → SQLite COUNT query → return
             → 1 × listMessages (limit=BULK_UI_PAGE_SIZE)
           → 6 sequential IPCs total
           Estimated time: 50–500 ms (depends on DB size, IPC overhead)

t~550ms    fetchMatchingIdsForCurrentFilter()
           → paginated listMessageIds loop
           → For 90 messages at PAGE_SIZE=100: 1 IPC
           → For 500+ messages: multiple IPCs
           Estimated time: 5–50 ms (one page of IDs)

t~600ms    setAiSortProgress({ label: "Analyzing 90 messages…" })

t~600ms    autosortDiagSync({ bulkSortActive: true })  → IPC (fast, ~1ms)

t~600ms    First chunk built: batch = ids[0..3]

t~600ms    aiClassifyBatch(batch, sessionId, runId, chunkIndex=1, ollamaParallel=4)
           Main process enters:

           1. resolveDbCore()  → fast (~1ms)

           2. preResolveInboxLlm()
              → resolveInboxLlmSettings()    (sync, reads from ocrRouter config, fast)
              → ollamaManager.getEffectiveChatModelName()
                → listModels()
                  [First call: _modelsCache === null, fires listModelsRaw()]
                  → fetch http://127.0.0.1:11434/api/tags (5s abort timeout)
                  → returns list of installed models
                  → sets _modelsCache, _modelsCacheTime
                  Estimated time: 20–200 ms
              → resolveEffectiveOllamaModel(names, storedPreference)  (sync, fast)
              → returns { model: "gemma3:12b", provider: "ollama" }
              preResolveMs: ~20–200 ms on first call

           3. maybePrewarmOllamaForBulkClassify(model, { chunkIndex: 1 })
              → idx === 1, so prewarm proceeds
              → check cooldown: first time, lastPrewarmAtByModel is empty → bypass
              → POST http://127.0.0.1:11434/api/chat
                { model: "gemma3:12b", messages: [{ role: 'user', content: '.' }],
                  stream: false, keep_alive: '15m', options: { num_predict: 1 } }
              → Ollama receives request, begins loading model weights

              *** COLD MODEL CASE (weights not in memory/VRAM) ***
              Ollama must load model from disk:
              - gemma3:12b Q4: ~6.5 GB → load from NVMe: 3–8 s, from HDD: 8–20 s
              - mistral 7B Q4: ~4 GB → 2–5 s NVMe, 5–12 s HDD
              - GPU VRAM: if model fits, load is faster: 1–3 s
              → Full response received (only 1 token predicted)
              → lastPrewarmAtByModel.set(model, Date.now())
              Estimated wall time: 2–20 s (cold) or <200 ms (already resident)

t = 0+2s to 0+20s  Prewarm completes — THIS IS WHERE THE 20s COMES FROM

           4. resolveBulkOllamaClassifyCap(4)  → fast (~0ms)

           5. runClassifyBatchWithOptionalOllamaCap([4 IDs], …, cap=4)
              → Promise.all(4 × classifySingleMessage)
              → Each: resolveDb, SELECT, UPDATE session, build prompt, inboxLlmChat...
```

---

## Breakdown by category

### A. Unavoidable model cold load

**Source:** Ollama has to load model weights into RAM/VRAM on first use.

- This is inherent to using a local LLM.
- The weights must be loaded from disk before inference can proceed.
- Duration: 2–20 seconds depending on model size, disk speed, GPU availability.
- This overhead is **real and unavoidable on the first call after a cold start**.
- After the first classify, Ollama keeps the model resident for `keep_alive: '15m'` (set in `inboxLlmChat` for bulk autosort). Subsequent calls within 15 minutes pay no reload cost.

**However:** The current code makes this unavoidable cold-load happen **synchronously on the blocking hot path**, before any message is classified. This is the regression — not the cold load itself, but the decision to wait for it before releasing.

### B. Prewarm blocking (app regression — confirmed)

**Source:** `maybePrewarmOllamaForBulkClassify` in `inbox:aiClassifyBatch` handler, lines 4464–4473 of `ipc.ts`.

```typescript
// Chunk 1: prewarm fires and BLOCKS
ollamaPrewarm = await maybePrewarmOllamaForBulkClassify(resolvedLlm.model, { chunkIndex })
```

This `await` holds the entire first-chunk IPC handler until Ollama responds. During a cold load, this is 10–20 seconds where:
- The renderer is awaiting the IPC response
- The main process IPC handler is suspended at the `await`
- No messages are classified
- The progress bar shows 0/90

The intent of the prewarm was to load the model *before* the 4 parallel classify calls, so those calls don't all compete for a cold-load race. This was a sound optimization **if** the prewarm were non-blocking or background. As currently written, it is blocking and serial.

**Prewarm cooldown:** After a successful prewarm, `lastPrewarmAtByModel.set(model, now)` is set. The 120 s cooldown (`PREWARM_COOLDOWN_MS = 120_000`) means a second run within 2 minutes skips the prewarm entirely and returns `{ action: 'skipped_cooldown' }`. This is why subsequent runs in quick succession can feel faster.

**Model switch bypass:** When the user switches the Ollama model via `BulkOllamaModelSelect`, `noteOllamaActiveModelChangedForBulkPrewarm(modelId)` sets `postSwitchBypassModelId`. The next prewarm call for that model bypasses the cooldown. This means a model switch during or just before a run triggers a guaranteed cold prewarm on the next chunk 1.

### C. `listModels` first-call overhead (app overhead, partially mitigated)

**Source:** `preResolveInboxLlm()` → `ollamaManager.getEffectiveChatModelName()` → `ollamaManager.listModels()`.

First call hits `/api/tags` (5 s abort timeout). Typical response time: 20–200 ms.
After first call: 120 s TTL cache. All subsequent chunks within 2 minutes hit the cache.

This is **not** the dominant cold-start contributor, but it adds to the serial sequence.

### D. Pre-flight ID gathering (app overhead — confirmed)

**Source:** `handleAiAutoSort` Phase 1b — `fetchAllMessages` + `fetchMatchingIdsForCurrentFilter`.

The `fetchAllMessages({ soft: true })` call runs `loadBulkInboxSnapshotPaginated` which issues:
1. 5 sequential `inbox:listMessages` calls (one per tab: all, urgent, pending_delete, pending_review, archived) with `limit=1` to get tab counts.
2. 1 `inbox:listMessages` call with `limit=BULK_UI_PAGE_SIZE` to load the first page.

On a machine where IPC round-trips are fast (same machine), each takes ~2–10 ms. Six sequential calls = 12–60 ms. This is relatively minor but:
- It runs **before** the user sees "Analyzing N messages…"
- It is entirely unnecessary for the classify itself — the IDs could be gathered with a single lightweight query
- It was added to ensure the tab count badges are current before the run, which is a UI nicety that became a blocking preflight

### E. Dynamic import / module initialization overhead

**Source:** `inboxLlmChat.ts` line ~104: `const { ollamaManager } = await import('../llm/ollama-manager')` (in `inboxSupportsOllamaStream`).

This is NOT on the classify hot path. The `classifySingleMessage` → `inboxLlmChat` path uses the statically imported `ollamaManager`. No dynamic import on the hot path.

### F. Cache invalidation churn

**Source:** `ollamaManager.setActiveModelPreference()` calls `invalidateModelsCache()`, which bumps `_listModelsCacheEpoch` and nulls the cache. After invalidation, the next `listModels()` call hits `/api/tags`.

If the user changes the model during a run:
1. Next `preResolveInboxLlm()` call (on the next chunk) will miss the cache and hit `/api/tags`.
2. `noteOllamaActiveModelChangedForBulkPrewarm` sets `postSwitchBypassModelId`, which means the next prewarm bypasses cooldown — triggering another blocking warm-up.

A mid-run model switch could add 10–20 s to that chunk's wait time. This is documented behavior by the `BulkOllamaModelSelect` comment, but the consequence (a blocking prewarm) is not obvious to users.

---

## What is cold load vs. what is app regression

| Factor | Category | Avoidable? |
|--------|----------|-----------|
| Ollama loading model from disk | Unavoidable cold load | No — inherent to local LLM |
| Prewarm blocking the IPC handler | **App regression** | Yes — should be fire-and-forget |
| `listModels` first hit (~100 ms) | Minor app overhead | Yes — pre-warm at app start |
| Pre-flight `fetchAllMessages` (6 IPCs) | App overhead | Yes — use lightweight ID query |
| `preResolveInboxLlm` per chunk (cache miss after 120s) | App overhead | Yes — resolve once per run |
| Dynamic import | Not on hot path | N/A |
| Model switch cache invalidation + prewarm bypass | App complexity | Yes — decouple from hot path |

---

## Why subsequent runs feel faster (until they don't)

1. **Prewarm cooldown:** 120 s cooldown skips the blocking prewarm. For 90 messages at 4 per chunk, a run takes ~15–30 s total. Second run within 2 minutes skips prewarm.
2. **Ollama keep_alive: '15m':** Model stays resident. Cold load is not repeated.
3. **`listModels` cache:** 120 s TTL. Second run within 2 minutes hits cache.

**When subsequent runs are slow again:**
- User waits >15 minutes between runs → model evicted from VRAM/RAM, cold load on next prewarm
- User waits >120 s between runs → `listModels` cache miss (minor)
- User switches model during or between runs → prewarm bypass fires, blocking cold load

This explains the reported behavior pattern: "first time is slow, sometimes fast after that, then slow again."
