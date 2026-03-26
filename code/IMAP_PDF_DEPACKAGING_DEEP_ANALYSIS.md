# Deep analysis: IMAP fixes + PDF/attachment depackaging architecture

**Scope:** Read-only analysis of the repository at analysis time. No product code was modified.

**Paths** are relative to the workspace `code/` root unless noted.

---

## 1. IMAP password save — full trace with code

### 1A. UI: “Update credentials” / Custom IMAP reconnect

**File:** `apps/extension-chromium/src/shared/components/EmailConnectWizard.tsx`

When the wizard opens for reconnect, `imapPassword` is **always reset to empty** and non-secret fields are filled from `getImapReconnectHints`:

```168:195:apps/extension-chromium/src/shared/components/EmailConnectWizard.tsx
  /** Pre-fill Custom IMAP form when updating credentials for an existing account (Electron). */
  useEffect(() => {
    if (!isOpen || !reconnectAccountId || !isElectron()) return
    let cancelled = false
    const run = async () => {
      try {
        const r = await window.emailAccounts?.getImapReconnectHints?.(reconnectAccountId)
        if (cancelled || !r?.ok || !r.data) return
        const h = r.data as Record<string, unknown>
        setProvider('custom')
        setStep('credentials')
        setCredError(null)
        setReconnectHasStoredImapPassword(h.hasImapPassword === true)
        setCustomForm({
          email: String(h.email ?? ''),
          displayName: String(h.displayName ?? h.email ?? ''),
          imapHost: String(h.imapHost ?? ''),
          imapPort: String(h.imapPort ?? '993'),
          imapSecurity: (h.imapSecurity as SecurityModeUi) ?? 'ssl',
          imapUsername: String(h.imapUsername ?? ''),
          imapPassword: '',
          smtpHost: String(h.smtpHost ?? ''),
          smtpPort: String(h.smtpPort ?? '587'),
          smtpSecurity: (h.smtpSecurity as SecurityModeUi) ?? 'starttls',
          smtpUseSameCredentials: h.smtpUseSameCredentials !== false,
          smtpUsername: String(h.smtpUsername ?? ''),
          smtpPassword: '',
        })
```

On connect, if `reconnectAccountId` is set and `updateImapCredentials` exists, the wizard calls IPC (not `updateAccount` directly):

```721:734:apps/extension-chromium/src/shared/components/EmailConnectWizard.tsx
          if (reconnectAccountId && isElectron() && window.emailAccounts?.updateImapCredentials) {
            const raw = await window.emailAccounts.updateImapCredentials(reconnectAccountId, {
              imapPassword: cf.imapPassword,
              smtpPassword: cf.smtpUseSameCredentials ? undefined : cf.smtpPassword,
              smtpUseSameCredentials: cf.smtpUseSameCredentials,
            })
            const inner = raw?.data as { success?: boolean; error?: string } | undefined
            const ok = !!(raw?.ok && inner?.success)
            res = {
              ok,
              email: cf.email.trim(),
              error: ok ? undefined : inner?.error || (raw as { error?: string })?.error || 'Could not update credentials',
            }
```

**IPC payload:** `{ imapPassword, smtpPassword?, smtpUseSameCredentials? }` — no host/port/security in this path (those come from persisted account).

**Preload:** `apps/electron-vite-project/electron/preload.ts` exposes `emailAccounts.updateImapCredentials` → `ipcRenderer.invoke('email:updateImapCredentials', accountId, creds)`.

---

### 1B. Main process IPC handler

**File:** `apps/electron-vite-project/electron/main/email/ipc.ts`

```436:452:apps/electron-vite-project/electron/main/email/ipc.ts
  ipcMain.handle(
    'email:updateImapCredentials',
    async (
      _e,
      accountId: string,
      creds: { imapPassword: string; smtpPassword?: string; smtpUseSameCredentials?: boolean },
    ) => {
      try {
        const id = String(accountId ?? '').trim()
        if (!id) return { ok: false, error: 'accountId required' }
        const result = await emailGateway.updateImapCredentials(id, creds ?? { imapPassword: '' })
        return { ok: true, data: result }
      } catch (error: any) {
        console.error('[Email IPC] updateImapCredentials error:', error)
        return { ok: false, error: error.message }
      }
    },
  )
```

Returns `{ ok: true, data: { success, error? } }` on success path.

---

### 1C. Gateway: `updateImapCredentials` → `updateAccount` → `saveAccounts`

**File:** `apps/electron-vite-project/electron/main/email/gateway.ts`

Full `updateImapCredentials` (replaces `imap`/`smtp` without spreading stale `_encrypted`):

```453:507:apps/electron-vite-project/electron/main/email/gateway.ts
  async updateImapCredentials(
    accountId: string,
    creds: { imapPassword: string; smtpPassword?: string; smtpUseSameCredentials?: boolean },
  ): Promise<{ success: boolean; error?: string }> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) {
      return { success: false, error: 'Account not found' }
    }
    if (account.provider !== 'imap' || !account.imap || !account.smtp) {
      return { success: false, error: 'Not a custom IMAP+SMTP account' }
    }
    const imapPw = creds.imapPassword?.trim() ?? ''
    if (!imapPw) {
      return { success: false, error: 'Password required' }
    }
    const useSame = creds.smtpUseSameCredentials !== false
    const smtpPw = useSame ? imapPw : (creds.smtpPassword?.trim() ?? '')
    if (!useSame && !smtpPw) {
      return { success: false, error: 'SMTP password required' }
    }
    /**
     * Build explicit IMAP/SMTP objects (no spread of old `imap` / `smtp`).
     * Spreading could keep stale `_encrypted: true` alongside a new plaintext password and confuse save/load.
     */
    const nextImap = {
      host: account.imap.host,
      port: account.imap.port,
      security: account.imap.security,
      username: account.imap.username,
      password: imapPw,
    }
    const nextSmtp = {
      host: account.smtp.host,
      port: account.smtp.port,
      security: account.smtp.security,
      username: account.smtp.username,
      password: useSame ? imapPw : smtpPw,
    }
    await this.updateAccount(accountId, {
      imap: nextImap,
      smtp: nextSmtp,
      status: 'active',
      lastError: undefined,
    })
    const test = await this.testConnection(accountId)
    if (!test.success) {
      return { success: false, error: test.error ?? 'Connection test failed' }
    }
    try {
      await this.forceReconnect(accountId)
    } catch (e: any) {
      console.warn('[EmailGateway] updateImapCredentials: forceReconnect after successful test:', e?.message || e)
    }
    return { success: true }
  }
```

`updateAccount` merges and calls `saveAccounts`:

```330:353:apps/electron-vite-project/electron/main/email/gateway.ts
  async updateAccount(id: string, updates: Partial<EmailAccountConfig>): Promise<EmailAccountInfo> {
    const index = this.accounts.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error('Account not found')
    }
    
    this.accounts[index] = {
      ...this.accounts[index],
      ...updates,
      id, // Prevent ID change
      updatedAt: Date.now()
    }
    
    saveAccounts(this.accounts)
    
    // Disconnect existing provider if connected
    const provider = this.providers.get(id)
    if (provider) {
      await provider.disconnect()
      this.providers.delete(id)
    }
    
    return this.toAccountInfo(this.accounts[index])
  }
```

**Important:** Credentials are persisted **before** `testConnection`. If the connection test fails, the IPC layer still returns `success: false`, but `saveAccounts` has already run with the new passwords.

`getImapReconnectHints` exposes whether a password exists in memory (never sent to renderer):

```424:451:apps/electron-vite-project/electron/main/email/gateway.ts
  async getImapReconnectHints(accountId: string): Promise<ImapReconnectHints | null> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account || account.provider !== 'imap' || !account.imap || !account.smtp) {
      return null
    }
    const imap = account.imap
    const smtp = account.smtp
    /** Passwords may be encrypted on disk — infer “same credentials” from usernames only. */
    const smtpUseSame = imap.username === smtp.username
    const hasImapPassword = typeof imap.password === 'string' && imap.password.length > 0
    const hasSmtpPassword = typeof smtp.password === 'string' && smtp.password.length > 0
    return {
      email: account.email,
      displayName: account.displayName,
      imapHost: imap.host,
      imapPort: imap.port,
      imapSecurity: imap.security,
      imapUsername: imap.username,
      smtpHost: smtp.host,
      smtpPort: smtp.port,
      smtpSecurity: smtp.security,
      smtpUseSameCredentials: smtpUseSame,
      smtpUsername: smtp.username,
      /** True when a non-empty password is in memory (passwords are never sent to the renderer). */
      hasImapPassword,
      hasSmtpPassword,
    }
  }
```

---

### 1D. `saveAccounts` / encryption / `email-accounts.json`

**Persistence path:** `app.getPath('userData')` + `email-accounts.json` (`getAccountsPath`).

**IMAP passwords:** Encrypted at rest when `safeStorage.isEncryptionAvailable()` is true — same mechanism as OAuth token fields, via `encryptValue` + `_encrypted` flag on the `imap` / `smtp` objects.

```145:169:apps/electron-vite-project/electron/main/email/gateway.ts
function encryptImapSmtpPasswordsForDisk(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap' || !account.imap) return account
  const encAvail = isSecureStorageAvailable()
  /** Never persist `undefined` — JSON.stringify omits it and the password would be lost on reload. */
  const imapPlain = String(account.imap.password ?? '')
  const imap = {
    host: account.imap.host,
    port: account.imap.port,
    security: account.imap.security,
    username: account.imap.username,
    password: encryptValue(imapPlain),
    _encrypted: encAvail,
  }
  const smtp = account.smtp
    ? {
        host: account.smtp.host,
        port: account.smtp.port,
        security: account.smtp.security,
        username: account.smtp.username,
        password: encryptValue(String(account.smtp.password ?? '')),
        _encrypted: encAvail,
      }
    : undefined
  return { ...account, imap, smtp }
}
```

```226:255:apps/electron-vite-project/electron/main/email/gateway.ts
function saveAccounts(accounts: EmailAccountConfig[]): void {
  try {
    const accountsPath = getAccountsPath()
    console.log('[EmailGateway] Saving', accounts.length, 'accounts to:', accountsPath)
    console.log('[EmailGateway] Encrypting tokens:', isSecureStorageAvailable())
    
    // Ensure directory exists
    const dir = path.dirname(accountsPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    // Encrypt OAuth tokens and IMAP/SMTP passwords before saving
    const encryptedAccounts = accounts.map(account => {
      let next = account
      if (account.oauth) {
        next = {
          ...account,
          oauth: encryptOAuthTokens(account.oauth)
        }
      }
      return encryptImapSmtpPasswordsForDisk(next)
    })
    
    fs.writeFileSync(accountsPath, JSON.stringify({ accounts: encryptedAccounts }, null, 2), 'utf-8')
    console.log('[EmailGateway] Accounts saved successfully (tokens encrypted)')
  } catch (err) {
    console.error('[EmailGateway] Error saving accounts:', err)
  }
}
```

**OAuth vs IMAP:**

| | OAuth | IMAP/SMTP password |
|---|--------|-------------------|
| Storage | `oauth.accessToken` / `refreshToken` via `encryptOAuthTokens` → `_encrypted` | `imap.password` / `smtp.password` via `encryptValue` → `_encrypted` on `imap`/`smtp` |
| Algorithm | Electron `safeStorage` (OS keychain / DPAPI) | Same `encryptValue` in `secure-storage.ts` |

**Key location:** OS-provided secret wrapping via Electron `safeStorage` — not an app-managed AES key file in-repo.

---

### 1E. `loadAccounts` / decryption

```90:143:apps/electron-vite-project/electron/main/email/gateway.ts
function decryptImapSmtpPasswords(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap') return account
  let next: EmailAccountConfig = { ...account }
  if (next.imap && next.imap._encrypted === true) {
    try {
      const plain = decryptValue(next.imap.password)
      next = {
        ...next,
        imap: {
          host: next.imap.host,
          port: next.imap.port,
          security: next.imap.security,
          username: next.imap.username,
          password: plain,
          /** In-memory value is always plaintext; disk uses `_encrypted` + ciphertext. */
          _encrypted: false,
        },
      }
    } catch (err) {
      console.error('[EmailGateway] Failed to decrypt IMAP password for account:', account.id, err)
      return {
        ...next,
        status: 'error',
        lastError: 'Failed to decrypt stored IMAP credentials. Please remove the account and connect again.',
        imap: next.imap ? { ...next.imap, password: '', _encrypted: false } : undefined,
      }
    }
  }
  if (next.smtp && next.smtp._encrypted === true) {
    try {
      const plain = decryptValue(next.smtp.password)
      ...
    } catch (err) {
      ...
    }
  }
  return next
}
```

```184:221:apps/electron-vite-project/electron/main/email/gateway.ts
function loadAccounts(): EmailAccountConfig[] {
  try {
    const accountsPath = getAccountsPath()
    ...
    if (fs.existsSync(accountsPath)) {
      const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      const accounts = data.accounts || []
      ...
      return accounts.map((account: EmailAccountConfig) => {
        let next: EmailAccountConfig = account
        if (account.oauth) {
          try {
            const decrypted = decryptOAuthTokens(account.oauth as any)
            next = { ...next, oauth: decrypted }
          } catch (err) {
            ...
          }
        }
        return decryptImapSmtpPasswords(next)
      })
    } else {
      ...
    }
  } catch (err) {
    console.error('[EmailGateway] Error loading accounts:', err)
  }
  return []
}
```

---

### 1F. Schema (`EmailAccountConfig.imap`)

**File:** `apps/electron-vite-project/electron/main/email/types.ts`

```309:328:apps/electron-vite-project/electron/main/email/types.ts
  /** IMAP credentials (for imap provider) */
  imap?: {
    host: string
    port: number
    security: SecurityMode
    username: string
    password: string  // Encrypted at rest when `_encrypted` is true
    /** When true, `password` was stored with OS secure storage (see gateway save/load). */
    _encrypted?: boolean
  }
  
  /** SMTP settings for sending (optional) */
  smtp?: {
    host: string
    port: number
    security: SecurityMode
    username: string
    password: string  // Encrypted at rest when `_encrypted` is true
    _encrypted?: boolean
  }
```

---

### 1G. What is likely “broken” vs expected UX

**Expected:** The password field is **always empty** when reopening the dialog; passwords are not sent to the renderer (`ImapReconnectHints` explicitly excludes secrets).

**If “connection fails because there is no password”** (i.e. `hasImapPassword` is false after a successful reconnect, or IMAP fails after restart), plausible code-level causes to verify in logs / runtime:

1. **`_encrypted: true` on disk but value not actually ciphertext** — `encryptValue` can fall back to returning plaintext on encryption failure while still setting `_encrypted: true` in `encryptOAuthTokens`-style paths; for IMAP, `encryptImapSmtpPasswordsForDisk` sets `_encrypted: encAvail` where `encAvail` is `isSecureStorageAvailable()`. If `encryptString` throws inside `encryptValue`, it returns plaintext **but** `_encrypted` can still be `true` from `encAvail`, causing `decryptValue` to mis-handle the string (see `secure-storage.ts`).

2. **Decrypt failure on load** — `decryptImapSmtpPasswords` clears password and sets `status: 'error'` with a specific `lastError`.

3. **Misinterpretation of UI** — Empty field after save is normal; rely on `hasImapPassword` / connection test / placeholders (`EmailConnectWizard` uses placeholder “Enter new password” when `reconnectHasStoredImapPassword`).

4. **`saveAccounts` errors swallowed** — `catch` only logs; a failed write would leave old file content.

---

## 2. IMAP remote sync — what to remove and where

Goal: **stop enqueuing/applying remote IMAP moves** for IMAP accounts; keep **pull + local classification**.

### 2A. Where remote ops are enqueued

| Location | Function | IMAP-specific today? |
|----------|----------|----------------------|
| `inboxOrchestratorRemoteQueue.ts` | `enqueueOrchestratorRemoteMutations` | No — uses `emailGateway.getProviderSync` and stores `provider_type` in queue (includes `'imap'`). |
| Same file | `enqueueRemoteOpsForLocalLifecycleState` | No — same; drives lifecycle mirror for any account whose rows pass filters. |
| Same file | `enqueueFullRemoteSync` | No — scans all `inbox_messages` for account. |
| `email/ipc.ts` | `runInboxAccountPullKind` after `syncAccountEmails` | Calls `enqueueRemoteOpsForLocalLifecycleState(db, result.newInboxMessageIds)` for **all** providers. |
| `email/syncOrchestrator.ts` | `startAutoSync` → after `syncAccountEmails` | Same. |
| `email/ipc.ts` | `fireRemoteOrchestratorSync` | `enqueueOrchestratorRemoteMutations` — direct ops (archive, etc.). |
| `email/ipc.ts` | `runEnqueueRemoteLifecycleMirrorFromIds`, `inbox:fullRemoteSync*` | All call `enqueueFullRemoteSync` / `enqueueRemoteOpsForLocalLifecycleState` without provider filter. |
| `email/imapLifecycleReconcile.ts` | `reconcileImapLifecycleFromLocalState` | **Only runs when `provider === 'imap'`** — IMAP-specific repair that re-enqueues lifecycle ops. |

**Representative — post-pull enqueue (`ipc.ts`):**

```1987:1992:apps/electron-vite-project/electron/main/email/ipc.ts
    try {
      if (result.newInboxMessageIds?.length) {
        enqueueRemoteOpsForLocalLifecycleState(db, result.newInboxMessageIds)
      }
      scheduleOrchestratorRemoteDrain(resolveDb)
```

**Representative — `enqueueOrchestratorRemoteMutations` provider resolution:**

```333:354:apps/electron-vite-project/electron/main/email/inboxOrchestratorRemoteQueue.ts
    let providerType: string
    try {
      providerType = emailGateway.getProviderSync(row.account_id)
    } catch {
      ...
    }

    try {
      supersedeOtherPendingOps.run(now, mid, operation)
      upsert.run(
        randomUUID(),
        mid,
        row.account_id,
        row.email_message_id,
        providerType,
        operation,
        now,
        now,
      )
```

**Skip strategy:** Add `if (providerType === 'imap') continue` (or early-return at helper entry) in:

- `enqueueOrchestratorRemoteMutations`
- `enqueueRemoteOpsForLocalLifecycleState` (after resolving `account_id` → config)
- `enqueueFullRemoteSync` / `enqueueFullRemoteSyncForAccountsTouchingMessages`

…and **disable or no-op** `reconcileImapLifecycleFromLocalState` for the “remove IMAP remote” product decision, or guard its callers.

### 2B. Where remote ops are drained (SimpleDrain)

**File:** `apps/electron-vite-project/electron/main/email/inboxOrchestratorRemoteQueue.ts`

`processOrchestratorRemoteQueueBatch` applies ops via `emailGateway.applyOrchestratorRemoteOperation` (IMAP provider implements moves). To stop remote IMAP: either **skip picking rows** where `provider_type === 'imap'`, or short-circuit in `applyOrchestratorRemoteOperation` for IMAP (less clean).

IMAP-specific throttling already exists (`interRemoteOpDelayMs`, preflight blocks around lines 540–574 in the same file — worth reading in full when implementing).

### 2C. UI: Sync Remote, debug, banners

- **Sync Remote button:** `EmailInboxView.tsx` `handleRemoteLifecycleSyncAll` → `window.emailInbox.fullRemoteSyncAllAccounts` → IPC `inbox:fullRemoteSyncAllAccounts` (`ipc.ts` ~3193+). Affects **all** accounts unless IPC filters IMAP.
- **Bulk view:** `EmailInboxBulkView.tsx` — same pattern; Auto-Sort can call `fullRemoteSyncForMessages`.
- **Extension badge:** `EmailProvidersSection.tsx` shows **“Limited Sync”** for non-OAuth providers (IMAP) vs **“Smart Sync”** for Gmail/Outlook/Zoho.
- **User copy:** `ImapConnectionNotice.tsx` documents pull/classify vs remote folder mirroring.

### 2D. Recommended IMAP UX after change

- **Pull:** unchanged (`runInboxAccountPullKind` / `syncAccountEmails`).
- **AI Auto-Sort / local columns:** unchanged.
- **Remote Sync:** Hide or disable **☁ Sync Remote** for IMAP-only accounts, or keep button but make IPC no-op for `provider === 'imap'` (clearer: hide + short explanation in debug).
- **Badge:** Replace “Limited Sync” with something like **“Pull & Classify”** if remote mirror is removed entirely for IMAP (`EmailProvidersSection.tsx`).

---

## 3. Current attachment handling in the email pipeline

### 3A. Ingest: `messageRouter.ts`

**Role:** Insert `inbox_messages`, store files under `userData/inbox-attachments/{messageId}/`, insert `inbox_attachments` rows. **No PDF text extraction at ingest** — plain path defers to `plain_email_inbox` + `processPendingPlainEmails`.

**Attachment storage helper:**

```142:157:apps/electron-vite-project/electron/main/email/messageRouter.ts
function getAttachmentsBasePath(): string {
  return path.join(app.getPath('userData'), 'inbox-attachments')
}

function storeAttachment(messageId: string, attId: string, filename: string, content: Buffer): string {
  const base = getAttachmentsBasePath()
  const dir = path.join(base, messageId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  ...
  fs.writeFileSync(storagePath, content)
  return storagePath
}
```

**DB insert (plaintext files on disk — not encrypted in this layer):**

```339:365:apps/electron-vite-project/electron/main/email/messageRouter.ts
  const insertAtt = db.prepare(`
    INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const att of attachments) {
    const attId = att.id || randomUUID()
    let storagePath: string | null = null
    if (att.content && att.content.length > 0) {
      try {
        storagePath = storeAttachment(inboxMessageId, attId, att.filename, att.content)
      } catch (e) {
        console.warn('[MessageRouter] Failed to store attachment:', att.filename, e)
      }
    }
    insertAtt.run(
      attId,
      inboxMessageId,
      att.filename || 'attachment',
      att.contentType || 'application/octet-stream',
      att.size ?? 0,
      att.contentId ?? null,
      storagePath,
      now,
    )
  }
```

**Plain email BEAP message:** `plainEmailToBeapMessage` + `enrichWithAttachments` — metadata only; `semanticContent` / `extracted_text` not populated at ingest.

### 3B. Plain email depackaging

**File:** `plainEmailIngestion.ts` — sets `depackaged_json` from `convertPlainToBeapFormat` only; **does not** run PDF extraction.

### 3C. Lazy extraction when opening reader

**File:** `email/ipc.ts` — `inbox:getAttachmentText` reads file, runs `extractPdfText`, optional **Anthropic Vision** fallback, updates `inbox_attachments` and merges into `depackaged_json.attachments[].extracted_text` when `content_id` matches.

```2352:2425:apps/electron-vite-project/electron/main/email/ipc.ts
  ipcMain.handle('inbox:getAttachmentText', async (_e, attachmentId: string) => {
    ...
      if (row.storage_path && fs.existsSync(row.storage_path) && isPdfFile(row.content_type || '', row.filename)) {
        const buf = fs.readFileSync(row.storage_path)
        let result = await extractPdfText(buf)
        ...
        const needsFallback = !result?.success || (text.replace(/\s/g, '').length < minUsableChars)
        if (needsFallback && getAnthropicApiKey) {
          const apiKey = await getAnthropicApiKey()
          if (apiKey?.trim()?.startsWith('sk-ant-')) {
            try {
              const visionResult = await extractPdfTextWithVisionApi(buf, apiKey.trim())
              ...
            } catch (visionErr: any) {
              console.warn('[Inbox IPC] Vision fallback failed:', visionErr?.message)
            }
          }
        }

        db.prepare('UPDATE inbox_attachments SET extracted_text = ?, text_extraction_status = ? WHERE id = ?')
          .run(text, status, attachmentId)
```

**Open original:** `inbox:openAttachmentOriginal` uses `shell.openPath` on `storage_path` — **no vault encryption**.

### 3D. `inbox_attachments` schema (migrations)

**File:** `handshake/db.ts` — `extracted_text`, `text_extraction_status`, `storage_path`, etc.

### 3E. BEAP / “capsule” shapes used here

- **Handshake BEAP capsule** — see `handshake/capsuleBuilder.ts`, `handshake/types.ts` (not duplicated here).
- **Plain-email depackaged JSON** — `PlainEmailDepackagedFormat` in `plainEmailConverter.ts` (`attachments[].extracted_text` optional).

### 3F. Inbox UI

**File:** `InboxAttachmentRow.tsx` — reuses `ProtectedAccessWarningDialog`, “Select for chat”, “Open Document Reader” (calls `getAttachmentText`), “Open original”.

---

## 4. Handshake PDF workflow — reference (vault HS profiles)

This is **not** the same storage path as email attachments. Handshake business documents for vault profiles use:

- **Table linkage:** `hs_context_profile_documents` + `vault_documents` (ciphertext + wrapped DEK).
- **Encryption:** `openRecord` / envelope crypto with per-record AAD (`hsdoc:${documentId}`) — see `getProfileDocumentContent`:

```532:578:apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts
export async function getProfileDocumentContent(
  db: any,
  tier: VaultTier,
  kek: Buffer,
  documentId: string,
): Promise<{ content: Buffer; filename: string; mimeType: string }> {
  requireHsContextAccess(tier, 'read')
  ...
  const aad = Buffer.from(`hsdoc:${documentId}`)
  const wrappedDEK = Buffer.from(storageRow.wrapped_dek)
  const ciphertext = Buffer.from(storageRow.ciphertext)
  ...
  const content = Buffer.from(pdfBase64, 'base64')

  return { content, filename: docRow.filename, mimeType: docRow.mime_type }
}
```

- **Text extraction:** Async job `runExtractionJob` / `hsContextOcrJob.ts` (pdfjs + OCR paths) — fire-and-forget after document insert (see comments around `setImmediate` in `hsContextProfileService.ts`).
- **Cryptographic proof:** Handshake **context blocks** use **SHA-256** of content at delivery (`handshake.receiveContextDelivery` in `handshake/ipc.ts` ~1311–1318). Vault profile PDFs are also hashed for `block_hash` when building blocks (`computeBlockHash` in `resolveProfileIdsToContextBlocks`).
- **UI:** `StructuredHsContextPanel.tsx`, `HandshakeWorkspace.tsx` — `HsContextDocumentReader`, `ProtectedAccessWarningDialog`, `requestOriginalDocument` (decrypt + serve base64 to renderer for download).

**Email inbox** already shares **ProtectedAccessWarningDialog** pattern with `InboxAttachmentRow.tsx`.

---

## 5. Shared components inventory (handshake ↔ email)

| Item | Path | Reuse for email depackaging |
|------|------|-----------------------------|
| PDF text (basic) | `email/pdf-extractor.ts`, `email/gateway.extractAttachmentText` | Yes — already used by IPC; product may replace “basic” extractor with pdf-parse/pdfjs consistently. |
| Vision PDF fallback | `vault/hsContextOcrJob.ts` (`extractPdfTextWithVisionApi`) via `email/ipc.ts` | **Email spec says NO Anthropic for email depackaging** — disable or bypass in ingest path while handshake can keep. |
| Encryption for blobs | `vault/*` envelope encryption | **Not directly** — email attachments today are **plain files** under `userData`. Would need new envelope or reuse vault layer explicitly. |
| SHA-256 proof | `crypto.createHash` in `handshake/ipc.ts` delivery | Pattern can be reused; email pipeline has no equivalent hash linking attachment text ↔ blob yet. |
| Document reader UI | `HsContextDocumentReader.tsx` | Could unify with `InboxAttachmentRow` inline reader — today inbox uses **custom inline** reader, not `HsContextDocumentReader`. |
| Warning dialog | `ProtectedAccessWarningDialog.tsx` | **Already shared** by inbox attachments. |
| Select for chat | Inbox store + `InboxAttachmentRow` | Mechanism exists for email; handshake uses document IDs in HS context — different context bridge. |
| Blob storage | `inbox-attachments/` + SQLite | Exists; encryption would be **new** if parity with vault. |

---

## 6. Schema changes needed (suggested)

### 6A. SQLite (`inbox_attachments` / related)

Already have: `extracted_text`, `text_extraction_status`.

Possible additions for full spec:

| Need | Suggestion |
|------|------------|
| Encrypted blob reference | `storage_encrypted` flag + `vault_document_id` FK **or** ciphertext columns |
| SHA-256 text↔blob | `content_sha256` / `extracted_text_sha256` |
| Extraction error detail | `text_extraction_error` TEXT |

### 6B. `depackaged_json` / BEAP-compatible plain format

Extend `PlainEmailDepackagedFormat.attachments[]` in `plainEmailConverter.ts` with:

- `sha256` / `blob_ref`
- `extraction_status` / `extraction_error`
- optional `encrypted: true`

---

## 7. BEAP capsule schema changes (plain-email path)

Current `PlainEmailDepackagedFormat` already allows `extracted_text` on attachments in conversion. For a full “capsule” parity with handshake:

- Parsed attachment text (per file)
- Encrypted original reference + hash binding
- Per-attachment extraction status and error strings

Handshake **capsule wire types** live under `electron/main/handshake/` (`capsuleBuilder.ts`, `types.ts`) — email plain pipeline uses a **parallel** `plain_email_converted` JSON, not the full handshake capsule schema.

---

## 8. Non-PDF attachments (handshake)

Vault HS profiles focus on PDFs for business documents; non-PDF files in generic vault items follow envelope encryption elsewhere in `vault/service.ts`. For **email**, non-PDFs today: stored as raw files, `getAttachmentText` marks `skipped` — aligns with “encrypt blob + warn before open” **only after** encryption work is added.

---

## 9. Implementation complexity estimate

| Work item | Estimate |
|-----------|----------|
| IMAP: skip remote enqueue + drain for `provider === 'imap'` | Medium (1–4h) — touch queue + IPC + reconcile + tests |
| IMAP: UI hide Sync Remote / badge copy | Small |
| Diagnose IMAP password persistence vs UX (logs, secureStorage edge cases) | Medium |
| Email ingest: PDF extract + hash + merge into depackaged_json (no Vision) | Large (4h+) |
| Encrypt email attachment blobs (vault or new layer) | Large |
| Reuse `HsContextDocumentReader` in inbox | Medium |
| DB columns for hash/status/encrypted ref | Small–medium |

---

## 10. Recommended implementation order

1. **Product decision + IMAP remote off** — Gate `enqueueOrchestratorRemoteMutations`, `enqueueRemoteOpsForLocalLifecycleState`, `enqueueFullRemoteSync*`, drain batch, and `imapLifecycleReconcile` on `provider !== 'imap'` (or feature flag).
2. **UI** — Sync Remote visibility + badge copy (`EmailProvidersSection`, inbox toolbars).
3. **Password bug** — Reproduce with `hasImapPassword` + file on disk; verify `encryptValue`/`_encrypted` pairing in `secure-storage.ts` if mismatch suspected.
4. **PDF pipeline** — Move extraction to ingest (or batch job after insert), disable Vision for email per spec, persist hashes.
5. **Encryption** — Decide vault vs app-level envelope for attachment blobs; then wire “Open original” to decrypt path.
6. **Reader UX** — Consolidate reader component + extraction error surfaces in message view.

---

## 11. NOT FOUND / search notes

- **Single `BeapMessage` TypeScript `interface` name** in `apps/electron-vite-project` — **NOT FOUND** via grep; BEAP shapes are spread across handshake types and `PlainEmailBeapMessage` / `PlainEmailDepackagedFormat` in `plainEmailConverter.ts`.
- **Dedicated “email BEAP capsule” interface** separate from `PlainEmailDepackagedFormat` — use `PlainEmailDepackagedFormat` + `beap_package_json` on `inbox_messages` for BEAP detection path.

---

*Line numbers refer to the repository state at the time of analysis.*
