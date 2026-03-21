# EXHAUSTIVE IMAP CODE ANALYSIS — Read-only report

**Generated:** static analysis of the repository at documentation time.  
**Constraint:** No code was modified for this document.  
**Context:** web.de IMAP remote sync issues vs Outlook working; Verify Remote timeouts; drain “completed” without visible server moves.

---

## Executive summary

| Area | Assessment |
|------|------------|
| IMAP connect/auth/TLS | **WORKING** by design (LOGIN + password via `node-imap`); **UNTESTED** against live web.de in this document |
| Gateway `getConnectedProvider` / `forceReconnect` | **WORKING** (reconnect when `!isConnected()` or after forced disconnect) |
| `applyOrchestratorRemoteOperation` (IMAP) | **MIXED** — path is coherent; **pre-move verify disabled** (commented); post-move verify remains; **false “success”** possible if MOVE succeeds but verification finds wrong UID / duplicate Message-ID |
| SimpleDrain vs legacy batch | **NOT competing** when `setSimpleOrchestratorRemoteDrainPrimary(true)` — legacy chain is no-op; batch still used by **`inbox:debugTestMoveOne`** only |
| UI “Connected” vs socket | **CANNOT DETERMINE from code alone** — persisted `account.status` may differ from `this.connected` + `this.client` on `ImapProvider` |

**Root cause (one sentence):**  
Outlook uses Microsoft Graph with stable message IDs and HTTP timeouts, while web.de relies on a long-lived `node-imap` TCP session, namespace-prefixed mailbox paths, and UID/Message-ID correlation that can succeed at the protocol layer yet fail to reflect the user’s expectation—or stall when the socket is dead while UI state still shows “connected.”

---

## FILE 1: `apps/electron-vite-project/electron/main/email/providers/imap.ts`

### Note on `isConnected()`

**ImapProvider** does not define `isConnected()` locally. It inherits from **`BaseEmailProvider`**:

**File:** `providers/base.ts` — **Lines 209–236**

```234:236:apps/electron-vite-project/electron/main/email/providers/base.ts
  isConnected(): boolean {
    return this.connected
  }
```

**Assessment:** **WORKING** — returns in-memory `this.connected`, set `true` on IMAP `ready`, `false` on `end` / errors / disconnect.

---

### 1. `connect()` — **Lines 219–287**

**Assessment:** **WORKING** (design); **UNTESTED** on web.de here.

**Auth:** Plain IMAP **`user` + `password`** (no XOAUTH2 in this constructor).

**Options:** `tls` when `security === 'ssl'`, `tlsOptions.rejectUnauthorized: false`, `connTimeout: 10000`, `authTimeout: 10000`.

**Events:**
- `error` (once before ready): rejects promise, `this.connected = false`
- `ready`: removes pre-ready error listeners, attaches persistent `error` handler (sets `this.connected = false` on runtime errors), `this.connected = true`, capability refresh, optional namespace warm-up
- `end`: `this.connected = false`, **`this.client = null`**

**Full code:**

```219:287:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.imap) {
      throw new Error('IMAP configuration required')
    }
    
    this.config = config

    if (typeof ImapCtor !== 'function') {
      const keys =
        ImapMod && typeof ImapMod === 'object' ? Object.keys(ImapMod as object).join(', ') : String(ImapMod)
      throw new Error(
        `[IMAP] imap package interop failed: expected constructor function, got ${typeof ImapCtor}. Module keys: ${keys}`,
      )
    }

    return new Promise((resolve, reject) => {
      const client = new ImapCtor({
        user: config.imap!.username,
        password: config.imap!.password,
        host: config.imap!.host,
        port: config.imap!.port,
        tls: config.imap!.security === 'ssl',
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      })
      this.client = client
      this.namespaceInfoCache = null
      this.serverCapabilities = []

      /**
       * During connect, first `error` rejects the promise. After `ready`, Node's `imap` may emit
       * further `error` events on the same socket; with **no** listener that crashes the main process
       * and IPC returns "reply was never sent". Always attach a persistent handler post-ready.
       */
      const onConnectError = (err: Error) => {
        console.error('[IMAP] Connection error:', err)
        this.connected = false
        reject(err)
      }

      client.once('error', onConnectError)

      client.once('ready', () => {
        /* `once` wraps the listener — removeListener(fn) may not match; clear pre-ready error handlers. */
        client.removeAllListeners('error')
        client.on('error', (err: Error) => {
          console.error('[IMAP] Runtime connection error (listener prevents process crash):', err?.message || err)
          this.connected = false
        })
        console.log('[IMAP] Connected to:', config.imap!.host)
        this.refreshImapCapabilitiesSnapshot()
        this.connected = true
        void this.warmImapNamespacePattern().catch((e: any) => {
          console.warn('[IMAP] Early namespace/delimiter detection failed (will retry on demand):', e?.message || e)
        })
        resolve()
      })

      client.once('end', () => {
        console.log('[IMAP] Connection ended')
        this.connected = false
        /** Dead socket must not satisfy `applyOrchestratorRemoteOperation` — forces full reconnect via gateway. */
        this.client = null
      })

      client.connect()
    })
  }
```

---

### 3. `disconnect()` — **Lines 289–303**

**Assessment:** **WORKING**

```289:303:apps/electron-vite-project/electron/main/email/providers/imap.ts
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

---

### 4. `applyOrchestratorRemoteOperation()` — **Lines 1559–1627**

**Assessment:** **MIXED** — logic is consistent; **pre-move `imapVerifyMessageInMailbox` is commented out** (temporary); **post-move** verification still runs; returns `{ ok: false }` if verification finds no message in destination.

**Full code:**

```1559:1627:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async applyOrchestratorRemoteOperation(
    messageId: string,
    operation: OrchestratorRemoteOperation,
    context?: OrchestratorRemoteApplyContext,
  ): Promise<OrchestratorRemoteApplyResult> {
    if (!this.config || !this.connected || !this.client) {
      return { ok: false, error: 'Not connected' }
    }
    const names = resolveOrchestratorRemoteNames(this.config)
    const dest =
      operation === 'archive'
        ? names.imap.archiveMailbox
        : operation === 'pending_review'
          ? names.imap.pendingReviewMailbox
          : operation === 'pending_delete'
            ? names.imap.pendingDeleteMailbox
            : operation === 'urgent'
              ? names.imap.urgentMailbox
              : ''
    if (!dest) {
      return { ok: false, error: `Unknown orchestrator operation: ${operation}` }
    }
    try {
      const rfc = context?.imapRfcMessageId ?? null
      const lastMb = context?.imapRemoteMailbox ?? null
      const destResolved = await this.imapResolveMailboxPath(dest.trim())

      await this.imapEnsureMailbox(dest)

      /* TEMPORARY: disable pre-move idempotent verify — false positives (duplicate Message-ID / stale
       * search) marked rows completed without moving mail on servers like web.de. Re-enable after
       * locate+move path is confirmed reliable. Post-move verification below stays. */
      // const already = await this.imapVerifyMessageInMailbox(destResolved, messageId, rfc)
      // if (already) {
      //   return {
      //     ok: true,
      //     skipped: true,
      //     imapUidAfterMove: already,
      //     imapMailboxAfterMove: destResolved,
      //   }
      // }

      const loc = await this.imapLocateMessageForMove(destResolved, messageId, rfc, lastMb)
      if (!loc) {
        return {
          ok: false,
          error:
            'IMAP: message not found in canonical mailboxes (INBOX + configured Archive / Pending / Urgent / Trash). Reconnect or run Sync Remote — legacy WRDesk-* paths are ignored for locate.',
        }
      }

      await this.imapMoveBetweenMailboxes(loc.mailbox, loc.uid, destResolved)

      /** UID may change after MOVE; RFC Message-ID is authoritative for verification. */
      let newUid =
        (await this.imapVerifyMessageInMailbox(destResolved, loc.uid, rfc)) ||
        (rfc ? await this.imapFindUidByHeaderMessageId(destResolved, rfc) : null)
      if (!newUid) {
        return {
          ok: false,
          error:
            'IMAP: MOVE reported success but message not found in destination (verification failed). Check folder path / namespace (e.g. web.de “.” delimiter) or server MOVE support.',
        }
      }
      return { ok: true, imapUidAfterMove: newUid, imapMailboxAfterMove: destResolved }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }
```

---

### 5. `imapEnsureMailbox()` — private — **Lines 1897–1926**

**Assessment:** **WORKING** — uses **`addBox(fullPath)`**; treats “already exists” style errors as success.

```1897:1926:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private async imapEnsureMailbox(mailboxLogicalOrPath: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected')
    }
    const logical = mailboxLogicalOrPath.trim()
    const fullPath = await this.imapResolveMailboxPath(logical)
    if (!fullPath) {
      throw new Error('IMAP: empty mailbox name')
    }
    const labelForLog = logical || fullPath
    console.log(
      `[IMAP] Ensuring mailbox: logical=${JSON.stringify(labelForLog)} → CREATE ${JSON.stringify(fullPath)}`,
    )
    return new Promise((resolve, reject) => {
      this.client!.addBox(fullPath, (err) => {
        if (!err) {
          console.log(`[IMAP] Created folder: ${JSON.stringify(labelForLog)} (${JSON.stringify(fullPath)})`)
          resolve()
          return
        }
        const m = String((err as Error).message || err)
        if (/exists|EXISTS|already/i.test(m)) {
          console.log(`[IMAP] Folder already exists: ${JSON.stringify(labelForLog)} (${JSON.stringify(fullPath)})`)
          resolve()
          return
        }
        reject(err)
      })
    })
  }
```

---

### 6. `imapResolveMailboxPath()` — private — **Lines 435–453**

**Assessment:** **WORKING** (namespace-aware); **UNTESTED** for every web.de layout.

```435:453:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private async imapResolveMailboxPath(logicalName: string): Promise<string> {
    const trimmed = logicalName.trim()
    if (!trimmed) {
      return trimmed
    }
    const inbox = (this.config?.folders?.inbox || 'INBOX').trim()
    if (trimmed.toLowerCase() === inbox.toLowerCase()) {
      return trimmed
    }

    const ns = await this.getNamespaceInfo()
    if (!ns.prefix) {
      return trimmed
    }
    if (trimmed.toLowerCase().startsWith(ns.prefix.toLowerCase())) {
      return trimmed
    }
    return `${ns.prefix}${trimmed}`
  }
```

**`getNamespaceInfo()`** (lines 395–418): uses RFC2342 NAMESPACE personal prefix + delimiter when available; else infers from **`listFolders()`** via **`inferMailboxHierarchyFromList`**.

---

### 7. `imapVerifyMessageInMailbox()` — private — **Lines 1810–1821**

**Assessment:** **WORKING** as implemented; **CAN produce false positives** if duplicate RFC Message-ID exists in destination (different physical message) or HEADER search matches wrong message — **documented risk** in code comments elsewhere.

```1810:1821:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private async imapVerifyMessageInMailbox(
    destMailbox: string,
    uidHint: string,
    rfcMessageId: string | null | undefined,
  ): Promise<string | null> {
    if (rfcMessageId) {
      const u = await this.imapFindUidByHeaderMessageId(destMailbox, rfcMessageId)
      if (u) return u
    }
    if (uidHint && (await this.imapUidPresentInMailbox(destMailbox, uidHint))) return uidHint
    return null
  }
```

---

### 8. `imapFindUidByHeaderMessageId()` — private — **Lines 1699–1709**

**Assessment:** **WORKING** — opens mailbox read-only, searches **`['HEADER','MESSAGE-ID', variant]`** per variant.

```1699:1709:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private async imapFindUidByHeaderMessageId(mailbox: string, rfc: string | null): Promise<string | null> {
    const variants = this.imapRfcMessageIdSearchVariants(rfc)
    if (!variants.length) return null
    await this.imapOpenBox(mailbox, true)
    for (const v of variants) {
      /* node-imap: each criterion must be one nested array (not flat HEADER/UID tuples). */
      const uid = await this.imapSearchFirstUid([['HEADER', 'MESSAGE-ID', v]])
      if (uid != null) return String(uid)
    }
    return null
  }
```

---

### 9. `imapUidPresentInMailbox()` — private — **Lines 1711–1718**

**Assessment:** **WORKING** for numeric UIDs.

```1711:1718:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private async imapUidPresentInMailbox(mailbox: string, uid: string): Promise<boolean> {
    await this.imapOpenBox(mailbox, true)
    const u = String(uid).trim()
    if (!/^\d+$/.test(u)) return false
    /* node-imap: UID criterion must be nested — flat ['UID', …] throws "Incorrect number of arguments". */
    const n = await this.imapSearchFirstUid([['UID', `${u}:${u}`]])
    return n != null
  }
```

---

### 10. `imapLocateMessageForMove()` — private — **Lines 1786–1808**

**Assessment:** **WORKING** — searches ordered mailboxes from **`imapOrderedSearchMailboxes`**; prefers **RFC Message-ID** in each mailbox, else **UID presence** for `uidHint` (`email_message_id` from queue).

```1786:1808:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private async imapLocateMessageForMove(
    destMailboxResolved: string,
    uidHint: string,
    rfcMessageId: string | null | undefined,
    lastMailbox: string | null | undefined,
  ): Promise<{ mailbox: string; uid: string } | null> {
    if (!this.config || !this.client) return null
    const names = resolveOrchestratorRemoteNames(this.config)
    const inbox = this.config.folders?.inbox || 'INBOX'
    const order = await this.imapOrderedSearchMailboxes(lastMailbox, names, inbox, destMailboxResolved)

    for (const mb of order) {
      if (rfcMessageId) {
        const byRfc = await this.imapFindUidByHeaderMessageId(mb, rfcMessageId)
        if (byRfc) return { mailbox: mb, uid: byRfc }
      }
      if (uidHint) {
        const ok = await this.imapUidPresentInMailbox(mb, uidHint)
        if (ok) return { mailbox: mb, uid: uidHint }
      }
    }
    return null
  }
```

---

### 11. `imapMoveBetweenMailboxes()` — private — **Lines 1827–1895**

**Assessment:** **WORKING** — `openBox(source, false)` then **`client.move`**, with **COPY+DELETE** fallback when error matches **`imapMoveErrWarrantsCopyDeleteFallback`**.

```1827:1895:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private imapMoveBetweenMailboxes(sourceMailbox: string, uid: string, destMailbox: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      const client = this.client
      client.openBox(sourceMailbox, false, (err) => {
        if (err) {
          reject(err)
          return
        }
        this.refreshImapCapabilitiesSnapshot()

        const logMoved = (via: 'MOVE' | 'COPY+DELETE') => {
          console.log(`[IMAP] Moved UID ${uid}: "${sourceMailbox}" → "${destMailbox}" via ${via}`)
        }

        const runCopyDeleteFallback = () => {
          client.copy(uid, destMailbox, (copyErr) => {
            if (copyErr) {
              reject(copyErr)
              return
            }
            client.addFlags(uid, ['\\Deleted'], (flagErr) => {
              if (flagErr) {
                reject(flagErr)
                return
              }
              if (client.serverSupports('UIDPLUS')) {
                client.expunge([uid], (expErr) => {
                  if (expErr) reject(expErr)
                  else {
                    logMoved('COPY+DELETE')
                    resolve()
                  }
                })
              } else {
                client.expunge((expErr) => {
                  if (expErr) reject(expErr)
                  else {
                    logMoved('COPY+DELETE')
                    resolve()
                  }
                })
              }
            })
          })
        }

        client.move(uid, destMailbox, (moveErr) => {
          if (!moveErr) {
            logMoved('MOVE')
            resolve()
            return
          }
          if (imapMoveErrWarrantsCopyDeleteFallback(moveErr)) {
            console.warn(
              `[IMAP] MOVE failed for UID ${uid} ("${sourceMailbox}" → "${destMailbox}"), using COPY+DELETE:`,
              (moveErr as Error)?.message || moveErr,
            )
            runCopyDeleteFallback()
            return
          }
          reject(moveErr)
        })
      })
    })
  }
```

---

### 12. `imapSearchFirstUid()` — private — **Lines 1685–1697**

**Assessment:** **WORKING** — resolves `null` on error or empty UID list.

```1685:1697:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private imapSearchFirstUid(criteria: unknown[]): Promise<number | null> {
    const normalized = this.normalizeSearchCriteriaForNodeImap(criteria) as any
    return new Promise((resolve) => {
      if (!this.client) {
        resolve(null)
        return
      }
      this.client.search(normalized, (err, uids: number[]) => {
        if (err || !uids?.length) resolve(null)
        else resolve(uids[0])
      })
    })
  }
```

---

### 13. `imapOpenBox()` — private — **Lines 1646–1657**

**Assessment:** **WORKING** — passes through `node-imap` `openBox(mailbox, readOnly, cb)`; rejects if no client or server error.

```1646:1657:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private imapOpenBox(mailbox: string, readOnly: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      this.client.openBox(mailbox, readOnly, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
```

---

### 14. `listFolders()` — **Lines 347–383**

**Assessment:** **WORKING** — **`getBoxes`** recursive tree; delimiter from server; **web.de-specific output** = **CANNOT DETERMINE — needs runtime LIST capture**.

```347:383:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async listFolders(): Promise<FolderInfo[]> {
    if (!this.client) {
      throw new Error('Not connected')
    }
    
    return new Promise((resolve, reject) => {
      this.client!.getBoxes((err, boxes) => {
        if (err) {
          reject(err)
          return
        }
        
        const folders: FolderInfo[] = []
        
        const processBoxes = (boxObj: ImapApi.MailBoxes, prefix = '') => {
          for (const [name, box] of Object.entries(boxObj)) {
            const path = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name
            folders.push({
              name,
              path,
              delimiter: box.delimiter || '/',
              flags: box.attribs || [],
              totalMessages: 0,
              unreadMessages: 0
            })
            
            if (box.children) {
              processBoxes(box.children, path)
            }
          }
        }
        
        processBoxes(boxes)
        resolve(folders)
      })
    })
  }
```

---

### 15. `validateLifecycleRemoteBoxes()` — **Lines 1518–1557**

**Assessment:** **WORKING** for “LIST + exact match + CREATE”; **UNTESTED** on web.de policy (some hosts forbid client CREATE).

```1518:1557:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async validateLifecycleRemoteBoxes(): Promise<ImapLifecycleValidationResult> {
    if (!this.client || !this.config) {
      throw new Error('Not connected')
    }
    const names = resolveOrchestratorRemoteNames(this.config)
    const folders = await this.listFolders()
    const specs: { role: ImapLifecycleValidationEntry['role']; mailbox: string }[] = [
      { role: 'archive', mailbox: names.imap.archiveMailbox },
      { role: 'pending_review', mailbox: names.imap.pendingReviewMailbox },
      { role: 'pending_delete', mailbox: names.imap.pendingDeleteMailbox },
      { role: 'urgent', mailbox: names.imap.urgentMailbox },
      { role: 'trash', mailbox: names.imap.trashMailbox },
    ]
    const entries: ImapLifecycleValidationEntry[] = []
    for (const { role, mailbox } of specs) {
      const m = mailbox.trim()
      if (!m) {
        entries.push({ role, mailbox, exists: false, error: 'Mailbox name is empty' })
        continue
      }
      const resolved = await this.imapResolveMailboxPath(m)
      const exists = imapFolderListHasExactMailbox(folders, m, resolved)
      if (exists) {
        entries.push({ role, mailbox: m, exists: true })
        continue
      }
      try {
        await this.imapEnsureMailbox(m)
        entries.push({ role, mailbox: m, exists: true, created: true })
      } catch (e: any) {
        entries.push({
          role,
          mailbox: m,
          exists: false,
          error: e?.message || String(e),
        })
      }
    }
    return { ok: entries.every((e) => e.exists), entries }
  }
```

---

## FILE 2: `apps/electron-vite-project/electron/main/email/gateway.ts`

### 16. `getConnectedProvider()` — private — **Lines 1069–1099**

**Assessment:** **WORKING** — creates provider if missing; **`connect(account)`** if new or **`!provider.isConnected()`**.

```1069:1099:apps/electron-vite-project/electron/main/email/gateway.ts
  private async getConnectedProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    let provider = this.providers.get(account.id)
    
    if (!provider) {
      provider = await this.getProvider(account)
      
      // Set up token refresh callback to persist new tokens
      if ('onTokenRefresh' in provider) {
        (provider as any).onTokenRefresh = (newTokens: { accessToken: string; refreshToken: string; expiresAt: number }) => {
          console.log('[EmailGateway] Token refreshed for account:', account.id)
          // Update account in memory
          account.oauth = {
            ...account.oauth!,
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            expiresAt: newTokens.expiresAt
          }
          account.updatedAt = Date.now()
          // Persist to disk
          saveAccounts(this.accounts)
          console.log('[EmailGateway] New tokens persisted to disk')
        }
      }
      
      await provider.connect(account)
      this.providers.set(account.id, provider)
    } else if (!provider.isConnected()) {
      await provider.connect(account)
    }
    
    return provider
  }
```

**If `connect()` throws:** propagates to caller (e.g. `applyOrchestratorRemoteOperation` has no try/catch around `getConnectedProvider` — **callers** may catch).

---

### 17. `applyOrchestratorRemoteOperation()` — **Lines 411–433**

**Assessment:** **WORKING** wrapper.

```411:433:apps/electron-vite-project/electron/main/email/gateway.ts
  async applyOrchestratorRemoteOperation(
    accountId: string,
    emailMessageId: string,
    operation: OrchestratorRemoteOperation,
    context?: OrchestratorRemoteApplyContext,
  ): Promise<OrchestratorRemoteApplyResult> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) {
      return {
        ok: false,
        error: 'Account not found (disconnected or removed). Clear queue row or reconnect.',
      }
    }
    const provider = await this.getConnectedProvider(account)
    const fn = provider.applyOrchestratorRemoteOperation
    if (typeof fn !== 'function') {
      return {
        ok: false,
        error: `Provider ${account.provider} does not implement remote orchestrator mutations`,
      }
    }
    return fn.call(provider, emailMessageId, operation, context)
  }
```

---

### 18. `forceReconnect()` — **Lines 476–493**

**Assessment:** **WORKING**

```476:493:apps/electron-vite-project/electron/main/email/gateway.ts
  async forceReconnect(accountId: string): Promise<void> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) {
      console.warn('[EmailGateway] forceReconnect: account not found', accountId)
      return
    }
    const existing = this.providers.get(accountId)
    if (existing) {
      try {
        await existing.disconnect()
      } catch (e: any) {
        console.warn('[EmailGateway] forceReconnect: disconnect', e?.message || e)
      }
      this.providers.delete(accountId)
    }
    await this.getConnectedProvider(account)
    console.log('[EmailGateway] forceReconnect: new session for', accountId)
  }
```

---

## FILE 3: `ipc.ts` — SimpleDrain (NOT in `inboxOrchestratorRemoteQueue.ts`)

The **SimpleDrain** `setInterval` lives inside **`registerInboxHandlers`** in **`electron/main/email/ipc.ts`**, approximately **lines 1066–1305** (constants `SIMPLE_DRAIN_*` defined earlier in the same file).

**Assessment:** **WORKING** as coded; marks **`completed`** on **any** `apply.ok` including **`skipped: true`** (e.g. Gmail idempotent paths).

**Key excerpt (full loop structure):**

```1066:1305:apps/electron-vite-project/electron/main/email/ipc.ts
  setSimpleOrchestratorRemoteDrainPrimary(true)

  if (!simpleOrchestratorRemoteDrainInterval) {
    let simpleDrainRunning = false
    simpleOrchestratorRemoteDrainInterval = setInterval(() => {
      void (async () => {
        if (simpleDrainRunning) return
        simpleDrainRunning = true
        try {
          const db = await resolveDb()
          if (!db) return
          // ... reset stuck processing ...
          // ... SELECT up to SIMPLE_DRAIN_BATCH pending rows ...
          // ... per account_id: IMAP forceReconnect once per batch ...
          // ... for each row: mark processing, gateway.applyOrchestratorRemoteOperation ...
          // ... if apply.ok: batchMoved/batchSkipped, markCompleted, update inbox_messages ...
          // ... else: permanent / transient / retry logic ...
          // ... sendToRenderer drainProgress with batchMoved, batchSkipped ...
        } finally {
          simpleDrainRunning = false
        }
      })()
    }, SIMPLE_DRAIN_INTERVAL_MS)
  }
```

*(The complete verbatim block spans ~240 lines; see repository `ipc.ts` 1073–1304 for every line.)*

**When `apply` returns `{ ok: true, skipped: true }`:** still **`markCompleted`** and counts **`batchSkipped`**.

---

### 20. `processOrchestratorRemoteQueueBatch()` — `inboxOrchestratorRemoteQueue.ts` **Lines 375–737**

**Still called?**
- **`scheduleOrchestratorRemoteDrain`**: **no** when `simpleOrchestratorRemoteDrainPrimary === true` (early return line 1266–1268).
- **`drainOrchestratorRemoteQueueBounded`**: returns immediately (lines 1185–1187) when primary.
- **`inbox:debugTestMoveOne`** (in `ipc.ts`): **still calls** `processOrchestratorRemoteQueueBatch` in a loop.

**Competition with SimpleDrain:** **UNLIKELY in normal operation** — same DB rows could only race if **debugTestMoveOne** runs concurrently with SimpleDrain picking overlapping **`pending`** rows; SQLite write ordering would apply. **Not designed to run both on production drain.**

**Assessment (batch processor):** **WORKING** (complex); **not the active drain** when simple primary.

*(Full function body: lines 375–737 — see repository; includes `ensureConnectedWithOptionalReconnect`, IMAP preflight, `applyOrchestratorRemoteOperation` with 30s race timeout, pull-lock deferral via `isPullActive`.)*

---

## FILE 4: `domain/mailboxLifecycleMapping.ts`

### 21. `resolveOrchestratorRemoteNames()` — **Lines 71–102**

**Default IMAP names:** `Archive`, `Pending Review`, `Pending Delete`, `Urgent`, `Trash`.  
**Overrides:** `account.orchestratorRemote.imap*` fields via `coalesceTrim`.

**Assessment:** **WORKING**; **urgent** included.

```71:102:apps/electron-vite-project/electron/main/email/domain/mailboxLifecycleMapping.ts
export function resolveOrchestratorRemoteNames(account: EmailAccountConfig): ResolvedOrchestratorRemoteNames {
  const o = account.orchestratorRemote
  const g = DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail
  const ms = DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook
  const im = DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap

  const archiveRemove =
    Array.isArray(o?.gmailArchiveRemoveLabelIds) && o!.gmailArchiveRemoveLabelIds!.length > 0
      ? [...o!.gmailArchiveRemoveLabelIds!]
      : [...g.archiveRemoveLabelIds]

  return {
    gmail: {
      pendingReviewLabel: coalesceTrim(o?.gmailPendingReviewLabel, g.pendingReviewLabel),
      pendingDeleteLabel: coalesceTrim(o?.gmailPendingDeleteLabel, g.pendingDeleteLabel),
      urgentLabel: coalesceTrim(o?.gmailUrgentLabel, g.urgentLabel),
      archiveRemoveLabelIds: archiveRemove,
    },
    outlook: {
      pendingReviewFolder: coalesceTrim(o?.outlookPendingReviewFolder, ms.pendingReviewFolder),
      pendingDeleteFolder: coalesceTrim(o?.outlookPendingDeleteFolder, ms.pendingDeleteFolder),
      urgentFolder: coalesceTrim(o?.outlookUrgentFolder, ms.urgentFolder),
    },
    imap: {
      archiveMailbox: coalesceTrim(o?.imapArchiveMailbox, im.archiveMailbox),
      pendingReviewMailbox: coalesceTrim(o?.imapPendingReviewMailbox, im.pendingReviewMailbox),
      pendingDeleteMailbox: coalesceTrim(o?.imapPendingDeleteMailbox, im.pendingDeleteMailbox),
      urgentMailbox: coalesceTrim(o?.imapUrgentMailbox, im.urgentMailbox),
      trashMailbox: coalesceTrim(o?.imapTrashMailbox, im.trashMailbox),
    },
  }
}
```

---

## CRITICAL QUESTIONS — Answers from code

| Q | Answer |
|---|--------|
| **Q1** | **CANNOT DETERMINE at rest** — `applyOrchestratorRemoteOperation` returns `Not connected` if `!this.connected \|\| !this.client`. Runtime logs / debugger required. |
| **Q2** | **Yes**, if `isConnected()` is false, `getConnectedProvider` calls `connect(account)` again (line 1095–1096). |
| **Q3** | **SimpleDrain:** failed `apply` → permanent/transient/retry paths; transient → row back to `pending` without bumping attempts. **Not connected** errors classify per `simpleDrainIsTransientOrchestratorError` / permanent helpers in `ipc.ts`. |
| **Q4** | **Yes** — next row uses another `applyOrchestratorRemoteOperation` → `getConnectedProvider` may reconnect if provider reports disconnected; IMAP batch also **`forceReconnect`** once per `account_id` per batch. |
| **Q5–Q7** | **Exact path** = `imapResolveMailboxPath(resolveOrchestratorRemoteNames(...).imap.archiveMailbox)` → often **`${namespacePrefix}Archive`** when prefix is e.g. `INBOX.` → e.g. **`INBOX.Archive`**. Same pattern for Pending/Urgent with configured labels. **Validity on web.de:** **CANNOT DETERMINE** without LIST output. |
| **Q8** | **`addBox(fullPath)`** on resolved path; “already exists” treated as OK. |
| **Q9** | For IMAP ingest, **`email_message_id` in DB is intended to be numeric UID** in the source mailbox (see `REMOTE_ORCHESTRATOR_SYNC.md` / `messageRouter`); **CANNOT DETERMINE** per-row without DB inspection. |
| **Q10** | **CANNOT DETERMINE** — migration behavior is separate code; invalid UIDs after account id migration would cause locate failures unless RFC id locates. |
| **Q11** | **Both:** prefers **HEADER Message-ID** when `imap_rfc_message_id` set; else **UID** presence check for `email_message_id` when numeric. |
| **Q12** | **Yes, risk:** UID validity can change; code tries to mitigate with RFC search; **CANNOT DETERMINE** per session without server UIDVALIDITY logging. |
| **Q13** | **CANNOT DETERMINE** without DB + logs for those 258 rows (historically could have been `skipped: true` when pre-verify was enabled). |
| **Q14** | **Yes:** (a) **Gmail** `apply` can return `{ ok: true, skipped: true }`; (b) **IMAP** previously pre-verify path (now commented); (c) **IMAP** if post-move verify returns a UID via **duplicate Message-ID** match, user may perceive “nothing moved.” |
| **Q15** | **With pre-verify disabled**, **`ok: true` without MOVE** should not come from that path; **Gmail `skipped`** still completes row in SimpleDrain. **IMAP** requires `imapMoveBetweenMailboxes` to run before success unless an exception is swallowed incorrectly (not seen in listed code). |
| **Q16** | **Not in normal mode** — legacy `scheduleOrchestratorRemoteDrain` no-op when simple primary; **possible** if **`debugTestMoveOne`** overlaps SimpleDrain on same rows. |
| **Q17** | **UI “Connected”** likely reflects **`EmailAccountConfig.status`** from persisted accounts; **IMAP socket** is **`ImapProvider.connected` + client**. They can diverge after errors if UI not updated. **CANNOT DETERMINE** exact UI mapping without reading renderer + account update paths. |
| **Q18** | **CANNOT DETERMINE** — credentials / last success require runtime. |
| **Q19** | **CANNOT DETERMINE** — provider policy not in code. |

---

## Move execution trace (SimpleDrain → web.de IMAP)

1. **Timer fires** (`ipc.ts`): `resolveDb()`, reset old `processing` rows.
2. **SELECT** up to 20 `pending` rows, oldest first.
3. **Per distinct `account_id` (IMAP):** `forceReconnect` (drops cached provider, `getConnectedProvider` → new `connect`).
4. **Row:** `UPDATE` → `processing`.
5. **`emailGateway.applyOrchestratorRemoteOperation(accountId, email_message_id, operation, { imapRemoteMailbox, imapRfcMessageId })`**
6. **Gateway:** `getConnectedProvider` → **`ImapProvider.applyOrchestratorRemoteOperation(messageId, operation, context)`**  
   - Note: first arg is **`email_message_id`** (UID hint for IMAP).
7. **IMAP:** guard `config + connected + client`; resolve **dest** from `resolveOrchestratorRemoteNames`; **`imapResolveMailboxPath`**, **`imapEnsureMailbox`**.
8. **Locate:** `imapLocateMessageForMove` across canonical mailboxes (RFC first, then UID).
9. **Move:** `imapMoveBetweenMailboxes(source, uid, destResolved)` — MOVE or COPY+DELETE.
10. **Verify destination:** `imapVerifyMessageInMailbox` / `imapFindUidByHeaderMessageId`; failure → **`{ ok: false, error: '... verification failed' }`**.
11. **Success:** `{ ok: true, imapUidAfterMove, imapMailboxAfterMove }` (no `skipped` on this path unless provider sets it — IMAP code shown does not set `skipped` on success).
12. **SimpleDrain:** `markCompleted`, optional `inbox_messages` UID/mailbox update.

---

## What must change (recommendations — not applied)

1. **`imap.ts` ~1588–1599:** Decide when to **re-enable** pre-move verify; add **logging** of `destResolved`, `loc.mailbox`, `loc.uid`, and **UIDVALIDITY** if exposed by `node-imap`.
2. **`ipc.ts` SimpleDrain ~1177–1205:** Consider **not** marking `completed` when `apply.skipped === true` for **IMAP** (or only for Gmail), if business rule is “skipped must not advance queue.”
3. **`gateway.ts` + UI:** Align **account `status`** with **actual** `isConnected()` after IMAP runtime errors (surface “socket dead” vs “credentials saved”).
4. **`verifyImapRemoteFolders`:** Already has **15s race** in `ipc.ts` — ensure **`forceReconnect`** before verify optional (product decision).
5. **Instrumentation:** Log **last successful IMAP command timestamp** per account for Q18/Q19 diagnosis.
6. **Tests:** Integration tests against web.de or mock IMAP with **`.` delimiter** and **INBOX.** prefix.

---

## Line number index (quick reference)

| Symbol | File | Lines (approx) |
|--------|------|----------------|
| `connect` | imap.ts | 219–287 |
| `disconnect` | imap.ts | 289–303 |
| `isConnected` | base.ts | 234–236 |
| `listFolders` | imap.ts | 347–383 |
| `getNamespaceInfo` | imap.ts | 395–418 |
| `imapResolveMailboxPath` | imap.ts | 435–453 |
| `validateLifecycleRemoteBoxes` | imap.ts | 1518–1557 |
| `applyOrchestratorRemoteOperation` | imap.ts | 1559–1627 |
| `imapOpenBox` | imap.ts | 1646–1657 |
| `imapSearchFirstUid` | imap.ts | 1685–1697 |
| `imapFindUidByHeaderMessageId` | imap.ts | 1699–1709 |
| `imapUidPresentInMailbox` | imap.ts | 1711–1718 |
| `imapLocateMessageForMove` | imap.ts | 1786–1808 |
| `imapVerifyMessageInMailbox` | imap.ts | 1810–1821 |
| `imapMoveBetweenMailboxes` | imap.ts | 1827–1895 |
| `imapEnsureMailbox` | imap.ts | 1897–1926 |
| `getConnectedProvider` | gateway.ts | 1069–1099 |
| `applyOrchestratorRemoteOperation` | gateway.ts | 411–433 |
| `forceReconnect` | gateway.ts | 476–493 |
| SimpleDrain | ipc.ts | ~1066–1305 |
| `processOrchestratorRemoteQueueBatch` | inboxOrchestratorRemoteQueue.ts | 375–737 |
| `setSimpleOrchestratorRemoteDrainPrimary` / flag | inboxOrchestratorRemoteQueue.ts | 1235–1243, 1265–1268, 1185–1187 |
| `resolveOrchestratorRemoteNames` | mailboxLifecycleMapping.ts | 71–102 |

---

## APPENDIX A — SimpleDrain: **full** `setInterval` body (`ipc.ts`)

**Constants** (same file, **lines 934–938**): `SIMPLE_DRAIN_INTERVAL_MS = 10_000`, `SIMPLE_DRAIN_BATCH = 20`, `SIMPLE_DRAIN_MAX_ATTEMPTS = 8`, `SIMPLE_DRAIN_INTER_ROW_MS = 200`, `SIMPLE_DRAIN_TRANSIENT_PAUSE_MS = 3000`.

**Closure:** runs inside `registerInboxHandlers`; uses `resolveDb`, `sendToRenderer`, `emailGateway`, helpers `simpleDrainIsPermanentOrchestratorError` / `simpleDrainIsTransientOrchestratorError` (defined above in `ipc.ts`).

**Lines 1067–1305 (verbatim):**

```1067:1305:apps/electron-vite-project/electron/main/email/ipc.ts
  setSimpleOrchestratorRemoteDrainPrimary(true)

  // ═══════════════════════════════════════════════════════════
  // SIMPLE DRAIN PROCESSOR — timer-based (every 10s), up to 20 rows, no pull-lock / chain flags.
  // Runs alongside legacy code paths; `scheduleOrchestratorRemoteDrain` is a no-op while primary.
  // ═══════════════════════════════════════════════════════════
  if (!simpleOrchestratorRemoteDrainInterval) {
    let simpleDrainRunning = false
    simpleOrchestratorRemoteDrainInterval = setInterval(() => {
      void (async () => {
        if (simpleDrainRunning) return
        simpleDrainRunning = true
        try {
          const db = await resolveDb()
          if (!db) return

          const twoMinAgo = new Date(Date.now() - 120_000).toISOString()
          const nowIso = new Date().toISOString()
          db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?`,
          ).run(nowIso, twoMinAgo)

          const rows = db
            .prepare(
              `SELECT q.id, q.message_id, q.account_id, q.email_message_id,
                      q.operation, q.attempts,
                      m.imap_remote_mailbox, m.imap_rfc_message_id
               FROM remote_orchestrator_mutation_queue q
               LEFT JOIN inbox_messages m ON m.id = q.message_id
               WHERE q.status = 'pending' AND q.attempts < ?
               ORDER BY q.created_at ASC
               LIMIT ?`,
            )
            .all(SIMPLE_DRAIN_MAX_ATTEMPTS, SIMPLE_DRAIN_BATCH) as SimpleDrainQueueRow[]

          if (rows.length === 0) return

          console.log(`[SimpleDrain] Processing ${rows.length} row(s)`)
          try {
            sendToRenderer('inbox:drainProgress', {
              processed: 0,
              pending: rows.length,
              failed: 0,
              deferred: 0,
              phase: 'simple_processing',
              batchSize: rows.length,
            })
          } catch {
            /* ignore */
          }

          const markCompleted = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          const markFailed = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          )
          const resetPending = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          )
          const resetPendingTransient = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
          )
          const touchMsgErr = db.prepare(`UPDATE inbox_messages SET remote_orchestrator_last_error = ? WHERE id = ?`)
          const touchMsgErrNull = db.prepare(`UPDATE inbox_messages SET remote_orchestrator_last_error = NULL WHERE id = ?`)

          let batchMoved = 0
          let batchSkipped = 0
          const imapBatchReconnectDone = new Set<string>()

          for (const r of rows) {
            try {
              if (!imapBatchReconnectDone.has(r.account_id)) {
                imapBatchReconnectDone.add(r.account_id)
                try {
                  const prov = emailGateway.getProviderSync(r.account_id)
                  if (prov === 'imap') {
                    console.log('[SimpleDrain] IMAP forceReconnect before batch rows for', r.account_id)
                    await emailGateway.forceReconnect(r.account_id)
                  }
                } catch (reErr: any) {
                  console.warn('[SimpleDrain] IMAP batch reconnect failed:', r.account_id, reErr?.message || reErr)
                }
              }

              db.prepare(
                `UPDATE remote_orchestrator_mutation_queue SET status = 'processing', updated_at = ? WHERE id = ?`,
              ).run(new Date().toISOString(), r.id)

              const context: OrchestratorRemoteApplyContext = {
                imapRfcMessageId: r.imap_rfc_message_id ?? null,
                imapRemoteMailbox: r.imap_remote_mailbox ?? null,
              }

              let apply: OrchestratorRemoteApplyResult
              try {
                apply = await emailGateway.applyOrchestratorRemoteOperation(
                  r.account_id,
                  r.email_message_id,
                  r.operation,
                  context,
                )
              } catch (callErr: any) {
                const errMsg = (callErr?.message || String(callErr)).slice(0, 2000)
                apply = { ok: false, error: errMsg }
              }

              const rowNow = new Date().toISOString()
              const prevAttempts = r.attempts ?? 0

              if (apply.ok) {
                const shortId = String(r.message_id).slice(0, 8)
                if (apply.skipped) {
                  batchSkipped += 1
                  console.log(`[SimpleDrain] SKIPPED (idempotent): ${r.operation} ${shortId}`)
                  try {
                    sendToRenderer('inbox:simpleDrainRow', {
                      status: 'skipped',
                      op: r.operation,
                      msgId: r.message_id,
                    })
                  } catch {
                    /* ignore */
                  }
                } else {
                  batchMoved += 1
                  console.log(`[SimpleDrain] MOVED: ${r.operation} ${shortId}`)
                  try {
                    sendToRenderer('inbox:simpleDrainRow', {
                      status: 'moved',
                      op: r.operation,
                      msgId: r.message_id,
                    })
                  } catch {
                    /* ignore */
                  }
                }

                markCompleted.run(rowNow, r.id)
                if (apply.imapUidAfterMove != null && apply.imapMailboxAfterMove != null) {
                  try {
                    db.prepare(`UPDATE inbox_messages SET email_message_id = ?, imap_remote_mailbox = ? WHERE id = ?`).run(
                      apply.imapUidAfterMove,
                      apply.imapMailboxAfterMove,
                      r.message_id,
                    )
                  } catch {
                    /* ignore */
                  }
                }
                try {
                  touchMsgErrNull.run(r.message_id)
                } catch {
                  /* ignore */
                }
              } else {
                const errMsg = (apply.error || 'Unknown error').slice(0, 2000)

                if (simpleDrainIsPermanentOrchestratorError(errMsg)) {
                  markFailed.run(SIMPLE_DRAIN_MAX_ATTEMPTS, errMsg, rowNow, r.id)
                  try {
                    touchMsgErr.run(`[${r.operation}] ${errMsg}`, r.message_id)
                  } catch {
                    /* ignore */
                  }
                  console.log(`[SimpleDrain] FAILED (permanent): ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`)
                } else if (simpleDrainIsTransientOrchestratorError(errMsg)) {
                  resetPendingTransient.run(errMsg, rowNow, r.id)
                  try {
                    touchMsgErr.run(`[${r.operation}] ${errMsg} (transient — will retry)`, r.message_id)
                  } catch {
                    /* ignore */
                  }
                  console.log(
                    `[SimpleDrain] RETRY (transient): ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`,
                  )
                  try {
                    await emailGateway.forceReconnect(r.account_id)
                  } catch {
                    /* ignore */
                  }
                  await new Promise((res) => setTimeout(res, SIMPLE_DRAIN_TRANSIENT_PAUSE_MS))
                } else {
                  const nextAttempts = prevAttempts + 1
                  if (nextAttempts >= SIMPLE_DRAIN_MAX_ATTEMPTS) {
                    markFailed.run(nextAttempts, errMsg, rowNow, r.id)
                    console.log(`[SimpleDrain] FAILED: ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`)
                  } else {
                    resetPending.run(nextAttempts, errMsg, rowNow, r.id)
                    console.log(
                      `[SimpleDrain] RETRY (${nextAttempts}/${SIMPLE_DRAIN_MAX_ATTEMPTS}): ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`,
                    )
                  }
                  try {
                    touchMsgErr.run(`[${r.operation}] ${errMsg}`, r.message_id)
                  } catch {
                    /* ignore */
                  }
                }
              }

              await new Promise((res) => setTimeout(res, SIMPLE_DRAIN_INTER_ROW_MS))
            } catch (rowErr: any) {
              try {
                db.prepare(
                  `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
                ).run(rowErr?.message || 'Unknown', new Date().toISOString(), r.id)
              } catch {
                /* ignore */
              }
              console.error(`[SimpleDrain] Row error: ${r.id}`, rowErr?.message)
            }
          }

          try {
            const remaining = db
              .prepare(`SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`)
              .get() as { c: number }
            sendToRenderer('inbox:drainProgress', {
              processed: rows.length,
              pending: remaining.c,
              failed: 0,
              deferred: 0,
              phase: 'simple_idle',
              batchSize: rows.length,
              batchMoved,
              batchSkipped,
            })
          } catch {
            /* ignore */
          }
        } catch (err) {
          console.error('[SimpleDrain] Error:', err)
        } finally {
          simpleDrainRunning = false
        }
      })()
    }, SIMPLE_DRAIN_INTERVAL_MS)
  }
```

---

## APPENDIX B — `normalizeSearchCriteriaForNodeImap` (`imap.ts` **1670–1682**)

```1670:1682:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private normalizeSearchCriteriaForNodeImap(criteria: unknown[]): unknown[] {
    if (!Array.isArray(criteria) || criteria.length === 0) return criteria
    const a0 = criteria[0]
    /* Flat top-level ['UID', id] → [['UID', id]] */
    if (criteria.length === 2 && typeof a0 === 'string' && a0.toUpperCase() === 'UID') {
      return [['UID', criteria[1]]]
    }
    /* Flat ['HEADER', field, value] → [['HEADER', field, value]] */
    if (criteria.length === 3 && typeof a0 === 'string' && a0.toUpperCase() === 'HEADER') {
      return [['HEADER', criteria[1], criteria[2]]]
    }
    return criteria
  }
```

**Assessment:** **WORKING**

---

## APPENDIX C — `processOrchestratorRemoteQueueBatch` (legacy drain)

**File:** `inboxOrchestratorRemoteQueue.ts`  
**Lines:** **375–737** (continuous, ~363 lines — includes nested `processOneRow`, SQL, gateway calls, timeout race, pull deferral).

This report does not duplicate the entire function to avoid unmaintainable doc size; the repository is the source of truth. **Every line** is in:

`apps/electron-vite-project/electron/main/email/inboxOrchestratorRemoteQueue.ts`  
from `export async function processOrchestratorRemoteQueueBatch` through the closing `}` before `/** Chunk size for {@link enqueueUnmirroredClassifiedLifecycleMessages}`.

**Assessment:** **WORKING** (when invoked); **inactive** for normal drain when `simpleOrchestratorRemoteDrainPrimary === true`.

---

*End of report.*

