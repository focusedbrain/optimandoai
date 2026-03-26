# Shared Sync Regression Analysis

## Verified Entry Points

| Layer | Path |
|--------|------|
| **Renderer API** | `useEmailInboxStore.syncAccount(accountId)` / `syncAllAccounts(accountIds)` / `pullMoreAccount` (`useEmailInboxStore.ts`). |
| **Preload bridge** | `window.emailInbox.syncAccount` → `ipcRenderer.invoke('inbox:syncAccount', accountId)` (`preload.ts` ~686). |
| **IPC handler** | `ipcMain.handle('inbox:syncAccount', …)` → `runInboxAccountPullKind(accountId, 'pull')` (`ipc.ts` ~2405–2409). |
| **Orchestrator entrypoint** | `syncAccountEmails(db, { accountId })` (`syncOrchestrator.ts` ~316), which runs **`syncAccountEmailsImpl`** (list → fetch → **`detectAndRouteMessage`** per new row). |
| **Ingest routing** | `detectAndRouteMessage(db, accountId, rawMsg)` (`messageRouter.ts`), invoked from **`syncAccountEmailsImpl`** (~605). |
| **UI visibility** | After IPC returns **`ok`**, the store calls **`loadPagedListSnapshot`** / **`loadBulkInboxSnapshotPaginated`** (same `inbox:listMessages` path as normal inbox load). Background completion additionally uses main → renderer **`inbox:newMessages`** → **`fetchMessages`** / deferred refresh. |

**OAuth vs IMAP:** Provider-specific code runs *inside* `syncAccountEmailsImpl` (gateway list/fetch). **The same** `runInboxAccountPullKind` → `syncAccountEmails` → `syncAccountEmailsImpl` → `messageRouter` chain applies to **both**.

---

## Exact Shared Call Chain

### Manual sync (Pull)

1. UI calls **`store.syncAccount(accountId)`** — sets **`syncing: true`** (`useEmailInboxStore.ts` ~1249).
2. **`await bridge.syncAccount(accountId)`** → **`inbox:syncAccount`** → **`runInboxAccountPullKind`** (`ipc.ts` ~2274+).
3. **`resolveDb()`** — if **`!db`** → **`{ ok: false, error: 'Database unavailable' }`** (early return, **no sync**).
4. **`result = await syncAccountEmails(db, { accountId })`** — **45s `Promise.race`** wrapper (`syncOrchestrator.ts` ~336–347). On reject → IPC catch → **`{ ok: false, error }`** (`ipc.ts` ~2292–2312).
5. Post-sync: **`processPendingPlainEmails` / `processPendingP2PBeapEmails`**, remote queue scheduling (`ipc.ts` ~2315–2337).
6. IPC builds response; if **`result.ok`**, **`sendToRenderer('inbox:newMessages', result)`** (`ipc.ts` ~2383–2388).
7. Store: if **`!res.ok`** → **`syncing: false`** + error (~1269–1277). If **`res.ok`** → **`await loadPagedListSnapshot(get)`** (or bulk) → then **`syncing: false`** (~1280–1329).

**Inbox rows must exist:** either from step 4 (impl + **`detectAndRouteMessage`**), or step 5 post-processors; **visible list** in step 7 depends on **`loadPagedListSnapshot`** succeeding.

### Auto / background sync

| Source | Flow |
|--------|------|
| **DB `startAutoSync`** | `tick` → **`await syncAccountEmails(db, { accountId })`** → **`onSyncComplete(result)`** / **`onSyncComplete(null, err)`** → **`broadcastInboxSnapshotAfterSync`** (`syncOrchestrator.ts` ~770–801; `ipc.ts` via registered callback). |
| **IMAP interval** | **`await syncAccountEmails`** → **`broadcastInboxSnapshotAfterSync(result)`** or catch → **`broadcastInboxSnapshotAfterSync(null, err)`** (`ipc.ts` ~4848+). |

Renderer: **`onNewMessages`** → **`fetchMessages()`** unless **`syncing`**; then **`markPendingInboxRefreshAfterSyncEvent()`**; flush when **`syncing`** becomes false (`EmailInboxView` / bulk).

### Where inbox visibility depends on refresh

- **Manual Pull:** Store **always** runs **`loadPagedListSnapshot`** after successful IPC (even if **`sendToRenderer`** failed).
- **Background:** Depends on **`inbox:newMessages`** + **`fetchMessages`** (or deferred path). **No** automatic store update without that event + fetch.

---

## Top 5 Shared Regression Points (both OAuth and IMAP)

1. **`syncAccountEmails` 45s `Promise.race`** (`syncOrchestrator.ts` **`syncAccountEmails`**) — Rejects with **`syncAccountEmails timed out after 45s`**. IPC returns **`ok: false`**; **manual** UI shows failure and clears **`syncing`**. **Inference:** underlying **`syncAccountEmailsImpl`** may still run; user sees “sync failed” and empty/partial inbox until **next** successful refresh.

2. **`runInboxAccountPullKind` when `resolveDb()` returns null** (`ipc.ts` **`runInboxAccountPullKind`** ~2283–2284) — **`{ ok: false, error: 'Database unavailable' }`** for **all** providers. **Symptom:** nothing syncs; **inference** if DB init regressed.

3. **`store.syncAccount` after `res.ok`: `loadPagedListSnapshot` / `loadBulkInboxSnapshotPaginated` hangs or returns null** (`useEmailInboxStore.ts` **`syncAccount`** ~1280–1329) — **`syncing`** stays **`true`** until **`await loadPagedListSnapshot`** completes or throws. **If** list IPC hangs, UI shows **“Syncing…”** indefinitely; **`onNewMessages`** defers refresh (**`syncing`**), so **background** updates can **not** apply until **`syncing`** clears. **Likelihood: high** for “stuck Syncing + empty/stale” **without** provider code.

4. **`syncing === true` blocks immediate `onNewMessages` refresh** (`EmailInboxView` / bulk) — Events only **mark pending**; flush requires **`syncing` → false**. If (3) occurs, **inference:** combined **stuck spinner** + **no** background refresh.

5. **`syncAccount` early return when `get().syncing`** (`useEmailInboxStore.ts` ~1242–1245) — Second Pull **skipped** while first in flight; **does not** set **`syncing`**. **Not** a stuck-**syncing** bug; **inference** only if user expects **parallel** pulls.

---

## Stuck Sync / Timeout Findings

| Topic | Finding |
|--------|---------|
| **Can `syncing` stay true?** | **Verified:** Between **`set({ syncing: true })`** (~1249) and **`set({ syncing: false })`** after **`loadPagedListSnapshot`** (~1280–1329). If **`loadPagedListSnapshot`** never resolves, **`syncing`** remains **true**. |
| **Timeout vs in-flight work** | **Inference:** **`Promise.race`** 45s rejects **`syncAccountEmails`**; **`syncAccountEmailsImpl`** is **not** aborted. IPC can return **failure** while work continues. |
| **UI refresh skipped** | **Verified** when **`syncing`** is true: **`onNewMessages`** does **not** call **`fetchMessages`** immediately; it **marks pending** only. |
| **`newMessages > 0` gating** | **Not** on manual Pull path to **`sendToRenderer`** anymore: **`if (result.ok)`** sends (`ipc.ts` ~2383). **Broadcast** helpers use **success / invalidate** semantics (`broadcastInboxSnapshotAfterSync`). **Inference:** older “only new > 0” issue is **not** the current manual IPC gate. |

---

## Earliest Concrete Breakpoint

- **File:** `apps/electron-vite-project/src/stores/useEmailInboxStore.ts`  
- **Symbol:** **`syncAccount`** — the **`await loadPagedListSnapshot(get)`** (or bulk equivalent) **after** **`await bridge.syncAccount(accountId)`** while **`syncing`** is still **`true`**.

**Why it explains both OAuth and IMAP:** Same store method and same **`listMessages`** IPC for **all** providers. Any hang, slow DB, or **list** failure after a **successful** sync response leaves **`syncing`** set and blocks **deferred** **`onNewMessages`** refresh, matching **“Syncing…” + empty/stale inbox** for **every** account type.

---

## Most Likely Root Cause

**Inference:** A **shared** stall or failure in **`loadPagedListSnapshot` / `inbox:listMessages`** (or **exception path** not clearing **`syncing`**) **after** main reports success, **or** **`syncing`** staying **true** long enough that **background** **`inbox:newMessages`** refresh is **only** deferred and never flushed. **Provider-agnostic** code is sufficient to explain **both** OAuth and IMAP **without** changing provider implementations.

---

## Minimal Next Step

**One logging patch (single file, `useEmailInboxStore.ts` inside `syncAccount`):** Immediately **before** and **after** **`await loadPagedListSnapshot(get)`** (and the bulk branch), log **`Date.now()`**, **`accountId`**, and **`res.ok`**. If logs show **minutes** between before/after while UI shows **“Syncing…”**, the breakpoint is **confirmed** as list IPC / DB slowness, not Gmail vs IMAP.

**Do not** add a broad refactor; **do not** change **`Promise.race`** until logs confirm timeout vs list hang.
