# Inbox pull vs `email:syncAccount` — code verification

**Verified from source only** (no behavior inferred beyond what these symbols do).

## 1. Which preload namespace exposes the real inbox pull?

**File:** `apps/electron-vite-project/electron/preload.ts`

- **`contextBridge.exposeInMainWorld('emailInbox', { … })`** defines  
  **`syncAccount: (accountId: string) => ipcRenderer.invoke('inbox:syncAccount', accountId)`** (line 682).
- **`contextBridge.exposeInMainWorld('emailAccounts', { … })`** (lines 609–666) defines `listAccounts`, `getAccount`, `testConnection`, `connectCustomMailbox`, `resetSyncState`, etc. **It does not define `syncAccount`.**

**Conclusion:** The renderer API for inbox pull is **`window.emailInbox.syncAccount(accountId)`**, not `window.emailAccounts.syncAccount`.

---

## 2. What does `email:syncAccount` actually do?

**File:** `apps/electron-vite-project/electron/main/email/ipc.ts`

- **Handler:** `ipcMain.handle('email:syncAccount', …)` (lines 1057–1065).
- **Body:** `await emailGateway.syncAccount(accountId)` → returns `{ ok: true, data: status }`.

**File:** `apps/electron-vite-project/electron/main/email/gateway.ts`

- **Method:** **`EmailGateway.syncAccount(accountId: string): Promise<SyncStatus>`** (lines 910–947).
- **Behavior:** `getConnectedProvider(account)` then **`provider.testConnection(account)`** only. Comment in code: **`// Just test connection for now`** (line 916). On success/failure it updates **`account.status`**, **`lastSyncAt`**, **`lastError`**, calls **`saveAccounts`**, returns **`SyncStatus`**.

**Conclusion:** **`email:syncAccount`** runs **connection test + persisted account status**, **not** `syncAccountEmails` / inbox DB pull.

**Misleading surface:** In `ipc.ts`, the handler is introduced with the comment **`/** Sync an account */`** (lines 1054–1056), which does **not** match the gateway implementation (test-only).

---

## 3. What does `inbox:syncAccount` actually do?

**File:** `apps/electron-vite-project/electron/main/email/ipc.ts`

- **Handler:** `ipcMain.handle('inbox:syncAccount', …)` (lines 2388–2402).
- **Body:** `return await runInboxAccountPullKind(accountId, 'pull')`.

- **Function:** **`runInboxAccountPullKind`** (lines 2257–2386), for `kind === 'pull'`:
  - Calls **`syncAccountEmails(db, { accountId })`** (imported from `./syncOrchestrator`, line 2271).
  - Then **`processPendingPlainEmails(db)`**, **`processPendingP2PBeapEmails(db)`**, remote queue **`enqueueRemoteOpsForLocalLifecycleState`** / **`scheduleOrchestratorRemoteDrain`** as applicable.
  - Builds **`pullStats`**, optional **`pullHint`**, may **`sendToRenderer('inbox:newMessages', result)`**.

**Conclusion:** **`inbox:syncAccount`** is the **full inbox pull / ingest / post-processing** path.

---

## 4. What does the UI store use for manual pull?

**File:** `apps/electron-vite-project/src/stores/useEmailInboxStore.ts`

- **`getBridge()`** returns **`window.emailInbox`** (lines 301–302).
- **`syncAccount: async (accountId) => { … }`** (from line 1227): uses **`bridge.syncAccount(accountId)`** where **`bridge = getBridge()`**; logs **`[PULL] store.syncAccount invoking inbox:syncAccount`** (line 1238); invokes **`await bridge.syncAccount(accountId)`** (line 1242).

**Conclusion:** Manual pull goes through **`window.emailInbox.syncAccount`** → **`inbox:syncAccount`**, not `emailAccounts`.

---

## 5. Typings and other confusion sources

**File:** `apps/electron-vite-project/src/components/handshakeViewTypes.ts`

- **`Window.emailAccounts`** (lines 76–130): includes `resetSyncState`, `testConnection`, etc. **No `syncAccount` on `emailAccounts`.**
- **`EmailInboxBridge`** / **`Window.emailInbox`**: includes **`syncAccount`** with pull result shape (`pullStats`, `pullHint`, `syncWarnings`, …) (lines 142–169).

**Aligned with preload:** typings do **not** claim `emailAccounts.syncAccount`.

**Stale / misleading (elsewhere in repo):**

| Item | Location | Issue |
|------|-----------|--------|
| Comment “Sync an account” | `ipc.ts` ~1054–1056 above `email:syncAccount` | Implies full sync; gateway only tests connection. |
| Handler name vs behavior | `email:syncAccount` | Same **IPC channel name** as a **renderer method name** on a **different** object (`emailInbox.syncAccount` → **`inbox:syncAccount`**, not `email:syncAccount`). |
| `email:syncAccount` registered | `ipc.ts` `registerEmailHandlers` channel list includes `'email:syncAccount'` (line 458) | **Not** exposed on `preload.ts` `emailAccounts`; only reachable if something invokes `ipcRenderer.invoke('email:syncAccount', …)` manually or from non-preload code. |

---

## Does this explain production IMAP failure, or only debugging confusion?

**Debugging confusion — verified:** If someone assumes **`window.emailAccounts.syncAccount`** exists or that **`email:syncAccount`** pulls mail, that is **wrong per code**; the real pull is **`window.emailInbox.syncAccount`** → **`inbox:syncAccount`** → **`syncAccountEmails`**.

**Production IMAP failure — not explained by this verification alone:** This document only proves **API wiring and naming**. It does **not** establish why IMAP fetch returns 0 messages, auth fails at pull, folders mismatch, etc. Those require tracing **`syncOrchestrator`**, **`ImapProvider`**, and DB state — separate from the **`email:syncAccount` vs `inbox:syncAccount`** split.

---

## Optional minimal change (not applied)

To reduce future confusion, you could add an explicit alias on `emailAccounts` (same IPC as inbox pull):

```diff
--- a/apps/electron-vite-project/electron/preload.ts
+++ b/apps/electron-vite-project/electron/preload.ts
@@ -626,6 +626,8 @@ contextBridge.exposeInMainWorld('emailAccounts', {
   connectCustomMailbox: (payload: unknown) =>
     ipcRenderer.invoke('email:connectCustomMailbox', assertCustomMailboxPayload(payload)),
   resetSyncState: (accountId: string) => ipcRenderer.invoke('inbox:resetSyncState', accountId),
+  /** Same as `window.emailInbox.syncAccount` — pulls into SQLite inbox. */
+  pullInbox: (accountId: string) => ipcRenderer.invoke('inbox:syncAccount', accountId),
```

Renaming `email:syncAccount` to e.g. `email:verifyMailboxConnection` would require coordinated IPC + any external callers.
