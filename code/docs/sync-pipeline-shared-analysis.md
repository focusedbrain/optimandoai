# Sync Pipeline Analysis

## Verified Entry Point

- **Real renderer API:** `window.emailInbox.syncAccount(accountId)` (and multi-account loops call the same per id).
- **Preload namespace:** `emailInbox`, defined in `electron/preload.ts` — `syncAccount: (accountId) => ipcRenderer.invoke('inbox:syncAccount', accountId)` (see `preload.ts` ~682).
- **IPC handler:** `ipcMain.handle('inbox:syncAccount', …)` in `electron/main/email/ipc.ts` (~2388), which calls `runInboxAccountPullKind(accountId, 'pull')` (~2392).
- **Misleading legacy path:** `ipcMain.handle('email:syncAccount', …)` (~1057) invokes `emailGateway.syncAccount(accountId)` — **not** the path used by the inbox store. The inbox UI uses `emailInbox.syncAccount` → `inbox:syncAccount` → `syncAccountEmails`. **Verified** by `useEmailInboxStore.syncAccount` calling `bridge.syncAccount` (`useEmailInboxStore.ts` ~1242) and preload wiring above.

---

## Exact Call Chain

Ordered path from manual Pull to SQLite `inbox_messages` insert:

1. **`src/stores/useEmailInboxStore.ts` — `syncAccount`**  
   - **Input:** `accountId`  
   - **Output:** awaits `window.emailInbox.syncAccount(accountId)`; on success refreshes list via `loadPagedListSnapshot` / `loadBulkInboxSnapshotPaginated`.  
   - **Must succeed:** bridge present; `syncing` guard not stuck true.  
   - **Failure:** early return if no bridge or `syncing`; `res.ok === false` sets `error` and skips list refresh.

2. **Preload — `emailInbox.syncAccount`**  
   - **IPC:** `invoke('inbox:syncAccount', accountId)`.

3. **`ipc.ts` — `runInboxAccountPullKind(accountId, 'pull')`** (~2257)  
   - **Input:** `accountId`  
   - **Output:** object with `ok`, optional `error`, `pullStats`, `pullHint`, `syncWarnings`, `data` (orchestrator `SyncResult`).  
   - **Must succeed:** `resolveDb()` non-null (~2266). If null → `{ ok: false, error: 'Database unavailable' }` — **orchestrator never runs.**  
   - **Failure:** DB missing; unhandled throw in handler wrapper (~2398) → `{ ok: false, error: … }`.

4. **`syncOrchestrator.ts` — `syncAccountEmails` → `syncAccountEmailsImpl`** (~314–336, 336+)  
   - **Input:** `db`, `{ accountId }`  
   - **Output:** `SyncResult` (`ok`, `newMessages`, `errors`, `listedFromProvider`, `skippedDuplicate`, `newInboxMessageIds`, …).  
   - **Must succeed for inserts:** inner path must reach `emailGateway.listMessages`, then per message `getMessage`, then `detectAndRouteMessage`. Uncaught exception → outer `catch` (~663): `result.ok = false`, `last_error` updated.

5. **`gateway.ts` — `listMessages`** (~577–584)  
   - **Input:** `accountId`, `MessageSearchOptions` (from orchestrator: `fromDate` / `toDate`, limits, `folder`).  
   - **Output:** `SanitizedMessage[]`.  
   - **Must succeed:** `findAccount(accountId)` (~578) or throws; `getConnectedProvider(account)` (~581) connects OAuth/IMAP; `provider.fetchMessages(folder, options)` returns raw list.  
   - **Failure:** throws (account missing, IMAP password missing per ~1397–1406, `connect` failure, provider error) → propagates to orchestrator outer catch.

6. **`syncOrchestrator.ts` — dedupe loop** (~505–522)  
   - **Input:** `messages` from list; `existingIds = getExistingEmailMessageIds(db, accountId)` (same file ~127–136: `email_message_id` for account).  
   - **Output:** skip row if `existingIds.has(msg.id)`.  
   - **Must succeed:** list `msg.id` must match keys used for prior `email_message_id` rows (same provider id string).  
   - **Failure mode:** no throw; **all rows skipped** → `newMessages === 0` while `listedFromProvider > 0`.

7. **`gateway.ts` — `getMessage`** (~586–593)  
   - **Input:** `accountId`, list row `msg.id`  
   - **Output:** `SanitizedMessageDetail | null`  
   - **Failure:** `null` → orchestrator pushes `Could not fetch message …`, no `newCount++` (~525–529).

8. **`syncOrchestrator.ts` — `mapToRawEmailMessage` + `detectAndRouteMessage`** (~564–565)  
   - **Input:** detail, attachments, provider hint  
   - **Output:** `routeResult.inboxMessageId`  
   - **Must succeed:** `detectAndRouteMessage` completes; on throw, caught per message (~579–581), no increment.

9. **`messageRouter.ts` — `detectAndRouteMessage`** (~168+)  
   - **Persistence:** `INSERT INTO inbox_messages` (~283–313) with new UUID `id`, `account_id`, `email_message_id` from `resolveStorageEmailMessageId` (~143–160), then attachments and `insertPendingP2PBeap` / `insertPendingPlainEmail` (~429–452).  
   - **Must succeed:** SQL run; throws if constraint/DB error → caught in orchestrator loop.

10. **Post-pull (IPC)** — `processPendingPlainEmails`, `processPendingP2PBeapEmails`, remote queue enqueue (~2298–2320). **Not required** for the row to exist in `inbox_messages`; affects downstream pipelines.

11. **Read path (visibility)** — `ipc.ts` `inbox:listMessages` (~2536–2566): `SELECT … FROM inbox_messages` + `buildInboxMessagesWhereClause` (no `account_id` filter — **Verified** ~1100–1176). Default `filter: 'all'` still excludes `pending_review` / `urgent` / archived / deleted / pending_delete. New plain/BEAP email rows start with `sort_category` null → **visible in main “all” tab** unless other flags set.

---

## Shared Breakpoints

Top concrete locations where **both** OAuth and IMAP use the same code and sync can produce **no new inbox rows** (ranked by likelihood as **shared “silent zero” or hard stop**):

1. **`emailGateway.listMessages` returns `[]`** (`gateway.ts` → provider `fetchMessages`) — orchestrator completes with `newMessages === 0`, `listedFromProvider === 0`, `result.ok === true` (unless outer throw). **IPC** still returns `ok: true` with `pullStats.listed === 0` (~2359–2385). **Both providers.** *Failure appearance:* Pull “succeeds”, remote log shows 0 listed; main log `[SYNC-DEBUG] … silent empty` when `EMAIL_DEBUG` / dev.

2. **`resolveDb()` is null** (`ipc.ts` ~2266–2267) — **no** `syncAccountEmails`, no inserts. **Both providers.** *Appearance:* `{ ok: false, error: 'Database unavailable' }`.

3. **`findAccount` / `getConnectedProvider` / `connect` throws** (`gateway.ts` ~1366–1371, ~1396+, `listMessages` ~577–582) — orchestrator outer catch, `result.ok === false`. **Both providers** (IMAP password check is IMAP-specific branch inside shared `getConnectedProvider`). *Appearance:* `res.ok === false`, store `error` set.

4. **Dedupe skips every listed message** (`syncOrchestrator.ts` ~518–521) — `listedFromProvider > 0`, `newMessages === 0`, `skippedDuplicate === listed`. **Both providers** if ids in DB already match list ids. *Appearance:* `ok: true`, `pullStats` shows high `skippedDupes`.

5. **Every `getMessage` returns null** (or all rows fail in loop) — `errors.length > 0`, `newMessages === 0`. **IPC** returns `ok: false` with error **“All messages failed to sync”** when `warnCount > 0` (~2348–2356). **Both providers.** *Appearance:* explicit failure in UI.

**Note:** `detectAndRouteMessage` INSERT is shared; provider-specific bugs inside `fetchMessages` / `fetchMessage` manifest as empty list or fetch failures but the **first shared decision point** after DB+account resolution is usually **empty `messages` array** or **full dedupe**.

---

## Provider-Specific vs Shared Logic

| Shared (OAuth + IMAP) | Provider-specific |
|------------------------|-------------------|
| `inbox:syncAccount`, `runInboxAccountPullKind`, `syncAccountEmails`, dedupe loop, `getMessage`, `mapToRawEmailMessage`, `detectAndRouteMessage`, `inbox:listMessages` | `getProvider` / `ImapProvider` vs Gmail/Outlook/Zoho `fetchMessages` / `fetchMessage`; IMAP multi-folder merge, `resolveImapPullFoldersExpanded`, IMAP password guard in `getConnectedProvider` |
| `gateway.listMessages` / `getMessage` contract | Search/date semantics and folder selection per provider |

- **Cannot explain both broken:** a bug only in IMAP UID SEARCH or only in Gmail query builder (without also breaking list for that provider only — other provider would still sync).  
- **Can explain both broken:** DB unavailable; account not in gateway; shared `listMessages` returning []; shared incremental `fromDate` / sync state producing empty window (**Inference:** depends on per-account `last_sync_at`); token/connect failures for all configured OAuth accounts; dedupe if all ids already present.

---

## Sync Result Reliability

- **Counts exist:** `pullStats = { listed, new, skippedDupes, errors }` built from `SyncResult` (`ipc.ts` ~2325–2330). Renderer logs them via `addRemoteSyncLog` (`useEmailInboxStore.ts` ~1250–1253).
- **`ok: true` with zero inserts is possible and intentional** when the list is empty and there are no errors (`ipc.ts` ~2359–2364, `result.newMessages === 0 && warnCount === 0`). That is **not** proof mail was ingested.
- **`ok: true` with `newMessages === 0` and `warnCount > 0`** is returned from IPC (~2374–2382) — partial failures; still “success” with warnings.
- **`ok: false`** when `newMessages === 0 && warnCount > 0` (~2348–2356) — “All messages failed to sync”.
- **Trustworthy for “anything inserted”:** check **`pullStats.new > 0`** (or `data.newMessages` on result), not `ok` alone.

---

## Persistence and Visibility

- **Insert:** `messageRouter.ts` `detectAndRouteMessage` — `INSERT INTO inbox_messages` (~283–313). Primary key is new UUID `inboxMessageId`; provider id is `email_message_id`.
- **Immediately visible in default list:** **Yes**, for default workflow tab `filter: 'all'`, assuming row has `deleted = 0`, `archived = 0`, no `pending_delete`, and `sort_category` not `pending_review`/`urgent` (`buildInboxMessagesWhereClause` ~1145–1152). New ingested plain mail matches that unless something else mutates the row before list refresh.
- **Write vs read mismatch:** list query does not filter by `account_id`, so **per-account sync** still shows rows globally. **Inference:** A UI filter (e.g. handshake or category) not reflected in SQL would hide rows — that would be renderer filter state, not this SQL path.

---

## Most Likely Root Cause

**Inference (code-backed, not runtime-proven):** For “sync broken” across OAuth and IMAP, the **first shared breakpoint that still reports success** is **`listMessages` → empty array** with **`result.ok === true`** and **`pullStats.new === 0`**, **`pullStats.listed === 0`** (or listed > 0 but all dupes). That matches the intentional IPC contract for “silent empty” and requires **no provider-specific code** to fail differently.

**Verified alternative:** If **`resolveDb()`** fails, sync returns **`ok: false`** immediately — user-visible error, not silent.

---

## Minimal Next Step

- **One action:** On the next failed Pull, capture **main-process** lines for **`pullStats`** (or enable `EMAIL_DEBUG=1` and capture `[SYNC-DEBUG]` / `[IMAP-SYNC-SUMMARY]` where applicable).  
- **Single highest-value log (proposal only — not implemented here):** append one structured line at the end of **`runInboxAccountPullKind`** in **`ipc.ts`** (e.g. `[SYNC-PIPELINE-RESULT]` + `accountId`, `kind`, `ok`, `pullStats`, `error`) on **every** return path so production builds show counts without dev-only gates.  
- **Interpretation:** `listed === 0` → stop before dedupe/fetch/insert; `listed > 0` and `skippedDupes === listed` → dedupe only; `errors > 0` and `new === 0` → fetch/routing failures.

---

*Files inspected: `preload.ts`, `ipc.ts` (sync + list), `syncOrchestrator.ts`, `gateway.ts` (list/get/connect), `messageRouter.ts` (insert), `useEmailInboxStore.ts` (trigger + result handling). Provider `fetchMessages` implementations were not opened per instructions.*
