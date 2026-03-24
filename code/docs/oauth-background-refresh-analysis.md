# OAuth Background Refresh Analysis

## Verified Store Data Flow

- `useEmailInboxStore` holds **`messages`**, **`total`**, **`tabCounts`**, **`loading`**, **`filter`**, etc.
- **`fetchMessages()`** (normal inbox) sets **`loading`** and loads **`loadPagedListSnapshot(get)`** → IPC **`listMessages`** → **`set({ messages, total, tabCounts, … })`** (`useEmailInboxStore.ts` ~650–684).
- **`refreshMessages()`** dispatches to **`fetchAllMessages({ soft: true })`** in bulk mode or **`fetchMessages()`** otherwise (~806–810).
- **`setFilter(partial)`** merges **`filter`**, resets **`bulkPage`**, then **`void get().fetchMessages()`** (non-bulk) or **`fetchAllMessages`** (bulk) (~872–895).
- **`EmailInboxView`** / **`EmailInboxBulkView`** render from the same store; the visible list is whatever **`messages`** is after the last successful load.

## Verified Post-Sync Refresh Flow

**Main → renderer (verified in `ipc.ts` + `preload.ts`):**

- After background auto-sync (`startAutoSync` → `onSyncComplete`), **`broadcastInboxSnapshotAfterSync`** sends **`webContents.send('inbox:newMessages', payload)`** for every window (`ipc.ts` ~356–373).
- Preload registers **`ipcRenderer.on('inbox:newMessages', …)`** and invokes the renderer callback (`preload.ts` ~693–696).

**`EmailInboxView` / `EmailInboxBulkView` (verified):**

- **`onNewMessages`** subscription (`EmailInboxView.tsx` ~1429–1438; **Bulk** ~1645–1654):
  - If **`useEmailInboxStore.getState().syncing`** → **`markPendingInboxRefreshAfterSyncEvent()`** and **`return`** (**no `fetchMessages` / `refreshMessages`**).
  - Else → **`void fetchMessages()`** or **`void refreshMessages()`**.
- **Flush effect** (`EmailInboxView.tsx` ~1440–1445; **Bulk** ~1656–1661): when **`syncing`** becomes **`false`**, if **`pendingInboxRefreshAfterSyncEvent`** → clear flag and **`fetchMessages()`** / **`refreshMessages()`**.

**What should happen:** each **`inbox:newMessages`** should eventually drive **`fetchMessages()`** (directly or via pending + flush when **`syncing`** clears).

**What matches “stale until folder/tab”:** **`setFilter`** always calls **`fetchMessages()`** without checking **`syncing`** (store ~872–895). **Folder/tab** in **`EmailInboxToolbar`** uses **`onFilterChange({ filter: tab })`** → **`setFilter`** → **`fetchMessages()`** — **verified** bypass of the **`onNewMessages`** deferral path.

## Verified Navigation / Folder Refresh Behavior

- **Folder / workflow tab:** **`EmailInboxToolbar`** `onClick` → **`onFilterChange({ filter: tab })`** → **`setFilter`** → **`fetchMessages()`** (normal) or **`fetchAllMessages`** (bulk). **Verified** — does **not** depend on **`onNewMessages`** or **`pending`**.
- **Switching another top-level app view** (`App.tsx`): when **`activeView !== 'beap-inbox'`**, **`EmailInboxView` / `EmailInboxBulkView` unmount** → **`onNewMessages` listener removed**. Returning to **BEAP Inbox** **remounts** the view; **`useEffect(() => { fetchMessages() }, [fetchMessages])`** runs on mount (**`EmailInboxView.tsx` ~1425–1427**, **`EmailInboxBulkView.tsx` ~2364–2366**). **Verified** — remount **always** reloads the list from the DB.

## First Concrete Refresh Breakpoint

- **File:** `apps/electron-vite-project/src/components/EmailInboxView.tsx` (and the same pattern in **`EmailInboxBulkView.tsx`**).
- **Symbol:** the **`onNewMessages`** subscription callback — **`if (useEmailInboxStore.getState().syncing) { markPending…; return }`**.
- **Why the UI stays stale:** while **`syncing === true`**, **`inbox:newMessages` does not call `fetchMessages()`**; refresh only happens later if the **`[syncing, fetchMessages]`** flush effect runs with **`pendingInboxRefreshAfterSyncEvent`** set. **Folder/tab** and **remount** call **`fetchMessages()`** through **`setFilter`** or mount effects **without** that gate — so the UI **catches up** even when the event-driven path is deferred or the flush is unreliable.

## Most Likely Root Cause

- **Inference:** Background sync completes and **`inbox:newMessages`** fires, but **`syncing` is still `true`** (e.g. manual Pull / Sync in progress or **`syncing` not yet cleared** after a long **`await loadPagedListSnapshot`** in **`syncAccount`**). The handler **only** sets **`pending`** and **returns**, so **no immediate list reload**. **Inference:** If the flush effect does not run (ordering, **`syncing` stuck**, or a missed transition), **pending** never flushes. **Separate inference:** If the user leaves **BEAP Inbox**, **`onNewMessages` is not subscribed** while the inbox is unmounted; **that** explains catch-up only after **returning** to the inbox (remount fetch), not folder clicks while staying on inbox.

## Minimal Fix

- **Change:** In **`EmailInboxView.tsx`** and **`EmailInboxBulkView.tsx`**, **`onNewMessages` should always call `fetchMessages()` / `refreshMessages()`** and remove the **`syncing` + `pending`** branch and the dependent flush **`useEffect`** (no store refactor required).
- **Rationale:** **`setFilter`** already refreshes regardless of **`syncing`**; aligning **`onNewMessages`** with that avoids the “deferred forever” gap. **Tradeoff:** possible extra **`listMessages`** while a manual pull is in flight (usually acceptable).

---

## Appendix: Diff (applied)

See git diff for `EmailInboxView.tsx` and `EmailInboxBulkView.tsx`: `onNewMessages` unconditional refresh; removed flush effect.
