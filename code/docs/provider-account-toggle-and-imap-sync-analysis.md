# Provider account activation toggles + IMAP sync — codebase analysis report

**Analysis date:** 2025-03-25  
**Scope:** Read-only inspection of this repository (`apps/electron-vite-project` + Chromium extension). **No application code, configs, migrations, or tests were modified** to produce this document.

---

## 1. Executive summary

### Architecture (as implemented)

- **Connected email accounts** are persisted in the Electron user data directory as **`email-accounts.json`** (see `gateway.ts` `loadAccounts` / `saveAccounts`). Rows are `EmailAccountConfig`: provider (`gmail` | `microsoft365` | `zoho` | `imap`), OAuth or IMAP/SMTP secrets, folder routing, **`sync`** preferences (`syncWindowDays`, `maxMessagesPerPull`, etc.), and a **`status`** field.
- **Inbox message store + sync checkpoints** live in the **vault SQLCipher DB** (migrations in `electron/main/handshake/db.ts`): `inbox_messages.account_id`, `email_sync_state` (per-account `last_sync_at`, `auto_sync_enabled`, `sync_interval_ms`, errors, IMAP consolidation flag), remote orchestrator queue, autosort session tables, global inbox AI settings in `inbox_settings`.
- **Pull / Smart Sync** is implemented in **`syncOrchestrator.ts`** (`syncAccountEmails`), invoked from **`ipc.ts`** as `inbox:syncAccount` / `inbox:pullMore`. It calls `emailGateway.listMessages` + per-message `getMessage`, dedupes on `email_message_id`, routes through **`messageRouter`** / ingestion, then may enqueue **remote lifecycle** mutations.
- **Provider adapters:** `providers/gmail.ts`, `providers/outlook.ts`, `providers/zoho.ts`, `providers/imap.ts` behind `IEmailProvider` (`providers/base.ts`). **IMAP uses node-imap**, long-lived cached sessions via `EmailGateway.getConnectedProvider`, UID SEARCH + chunked UID FETCH for dated sync paths; **no IMAP IDLE** usage was found in `imap.ts` (string search for `IDLE` / `idle` returned no matches).

### Safest direction for activation / deactivation toggles

- **`EmailAccountConfig.status` already includes `'disabled'`** in `types.ts`, but **the gateway never assigns `'disabled'`** in current code (only `active`, `error`, `auth_error` appear in `gateway.ts`). The renderer maps any non-active/error/auth value to a UI **“disabled”** bucket. **Repurposing `'disabled'` for user-driven “paused” is risky** without disambiguating “broken vs intentionally paused” and without auditing all `status === 'active'` guards.
- **Cleaner minimum-change semantics:** introduce an explicit **`processing_paused`** (or keep account `status: 'active'` and add a dedicated flag e.g. `userProcessingEnabled: boolean` on the account row **or** reuse / extend **`email_sync_state`** with a “pause ingestion” bit) so **auth_error / error remain true health states**.
- **Any pause flag must gate:** manual pull (`inbox:syncAccount`), **DB `auto_sync_enabled` loops**, the **process-wide 2-minute IMAP `setInterval`** in `registerInboxHandlers`, **post-connect `mirrorGlobalAutoSyncToNewAccount`**, remote-queue drain / `ensureConnectedForOrchestratorOperation` if product policy says paused accounts should not mutate server mail, and renderer helpers like **`activeEmailAccountIdsForSync`** (`useEmailInboxStore.ts`).

### Likely IMAP “live sync timed out” problem areas

- The banner copy **“Live sync timed out…”** is **`SyncFailureBanner.tsx`** for `classifySyncFailureMessage` → **`timeout`** (`syncFailureUi.ts` matches `timed out`, `timeout`, **`syncaccountemails timed out`**, etc.).
- **Dominant timeout sources in code:**
  1. **`listMessages timed out after 30s`** — `Promise.race` around `emailGateway.listMessages` in **`syncOrchestrator.ts`** (single-folder and **per-folder** for multi-folder IMAP).
  2. **`resolveImapPullFoldersExpanded timed out after 30s`** — folder expansion before listing.
  3. **Outer `syncAccountEmails timed out after 300s`** — `SYNC_ACCOUNT_EMAILS_MAX_MS` race around the whole sync chain.
  4. **IMAP adapter** — `ImapProvider.fetchMessages` rejects with **`IMAP fetch timed out`** at **30s** for the non–date-scoped `openBox` + `seq.fetch` path; `fetchMessagesSince` / `Before` use chunked fetches **without that outer 30s** on the whole SEARCH pipeline (still subject to orchestrator races).
- **IMAP is not “live push”:** UI labels OAuth rows “Smart Sync” and IMAP “Pull & Classify” (`EmailProvidersSection.tsx`). Background behavior is **timer-driven pull** (`startAutoSync` + **additional 2-minute interval** for all active IMAP accounts). Calling it “live sync” in banners is **product language**, not IMAP IDLE.
- **High-impact architectural quirk:** **`registerInboxHandlers` ends with `setInterval(..., 2 * 60 * 1000)`** that calls `syncAccountEmails` for **every IMAP account with `status === 'active'`**, **ignoring `email_sync_state.auto_sync_enabled`**. That can **overlap** with per-account `startAutoSync` ticks when Auto is on, increasing load and timeout probability.

### Top risks

- **Overloading `status: 'disabled'`** vs missing health signals; **`auto_sync_enabled` alone is insufficient** because IMAP interval bypasses it.
- **Double / concurrent sync pressure** on IMAP (2 min global interval + optional 5 min auto loop + manual Pull).
- **`listMessages` 30s cap** vs large SEARCH results, multi-folder merge, or slow providers → **spurious timeout banners** while `SYNC_ACCOUNT_EMAILS_MAX_MS` is 300s.
- **Unified inbox** has **no SQL filter by `account_id`** (`buildInboxMessagesWhereClause`) — “separate autosort per inbox” is not first-class at the list/query layer; AI rules are **global** (`inbox_ai_sort_rules`).

### Recommended next step

1. **Instrument / reproduce** IMAP timeout with `EMAIL_DEBUG=1` (see `emailDebug.ts`) and correlate **`[IMAP-SYNC-SUMMARY]`** logs (`syncOrchestrator.ts`) with whether failure strings are `listMessages timed out`, folder expand timeout, or outer 300s timeout.  
2. **Design the pause toggle** as an **orthogonal flag** to `auth_error` / `error`, and **unify IMAP background scheduling** so one policy (per-account pause + global Auto) controls all pulls.  
3. Only then draft an implementation prompt that touches **`ipc.ts`**, **`syncOrchestrator.ts`**, **`gateway`/persistence**, **`preload` + renderer account lists**, and **extension** messaging if accounts are surfaced there.

---

## 2. Scope of this analysis

- **Read-only:** repository inspection via search and file reads only.  
- **No code edits, no migrations, no dependency or config changes** were made during this task.  
- **Primary codebase:** `apps/electron-vite-project` (Electron main + renderer). **Secondary:** `apps/extension-chromium` (account list / disconnect wiring).

---

## 3. Relevant code inventory

### Frontend / UI

| Path | Role |
|------|------|
| `apps/extension-chromium/src/wrguard/components/EmailProvidersSection.tsx` | **Connected Email Accounts** list: badges (“Smart Sync” vs “Pull & Classify”), status dot, Connect, Disconnect, optional IMAP credential update. |
| `apps/electron-vite-project/src/components/EmailInboxView.tsx` | Loads `window.emailAccounts.listAccounts`, local `providerAccounts` state, embeds `EmailProvidersSection`, **`SyncFailureBanner`**, sync toolbar wiring. |
| `apps/electron-vite-project/src/components/EmailInboxBulkView.tsx` | Same account loading pattern + banner at scale. |
| `apps/electron-vite-project/src/components/BeapInboxDashboard.tsx`, `BeapBulkInboxDashboard.tsx` | BEAP dashboards: `listAccounts` / `deleteAccount`. |
| `apps/electron-vite-project/src/components/SyncFailureBanner.tsx` | User-facing sync issue copy including **“Live sync timed out…”** for timeout classification. |
| `apps/electron-vite-project/src/utils/syncFailureUi.ts` | Parses `[accountId] message` lines; classifies **timeout** vs auth/TLS/network. |
| `apps/electron-vite-project/src/components/EmailInboxSyncControls.tsx` | Sync window select, **Auto** checkbox (all eligible accounts), Pull/Sync button. |
| `apps/electron-vite-project/src/stores/useEmailInboxStore.ts` | **`syncAllAccounts`**, **`syncAccount`**, `lastSyncWarnings`, **`activeEmailAccountIdsForSync`**, auto-sync toggles via `inbox:toggleAutoSync`. |
| `apps/electron-vite-project/src/shared/email/pickDefaultAccountRow.ts` | (Extension/shared) default row selection. |
| `apps/extension-chromium/src/sidepanel.tsx` | `EMAIL_LIST_ACCOUNTS`, `EMAIL_DELETE_ACCOUNT`, `loadEmailAccounts`. |

### Backend / API (IPC)

| Path | Role |
|------|------|
| `apps/electron-vite-project/electron/preload.ts` | Exposes `emailAccounts.*`, `emailInbox.*` bridges. |
| `apps/electron-vite-project/electron/main/email/ipc.ts` | **`registerEmailHandlers`**, **`registerInboxHandlers`**: `email:listAccounts`, `email:deleteAccount`, `inbox:syncAccount`, `inbox:toggleAutoSync`, `inbox:getSyncState`, patch sync prefs, **IMAP 2-minute `setInterval`**, autosort session handlers, AI rules. |
| `apps/electron-vite-project/src/components/handshakeViewTypes.ts` | Renderer typings for bridges. |

### Domain / models

| Path | Role |
|------|------|
| `apps/electron-vite-project/electron/main/email/types.ts` | **`EmailAccountConfig`**, **`EmailAccountInfo`**, **`MessageSearchOptions`**, sync prefs, **status union**. |
| `apps/electron-vite-project/electron/main/email/domain/accountRowPicker.ts` | **`pickDefaultEmailAccountRowId`** — skips `error`, `disabled`, `auth_error`. |
| `apps/electron-vite-project/electron/main/email/domain/smartSyncPrefs.ts` | Effective sync window + max pull (referenced by orchestrator). |
| `apps/electron-vite-project/electron/main/email/domain/imapPullFolders.ts` | Base pull folder list; IMAP expansion via gateway. |
| `apps/electron-vite-project/electron/main/email/domain/capabilitiesRegistry.ts` | Provider capabilities (referenced from types / gateway). |

### Provider adapters

| Path | Role |
|------|------|
| `apps/electron-vite-project/electron/main/email/providers/base.ts` | `IEmailProvider` contract. |
| `apps/electron-vite-project/electron/main/email/providers/imap.ts` | Large IMAP implementation: connect, LIST/namespace, **`fetchMessagesSince` / `fetchMessagesBeforeExclusive`**, seq-range **`fetchMessages`**, **`fetchMessage`**, timeouts on some paths. |
| `apps/electron-vite-project/electron/main/email/providers/imapFetchReliable.ts` | Separate reliable fetch helper (own connection; **90s** `TIMEOUT_MS` in file — verify constant when implementing). |
| `apps/electron-vite-project/electron/main/email/providers/gmail.ts`, `outlook.ts`, `zoho.ts` | OAuth/API providers. |

### Sync / workers / jobs

| Path | Role |
|------|------|
| `apps/electron-vite-project/electron/main/email/syncOrchestrator.ts` | **Core pull engine**: folder resolve, **`listMessages` + 30s race**, ingest loop, **`SYNC_ACCOUNT_EMAILS_MAX_MS`**, **`startAutoSync`**, sync state updates, IMAP summary logging. |
| `apps/electron-vite-project/electron/main/email/syncPullLock.ts` | Pull lock — coordinates with remote queue (re-exported from orchestrator). |
| `apps/electron-vite-project/electron/main/email/inboxOrchestratorRemoteQueue.ts` | Remote MOVE/apply queue, **simple drain** interval profiles including **IMAP throttling** (`IMAP_SIMPLE_DRAIN`). |
| `apps/electron-vite-project/electron/main/email/messageRouter.ts`, `plainEmailIngestion.ts`, `beapEmailIngestion.ts` | Post-pull classification / ingestion pipelines. |

### Persistence / database

| Path | Role |
|------|------|
| `apps/electron-vite-project/electron/main/email/gateway.ts` | Load/save **`email-accounts.json`**, **`deleteAccount`** (splices row; disconnects provider), **`patchAccountSyncPreferences`**. |
| `apps/electron-vite-project/electron/main/handshake/db.ts` | **`email_sync_state`** DDL + migrations (`auto_sync_enabled`, `sync_interval_ms`, `imap_folders_consolidated`, etc.), **`inbox_settings`**, **`inbox_messages`**, autosort tables. |

### Observability / logging

| Path | Role |
|------|------|
| `apps/electron-vite-project/electron/main/email/emailDebug.ts` | **`EMAIL_DEBUG`**, `emailDebugLog` / `emailDebugWarn` gating. |
| `apps/electron-vite-project/electron/main/email/syncOrchestrator.ts` | **`[IMAP-SYNC-SUMMARY]`** JSON logs; `[SYNC]`, `[SYNC-IMPL]` console traces. |
| `apps/electron-vite-project/electron/main/email/ipc.ts` | **`[IMAP-AUTO-SYNC]`** logs for 2-minute tick; broadcast `inbox:newMessages` / invalidate. |

---

## 4. Current connected-account architecture

**Persistence:** One JSON file per machine user, not server-backed multi-tenant. **`EmailGateway`** holds `accounts: EmailAccountConfig[]` in memory; **`listAccounts`** maps via `toAccountInfo` (strips secrets, adds capabilities + mailbox slices).

**Identity:** Each connection is a single **`id` (UUID-style)**; **`inbox_messages.account_id`** references this id. Reconnecting the “same human mailbox” can produce a **new id** unless migration helpers run (`tryAutoMigrateInboxAccountOnReconnect`, `inbox:migrateInboxAccountId` in `ipc.ts`).

**Provider classification:** `EmailProvider` union in `types.ts`. Capabilities derive from provider + `authType` (`ProviderAccountCapabilities`).

**Status field:** `'active' | 'error' | 'disabled' | 'auth_error'` on disk types. **Runtime assignments** in `gateway.ts` / sync error paths use **`active`**, **`error`**, **`auth_error`** only (see Section 7). Renderer maps unknowns to UI “disabled”.

**Sync preferences:** Nested under `account.sync` (`syncWindowDays`, `maxMessagesPerPull`, `batchSize`, `maxAgeDays`, …). Patched via **`emailGateway.patchAccountSyncPreferences`** / IPC **`inbox:patchAccountSyncPreferences`**.

**Auto-sync state:** SQLite **`email_sync_state.auto_sync_enabled`** + **`sync_interval_ms`**. **`startAutoSync`** in `syncOrchestrator.ts` reads **`auto_sync_enabled === 1`** before each tick.

**Critical exception:** **IMAP-specific `setInterval` every 2 minutes** in `registerInboxHandlers` pulls **all active IMAP accounts** regardless of `auto_sync_enabled` (see Section 5).

---

## 5. Current sync architecture

### End-to-end pull (manual / auto)

1. **Renderer** calls `inbox:syncAccount` (or store `syncAllAccounts` loops per account id).  
2. **`runInboxAccountPullKind`** (`ipc.ts`) → **`syncAccountEmails`** (`syncOrchestrator.ts`).  
3. Orchestrator loads **SQLite** `email_sync_state` (`last_sync_at`, …) and **gateway** account config for window + max messages.  
4. Builds **`MessageSearchOptions`**: bootstrap (window / `syncMaxMessages`), incremental (`fromDate` with overlap), or Pull More (`toDate`).  
5. **IMAP:** resolve folders (`resolveImapPullFolders` + **`resolveImapPullFoldersExpanded`** with **30s** race). Optionally **list each folder** with separate **`listMessages` + 30s** races and merge.  
6. For each listed message not in `existingIds`, **`getMessage`**, attachments, **`detectAndRouteMessage`**.  
7. Updates **`email_sync_state`** (`last_sync_at` may be withheld by `shouldSkipAdvancingLastSyncAt` when 0 listed + 0 new).  
8. On throw: **`last_error`** in SQLite; possible **`auth_error`** on account row if message matches **`isLikelyEmailAuthError`**.

### OAuth vs IMAP

- **Gmail / Microsoft / Zoho:** HTTP APIs, pagination tokens; no node-imap socket in sync (adapter-specific).  
- **IMAP:** node-imap session cached on **`EmailGateway.providers` Map**; reconnect if disconnected (`getConnectedProvider`). **UID** semantics for listing in dated paths; **SEQ range** path exists in `fetchMessages` for undated fallback.  
- **Remote orchestrator:** OAuth providers implement server-side folder/label mutations; **IMAP implements** `applyOrchestratorRemoteOperation` with different edge cases (`inboxOrchestratorRemoteQueue.ts`).

### “Live sync” reality

- **No IMAP IDLE** in `imap.ts`.  
- **Background:** (a) per-account **`startAutoSync`** when user enables Auto (`inbox:toggleAutoSync`), interval from **`sync_interval_ms`** (merged default **300_000 ms** in `updateSyncState` vs DDL default **30000** — see Section 14).  
- **Plus** (b) **`IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000`** global interval for **every active IMAP** account.

---

## 6. Current UI behavior for the connected provider listing

- **WRGuard / BEAP Messages style listing:** `EmailProvidersSection.tsx` — rows show provider label, email, **Smart Sync vs Pull & Classify** badge, connection status badge, select radio/list behavior, **Disconnect** (calls `onDisconnectEmail`), **Update credentials** when IMAP `auth_error`.  
- **Inbox “no selection” panel:** `EmailInboxView.tsx` embeds the same `EmailProvidersSection` with `providerAccounts` derived from IPC.  
- **Account loading:** repeated pattern — `window.emailAccounts.listAccounts()` → map `provider` string to union → map `status` to UI union (fallback **`disabled`**).  
- **No per-account “pause” toggle** exists; only global **Auto** checkbox in inbox toolbars (`EmailInboxSyncControls.tsx`) toggles **`inbox:toggleAutoSync`** for **each id in `autoSyncEligibleAccountIds`** (store API).

**Where a toggle fits:** beside **Disconnect** / under row actions in `EmailProvidersSection.tsx`, and mirrored in Electron inbox panels that duplicate account controls.

---

## 7. Current deletion / disconnect semantics

**`email:deleteAccount` → `EmailGateway.deleteAccount`:**

- Disconnects cached provider if present (`providers.delete`).  
- **Splices account out of `this.accounts`** and **`saveAccounts`** — row **removed from `email-accounts.json`**.  
- **Does not** (in this function) delete SQLite **`inbox_messages`** or **`email_sync_state`**; those become **orphaned** until user runs **`inbox:fullResetAccount`** or manual cleanup. Product/UI should assume **disconnect is destructive for the connection row** but **not automatically a full local inbox wipe**.

**Extension:** `EMAIL_DELETE_ACCOUNT` mirrors the same gateway action.

**Contrast with target “deactivate”:** user wants **retain row + credentials + settings** — **not** `deleteAccount`.

---

## 8. Target behavior definition (implementation-ready)

| State | Meaning |
|-------|--------|
| **active** | Account row exists; credentials usable or user not in auth_error; **processing allowed** if sub-flags say so. |
| **inactive (paused)** | Row + secrets retained; **no background pull**, **no manual Pull for that account** (unless overridden), **no new remote orchestrator mutations** for that account (recommended); **local SQLite data retained**; row **visible** in UI with clear “Paused”. |
| **disconnected (removed)** | Row removed from gateway JSON (**current `deleteAccount`**); optional cleanup of local data is a **separate** explicit action. |
| **error** | Non-auth failure (network, timeout, etc.); **orthogonal** to paused — can show yellow/warning while paused vs active is separate dimension (recommended two axes). |
| **auth_error** | Credentials / OAuth need refresh; should **block** pulls until fixed; **pause** should not clear this. |
| **syncing** | Transient UI/main flag during `syncAccountEmails` / IPC call; not necessarily persisted. |
| **reauth required** | Same as **auth_error** in this codebase’s vocabulary. |

**Recommendation:** represent **paused** explicitly (`userPaused` or `processingEnabled: false`) rather than overloading **`status: 'disabled'`**, because **`disabled` is unused today** and the UI already treats it as a catch-all non-active bucket.

---

## 9. Gap analysis

| Area | Current | Gap vs target |
|------|---------|----------------|
| **User pause flag** | Not present | Need persisted field or clearly defined reuse of existing column with migration + semantics doc. |
| **UI toggle** | Connect / Disconnect only | Need **Pause / Resume** (or switch) per row; extension + Electron. |
| **API** | `deleteAccount`, `patchAccountSyncPreferences`, `toggleAutoSync` | Need **`setAccountProcessingEnabled`** or `patchAccount` including pause + IPC + preload. |
| **Orchestrator** | Pulls whenever invoked | Guard on pause at **single entry** (`syncAccountEmails` or IPC `runInboxAccountPullKind`) + **both** IMAP timers. |
| **`auto_sync_enabled`** | Gates `startAutoSync` only | **Does not** gate **2-minute IMAP interval** — must fix for coherent “Auto off means off”. |
| **Remote queue** | Keeps draining for queued rows | Policy needed: **skip** accounts that are paused, or pause only “pull” but allow pending moves (product decision). |
| **Health vs pause** | Single `status` string | Need **two dimensions** or clear rules to avoid losing **auth_error** when paused. |
| **Observability** | Console logs + optional EMAIL_DEBUG | Metrics: pull duration, list vs expand vs fetch phase, folder count, timeout counts **by account**. |

---

## 10. Autosort separation analysis

**Auto-Sort sessions:** IPC **`autosort:*`** in `ipc.ts` — sessions in **`autosort_sessions`**, messages tagged with **`last_autosort_session_id`**.

**AI rules:** Stored globally in **`inbox_settings`** keys **`inbox_ai_sort_rules`**, **`inbox_ai_tone`**, context docs (`getToneAndSortForPrompts`). **Not per `account_id`.**

**Inbox list:** **`buildInboxMessagesWhereClause`** has **no `accountId` filter** — unified inbox across accounts. Messages **do** carry **`account_id`** (`InboxMessage` in store).

**Weighting:** `inboxSortSourceWeighting.ts` biases by **source_type / handshake**, not by account.

**Conclusion:** **“Autosort separately per inbox/account” is only partially supported:** users can **Pull per account** (if account selection drives `syncAllAccounts` target set — see `activeEmailAccountIdsForSync` + toolbar wiring) and messages retain **`account_id`**, but **classification rules are global** and **list/query UI does not isolate accounts** without new filters or workspaces.

**Deactivate interaction:** pausing an account should **exclude** its messages from **future** auto-pull–driven sorting if sorting is triggered after sync; batch Auto-Sort over **`inbox_messages`** should **filter by `account_id`** if product requires strict separation (currently depends on how Auto-Sort routines select IDs — verify call sites before implementation).

---

## 11. IMAP sync issue — deep analysis

### 11.1 Actual IMAP flow (code path)

1. **Connect:** `ImapProvider.connect` → node-imap TLS / auth; capability snapshot; namespace warm-up.  
2. **Folder expansion:** `emailGateway.resolveImapPullFoldersExpanded` (LIST + discovery) — orchestrator races with **30s**.  
3. **List phase:** `ImapProvider.fetchMessagesSince` / `fetchMessagesBeforeExclusive` / undated `fetchMessages` per folder. **SEARCH** returns UIDs → **chunked UID FETCH** (chunk size 60) with **HEADER + TEXT** bodies on dated paths (see `fetchMessagesSince` in `imap.ts` — **TEXT** in body list may increase bytes moved on “list” phase).  
4. **Detail phase:** orchestrator calls **`getMessage`** → **`fetchMessage`** / folder walk — full RFC822 parse path.  
5. **State:** `email_sync_state.last_sync_at` drives incremental window; IMAP UID in **`email_message_id`** / dedupe set.

### 11.2 Timeout and retry analysis

| Mechanism | Location | Duration / behavior |
|-----------|----------|---------------------|
| List batch race | `syncOrchestrator.ts` | **30s** per `listMessages` call |
| Folder expand race | `syncOrchestrator.ts` | **30s** |
| Full sync race | `syncOrchestrator.ts` | **300s** (`SYNC_ACCOUNT_EMAILS_MAX_MS`) |
| Undated `fetchMessages` | `imap.ts` | **30s** timer around whole `openBox` + fetch |
| Reliable fetch | `imapFetchReliable.ts` | Separate **90s** (constant in file — confirm at fix time) |
| Orchestrator connect | `gateway.ts` `ensureConnectedForOrchestratorOperation` | **25s** race |

**Retries:** **No exponential backoff** at orchestrator level for timeout; next attempt is **next manual Pull or timer tick**. **Transient** remote-queue errors use conservative delays (`simpleDrainIsTransientOrchestratorError` in `ipc.ts`).

### 11.3 Sync window handling

- **`getEffectiveSyncWindowDays`** (`domain/smartSyncPrefs.ts` — referenced by orchestrator) + bootstrap `fromDate`.  
- UI: **7 / 30 / 90 / 1y** mapping; stored `0` = all mail (`emailInboxSyncWindowSelectValue` maps 0 → 365 in UI in one control — verify consistency with backend `0` semantics).  
- **Reducing window** lowers first bootstrap work **only for date-filtered paths**; incremental still scans from `last_sync_at`.

### 11.4 Where “Live sync timed out” is produced

1. **Renderer:** warning lines like **`[accountId] listMessages INBOX: listMessages timed out after 30s`** or **`SyncAccountEmails timed out after 300s`** land in **`lastSyncWarnings`**.  
2. **`SyncFailureBanner`** → **`classifySyncFailureMessage`** → **`timeout`** kind → timeout copy.  
3. **Note:** Banner says “live sync” for **all timeouts**, including **non-IMAP** — terminology is **generic**.

### 11.5 Ranked hypotheses (codebase-specific)

**A. `listMessages` 30s `Promise.race` too aggressive for IMAP (likely)**  
- **Evidence:** explicit `timeoutPromise` in `syncOrchestrator.ts` for every list; IMAP multi-folder runs **sequential** `listMessages` per folder — worst-case latency sums across folders.  
- **Symptom:** partial errors in `result.errors`, banner timeout messaging.

**B. Multi-folder IMAP merge multiplies wall time (likely)**  
- **Evidence:** loop `for (const folder of pullFolders)` each awaits list + 30s cap.  
- **Contradiction:** if first folder succeeds and second times out, merge may still return partial messages — investigate user-visible “stuck” vs “partial”.

**C. Parallel auto-sync overload (likely under “Auto” + IMAP)**  
- **Evidence:** **`startAutoSync`** + **2-minute IMAP sweep** can invoke **`syncAccountEmails`** more often than expected; per-account **serialization** in `syncChain` prevents same-account overlap but **not** cross-process starvation of IMAP server.  

**D. `fetchMessagesSince` fetches **TEXT** part on list path (possible perf bug)**  
- **Evidence:** `bodies: [..., 'TEXT']` in UID FETCH for dated search chunks — may be heavier than needed if list phase only requires headers for dedupe.  
- **Validation:** compare message list path byte volume vs Gmail/Outlook list APIs.

**E. Stale / half-open IMAP socket (possible)**  
- **Evidence:** `getConnectedProvider` reuses sessions; `forceReconnect` exists for drain — **list path** may not always reconnect on ambiguous failures.  
- **Logs:** node-imap `error` events, “connection closed” strings classified as network in banner.

**F. Outer 300s sync cap (possible for huge backfills)**  
- **Evidence:** `SYNC_ACCOUNT_EMAILS_MAX_MS = 300_000` with comment about avoiding false positives — still can trip on **very large** first pulls.  

**G. Misleading “live” UX for IMAP (product, not root cause)**  
- **Evidence:** IMAP is poll-based; users may attribute stalls to “live” failure — fix may include **copy + telemetry** more than protocol.

### 11.6 OAuth-push vs IMAP conflation?

- **Not literally treating IMAP as push** in protocol.  
- **However:** unified Auto checkbox + duplicate timers create **OAuth-like “always-on” expectation** while IMAP remains **pull-heavy** — operational mismatch.

### 11.7 Contradictions / unknowns

- **`sync_interval_ms` DDL default 30000** vs **`updateSyncState` merge default 300_000**: real interval depends on insert path — worth auditing live DB rows.  
- Whether **`TEXT`** body on list FETCH is intentional for snippet vs accident.  
- Exact **`imapFetchReliable`** call graph in production paths (ensure it’s not conflicting with gateway cache during diagnosis).

---

## 12. Risk analysis

| Category | Risk |
|----------|------|
| **Product** | Users confuse **Pause** vs **Disconnect**; lose mail if they pick wrong control. |
| **Technical** | Missing guard on **one** scheduler path (especially **2-minute IMAP**) undermines pause. |
| **Data integrity** | Pausing mid-sync + remote queue may leave **divergent** local vs server state. |
| **Performance** | Increasing timeouts may mask real issues; decreasing timers may increase server load. |
| **Concurrency** | `syncChains` serializes per account but **global IMAP interval** still hammers provider. |
| **Regression** | Changing **`activeEmailAccountIdsForSync`** could alter **which accounts Pull affects** — must align with user expectations. |

---

## 13. Safe implementation strategies

### Option A — Minimum-change / lowest-risk

**Idea:** Add **`userProcessingPaused`** (boolean) to `EmailAccountConfig` + `EmailAccountInfo`; **gate** `runInboxAccountPullKind`, **`startAutoSync` tick**, **and** the **2-minute IMAP `setInterval`** on `!paused && status === 'active'`; optionally gate **`activeEmailAccountIdsForSync`**.

- **Pros:** Small schema surface; clear semantics.  
- **Cons:** Still two scheduling mechanisms to maintain; remote queue behavior needs explicit decision.  
- **Blast radius:** IPC + gateway + ipc interval + a few UI files.  
- **Migration:** JSON field default `false`; old files omit → treated false.  
- **Testing:** Focused unit tests on guards + one integration IPC test.

### Option B — Cleaner medium-term architecture

**Idea:** **Single scheduler** per account (or global job queue with account metadata), **unify IMAP and OAuth** polling under **`email_sync_state` + provider policy**; remove or fold **2-minute IMAP exception**; separate **health** (`auth_error`) from **intent** (`paused`).

- **Pros:** Fewer surprises; easier observability; aligns Auto semantics.  
- **Cons:** Larger refactor; risk of regressions in sync timing.  
- **Blast radius:** `ipc.ts`, `syncOrchestrator.ts`, possibly extension timers.  
- **Migration:** Normalize `sync_interval_ms` defaults; backfill rows.  
- **Testing:** Longer matrix across providers.

---

## 14. Database and migration implications (future only)

- **`email_accounts` JSON:** new optional boolean(s) — **no SQL migration** if stored in JSON only.  
- **Alternatively** `email_sync_state` column e.g. **`user_paused INTEGER`** — requires **`handshake/db.ts` migration** + `updateSyncState` merges.  
- **Normalize `sync_interval_ms`:** today DDL default **30000** conflicts with orchestrator merge **300000** — future migration could **UPDATE** orphan rows to a canonical default.  
- **Orphan `email_sync_state`** after `deleteAccount` — optional cleanup job (product decision).

*This report does not implement migrations.*

---

## 15. API and contract implications (future)

- New IPC e.g. **`email:patchAccountFlags`** or **`email:setProcessingPaused`**.  
- **`email:listAccounts`** / **`EmailAccountInfo`** must surface **`processingPaused`** for UI + extension message shapes (`EMAIL_LIST_ACCOUNTS`).  
- **`inbox:getSyncState`** might duplicate pause info — avoid drift (single source of truth).  
- **Document** interaction with **`inbox:toggleAutoSync`:** global Auto may set **`auto_sync_enabled`** for many accounts — paused accounts should **skip** or **block toggle** with UI explanation.

---

## 16. Frontend implementation implications (future)

- **`EmailProvidersSection`**: add switch + copy; wire to IPC; optimistic UI with rollback.  
- **Stores:** `useEmailInboxStore` `activeEmailAccountIdsForSync` should respect pause.  
- **Extension sidepanel/popup:** propagate new field in account objects.  
- **`pickDefaultEmailAccountRowId` / `accountRowPicker`**: decide whether **paused** accounts are eligible for default send/sync — likely **yes for send, no for sync** or configurable.

---

## 17. Worker / job / sync engine implications (future)

- **Mandatory guards:** `syncAccountEmails` entry, **`startAutoSync`**, **`IMAP` 2-min interval**, possibly **`mirrorGlobalAutoSyncToNewAccount`**.  
- **Remote drain:** `inboxOrchestratorRemoteQueue` dequeue should **skip** paused accounts or **pause dequeue** entirely per product policy.  
- **Be plain / BEAP ingestion:** likely **independent** of email pull — explicit decision if pause should stop them (probably **no**).

---

## 18. Observability recommendations

- **Structured logs** per sync phase: `expandFoldersMs`, `listMs` per folder, `ingestCount`, `timeoutPhase`.  
- **Counts:** how often **`listMessages timed out after 30s`** vs **300s** outer.  
- **Metrics:** rolling pull success rate **by provider == imap**.  
- **Dev toggle:** document `EMAIL_DEBUG=1` for field diagnostics.  
- **UI:** optional “copy debug bundle” with last sync error from SQLite **`email_sync_state.last_error`**.

---

## 19. Test strategy (future implementation)

- **Unit:** `classifySyncFailureMessage`, pause guard helper, `pickDefaultEmailAccountRowId` with paused.  
- **Integration (main):** IPC pause → assert `syncAccountEmails` not called / no-op; unpause resumes; IMAP interval respects pause (inject clock or expose hook for tests if needed).  
- **Provider adapter:** mock IMAP slow SEARCH → verify race behavior (optional).  
- **Regression:** deactivate/reactivate does not delete JSON row; credentials intact.  
- **IMAP stability:** large folder fixture — assert list path does not pull full TEXT unnecessarily after optimization.  
- **E2E:** connect IMAP + force delay → banner timeout → recovery path.

---

## 20. Open questions and unknowns

- **Exact product intent** for paused accounts: **remote queue** continues or not?  
- **Whether `disabled` was reserved** for future manual admin disable — grep shows **no writer** today.  
- **Real-world distribution** of `sync_interval_ms` in user DBs (30s vs 5m).  
- **Auto-Sort** implementation: full scan vs selected IDs — need line-level review of `AutoSortSessionReview` / bulk flows for **`account_id`** filtering.  
- **Multi-mailbox slices** (`ProviderMailboxSlice`): how UI pause applies per slice vs row.

---

## 21. Recommended tailored fix prompt inputs (for a later implementation)

**Files / components likely to change**

- `electron/main/email/ipc.ts` — guards, possibly remove/refactor **IMAP 2-min** interval.  
- `electron/main/email/syncOrchestrator.ts` — optional central guard; list timeout policy.  
- `electron/main/email/gateway.ts` + `types.ts` — persist pause flag; `toAccountInfo`.  
- `electron/preload.ts` + `handshakeViewTypes.ts` — bridge.  
- `src/components/EmailProvidersSection.tsx`, `EmailInboxView.tsx`, `EmailInboxBulkView.tsx`, dashboards.  
- `src/stores/useEmailInboxStore.ts` — `activeEmailAccountIdsForSync`, sync targets.  
- `extension-chromium` sidepanel/popup/types for account payloads.  
- Optionally `inboxOrchestratorRemoteQueue.ts` — dequeue skip.

**Behaviors to preserve**

- **Disconnect** remains destructive removal from gateway JSON.  
- **`auth_error`** path and **`SyncFailureBanner`** actions for IMAP credentials.  
- **Per-account sync serialization** (`syncChains`).  
- **Dedupe** semantics and **`last_sync_at` anchor policy** for empty listings.

**Risks to avoid**

- **Stopping ingestion** without user intent (default-off pause).  
- **Treating `status` alone** as pause without fixing **2-minute IMAP** path.  
- **Breaking extension** account list schema (missing fields).

**Assumptions to validate first**

- Which timers must pause (**IMAP interval** yes; **remote drain** TBD).  
- Whether **`listMessages` 30s** should be raised only for IMAP or all providers.  
- Whether **TEXT** on IMAP list FETCH is required downstream.

**Implementation sequence (suggested)**

1. Add persistence + types + listAccounts surfacing.  
2. Gate **`syncAccountEmails`** + **both** schedulers.  
3. UI toggle + extension propagation.  
4. Metrics / logs for IMAP timeout phases.  
5. Tune IMAP timeouts / FETCH bodies after profiling.  
6. Tests.

**Test coverage required**

- Pause blocks **all** pull entry points.  
- Unpause restores pulls.  
- IMAP timeout classification still maps to banner.  
- **No regressions** for OAuth Auto-sync.

---

## 22. Final recommendation

Implement **explicit user pause (processing) state** stored alongside the account row **or** in `email_sync_state`, **never conflated with `auth_error`**, and **mandatorily gate** the **2-minute IMAP auto-sync `setInterval` in `registerInboxHandlers`** plus **`syncAccountEmails`**. In parallel, **treat IMAP timeouts as primarily orchestrator `listMessages` / folder-expand races** until proven otherwise: profile with **`EMAIL_DEBUG`**, review **`[IMAP-SYNC-SUMMARY]`**, and validate whether **HEADER-only list FETCH** suffices before widening timeouts or raising caps.

This combination addresses the **product ask (non-destructive pause)** with **controlled blast radius**, and gives a **evidence-based path** for the **IMAP sync timeout** symptom observed in **`SyncFailureBanner`**.

---

*End of report.*
