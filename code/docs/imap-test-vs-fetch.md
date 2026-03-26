# IMAP: `testConnection` vs `fetchMessages` vs `fetchMessage`

**Sources:** `apps/electron-vite-project/electron/main/email/gateway.ts`, `apps/electron-vite-project/electron/main/email/providers/imap.ts` (plus `warmImapNamespacePattern` → `getNamespaceInfo` / LIST-style helpers).

---

## 1. Where each path lives

| Path | File | Symbol |
|------|------|--------|
| Gateway entry (account test) | `gateway.ts` | `EmailGateway.testConnection(id)` (~437+) — requires IMAP password present for IMAP; calls `getProvider(account)` then `provider.testConnection(account)` |
| IMAP test | `imap.ts` | `ImapProvider.testConnection(config)` (~337–345) |
| IMAP list / sync window | `imap.ts` | `ImapProvider.fetchMessages(folder, options)` (~813–1031) → delegates to `fetchMessagesSince`, `fetchMessagesBeforeExclusive`, or in-method `openBox` + `seq.fetch` |
| IMAP full RFC822 + parse | `imap.ts` | `ImapProvider.fetchMessage(messageId)` (~1154–1209) → `fetchMessageFromFolder` (~1037+) → `openBox` + **`this.client.fetch(messageId, …)`** (UID fetch) + **`simpleParser`** |

---

## 2. What each path does (code-accurate)

### `gateway.testConnection` → `ImapProvider.testConnection`

1. **`ImapProvider.connect(config)`** — TCP/TLS to host:port, IMAP login (`ready`). **Does not** `openBox` any mail folder for mail listing.
2. On `ready`: **`refreshImapCapabilitiesSnapshot`**, **`warmImapNamespacePattern()`** (best-effort; may call **`getNamespaceInfo`** / LIST-derived logic; failures are warned, connect still succeeds).
3. **`disconnect()`** — ends session.

**Net:** Proves **network + auth to the IMAP server** and that the process can complete login. **Does not** SELECT/EXAMINE the mailbox used for sync, **does not** run SEARCH, **does not** FETCH bodies.

### `ImapProvider.fetchMessages`

**Precondition:** `this.client` set (sync uses a **long-lived** session via `gateway.getConnectedProvider`, not the ephemeral instance used only for `testConnection`).

Branching (~813+):

1. **`toDate` without `fromDate`** (valid date) → **`fetchMessagesBeforeExclusive`**: `openBox(folder, true)` → SEARCH **`BEFORE`** → UID sets → **`this.client.fetch(uidSpec, …)`** for header chunks.
2. **Valid `fromDate`** → **`fetchMessagesSince`**: `openBox(folder, true)` → SEARCH **`['SINCE', since]`** optionally **`AND` … `['BEFORE', before]`** if `toDate` set (~578–583) → if **no UIDs**, **`resolve([])`** (~602–608) — **not an error** → **`fetchMessages` returns 0 messages**.
3. **Invalid/missing `fromDate` (when branch applies)** → falls through to **seq-range path**: `openBox(folder, true)` → if **`box.messages.total === 0`**, **`resolve([])`** (~869–872); else **`seq.fetch`** ranges (read-only open), still populating **`id`/`uid` from message attributes**.

**Per-folder errors:** `openBox` / `search` / `fetch` **reject** the promise (caller sees exception). Empty SEARCH is **success with `[]`**.

### `ImapProvider.fetchMessage` (full message)

1. Optional **`messageCache`** hit.
2. **`fetchMessageFromFolder(messageId, config.folders.inbox || 'INBOX', { softOpen: false })`** — **`openBox`**, then **`this.client.fetch(messageId, { bodies: '', struct: true })`** (UID-based), stream → **`simpleParser`**. On **`openBox`** error with `softOpen: false` → **reject**.
3. If null, loops **lifecycle logical names** expanded to paths, **`softOpen: true`** — **`openBox` failure → `null`**, not throw; UID fetch in each path.
4. No match → **`return null`** (not throw).

**Related helpers:** `imapExpandMailboxTryPaths`, `resolveOrchestratorRemoteNames` — used for alternate folders in step 3.

---

## What `testConnection` proves

- **Verified:** Credentials and TLS (per `connect` options) are accepted for **IMAP login** to the configured host/port.
- **Verified:** Optional early **namespace / delimiter** warm-up can run; failure there is **non-fatal** to `connect` (~294–296).

---

## What `testConnection` does NOT prove

- **Verified:** That **`openBox(syncFolder)`** succeeds for the **same folder string** the orchestrator passes (e.g. LIST-expanded path vs literal `'INBOX'`).
- **Verified:** That **UID SEARCH** with **`SINCE` / `BEFORE`** (internal-date semantics per server) returns any messages for the sync window.
- **Verified:** That **UID FETCH** for listed UIDs succeeds when opening **`config.folders.inbox`** (or lifecycle fallbacks) — **`fetchMessage` path is separate** from list folder.
- **Verified:** That the **cached** sync session (`getConnectedProvider`) behaves identically to the **fresh** instance used in `testConnection` (same config, but different connection lifecycle / timing).

---

## Top 3 IMAP fetch failure modes still compatible with successful `testConnection`

1. **SEARCH returns zero UIDs** (`fetchMessagesSince` ~602–608) — e.g. incremental **`fromDate`** (`last_sync_at`) after all mail’s **internal IMAP date**, timezone/date quirks, or mail only in another folder while this folder is empty. **No throw**; **`fetchMessages` → `[]`**.

2. **`openBox(folder)` fails** for sync folder (typo, ACL, renamed mailbox, wrong expanded path) while **login** still succeeded in test — **`fetchMessages` rejects** or multi-folder sync logs per-folder errors (`syncOrchestrator` merges other folders). Test never opened that folder.

3. **List returns UIDs but `fetchMessage` returns `null`** — UID listed from one **selected** mailbox context; **`fetchMessage`** first opens **`config.folders.inbox || 'INBOX'`** only (~1164–1171). If that path ≠ list folder or UID not visible there, **soft-fail** after lifecycle scan → **`null`** → orchestrator skips ingest. **Login/test still OK.**

---

## Supplement: gateway `testConnection` vs sync session

- **`gateway.testConnection`:** `getProvider(account)` builds a **new** `ImapProvider`, `testConnection` → connect/disconnect (~453–454 in `gateway.ts`).
- **Sync:** `getConnectedProvider` reuses **cached** provider per `accountId` (~`gateway.ts` `getConnectedProvider`).

**Inference:** Intermittent or idle-timeout issues could affect sync while a **fresh** test succeeds; not proven unique to your app without traces.

---

*Line numbers refer to the current tree under `apps/electron-vite-project`.*
