# Inbox UI Refresh Analysis

## Verified Data Flow

- **Visible list (normal inbox):** `useEmailInboxStore` holds `messages`, `total`, `tabCounts`. They are loaded only through **`fetchMessages()`** → **`loadPagedListSnapshot()`**, which calls **`window.emailInbox.listMessages(...)`** (IPC `inbox:listMessages`) against **SQLite** with the current `filter`, pagination (`limit`/`offset`), and related scope fields (`sourceType`, `messageKind`, `search`, etc.).
- **Source of truth:** The **local DB** (`inbox_messages` via main-process handlers). The renderer does not hold an independent feed; **`messages` is a cached page** from the last successful `listMessages` for the active filter.
- **`listMessages` (renderer):** Invoked inside `loadPagedListSnapshot` / `loadBulkInboxSnapshotPaginated` / `loadMoreBulkMessages` / tab count helpers — always through the preload **`emailInbox.listMessages`** bridge.
- **`refreshMessages()`:** `refreshMessages` → if bulk mode then `fetchAllMessages({ soft: true })`, else **`fetchMessages()`** (see `useEmailInboxStore.ts` ~797–801).

## Verified Post-Sync Flow

- **Manual Pull / `inbox:syncAccount` from UI:** Main `ipc.ts` handler runs the pull, then if **`result.newMessages > 0`** it calls **`sendToRenderer('inbox:newMessages', result)`** (~2368–2374). The store’s **`syncAccount`** path also **reloads** the inbox after success via **`loadPagedListSnapshot` / `loadBulkInboxSnapshotPaginated`** (~1271–1320), so the UI updates even without relying on the event.
- **DB-driven auto-sync (`startAutoSync` in `syncOrchestrator.ts`):** Registered from **`startStoredAutoSyncLoopIfMissing`** with **`(r) => broadcastInboxNewMessagesFromAutoSync(r)`** (`ipc.ts` ~374–378). **`broadcastInboxNewMessagesFromAutoSync`** sends **`inbox:newMessages`** to all windows when **`result.newMessages > 0`** (~350–358).
- **Renderer subscription:** `EmailInboxView.tsx` and **`EmailInboxBulkView.tsx`** register **`window.emailInbox.onNewMessages`** and call **`fetchMessages()` / `refreshMessages()`**, unless **`useEmailInboxStore.getState().syncing`** is true (then the handler **returns early** and does not refresh).

**Verified gap:** The **IMAP brute-force 2-minute `setInterval`** (`ipc.ts` ~4818–4843) calls **`syncAccountEmails(db, { accountId })`** only. It does **not** call **`broadcastInboxNewMessagesFromAutoSync`**, **`sendToRenderer('inbox:newMessages', ...)`**, or any store. So when this path ingests mail, **SQLite updates** but the **renderer receives no `inbox:newMessages` event** and **does not run `fetchMessages`**.

**Inference (narrow):** If “background sync” refers only to OAuth/Gmail-style **`startAutoSync`**, the UI *should* get `inbox:newMessages` when `newMessages > 0`. If it still does not refresh, check **`syncing === true`** blocking the `onNewMessages` handler, or **`newMessages === 0`** in the result (then broadcast is skipped by design).

## Verified “All” Tab Behavior

- **Toolbar:** `EmailInboxToolbar` tab buttons call **`onFilterChange({ filter: tab })`** (e.g. `filter: 'all'`) — see ~94–95.
- **Store:** **`setFilter(partial)`** updates `filter`, resets `bulkPage` / `multiSelectIds`, then:
  - **Normal inbox (`!bulkMode`):** **`void get().fetchMessages()`** always (~880–881).
  - **Bulk:** **`fetchAllMessages({ soft: ... })`** when tab/scope changes (~885).
- **Effect:** Clicking **“All”** (or any workflow tab) **forces a new `listMessages` round-trip** and replaces **`messages`** with a fresh snapshot. That is why new rows that already exist in the DB **appear immediately** after a tab interaction, even when no sync event ran.

## First Concrete UI Refresh Breakpoint

| Item | Detail |
|------|--------|
| **File** | `apps/electron-vite-project/electron/main/email/ipc.ts` |
| **Symbol / region** | **`setInterval`** block labeled **“IMAP Auto-Sync (brute force)”** (~4818–4843) |
| **Why UI stays stale** | **`syncAccountEmails`** completes and writes to the DB, but **no `inbox:newMessages` broadcast** and **no renderer `fetchMessages`** are triggered. The Zustand **`messages` array is unchanged** until something calls **`fetchMessages`** / **`refreshMessages`** (e.g. tab **`setFilter`**, mount **`useEffect`**, or **`onNewMessages`**). |

## Most Likely Root Cause

- **Diagnosis:** For **IMAP**, background pulls use a **separate timer** that **only** runs **`syncAccountEmails`** in the main process. Unlike **`inbox:syncAccount`** and unlike **`startAutoSync`**, this path **never notifies the renderer**, so the inbox list **stays on the last loaded page** until user action triggers **`setFilter`** or another refresh.

- **Label:** **Verified** for the IMAP interval path (code inspection). **Inference** if your “background sync” is exclusively OAuth `startAutoSync` — then the cause may differ (e.g. `syncing` guard, or `newMessages` not incremented).

## Minimal Fix

- **Intent:** After each successful **`syncAccountEmails`** in the IMAP **`setInterval`** loop, when **`result.newMessages > 0`**, call the existing **`broadcastInboxNewMessagesFromAutoSync(result)`** (same helper as DB auto-sync, `ipc.ts` ~350–358). That reuses **`onNewMessages` → `fetchMessages()`** in **`EmailInboxView` / `EmailInboxBulkView`** with no store refactor.

**Applied in repo:** `ipc.ts` IMAP auto-sync loop now assigns the **`syncAccountEmails`** result and calls **`broadcastInboxNewMessagesFromAutoSync(result)`** after each account pull.

**Exact diff:**

```diff
           try {
-            await syncAccountEmails(db, { accountId: acc.id })
+            const result = await syncAccountEmails(db, { accountId: acc.id })
+            broadcastInboxNewMessagesFromAutoSync(result)
             console.log('[IMAP-AUTO-SYNC] Pull completed for:', acc.id)
```

**Note:** `broadcastInboxNewMessagesFromAutoSync` already **no-ops when `result.newMessages <= 0`**, matching manual IPC behavior.

**Explicit call-outs (as requested):**

- The **store does not automatically reload** after background sync unless **`onNewMessages`** fires or the user triggers **`setFilter` / `fetchMessages`** / etc.
- **Clicking “All”** causes **`fetchMessages()`** via **`setFilter`**; that **should** happen automatically after background sync **if** the main process broadcasts **`inbox:newMessages`** (or if the UI polls — it does not for this path).
- The UI **depends on filter change or `onNewMessages`** to replace **`messages`**; **IMAP interval sync** currently updates **DB only**, not the **store dependency chain** for the visible list.
