# IMAP Password Storage Analysis

## Verified Save Flow

| Step | Location | Behavior |
|------|-----------|----------|
| **Initial connect (wizard / HTTP)** | `EmailConnectWizard.tsx` → `window.emailAccounts.connectCustomMailbox(payload)` (preload `email:connectCustomMailbox`) → `ipc.ts` → `emailGateway.connectCustomImapSmtpAccount` | Passwords come from **`payload.imapPassword` / SMTP** (`gateway.ts` ~1278–1296). Account row is **`push`ed to `this.accounts`**, then **`saveAccounts(this.accounts)`** (~1370–1376). A **post-save guard** re-applies passwords from the connect payload if the in-memory row is empty (~1378–1386). |
| **Reconnect / edit** | `EmailConnectWizard.tsx` ~735–740 → `updateImapCredentials(reconnectAccountId, { imapPassword: cf.imapPassword, … })` → IPC `email:updateImapCredentials` → `gateway.updateImapCredentials` | **Non-empty** IMAP password required (~546–548). Builds **fresh** `nextImap` / `nextSmtp` objects (no spread of old `imap`) (~559–572), then **`updateAccount`** (~573–578), **`testConnection`**, **`forceReconnect`**. |
| **Any account mutation that persists** | `saveAccounts` (`gateway.ts` ~280–308) | For each account: OAuth encrypted; then **`encryptImapSmtpPasswordsForDisk`** (~173–221). Writes **`userData/email-accounts.json`** (see `getAccountsPath` ~227–231). |
| **Encryption primitive** | `encryptImapSmtpPasswordsForDisk` + `secure-storage.ts` `encryptValue` | Passwords are **not** in OS keytar as separate items; they are **encrypted with Electron `safeStorage`** and stored **inside JSON** as base64 ciphertext when `isSecureStorageAvailable()` is true. `_encrypted` on disk mirrors `encAvail` (~196–197). If secure storage is **unavailable**, plaintext is written and `_encrypted` is false (~40–42 in `encryptValue`, ~196 in gateway). |

**Best-effort vs guaranteed:** `saveAccounts` catches errors and logs (~306–308) — **failure to write disk does not throw to every caller** (best-effort at the helper level). Successful `writeFileSync` implies the encrypted snapshot was written.

## Verified Load / Rehydration Flow

| Step | Location | Behavior |
|------|-----------|----------|
| **Startup** | `EmailGateway` constructor ~318–320 | **`this.accounts = loadAccounts()`** — single in-memory array for the process lifetime. |
| **Disk read** | `loadAccounts` (~237–274) | Reads `email-accounts.json`, maps each row: OAuth decrypt; then **`decryptImapSmtpPasswords(next)`** (~265). |
| **Per-IMAP decrypt** | `decryptImapSmtpPasswords` (~97–162) | Only when **`isDiskEncryptedPasswordFlag(imap._encrypted)`** (true or `"true"`). Calls **`decryptValue(imap.password)`** and replaces with **plaintext** in memory, sets **`_encrypted: false`** in memory (~116–118). |
| **Renderer-facing list** | `toAccountInfo` (~1626–1654) | **Does not include IMAP/SMTP passwords** — UI list is always non-secret fields only. |
| **“Do we still have a password?”** | `getImapReconnectHints` (~504–532) | Exposes **`hasImapPassword` / `hasSmtpPassword`** based on **non-empty** in-memory strings (~513–514). |

**Blank password field vs backend:** **Verified** — empty UI field is **cosmetic** for normal listing; **`getImapReconnectHints`** can still report **`hasImapPassword: true`** when the secret exists in memory. **Reconnect via `updateImapCredentials` requires typing the password again** (`updateImapCredentials` rejects empty ~546–548) — **blank does *not* mean “keep old secret”** for that API; it means **validation error**.

**When backend truly loses the secret:** **Verified** — `decryptImapSmtpPasswords` **catch** path sets **`imap.password: ''`** and **`status: 'error'`** with a decrypt error message (~121–128). After that, **`hasImapPassword`** is false and **`testConnection` / `getConnectedProvider`** treat password as missing.

## Verified Runtime Usage

| Operation | Path | Credential source |
|-----------|------|-------------------|
| **`testConnection(accountId)`** | `gateway.ts` ~457–501 | **`this.accounts`** row; requires **non-empty** `account.imap.password` for IMAP (~464–469). Uses **`getProvider` → `ImapProvider.testConnection`**. |
| **Manual / background sync** | `syncOrchestrator.ts` ~370+ | **`emailGateway.getAccountConfig(accountId)`** — **same** in-memory `EmailAccountConfig` as gateway (~370). |
| **Reconnect / live IMAP session** | `getConnectedProvider` ~1545–1623 | For IMAP, **refuses** if `imap.password` null/blank (~1546–1555). Uses **`provider.connect(account)`** with that row. |
| **Ephemeral list/get (IMAP)** | `listMessages` / `getMessage` IMAP branches ~600–639 | **`getProvider`** (new `ImapProvider`) + **`connect(account)`** — same account object. |

**Verified:** **`testConnection`**, **sync**, and **cached `getConnectedProvider`** all use the **same** `this.accounts` row (not a second store). **Inference:** No separate “test-only” password channel for IMAP in the traced code.

## Verified Update / Edit Flow

| Topic | Finding |
|--------|---------|
| **`updateImapCredentials` + blank password** | **Verified** — **`imapPassword` trimmed empty → `{ success: false, error: 'Password required' }`** (~546–548). **Does not** overwrite stored secret with empty. |
| **`mergeImapSmtpCredentials` + empty string** | **Verified** in code — merge **filters `undefined` only** (~168–170). **`password: ''` is not filtered** and **would overwrite** previous password if present in patch. |
| **`updateAccount` nested merge** | **Verified** — avoids dropping password when **`updates.imap` omits** password by using **`mergeImapSmtpCredentials`** (~390–411). **Does not** protect against **explicit** `password: ''` in patch. |
| **Orchestrator / IPC status-only updates** | **Verified** — `syncOrchestrator` and `ipc` auth-error paths call **`updateAccount` with only `status` / `lastError`** (~716–720, ~733–737, ~2298–2301, `inboxOrchestratorRemoteQueue` ~550–553) — **`patchImap` is `undefined`**, so **IMAP passwords are not touched**. |

**“Password saved” UI:** Can show success only after **`updateImapCredentials`** completes **`testConnection`** successfully (~579–582). **Inference:** If user sees intermittent loss later, it is **not** from these status-only updates in the traced paths.

## Top 5 Credential Loss Points (ranked)

1. **`decryptImapSmtpPasswords` failure** (`gateway.ts` ~97–129) — **`decryptValue` throws** → account gets **`imap.password: ''`**, **`status: 'error'`**, user-facing decrypt message. **Likelihood: high** whenever OS **`safeStorage`** cannot decrypt prior ciphertext (profile change, corruption, reinstall).

2. **`encryptImapSmtpPasswordsForDisk` with empty plaintext** (`gateway.ts` ~173–180) — **`imapPlain.length === 0`** still produces an “encrypted” blob for `''` and persists (~178–196). **Any** prior code path that left **`account.imap.password`** empty at save time **persists loss**. **Likelihood: medium** as downstream of (1) or failed partial updates.

3. **`mergeImapSmtpCredentials` + explicit `password: ''`** (`gateway.ts` ~168–170) — **Verified** overwrite semantics. **Likelihood: low** unless some caller sends empty string in **`updates.imap`** (not found in gateway `updateAccount` call sites for IMAP patches in traced files).

4. **`encryptValue` exception path** (`secure-storage.ts` ~45–51) — If **`encryptString` throws** while **`isSecureStorageAvailable()`** is true, **`encryptValue` returns plaintext `p`**, but **`_encrypted`** on disk is still **`true`** (`gateway.ts` ~196). On next load, **`decryptValue`** may **fail** → back to point (1). **Inference:** edge case during OS/crypto errors.

5. **`decryptValue` legacy-token heuristic** (`secure-storage.ts` ~57–87, ~83–86) — **`isUnencryptedToken(encrypted)`** may **skip** `safeStorage.decryptString` for strings that **look** like OAuth/JWT-style tokens. **Inference:** wrong plaintext for an IMAP password **unlikely to be empty**; more likely **bogus password** / auth errors than “missing”, unless heuristic returns empty in an edge case.

## Most Likely Root Cause

**Inference (primary):** **Rehydration / decryption failure at startup** (`loadAccounts` → `decryptImapSmtpPasswords`), or **persisting an empty password** once (point 2) so subsequent loads keep ciphertext of empty string — manifests as **missing password** in **`testConnection`**, **`getConnectedProvider`**, and **sync**, all reading the same in-memory row.

**Verified supporting fact:** All runtime paths checked use **`emailGateway`’s `this.accounts`**; there is **no second** IMAP password store in the traced stack.

## Minimal Next Step

**One logging point (single file):** In **`gateway.ts`**, inside **`decryptImapSmtpPasswords`**, in the **`catch`** block that clears the IMAP password (~121–128), log **`account.id`**, **`account.email`**, and **`err` message/code** (no password values). That **directly confirms** whether production “loss” is **decrypt failure** vs other causes.

**Alternative minimal fix (only if proven):** After verification, consider **not** overwriting password with `''` on decrypt failure (keep last known error state without clobbering ciphertext) — that would be a **behavior change**; prefer **logging first**.
