# 04 — Renderer, Store, and Refresh Analysis

**Files traced:**
- `src/components/EmailInboxBulkView.tsx`
- `src/stores/useEmailInboxStore.ts`
- `src/lib/autosortDiagnostics.ts`

---

## 1. Zustand Store Shape (auto-sort relevant state)

```typescript
// useEmailInboxStore.ts ~193–352
{
  // Core inbox state
  allMessages: InboxMessage[]
  messages: InboxMessage[]          // current page
  total: number
  tabCounts: InboxTabCounts         // { all, urgent, pending_delete, pending_review, archived }
  loading: boolean
  bulkBackgroundRefresh: boolean    // true during soft fetchAllMessages
  bulkHasMore: boolean
  bulkMode: boolean

  // Sort state
  isSortingActive: boolean          // set by setSortingActive()
  analysisRestartCounter: number    // incremented by triggerAnalysisRestart() at run end

  // Sort apply methods
  applyBulkClassifyMainResultsToLocalState(rows)  → { missingFromCurrentPage }
  applyBulkAutosortLocalPendingDelete(ids, …)
  applyBulkAutosortLocalPendingReview(ids, …)
  applyBulkAutosortLocalArchive(ids)
  applyClassifyMainResultToLocalState(r)

  // Refresh methods
  refreshBulkTabCountsFromServer()   → 5 serial listMessages
  fetchAllMessages({ soft?, skipTabCountFetch? })
  refreshMessages()
  fetchMatchingIdsForCurrentFilter() → paginated listMessageIds
}
```

### Key state not in the store

- `aiSortProgress: AiSortProgressState | null` — **React state in `EmailInboxBulkView`**, not Zustand
- `sortConcurrency: number` — React state, persisted to `localStorage`
- `bulkOllamaParallel: number` — React state, persisted to `localStorage`
- `isSortingRef: React.MutableRefObject<boolean>` — synchronous guard ref, not state
- `sortStopRequestedRef`, `sortPausedRef` — control refs

The split between Zustand (`isSortingActive`) and React ref (`isSortingRef`) is intentional: `isSortingRef` provides synchronous read-before-await protection; Zustand propagates to consumers. Both are set at the same time in `handleAiAutoSort`.

---

## 2. Progress Updates During the Run

### What drives the progress bar

```typescript
// EmailInboxBulkView.tsx ~1900
const [aiSortProgress, setAiSortProgress] = useState<AiSortProgressState | null>(null)
```

Updated:
- **Phase 0:** `handleAiAutoSort` sets `{ done:0, total:0, label: 'Gathering messages…' }`
- **After ID gather:** `{ done:0, total: N, label: 'Analyzing N messages…' }`
- **After each chunk:** `setAiSortProgress({ done: doneAfterBatch, total: N, phase: 'sorting', … })`
- **During summary:** `{ phase: 'summarizing' }` (progress bar goes to 100%)
- **Finally block:** `setAiSortProgress(null)` — removes bar

### Width calculation

```typescript
width: aiSortProgress.phase === 'summarizing'
  ? '100%'
  : `${Math.round((done / Math.max(total, 1)) * 100)}%`
```

During the `generateSummary` phase (5–60 s of LLM work), the bar shows 100% but is not removed. Users see a frozen full bar with label "Summarizing…". This creates the impression the UI is hung.

### React re-renders per chunk

Each chunk triggers:
1. `applyBulkClassifyMainResultsToLocalState(rows)` → single Zustand `set()` → one React re-render for all consumers
2. `setBulkAiOutputs(updates)` → React state update → re-render of output cells
3. `setAiSortProgress(...)` → React state update → re-render of progress bar

For 23 chunks (90 messages, size 4): 23 × 3 = 69 React state updates. Each triggers a re-render of the bulk grid. With `useShallow`, consumers only re-render when their specific slice changes. This is acceptable.

### `isSortingActive` grid tint

```typescript
// EmailInboxBulkView.tsx ~6066
<div className={`bulk-view-grid ${isSortingActive ? 'bulk-view-grid--analyzing' : ''}`}>
```

The CSS class is added/removed based on `isSortingActive` from Zustand. This causes a class change on the grid div on run start and run end. Not a performance concern.

---

## 3. Row Apply Behavior (Per-Chunk)

### `commitBulkClassifyMainResultsToLocalState` (store)

```typescript
// useEmailInboxStore.ts ~656
function commitBulkClassifyMainResultsToLocalState(set, rows) {
  set((s) => {
    // 1. Map results to updated row shapes
    // 2. Apply filter (rows leaving current tab are dropped from messages[])
    // 3. If !skipBulkTabCountRefresh: fire fetchBulkTabCountsServer (5 async IPCs)
    // 4. Return updated allMessages, messages, total, tabCounts (if updated)
  })
  return { missingFromCurrentPage }
}
```

### The `skipBulkTabCountRefresh` flag

Every `ClassifyMainRowPayload` row in a batch chunk is marked `skipBulkTabCountRefresh: true` by the renderer before calling `applyBulkClassifyMainResultsToLocalState`.

**Source:** `EmailInboxBulkView.tsx` ~2827–2844 (building `chunkClassifyApplies`).

When ALL rows in a chunk have `skipBulkTabCountRefresh: true`, the store does NOT call `fetchBulkTabCountsServer` inside the Zustand transaction. Tab counts are only updated at end-of-run `fetchAllMessages`.

**Critical question:** Is it possible for `skipBulkTabCountRefresh: false` to reach this path?

Looking at the code: the `chunkClassifyApplies` array is built from the classify results. Every row added to `chunkClassifyApplies` appears to receive `skipBulkTabCountRefresh: true` in the current code. If this flag were absent or false for any row, the store would fire 5 additional tab-count IPCs per chunk — 23 × 5 = 115 extra `listMessages` calls for a 90-message run.

**Risk:** If a future refactor removes the `skipBulkTabCountRefresh: true` flag from the batch apply path (e.g., by reusing a shared helper that doesn't set it), the per-chunk tab-count storm returns.

### `applyFilter` called per chunk

Inside the Zustand transaction, `applyFilter(s.messages.map(mapRow))` is called to filter out messages that no longer belong to the current tab. For large `messages` arrays, this is an O(n) operation per chunk. With 23 chunks and 90 messages per page, this runs 23 times on an array of up to 90 elements — entirely acceptable.

---

## 4. Tab Count Behavior

### Current design

Tab counts are NOT updated per-chunk. They are refreshed only:
1. At run start: via `fetchAllMessages` in `handleAiAutoSort`
2. At run end: via `fetchAllMessages` in `runAiCategorizeForIds`

During the run, the tab badges show stale numbers (the count at run start). Messages that get sorted out of a tab appear to leave the grid (via `applyFilter`) but the tab badge number doesn't decrease until end-of-run.

**Is this a product regression?** The comment in the source at line ~99 says:
```
* Mid-run: no tab-count IPC (was every ~2 chunks + duplicated end snapshot).
```
This implies the old behavior was tab counts per ~2 chunks. The current design deliberately removed this in favor of a single end refresh. The regression is that the end refresh can be delayed by 5–60 s (session summary) after all visual classification is done.

### `fetchBulkTabCountsServer` (5 serial IPCs)

```typescript
// useEmailInboxStore.ts ~785
async function fetchBulkTabCountsServer(baseFilter) {
  for (const f of ['all', 'urgent', 'pending_delete', 'pending_review', 'archived']) {
    const res = await trackedListMessages(bridge, {
      ...listBridgeOptionsFromFilter({ ...baseFilter, filter: f }),
      limit: 1, offset: 0,
    })
    out[f] = res?.total ?? 0
  }
}
```

This is 5 sequential `await` calls — each waits for the previous to complete. Even though each query is fast (SQLite COUNT), the sequential IPC overhead accumulates. A parallel implementation (`Promise.all`) would reduce this from ~50 ms to ~10 ms.

---

## 5. End-of-Run Refresh Behavior

### What happens after all chunks are processed

```
runAiCategorizeForIds finally block (when manageConcurrencyLock: false):
  1. autosortDiagSync({ bulkSortActive: false })  → IPC
  2. triggerAnalysisRestart()                      → Zustand set

runAiCategorizeForIds try block (after retry, before finally):
  3. fetchAllMessages({ soft: true, skipTabCountFetch: false })
     → loadBulkInboxSnapshotPaginated
       → fetchBulkTabCountsServer  [5 serial IPCs]
       → listMessages [1 IPC]

handleAiAutoSort after runAiCategorizeForIds returns:
  4. sessionApi.getSessionMessages(sessionId)  [1 IPC]
  5. [setAiSortProgress({ phase: 'summarizing' })]
  6. sessionApi.generateSummary(sessionId)  [1 IPC → LLM call]
  7. setAutosortReviewBanner(...)

handleAiAutoSort finally:
  8. isSortingRef.current = false
  9. setSortingActive(false)
  10. setAiSortProgress(null)  → progress bar removed
```

**Timeline perception issue:** Step 3 (inbox refresh) happens BEFORE step 6 (session summary). But step 6 is slow. The grid shows fresh data, but the progress bar stays frozen at 100% with "Summarizing…" for 5–60 additional seconds. Users experience this as "the app is stuck."

---

## 6. Completeness Retry Path

### When does it fire?

After the main chunk loop, if any results have `error` property (timeout, llm_error, parse_failed, etc.):

```
if (!isRetry && !sortStopRequestedRef.current && toRetry.length > 0) {
  retryResult = await runAiCategorizeForIds(
    toRetry, false, true,
    { manageConcurrencyLock: false, skipEndRefresh: true, sortRunId, diagAcc: runDiag },
    sessionId
  )
}
```

The retry:
- Uses `skipEndRefresh: true` so it does NOT call `fetchAllMessages` at the end
- Uses `manageConcurrencyLock: false`
- After retry completes, the outer run checks: `if (manageConcurrencyLock && skipEndRefresh)` → false for toolbar runs
- So the tab refresh block is NOT entered from the toolbar run's retry

**Result:** Retry adds additional LLM calls for failed messages without any extra refresh overhead. Correct behavior.

**Risk:** If `toRetry.length` is large (e.g., Ollama was down briefly), the retry adds significant time. But this is correctness-preserving, not a regression.

---

## 7. `analysisRestartCounter` and Preload Queue

`triggerAnalysisRestart()` increments `analysisRestartCounter`. This is consumed by effects in the app that watch this counter to restart preloading or advisory analysis streams. It fires once at end of every run, including after the retry.

Effect on performance: minimal — just sets a counter that kicks background preload work. Not a hot-path concern.

---

## 8. `isSortingActive` State Machine — Dual Lock Risk

Two separate "I am busy" signals coexist:

| Signal | Type | Set by | Cleared by |
|--------|------|--------|-----------|
| `isSortingRef.current` | React ref | `handleAiAutoSort` directly | `handleAiAutoSort` finally |
| `isSortingActive` (Zustand) | Store state | `handleAiAutoSort` via `setSortingActive(true)` | `handleAiAutoSort` finally via `setSortingActive(false)` |

**Problem:** `runAiCategorizeForIds` with `manageConcurrencyLock: false` (toolbar path) does NOT clear either signal in its own `finally` block. It fully depends on `handleAiAutoSort` to clear them.

**If `handleAiAutoSort` throws before calling `finally`**: the `finally` block always runs in a `try/catch/finally`, so in practice this is safe. However, this is subtle architecture that future developers could break by adding early returns or by refactoring the ownership of the lock.

**Per-row Retry button** (`runAiCategorizeForIds([msg.id], false)` at line 4403): This call uses the default `manageConcurrencyLock: true`, so the function owns the lock. This is correct and independent of the toolbar flow.

---

## 9. `BulkOllamaModelSelect` — Refresh on Focus (Active During Run)

```typescript
// BulkOllamaModelSelect.tsx ~75
useEffect(() => {
  const onFocus = () => { void refresh() }
  window.addEventListener('focus', onFocus)
  return () => window.removeEventListener('focus', onFocus)
}, [refresh])
```

`refresh()` calls `window.llm.getStatus()`. This component is mounted inside the bulk status dock whenever `aiSortProgress !== null` (the dock is visible during a run). Therefore:

- During any active Auto-Sort run, every window focus triggers `getStatus()`.
- `getStatus()` runs the expensive subprocess chain in the main process (see Bottleneck #4).
- The component is NOT disabled when a sort is running (the `disabled` prop is not passed from the dock, only from an explicit override). Actually looking at the dock JSX:

```typescript
// EmailInboxBulkView.tsx ~5843
<BulkOllamaModelSelect variant="progress" />
```

No `disabled` prop is passed. So the component is always enabled (not `disabled`). However, the underlying `onChange` handler for model switching is just blocked by `disabled` on the `<select>` — but the `refresh()` on focus still fires regardless.

**Result:** During a 3-minute sort run, if the user alt-tabs even once, the main process runs `wmic path win32_VideoController get Name` (5 s Windows timeout) competing with classify work.
