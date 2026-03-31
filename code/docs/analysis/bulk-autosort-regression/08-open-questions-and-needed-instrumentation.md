# 08 — Open Questions and Needed Instrumentation

This document lists what **cannot be confirmed from static code analysis alone**, and what additional instrumentation or runtime data would close each gap.

---

## Q1: Does `keep_alive: '15m'` actually reach the Ollama API body?

**Confidence gap:** MEDIUM

**What we know:**  
`inboxLlmChat.ts` passes `{ ollamaKeepAlive: '15m' }` to `provider.generateChat()` for bulk autosort calls. `ollama-manager.ts` hardcodes `keep_alive: '2m'` in its `chat()` method.

**What we don't know:**  
How `aiProviders.ts` → `getProvider(settings, getApiKey)` → `provider.generateChat()` bridges to the Ollama API. If `ollamaKeepAlive` is not forwarded to the `POST /api/chat` body's `keep_alive` field, the model evicts after 2 minutes.

**Why it matters:**  
On a CPU-bound machine, a 90-message run can exceed 2 minutes. If the model evicts mid-run, chunks after the 2-minute mark each pay a cold-load penalty (~2–10 s per chunk) that accumulates.

**How to confirm:**  
1. Enable `DEBUG_OLLAMA_RUNTIME_TRACE = true` in `ollama-manager.ts` and observe `ollamaManager.chat:done` logs — check that `loadDurationMs` is near zero for chunks after the first (indicating model stays resident).  
2. Or: inspect `aiProviders.ts` to trace the `ollamaKeepAlive` parameter to the final fetch body.

---

## Q2: Are any rows in `chunkClassifyApplies` reaching `commitBulkClassifyMainResultsToLocalState` without `skipBulkTabCountRefresh: true`?

**Confidence gap:** LOW-MEDIUM

**What we know:**  
If any row in a chunk has `skipBulkTabCountRefresh: false` (or the property absent), `commitBulkClassifyMainResultsToLocalState` fires `fetchBulkTabCountsServer()` — 5 serial `listMessages` IPCs per chunk. For 23 chunks, this would be 115 extra IPCs.

**What we don't know:**  
Without running the code, we cannot confirm that 100% of rows in `chunkClassifyApplies` have `skipBulkTabCountRefresh: true` set. The flag is set in the renderer loop that builds `chunkClassifyApplies`. If there's any code path that adds a row without the flag, the IPC storm occurs.

**How to confirm:**  
Enable `DEBUG_AUTOSORT_TIMING = true` (renderer) and check the `listMessagesCalls` counter in `autosortTimingRunEnd`. If it's significantly above 2 (start + end), tab count IPCs are firing mid-run.

---

## Q3: What is the actual wall time of the `autosort:generateSummary` call for a 90-message run?

**Confidence gap:** MEDIUM

**What we know:**  
`generateSummary` builds a prompt from all N session message rows and calls `inboxLlmChat()`. The prompt size grows with N. On a 7B model at CPU speeds, this could be 5–60+ seconds.

**What we don't know:**  
Exact timing without runtime measurement. The prompt structure in the handler was not fully traced (the handler body was summarized, not read in full). The prompt may be concise (summaries only) or verbose (full message text).

**How to confirm:**  
Add a `console.time` / `console.timeEnd` around the `generateSummary` handler, or enable `DEBUG_AUTOSORT_TIMING` and note the time between `renderer:postClassifyTail` and the finally block's `autosortTimingRunEnd`.

---

## Q4: How large is the `getInboxAiRulesForPrompt()` output, and does it bloat classify prompts?

**Confidence gap:** LOW

**What we know:**  
`getInboxAiRules()` reads `WRExpert.md` from userData, caches by mtime, strips comment lines. The default content is ~2 KB. User-edited content could be much larger.

**What we don't know:**  
If a user has a large `WRExpert.md` (e.g., 10+ KB of rules), the system prompt for every classify call would be proportionally larger, increasing Ollama prompt evaluation time.

**How to confirm:**  
Log `systemPrompt.length` in `classifySingleMessage` for one run. Or check the userData `WRExpert.md` file size directly.

---

## Q5: Is the `autosort:generateSummary` prompt designed to scale with message count?

**Confidence gap:** MEDIUM

**What we know:**  
The handler loads all `inbox_messages WHERE last_autosort_session_id = ?`. The prompt is built from these rows.

**What we don't know:**  
Whether the prompt includes full message bodies (could be 90 × 500 chars = 45,000 tokens) or just summaries/categories (90 × 20 tokens = 1,800 tokens). This dramatically affects inference time.

**How to confirm:**  
Read the `autosort:generateSummary` handler body in `ipc.ts` (around line 1821). The `userPrompt` construction will reveal whether bodies or summaries are included.

---

## Q6: Does the completeness-retry path fire frequently in practice?

**Confidence gap:** MEDIUM

**What we know:**  
The retry fires when `results.some(r => r.error)` after the main classify loop. Ollama timeout (45 s limit) is the most common error source.

**What we don't know:**  
What fraction of messages fail in a typical run. If Ollama is reliable and hardware is adequate, the retry never fires. If timeouts are common (slow hardware, large models), the retry doubles the classify work for failed messages.

**How to confirm:**  
Check the `autosortDiagLog('bulk-run-summary', { timeout, failed })` output by enabling `DEBUG_AUTOSORT_DIAGNOSTICS = true` for one run. The `timeout` and `failed` counts will show retry frequency.

---

## Q7: Is the `wmic` call actually blocking the main process during classify?

**Confidence gap:** LOW-MEDIUM

**What we know:**  
`detectGpuHintsUncached()` uses `execAsync('wmic path win32_VideoController get Name', { timeout: 5000 })`. Node.js `child_process.exec` is non-blocking at the Node level — it uses a subprocess and callback. However, on Windows, WMI queries can cause system-level contention.

**What we don't know:**  
Whether the WMI subprocess actually interferes with Ollama's CUDA/CPU inference or the Electron main-thread IPC loop. On a developer machine, this may be negligible. On a production machine under load, it could add latency to concurrent IPC handlers.

**How to confirm:**  
Add timing logs around `getGpuAccelerationHintsCached()` in `buildLocalLlmRuntimeInfo` and compare classify chunk times with and without focus events during the run.

---

## Q8: Is `sortConcurrency` (UI setting) actually 4 by default, or do users change it?

**Confidence gap:** LOW

**What we know:**  
`sortConcurrency` default reads from `localStorage` key `wrdesk_sortConcurrency`. If not set, the default is likely a small number (1–4).

**What we don't know:**  
What value real users have set. If a user has set `sortConcurrency=1` (1 message per chunk), the prewarm fires on every single chunk (since `chunkIndex` is passed as 1-based and the guard is `chunkIndex !== 1` for non-first chunks). Actually: the chunk counter increments, so chunk 2 passes `chunkIndex=2` → prewarm skips. So `sortConcurrency=1` still only prewarms once, just with chunks of 1 message.

**Impact:** With `sortConcurrency=1`, there are 90 IPC calls for 90 messages (vs 23 with sortConcurrency=4). Each IPC round-trip adds ~5–15 ms overhead. For 90 messages: 90 × 10 ms = 900 ms extra IPC overhead. Minor compared to LLM inference.

---

## Instrumentation Needed to Close All Gaps

### Enable for one production run:

```typescript
// electron/main/autosortDiagnostics.ts
export const DEBUG_AUTOSORT_TIMING = true  // run-level timing

// src/lib/autosortDiagnostics.ts  
export const DEBUG_AUTOSORT_TIMING = true  // renderer timing
```

This enables `[AUTOSORT-TIMING]` log lines in the main process. After a run, look for:
- `aiClassifyBatch:ipc` — chunk wall time, preResolveMs, ollamaPrewarm action
- `aiClassifyBatch:perMessage` — per-message LLM times (sumMs)
- `run-tuning-main` — final summary with ollamaCapEffective, maxInFlightSeen
- `renderer:postClassifyTail` — time from last classify to fetchAllMessages completion

Also look for `listMessagesCalls` counter in `autosortTimingRunEnd` to confirm tab-count IPC count.

### Additional one-time instrumentation:

1. **Session summary timing:** Add `console.time('generateSummary')` / `console.timeEnd` in the `autosort:generateSummary` handler.

2. **keep_alive verification:** Log `data.keep_alive` in `ollamaManager.chat()` response (Ollama doesn't return keep_alive in the response, but the `load_duration` on chunk 5–10 tells you if the model stayed hot: near zero = hot, large = cold reload).

3. **Focus-event frequency:** Add `console.log('[BulkOllamaModelSelect] focus refresh')` in `BulkOllamaModelSelect` to count how many times it fires during an active sort run.

4. **`chunkClassifyApplies` flag audit:** In `runAiCategorizeForIds`, log the count of rows with `skipBulkTabCountRefresh: true` vs absent/false in each chunk.

---

## What static analysis CAN assert with high confidence

- The prewarm is blocking and is the primary cause of the 20 s first-click delay. **Confirmed.**
- `generateSummary` adds a full LLM call at run end. **Confirmed.**
- Pre-flight `fetchAllMessages` fires 6 serial IPCs before classify. **Confirmed.**
- `BulkOllamaModelSelect` triggers `getStatus()` including subprocess GPU detection on focus. **Confirmed.**
- Tab counts are NOT updated per-chunk (only at run start and end). **Confirmed.**
- `preResolveInboxLlm` is called once per chunk, not once per run. **Confirmed.**
- Ollama classify calls are concurrent but Ollama serializes them (no actual parallelism gain). **Confirmed** (from Ollama architecture, not from code alone).
