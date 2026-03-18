# WR Desk™ — Auto-Sort Runaway Bug: Architecture Analysis

## Executive Summary

**Root cause identified:** The auto-sort `useEffect` in `EmailInboxBulkView.tsx` (lines 1078–1089) runs **without a folder-context guard**. It fires whenever messages load with no analysis, including when the user is viewing **Pending Delete**, **Pending Review**, **Archived**, or **Deleted**. Messages in those folders have `bulkAiOutputs` cleared when they were moved, so `hasAnalysis` is always false → auto-sort re-runs on them → creates a cascading loop.

---

## 1. AUTO-SORT TRIGGER AUDIT

### Call site 1: User-initiated (AI Auto-Sort button)
- **File & line:** `EmailInboxBulkView.tsx` lines 1074–1076
- **Trigger:** User click on "✨ AI Auto-Sort" button
- **Guard:** None needed — explicit user action
- **Re-entry:** N/A

### Call site 2: Automatic (useEffect) — **ROOT CAUSE**
- **File & line:** `EmailInboxBulkView.tsx` lines 1078–1089
- **Trigger:** `useEffect` on `[loading, messages, bulkAiOutputs, runAiCategorizeForIds, aiSortPhase]`
- **When it fires:** When `loading` is false, `messages.length > 0`, no message has analysis, and `aiSortPhase !== 'analyzing'`
- **Guard `userInitiated`:** ❌ None
- **Guard `isSorting` mutex:** ⚠️ Partial — `aiSortPhase === 'analyzing'` blocks during run, but no mutex for rapid re-triggers
- **Guard folder context:** ❌ **MISSING** — runs in **all** folders (Inbox, Pending Delete, Pending Review, Archived, Deleted)
- **Can fire on page load/navigation/folder change:** ✅ Yes — any `messages` or `loading` change can trigger it

```javascript
/** Auto-run AI analysis when messages load and batch has no analysis yet. */
useEffect(() => {
  if (loading || messages.length === 0 || !window.emailInbox?.aiClassifySingle) return
  if (aiSortPhase === 'analyzing') return
  const ids = messages.map((m) => m.id)
  const hasAnalysis = ids.some((id) => {
    const out = bulkAiOutputs[id]
    return !!(out?.category || out?.summary)
  })
  if (hasAnalysis) return
  runAiCategorizeForIds(ids, false)  // ← NO filter.filter check!
}, [loading, messages, bulkAiOutputs, runAiCategorizeForIds, aiSortPhase])
```

---

## 2. EVENT LOOP & CASCADE ANALYSIS

### Cascade chain

1. User in Inbox → 29 messages load, no analysis → auto-sort fires
2. AI classifies → recommends `pending_delete` for many → `addPendingDeletePreview` → 5s countdown
3. Scheduler runs `processExpiredPendingDeletes` → marks messages in DB → `clearBulkAiOutputsForIds(idsToMove)` → `fetchMessages`
4. Messages move out of Inbox; user may switch to Pending Delete tab
5. **Pending Delete view:** `messages` = 29 pending-delete messages; `bulkAiOutputs` = **empty** (cleared in step 3)
6. `hasAnalysis` = false for all → **auto-sort fires again on Pending Delete messages**
7. AI re-analyzes messages already in Pending Delete → recommends `pending_delete` again → new preview timers
8. Multiple Undo banners (1 msg, 2 msgs, …) from repeated batches
9. Loop continues: sort → move → clear outputs → fetch → no analysis → sort again

### Why Pending Delete messages have no analysis

- `processExpiredPendingDeletes` calls `clearBulkAiOutputsForIds(idsToMove)` when moving messages
- Messages in Pending Delete / Pending Review / Archived have therefore had their `bulkAiOutputs` cleared
- The auto-sort effect treats "no analysis" as "needs analysis" and runs again

### Shared component

- Inbox, Pending Delete, Pending Review, Archived, Deleted all use the same `EmailInboxBulkView`
- `messages` comes from the store and is filtered by `filter.filter` on the backend
- The effect has no `filter.filter` check, so it runs for every folder

---

## 3. STATE MANAGEMENT REVIEW

- **`aiSortPhase`:** `'idle' | 'analyzing' | 'reordered'` — blocks during `analyzing`, but no global mutex
- **`isSorting` / `sortInProgress`:** ❌ Not used
- **`lastSortedAt` / processed-ID set:** ❌ Not used
- **Per-folder vs global:** Effect is global; it runs for whatever `messages` are currently shown
- **Reset on error:** `setAiSortPhase('idle')` in catch; `setAiSortProgress(null)` in finally ✅

---

## 4. FOLDER CONTEXT GUARD

- **Whitelist of sortable folders:** ❌ None
- **`currentFolder` / `filter.filter` check:** ❌ None
- **Race on folder change:** Possible — `filter.filter` can change before effect runs; no explicit guard

**Required whitelist:** Auto-sort should run only in inbox-like views:

- `all`, `unread`, `starred` ✅
- `pending_delete`, `pending_review`, `archived`, `deleted` ❌

---

## 5. BATCH PROCESSING LOGIC

- **Batch size:** `CONCURRENCY = 3` — 3 messages analyzed in parallel
- **Moves:** Each message gets `addPendingDeletePreview` / `addArchivePreview` / `addPendingReviewPreview` as it’s classified
- **Scheduler:** Runs every 1s; when previews expire, `processExpiredPendingDeletes` / `processExpiredArchivePreviews` / `processExpiredPendingReviewPreviews` move messages
- **Multiple Undo banners:** Each batch of moved messages creates its own Undo; no single consolidated batch

---

## 6. AUTO-SYNC + AUTO-SORT INTERACTION

- **Auto-sync:** `syncAccount` calls `fetchMessages` after sync
- **Auto-sync polling:** Backend `startAutoSync` runs every 30s; `onNewMessages` can trigger a refresh
- **Flow:** Sync → `fetchMessages` → `messages` update → effect runs if `hasAnalysis` is false
- **Conclusion:** Auto-sync can indirectly trigger auto-sort when new messages arrive with no analysis

---

## 7. PENDING DELETE FOLDER SPECIFICS

- **Type:** Virtual folder (filtered view of `pending_delete = 1`)
- **Moving to Pending Delete:** Sets `pending_delete = 1` in DB; messages stay in same table
- **`clearBulkAiOutputsForIds`:** Called when messages are moved → outputs cleared
- **Re-sort in Pending Delete:** Currently allowed; should be **disabled** — messages there are already triaged

---

## Recommended Fixes (Priority Order)

### Fix 1: Folder whitelist guard (critical)

Add a guard so auto-sort runs only in inbox-like views:

```javascript
const SORTABLE_FILTERS = ['all', 'unread', 'starred'] as const

useEffect(() => {
  if (loading || messages.length === 0 || !window.emailInbox?.aiClassifySingle) return
  if (!SORTABLE_FILTERS.includes(filter.filter as any)) return  // ← ADD THIS
  if (aiSortPhase === 'analyzing') return
  // ... rest unchanged
}, [loading, messages, bulkAiOutputs, runAiCategorizeForIds, aiSortPhase, filter.filter])
```

### Fix 2: Global sort mutex (defense in depth)

Add `isSorting` to avoid overlapping runs:

```javascript
const isSortingRef = useRef(false)
// In runAiCategorizeForIds: if (isSortingRef.current) return; isSortingRef.current = true;
// In finally: isSortingRef.current = false
```

### Fix 3: Optional — require explicit user trigger

Remove the auto-run `useEffect` and rely only on the "AI Auto-Sort" button. This is a larger behavior change and may not be desired.

---

## Testing Checklist

- [ ] Open Inbox with 29 messages — auto-sort does NOT fire without clicking the button (if Fix 3 applied) OR fires only once in Inbox (if Fix 1 only)
- [ ] Click "AI Auto-Sort" — messages sort in one batch, one Undo banner
- [ ] Navigate to Pending Delete — no sort runs, messages stay static
- [ ] Enable Auto-sync — pulling new messages does NOT trigger sort in Pending Delete
- [ ] Return to Inbox from Pending Delete — no automatic sort in non-inbox folders
- [ ] Click "AI Auto-Sort" twice quickly — only one sort cycle runs (with Fix 2)
- [ ] Sort errors mid-batch — mutex releases, no stuck state
- [ ] Refresh during sort — clean restart, no orphaned state
