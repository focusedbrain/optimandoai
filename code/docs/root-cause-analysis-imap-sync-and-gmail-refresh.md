# Root cause analysis: IMAP sync failure + Gmail UI refresh

## 1. Executive summary

**IMAP sync still not working (most likely exact cause):** The only code that registers a dedicated 2‑minute IMAP periodic pull is placed **after a `return` statement** inside `showOutlookSetupDialog()` in `ipc.ts`. That makes the `setInterval` **unreachable at runtime** — the interval is never registered, and the `[IMAP-AUTO-SYNC] Registered…` log never runs. IMAP therefore relies entirely on (a) **manual Pull** (`inbox:syncAccount` → `syncAccountEmails`) and (b) the **DB‑gated** `startAutoSync` loop, which only runs when `email_sync_state.auto_sync_enabled === 1` for that account. Documentation and prior analyses that assumed a always‑on 2‑minute IMAP tick **do not match the live code**.

**Gmail pull succeeds but UI needs manual refresh (most likely exact cause):** Background sync completion notifies renderers via `webContents.send('inbox:newMessages', …)` (`broadcastInboxSnapshotAfterSync` uses `BrowserWindow.getAllWindows()`). The renderer **only subscribes** to that channel inside `EmailInboxView` / `EmailInboxBulkView`. Those components mount **only when** `activeView === 'beap-inbox'` in `App.tsx`. If the user is on Handshakes, Settings, or Analysis while auto‑sync runs, **no listener exists**, so the Zustand store never runs `fetchMessages` / `refreshMessages`. Navigating to Inbox or invoking a refresh path reloads from SQLite and the new rows appear. A secondary contributor can be **concurrent list fetch races** (no mutex on `fetchMessages`) if many events fire quickly — lower confidence.

---

## 2. Scope and method

- **Read-only:** No application code, configs, migrations, tests, or packages were modified.
- **Method:** Traced sync entry points, orchestrator, gateway/providers, inbox IPC, preload bridge, and renderer mount/subscription behavior; verified against current files in this repository (not legacy docs alone).

---

## 3. Relevant code inventory

### Frontend / UI

- `apps/electron-vite-project/src/App.tsx` — Routes; Inbox views mount only for `activeView === 'beap-inbox'`.
- `apps/electron-vite-project/src/components/EmailInboxView.tsx` — `onNewMessages` → `fetchMessages()`.
- `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` — `onNewMessages` → `refreshMessages()`.
- `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` — Cached list via `loadPagedListSnapshot` / `inbox:listMessages`; manual `syncAccount` / `syncAllAccounts` reload after pull.

### Preload / IPC

- `apps/electron-vite-project/electron/preload.ts` — `emailInbox.onNewMessages` → `ipcRenderer.on('inbox:newMessages', …)`.
- `apps/electron-vite-project/electron/main/email/ipc.ts` — Inbox handlers, `runInboxAccountPullKind`, `broadcastInboxSnapshotAfterSync`, `startStoredAutoSyncLoopIfMissing`, dead IMAP interval (see §5).

### Sync / orchestrator

- `apps/electron-vite-project/electron/main/email/syncOrchestrator.ts` — `syncAccountEmails`, `syncAccountEmailsImpl`, `startAutoSync`, timeouts, IMAP folder expand + list races.

### Providers

- `apps/electron-vite-project/electron/main/email/providers/imap.ts` — IMAP fetch, `fetchMessagesSince` (SEARCH SINCE), etc.
- `apps/electron-vite-project/electron/main/email/providers/gmail.ts` — Gmail list + fetch.
- `apps/electron-vite-project/electron/main/email/gateway.ts` — `listMessages` / `getMessage`; IMAP uses ephemeral connect/disconnect per call.

### Persistence / database

- `apps/electron-vite-project/electron/main/handshake/db.ts` — `email_sync_state` (`auto_sync_enabled`, `last_sync_at`, …); schema note on resetting `auto_sync_enabled`.

### Logging / observability

- `apps/electron-vite-project/electron/main/email/imapSyncTelemetry.ts` — IMAP phase timeouts (`IMAP_SYNC_FOLDER_EXPAND_MS`, `IMAP_SYNC_LIST_MESSAGES_MS`).
- `syncOrchestrator.ts` — `[IMAP-SYNC-SUMMARY]`, `[SYNC-DEBUG]`, outer `SYNC_ACCOUNT_EMAILS_MAX_MS = 300_000`.

---

## 4. End-to-end sync architecture (as implemented)

### Shared pull pipeline

1. **Trigger:** Manual `inbox:syncAccount` / `inbox:pullMore`, or `startAutoSync` tick when `auto_sync_enabled === 1` (and not `processingPaused`).
2. **Execution:** `syncAccountEmails` → serialized per `accountId`, outer timeout 300s → `syncAccountEmailsImpl`.
3. **Provider list:** `emailGateway.listMessages` (IMAP: connect → `fetchMessages` / SINCE path → disconnect; OAuth: cached provider).
4. **Ingest:** For each listed id not in DB, `getMessage` + `detectAndRouteMessage` → `inbox_messages` (+ queues).
5. **Checkpoint:** `updateSyncState` (`last_sync_at` may be **held back** when 0 listed + 0 new — retry same window).
6. **UI notify:**
   - Manual pull: `sendToRenderer('inbox:newMessages', result)` when `result.ok` (`ipc.ts`).
   - Auto-sync tick: `broadcastInboxSnapshotAfterSync(result)` (`ipc.ts` + `syncOrchestrator.startAutoSync`).
   - **Intended** IMAP-only 2m tick: **never runs** (dead code — §5).

### IMAP vs Gmail differences (scheduling)

- **IMAP:** No working dedicated interval in production code path; same `startAutoSync` as other providers if user enables auto-sync in DB.
- **Gmail:** Same orchestrator and auto-sync mechanism; no separate Gmail timer in the inspected paths.

---

## 5. IMAP root-cause analysis

### 5.1 Intended execution path (documentation vs code)

**Intended (per comments):** Periodic pull every 2 minutes for every active IMAP account, independent of `auto_sync_enabled`, calling `syncAccountEmails` and broadcasting UI updates.

**Actual:** That registration lives only as unreachable statements after `return new Promise(...)` in `showOutlookSetupDialog()`:

```4661:4957:apps/electron-vite-project/electron/main/email/ipc.ts
export async function showOutlookSetupDialog(): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    // ... BrowserWindow + OAuth HTML ...
    win.on('closed', () => {
      // ...
      resolve({ success: false })
    })
  })

  // --- IMAP Auto-Sync (brute force) ---
  const IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000

  setInterval(() => {
    void (async () => {
      // ... syncAccountEmails + broadcastInboxSnapshotAfterSync ...
    })()
  }, IMAP_AUTO_SYNC_INTERVAL_MS)

  console.log('[IMAP-AUTO-SYNC] Registered IMAP auto-sync interval (every 2 min)')
}
```

In TypeScript/JavaScript, **statements after `return` in the same function body are never executed**. Therefore:

- The interval **never** registers.
- Users never get the “brute force” IMAP background tick described in internal docs.

### 5.2 What *does* run IMAP sync today

| Path | Condition | Calls `syncAccountEmails`? |
|------|-----------|---------------------------|
| Manual Pull | UI → `inbox:syncAccount` | Yes (`runInboxAccountPullKind`) |
| `startAutoSync` | `email_sync_state.auto_sync_enabled === 1` and account not paused | Yes (`syncOrchestrator.ts` tick) |
| Resume on startup | Any row has `auto_sync_enabled = 1` → loops started for all active accounts | Yes (`ipc.ts` IIFE ~2714–2736) |
| 2‑minute IMAP interval | N/A | **No — dead code** |

`startAutoSync` tick **early-returns** when `auto_sync_enabled !== 1`:

```984:987:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
      const row = db.prepare('SELECT auto_sync_enabled FROM email_sync_state WHERE account_id = ?').get(accountId) as { auto_sync_enabled?: number } | undefined
      if (row?.auto_sync_enabled !== 1) {
        scheduleNext()
        return
      }
```

Schema migration in `db.ts` (v39) **cleared** `auto_sync_enabled` historically; users must opt in again via inbox UI for the loop to run.

### 5.3 Orchestrator / provider failure modes (secondary — if user *does* pull but sees no mail)

If sync **is** invoked but no rows appear, the code supports these concrete failure/stuck behaviors:

- **Outer timeout:** `SYNC_ACCOUNT_EMAILS_MAX_MS = 300_000` — whole `syncAccountEmails` can reject; error surfaces on IPC path.
- **Folder expand race:** `resolveImapPullFoldersExpanded` vs 45s timeout — fallback to `basePullLabels` (`syncOrchestrator.ts`).
- **Per-folder list race:** `listMessages` vs `IMAP_SYNC_LIST_MESSAGES_MS` (45s) — errors appended to `result.errors`, partial folder merge possible.
- **Smart Sync anchor:** `shouldSkipAdvancingLastSyncAt` — 0 listed + 0 new does not advance `last_sync_at` (retries same window); can look like “stuck” if SEARCH/SINCE or folder path wrong.
- **`processingPaused`:** Early return in `syncAccountEmailsImpl` with `skipReason: 'processing_paused'`.
- **Gateway IMAP:** Connect + fetch + disconnect per `listMessages` / `getMessage` — slower but intentional; failures logged at gateway + orchestrator.

### 5.4 Renderer visibility

- Successful pulls persist to SQLite; inbox UI reads **`inbox:listMessages`**, not live gateway lists.
- If only background **auto** sync ran and inbox were mounted, `broadcastInboxSnapshotAfterSync` would still fire — but **without** auto-sync enabled or manual pull, **nothing** triggers sync for IMAP after the dead interval.

### 5.5 Ranked root-cause conclusions (IMAP)

| Rank | Conclusion | Confidence | Evidence |
|------|------------|------------|----------|
| 1 | Dedicated 2‑minute IMAP **`setInterval` never registers** (unreachable code after `return`) | **Very high** | `ipc.ts` structure `4661–4957`; no other `IMAP_AUTO_SYNC` references |
| 2 | Periodic IMAP sync **only** if `auto_sync_enabled === 1` (and startup resume mirrors global flag) | **High** | `syncOrchestrator.ts` `984–987`; `ipc.ts` `2714–2736`; `db.ts` migration note |
| 3 | If sync runs but mailbox empty: timeout / SEARCH / folder / `last_sync_at` retention | **Medium** | `syncOrchestrator.ts` races + `shouldSkipAdvancingLastSyncAt`; `imap.ts` SINCE path |

### 5.6 Ruled-out alternatives (IMAP)

- **“IMAP interval not firing because `registerInboxHandlers` never ran”** — Incorrect primary explanation: the broken registration is tied to **`showOutlookSetupDialog`**, not inbox registration; the interval would still be dead even if Outlook dialog were never opened.
- **`mainWindow === null` blocking IMAP UI refresh** — The dead interval never runs; `broadcastInboxSnapshotAfterSync` uses `getAllWindows()` anyway (separate from `sendToRenderer` closure).
- **IMAP excluded from `startAutoSync`** — Tick does not branch on provider; IMAP is gated only by `auto_sync_enabled` / pause.

### 5.7 Required analysis questions — IMAP (answers)

1. **Exact execution path:** `inbox:syncAccount` / `startAutoSync` tick → `syncAccountEmails` → `syncAccountEmailsImpl` → `emailGateway.listMessages` / per-message `getMessage` → `detectAndRouteMessage` → `updateSyncState`. The **documented** 2m path is **not on the execution graph** (dead).
2. **Functions that should make sync happen:** `syncAccountEmails`, invoked from `runInboxAccountPullKind` and `startAutoSync`, and **would have been** invoked from the dead interval.
3. **Scheduled/called?** Manual + auto-sync yes; **2m interval no**.
4. **Where it fails / no-ops:** At **scheduler registration** for IMAP-specific interval; otherwise account/config dependent.
5. **Failure phase:** **Before** any provider fetch for users relying solely on the dead timer; if pull runs, failures can be list/fetch/ingest per logs.
6. **Most specific root cause:** Unreachable IMAP `setInterval` block in `showOutlookSetupDialog`.
7. **Evidence:** `ipc.ts` lines `4661–4957` — `return new Promise(...)` then dead code.
8. **Alternatives ruled out:** See §5.6.
9. **Missing telemetry:** Production proof needs logs showing absence of `[IMAP-AUTO-SYNC]` / “Registered…” (expected never); user’s DB snapshot for `auto_sync_enabled` per IMAP account.
10. **Minimum safe fix direction (later):** Move IMAP interval registration to **module scope** of `registerInboxHandlers` (or app init), **once**, after DB resolves; ensure single registration; add regression test that interval callback reference is installed without opening Outlook dialog.

---

## 6. Gmail manual-refresh root-cause analysis

### 6.1 Does Gmail pull complete?

**Yes, in code:** The same `syncAccountEmails` path is provider-agnostic for list/fetch/ingest. Gmail uses `GmailProvider.fetchMessages` via `emailGateway.listMessages` when account is Gmail. Success implies inserts into `inbox_messages` through `detectAndRouteMessage`.

### 6.2 Where data is written

SQLite `inbox_messages` (and related queues) via `messageRouter` / orchestrator — same as IMAP.

### 6.3 Mechanism that should notify the UI

1. **Background auto-sync:** `startAutoSync` → `onSyncComplete(result)` → `broadcastInboxSnapshotAfterSync(result)` (`ipc.ts` `390–395`).  
   - Sends `inbox:newMessages` with full `SyncResult` when `result.ok` (including `newMessages === 0`).
2. **Manual pull:** `runInboxAccountPullKind` → `sendToRenderer('inbox:newMessages', result)` when `result.ok` (`ipc.ts` `2476–2481`).

`broadcastInboxSnapshotAfterSync` targets **every** window:

```357:374:apps/electron-vite-project/electron/main/email/ipc.ts
function broadcastInboxSnapshotAfterSync(result: SyncResult | null, error?: unknown): void {
  // ...
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      if (!w.isDestroyed() && w.webContents) w.webContents.send('inbox:newMessages', payload)
    } catch {
      /* ignore */
    }
  })
}
```

### 6.4 Renderer / store path

- Preload: `emailInbox.onNewMessages` registers `ipcRenderer.on('inbox:newMessages', …)`.
- `EmailInboxView` / `EmailInboxBulkView`: on event, call `fetchMessages()` / `refreshMessages()` which re-query `inbox:listMessages` and update Zustand.

**Mount gating:** In `App.tsx`, inbox components (and thus `onNewMessages` subscriptions) exist **only** when `activeView === 'beap-inbox'`. Other views **do not** subscribe.

### 6.5 Why manual refresh makes data appear

- **Navigate to Inbox** or **trigger fetch** runs `loadPagedListSnapshot` / bulk equivalent → fresh SQLite read → store updates.
- If events were missed while the inbox UI was unmounted, this aligns with “only see new mail after I came back and refreshed.”

### 6.6 Bug category

**Primarily:** Event emission exists, but **no listener** when inbox UI is not mounted (SPA routing). **Secondarily:** possible **race** if overlapping `fetchMessages` calls (store does not serialize refreshes).

### 6.7 Ranked conclusions (Gmail)

| Rank | Conclusion | Confidence | Evidence |
|------|------------|------------|----------|
| 1 | `inbox:newMessages` listeners only exist when Inbox/Bulk view mounted (`App.tsx` routing) | **High** | `App.tsx` `202–247`; subscription only in inbox components |
| 2 | Broadcast uses `getAllWindows()` — not `mainWindow`; emission path is sound | **High** | `broadcastInboxSnapshotAfterSync` |
| 3 | Concurrent `fetchMessages` without mutex could drop updates in edge cases | **Low–medium** | `useEmailInboxStore.fetchMessages` |

### 6.8 Ruled-out (Gmail)

- **Legacy `email:syncAccount`** as inbox pull — It calls `emailGateway.syncAccount`, which only **tests connection** and updates account status; **does not** run `syncAccountEmails` or touch inbox DB (`gateway.ts` ~1292–1317). Not the Gmail inbox pull path.
- **`broadcastInboxSnapshotAfterSync` skipping `newMessages === 0`** — Invalidated: success path sends full `SyncResult` even when zero new (`ipc.ts` comment `354–355`).

### 6.9 Required analysis questions — Gmail (answers)

1. **Pull completes?** Yes, when orchestrator returns `ok` — same pipeline as other providers.
2. **Data written?** `inbox_messages` via routing layer.
3. **Notify renderer?** `inbox:newMessages` via preload.
4. **Missing/broken path?** Listener lifetime tied to inbox mount; not a global store subscription.
5. **Manual refresh?** Forces new `listMessages` → visible state.
6. **Bug locus?** Renderer **subscription scope** (and secondarily fetch concurrency).
7. **Specific root cause:** IPC events received only when inbox view mounted; no missed emission in `broadcastInboxSnapshotAfterSync`.
8. **Evidence:** `App.tsx` conditional render + `EmailInboxView.tsx` / `EmailInboxBulkView.tsx` `useEffect` for `onNewMessages`.
9. **Alternatives ruled out:** See §6.8.
10. **Minimum fix direction (later):** Global listener (e.g. in `App.tsx` or store init) that updates inbox state or sets a “stale” flag; or refetch when `activeView` becomes `beap-inbox`; optionally serialize refreshes.

---

## 7. Cross-cutting findings

- **Stale UI vs successful sync:** SQLite is updated independently of React; **without** a listener or explicit refetch, Zustand stays stale.
- **Scheduler inconsistency:** Comments/docs describe IMAP 2m tick; **implementation is accidentally disabled** by control-flow error.
- **Auto-sync gating:** Shared `auto_sync_enabled` semantics; historical schema reset makes “no background sync” likely until user re-enables.
- **Observability:** Dead IMAP block means expected `[IMAP-AUTO-SYNC]` logs never appear — easy to misread as “scheduler not firing” for environmental reasons rather than unreachable code.

---

## 8. Evidence map

| Location | Role |
|----------|------|
| `ipc.ts` `showOutlookSetupDialog` `4661–4957` | **Unreachable** IMAP `setInterval` — primary IMAP finding |
| `ipc.ts` `351–375`, `380–397`, `2714–2736` | `broadcastInboxSnapshotAfterSync`, auto-sync loop start, startup resume |
| `syncOrchestrator.ts` `350–397`, `400–965`, `970–1034` | Sync chain, impl, `startAutoSync` gate on `auto_sync_enabled` |
| `gateway.ts` `824–862` | IMAP ephemeral connect for list |
| `App.tsx` `202–247` | Inbox views mount gate |
| `EmailInboxView.tsx` `1475–1480` | `onNewMessages` → `fetchMessages` |
| `EmailInboxBulkView.tsx` `1648–1653` | `onNewMessages` → `refreshMessages` |
| `preload.ts` `707–710` | IPC bridge for `inbox:newMessages` |
| `useEmailInboxStore.ts` `652–686`, `1238–1347` | List load; manual sync reload |
| `handshake/db.ts` (v39 migration note) | `auto_sync_enabled` reset history |

---

## 9. What is definitely not the root cause

- **Missing `broadcastInboxSnapshotAfterSync` for zero-new successful sync** — It still sends the `SyncResult` when `ok` (`ipc.ts`).
- **`mainWindow` null preventing auto-sync broadcast** — `broadcastInboxSnapshotAfterSync` uses `getAllWindows()`.
- **Gmail using a separate undocumented pull that bypasses orchestrator** for standard inbox flows — UI uses `inbox:syncAccount` → `syncAccountEmails`.

---

## 10. Unknowns and missing instrumentation

- **Runtime confirmation** that no bundler/plugin rewires `showOutlookSetupDialog` (highly unlikely) — static analysis is decisive for unreachable code.
- **User-specific DB:** Per-account `auto_sync_enabled`, `last_sync_at`, `processingPaused` — not visible from code alone.
- **Live IMAP server behavior:** SEARCH/SINCE semantics, folder naming — needs logs from failing runs.
- **Concurrent fetch races:** Would need reproduction traces.

---

## 11. Recommended fix-prompt inputs (next step)

### IMAP

- **Files likely to change:** `apps/electron-vite-project/electron/main/email/ipc.ts` (move/remove dead block from `showOutlookSetupDialog`; register once at init), possibly `main.ts` if registration must follow DB readiness.
- **Preserve:** Single-interval semantics; avoid double-registration on hot reload; keep `broadcastInboxSnapshotAfterSync` after automated IMAP pulls; respect `processingPaused` and `status === 'active'` same as dead code intended.
- **Risks:** Duplicate timers; running before DB available; overlapping with `startAutoSync` (document expected behavior: brute vs DB loop).
- **Validate:** After app start without opening Outlook dialog, `[IMAP-AUTO-SYNC]` logs appear; IMAP account with `auto_sync_enabled = 0` still gets 2m pull **only if** product still wants that policy.

### Gmail / UI refresh

- **Files likely to change:** `App.tsx` and/or `useEmailInboxStore.ts` (global subscription or focus refetch), possibly a thin helper for “invalidate inbox snapshot.”
- **Preserve:** Manual pull still updates store via existing `syncAccount` reload; avoid duplicate fetches on every keystroke.
- **Risks:** Refetch storms; memory leaks from IPC listeners — ensure cleanup on app unmount.
- **Validate:** Auto-sync with user on Handshake/Settings tab still updates store or triggers refetch when entering Inbox; bulk vs normal mode.

---

## 12. Final conclusion

- **IMAP:** The repository’s **strongest, code-specific explanation** for “IMAP sync still does not work” for users expecting automatic background pull is that the **IMAP-only `setInterval` is dead code** placed after `return` in `showOutlookSetupDialog()` (`ipc.ts`), so **no periodic IMAP sync ever registers**. Remaining behavior is manual Pull and opt-in `startAutoSync` when `auto_sync_enabled === 1`.

- **Gmail / UI:** The **strongest explanation** for “pull happens but I only see mail after manual refresh” is that **`inbox:newMessages` handlers live only on the Inbox/Bulk components**, which **unmount** when the user is elsewhere in `App.tsx`, so background sync can complete without ever calling `fetchMessages` until the user returns and refreshes or refetch runs on mount.

---

*Analysis performed as read-only; **no code changes** were made in the repository.*
