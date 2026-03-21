# Remote orchestrator ↔ origin mailbox sync

## Responsibility split

| Layer | Role |
|--------|------|
| **SQLite `inbox_messages`** | Source of truth for WR Desk UI (archived, `sort_category`, `pending_delete`, deletion queue, etc.). |
| **`remote_orchestrator_mutation_queue`** | Outbox of **best-effort** remote mutations; idempotent per `(message_id, operation)`. |
| **Email providers** (`applyOrchestratorRemoteOperation`) | Provider-specific mapping to Gmail labels, Graph folder moves, or IMAP `MOVE`. |
| **`domain/remoteLifecycleAbstraction.ts`** | Shared lifecycle model: canonical bucket names, backend kind (`gmail_api_labels` / `microsoft_graph_mailfolder_move` / `imap_uid_move`), `resolveRemoteLifecycleSnapshot(account)`. |
| **`emailGateway.applyOrchestratorRemoteOperation`** | Connects account + provider; no inbox UI logic. |

Local IPC handlers **always** commit local state first, then enqueue remote work — either **`fireRemoteOrchestratorSync`** (direct op + drain) or **`enqueueRemoteOpsForLocalLifecycleState`** (DB columns as source of truth; skips when `imap_remote_mailbox` **exactly** matches the configured lifecycle mailbox/label name, case-insensitive — no substring / `includes` matching) — and **`scheduleOrchestratorRemoteDrain`**. **`enqueueRemoteOpsForLocalLifecycleState`** returns **`skipReasons: string[]`** (one line per skipped id: reason + `expected` / `observed` buckets + raw `imap_remote_mailbox`) for UI / IPC diagnostics. Empty or unknown `imap_remote_mailbox` is mapped to observed bucket **`inbox`**. Remote failures **do not** roll back local state.

## Lifecycle → remote mapping

| Local transition | Queue `operation` | Gmail | Microsoft 365 (Graph) | IMAP |
|------------------|---------------------|-------|------------------------|------|
| Archive | `archive` | Remove `INBOX` | Move → well-known `archive` | `MOVE` → `Archive` (mailbox created if needed) |
| Pending review | `pending_review` | Add user label `Pending Review`, remove `INBOX` + `Pending Delete` label | **Move** → root folder `Pending Review`: **GET** `/me/mailFolders?$top=100` + client-side name match, else **POST /me/mailFolders** (no OData `$filter`). **Never DELETE.** | `MOVE` → `Pending Review` (default mailbox; locate source via `imap_remote_mailbox` + RFC Message-ID search) |
| Pending delete | `pending_delete` | Add user label `Pending Delete`, remove `INBOX` + `Pending Review` + `Urgent` label | Same list/create pattern for **`Pending Delete`**. | `MOVE` → `Pending Delete` (same locate rules) |
| Urgent | `urgent` | Add user label `Urgent`, remove `INBOX` + conflicting lifecycle labels | **Move** → root folder **`Urgent`** (same list/create pattern as Pending *) | `MOVE` → `Urgent` (default mailbox) |
| **Final delete** (grace elapsed) | *(existing)* | `users.messages.trash` via `deleteMessage` | Move → `deleteditems` via `deleteMessage` | `\Deleted` + expunge |

**Sort category → bucket (local):** `newsletter` / `normal` / unknown non-empty `sort_category` → expect **archive**; `important` → **pending_review**; `urgent` → **urgent**; empty / null `sort_category` → **inbox** (no remote move until classified). AI + lifecycle enqueue uses **`enqueueRemoteOpsForLocalLifecycleState`** so all classified rows can drain to the four folders.

### IMAP (web.de / GMX / namespaced servers)

- **MOVE verification:** After a successful IMAP `MOVE` (or COPY+DELETE fallback), the provider **re-opens the destination** and checks that the message is present (by UID and/or RFC `Message-ID`). If verification fails, the queue row is **failed** — not marked completed — so “ghost” successes are avoided.
- **Locate source (canonical only):** `imapLocateMessageForMove` searches **INBOX + configured lifecycle folders only** (resolved paths: Archive, Pending Delete, Pending Review, Urgent, Trash). It **ignores** `imap_remote_mailbox` when it points at legacy folders (`WRDesk-*`, `Archieve`, etc.) so we do not “find” a copy under an old tree while the real message remains in Posteingang.
- **Pull folders:** `domain/imapPullFolders.ts` → **`resolveImapPullFolders`** (base labels), then **`emailGateway.resolveImapPullFoldersExpanded`** maps labels to real LIST paths, discovers **Spam/Junk** if needed, and appends **direct `INBOX.*` children** (excluding lifecycle, legacy `WRDesk-*` / `Archieve`, and Sent/Trash/Drafts-like anchors). Default base set is **`INBOX` + `Spam`**. Custom **`folders.monitored`** overrides; lifecycle names are stripped from monitored so sorted mail is not re-listed. Per-folder list errors are logged and skipped without failing the whole Pull.
- **Lifecycle folder existence (exact):** `imapFolderListHasExactMailbox` — **case-insensitive exact** match on folder name / path / basename only. Typo **`Archieve`** and **`WRDesk-*`** never satisfy “Archive” / pending / urgent. Missing canonical folders are **CREATE**d via **`validateLifecycleRemoteBoxes`**; drain calls **`ensureImapLifecycleFoldersForDrain`** once per account per batch after connect.
- **Verify remote (UI):** 🔧 Debug → **Verify remote** → `inbox:verifyImapRemoteFolders` — LIST + STATUS counts + lifecycle exact-match snapshot (read-only, no CREATE).
- **One-time consolidation:** On IMAP sync, **`consolidateLifecycleFolders`** may still run once to move mail from old WRDesk / typo folders into canonical names (see `ImapProvider.consolidateLifecycleFolders`).

## Post-pull / auto-sync mirror

After **`inbox:syncAccount`** (Pull):

1. `syncAccountEmails` collects `newInboxMessageIds` for rows ingested in that run.
2. `processPendingPlainEmails` / `processPendingP2PBeapEmails` run (same as before).
3. **`enqueueRemoteOpsForLocalLifecycleState`** enqueues remote ops from current local columns for those IDs (`localRowToExpectedBucket`: archived → `pending_delete` → `pending_review` / `pending_review_at` → `urgent` → other classified → archive).
4. **`scheduleOrchestratorRemoteDrain`** only — IPC returns without waiting; remote mailbox mirror continues in the background.

After each **auto-sync tick** (`syncOrchestrator.startAutoSync`), steps 1–3 are the same, then **`drainOrchestratorRemoteQueueBounded`** still runs inline (capped ~28s / 150 batches) before the next tick is scheduled. If rows remain **`pending`**, bounded drain also **`scheduleOrchestratorRemoteDrain`** after a short delay, and the main process still calls **`scheduleOrchestratorRemoteDrain`** once — so the queue never stalls after a timeout alone.

### Pull vs background remote drain

- **`syncPullLock`** (`markPullActive` / `markPullInactive`) wraps **provider list + per-message fetch** in `syncAccountEmails` for that `accountId`.
- **`scheduleOrchestratorRemoteDrain`** can still run during Pull (e.g. `fireRemoteOrchestratorSync` from another IPC handler). **`processOrchestratorRemoteQueueBatch`** skips rows whose `account_id` is pull-active (rows stay `pending`; **`deferredDueToPull`**). Other accounts’ queue rows still process.
- **`inbox:syncAccount`** already schedules drain **after** `syncAccountEmails` returns; the lock covers concurrent drains, not the manual Pull ordering alone.

**`inbox:aiClassifySingle`**: after local DB updates, **every** successful classification (including **`sort_category = urgent`**) calls **`enqueueRemoteOpsForLocalLifecycleState(db, [messageId])`** (same supersede / skip rules as bulk mirror), then the handler calls **`scheduleOrchestratorRemoteDrain`** — background only (no inline bounded drain).

**`inbox:aiCategorize`** schedules background drain only (no inline bounded drain), so Auto-Sort is not blocked on remote I/O.

**`scheduleOrchestratorRemoteDrain`** runs one batch per tick, then **reschedules** (after **~300–400ms**) while `pendingRemaining > 0`, after work was processed, when a parallel enqueue set `drainRescheduleRequested`, or when a post-batch **SQL `pending` count** disagrees with “stop” (safety net). The queue should drain to completion in the background (not stop solely because inline bounded drain hit ~28s).

**Pull vs drain:** `inbox:syncAccount` calls **`scheduleOrchestratorRemoteDrain`** only after **`syncAccountEmails`** resolves; the pull lock is released in **`syncAccountEmailsImpl`**’s **`finally { markPullInactive }`**, so the lock is cleared before the IPC handler schedules drain.

**IMAP:** On socket **`end`**, the provider sets **`connected = false`** and **`client = null`**. **`applyOrchestratorRemoteOperation`** requires **`connected && client`**. **Drain (orchestrator queue):** transient connection errors (timeouts, dead socket, handshake timeout, `ECONNRESET`, etc.) trigger **`emailGateway.forceReconnect`**, row returns to **`pending` without incrementing `attempts`**, and **`clearOrchestratorTransientAccountError`** clears UI error after a successful reconnect — not marked **`failed`** for those errors. Operational failures (e.g. message not found) still increment **`attempts`** up to 8. Every **50** successful IMAP moves per account, the drain pauses **3s** (“breathing”) to reduce provider disconnects.

Bulk **Auto-Sort** (`runAiCategorizeForIds`) ends with **`inbox:enqueueRemoteSync`** (alias of lifecycle mirror) for **all successfully classified** message IDs (`allProcessedIds`), then **`inbox:fullRemoteSyncForMessages`** so every touched account gets a pass over **all** rows where local lifecycle ≠ `imap_remote_mailbox` (lifecycle moves only; **inbox restore** when remote is wrong but local is inbox is counted as `inboxRestoreNeeded` until a dedicated op exists).

**`inbox:fullRemoteSyncAllAccounts`** (UI **☁ Sync Remote**): (1) **`markOrphanPendingQueueRowsAsFailed`** for `pending`/`processing` rows whose **`account_id`** is not a connected gateway account (or all such rows when no accounts); (2) **`enqueueUnmirroredClassifiedLifecycleMessages`** — classified **`inbox_messages`** with no **`completed`/`pending`/`processing`** queue row; (3) **`enqueueFullRemoteSync`** per connected account; (4) **`scheduleOrchestratorRemoteDrain`** only — **does not** await **`drainOrchestratorRemoteQueueBounded`** (no 150-batch / 28s cap on IPC). Background drain + **30s watchdog** (`ensureOrchestratorRemoteDrainWatchdog`) keep processing until **`pending = 0`**. On inbox handler registration, a **startup** pass runs **`enqueueUnmirroredClassifiedLifecycleMessages`** once if anything was missing.

After each successful remote **`apply`**, **`processOrchestratorRemoteQueueBatch`** updates **`inbox_messages.email_message_id`** and **`inbox_messages.imap_remote_mailbox`** when the provider returns `imapUidAfterMove` / `imapMailboxAfterMove`, so the column tracks the message’s actual remote folder.

**IMAP `email_message_id`:** must be the numeric **UID** in the source mailbox (not the RFC `Message-ID` header). Ingest uses **`resolveStorageEmailMessageId`** (`messageRouter.ts`) and IMAP sync builds raw messages with **`uid` + `id`** only (`syncOrchestrator.mapToRawEmailMessage`). RFC header stays in **`imap_rfc_message_id`**. Schema **v42** one-time `UPDATE` swaps columns when legacy rows stored RFC in `email_message_id` and UID in `imap_rfc_message_id`.

IMAP **`applyOrchestratorRemoteOperation`** calls **`imapEnsureMailbox(dest)`** before `MOVE`. Gmail uses **`ensureWrDeskUserLabel`** to create missing user labels.

## Idempotency & retries

- **Queue:** `UNIQUE(message_id, operation)` collapses duplicate work; re-enqueue after completion resets the row to `pending`.
- **Providers:** Gmail/Outlook may return `skipped: true` only for explicit same-destination / already-moved Graph errors — **not** generic “not found” (avoids marking rows completed when the message id is stale). **IMAP** only returns `skipped: true` after verifying the message is already in the destination mailbox (HEADER Message-ID or UID in that folder).
- **Outlook recovery:** If mail seems missing after an older build, check **Deleted items** (e.g. *Gelöschte Elemente*) and **Recoverable items** in Outlook on the web; move back to Inbox if needed, then re-sync. Current builds use **move** to **Pending Delete** / **Pending Review** folders only (no Graph hard-delete for those ops).
- **Processor:** Default **50** pending rows per batch. Rows are grouped by **`account_id`** and each account is drained **in parallel** (`Promise.allSettled`); within one account, ops run **sequentially** with a short pause — **50ms** after IMAP moves, **200ms** after Gmail / Microsoft 365 (Graph rate limits). Up to **8** **`attempts`** per row for **operational** failures only; **transient connection** errors do not increment **`attempts`**. Stale `processing` (>5 min) reset to `pending`. Each apply is capped at **30s** (`Promise.race`). Precheck uses **`ensureConnectedForOrchestratorOperation`** (15s cap) plus one **`forceReconnect`** on transient errors; if still transient, the row stays **`pending`** (same batch may process the next row). Permanent precheck failure → row **`failed`** (max attempts) and **`precheckFailedByAccount`** skips the rest of that account in the batch; IMAP may get **`status: 'error'`** only for **non-transient** precheck failures.
- **Debug:** `debug:queueStatus` returns **`byAccountStatus`** (`GROUP BY account_id, status`) and **`queueByAccountSummary`** (human labels: `email (provider)` + pending/processing/completed/failed counts) for isolating one bad account (e.g. web.de) vs Outlook. **`inbox:debugMainInboxRows`** (optional `accountId`) lists WR Desk main-inbox rows (same filter as UI “all” tab) with **`why`** / **`whyDetail`** explaining why they may still sit in server Inbox (not analyzed, urgent, non-lifecycle sort, queue state).
- **Visibility:** `inbox_messages.remote_orchestrator_last_error` holds the latest error / retry hint; `inbox:listRemoteOrchestratorQueue` exposes queue rows.
- **Retry failed:** `inbox:retryFailedRemoteOps` (optional **`accountId`** argument) — bulk debug **Retry failed** resets **all** failed rows; **Per account → Retry failed (this account)** resets only **`status = 'failed'`** rows for that **`account_id`**. Both set **`status = 'pending'`, `attempts = 0`, `last_error = NULL`**, **`updated_at`**, then **`scheduleOrchestratorRemoteDrain`**. The debug panel auto-refreshes queue stats every **5s** while open and shows drain progress + ETA from the **completed** count trend over the last **30s**.
- **Clear failed:** `inbox:clearFailedRemoteOps` (**`accountId` required**) — **DELETE** from **`remote_orchestrator_mutation_queue`** where **`status = 'failed'`** and **`account_id = ?`**. Use when rows can never succeed (e.g. **Account not found** after the mailbox was disconnected). Does **not** schedule drain. Debug: **Clear failed (this account)** next to per-account retry.
- **Reconnect (same email, new `account_id`):** After a successful **Gmail / Outlook / IMAP / custom mailbox** connect, the main process runs **`tryAutoMigrateInboxAccountOnReconnect`** (conservative): if there is exactly one **orphan** `inbox_messages.account_id` not in the gateway **and** at least one of its messages lists the new mailbox’s email in **To/Cc** (case-insensitive), all inbox rows for that orphan id are **`UPDATE`d** to the new **`account_id`**, and **all** `remote_orchestrator_mutation_queue` rows for the orphan id are **`DELETE`d** (fresh **☁ Sync Remote** re-enqueues). Then **`cleanupStaleFailedRemoteQueueOnReconnect`** removes stale **failed** rows (orphan ids + same-email duplicate ids). Manual fix: **`inbox:migrateInboxAccountId`** / bulk **🔧 Debug → Account status → Migrate** when auto-migrate does not run (e.g. ambiguous orphans, no To/Cc hint). Empty legacy folders on the server (e.g. old WRDesk / typo folders) can be removed manually after migration.

## Manual QA (Auto-Sort ↔ remote)

- [ ] Auto-Sort 10 messages → `remote_orchestrator_mutation_queue` shows expected pending rows (via `inbox:listRemoteOrchestratorQueue` / DB).
- [ ] Optional: click **☁ Sync Remote** (bulk toolbar or standard inbox toolbar) → full account reconcile enqueued; drain still chained until queue empty.
- [ ] Wait for background drain → rows move to `completed` (or failed with visible error).
- [ ] web.de: messages appear in correct lifecycle folders.
- [ ] Outlook: messages appear in correct lifecycle folders.
- [ ] Reclassify 1 message → prior queue row superseded / new op enqueued per supersede rules.
- [ ] Pull again → no spurious “Could not fetch message” for moved mail (INBOX + lifecycle fetch path).

## Follow-ups

- Inverse operations (unarchive, cancel pending) on the remote mailbox.
- Configurable IMAP folder names / Gmail label names per account (`orchestratorRemote` on `EmailAccountConfig`).
- Backoff delay between retries (currently immediate re-queue).
