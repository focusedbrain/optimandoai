# IMAP: testConnection (works) vs sync / listMessages (fails) — final analysis

**Codebase snapshot:** current `gateway.ts`, `imap.ts`, `syncOrchestrator.ts`.  
**Note:** `listMessages` does **not** call `imapFetchReliable` anymore; IMAP uses the same `getConnectedProvider` → `ImapProvider.fetchMessages` path as other providers.

---

## Task 1: Trace testConnection (working path)

### `EmailGateway.testConnection` — full method

```457:502:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async testConnection(id: string): Promise<{ success: boolean; error?: string }> {
    const account = this.accounts.find(a => a.id === id)
    if (!account) {
      // For new accounts being tested before save
      return { success: false, error: 'Account not found' }
    }

    if (account.provider === 'imap') {
      const pw = account.imap?.password
      if (pw == null || String(pw).trim().length === 0) {
        console.error('[EmailGateway] testConnection: IMAP password missing for', account.id)
        return { success: false, error: 'IMAP password is missing — account may need to be reconnected.' }
      }
    }

    try {
      const provider = await this.getProvider(account)
      const result = await provider.testConnection(account)

      // Update account status — distinguish IMAP credential failures from generic errors
      if (result.success) {
        account.status = 'active'
        account.lastError = undefined
      } else {
        const authFail =
          account.provider === 'imap' && result.error && isLikelyEmailAuthError(result.error)
        account.status = authFail ? 'auth_error' : 'error'
        account.lastError = authFail
          ? 'Authentication failed — check credentials'
          : result.error
      }
      account.updatedAt = Date.now()
      saveAccounts(this.accounts)

      return result
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (account.provider === 'imap' && isLikelyEmailAuthError(msg)) {
        account.status = 'auth_error'
        account.lastError = 'Authentication failed — check credentials'
        account.updatedAt = Date.now()
        saveAccounts(this.accounts)
      }
      return { success: false, error: msg }
    }
  }
```

**Account object:** `this.accounts.find(a => a.id === id)` — the **in-memory** `EmailAccountConfig` row (same array `findAccount` uses). It includes **`imap.password`** when loaded/decrypted correctly.

**How it connects:** It does **not** call `getConnectedProvider`. It calls **`getProvider(account)`** → **`new ImapProvider()`** (new instance every time), then:

### `ImapProvider.testConnection` — full method

```337:345:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\providers\imap.ts
  async testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect(config)
      await this.disconnect()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection failed' }
    }
  }
```

**`connect(config)`** stores `this.config = config` and uses `config.imap!.password` on the wire:

```231:265:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\providers\imap.ts
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.imap) {
      throw new Error('IMAP configuration required')
    }
    
    this.config = config
    // ...
      const client = new ImapCtor({
        user: config.imap!.username,
        password: config.imap!.password,
        host: config.imap!.host,
        port: config.imap!.port,
        tls: useImplicitTls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      })
```

**After test:** `disconnect()` clears **`this.client`**, **`this.config = null`**, etc. That **ephemeral** `ImapProvider` is **not** stored in `gateway.this.providers`.

---

## Task 2: Trace sync path (listMessages)

### From `syncAccountEmailsImpl` to `listMessages`

`syncOrchestrator` passes **`accountId` only** (string). It does **not** pass an account object into `listMessages`.

```505:531:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\syncOrchestrator.ts
            const listPromise = emailGateway.listMessages(accountId, { ...listOptions, folder })
            const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('listMessages timed out after 30s')), 30000))
            const part = await Promise.race([listPromise, timeoutPromise])
            // ...
        const listPromise = emailGateway.listMessages(accountId, { ...listOptions, folder })
        const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('listMessages timed out after 30s')), 30000))
        messages = await Promise.race([listPromise, timeoutPromise])
```

Earlier in the same impl, **`getAccount(accountId)`** returns **`EmailAccountInfo`** (sanitized), and **`getAccountConfig(accountId)`** returns full config for sync prefs — but **`listMessages` is only invoked with `accountId`**.

### `gateway.listMessages` — current full method

```595:603:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]> {
    const account = this.findAccount(accountId)
    const effectiveFolders = getFoldersForAccountOperation(account, options?.mailboxId)
    const folder = options?.folder ?? effectiveFolders.inbox

    const provider = await this.getConnectedProvider(account)
    const rawMessages = await provider.fetchMessages(folder, options)
    return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
  }
```

- **No `imapFetchReliable`.**
- **Yes `getConnectedProvider(account)`** after **`this.findAccount(accountId)`**.

### What `findAccount` returns

```1401:1407:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  private findAccount(id: string): EmailAccountConfig {
    const account = this.accounts.find(a => a.id === id)
    if (!account) {
      throw new Error('Account not found')
    }
    return account
  }
```

Same underlying lookup as **`testConnection`’s** `this.accounts.find` — **the full in-memory `EmailAccountConfig`**, including **`imap.password`** when present.

### Extra sync step before `listMessages` (same account row)

For IMAP, sync calls **`resolveImapPullFoldersExpanded`** which also uses **`getConnectedProvider(account)`** with **`this.accounts.find`**:

```1309:1319:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async resolveImapPullFoldersExpanded(accountId: string, baseLabels: string[]): Promise<string[]> {
    const account = this.accounts.find((a) => a.id === accountId)
    const fallback = baseLabels.length > 0 ? baseLabels : ['INBOX']
    if (!account || account.provider !== 'imap') {
      return fallback
    }
    try {
      const provider = await this.getConnectedProvider(account)
      const expand = (provider as ImapProvider).expandPullFoldersForSync
      if (typeof expand === 'function') {
        const expanded = await expand.call(provider, baseLabels.length > 0 ? baseLabels : ['INBOX'])
```

So **before** `listMessages`, the gateway may already have **connected the cached provider** for folder expansion.

---

## Task 3: Compare — where they diverge

| Aspect | testConnection | sync → listMessages |
|--------|----------------|---------------------|
| Account lookup | `this.accounts.find(a => a.id === id)` | `findAccount` = **same** `this.accounts.find` |
| `imap.password` on that object | Required non-empty for IMAP before proceeding | Same row; **`getConnectedProvider`** also refuses if password empty |
| Provider instance | **`getProvider(account)`** → **new** `ImapProvider` **not** inserted into `this.providers` | **`getConnectedProvider(account)`** → **cached** `this.providers.get(account.id)` or **new** + **`this.providers.set`** |
| Connect pattern | `connect(account)` then **`disconnect()`** (ephemeral) | **`connect(account)`** and keep connection for **`fetchMessages`** |
| `ImapProvider.testConnection` | `connect` + `disconnect` | N/A |
| List/fetch | Does not run `fetchMessages` / `openBox` list pull | Runs **`fetchMessages`** (`openBox` + `seq.fetch`, 30s timer) |

**Conclusion from code:** There is **no** second “stripped” account type on the sync path for **`listMessages`**: both paths use the **same** `EmailAccountConfig` reference from **`this.accounts`**.

**Actual divergence:** **`testConnection`** uses a **fresh** `ImapProvider` and only proves **TCP + IMAP login** via **`connect`**. **Sync** uses **`getConnectedProvider`** (cached `ImapProvider`) and then **`fetchMessages`** (mailbox open + sequence fetch + client-side date filters + timeouts). Failure modes (timeouts, `openBox` on expanded folder paths, stale socket, etc.) differ from a short login test.

**`imapFetchReliable` / type cast:** Not used in current `listMessages`; not the divergence in this tree.

---

## Task 4: `getAccountConfig` vs `findAccount`

### `getAccountConfig`

```336:339:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  getAccountConfig(id: string): EmailAccountConfig | undefined {
    return this.accounts.find((a) => a.id === id)
  }
```

### `findAccount`

```1401:1407:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  private findAccount(id: string): EmailAccountConfig {
    const account = this.accounts.find(a => a.id === id)
    if (!account) {
      throw new Error('Account not found')
    }
    return account
  }
```

**Same object** when the id exists. **Neither** strips credentials.  
**`getAccount`** (used for UI) returns **`toAccountInfo`** and **does not** include `imap` / passwords — but **`listMessages` does not use `getAccount`** for the connection; it uses **`findAccount`**.

---

## Task 5: What `syncOrchestrator` passes to `listMessages`

Only **`accountId: string`** and **`MessageSearchOptions`** (`listOptions` + `folder`). The gateway resolves the full account via **`findAccount(accountId)`**.

---

## `getConnectedProvider` (sync path) — relevant excerpt

IMAP password check + cache + `connect(account)`:

```1431:1493:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  private async getConnectedProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    if (account.provider === 'imap') {
      const pw = account.imap?.password
      if (pw == null || String(pw).trim().length === 0) {
        console.error(
          '[EmailGateway] IMAP password missing — refusing connect for account',
          account.id,
          account.email,
        )
        throw new Error('IMAP password is missing — account may need to be reconnected.')
      }
    }

    let provider = this.providers.get(account.id)

    if (provider && account.provider === 'imap') {
      if (!provider.isConnected()) {
        try {
          await provider.disconnect()
        } catch {
          /* noop */
        }
        this.providers.delete(account.id)
        provider = undefined
      }
    }

    if (!provider) {
      provider = await this.getProvider(account)
      // ... onTokenRefresh for OAuth ...
      await provider.connect(account)
      // ...
      this.providers.set(account.id, provider)
```

**Note:** **`disconnect()`** on `ImapProvider` sets **`this.config = null`**. A **new** provider is then **`connect(account)`** again with the **same** gateway `account` row (still holds password if decryption/load is OK).

---

## `fetchMessages` — reconnect edge (if client gone)

```813:820:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\providers\imap.ts
  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    if (!this.client || !this.isConnected()) {
      if (this.config) {
        await this.connect(this.config)
      } else {
        throw new Error('IMAP not configured')
      }
    }
```

If the cached instance was **`disconnect()`’d** with **`config` cleared**, **`fetchMessages`** can throw **`IMAP not configured`** even when **`account` in the gateway still has a password** — because reconnect uses **`this.config` on the provider**, not the gateway account. **Typically** `getConnectedProvider` creates a fresh provider and **`connect(account)`** before `fetchMessages`, so **`this.config` should be set** unless something else cleared it.

---

## Summary answers

### Exact line where sync path diverges from testConnection

- **`gateway.ts` ~473 vs ~600:**  
  - **testConnection:** `const provider = await this.getProvider(account)` (no cache).  
  - **listMessages:** `const provider = await this.getConnectedProvider(account)` (cache + long-lived session + later **`fetchMessages`**).

### What sync path is “missing” vs testConnection

**Not** a missing **`imap.password`** on the **account** object for **`findAccount`** vs **`testConnection`** — they share the **same** `this.accounts` row.

What **testConnection does not do** but **sync does:** keep a **cached** `ImapProvider`, possibly **reconnect** after **disconnect**, run **`resolveImapPullFoldersExpanded`** (extra IMAP work), then **`openBox` + `seq.fetch`** with **30s** fetch timeout and **orchestrator** timeouts (30s / 45s). **“Connection issue” after timeout** aligns with **operational / fetch / mailbox** failure more than a **different account shape**.

### One-line fix (hypothesis — verify in logs)

Because the analysis shows **no credential stripping on the account object**, a **pragmatic** one-liner is **not** “add password to sync” but to **align behavior with the ephemeral test** or **reset bad cache**, for example:

- **`this.providers.delete(accountId)`** immediately before **`getConnectedProvider`** in **`listMessages`** (or at start of IMAP sync), **or**
- **`await emailGateway.forceReconnect(accountId)`** (if such API exists) before list — **only if** logs show stale provider / `IMAP not configured` inside **`fetchMessages`**.

**If** logs prove **`imap.password`** is empty at **`getConnectedProvider`**, the bug is **upstream** (load/decrypt/save), not **`findAccount` vs testConnection** — fix **persistence/decryption**, not the list path lookup.

---

## Appendix: `disconnect` clears provider config

```311:324:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\providers\imap.ts
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end()
      this.client = null
    }
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
    }
    this.connected = false
    this.config = null
    this.messageCache.clear()
    this.namespaceInfoCache = null
    this.serverCapabilities = []
  }
```
