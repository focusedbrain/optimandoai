# Sync UI Refresh + Timeout Analysis

## Verified Post-Sync Flow

**Data path:** Successful sync **only** mutates **SQLite** (and related main-process state) inside `syncAccountEmails` / `syncAccountEmailsImpl`. The renderer **does not** observe the database directly.

**Notification paths to the UI (main → renderer):**

1. **`inbox:newMessages` IPC event**  
   - **Manual pull:** `inbox:syncAccount` handler sends `sendToRenderer('inbox:newMessages', result)` when **`result.newMessages > 0`** (`ipc.ts` ~2368–2374).  
   - **DB-driven auto-sync (`startAutoSync`):** `onNewMessages` callback runs only when **`result.newMessages > 0`** (`syncOrchestrator.ts` ~795–796), which calls **`broadcastInboxNewMessagesFromAutoSync`**.  
   - **IMAP 2‑minute interval:** After `syncAccountEmails`, **`broadcastInboxNewMessagesFromAutoSync(result)`** is called (`ipc.ts` ~4833–4834).  
   - **Guard inside broadcast:** **`broadcastInboxNewMessagesFromAutoSync` returns immediately if `result.newMessages <= 0`** (`ipc.ts` ~350–351). No event is sent when the sync run ingests **zero new rows** (e.g. all duplicates, or empty list).

**Renderer reaction to `inbox:newMessages`:**  
`EmailInboxView` / `EmailInboxBulkView` subscribe via **`window.emailInbox.onNewMessages`** and call **`fetchMessages()`** / **`refreshMessages()`**, **unless** **`useEmailInboxStore.getState().syncing === true`**, in which case the handler **returns without fetching** (`EmailInboxView.tsx` ~1430–1432).

**Explicit store refresh after UI-initiated sync:**  
`useEmailInboxStore.syncAccount` **reloads** the list from IPC after success (`loadPagedListSnapshot` / bulk snapshot) — **does not apply** to background-only sync that never touches the store.

**Verified conclusion:** Automatic UI refresh after background sync **requires** either **`inbox:newMessages`** (with **`newMessages > 0`**) **or** a manual **`fetchMessages`** path. **SQLite changes alone do not update Zustand.**

---

## Verified Inbox Data Flow

**Source of truth for what the user sees:**

| Layer | Role |
|--------|------|
| **SQLite** | Canonical inbox rows (`inbox_messages`, etc.). |
| **`inbox:listMessages` IPC** | Queries DB in main; returns page + `total`. |
| **Zustand** | **`messages`**, **`total`**, **`tabCounts`** — last successful **`fetchMessages`** / **`fetchAllMessages`** snapshot. |

**How counts and rows load:**  
`fetchMessages` → **`loadPagedListSnapshot`** runs **`fetchBulkTabCountsServer`** (per-tab COUNT-style calls) **and** **`listMessages`** for the current page (`useEmailInboxStore.ts` ~493–524, ~641–674). Same pattern for bulk via **`loadBulkInboxSnapshotPaginated`**.

**Re-render drivers:** Store updates when **`fetchMessages`** / **`refreshMessages`** / **`setFilter`** (which calls **`fetchMessages`**) completes. **Background sync does not change store fields** unless **`onNewMessages`** runs **`fetchMessages`** or the user triggers **`setFilter`**.

**Verified:** Counts and lists are **not** recomputed from DB on a timer; they refresh when **IPC list endpoints** run again after an explicit trigger.

---

## Verified “All” Tab Behavior

**Path:** `EmailInboxToolbar` → **`onFilterChange({ filter: tab })`** → store **`setFilter({ filter: ... })`** (`EmailInboxToolbar.tsx` ~94–95).

**In `setFilter` (normal inbox, `!bulkMode`):** After updating **`filter`** and resetting **`bulkPage`** / **`multiSelectIds`**, the store **always** runs **`void get().fetchMessages()`** (`useEmailInboxStore.ts` ~880–882).

**Effect:** Clicking **“All”** (or any workflow tab) forces a **full re-query** via **`inbox:listMessages`** (and tab counts), replacing **`messages`**, **`total`**, and **`tabCounts`**. That is why the UI **“catches up”** after DB was updated by background sync: the **manual tab action** triggers the **same fetch** that **`onNewMessages`** would trigger **if** it had run.

**Call-out:** **`setFilter` does not check** whether the filter value changed; **`fetchMessages`** still runs for normal mode whenever **`setFilter`** is invoked with any partial update that goes through this branch.

---

## Verified Timeout Points

| Location | Symbol / construct | What it wraps | On expiry |
|----------|---------------------|---------------|-----------|
| `syncOrchestrator.ts` | `syncAccountEmails` | **`Promise.race`** — **`syncAccountEmailsImpl`** vs **45s** reject | **`syncAccountEmails` rejects** with **`syncAccountEmails timed out after 45s`**. **`finally`** clears **`syncChainTimestamps`**. Stored chain promise is normalized to settled (`then(() => undefined, () => undefined)`). |
| `syncOrchestrator.ts` | IMAP folder expand | **30s** race vs **`resolveImapPullFoldersExpanded`** | Reject caught; falls back to **`basePullLabels`** (~487–497). |
| `syncOrchestrator.ts` | `listMessages` (IMAP list phase) | **30s** race vs gateway list | Reject → per-folder error string / merged list may be partial. |
| `syncOrchestrator.ts` | `startAutoSync` | **`setTimeout(tick, intervalMs)`** | Schedules next tick; **`clearTimeout`** on **`stop()`**. |
| `ipc.ts` | `broadcastInboxNewMessagesFromAutoSync` | *(none)* | N/A |
| `ipc.ts` | `inbox:verifyImapRemoteFolders` | **15s** race | Returns **`{ ok: false, error: 'IMAP connection timed out...' }`** (~2145–2156). **Not** on the normal inbox list refresh path. |
| `ipc.ts` | Various LLM handlers | **45s** / **`AbortController`** | LLM-only; **not** inbox list refresh. |
| `EmailInboxView.tsx` | `onNewMessages` | *(none)* | **If `syncing`:** early return — **no `fetchMessages`**. |

**`Promise.race` behavior (Inference, standard JS):** If the **45s** timeout wins in **`syncAccountEmails`**, the **rejection propagates** to callers (e.g. IMAP interval **`catch`**), so **`broadcastInboxNewMessagesFromAutoSync` is not called** for that run. The underlying **`syncAccountEmailsImpl`** promise is **not cancelled** by this race — work may **continue in the main process** without the caller receiving a resolved **`SyncResult`**. **Label: Inference** (typical Promise.race semantics; not instrumented here).

**Electron `ipcRenderer.invoke`:** No app-level timeout wrapper found on **`inbox:listMessages`** in preload — **Inference:** default invoke waits until main responds or fails.

---

## First Concrete UI Refresh Breakpoint

**Earliest logical break** (depending on which background path runs):

1. **`broadcastInboxNewMessagesFromAutoSync` / `sendToRenderer`** — **`result.newMessages <= 0`** → **no `inbox:newMessages`**. UI keeps last **`messages` / `tabCounts`** until **`setFilter`** or other **`fetchMessages`** trigger.

2. **`EmailInboxView` `onNewMessages` handler** — **`syncing === true`** → **skip `fetchMessages`**. User can remain stale until tab click **even if** main sent the event.

3. **Historical (pre-fix):** IMAP interval **did not call** broadcast at all — **Verified** fixed in current **`ipc.ts`** (~4833–4834).

**File/symbol for the “no event” case:** **`ipc.ts`** — **`broadcastInboxNewMessagesFromAutoSync`** — **early return** when **`result.newMessages <= 0`**.

---

## First Concrete Timeout Breakpoint

**Highest-impact shared timeout on sync completion:** **`syncOrchestrator.ts`** — **`syncAccountEmails`** — **`Promise.race`** with **45s** (`~336–341`).

**What times out:** The **awaited** completion of **`syncAccountEmails`** for that call.  
**What happens:** **Rejection**; IMAP auto-sync **`try`** may **log and skip `broadcastInboxNewMessagesFromAutoSync`** for that invocation.  
**Handler correctness:** Chain timestamp cleared in **`finally`**; next sync can run. **Inference:** underlying **`syncAccountEmailsImpl`** may still be running without delivering a result to the interval caller.

**Separate UI timeout:** None on **`listMessages`** IPC from renderer — list slowness surfaces as **hanging invoke** unless main handler fails. **Inference.**

---

## Relationship Between Both Issues

| Question | Assessment |
|----------|------------|
| **Does timeout directly prevent UI refresh?** | **Inference:** **Yes, when** the **45s** race rejects **before** `broadcast` — no **`SyncResult`** with **`newMessages`** passed to broadcast for that tick. If sync later completes without another notification, UI stays stale. |
| **Are they independent?** | **Verified:** UI staleness also happens when sync **succeeds** but **`newMessages === 0`** (no broadcast) or **`onNewMessages` skipped** (`syncing`). |
| **Same root cause?** | **Inference:** **Not always** — **missing/conditional notification** vs **timeout rejection** vs **`syncing` guard** are **distinct** failure modes that can **combine**. |

**Label:** Mix of **Verified** (conditional broadcast, `syncing` guard, Zustand only updates on fetch) and **Inference** (45s race vs in-flight impl).

---

## Most Likely Root Cause

**Verified:** The visible inbox is **Zustand + last `inbox:listMessages`**, not a live DB subscription. **Automatic** refresh depends on **`inbox:newMessages`** → **`fetchMessages`**, which is **suppressed** when **`newMessages <= 0`**, **skipped when `syncing`**, or **not reached** if **`syncAccountEmails` rejects** (e.g. **45s** timeout) before **`broadcast`**.

**Inference:** Users who see **both** “stuck” UI and **timeout** errors may be hitting **45s `syncAccountEmails` rejection** (no broadcast, possible continued background work) **plus** the **always-on** **`newMessages > 0`** broadcast gate.

**Label:** **Inference** for combined user symptom; **Verified** for data-flow architecture.

---

## Minimal Next Step

**One logging patch (single file, highest signal):** In **`ipc.ts`**, inside **`broadcastInboxNewMessagesFromAutoSync`**, log **once per call** with **`{ newMessages: result.newMessages, skipped: result.newMessages <= 0 }`** (or only when **`skipped`**). This **verifies at runtime** whether stale UI correlates with **zero new rows** vs **missing calls** vs downstream **`onNewMessages`**.

**Do not implement** broad fixes until logs show which branch dominates.

---

## Explicit Call-Outs (from brief)

- **Clicking “All”** triggers **`fetchMessages`** via **`setFilter`** — the **same re-query** that **`onNewMessages`** is supposed to trigger; if **`onNewMessages` does not fire or is skipped**, the tab is the **fallback** that makes the UI catch up.
- **Store does not auto-refresh** on background sync completion **unless** **`fetchMessages`** runs (from event, mount, or **`setFilter`**).
- **Timeout on `syncAccountEmails`** can **prevent broadcast** for that await; **Inference:** sync work may **continue** without updating the UI for that tick.
- **Background sync** can **complete in DB** while the **renderer** stays on an old snapshot if **no event** or **no `fetchMessages`** runs.
