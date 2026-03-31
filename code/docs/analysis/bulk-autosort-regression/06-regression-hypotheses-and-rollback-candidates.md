# 06 — Regression Hypotheses and Rollback Candidates

This document identifies what likely changed during recent refactors to cause the current degraded performance, ordered by confidence and impact.

---

## Hypothesis 1: Prewarm was added as blocking, not background (HIGH confidence)

**What likely happened:**  
The `maybePrewarmOllamaForBulkClassify` function was added to solve a real problem: when 4 parallel classify calls hit a cold Ollama model simultaneously, they all wait for the full cold-load, and the first one to get the model loaded "wins" while others wait. The intent was to serialize the cold-load into a single small request before releasing the classify calls.

**The regression:**  
The prewarm was placed as a blocking `await` in the `inbox:aiClassifyBatch` handler, before `runClassifyBatchWithOptionalOllamaCap`. This means the entire first chunk waits for the prewarm to complete. On a cold model, this is 10–20 s of nothing happening.

**What should have been done:**  
Start the prewarm as a fire-and-forget background fetch, then immediately proceed to classify. The classify calls will encounter the model in the process of loading, but Ollama queues concurrent requests — the result is the same (one cold-load, serialized by Ollama) without any app-side blocking.

**Rollback candidate:**  
Make `maybePrewarmOllamaForBulkClassify` non-blocking (fire-and-forget). Change from:
```typescript
ollamaPrewarm = await maybePrewarmOllamaForBulkClassify(resolvedLlm.model, { chunkIndex })
```
to:
```typescript
void maybePrewarmOllamaForBulkClassify(resolvedLlm.model, { chunkIndex })
```
Or: remove the prewarm entirely and let the first classify call absorb the cold-load cost.  
**Risk:** Low. Prewarm is a latency optimization, not a correctness requirement.

---

## Hypothesis 2: Session tracking added a mandatory end-of-run LLM call (HIGH confidence)

**What likely happened:**  
The `autosort_sessions` table and session review UI were added to give users a history of what was sorted. The `autosort:generateSummary` IPC was added to produce an AI-generated summary of each session. This was probably intended as a useful feature and was wired to fire automatically at the end of every toolbar Auto-Sort run.

**The regression:**  
`generateSummary` runs an extra LLM inference call after all classification is done. The progress bar shows "Summarizing…" at 100% for 5–60 additional seconds. This is perceived as the app being hung.

Before session tracking, the run ended immediately after `fetchAllMessages`. Now it ends after an extra LLM call.

**Evidence:**  
`handleAiAutoSort` ~3605–3660:
```typescript
if (sessionId && sessionApi?.getSessionMessages && sessionApi.finalize && sessionApi.generateSummary) {
  const sessionMessages = await sessionApi.getSessionMessages(sessionId)
  // ... build stats ...
  setAiSortProgress({ ..., phase: 'summarizing' })
  await sessionApi.generateSummary(sessionId)  // ← extra LLM call
}
```

**Rollback candidate:**  
Skip `generateSummary` during the run. Call it lazily when the user opens the session review. The session data (individual message results) is already in the DB; only the AI summary is deferred.  
**Risk:** Low. Session review still works; summary just loads on demand.

---

## Hypothesis 3: Pre-flight `fetchAllMessages` was added to ensure fresh state before sort (MEDIUM–HIGH confidence)

**What likely happened:**  
Before the "all messages" batch mode, the user sorted only the visible/selected messages. When "all" mode was added, the design needed to get all matching IDs. `fetchAllMessages` was probably added to ensure the local state was current (to avoid sorting stale or already-sorted messages).

**The regression:**  
`fetchAllMessages` runs `loadBulkInboxSnapshotPaginated` which fires 5 sequential tab-count queries + 1 page query — 6 serial IPCs before any classify work starts. The tab counts are stale by the end of the run anyway (they're refreshed again at the end).

**Before this was added:**  
The pipeline likely used only `fetchMatchingIdsForCurrentFilter()` to get IDs, without a full snapshot refresh. That's a single or few-IPC operation.

**Rollback candidate:**  
Remove `fetchAllMessages` from `handleAiAutoSort`. Keep only `fetchMatchingIdsForCurrentFilter()`. Tab counts will be updated at end-of-run by the existing `fetchAllMessages` in `runAiCategorizeForIds`.  
**Risk:** Low. The IDs still come from a DB query. Tab counts update at the end.

---

## Hypothesis 4: `BulkOllamaModelSelect` focus refresh was added without considering main-process cost (MEDIUM confidence)

**What likely happened:**  
The `BulkOllamaModelSelect` component needed to stay in sync with the current Ollama model. A `window.focus` listener was added so that if the user switched models in another settings screen and returned to the bulk view, the model picker would update. This is correct in intent.

**The regression:**  
`llm:getStatus()` includes `buildLocalLlmRuntimeInfo()` which calls `getGpuAccelerationHintsCached()` — the expensive subprocess chain. The component is mounted and active during any Auto-Sort run (the status dock is visible). Every window focus during a run triggers the full status refresh.

**Before this was added:**  
The model picker only refreshed on explicit user actions (model change IPC event) and on mount.

**Rollback candidate:**  
- Remove the `window.focus` listener from `BulkOllamaModelSelect`.
- Or: replace `llm:getStatus` with a lightweight model-list-only query that does NOT run GPU detection.
- Or: suppress the `window.focus` refresh during active sort runs (check `isSortingActive`).  
**Risk:** Low. Model freshness during active sort is already handled by the `onActiveModelChanged` listener.

---

## Hypothesis 5: `preResolveInboxLlm` is called per-chunk instead of per-run (MEDIUM confidence)

**What likely happened:**  
`preResolveInboxLlm` was introduced to batch-optimize `listModels()` — instead of calling it per message, it's called once per IPC chunk. This was the right optimization direction.

**The regression:**  
The call was placed inside the IPC handler (`inbox:aiClassifyBatch`), so it runs once per chunk invocation. For a 90-message run, that's up to 23 calls. The 120 s TTL cache means most are cache hits, but the intent was "once per run" and the implementation is "once per chunk."

**More importantly:** On long runs (>2 minutes on CPU hardware), the 120 s TTL can expire mid-run. A cache miss at chunk 17 of 23 adds ~100 ms unexpectedly. Minor but inconsistent.

**Rollback candidate / improvement:**  
Pass the resolved LLM context from the renderer at run start, rather than resolving it in the main-process IPC handler. The renderer could call a new `inbox:resolveInboxLlm` IPC once at run start, store the result, and pass it as a parameter to each `aiClassifyBatch` chunk.

Or: extend the cache TTL from 120 s to 600 s (models don't change mid-run in practice).  
**Risk:** Low.

---

## Hypothesis 6: Ollamamanager `chat()` keep_alive may be wrong for classify (MEDIUM confidence)

**What likely happened:**  
`ollama-manager.ts` `chat()` method uses `keep_alive: '2m'`. The `inboxLlmChat` function adds `ollamaKeepAlive: '15m'` for bulk autosort. The two-layer architecture means the 15m parameter must be correctly passed through `provider.generateChat()` to the underlying Ollama request.

**The regression risk:**  
If `provider.generateChat()` in `aiProviders.ts` does not forward `ollamaKeepAlive` to the Ollama `POST /api/chat` request body, then `keep_alive: '2m'` is used. On a CPU-bound machine where a 90-message run takes >2 minutes, the model evicts from memory after the first few minutes, and each subsequent chunk pays a cold-load penalty (~2–5 s) on the LLM call side (not the explicit prewarm, but the Ollama-internal load).

**This cannot be confirmed from static code alone** without tracing `aiProviders.ts` → `provider.generateChat()`.

**Risk if confirmed:** Medium. Could explain why multi-minute runs get progressively slower toward the end.

---

## Hypothesis 7: Concurrency model change: N×single IPC → batch IPC with same wall time (MEDIUM–LOW confidence)

**What likely happened:**  
The original pipeline (before `aiClassifyBatch` was introduced) called `aiClassifySingle` for each message. This was refactored to `aiClassifyBatch` to reduce IPC round-trip overhead and enable batch state updates. The comment in `ipc.ts` confirms this:
```
* Batch-classify handler for the renderer's Auto-Sort bulk loop.
* Compared with N×aiClassifySingle:
*   - 1 IPC round-trip instead of N
```

**The regression:**  
The batch handler runs LLM classifies in parallel up to `ollamaParallelCap`. But for Ollama (single-GPU/CPU), this parallelism is illusory. The wall time per chunk is still `batchSize × single-message time` because Ollama serializes the requests.

With `N×aiClassifySingle` in the old design, the renderer iterated messages and awaited each — effectively serial. With `aiClassifyBatch` + `Promise.all`, the main process sends them simultaneously to Ollama, which queues them. Same wall time, slightly more Ollama internal overhead.

**Net effect:** No regression in pure inference time. The IPC round-trip savings are real (1 vs 4 round-trips per chunk). Minor improvement from reduced IPC overhead.

---

## What to Keep (Do Not Revert)

| Feature | Reason to Keep |
|---------|---------------|
| `aiClassifyBatch` (batch IPC) | Correct and reduces IPC overhead |
| `preResolveInboxLlm` (once per chunk) | Eliminates N×`listModels` calls per chunk |
| `applyBulkClassifyMainResultsToLocalState` (single Zustand tx) | Correct, efficient per-chunk state apply |
| `skipBulkTabCountRefresh: true` in chunk applies | Prevents tab-count IPC storm |
| `resolvedContext` passing to `classifySingleMessage` | Eliminates per-message `listModels` call |
| `ollamaManager.listModels()` TTL cache + dedup | Essential for concurrent classify scenarios |
| `keep_alive: '15m'` for bulk autosort | Keeps model resident across chunks |
| `enqueueRemoteOpsForLocalLifecycleState` post-classify | Correct; non-blocking |
| `completeness retry` pass | Correctness feature; non-blocking if failures are rare |
| Session create/finalize IPC | Needed for session review feature |

---

## Rollback Priority Summary

| Priority | Candidate | Estimated Gain | Risk |
|----------|-----------|---------------|------|
| P0 (urgent) | Make prewarm fire-and-forget or remove it | ~10–20 s saved on first call | Low |
| P1 (high) | Defer `generateSummary` to on-demand | ~5–60 s saved at run end | Low |
| P2 (medium) | Remove pre-flight `fetchAllMessages` from `handleAiAutoSort` | ~50–200 ms saved per run | Low |
| P3 (medium) | Remove `window.focus` refresh from `BulkOllamaModelSelect` | Reduces main-process interference during run | Low |
| P4 (low) | Extend `listModels` TTL from 120 s to 600 s | Prevents mid-run cache miss on slow hardware | Very low |
| P5 (future) | Resolve LLM context once per run (not per chunk) | Minor consistency improvement | Low |
| P6 (future) | Parallelize `fetchBulkTabCountsServer` (5 serial → 5 parallel) | ~40 ms saved on refresh | Very low |
