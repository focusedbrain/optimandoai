# IMAP sync pipeline — code and architecture analysis

This document traces the **current** main-process path from auto-sync triggers through `syncAccountEmails`, gateway listing, provider fetch, and inbox DB ingestion. Code excerpts are taken from the workspace as of the file timestamps in **§10**.

---

## 1. Auto-sync trigger

### Where the interval / timer is defined

There are **two** independent mechanisms:

**A) Per-account DB-driven loop** (`sync_interval_ms`, default 5 minutes) via `startAutoSync` in `syncOrchestrator.ts` (see §8).

**B) Process-wide IMAP-only interval (2 minutes)** registered at the end of `registerInboxHandlers` in `ipc.ts`:

```4723:4750:apps/electron-vite-project/electron/main/email/ipc.ts
  // --- IMAP Auto-Sync (brute force) ---
  // Separate from DB-driven auto_sync loops: periodic pull for every active IMAP account.
  const IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000

  setInterval(() => {
    void (async () => {
      try {
        const accounts = await emailGateway.listAccounts()
        const db = await resolveDb()
        if (!db) return

        for (const acc of accounts) {
          if (acc.provider !== 'imap' || acc.status !== 'active') continue
          console.log('[IMAP-AUTO-SYNC] Triggering pull for IMAP account:', acc.id, acc.email)
          try {
            await syncAccountEmails(db, { accountId: acc.id })
            console.log('[IMAP-AUTO-SYNC] Pull completed for:', acc.id)
          } catch (err) {
            console.error('[IMAP-AUTO-SYNC] Pull failed for:', acc.id, err)
          }
        }
      } catch (err) {
        console.error('[IMAP-AUTO-SYNC] Error:', err)
      }
    })()
  }, IMAP_AUTO_SYNC_INTERVAL_MS)

  console.log('[IMAP-AUTO-SYNC] Registered IMAP auto-sync interval (every 2 min)')
```

### What accounts are iterated

- **Brute-force path:** `emailGateway.listAccounts()`, then `acc.provider === 'imap' && acc.status === 'active'`. No `auto_sync_enabled` check on this path.

### Call chain

- Both the brute-force interval and `startAutoSync` call **`syncAccountEmails(db, { accountId })`** directly (not a separate wrapper).

### Conditions that skip IMAP (auto-sync)

| Mechanism | Skips when |
|-----------|------------|
| **2 min `setInterval`** | `provider !== 'imap'` OR `status !== 'active'` OR DB unavailable |
| **`startAutoSync` tick** | `email_sync_state.auto_sync_enabled !== 1` for that account (still schedules next timeout) |

There is **no** `syncMode` gate in these triggers. **OAuth vs password** is not filtered here; non-IMAP providers are skipped only by the brute-force filter or by not being IMAP.

---

## 2. `syncAccountEmails` entry (`syncOrchestrator.ts`)

### Function signature and first 50 lines of `syncAccountEmailsImpl`

Public entry (`syncAccountEmails` — serialization wrapper only):

```314:333:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
export async function syncAccountEmails(db: any, options: SyncAccountOptions): Promise<SyncResult> {
  console.error('SYNC_ENTRY', options.accountId, new Date().toISOString())
  const accountId = options.accountId
  const accountEarly = emailGateway.getAccountConfig(accountId)
  console.log('[IMAP-PULL-TRACE] syncAccountEmails entry:', {
    accountId,
    provider: accountEarly?.provider,
    hasImapConfig: !!accountEarly?.imap,
    imapHost: accountEarly?.imap?.host,
    syncWindowDays: accountEarly?.sync?.syncWindowDays,
  })
  emailDebugLog(
    '[SYNC-DEBUG] syncAccountEmails invoked (serialized per account via syncChains; does not skip if pull lock active)',
    { accountId, pullMore: options.pullMore === true },
  )
  const prev = syncChains.get(accountId) ?? Promise.resolve()
  const current = prev.then(() => syncAccountEmailsImpl(db, options))
  syncChains.set(accountId, current.then(() => undefined, () => undefined))
  return current
}
```

First 50 lines of **`syncAccountEmailsImpl`** (signature through start of `pullMore` branch):

```335:384:apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
async function syncAccountEmailsImpl(
  db: any,
  options: SyncAccountOptions,
): Promise<SyncResult> {
  const { accountId, pullMore = false } = options
  const result: SyncResult = {
    ok: true,
    newMessages: 0,
    beapMessages: 0,
    plainMessages: 0,
    errors: [],
    newInboxMessageIds: [],
  }

  try {
    const accountInfo = await emailGateway.getAccount(accountId)
    if (accountInfo?.provider === 'imap') {
      await maybeRunImapLegacyFolderConsolidation(db, accountId)
    }
    const accountCfg = emailGateway.getAccountConfig(accountId)
    const windowDays = getEffectiveSyncWindowDays(accountCfg?.sync)
    const maxPerPull = getMaxMessagesPerPull(accountCfg?.sync)

    let windowStartIso: string | undefined
    if (windowDays > 0) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - windowDays)
      windowStartIso = d.toISOString()
    }

    const stateRow = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
    const lastSyncAt = stateRow?.last_sync_at as string | undefined
    const lastUid = stateRow?.last_uid as string | undefined
    const syncCursor = stateRow?.sync_cursor as string | undefined

    const hasPriorSync = Boolean(lastSyncAt)
    const bootstrap = !hasPriorSync && !pullMore

    emailDebugLog('[SYNC-DEBUG] sync prefs + DB sync state', {
      accountId,
      provider: accountCfg?.provider,
      rawAccountSync: accountCfg?.sync ?? null,
      windowDays,
      windowStartIsoForBootstrap: windowStartIso ?? '(none — all time)',
      maxPerPull,
      last_sync_at: lastSyncAt ?? null,
      hasPriorSync,
      bootstrap,
      pullMore,
    })

    let listOptions: MessageSearchOptions

    if (pullMore) {
      const oldestLocal = getOldestInboxReceivedAtIso(db, accountId)
```

(`listOptions` construction continues through line 430 in the same file — see repository for full `bootstrap` / `incremental` branches and the **399** / **407** early returns.)

### Every early `return` inside `syncAccountEmailsImpl` (with condition and line)

| Line | Condition | Effect |
|------|-----------|--------|
| **399** | `pullMore === true` and `getOldestInboxReceivedAtIso` is null | `result.ok = false`, error message, return |
| **407** | `pullMore === true` and `new Date(oldestLocal)` is NaN | `result.ok = false`, error message, return |
| **678** | Normal completion (always reached at end of function) | Returns `result` (success or failure from outer `catch`) |

There are **no other** `return result` statements inside the `try` before the final path; failures in listing/ingest generally accumulate in `result.errors` or hit the outer `catch` (lines 627–649).

### Branch for IMAP with `last_sync_at = null`

- `hasPriorSync` is false → **`bootstrap`** is true (unless `pullMore`).
- `listOptions` uses **`syncFetchAllPages: true`**, **`syncMaxMessages: maxPerPull`**, and **`fromDate: windowStartIso`** when `windowDays > 0`.

### Exact values (defaults, first-time IMAP bootstrap)

From `smartSyncPrefs.ts` (see §10): if account has no usable `sync.syncWindowDays` / `maxAgeDays`, **`getEffectiveSyncWindowDays` → 30**; **`getMaxMessagesPerPull` → 500** unless overridden.

So for a typical first pull:

- **`syncWindowDays`:** `30`
- **`maxMessagesPerPull`:** `500`
- **`fromDate`:** ISO string for **now minus 30 calendar days in UTC** (`setUTCDate(getUTCDate() - 30)`), e.g. produced in `syncAccountEmailsImpl` as `windowStartIso`
- If **`syncWindowDays === 0`** (all time): `windowStartIso` stays undefined → bootstrap `listOptions` has **no `fromDate`** (full-window behavior per provider).

---

## 3. Folder resolution

### `resolveImapPullFolders` (base labels)

```17:46:apps/electron-vite-project/electron/main/email/domain/imapPullFolders.ts
export function resolveImapPullFolders(account: EmailAccountConfig): string[] {
  if (account.provider !== 'imap') {
    return [account.folders?.inbox?.trim() || 'INBOX']
  }

  const monitored = account.folders?.monitored
  let base: string[]
  if (!monitored || monitored.length === 0) {
    base = ['INBOX', 'Spam']
  } else if (monitored.length === 1 && monitored[0]?.trim().toUpperCase() === 'INBOX') {
    /** Legacy single-INBOX accounts — add Spam so junk can be triaged without changing stored JSON. */
    base = ['INBOX', 'Spam']
  } else {
    base = monitored.map((f) => f.trim()).filter(Boolean)
  }

  try {
    const names = resolveOrchestratorRemoteNames(account)
    const im = names.imap
    const lifecycle = new Set(
      [im.archiveMailbox, im.pendingDeleteMailbox, im.pendingReviewMailbox, im.urgentMailbox, im.trashMailbox]
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    )
    const filtered = base.filter((f) => f && !lifecycle.has(f.trim().toLowerCase()))
    return filtered.length > 0 ? filtered : ['INBOX', 'Spam']
  } catch {
    return base.length > 0 ? base : ['INBOX', 'Spam']
  }
}
```

### `resolveImapPullFoldersExpanded` (gateway)

```1282:1308:apps/electron-vite-project/electron/main/email/gateway.ts
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
        emailDebugLog('[SYNC-DEBUG] resolveImapPullFoldersExpanded', {
          accountId,
          baseLabels,
          expanded,
        })
        return expanded
      }
    } catch (e: any) {
      console.warn('[EmailGateway] resolveImapPullFoldersExpanded failed, using base labels:', e?.message || e)
    }
    emailDebugLog('[SYNC-DEBUG] resolveImapPullFoldersExpanded fallback (non-IMAP or expand missing / error)', {
      accountId,
      baseLabels,
      fallback,
    })
    return fallback
  }
```

### What folders web.de resolves to

There is **no** `web.de`-specific branch. For a default IMAP account (no custom `folders.monitored`), base labels are **`INBOX`** and **`Spam`**. Expansion calls `ImapProvider.expandPullFoldersForSync`, which **`LIST`s** the server, maps those labels to real paths via `imapFindExistingMailboxPathForLabel`, may add a Junk-like mailbox, adds direct `INBOX.*` children (with exclusions), and if the expanded set is empty falls back to **`[this.config.folders?.inbox || 'INBOX']`**:

```1592:1628:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async expandPullFoldersForSync(baseLabels: string[]): Promise<string[]> {
    if (!this.client || !this.config) {
      throw new Error('Not connected')
    }
    const folders = await this.listFolders()
    const paths: string[] = []
    const seen = new Set<string>()
    const add = (p: string) => {
      const x = p.trim()
      if (!x) return
      const k = x.toLowerCase()
      if (seen.has(k)) return
      seen.add(k)
      paths.push(x)
    }
    for (const label of baseLabels) {
      const path = await this.imapFindExistingMailboxPathForLabel(folders, label.trim())
      if (path) add(path)
    }
    const hasSpamLike = paths.some((p) => {
      const row = folders.find((f) => f.path === p)
      return row ? this.looksLikeSpamMailbox(row) : false
    })
    if (!hasSpamLike) {
      const junk = folders.find(
        (f) =>
          !isLegacyImapMailboxLabel(f.path) &&
          !isLegacyImapMailboxLabel(f.name) &&
          this.looksLikeSpamMailbox(f),
      )
      if (junk) add(junk.path)
    }
    const expanded = await this.expandPullFoldersWithDirectInboxChildren(paths, folders)
    if (expanded.length === 0) {
      return [this.config.folders?.inbox || 'INBOX']
    }
    return expanded
  }
```

So for web.de, the concrete paths are **whatever the server returns from LIST** for those logical names (e.g. `INBOX`, localized spam folder), plus optional discovered junk / `INBOX.*` children.

### Can folder resolution yield an empty list?

- **`resolveImapPullFolders`** always returns at least **`['INBOX', 'Spam']`** (or filtered non-empty fallback).
- **`expandPullFoldersForSync`**: if internal `expanded.length === 0`, it returns **a single-element array** `[config.folders?.inbox || 'INBOX']`, not `[]`.
- **`syncAccountEmailsImpl`** uses `pullFolders[0] || … || 'INBOX'` for the single-folder branch, so even a hypothetical empty array would still default to **`INBOX`**.

---

## 4. `gateway.listMessages`

### Full method (current)

```576:592:apps/electron-vite-project/electron/main/email/gateway.ts
  async listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]> {
    const account = this.findAccount(accountId)
    console.error('GATEWAY_LIST', account.id, account.provider)
    const effectiveFolders = getFoldersForAccountOperation(account, options?.mailboxId)
    const folder = options?.folder ?? effectiveFolders.inbox

    if (account.provider === 'imap' && account.imap?.password?.trim()) {
      console.error('GATEWAY_LIST_PATH', account.id, 'imapSimplePullListMessages')
      const rawMessages = await imapSimplePullListMessages(account, folder, options)
      return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
    }

    const provider = await this.getConnectedProvider(account)
    console.error('GATEWAY_LIST_PATH', account.id, 'provider.fetchMessages', account.provider)
    const rawMessages = await provider.fetchMessages(folder, options)
    return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
  }
```

### `getConnectedProvider` on this path?

- **Password IMAP (`imap.password` non-empty):** **`getConnectedProvider` is not used for listing** — listing goes through **`imapSimplePullListMessages`** (standalone connection).
- **Otherwise:** **`getConnectedProvider(account)`** is used, then **`provider.fetchMessages`**.

### Cached but disconnected provider

```1404:1470:apps/electron-vite-project/electron/main/email/gateway.ts
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
    
    if (!provider) {
      provider = await this.getProvider(account)
      // ... token refresh omitted ...
      await provider.connect(account)
      // ...
      this.providers.set(account.id, provider)
    } else if (!provider.isConnected()) {
      // ... logging ...
      await provider.connect(account)
      // ...
    }
    
    return provider
  }
```

If a cached provider exists but **`isConnected()` is false**, the gateway **calls `connect` again** before returning.

### Options passed to `provider.fetchMessages`

The **`options`** argument to `listMessages` is passed through unchanged (plus orchestrator sets `folder` on a copy per folder). For sync, that is the `listOptions` built in `syncOrchestrator.ts` (`limit`, `syncFetchAllPages`, `syncMaxMessages`, `fromDate` / `toDate` as applicable).

---

## 5. `ImapProvider.fetchMessages`

**Important:** This method runs for listing only when **`listMessages` does not** take the password-IMAP branch — i.e. IMAP **without** a trimmed password goes through `getConnectedProvider` (which throws if password missing), so in practice **normal password-based IMAP inbox accounts use `imapSimplePullListMessages`, not `ImapProvider.fetchMessages`, for the list step.**

### Full `fetchMessages` method (current)

```813:1031:apps/electron-vite-project/electron/main/email/providers/imap.ts
  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    console.error('IMAP_FETCH_ENTRY', folder, options)
    console.error('IMAP_CLIENT_STATE', !!this.client, this.client?.state, this.isConnected())

    if (!this.client) {
      throw new Error('Not connected')
    }

    emailDebugLog('[SYNC-DEBUG] ImapProvider.fetchMessages entry', {
      folder,
      fromDate: options?.fromDate ?? null,
      toDate: options?.toDate ?? null,
      syncFetchAllPages: options?.syncFetchAllPages === true,
      syncMaxMessages: options?.syncMaxMessages ?? null,
    })

    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
    const chunkSize = 60

    if (options?.toDate && !options?.fromDate) {
      const before = new Date(options.toDate)
      if (!Number.isNaN(before.getTime())) {
        return this.fetchMessagesBeforeExclusive(folder, before, options)
      }
    }

    if (options?.fromDate) {
      const since = new Date(options.fromDate)
      if (!Number.isNaN(since.getTime())) {
        return this.fetchMessagesSince(folder, since, options)
      }
      emailDebugLog(
        '[SYNC-DEBUG] IMAP fetchMessages: fromDate present but invalid — falling through to seq-range path (no SINCE SEARCH)',
        { folder, fromDate: options.fromDate },
      )
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err, box) => {
        if (err) {
          reject(err)
          return
        }

        const total = box.messages.total
        emailDebugLog('[SYNC-DEBUG] IMAP fetchMessages seq-range path (no fromDate SINCE)', {
          folder,
          openBoxMessageTotal: total,
          syncAll,
        })
        if (total === 0) {
          emailDebugLog('[SYNC-DEBUG] IMAP fetchMessages: mailbox reports 0 messages — no fetch', { folder })
          resolve([])
          return
        }

        if (!syncAll) {
          const start = Math.max(1, total - limit + 1)
          const end = total
          const messages: RawEmailMessage[] = []
          const fetch = this.client!.seq.fetch(`${start}:${end}`, {
            bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
            struct: true,
          })
          fetch.on('message', (msg) => {
            const msgData: Partial<RawEmailMessage> = {
              id: '',
              folder,
              flags: {
                seen: false,
                flagged: false,
                answered: false,
                draft: false,
                deleted: false,
              },
              labels: [],
            }
            msg.on('body', (stream, info) => {
              let buffer = ''
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8')
              })
              stream.once('end', () => {
                if (info.which.includes('HEADER')) {
                  const headers = ImapCtor.parseHeader(buffer)
                  msgData.subject = headers.subject?.[0] || '(No Subject)'
                  msgData.from = this.parseEmailAddress(headers.from?.[0] || '')
                  msgData.to = this.parseEmailAddresses(headers.to?.[0] || '')
                  msgData.cc = this.parseEmailAddresses(headers.cc?.[0] || '')
                  msgData.date = new Date(headers.date?.[0] || Date.now())
                  msgData.headers = {
                    messageId: headers['message-id']?.[0],
                    inReplyTo: headers['in-reply-to']?.[0],
                    references: headers.references?.[0]?.split(/\s+/) || [],
                  }
                }
              })
            })
            msg.once('attributes', (attrs) => {
              const uidStr = String(attrs.uid)
              msgData.id = uidStr
              msgData.uid = uidStr
              if (attrs.flags) {
                msgData.flags = {
                  seen: attrs.flags.includes('\\Seen'),
                  flagged: attrs.flags.includes('\\Flagged'),
                  answered: attrs.flags.includes('\\Answered'),
                  draft: attrs.flags.includes('\\Draft'),
                  deleted: attrs.flags.includes('\\Deleted'),
                }
              }
            })
            msg.once('end', () => {
              messages.push(msgData as RawEmailMessage)
            })
          })
          fetch.once('error', reject)
          fetch.once('end', () => {
            resolve(messages.reverse())
          })
          return
        }

        const all: RawEmailMessage[] = []
        let startSeq = 1
        let imapRangeIdx = 0

        const nextRange = () => {
          if (startSeq > total || all.length >= maxM) {
            if (syncAll && total > 0) {
              console.log(`[IMAP] full mailbox fetch done: ${all.length} message(s) from ${total} in folder`)
            }
            resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
            return
          }
          imapRangeIdx++
          const endSeq = Math.min(total, startSeq + chunkSize - 1)
          const spec = `${startSeq}:${endSeq}`
          if (syncAll) {
            console.log(`[IMAP] full mailbox range ${imapRangeIdx}: ${spec} (total msgs=${total}, loaded ${all.length})`)
          }
          startSeq = endSeq + 1
          const batch: RawEmailMessage[] = []
          const fetch = this.client!.seq.fetch(spec, {
            bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
            struct: true,
          })
          fetch.on('message', (msg) => {
            const msgData: Partial<RawEmailMessage> = {
              id: '',
              folder,
              flags: {
                seen: false,
                flagged: false,
                answered: false,
                draft: false,
                deleted: false,
              },
              labels: [],
            }
            msg.on('body', (stream, info) => {
              let buffer = ''
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8')
              })
              stream.once('end', () => {
                if (info.which.includes('HEADER')) {
                  const headers = ImapCtor.parseHeader(buffer)
                  msgData.subject = headers.subject?.[0] || '(No Subject)'
                  msgData.from = this.parseEmailAddress(headers.from?.[0] || '')
                  msgData.to = this.parseEmailAddresses(headers.to?.[0] || '')
                  msgData.cc = this.parseEmailAddresses(headers.cc?.[0] || '')
                  msgData.date = new Date(headers.date?.[0] || Date.now())
                  msgData.headers = {
                    messageId: headers['message-id']?.[0],
                    inReplyTo: headers['in-reply-to']?.[0],
                    references: headers.references?.[0]?.split(/\s+/) || [],
                  }
                }
              })
            })
            msg.once('attributes', (attrs) => {
              const uidStr = String(attrs.uid)
              msgData.id = uidStr
              msgData.uid = uidStr
              if (attrs.flags) {
                msgData.flags = {
                  seen: attrs.flags.includes('\\Seen'),
                  flagged: attrs.flags.includes('\\Flagged'),
                  answered: attrs.flags.includes('\\Answered'),
                  draft: attrs.flags.includes('\\Draft'),
                  deleted: attrs.flags.includes('\\Deleted'),
                }
              }
            })
            msg.once('end', () => {
              batch.push(msgData as RawEmailMessage)
            })
          })
          fetch.once('error', reject)
          fetch.once('end', () => {
            for (const m of batch) {
              if (all.length >= maxM) break
              all.push(m)
            }
            nextRange()
          })
        }

        nextRange()
      })
    })
  }
```

### What chooses `fetchMessagesSince` vs `fetchMessagesBeforeExclusive` vs seq-range

1. **`toDate` set and `fromDate` unset** → valid date → **`fetchMessagesBeforeExclusive`**
2. **`fromDate` set** → valid date → **`fetchMessagesSince`**
3. **`fromDate` invalid** → logs and **falls through** to **seq-range** (`openBox` + `seq.fetch`)
4. **Neither / no valid `fromDate`** → **seq-range** path

### Bootstrap with `fromDate` set (ImapProvider path)

**`fetchMessagesSince`** is invoked (SEARCH + UID-based fetch — see §6).

---

## 6. `fetchMessagesSince` (SEARCH + fetch path)

### Full method (current)

```523:673:apps/electron-vite-project/electron/main/email/providers/imap.ts
  private fetchMessagesSince(folder: string, since: Date, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
    const chunkSize = 60

    const attachParser = (msg: ImapConnection.ImapMessage, msgData: Partial<RawEmailMessage>) => {
      msg.on('body', (stream, info) => {
        let buffer = ''
        stream.on('data', (chunk) => {
          buffer += chunk.toString('utf8')
        })
        stream.once('end', () => {
          if (info.which.includes('HEADER')) {
            const headers = ImapCtor.parseHeader(buffer)
            msgData.subject = headers.subject?.[0] || '(No Subject)'
            msgData.from = this.parseEmailAddress(headers.from?.[0] || '')
            msgData.to = this.parseEmailAddresses(headers.to?.[0] || '')
            msgData.cc = this.parseEmailAddresses(headers.cc?.[0] || '')
            msgData.date = new Date(headers.date?.[0] || Date.now())
            msgData.headers = {
              messageId: headers['message-id']?.[0],
              inReplyTo: headers['in-reply-to']?.[0],
              references: headers.references?.[0]?.split(/\s+/) || [],
            }
          }
        })
      })
      msg.once('attributes', (attrs) => {
        const uidStr = String(attrs.uid)
        /** Same as `id` — IMAP UID for list rows; RFC Message-ID lives only in `headers.messageId`. */
        msgData.id = uidStr
        msgData.uid = uidStr
        if (attrs.flags) {
          msgData.flags = {
            seen: attrs.flags.includes('\\Seen'),
            flagged: attrs.flags.includes('\\Flagged'),
            answered: attrs.flags.includes('\\Answered'),
            draft: attrs.flags.includes('\\Draft'),
            deleted: attrs.flags.includes('\\Deleted'),
          }
        }
      })
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err) => {
        if (err) {
          reject(err)
          return
        }
        let searchCriteria: any = ['SINCE', since]
        if (options?.toDate) {
          const before = new Date(options.toDate)
          if (!Number.isNaN(before.getTime())) {
            searchCriteria = ['AND', ['SINCE', since], ['BEFORE', before]]
          }
        }
        emailDebugLog(
          '[SYNC-DEBUG] IMAP SEARCH (fetchMessagesSince): openBox then SEARCH via node-imap; criteria array → SINCE/BEFORE on wire',
          {
            folder,
            sinceIso: since.toISOString(),
            sinceInternalDate: since.toString(),
            toDateOptionIso: options?.toDate ?? null,
            criteriaJson: syncDebugFormatImapSearchCriteria(searchCriteria),
          },
        )
        this.client!.search([searchCriteria], (sErr, uids: number[]) => {
          if (sErr) {
            reject(sErr)
            return
          }
          const n = uids?.length ?? 0
          emailDebugLog('[SYNC-DEBUG] IMAP SEARCH result (UIDs from UID SEARCH)', { folder, matchCount: n })
          if (!uids?.length) {
            emailDebugLog(
              '[SYNC-DEBUG] IMAP fetchMessagesSince: 0 SEARCH matches — no UID fetch attempted for this folder',
              { folder },
            )
            resolve([])
            return
          }
          const sorted = [...uids].sort((a, b) => a - b)
          let pick = syncAll ? sorted : sorted.slice(Math.max(0, sorted.length - limit))
          if (pick.length > maxM) {
            pick = pick.slice(-maxM)
          }

          const all: RawEmailMessage[] = []
          let i = 0
          let imapChunkIdx = 0

          const nextChunk = () => {
            if (i >= pick.length) {
              if (syncAll && pick.length > 0) {
                console.log(`[IMAP] SINCE fetch done: ${all.length} message(s) from ${pick.length} match(es)`)
              }
              resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
              return
            }
            imapChunkIdx++
            const slice = pick.slice(i, i + chunkSize)
            i += chunkSize
            if (syncAll) {
              console.log(
                `[IMAP] SINCE fetch chunk ${imapChunkIdx}: uid ${slice[0]}-${slice[slice.length - 1]} (${slice.length} of ${pick.length} total matches)`,
              )
            }
            const spec = slice.join(',')
            const batch: RawEmailMessage[] = []
            // connection.search() returns UIDs, not sequence numbers.
            // Use this.client!.fetch (UID-based) not seq.fetch (sequence-based).
            const fetch = this.client!.fetch(spec, {
              bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
              struct: true,
            })
            fetch.on('message', (msg) => {
              const msgData: Partial<RawEmailMessage> = {
                id: '',
                folder,
                flags: {
                  seen: false,
                  flagged: false,
                  answered: false,
                  draft: false,
                  deleted: false,
                },
                labels: [],
              }
              attachParser(msg, msgData)
              msg.once('end', () => {
                batch.push(msgData as RawEmailMessage)
              })
            })
            fetch.once('error', reject)
            fetch.once('end', () => {
              all.push(...batch)
              nextChunk()
            })
          }

          nextChunk()
        })
      })
    })
  }
```

### After `search()` returns: which fetch?

**`this.client!.fetch(spec, { ... })`** — **UID-based** `fetch`, **not** `seq.fetch`. The same pattern is used in **`fetchMessagesBeforeExclusive`** (lines 776–781 in the same file).

### Was the `seq.fetch` → `fetch` fix applied?

**Yes, in `imap.ts` for `fetchMessagesSince` and `fetchMessagesBeforeExclusive`.** (See comments and `this.client!.fetch` above.)

**Caveat:** **Password IMAP listing does not execute this code**; it uses **`imapSimplePull.ts`**, which still uses **`client.seq.fetch`** for the list phase (see below).

---

## 7. Message ingestion

### Path after `listMessages` returns

Inside `syncAccountEmailsImpl` (`syncOrchestrator.ts`):

1. `messages = await emailGateway.listMessages(...)` (per folder or merged).
2. `existingIds = getExistingEmailMessageIds(db, accountId)` — all `email_message_id` values already in `inbox_messages`.
3. For each `msg` in `messages`:
   - If **`existingIds.has(msg.id)`** → **`skippedDuplicate++`**, `continue` (no ingest).
   - Else **`getMessage`**, attachments, **`mapToRawEmailMessage`**, **`detectAndRouteMessage(db, accountId, rawMsg)`**.

### Dedup that can skip messages

**Yes.** Deduplication is by **`msg.id`** (sanitized from provider **`raw.id`**, which for IMAP is the **UID** string) against **`inbox_messages.email_message_id`** for that **`account_id`**. If every listed ID is already present, **all are skipped** with no DB insert — this is silent except for counts / logs.

### Insert requirements (`detectAndRouteMessage`)

`messageRouter.ts` always generates **`messageId`** via **`resolveStorageEmailMessageId`** (for IMAP: uid / id / messageId / random UUID), **`inboxMessageId = randomUUID()`**, and runs **`insertInbox.run(...)`** with derived fields. There is **no** pre-insert “skip if duplicate” in `detectAndRouteMessage` itself — dedupe for sync is **solely** the orchestrator’s **`existingIds`** check.

Core insert (excerpt):

```283:313:apps/electron-vite-project/electron/main/email/messageRouter.ts
  const insertInbox = db.prepare(`
    INSERT INTO inbox_messages (
      id, source_type, handshake_id, account_id, email_message_id,
      from_address, from_name, to_addresses, cc_addresses,
      subject, body_text, body_html, beap_package_json,
      has_attachments, attachment_count, received_at, ingested_at,
      imap_remote_mailbox, imap_rfc_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertInbox.run(
    inboxMessageId,
    detectedType === 'beap' ? 'email_beap' : 'email_plain',
    handshakeId,
    accountId,
    messageId,
    fromAddr,
    fromName,
    JSON.stringify(toAddrs),
    JSON.stringify(ccAddrs),
    subject,
    bodyText,
    bodyHtml,
    beapPackageJson,
    hasAttachments ? 1 : 0,
    attachments.length,
    receivedAt,
    now,
    imapRemoteMailbox,
    imapRfcMessageId,
  )
```

---

## 8. Auto-sync scheduling for IMAP

### After a pull completes — what schedules the next tick?

1. **`startAutoSync`** (`syncOrchestrator.ts`): each tick ends with **`scheduleNext()`** → **`setTimeout(tick, intervalMs)`** (default from DB **`sync_interval_ms`** or 300_000 ms). The first **`tick()`** is invoked immediately when `startAutoSync` is called.

2. **Brute-force 2-minute `setInterval`** (`ipc.ts`): **independent** of per-account state; always fires every 2 minutes for active IMAP accounts.

### Different mechanism for IMAP vs OAuth?

- **OAuth / API providers:** only the **per-account `startAutoSync`** path (when enabled and loop started) — **not** the IMAP-only 2-minute interval.
- **IMAP:** **both** the per-account loop (if `auto_sync_enabled === 1` and loop registered) **and** the **2-minute** interval (no `auto_sync_enabled` check).

### Brute-force `setInterval` present?

**Yes.** See **§1** (`ipc.ts` lines 4723–4750).

Resume on startup (mirrors global auto to all active accounts and starts stored loops):

```2506:2532:apps/electron-vite-project/electron/main/email/ipc.ts
  void (async () => {
    try {
      const db = await resolveDb()
      if (!db) return
      const anyAuto = db.prepare('SELECT 1 FROM email_sync_state WHERE auto_sync_enabled = 1 LIMIT 1').get()
      if (!anyAuto) return

      const list = await emailGateway.listAccounts()
      const activeIds = list.filter((a) => a.status === 'active').map((a) => a.id)

      for (const accountId of activeIds) {
        updateSyncState(db, accountId, { auto_sync_enabled: 1 })
        startStoredAutoSyncLoopIfMissing(db, accountId, resolveDb)
        const row = db.prepare('SELECT sync_interval_ms FROM email_sync_state WHERE account_id = ?').get(accountId) as
          | { sync_interval_ms?: number }
          | undefined
        const intervalMs = row?.sync_interval_ms ?? 300_000
        console.log('[Inbox] Resumed auto-sync loop for account', accountId, 'interval', intervalMs)
      }
    } catch (e) {
      console.warn('[Inbox] Failed to resume auto-sync loops:', (e as Error)?.message)
    }
  })()
```

---

## 9. Error swallowing (non-rethrowing `try/catch` along the hot path)

Representative cases that **catch and do not rethrow** (errors become logs, fallbacks, or ignored):

| Location | Behavior |
|----------|----------|
| **`syncOrchestrator.ts` `updateSyncState`** | `catch` → `console.error` only |
| **`syncOrchestrator.ts` `getExistingEmailMessageIds` / `getOldestInboxReceivedAtIso`** | `catch` → empty `Set` / `null` |
| **`syncOrchestrator.ts` per-folder list** | `catch` → pushes to `result.errors`, continues other folders |
| **`syncOrchestrator.ts` `fetchAttachmentBuffer` inner catch** | empty comment “Non-fatal” |
| **`syncOrchestrator.ts` `listAttachments` failure** | `console.warn`, continues message |
| **`syncOrchestrator.ts` outer auth `updateAccount` failures** | `console.warn` |
| **`syncOrchestrator.ts` success branch clear `auth_error`** | empty `catch { /* ignore */ }` |
| **`syncOrchestrator.ts` `startAutoSync` post-sync drain** | `console.warn`, may still `scheduleOrchestratorRemoteDrain` |
| **`syncOrchestrator.ts` `startAutoSync` tick** | `console.error` for tick failure, then still `scheduleNext` |
| **`syncOrchestrator.ts` `maybeRunImapLegacyFolderConsolidation`** | several `catch` paths log/warn only |
| **`ipc.ts` IMAP `setInterval`** | per-account and outer `catch` → `console.error` only |
| **`imapSimplePull.ts`** after `ready` | `client.on('error', () => {})` — **swallows** further socket errors on that client |
| **`gateway.ts` `listMessages` password path** | N/A catch inside list itself — failures reject from `imapSimplePullListMessages` |

These can **hide** IMAP failures from the UI if callers only look at `SyncResult` and the error was swallowed in a subsystem (e.g. attachment fetch). **Listing** errors for multi-folder IMAP are appended to **`result.errors`** but the sync may still return **`ok: true`**.

---

## 10. State after refactors — line counts and last modified

Paths under `apps/electron-vite-project/electron/main/email/`:

| File | Lines (`Get-Content \| Measure`) | Last write (local) |
|------|----------------------------------|--------------------|
| `ipc.ts` | 4752 | 2026-03-24 16:50:54 |
| `syncOrchestrator.ts` | 742 | 2026-03-24 17:01:06 |
| `gateway.ts` | 1578 | 2026-03-24 17:01:26 |
| `providers/imap.ts` | 2183 | 2026-03-24 17:01:16 |
| `emailDebug.ts` | 33 | 2026-03-24 16:04:02 |
| `domain/smartSyncPrefs.ts` | 38 | 2026-03-24 14:51:54 |

---

## 11. Diagnosis

### Where the pipeline can fail or silently return **0** messages

1. **`imapSimplePullListMessages` (password IMAP — default list path)**  
   - Uses **`seq.fetch`** on the **last N** messages by **sequence number**, then **`postFilter`** applies **`fromDate` / `toDate`** on **`Date` parsed from headers** (`imapSimplePull.ts`).  
   - **Silent 0:** SEARCH is **not** used; if the **newest N** messages (by seq) all have **internal date \< `fromDate`**, the client-side filter returns **`[]`** even if older mail in the window exists elsewhere in the mailbox.  
   - **`total === 0`** in mailbox → immediate `[]`.

2. **`ImapProvider.fetchMessagesSince`**  
   - **`search` returns no UIDs** → **`resolve([])`** (logged under `EMAIL_DEBUG`).

3. **Folder / openBox**  
   - Wrong path → **reject** (error), not silent.

4. **Dedup in orchestrator**  
   - Provider returns messages but **every `msg.id` is already in `inbox_messages`** → **0 new**, not a provider failure.

5. **`getMessage` returns null**  
   - Adds to **`result.errors`**, skips that message.

### Exact fix targets (high signal)

| Issue | Suggested change |
|-------|------------------|
| Password IMAP list bypasses UID SEARCH + UID FETCH | **Unify listing** with `ImapProvider.fetchMessages` / `fetchMessagesSince` (reuse connected session), **or** implement SEARCH + UID `fetch` inside **`imapSimplePullListMessages`** instead of `seq.fetch` + `postFilter`. **File:** `providers/imapSimplePull.ts` |
| Brute-force sync ignores `auto_sync_enabled` | If undesired, **gate** the loop in `ipc.ts` on `email_sync_state.auto_sync_enabled` or remove the interval. **File:** `ipc.ts` ~4727 |
| Multi-folder partial failure | Today errors are pushed to **`result.errors`** but **`ok`** may stay **true** — tighten policy if UI should treat as failure. **File:** `syncOrchestrator.ts` |

### Was the UID fetch fix lost?

**No** — in **`imap.ts`**, `fetchMessagesSince` / `fetchMessagesBeforeExclusive` use **`this.client!.fetch`** (UID fetch).  
**However**, that fix **does not apply** to the **password-IMAP list path**, which is **`imapSimplePullListMessages`** and still uses **`client.seq.fetch`**.

```35:47:apps/electron-vite-project/electron/main/email/providers/imapSimplePull.ts
function postFilter(rows: RawEmailMessage[], o?: MessageSearchOptions): RawEmailMessage[] {
  let out = rows
  const ft = o?.fromDate ? new Date(o.fromDate).getTime() : NaN
  if (!Number.isNaN(ft)) out = out.filter((m) => m.date.getTime() >= ft)
  const tt = o?.toDate ? new Date(o.toDate).getTime() : NaN
  if (!Number.isNaN(tt)) out = out.filter((m) => m.date.getTime() < tt)
  // ...
}
```

```93:104:apps/electron-vite-project/electron/main/email/providers/imapSimplePull.ts
        let n = Math.max(1, options?.limit ?? 50)
        if (options?.syncFetchAllPages && options.syncMaxMessages != null) {
          n = Math.max(n, Math.min(Math.max(1, options.syncMaxMessages), 50000))
        } else if (options?.syncFetchAllPages) n = Math.max(n, 500)
        if (options?.fromDate) n = Math.max(n, 400)
        n = Math.min(total, n)
        const start = Math.max(1, total - n + 1)
        const acc: RawEmailMessage[] = []
        const fetch = client.seq.fetch(`${start}:${total}`, {
```

---

## Appendix — `smartSyncPrefs` (defaults referenced above)

```10:29:apps/electron-vite-project/electron/main/email/domain/smartSyncPrefs.ts
export function getEffectiveSyncWindowDays(sync: EmailAccountConfig['sync'] | undefined): number {
  let out: number
  if (!sync) out = 30
  else if (typeof sync.syncWindowDays === 'number' && sync.syncWindowDays >= 0) out = sync.syncWindowDays
  else if (sync.maxAgeDays > 0) out = sync.maxAgeDays
  else out = 30
  emailDebugLog('[SYNC-DEBUG] getEffectiveSyncWindowDays', {
    rawSync: sync ?? null,
    effectiveDays: out,
    note: 'UI “90d” only applies if sync.syncWindowDays (or legacy maxAgeDays) is persisted on the account',
  })
  return out
}

export function getMaxMessagesPerPull(sync: EmailAccountConfig['sync'] | undefined): number {
  const n = sync?.maxMessagesPerPull
  if (typeof n === 'number' && n > 0) return Math.min(5000, Math.max(1, n))
  return 500
}
```
