/**
 * Email Gateway Service
 * 
 * The main entry point for all email operations.
 * Provides a unified interface over multiple email providers.
 * All data returned is sanitized - no raw HTML or binary content.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID()
}
import {
  IEmailGateway,
  EmailAccountConfig,
  EmailAccountInfo,
  SanitizedMessage,
  SanitizedMessageDetail,
  AttachmentMeta,
  ExtractedAttachmentText,
  MessageSearchOptions,
  SendEmailPayload,
  SendResult,
  SyncStatus,
  CustomImapSmtpConnectPayload,
  type ImapLifecycleValidationResult,
  type ImapReconnectHints,
} from './types'
import { isLikelyEmailAuthError } from './emailAuthErrors'
import { IEmailProvider, RawEmailMessage } from './providers/base'
import { GmailProvider, gmailProvider, saveOAuthConfig } from './providers/gmail'
import { OutlookProvider, outlookProvider, saveOutlookOAuthConfig } from './providers/outlook'
import { ZohoProvider, zohoProvider } from './providers/zoho'
import { ImapProvider } from './providers/imap'
import { saveZohoOAuthConfig } from './credentials'
import {
  sanitizeHtmlToText,
  sanitizeSubject,
  sanitizeEmailAddress,
  sanitizeDisplayName,
  generateSnippet
} from './sanitizer'
import { extractPdfText, isPdfFile, supportsTextExtraction } from './pdf-extractor'
import { 
  encryptOAuthTokens, 
  decryptOAuthTokens, 
  isSecureStorageAvailable,
  encryptValue,
  decryptValue
} from './secure-storage'
import { getProviderAccountCapabilities } from './domain/capabilitiesRegistry'
import { getFoldersForAccountOperation, resolveMailboxesForAccount } from './domain/mailboxResolution'
import type {
  OrchestratorRemoteOperation,
  OrchestratorRemoteApplyResult,
  OrchestratorRemoteApplyContext,
} from './domain/orchestratorRemoteTypes'
import { orchestratorRemoteFromImapLifecycleFields } from './domain/mailboxLifecycleMapping'
import { validateCustomImapSmtpPayload } from './domain/customImapSmtpPayloadValidation'
import { normalizeSecurityMode } from './domain/securityModeNormalize'
import { emailDebugLog } from './emailDebug'

/** New-account sync defaults; `syncWindowDays` 0 = all mail, else clamp to a sane range. */
function normalizeNewAccountSyncWindowDays(syncWindowDays?: number): number {
  if (syncWindowDays === 0) return 0
  if (typeof syncWindowDays === 'number' && Number.isFinite(syncWindowDays)) {
    const d = Math.round(syncWindowDays)
    if (d === 0) return 0
    if (d > 0 && d <= 3650) return d
  }
  return 30
}

function newAccountSyncBlock(syncWindowDays?: number): NonNullable<EmailAccountConfig['sync']> {
  const days = normalizeNewAccountSyncWindowDays(syncWindowDays)
  return {
    maxAgeDays: 0,
    syncWindowDays: days,
    maxMessagesPerPull: 500,
    analyzePdfs: true,
    batchSize: 50,
  }
}

/** Disk JSON may use boolean `true` or a mistaken string `"true"` — both mean "password field is sealed for disk". */
function isDiskEncryptedPasswordFlag(v: unknown): boolean {
  return v === true || v === 'true'
}

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

function encryptImapSmtpPasswordsForDisk(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap' || !account.imap) return account
  const encAvail = isSecureStorageAvailable()
  /** Never persist `undefined` — JSON.stringify omits it and the password would be lost on reload. */
  const imapPlain = String(account.imap.password ?? '')
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
  return { ...account, imap, smtp }
}

/**
 * Storage file for email accounts
 */
function getAccountsPath(): string {
  const userData = app.getPath('userData')
  const accountsPath = path.join(userData, 'email-accounts.json')
  console.log('[EmailGateway] getAccountsPath() =', accountsPath)
  return accountsPath
}

/**
 * Load accounts from disk with decryption of OAuth tokens
 */
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

/**
 * Save accounts to disk with encryption of OAuth tokens
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

/**
 * Email Gateway Implementation
 */
class EmailGateway implements IEmailGateway {
  private providers: Map<string, IEmailProvider> = new Map()
  private accounts: EmailAccountConfig[] = []
  
  constructor() {
    this.accounts = loadAccounts()
    console.log(`[EmailGateway] Loaded ${this.accounts.length} accounts`)
  }
  
  // =================================================================
  // Account Management
  // =================================================================
  
  async listAccounts(): Promise<EmailAccountInfo[]> {
    return this.accounts.map(acc => this.toAccountInfo(acc))
  }
  
  async getAccount(id: string): Promise<EmailAccountInfo | null> {
    const account = this.accounts.find(a => a.id === id)
    return account ? this.toAccountInfo(account) : null
  }

  /** Full persisted config for connect (IMAP consolidation, diagnostics). */
  getAccountConfig(id: string): EmailAccountConfig | undefined {
    return this.accounts.find((a) => a.id === id)
  }

  /**
   * Synchronous provider lookup for use in DB paths (enqueue, deletion queue).
   * Throws if the account no longer exists — callers must catch and skip / abort;
   * never default to `imap` (would mis-route Graph/Gmail API calls).
   */
  getProviderSync(id: string): string {
    const account = this.accounts.find(a => a.id === id)
    if (!account) {
      throw new Error(`Account not found: ${id}`)
    }
    return account.provider
  }
  
  async addAccount(config: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<EmailAccountInfo> {
    const now = Date.now()
    const account: EmailAccountConfig = {
      ...config,
      id: generateId(),
      createdAt: now,
      updatedAt: now
    }
    
    // Add account first so testConnection can find it
    this.accounts.push(account)
    console.log('[EmailGateway] Added account:', account.id, account.email, account.provider)
    
    // Now test connection
    const testResult = await this.testConnection(account.id)
    if (!testResult.success) {
      console.log('[EmailGateway] Connection test failed:', testResult.error)
      account.status = 'error'
      account.lastError = testResult.error
    } else {
      console.log('[EmailGateway] Connection test successful')
      account.status = 'active'
    }
    
    saveAccounts(this.accounts)
    console.log('[EmailGateway] Saved', this.accounts.length, 'accounts')
    
    return this.toAccountInfo(account)
  }
  
  async updateAccount(id: string, updates: Partial<EmailAccountConfig>): Promise<EmailAccountInfo> {
    const index = this.accounts.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error('Account not found')
    }

    const prev = this.accounts[index]
    /** Pull nested creds out so we can merge — a bare `{ ...prev, ...updates }` replaces entire `imap`/`smtp`
     * and drops `password` whenever `updates.imap` omits it (partial spread from refactors / IPC). */
    const { imap: patchImap, smtp: patchSmtp, ...restUpdates } = updates
    const merged: EmailAccountConfig = {
      ...prev,
      ...restUpdates,
      id,
      updatedAt: Date.now(),
    }
    if (patchImap !== undefined) {
      merged.imap = prev.imap ? { ...prev.imap, ...patchImap } : patchImap
    }
    if (patchSmtp !== undefined) {
      merged.smtp = prev.smtp ? { ...prev.smtp, ...patchSmtp } : patchSmtp
    }

    this.accounts[index] = merged

    saveAccounts(this.accounts)
    
    // Disconnect existing provider if connected
    const provider = this.providers.get(id)
    if (provider) {
      await provider.disconnect()
      this.providers.delete(id)
    }
    
    return this.toAccountInfo(this.accounts[index])
  }

  /** Merge into existing `sync` without dropping analyzePdfs / batchSize. */
  async patchAccountSyncPreferences(
    id: string,
    partial: Partial<Pick<EmailAccountConfig['sync'], 'syncWindowDays' | 'maxMessagesPerPull' | 'maxAgeDays' | 'batchSize'>>,
  ): Promise<EmailAccountInfo> {
    const account = this.accounts.find((a) => a.id === id)
    if (!account) {
      throw new Error('Account not found')
    }
    const nextSync = { ...account.sync, ...partial }
    return this.updateAccount(id, { sync: nextSync })
  }
  
  async deleteAccount(id: string): Promise<void> {
    const index = this.accounts.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error('Account not found')
    }
    
    // Disconnect provider
    const provider = this.providers.get(id)
    if (provider) {
      await provider.disconnect()
      this.providers.delete(id)
    }
    
    this.accounts.splice(index, 1)
    saveAccounts(this.accounts)
  }
  
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

  // =================================================================
  // Message Operations
  // =================================================================
  
  // All providers (including IMAP) use getConnectedProvider → provider.fetchMessages.
  // IMAP uses UID SEARCH + UID FETCH (fetchMessagesSince), not seq.fetch + postFilter.
  async listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]> {
    const account = this.findAccount(accountId)
    const effectiveFolders = getFoldersForAccountOperation(account, options?.mailboxId)
    const folder = options?.folder ?? effectiveFolders.inbox
    const provider = await this.getConnectedProvider(account)
    const rawMessages = await provider.fetchMessages(folder, options)
    return rawMessages.map((raw) => this.sanitizeMessage(raw, accountId))
  }
  
  async getMessage(accountId: string, messageId: string): Promise<SanitizedMessageDetail | null> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    
    const raw = await provider.fetchMessage(messageId)
    if (!raw) return null
    
    return this.sanitizeMessageDetail(raw, accountId)
  }
  
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    await provider.markAsRead(messageId)
  }
  
  async markAsUnread(accountId: string, messageId: string): Promise<void> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    await provider.markAsUnread(messageId)
  }
  
  async flagMessage(accountId: string, messageId: string, flagged: boolean): Promise<void> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    await provider.setFlagged(messageId, flagged)
  }

  async deleteMessage(
    accountId: string,
    messageId: string,
    context?: OrchestratorRemoteApplyContext,
  ): Promise<void> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    if (typeof provider.deleteMessage === 'function') {
      await provider.deleteMessage(messageId, context)
    } else {
      throw new Error(`Provider ${account.provider} does not support message deletion`)
    }
  }

  /**
   * Mirror orchestrator lifecycle on the origin mailbox (best-effort).
   * Delegates to `provider.applyOrchestratorRemoteOperation` when implemented.
   */
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

  /**
   * Ensure a live provider session exists before draining remote orchestrator queue rows.
   * Avoids marking rows `processing` when IMAP/OAuth cannot connect (fail fast, terminal `failed`).
   *
   * **Timeout vs auth:** Uses an outer race longer than node-imap’s ~10s connect/auth timeouts so slow
   * servers (e.g. busy IMAP) are less likely to hit this cap. Handshake timeouts return a **non-auth**
   * message; real auth failures still use the “authentication” wording.
   */
  async ensureConnectedForOrchestratorOperation(
    accountId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) {
      return {
        ok: false,
        error: 'Account not found (disconnected or removed). Clear queue rows or reconnect.',
      }
    }
    const CONNECT_TIMEOUT_MS = 25_000
    try {
      await Promise.race([
        (async () => {
          const provider = await this.getConnectedProvider(account)
          if (typeof provider.isConnected === 'function' && !provider.isConnected()) {
            throw new Error('Not authenticated — provider session not connected.')
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Connection handshake timed out after ${CONNECT_TIMEOUT_MS}ms — server or network may be slow.`,
                ),
              ),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ])
      return { ok: true }
    } catch (e: any) {
      const msg = (e?.message || String(e)).slice(0, 500)
      const handshakeTimeout =
        /connection handshake timed out|handshake timed out/i.test(msg) ||
        /\bETIMEDOUT\b/i.test(msg)
      if (handshakeTimeout) {
        return {
          ok: false,
          error: `Mail server connection timed out (${msg}). Usually network or server slowness — not necessarily a wrong password.`,
        }
      }
      return { ok: false, error: `Account authentication failed — reconnect required (${msg})` }
    }
  }

  /**
   * Drop the cached provider and open a new session (used when IMAP/webmail closes idle connections
   * mid-drain). Does not change persisted account credentials.
   *
   * **Credentials:** Uses the current in-memory `EmailAccountConfig` from `this.accounts` — the same
   * object loaded at startup (with IMAP passwords decrypted by `loadAccounts`) or updated via
   * `updateAccount` / `updateImapCredentials`. Does **not** re-read `email-accounts.json` or re-run
   * decryption; if the file changed on disk while the app is running, restart (or reconnect through UI)
   * to pick up changes.
   */
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

  /**
   * True if a cached provider exists and reports connected (TCP may still be half-dead — use
   * {@link pingImapSessionWithListFolders} for a real round-trip before a drain batch).
   */
  isProviderSessionConnected(accountId: string): boolean {
    const p = this.providers.get(accountId)
    if (!p || typeof p.isConnected !== 'function') return false
    return p.isConnected()
  }

  /**
   * IMAP only: ensure session and run LIST (liveness probe). Does not force-reconnect on failure.
   * Other providers: no-op.
   */
  async pingImapSessionWithListFolders(accountId: string, timeoutMs: number = 15_000): Promise<void> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account || account.provider !== 'imap') return
    await Promise.race([
      (async () => {
        const provider = await this.getConnectedProvider(account)
        await provider.listFolders()
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('IMAP LIST ping timed out')), timeoutMs),
      ),
    ])
  }

  /**
   * After a successful reconnect during orchestrator drain, clear UI `error` state **without**
   * disconnecting the live provider (unlike `updateAccount`, which always disconnects).
   */
  clearOrchestratorTransientAccountError(accountId: string): void {
    const index = this.accounts.findIndex((a) => a.id === accountId)
    if (index === -1) return
    const acc = this.accounts[index]
    if (acc.status !== 'error') return
    this.accounts[index] = {
      ...acc,
      status: 'active',
      lastError: undefined,
      updatedAt: Date.now(),
    }
    saveAccounts(this.accounts)
    console.log('[EmailGateway] Cleared transient account error flag (orchestrator drain):', accountId)
  }

  // =================================================================
  // Attachment Operations
  // =================================================================
  
  async listAttachments(accountId: string, messageId: string): Promise<AttachmentMeta[]> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    
    const raw = await provider.listAttachments(messageId)
    
    return raw.map(att => ({
      id: att.id,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      contentId: att.contentId,
      isInline: att.isInline,
      isTextExtractable: supportsTextExtraction(att.mimeType)
    }))
  }
  
  async fetchAttachmentBuffer(
    accountId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer | null> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    return provider.fetchAttachment(messageId, attachmentId)
  }

  async extractAttachmentText(
    accountId: string, 
    messageId: string, 
    attachmentId: string
  ): Promise<ExtractedAttachmentText> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    
    // Get attachment metadata first
    const attachments = await provider.listAttachments(messageId)
    const attachment = attachments.find(a => a.id === attachmentId)
    
    if (!attachment) {
      throw new Error('Attachment not found')
    }
    
    if (!supportsTextExtraction(attachment.mimeType)) {
      throw new Error(`Text extraction not supported for ${attachment.mimeType}`)
    }
    
    // Fetch attachment content
    const buffer = await provider.fetchAttachment(messageId, attachmentId)
    if (!buffer) {
      throw new Error('Could not fetch attachment content')
    }
    
    // Extract text based on type
    if (isPdfFile(attachment.mimeType, attachment.filename)) {
      const result = await extractPdfText(buffer)
      return {
        attachmentId,
        text: result.text,
        pageCount: result.pageCount,
        warnings: result.warnings
      }
    }
    
    // For plain text and JSON-based files (incl. .beap capsules)
    if (
      attachment.mimeType.startsWith('text/') ||
      attachment.mimeType === 'application/json' ||
      attachment.mimeType === 'application/vnd.beap+json'
    ) {
      return {
        attachmentId,
        text: buffer.toString('utf-8')
      }
    }
    
    throw new Error(`Unsupported file type: ${attachment.mimeType}`)
  }
  
  // =================================================================
  // Send Operations
  // =================================================================
  
  async sendReply(
    accountId: string, 
    messageId: string, 
    payload: Omit<SendEmailPayload, 'inReplyTo' | 'references'>
  ): Promise<SendResult> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    
    // Get original message for threading
    const original = await provider.fetchMessage(messageId)
    if (!original) {
      return { success: false, error: 'Original message not found' }
    }
    
    const fullPayload: SendEmailPayload = {
      ...payload,
      inReplyTo: original.headers?.messageId,
      references: [
        ...(original.headers?.references || []),
        original.headers?.messageId
      ].filter(Boolean) as string[]
    }
    
    return provider.sendEmail(fullPayload)
  }
  
  async sendEmail(accountId: string, payload: SendEmailPayload): Promise<SendResult> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)
    return provider.sendEmail(payload)
  }
  
  // =================================================================
  // Sync Operations
  // =================================================================
  
  async syncAccount(accountId: string): Promise<SyncStatus> {
    const account = this.findAccount(accountId)
    
    try {
      const provider = await this.getConnectedProvider(account)
      
      // Just test connection for now
      const testResult = await provider.testConnection(account)
      
      if (testResult.success) {
        account.status = 'active'
        account.lastSyncAt = Date.now()
        account.lastError = undefined
      } else {
        account.status = 'error'
        account.lastError = testResult.error
      }
      
      saveAccounts(this.accounts)
      
      return {
        accountId,
        status: testResult.success ? 'idle' : 'error',
        lastSyncAt: account.lastSyncAt,
        error: account.lastError
      }
    } catch (err: any) {
      account.status = 'error'
      account.lastError = err.message
      saveAccounts(this.accounts)
      
      return {
        accountId,
        status: 'error',
        error: err.message
      }
    }
  }
  
  async getSyncStatus(accountId: string): Promise<SyncStatus> {
    const account = this.findAccount(accountId)
    
    return {
      accountId,
      status: account.status === 'active' ? 'idle' : 'error',
      lastSyncAt: account.lastSyncAt,
      error: account.lastError
    }
  }
  
  // =================================================================
  // OAuth Helpers
  // =================================================================
  
  getOAuthUrl(_provider: 'gmail' | 'microsoft365'): string {
    // This is handled by the provider's startOAuthFlow method
    throw new Error('Use startOAuthFlow instead')
  }
  
  async handleOAuthCallback(
    _provider: 'gmail' | 'microsoft365', 
    _code: string
  ): Promise<EmailAccountInfo> {
    // This is handled by the provider's startOAuthFlow method
    throw new Error('Use provider.startOAuthFlow instead')
  }
  
  /**
   * Set up Gmail OAuth credentials
   */
  setGmailOAuthCredentials(clientId: string, clientSecret: string): void {
    saveOAuthConfig(clientId, clientSecret)
  }
  
  /**
   * Start Gmail OAuth flow and create account
   */
  async connectGmailAccount(displayName?: string, syncWindowDays?: number): Promise<EmailAccountInfo> {
    const oauth = await gmailProvider.startOAuthFlow()

    /** `GET /gmail/v1/users/me/profile` — must not leave account.email empty in UI / dedupe. */
    const emailFromProfile = await gmailProvider.fetchProfileEmailAddress(oauth)
    
    // Create account config
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: displayName || 'Gmail Account',
      email: emailFromProfile,
      provider: 'gmail',
      authType: 'oauth2',
      oauth,
      folders: {
        monitored: ['INBOX'],
        inbox: 'INBOX',
        sent: 'SENT'
      },
      sync: newAccountSyncBlock(syncWindowDays),
      status: 'active'
    }
    
    return this.addAccount(account)
  }
  
  /**
   * Start Outlook/Microsoft 365 OAuth flow and create account
   */
  async connectOutlookAccount(displayName?: string, syncWindowDays?: number): Promise<EmailAccountInfo> {
    const { oauth, email } = await outlookProvider.startOAuthFlow()
    
    // Create account config
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: displayName || 'Outlook Account',
      email: email,
      provider: 'microsoft365',
      authType: 'oauth2',
      oauth,
      folders: {
        monitored: ['inbox'],
        inbox: 'inbox',
        sent: 'sentitems'
      },
      sync: newAccountSyncBlock(syncWindowDays),
      status: 'active'
    }
    
    return this.addAccount(account)
  }

  /**
   * Zoho Mail OAuth — same Smart Sync defaults as other API providers (30d / 500).
   */
  async connectZohoAccount(displayName?: string, syncWindowDays?: number): Promise<EmailAccountInfo> {
    const { oauth, email, folders, zohoDatacenter } = await zohoProvider.startOAuthFlow()
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: displayName || 'Zoho Mail',
      email: email || '',
      provider: 'zoho',
      authType: 'oauth2',
      oauth,
      zohoDatacenter,
      folders,
      sync: newAccountSyncBlock(syncWindowDays),
      status: 'active',
    }
    return this.addAccount(account)
  }
  
  /**
   * Set up Outlook OAuth credentials (Azure AD app)
   */
  setOutlookOAuthCredentials(clientId: string, clientSecret?: string): void {
    saveOutlookOAuthConfig(clientId, clientSecret)
  }

  /** Persist Zoho OAuth client credentials (plain file; wizard also uses {@link saveCredentials}). */
  setZohoOAuthCredentials(
    clientId: string,
    clientSecret: string,
    datacenter: 'com' | 'eu' = 'com',
  ): void {
    saveZohoOAuthConfig(clientId, clientSecret, datacenter)
  }
  
  /**
   * Connect IMAP (and optional SMTP) — legacy / API path. Prefer {@link connectCustomImapSmtpAccount}
   * for the full inbox+send setup (required IMAP + SMTP with separate security).
   */
  async connectImapAccount(config: {
    displayName: string
    email: string
    host: string
    port: number
    username: string
    password: string
    security: 'ssl' | 'starttls' | 'none'
    smtpHost?: string
    smtpPort?: number
    /** When SMTP is set, defaults to `security` if omitted. */
    smtpSecurity?: 'ssl' | 'starttls' | 'none'
    smtpUsername?: string
    smtpPassword?: string
    syncWindowDays?: number
  }): Promise<EmailAccountInfo> {
    // Create account config for IMAP
    const imapSecurity = normalizeSecurityMode(config.security, 'ssl')
    const smtpSecurityNorm = normalizeSecurityMode(config.smtpSecurity ?? config.security, imapSecurity)
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: config.displayName || config.email,
      email: config.email,
      provider: 'imap',
      authType: 'password',
      imap: {
        host: config.host,
        port: config.port,
        security: imapSecurity,
        username: config.username,
        password: config.password
      },
      smtp: config.smtpHost ? {
        host: config.smtpHost,
        port: config.smtpPort || 587,
        security: smtpSecurityNorm,
        username: config.smtpUsername ?? config.username,
        password: config.smtpPassword ?? config.password
      } : undefined,
      folders: {
        monitored: ['INBOX', 'Spam'],
        inbox: 'INBOX',
        sent: 'Sent'
      },
      sync: newAccountSyncBlock(config.syncWindowDays),
      status: 'active'
    }
    
    // Add account and test connection
    const addedAccount = await this.addAccount(account)
    
    // Test the connection
    const testResult = await this.testConnection(addedAccount.id)
    if (!testResult.success) {
      // Delete the account if connection fails
      await this.deleteAccount(addedAccount.id)
      throw new Error(`Connection failed: ${testResult.error}`)
    }
    
    return addedAccount
  }

  /**
   * Custom provider: inbound IMAP + outbound SMTP (both required). Runs separate connection tests
   * before persisting; passwords are sealed via the same disk encryption path as other accounts.
   */
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
    saveAccounts(this.accounts)
    console.log('[EmailGateway] Custom IMAP+SMTP account saved:', account.id, account.email)
    return this.toAccountInfo(account)
  }

  /**
   * LIST lifecycle-related mailboxes and try CREATE when missing (IMAP only).
   */
  async validateImapLifecycleRemote(
    accountId: string,
  ): Promise<
    { ok: true; result: ImapLifecycleValidationResult } | { ok: false; error: string }
  > {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) {
      return { ok: false, error: 'Account not found' }
    }
    if (account.provider !== 'imap') {
      return { ok: false, error: 'Only IMAP accounts support lifecycle mailbox validation.' }
    }
    const p = new ImapProvider()
    try {
      await p.connect(account)
      const result = await p.validateLifecycleRemoteBoxes()
      return { ok: true, result }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    } finally {
      try {
        await p.disconnect()
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * IMAP Pull: resolve `INBOX`/`Spam` labels to LIST paths, add Junk if discoverable, add direct INBOX.* children
   * (excluding lifecycle / legacy / standard anchors). Uses the live cached provider session.
   */
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

  /**
   * Before IMAP drain: LIST + CREATE missing canonical lifecycle folders (Archive, Pending *, Urgent, Trash).
   * Uses the live session — do not disconnect.
   */
  async ensureImapLifecycleFoldersForDrain(accountId: string): Promise<ImapLifecycleValidationResult> {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account || account.provider !== 'imap') {
      return { ok: true, entries: [] }
    }
    const provider = await this.getConnectedProvider(account)
    const fn = (provider as ImapProvider).validateLifecycleRemoteBoxes
    if (typeof fn !== 'function') {
      return {
        ok: false,
        entries: [
          {
            role: 'archive',
            mailbox: '',
            exists: false,
            error: 'IMAP provider does not support lifecycle validation',
          },
        ],
      }
    }
    return await fn.call(provider)
  }

  /**
   * Read-only remote folder list + STATUS counts + whether canonical lifecycle names exist (exact match; legacy ignored).
   */
  async verifyImapRemoteFolders(
    accountId: string,
  ): Promise<
    | {
        ok: true
        data: Awaited<ReturnType<ImapProvider['debugListRemoteMailboxesWithStatus']>>
      }
    | { ok: false; error: string }
  > {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) {
      return { ok: false, error: 'Account not found' }
    }
    if (account.provider !== 'imap') {
      return { ok: false, error: 'Only IMAP accounts support remote folder verify.' }
    }
    try {
      const provider = await this.getConnectedProvider(account)
      const fn = (provider as ImapProvider).debugListRemoteMailboxesWithStatus
      if (typeof fn !== 'function') {
        return { ok: false, error: 'Provider does not support remote folder verify.' }
      }
      const data = await fn.call(provider)
      return { ok: true, data }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }
  
  // =================================================================
  // Private Helpers
  // =================================================================
  
  private findAccount(id: string): EmailAccountConfig {
    const account = this.accounts.find(a => a.id === id)
    if (!account) {
      throw new Error('Account not found')
    }
    return account
  }
  
  private async getProvider(account: EmailAccountConfig): Promise<IEmailProvider> {
    switch (account.provider) {
      case 'gmail':
        return new GmailProvider()
      case 'microsoft365':
        return new OutlookProvider()
      case 'zoho':
        return new ZohoProvider()
      case 'imap':
        return new ImapProvider()
      default:
        throw new Error(`Unknown provider: ${account.provider}`)
    }
  }
  
  /**
   * Return a live provider for `account.id`, creating and connecting via `provider.connect(account)` if needed.
   *
   * **Config source:** The `account` object must be the in-memory row from `this.accounts` (plaintext
   * IMAP/SMTP passwords after `loadAccounts()` / connect flows). This method does **not** reload
   * accounts from disk; `saveAccounts()` only writes ciphertext to JSON and does not mutate `this.accounts`.
   */
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

      emailDebugLog('[IMAP-DEBUG] connect attempt:', {
        provider: account.provider,
        host: account.imap?.host,
        port: account.imap?.port,
        security: account.imap?.security,
        username: account.imap?.username,
        hasPassword: !!account.imap?.password,
        encrypted: account.imap?._encrypted,
      })
      await provider.connect(account)
      if (account.provider === 'imap') {
        console.log('[IMAP-PULL-TRACE] provider connected, isConnected:', provider.isConnected())
      }
      this.providers.set(account.id, provider)
    } else if (!provider.isConnected()) {
      emailDebugLog('[IMAP-DEBUG] connect attempt:', {
        provider: account.provider,
        host: account.imap?.host,
        port: account.imap?.port,
        security: account.imap?.security,
        username: account.imap?.username,
        hasPassword: !!account.imap?.password,
        encrypted: account.imap?._encrypted,
      })
      await provider.connect(account)
      if (account.provider === 'imap') {
        console.log('[IMAP-PULL-TRACE] provider connected, isConnected:', provider.isConnected())
      }
    }
    
    return provider
  }
  
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
  
  private sanitizeMessage(raw: RawEmailMessage, accountId: string): SanitizedMessage {
    const bodyText = raw.bodyText || sanitizeHtmlToText(raw.bodyHtml || '')
    
    return {
      id: raw.id,
      threadId: raw.threadId,
      accountId,
      subject: sanitizeSubject(raw.subject),
      from: {
        email: sanitizeEmailAddress(raw.from.email),
        name: raw.from.name ? sanitizeDisplayName(raw.from.name) : undefined
      },
      to: raw.to.map(addr => ({
        email: sanitizeEmailAddress(addr.email),
        name: addr.name ? sanitizeDisplayName(addr.name) : undefined
      })),
      cc: raw.cc?.map(addr => ({
        email: sanitizeEmailAddress(addr.email),
        name: addr.name ? sanitizeDisplayName(addr.name) : undefined
      })),
      date: this.formatDate(raw.date),
      timestamp: raw.date.getTime(),
      snippet: generateSnippet(bodyText),
      flags: {
        seen: raw.flags.seen,
        flagged: raw.flags.flagged,
        answered: raw.flags.answered,
        draft: raw.flags.draft,
        deleted: raw.flags.deleted,
        labels: raw.labels
      },
      hasAttachments: Boolean(
        raw.hasAttachments ?? ((raw.attachmentCount ?? 0) > 0),
      ),
      attachmentCount: Math.max(0, raw.attachmentCount ?? 0),
      folder: raw.folder
    }
  }
  
  private sanitizeMessageDetail(raw: RawEmailMessage, accountId: string): SanitizedMessageDetail {
    const base = this.sanitizeMessage(raw, accountId)
    
    // Extract and sanitize body
    let bodyText: string
    if (raw.bodyText) {
      bodyText = raw.bodyText
    } else if (raw.bodyHtml) {
      bodyText = sanitizeHtmlToText(raw.bodyHtml)
    } else {
      bodyText = ''
    }
    
    return {
      ...base,
      bodyText,
      replyTo: raw.replyTo ? {
        email: sanitizeEmailAddress(raw.replyTo.email),
        name: raw.replyTo.name ? sanitizeDisplayName(raw.replyTo.name) : undefined
      } : undefined,
      headers: {
        messageId: raw.headers?.messageId,
        inReplyTo: raw.headers?.inReplyTo,
        references: raw.headers?.references
      }
    }
  }
  
  private formatDate(date: Date): string {
    return date.toISOString()
  }
}

// Singleton instance
export const emailGateway = new EmailGateway()

