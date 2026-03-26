# `email_sync_state` audit — bootstrap, incremental, reset, stuck-empty risk

**Scope:** `syncOrchestrator.ts`, `ipc.ts` (`inbox:resetSyncState`, auto-sync helpers), `handshake/db.ts` (schema), `updateSyncState` callers.

---

## Field read/write map

| Field | Read | Write |
|--------|------|--------|
| **`last_sync_at`** | `syncAccountEmailsImpl` loads row (~365–366); drives **`hasPriorSync`** / **`bootstrap`** and incremental **`listOptions.fromDate`** (~370, 424–428) | On **successful** completion of the big `try` (~611–619): set to **`nextLastSyncAt`** unless **`skipAdvanceLastSyncAt`** (~592–612). **Not** updated on outer `catch` (~627–635) — only `last_error` / `last_error_at` then. |
| **`last_uid`** | Loaded as `lastUid` (~367); seed **`lastUidSeen`** (~447) | Each ingested message may set **`lastUidSeen`** from `(msg as any).uid` (~570). **`updateSyncState`** always passes **`last_uid: lastUidSeen`** (~613). If **no messages processed**, value stays the **pre-run** `lastUid` from DB. |
| **`sync_cursor`** | Loaded as `syncCursor` (~368); **`cursorSeen = syncCursor`** (~448) | **`updateSyncState`** writes **`sync_cursor: cursorSeen`** (~614). **`cursorSeen` is never reassigned** in `syncOrchestrator.ts` — column is **round-tripped unchanged** every successful sync. **No other file** updates `sync_cursor` (repo grep). |
| **`last_error`**, **`last_error_at`** | (UI / `inbox:getSyncState` etc.) | Cleared on **successful** sync path (`last_error: undefined`, `last_error_at: undefined` ~616–617). Set on **throw** before list completes (~632–635). |
| **`auto_sync_enabled`** | `startAutoSync` tick (~697); mirror/resume in `ipc.ts` (~397, 2515–2522) | `inbox:toggleAutoSync` (~2472), resume/mirror (~399, 2522), `updateSyncState` merge on every sync (unchanged unless passed — sync success path does **not** pass `auto_sync_enabled`, so merged from row ~92). |
| **`sync_interval_ms`**, **`total_synced`** | Interval read in `ipc.ts` / `startStoredAutoSyncLoopIfMissing` | **`total_synced: totalSynced + newCount`** on success (~615); interval updated only via explicit `updateSyncState` elsewhere if any. |
| **`imap_folders_consolidated`** | Legacy consolidation gate | Written in `maybeRunImapLegacyFolderConsolidation` / migrations — orthogonal to pull window. |

**Primary writer:** `updateSyncState` in `syncOrchestrator.ts` (~81–124) — UPSERT with merge of omitted fields from previous row.

---

## State machine summary

1. **Bootstrap** — `last_sync_at` is **NULL** (or missing) and not `pullMore` → **`bootstrap === true`**. List uses **window** (`fromDate` from `syncWindowDays` or none for “all time” per prefs).  
2. **After successful pull** — normally **`last_sync_at`** becomes **current ISO time** at end of run.  
3. **Bootstrap, listed 0, ingested 0** — **`skipAdvanceLastSyncAt = true`** (~592–593) → **`last_sync_at` is NOT updated** (~612). Next pull stays bootstrap. **Verified** — matches file header comment (~5–6).  
4. **Incremental** — `last_sync_at` set → **`fromDate: lastSyncAt`** (~424–428).  
5. **Failure before/during pull (exception)** — **`last_error` / `last_error_at`** set; **`last_sync_at` left as before** (partial `updateSyncState` ~632–635 does not include `last_sync_at`).  
6. **Reset** — `inbox:resetSyncState` SQL **only** clears **`last_sync_at`, `last_error`, `last_error_at`** (~2430–2432). **Does not** clear **`last_uid`, `sync_cursor`, `total_synced`**. Cooldown: **5 minutes** per account (`RESET_SYNC_STATE_COOLDOWN_MS`, ~1361–1362, 2420–2425).

---

## What `inbox:resetSyncState` clears

**Verified** (`ipc.ts` ~2429–2433):

```sql
UPDATE email_sync_state
SET last_sync_at = NULL, last_error = NULL, last_error_at = NULL
WHERE account_id = ?
```

Plus **`clearConsecutiveZeroListingPulls(id)`** (orchestrator stuck-detection counter).

**Not cleared:** `last_uid`, `sync_cursor`, `total_synced`, `auto_sync_enabled`, `sync_interval_ms`, `imap_folders_consolidated`.

---

## Can list return 0 while state still advances? (incremental “drift”)

**Verified:** `skipAdvanceLastSyncAt` is **only**:

```ts
bootstrap && messages.length === 0 && newCount === 0
```

(`syncOrchestrator.ts` ~592–593)

So for **incremental** runs (`bootstrap === false`):

- If **`messages.length === 0`** and **`newCount === 0`**, **`skipAdvanceLastSyncAt` is false** → **`last_sync_at` is still set to `nextLastSyncAt`** (~591, 612, 619).

**Consequence:** A pull that **lists nothing** (SEARCH/folder/window issue) but **completes without throwing** still **moves the incremental anchor forward to “now”**. The next pull uses **`fromDate: last_sync_at`** (the new value). Mail that is **older than that anchor** but was **never returned** by the buggy/empty list is **outside the incremental window** — **connected-but-empty** behavior can persist until **reset** (or Pull More / bootstrap path).

**Contrast:** **Bootstrap** + **0 listed** + **0 new** → **does not** advance — intentional recovery.

**All listed rows are duplicates:** `messages.length > 0`, `newCount === 0` → **not** `skipAdvanceLastSyncAt` → **`last_sync_at` advances**. Usually correct (sync “succeeded”); if listing were wrong but non-empty, same drift logic applies.

---

## IMAP vs OAuth

**Verified:** **`syncAccountEmails` / `syncAccountEmailsImpl`** have **no** `provider === 'imap'` branch for **`last_sync_at` advance rules**. IMAP-only steps (folder expansion, consolidation) do **not** change the advance condition. **OAuth and IMAP share the same sync-state machine** for these fields.

**Inference:** Provider-specific **list** behavior (IMAP SEARCH vs Graph/Gmail) changes *why* `messages.length` might be 0, not *whether* `last_sync_at` advances.

---

## Reset: workaround vs intended recovery

**Verified:** Code comments present **`syncOrchestrator`** (~5–6) describing bootstrap **not** advancing on 0/0 as avoiding **“stuck incremental”** — that is **design**, not accident.

**Verified:** `inbox:resetSyncState` is a **first-class IPC** (`preload` → `emailAccounts.resetSyncState`), with **cooldown** — product expects **occasional operator use**.

**Conclusion:** **Reset is both** — **intended recovery** when the cursor is wrong or user wants a **full-window retry**, and a **workaround** when root cause (folder/SEARCH/API) is unfixed. It is **incomplete** relative to a full “factory reset” of sync metadata because **`last_uid` / `total_synced` / `sync_cursor`** are **not** cleared (may or may not matter; **`sync_cursor` is effectively unused** in current orchestrator logic).

---

## Can sync state cause a false healthy / empty IMAP account?

**Yes (verified mechanism):** Gateway/account **`status`** can stay **`active`** while **`syncAccountEmails`** completes **`ok: true`**, **`listedFromProvider === 0`**, **`newMessages === 0`** — IPC may still return **`ok: true`** with empty stats (`ipc.ts` ~2359–2364 logs “silent empty”). **`last_sync_at` then advances** in incremental mode → subsequent pulls keep using a **newer** `fromDate`, which can **perpetuate** “no new mail” if the underlying issue was transient or if old mail never falls in the window.

**Not primarily “IMAP vs OAuth”** — same advance rule.

---

## Best next experiment to prove or disprove

1. **Before pull:** read `email_sync_state` for the account (`last_sync_at`, `last_uid`).  
2. **Run** `window.emailInbox.syncAccount(accountId)` when reproduction shows **0 new**.  
3. **After pull:** read row again. If **`listed === 0`** / **`new === 0`** but **`last_sync_at` moved forward** and previously was non-null → **confirms incremental advance-on-empty**.  
4. **Then** call **`resetSyncState`**, pull again: if mail appears → **state drift** hypothesis supported; if not → look at **folder/list/fetch**, not only cursor.

Optional: set **`EMAIL_DEBUG=1`** or dev build to surface **`[SYNC-DEBUG]`** lines for `skipAdvanceLastSyncAt` vs `updating last_sync_at`.

---

*Paths under `apps/electron-vite-project`.*
