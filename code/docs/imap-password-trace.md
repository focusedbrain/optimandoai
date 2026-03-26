# IMAP password trace: wizard → `email-accounts.json` → `listAccounts`

**Scope:** Read-only analysis of the **current** codebase. No fixes applied.

**Executive summary**

- The wizard and preload use the field name **`imapPassword`** (top-level on the connect payload).
- The gateway stores it on the account row as **`imap.password`** (nested on `EmailAccountConfig`).
- **`saveAccounts`** builds an **encrypted snapshot** via **`encryptImapSmtpPasswordsForDisk`** and writes JSON; it **does not** assign that snapshot back onto `this.accounts` (in-memory rows stay plaintext after save).
- **`listAccounts`** returns **`EmailAccountInfo`**, which **does not include any `imap` object or passwords**. If renderer/devtools code expects `data[].imap.password`, it will always be **`undefined`** — that is **by type design**, not proof that the password failed to persist. To infer presence without exposing the secret, the code exposes **`getImapReconnectHints`** with **`hasImapPassword`** / **`hasSmtpPassword`**.

---

## 1. Wizard submit — `EmailConnectWizard.tsx`

**When Connect runs (custom IMAP):** `handleSaveAndConnect` validates and sets `step` to `'connecting'`. The actual IPC call is in a `useEffect` that runs when `step === 'connecting'` (not in the click handler itself).

**Payload object:** `connectCustomMailbox({ ... })` is invoked with **`imapPassword: cf.imapPassword`** (string field name **`imapPassword`**).

```722:766:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\extension-chromium\src\shared\components\EmailConnectWizard.tsx
  useEffect(() => {
    if (step !== 'connecting' || !connecting) return
    const connect = async () => {
      try {
        let res: { ok: boolean; email?: string; error?: string }
        if (provider === 'gmail') {
          res = await connectGmail(connectSyncWindowDays)
        } else if (provider === 'outlook') {
          res = await connectOutlook(connectSyncWindowDays)
        } else if (provider === 'zoho') {
          res = await connectZoho(connectSyncWindowDays)
        } else {
          const cf = customForm
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
          } else {
            const imapPort = parseInt(cf.imapPort, 10)
            const smtpPort = parseInt(cf.smtpPort, 10)
            res = await connectCustomMailbox({
              displayName: cf.displayName.trim() || undefined,
              email: cf.email.trim(),
              imapHost: cf.imapHost.trim(),
              imapPort,
              imapSecurity: cf.imapSecurity,
              imapUsername: cf.imapUsername.trim() || undefined,
              imapPassword: cf.imapPassword,
              smtpHost: cf.smtpHost.trim(),
              smtpPort,
              smtpSecurity: cf.smtpSecurity,
              smtpUseSameCredentials: cf.smtpUseSameCredentials,
              smtpUsername: cf.smtpUseSameCredentials ? undefined : cf.smtpUsername.trim() || undefined,
              smtpPassword: cf.smtpUseSameCredentials ? undefined : cf.smtpPassword,
              syncWindowDays: connectSyncWindowDays,
            })
          }
        }
```

**`connectCustomMailbox`** forwards that object to the preload bridge on Electron:

```479:491:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\extension-chromium\src\shared\components\EmailConnectWizard.tsx
  const connectCustomMailbox = useCallback(
    async (payload: Record<string, unknown>): Promise<{ ok: boolean; email?: string; error?: string }> => {
      if (isElectron()) {
        const res = await (window as any).emailAccounts?.connectCustomMailbox?.(payload)
        return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
      }
      if (isExtension()) {
        const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_CUSTOM_MAILBOX', ...payload })
        return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
      }
      return { ok: false, error: 'Email connection requires the desktop app or extension.' }
    },
    [],
  )
```

| Check | Result |
|--------|--------|
| Field name on wizard payload | **`imapPassword`** (top-level) |
| Password present for new connect | Yes, required earlier in `handleSaveAndConnect` via `cf.imapPassword` validation |

---

## 2. Preload bridge — `assertCustomMailboxPayload` (`preload.ts`)

**Full function** (extracts and returns **`imapPassword`** as a required string):

```96:175:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\preload.ts
function assertCustomMailboxPayload(v: unknown): {
  displayName?: string
  email: string
  imapHost: string
  imapPort: number
  imapSecurity: 'ssl' | 'starttls' | 'none'
  imapUsername?: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: 'ssl' | 'starttls' | 'none'
  smtpUseSameCredentials: boolean
  smtpUsername?: string
  smtpPassword?: string
  imapLifecycleArchiveMailbox?: string
  imapLifecyclePendingReviewMailbox?: string
  imapLifecyclePendingDeleteMailbox?: string
  imapLifecycleTrashMailbox?: string
  syncWindowDays: number
} {
  if (!v || typeof v !== 'object') throw new Error('customMailbox: expected object')
  const o = v as Record<string, unknown>
  const emailRaw = typeof o.email === 'string' ? o.email.trim() : ''
  if (!emailRaw || emailRaw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    throw new Error('customMailbox.email: valid email required')
  }
  const displayName =
    typeof o.displayName === 'string' && o.displayName.trim()
      ? o.displayName.trim().slice(0, 200)
      : undefined
  const imapHost = assertHostLike(o.imapHost, 'imapHost')
  const smtpHost = assertHostLike(o.smtpHost, 'smtpHost')
  /** Default: same as IMAP (unless explicitly `false`). */
  const useSame = o.smtpUseSameCredentials !== false
  const imapUser =
    typeof o.imapUsername === 'string' && o.imapUsername.trim()
      ? o.imapUsername.trim().slice(0, 320)
      : undefined
  let smtpUser: string | undefined
  let smtpPass: string | undefined
  if (!useSame) {
    if (typeof o.smtpUsername !== 'string' || !o.smtpUsername.trim()) {
      throw new Error('customMailbox.smtpUsername required when not using same credentials as IMAP')
    }
    smtpUser = o.smtpUsername.trim().slice(0, 320)
    smtpPass = assertSecretString(o.smtpPassword, 'smtpPassword')
  }
  const lifeArchive = optionalImapLifecycleMailbox(o.imapLifecycleArchiveMailbox, 'imapLifecycleArchiveMailbox')
  const lifeReview = optionalImapLifecycleMailbox(o.imapLifecyclePendingReviewMailbox, 'imapLifecyclePendingReviewMailbox')
  const lifeDelete = optionalImapLifecycleMailbox(o.imapLifecyclePendingDeleteMailbox, 'imapLifecyclePendingDeleteMailbox')
  const lifeTrash = optionalImapLifecycleMailbox(o.imapLifecycleTrashMailbox, 'imapLifecycleTrashMailbox')
  let syncWindowDays = 30
  if (o.syncWindowDays !== undefined && o.syncWindowDays !== null) {
    const n = typeof o.syncWindowDays === 'number' ? o.syncWindowDays : parseInt(String(o.syncWindowDays).trim(), 10)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('customMailbox.syncWindowDays: expected non-negative integer')
    }
    syncWindowDays = n
  }
  return {
    ...(displayName ? { displayName } : {}),
    email: emailRaw,
    imapHost,
    imapPort: assertMailboxPort(o.imapPort, 'imapPort'),
    imapSecurity: assertSecurityMode(o.imapSecurity, 'imapSecurity'),
    ...(imapUser ? { imapUsername: imapUser } : {}),
    imapPassword: assertSecretString(o.imapPassword, 'imapPassword'),
    smtpHost,
    smtpPort: assertMailboxPort(o.smtpPort, 'smtpPort'),
    smtpSecurity: assertSecurityMode(o.smtpSecurity, 'smtpSecurity'),
    smtpUseSameCredentials: useSame,
    ...(smtpUser ? { smtpUsername: smtpUser } : {}),
    ...(smtpPass ? { smtpPassword: smtpPass } : {}),
    ...(lifeArchive ? { imapLifecycleArchiveMailbox: lifeArchive } : {}),
    ...(lifeReview ? { imapLifecyclePendingReviewMailbox: lifeReview } : {}),
    ...(lifeDelete ? { imapLifecyclePendingDeleteMailbox: lifeDelete } : {}),
    ...(lifeTrash ? { imapLifecycleTrashMailbox: lifeTrash } : {}),
    syncWindowDays,
  }
}
```

`assertSecretString` (max **512** chars for IMAP/SMTP secrets in preload):

```54:60:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\preload.ts
/** IMAP/SMTP passwords & app passwords (bounded for IPC). */
function assertSecretString(v: unknown, name: string, maxLen = 512): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) {
    throw new Error(`${name}: expected non-empty string (max ${maxLen} chars)`)
  }
  return v
}
```

IPC exposure:

```627:628:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\preload.ts
  connectCustomMailbox: (payload: unknown) =>
    ipcRenderer.invoke('email:connectCustomMailbox', assertCustomMailboxPayload(payload)),
```

| Check | Result |
|--------|--------|
| Password included | **Yes** — **`imapPassword`** required and forwarded |
| Name | **`imapPassword`** (matches wizard) |

---

## 3. IPC handler — `email:connectCustomMailbox` (`ipc.ts`)

**`listAccounts` handler** (for cross-reference with step 8):

```470:478:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\ipc.ts
  ipcMain.handle('email:listAccounts', async () => {
    try {
      const accounts = await emailGateway.listAccounts()
      return { ok: true, data: accounts }
    } catch (error: any) {
      console.error('[Email IPC] listAccounts error:', error)
      return { ok: false, error: error.message }
    }
  })
```

**`connectCustomMailbox` handler** — passes **`payload`** straight through to the gateway (no field remapping):

```832:848:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\ipc.ts
  /**
   * Custom mailbox: IMAP + SMTP (both required), separate connection tests in main.
   */
  ipcMain.handle('email:connectCustomMailbox', async (_e, payload: CustomImapSmtpConnectPayload) => {
    try {
      const account = await emailGateway.connectCustomImapSmtpAccount(payload)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'imap', email: account.email, accountId: account.id })
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectCustomMailbox error:', error)
      return { ok: false, error: error.message }
    }
  })
```

| Check | Result |
|--------|--------|
| Transform | **None** — `connectCustomImapSmtpAccount(payload)` |
| Password | Still under **`payload.imapPassword`** at this layer |

---

## 4. Gateway — `connectCustomImapSmtpAccount` (`gateway.ts`)

**Entire function** (as in repo):

```1168:1280:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async connectCustomImapSmtpAccount(payload: CustomImapSmtpConnectPayload): Promise<EmailAccountInfo> {
    validateCustomImapSmtpPayload(payload)
    /** Wizard / preload always send a number; normalize for API callers that omit the field. */
    const connectSyncWindowDays = normalizeNewAccountSyncWindowDays(payload.syncWindowDays)
    const email = payload.email.trim()
    const imapUser = (payload.imapUsername?.trim() || email).trim()
    const imapPass = payload.imapPassword.trim()
    const smtpUser = payload.smtpUseSameCredentials
      ? imapUser
      : (payload.smtpUsername?.trim() || '')
    const smtpPass = payload.smtpUseSameCredentials
      ? imapPass
      : (payload.smtpPassword?.trim() || '')
    if (!smtpUser) {
      throw new Error('SMTP username is missing.')
    }
    if (!smtpPass) {
      throw new Error('SMTP password is missing.')
    }

    const imapSecurity = normalizeSecurityMode(payload.imapSecurity, 'ssl')
    const smtpSecurity = normalizeSecurityMode(payload.smtpSecurity, 'starttls')

    const now = Date.now()
    const orchRemote = orchestratorRemoteFromImapLifecycleFields(payload)
    const draft: EmailAccountConfig = {
      id: '__custom_connect_probe__',
      displayName: (payload.displayName?.trim() || email),
      email,
      provider: 'imap',
      authType: 'password',
      imap: {
        host: payload.imapHost.trim(),
        port: payload.imapPort,
        security: imapSecurity,
        username: imapUser,
        password: imapPass
      },
      smtp: {
        host: payload.smtpHost.trim(),
        port: payload.smtpPort,
        security: smtpSecurity,
        username: smtpUser,
        password: smtpPass
      },
      folders: {
        monitored: ['INBOX', 'Spam'],
        inbox: 'INBOX',
        sent: 'Sent'
      },
      sync: newAccountSyncBlock(connectSyncWindowDays),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...(orchRemote ? { orchestratorRemote: orchRemote } : {})
    }

    /**
     * Probe on a **copy** of `imap`/`smtp` so `ImapProvider.connect` (`this.config = config`) never aliases
     * the object we will persist; also re-apply passwords from the wizard payload on the saved row so they
     * cannot be cleared by any probe-side mutation.
     */
    const probeDraft: EmailAccountConfig = {
      ...draft,
      imap: { ...draft.imap },
      smtp: draft.smtp ? { ...draft.smtp } : undefined,
    }

    /** Ephemeral probe only — never added to `this.providers`; first sync uses a new cached provider. */
    const imapProbe = new ImapProvider()
    const imapTest = await imapProbe.testConnection(probeDraft)
    if (!imapTest.success) {
      throw new Error(
        `IMAP check failed: ${imapTest.error || 'Could not connect or log in.'} Check IMAP host, port, security (SSL/TLS on 993 vs STARTTLS on 143), username, and password or app password.`
      )
    }

    const smtpTest = await ImapProvider.testSmtpConnection(probeDraft)
    if (!smtpTest.success) {
      throw new Error(
        `SMTP check failed: ${smtpTest.error || 'Could not connect or authenticate.'} IMAP succeeded. Verify SMTP host, port (often 587 + STARTTLS or 465 + SSL), security mode, and credentials.`
      )
    }

    const account: EmailAccountConfig = {
      ...draft,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      imap: { ...draft.imap, password: imapPass },
      smtp: draft.smtp ? { ...draft.smtp, password: smtpPass } : undefined,
    }
    this.accounts.push(account)
    console.error('[PERSIST-CHECK] About to save IMAP account:', {
      id: account.id,
      hasImapPassword: !!account.imap?.password,
      imapPasswordLength: account.imap?.password?.length ?? 0,
    })
    saveAccounts(this.accounts)

    const saved = this.accounts.find((a) => a.id === account.id)
    if (saved?.provider === 'imap' && (!saved.imap?.password || String(saved.imap.password).trim() === '')) {
      console.error('[CRITICAL] IMAP password was lost during save — restoring from connect payload')
      if (saved.imap) {
        saved.imap.password = imapPass
        if (saved.smtp) saved.smtp.password = smtpPass
      }
      saveAccounts(this.accounts)
    }

    console.log('[EmailGateway] Custom IMAP+SMTP account saved:', account.id, account.email)
    return this.toAccountInfo(account)
  }
```

**`draft.imap` object literal fields:** `host`, `port`, `security`, `username`, **`password`** (`imapPass`).

**`normalizeSecurityMode`** only affects **`security`** (see `domain/securityModeNormalize.ts`); it does not rebuild credentials.

**`this.accounts.push(account)`:** pushes the **`account`** object with **`imap.password`** and **`smtp.password`** set from **`imapPass` / `smtpPass`**.

**Password loss in this function:** No step removes `imapPass` before `saveAccounts`. If passwords were missing after save, the code path **`[CRITICAL] IMAP password was lost during save`** attempts to **restore from `imapPass`** and save again.

---

## 5. `saveAccounts` (`gateway.ts`)

```277:310:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
/**
 * Save accounts to disk with encryption of OAuth tokens.
 * Does **not** mutate the `accounts` array — in-memory rows keep plaintext IMAP/SMTP passwords after write.
 */
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
    
    // Encrypt OAuth tokens and IMAP/SMTP passwords before saving (encrypted snapshot only)
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

| Question | Answer |
|----------|--------|
| Calls `encryptImapSmtpPasswordsForDisk`? | **Yes** — per account in `encryptedAccounts` |
| Clone before encrypt? | **Yes** — `map` produces **new** array; each `encryptImapSmtpPasswordsForDisk` returns a **new** account object |
| Plaintext in memory after write? | **Comment + implementation:** **`accounts` argument is not replaced** — disk gets ciphertext in `encryptedAccounts`; **`this.accounts` in the gateway is unchanged** by `saveAccounts` |
| Encrypt in place on `this.accounts`? | **No** — only the **mapped** snapshot is written |

---

## 6. `encryptImapSmtpPasswordsForDisk` (`gateway.ts`)

```174:223:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
function encryptImapSmtpPasswordsForDisk(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap' || !account.imap) return account
  const encAvail = isSecureStorageAvailable()
  /** Never persist `undefined` — JSON.stringify omits it and the password would be lost on reload. */
  const imapPlain = String(account.imap.password ?? '')
  if (imapPlain.length === 0) {
    console.error('[Gateway] encryptImapSmtpPasswordsForDisk: IMAP password is empty for account', account.id)
  }
  const imapEncrypted = encryptValue(imapPlain)
  console.log(
    '[Gateway] IMAP encrypt: encAvail=',
    encAvail,
    'password length=',
    imapPlain.length,
    'encrypted length=',
    imapEncrypted.length,
  )
  const imap = {
    host: account.imap.host,
    port: account.imap.port,
    security: account.imap.security,
    username: account.imap.username,
    password: imapEncrypted,
    _encrypted: encAvail,
  }
  const smtpPlain = account.smtp ? String(account.smtp.password ?? '') : ''
  const smtpEncrypted = account.smtp ? encryptValue(smtpPlain) : ''
  if (account.smtp) {
    console.log(
      '[Gateway] SMTP encrypt: encAvail=',
      encAvail,
      'password length=',
      smtpPlain.length,
      'encrypted length=',
      smtpEncrypted.length,
    )
  }
  const smtp = account.smtp
    ? {
        host: account.smtp.host,
        port: account.smtp.port,
        security: account.smtp.security,
        username: account.smtp.username,
        password: smtpEncrypted,
        _encrypted: encAvail,
      }
    : undefined
  /** Disk snapshot only — never assign this return value onto `this.accounts` (memory stays plaintext). */
  return { ...account, imap, smtp }
}
```

**`encryptValue` when `isSecureStorageAvailable()` is false** (`secure-storage.ts`):

```38:52:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\secure-storage.ts
export function encryptValue(plaintext: string | undefined | null): string {
  const p = plaintext ?? ''
  if (!isSecureStorageAvailable()) {
    console.warn('[SecureStorage] Encryption not available, storing unencrypted')
    return p
  }

  try {
    const encrypted = safeStorage.encryptString(p)
    return encrypted.toString('base64')
  } catch (err) {
    console.error('[SecureStorage] Encryption failed:', err)
    return p
  }
}
```

| Check | Result |
|--------|--------|
| Returns new object or mutates input? | **Returns new object:** `{ ...account, imap, smtp }` |
| If secure storage false | **`password` on disk is still a string** (plaintext); **`_encrypted`** is **`false`** (see `encAvail`) |

---

## 7. `loadAccounts` + `decryptImapSmtpPasswords` (`gateway.ts`)

**Load path:**

```238:275:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
function loadAccounts(): EmailAccountConfig[] {
  try {
    const accountsPath = getAccountsPath()
    console.log('[EmailGateway] Loading accounts from:', accountsPath)
    console.log('[EmailGateway] Secure storage available:', isSecureStorageAvailable())
    
    if (fs.existsSync(accountsPath)) {
      const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      const accounts = data.accounts || []
      console.log('[EmailGateway] Loaded', accounts.length, 'accounts from disk')
      
      // Decrypt OAuth tokens and IMAP/SMTP passwords for each account
      return accounts.map((account: EmailAccountConfig) => {
        let next: EmailAccountConfig = account
        if (account.oauth) {
          try {
            const decrypted = decryptOAuthTokens(account.oauth as any)
            next = { ...next, oauth: decrypted }
          } catch (err) {
            console.error('[EmailGateway] Failed to decrypt tokens for account:', account.id, err)
            next = {
              ...account,
              oauth: undefined,
              status: 'error' as const,
              lastError: 'Failed to decrypt stored credentials. Please reconnect.'
            }
          }
        }
        return decryptImapSmtpPasswords(next)
      })
    } else {
      console.log('[EmailGateway] No accounts file found, starting fresh')
    }
  } catch (err) {
    console.error('[EmailGateway] Error loading accounts:', err)
  }
  return []
}
```

**`decryptImapSmtpPasswords`** (full):

```98:163:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
function decryptImapSmtpPasswords(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap') return account
  let next: EmailAccountConfig = { ...account }
  if (next.imap && isDiskEncryptedPasswordFlag(next.imap._encrypted)) {
    try {
      const plain = decryptValue(next.imap.password)
      console.log(
        '[Gateway] IMAP decrypt: _encrypted=',
        next.imap._encrypted,
        'decrypted length=',
        plain.length,
      )
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
  if (next.smtp && isDiskEncryptedPasswordFlag(next.smtp._encrypted)) {
    try {
      const plain = decryptValue(next.smtp.password)
      console.log(
        '[Gateway] SMTP decrypt: _encrypted=',
        next.smtp._encrypted,
        'decrypted length=',
        plain.length,
      )
      next = {
        ...next,
        smtp: {
          host: next.smtp.host,
          port: next.smtp.port,
          security: next.smtp.security,
          username: next.smtp.username,
          password: plain,
          _encrypted: false,
        },
      }
    } catch (err) {
      console.error('[EmailGateway] Failed to decrypt SMTP password for account:', account.id, err)
      return {
        ...next,
        status: 'error',
        lastError: 'Failed to decrypt stored SMTP credentials. Please remove the account and connect again.',
        smtp: next.smtp ? { ...next.smtp, password: '', _encrypted: false } : undefined,
      }
    }
  }
  return next
}
```

**`isDiskEncryptedPasswordFlag`:**

```93:96:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
/** Disk JSON may use boolean `true` or a mistaken string `"true"` — both mean "password field is sealed for disk". */
function isDiskEncryptedPasswordFlag(v: unknown): boolean {
  return v === true || v === 'true'
}
```

**Implication:** If the file has **`_encrypted: false`** (plaintext password on disk), **`decryptImapSmtpPasswords`** does **not** enter the branch that calls **`decryptValue`**; the **`password` string** loaded from JSON remains as-is in memory.

If **`_encrypted`** is **true** but decryption fails, **`password`** is cleared to **`''`** and status becomes **`error`**.

---

## 8. `listAccounts` IPC / `toAccountInfo` — why `imap.password` is never returned

**Gateway `listAccounts`:**

```328:330:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  async listAccounts(): Promise<EmailAccountInfo[]> {
    return this.accounts.map(acc => this.toAccountInfo(acc))
  }
```

**`toAccountInfo`:**

```1520:1549:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
  private toAccountInfo(account: EmailAccountConfig): EmailAccountInfo {
    const defaultFolders = getFoldersForAccountOperation(account, undefined)
    return {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      provider: account.provider,
      status: account.status,
      lastError: account.lastError,
      lastSyncAt: account.lastSyncAt,
      folders: {
        monitored: defaultFolders.monitored,
        inbox: defaultFolders.inbox,
      },
      capabilities: getProviderAccountCapabilities(account),
      mailboxes: resolveMailboxesForAccount(account).map((s) => ({
        mailboxId: s.mailboxId,
        label: s.label,
        isDefault: s.isDefault,
        providerMailboxResourceRef: s.providerMailboxResourceRef,
      })),
      sync: {
        /** 0 = full history window for orchestrator (matches syncOrchestrator default). */
        maxAgeDays: account.sync?.maxAgeDays ?? 0,
        batchSize: account.sync?.batchSize ?? 50,
        syncWindowDays: typeof account.sync?.syncWindowDays === 'number' ? account.sync.syncWindowDays : 30,
        maxMessagesPerPull: typeof account.sync?.maxMessagesPerPull === 'number' ? account.sync.maxMessagesPerPull : 500,
      },
    }
  }
```

**`EmailAccountInfo` type** explicitly excludes credentials:

```393:422:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\types.ts
/**
 * Safe subset of account config for UI / IPC
 * (excludes sensitive credentials).
 */
export interface EmailAccountInfo {
  id: string
  displayName: string
  email: string
  provider: EmailProvider
  status: 'active' | 'error' | 'disabled' | 'auth_error'
  lastError?: string
  lastSyncAt?: number
  folders: {
    monitored: string[]
    inbox: string
  }
  /** Derived capability flags (OAuth vs password + provider features). */
  capabilities?: ProviderAccountCapabilities
  /** Resolved mailbox/postbox slices for this row (always ≥1: implicit default or explicit `mailboxes`). */
  mailboxes?: EmailAccountMailboxSummary[]

  /** Sync window / batch prefs (no secrets) — used by inbox sync orchestrator. */
  sync?: {
    maxAgeDays: number
    batchSize: number
    /** Smart Sync window days (0 = all mail). */
    syncWindowDays?: number
    maxMessagesPerPull?: number
  }
}
```

### >>> PASSWORD LOST HERE (for `listAccounts` / `getAccount` consumers) <<<

**Not “lost from disk” — never included in the IPC response shape.** Any check of **`listAccounts()` → `data[i].imap.password`** will be **`undefined`** because **`EmailAccountInfo` has no `imap` property** and **`toAccountInfo` does not copy passwords.**

The intended way to surface “password present in main memory” without sending the secret is **`getImapReconnectHints`**:

```505:534:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\gateway.ts
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
      syncWindowDays:
        typeof account.sync?.syncWindowDays === 'number' ? account.sync.syncWindowDays : undefined,
    }
  }
```

---

## Appendix: `validateCustomImapSmtpPayload` (gateway validation only)

```27:63:c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code\apps\electron-vite-project\electron\main\email\domain\customImapSmtpPayloadValidation.ts
export function validateCustomImapSmtpPayload(p: CustomImapSmtpConnectPayload): void {
  const email = p.email?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }
  const imapHost = p.imapHost?.trim()
  if (!imapHost || imapHost.length > 253) {
    throw new Error('IMAP server host is required (for example imap.example.com).')
  }
  assertPort(p.imapPort, 'IMAP')
  const smtpHost = p.smtpHost?.trim()
  if (!smtpHost || smtpHost.length > 253) {
    throw new Error('SMTP server host is required (for example smtp.example.com).')
  }
  assertPort(p.smtpPort, 'SMTP')
  if (!p.imapPassword?.trim()) {
    throw new Error('IMAP password (or app password) is required.')
  }
  if (!p.smtpUseSameCredentials) {
    if (!p.smtpUsername?.trim()) {
      throw new Error('SMTP username is required when it is not the same as IMAP.')
    }
    if (!p.smtpPassword?.trim()) {
      throw new Error('SMTP password is required when it is not the same as IMAP.')
    }
  }
  assertOptionalImapLifecycleMailbox(p.imapLifecycleArchiveMailbox, 'Archive mailbox name')
  assertOptionalImapLifecycleMailbox(p.imapLifecyclePendingReviewMailbox, 'Pending review mailbox name')
  assertOptionalImapLifecycleMailbox(p.imapLifecyclePendingDeleteMailbox, 'Pending delete mailbox name')
  assertOptionalImapLifecycleMailbox(p.imapLifecycleTrashMailbox, 'Trash mailbox name')
  if (p.syncWindowDays != null) {
    const d = Number(p.syncWindowDays)
    if (!Number.isInteger(d) || d < 0) {
      throw new Error('Sync window must be 0 (all mail) or a positive number of days.')
    }
  }
}
```

---

## How to verify persistence vs. API shape

| Question | Where to look |
|----------|----------------|
| Did the password reach main? | Logs: **`[PERSIST-CHECK]`** / **`[Gateway] IMAP encrypt`** around connect |
| What is on disk? | **`app.getPath('userData')/email-accounts.json`** — `imap.password` should be **non-empty** (ciphertext base64 if `_encrypted: true`, or plaintext if not) |
| Why `listAccounts` has no `imap` | **`EmailAccountInfo`** + **`toAccountInfo`** — **by design** |
| Password present without exposing it? | **`getImapReconnectHints`** → **`hasImapPassword`** |
