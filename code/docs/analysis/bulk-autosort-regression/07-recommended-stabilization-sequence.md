# 07 — Recommended Stabilization Sequence

**Goal:** Restore a usable product as quickly as possible. No new features. No architectural rewrites.  
**Approach:** Surgical disables/deferrals only. Verify after each step before proceeding.

---

## Overview

The pipeline is structurally sound. The fixes are targeted changes to 4–5 specific call sites. Each step is independent and can be validated in isolation.

```
Step 1: Fix prewarm blocking (P0)        → fix the 20s first-click symptom
Step 2: Defer generateSummary (P1)       → fix the "frozen at 100%" symptom
Step 3: Remove pre-flight fetchAll (P2)  → reduce startup overhead
Step 4: Fix BulkOllamaModelSelect (P3)   → reduce background interference
Step 5: Extend cache TTL (P4)            → prevent mid-run cache expiry on slow hw
```

---

## Step 1: Fix Prewarm Blocking

**Target:** `electron/main/email/ipc.ts:4464–4474`

**Current code:**
```typescript
if (resolvedLlm.provider.toLowerCase() === 'ollama') {
  ollamaPrewarm = await maybePrewarmOllamaForBulkClassify(resolvedLlm.model, { chunkIndex })
  // ...
}
```

**Proposed change:** Make fire-and-forget on chunk 1; keep diagnostic capture on subsequent chunks (where it returns instantly anyway).

```typescript
if (resolvedLlm.provider.toLowerCase() === 'ollama') {
  if (chunkIndex == null || chunkIndex === 1) {
    // Fire-and-forget: don't await — let model load in parallel with first classify
    void maybePrewarmOllamaForBulkClassify(resolvedLlm.model, { chunkIndex })
    ollamaPrewarm = undefined  // no diagnostic data (was blocking anyway)
  }
  // Non-first chunks: already returns instantly (skipped_not_first_chunk / skipped_cooldown)
}
```

**Alternative (stronger):** Remove the prewarm call entirely.

```typescript
// Remove: ollamaPrewarm = await maybePrewarmOllamaForBulkClassify(...)
// Ollama cold-load is absorbed by the first classify call's keep_alive: '15m'
```

**What to validate:**
- First click: progress should appear within 1–2 s (no 20 s hang)
- Classification should complete at the same rate as before (or faster, since Ollama isn't sequentialized by the prewarm)
- Second run: same behavior (prewarm cooldown is irrelevant if prewarm is fire-and-forget)

**What NOT to break:** The `batchRuntime.ollamaPrewarm` diagnostics field returned to the renderer. If prewarm is removed, this field will be `undefined`. The renderer already handles this case (`batchRuntime?.ollamaPrewarm` optional chaining).

---

## Step 2: Defer `generateSummary` to On-Demand

**Target:** `src/components/EmailInboxBulkView.tsx` — `handleAiAutoSort` ~3605–3660

**Current code:**
```typescript
if (sessionId && sessionApi?.getSessionMessages && sessionApi.finalize && sessionApi.generateSummary) {
  const sessionMessages = await sessionApi.getSessionMessages(sessionId)
  // ... build stats ...
  setAiSortProgress({ ..., phase: 'summarizing' })
  await sessionApi.generateSummary(sessionId)  // ← REMOVE THIS from hot path
  setAutosortReviewBanner({ sessionId, fading: false })
}
```

**Proposed change:**
```typescript
if (sessionId && sessionApi?.finalize) {
  const sessionMessages = await sessionApi.getSessionMessages(sessionId)
  // ... build stats ...
  await sessionApi.finalize(sessionId, stats)
  setAutosortReviewBanner({ sessionId, fading: false })
  // generateSummary is now deferred — session review loads it on demand
  // void sessionApi.generateSummary?.(sessionId)  // optional: fire background
}
```

If the session review modal needs the summary when opened, `generateSummary` can be called there instead:
- When user opens `AutoSortSessionReview`, check `ai_summary_json` in the session record
- If null: call `generateSummary` then and show a loading state

**What to validate:**
- Run completes immediately after `finalize` — progress bar removes within 1–2 s of last classify
- Session review opens and shows session data (individual message results visible)
- Summary is absent until user opens the review (acceptable degradation, no feature loss)

**What NOT to break:**
- `autosortReviewBanner` should still appear after the run
- Session record should still be in `completed` state (finalize still runs)

---

## Step 3: Remove Pre-Flight `fetchAllMessages` from `handleAiAutoSort`

**Target:** `src/components/EmailInboxBulkView.tsx` — `handleAiAutoSort` ~3546–3548

**Current code:**
```typescript
if (bulkBatchSize === 'all') {
  await useEmailInboxStore.getState().fetchAllMessages({ soft: true })  // ← REMOVE
  targetIds = [...new Set(await useEmailInboxStore.getState().fetchMatchingIdsForCurrentFilter())]
}
```

**Proposed change:**
```typescript
if (bulkBatchSize === 'all') {
  targetIds = [...new Set(await useEmailInboxStore.getState().fetchMatchingIdsForCurrentFilter())]
}
```

`fetchMatchingIdsForCurrentFilter()` already queries the DB for all matching IDs via `listMessageIds` (which uses the correct filter). The pre-flight `fetchAllMessages` was loading the first page and refreshing tab counts before any classify work — data that becomes stale during the run and is refreshed again at the end.

**What to validate:**
- "All" mode correctly picks up all N messages matching the current filter
- Tab counts show the state at run start (slightly stale is acceptable)
- End-of-run `fetchAllMessages` correctly updates the grid

**What NOT to break:**
- The `total` shown in the progress bar (`Analyzing N messages`) comes from `targetIds.length` after this step, so it still works correctly

---

## Step 4: Fix `BulkOllamaModelSelect` Focus Refresh

**Target:** `src/components/BulkOllamaModelSelect.tsx` — `useEffect` with `window.focus`

**Current code:**
```typescript
useEffect(() => {
  const onFocus = () => { void refresh() }
  window.addEventListener('focus', onFocus)
  return () => window.removeEventListener('focus', onFocus)
}, [refresh])
```

**Proposed change (option A — remove focus listener):**
```typescript
// Remove the focus listener entirely
// Freshness is handled by the onActiveModelChanged event listener below
```

The `onActiveModelChanged` listener already handles model switch events. The focus listener was belt-and-suspenders.

**Proposed change (option B — throttle / skip during sort):**
```typescript
useEffect(() => {
  const onFocus = () => {
    // Skip refresh during active sort run to avoid main-process interference
    const sortingActive = useEmailInboxStore.getState().isSortingActive
    if (!sortingActive) void refresh()
  }
  window.addEventListener('focus', onFocus)
  return () => window.removeEventListener('focus', onFocus)
}, [refresh])
```

Option B requires importing the store into `BulkOllamaModelSelect`. Option A is simpler.

**What to validate:**
- Model picker updates when user changes model in settings (via `onActiveModelChanged`)
- No spurious `getStatus()` calls during a sort run (check main-process logs)

---

## Step 5: Extend `listModels` TTL (Preventive)

**Target:** `electron/main/llm/ollama-manager.ts:52`

**Current:**
```typescript
private readonly MODELS_CACHE_TTL_MS = 120_000
```

**Proposed:**
```typescript
private readonly MODELS_CACHE_TTL_MS = 600_000  // 10 minutes
```

Models don't change during a classify run. 10 minutes is a safe TTL for the auto-sort use case. If a user installs/removes a model, `invalidateModelsCache()` handles that immediately.

**What to validate:**
- Model install → immediately appears (invalidateModelsCache is called on pullModel)
- Model switch → immediately applies (invalidateModelsCache is called on setActiveModelPreference)
- No stale model data after 10 minutes (models don't install themselves)

---

## Validation Sequence After Each Step

After each step, test this specific sequence:

1. **Cold start test:** Restart the app, wait >2 minutes (to ensure model evicts if not running). Click AI Auto-Sort.
   - Expected with Step 1: First message starts classifying within 1–2 s of click
   - Expected with Step 2: Progress bar removes within 1 s of last message classified
   - Expected with Step 3: "Gathering messages…" phase is brief (<100 ms visible)

2. **Second-run test:** Run again immediately after the first run completes.
   - Expected: All steps proceed quickly (model resident, caches warm)

3. **Long-run test:** Sort all messages in a large inbox (500+).
   - Expected: Run proceeds without interruption at the 2-minute mark
   - Expected with Step 5: No cache miss interruption

4. **Mid-run model switch test:** Change the model in `BulkOllamaModelSelect` during an active run.
   - Expected: Current chunk continues with old model; next chunk uses new model
   - Expected with Step 1 removed: No additional delay from prewarm bypass

---

## What to Defer / Revisit Later

| Item | Why defer |
|------|-----------|
| Parallelize `fetchBulkTabCountsServer` (5 serial → Promise.all) | Minor gain; requires careful testing of store update race |
| Re-architect `preResolveInboxLlm` as once-per-run | Requires renderer-side change and new IPC parameter; higher complexity |
| Remove 3-write-per-message DB pattern (batch writes) | Negligible gain; high refactor cost |
| Remote drain rate tuning (10 s → faster) | Product decision, not a regression fix |
| True Ollama parallelism via `num_parallel` | Requires Ollama config; out of app scope |
| Session review feature removal | This is product scope, not regression scope |

---

## Expected Outcome After All 5 Steps

| Symptom | Before | After |
|---------|--------|-------|
| First click to first classify | 10–25 s | 1–3 s |
| Progress bar "frozen at 100%" | 5–60 s | 0 s (bar removes promptly) |
| Pre-flight delay before "Analyzing N…" | 100–500 ms | <50 ms |
| Main process load during focus events | 5–7.5 s per focus | ~10–50 ms per focus |
| Model cache expiry mid-run (long runs) | Risk at 2 min | Risk at 10 min |

The dominant cost — actual LLM inference time — is unchanged. A 90-message run on CPU hardware still takes minutes. But:
- The run **feels** fast because progress starts immediately
- The run **ends** promptly (no post-classify freeze)
- The run is **predictable** (no intermittent spikes from background GPU detection)
