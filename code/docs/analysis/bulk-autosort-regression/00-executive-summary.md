# 00 — Executive Summary: Bulk Auto-Sort Regression Forensic Report

**Date:** 2026-04-01  
**Scope:** `apps/electron-vite-project` — inbox AI Auto-Sort pipeline  
**Status:** Analysis only. No patches applied.

---

## Why the product now feels broken

The bulk Auto-Sort pipeline has accumulated at least six distinct sources of overhead through recent refactors, several of which compound each other. The result is a system where:

- The **first click triggers a serial, blocking model warm-up** that can consume 10–20 s before a single message is classified.
- **Every run fires an expensive pre-flight** (5–7 sequential IPC round-trips to gather IDs and tab counts) before LLM work starts.
- **An additional LLM call is made at the end of every run** (session summary generation) that the user did not explicitly request and that adds another full inference latency.
- The **`BulkOllamaModelSelect` component hits an expensive GPU-detection subprocess** (Windows: `wmic`, 5 s timeout) on every window focus event, which fires multiple times during a long run.
- The pipeline **ends with another full 6-serial-IPC snapshot** (`fetchAllMessages`) regardless of whether the UI actually needs it.
- The **concurrency model is internally contradictory**: the UI sends up to 4 messages per IPC chunk and the main process sends all 4 to Ollama simultaneously, but Ollama serializes them internally — delivering no throughput gain while adding internal queue pressure.

None of these individually is fatal. Together they turn a 15-second, 90-message run into a multi-minute ordeal.

---

## Top root causes — ranked by impact and confidence

| Rank | Root Cause | Impact | Confidence |
|------|-----------|--------|------------|
| 1 | **Blocking prewarm in first chunk** (`maybePrewarmOllamaForBulkClassify`) waits for a full Ollama LLM response before releasing to real classify work. On cold model: 10–20 s dead time before message 1. | Very high | Confirmed |
| 2 | **Pre-flight ID-gather is overweight**: `fetchAllMessages` → 5 sequential `listMessages` + 1 + `fetchMatchingIdsForCurrentFilter` paginated loop fires before the first classify. Adds 300 ms–2 s per run before LLM starts. | High | Confirmed |
| 3 | **Session summary LLM call at end of every run** (`autosort:generateSummary`) — a second full inference added by the session-tracking refactor. Adds another 5–30 s depending on model and message count. | High | Confirmed |
| 4 | **`BulkOllamaModelSelect` calls `llm:getStatus` on every window focus** — which runs `wmic` + `nvidia-smi` subprocesses (5 s + 2.5 s Windows timeouts) on a 45 s TTL. During a multi-minute run this fires multiple times on the main process, competing with classify work. | High | Confirmed |
| 5 | **End-of-run `fetchAllMessages`** (6 more serial IPCs: 5 tab-count queries + 1 page query) added after classification even for runs where the UI already has fresh state. | Medium–High | Confirmed |
| 6 | **Ollama concurrency model is wrong for local hardware**: 4 messages sent concurrently per chunk, but Ollama serializes them. No throughput gain; actual throughput is identical to sequential, with added scheduler noise. The chunk size and Ollama parallel cap are user-configurable but default to a value that provides no benefit on single-GPU/CPU setups. | Medium | Confirmed |
| 7 | **`preResolveInboxLlm` called once per IPC chunk** (not once per run). With 23 chunks for 90 messages, this is 23 potential `listModels` calls. The 120 s TTL cache suppresses most; but on a >2-minute run the cache expires mid-run and a cold `/api/tags` hit occurs. | Medium | Confirmed, partially mitigated by cache |
| 8 | **`classifySingleMessage` does 3 synchronous DB writes per message** (session stamp UPDATE, classification UPDATE, `ai_analysis_json` UPDATE) plus a remote-queue INSERT. Under concurrent classify calls these contend on SQLite's write lock. With better-sqlite3 (synchronous) in the main process, this is a serial bottleneck at high concurrency. | Medium | Confirmed |
| 9 | **Completeness-retry path** can fire a second full classify pass on all failed messages, then call `refreshBulkTabCountsFromServer` (5 more serial IPCs), before the outer run does its own `fetchAllMessages`. | Low–Medium | Confirmed, conditional |

---

## Single most urgent stabilization target

**Disable or background the `maybePrewarmOllamaForBulkClassify` blocking call** in `inbox:aiClassifyBatch`.

This is the most directly observable cause of the "first call takes ~20 seconds" complaint. It can be disabled with a one-line change (skip when `chunkIndex === 1` or make it non-blocking via a fire-and-forget background request). It does not affect correctness — it is purely a latency optimization that has become a blocking bottleneck.

---

## Architecture consistency verdict

The pipeline is **logically correct** but **architecturally over-layered**. Results are applied to local state correctly. DB writes are authoritative. The renderer syncs from main-process classify results without a second IPC. However:

- Multiple recent refactors added independent "just in case" refresh/reload steps at the start, middle, and end of each run.
- The session-tracking feature (correct in intent) added a mandatory extra LLM call (`generateSummary`) that was not present when the pipeline was fast.
- The prewarm feature (correct in intent) became a blocking bottleneck rather than a background optimization.
- The `BulkOllamaModelSelect` window-focus refresh (added for freshness) runs GPU subprocess detection during active classify runs, competing with the main process on Windows.

The system does not need a full rewrite. It needs targeted disables/deferrals of the four to five steps that were added in good faith but placed on the blocking hot path.
