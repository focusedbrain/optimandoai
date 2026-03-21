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
  type ImapLifecycleValidationResult
} from './types'
import { IEmailProvider, RawEmailMessage } from './providers/base'
import { GmailProvider, gmailProvider, saveOAuthConfig } from './providers/gmail'
import { OutlookProvider, outlookProvider, saveOutlookOAuthConfig } from './providers/outlook'
import { ImapProvider } from './providers/imap'
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

function decryptImapSmtpPasswords(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap') return account
  let next: EmailAccountConfig = { ...account }
  if (next.imap && next.imap._encrypted === true) {
    try {
      next = {
        ...next,
        imap: {
          ...next.imap,
          password: decryptValue(next.imap.password)
        }
      }
    } catch (err) {
      console.error('[EmailGateway] Failed to decrypt IMAP password for account:', account.id, err)
      return {
        ...next,
        status: 'error',
        lastError: 'Failed to decrypt stored IMAP credentials. Please remove the account and connect again.',
        imap: next.imap ? { ...next.imap, password: '' } : undefined
      }
    }
  }
  if (next.smtp && next.smtp._encrypted === true) {
    try {
      next = {
        ...next,
        smtp: {
          ...next.smtp,
          password: decryptValue(next.smtp.password)
        }
      }
    } catch (err) {
      console.error('[EmailGateway] Failed to decrypt SMTP password for account:', account.id, err)
      return {
        ...next,
        status: 'error',
        lastError: 'Failed to decrypt stored SMTP credentials. Please remove the account and connect again.',
        smtp: next.smtp ? { ...next.smtp, password: '' } : undefined
      }
    }
  }
  return next
}

function encryptImapSmtpPasswordsForDisk(account: EmailAccountConfig): EmailAccountConfig {
  if (account.provider !== 'imap' || !account.imap) return account
  const encAvail = isSecureStorageAvailable()
  const imap = {
    ...account.imap,
    password: encryptValue(account.imap.password),
    _encrypted: encAvail
  }
  const smtp = account.smtp
    ? {
        ...account.smtp,
        password: encryptValue(account.smtp.password),
        _encrypted: encAvail
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
    
    try {
      const provider = await this.getProvider(account)
      const result = await provider.testConnection(account)
      
      // Update account status
      account.status = result.success ? 'active' : 'error'
      account.lastError = result.error
      account.updatedAt = Date.now()
      saveAccounts(this.accounts)
      
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
  
  // =================================================================
  // Message Operations
  // =================================================================
  
  async listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]> {
    const account = this.findAccount(accountId)
    const provider = await this.getConnectedProvider(account)

    const effectiveFolders = getFoldersForAccountOperation(account, options?.mailboxId)
    const folder = options?.folder ?? effectiveFolders.inbox
    const rawMessages = await provider.fetchMessages(folder, options)
    
    return rawMessages.map(raw => this.sanitizeMessage(raw, accountId))
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
    const CONNECT_TIMEOUT_MS = 15_000
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
            () => reject(new Error('Connection handshake timed out — reconnect required.')),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ])
      return { ok: true }
    } catch (e: any) {
      const msg = (e?.message || String(e)).slice(0, 500)
      return { ok: false, error: `Account authentication failed — reconnect required (${msg})` }
    }
  }

  /**
   * Drop the cached provider and open a new session (used when IMAP/webmail closes idle connections
   * mid-drain). Does not change persisted account credentials.
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
  async connectGmailAccount(displayName?: string): Promise<EmailAccountInfo> {
    const oauth = await gmailProvider.startOAuthFlow()
    
    // Get user email from Gmail API
    await gmailProvider.connect({ oauth } as any)
    
    // Create account config
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: displayName || 'Gmail Account',
      email: '', // Will be filled from API
      provider: 'gmail',
      authType: 'oauth2',
      oauth,
      folders: {
        monitored: ['INBOX'],
        inbox: 'INBOX',
        sent: 'SENT'
      },
      sync: {
        maxAgeDays: 0,
        analyzePdfs: true,
        batchSize: 50
      },
      status: 'active'
    }
    
    return this.addAccount(account)
  }
  
  /**
   * Start Outlook/Microsoft 365 OAuth flow and create account
   */
  async connectOutlookAccount(displayName?: string): Promise<EmailAccountInfo> {
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
      sync: {
        maxAgeDays: 0,
        analyzePdfs: true,
        batchSize: 50
      },
      status: 'active'
    }
    
    return this.addAccount(account)
  }
  
  /**
   * Set up Outlook OAuth credentials (Azure AD app)
   */
  setOutlookOAuthCredentials(clientId: string, clientSecret?: string): void {
    saveOutlookOAuthConfig(clientId, clientSecret)
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
  }): Promise<EmailAccountInfo> {
    // Create account config for IMAP
    const account: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      displayName: config.displayName || config.email,
      email: config.email,
      provider: 'imap',
      authType: 'password',
      imap: {
        host: config.host,
        port: config.port,
        security: config.security,
        username: config.username,
        password: config.password
      },
      smtp: config.smtpHost ? {
        host: config.smtpHost,
        port: config.smtpPort || 587,
        security: config.smtpSecurity ?? config.security,
        username: config.smtpUsername ?? config.username,
        password: config.smtpPassword ?? config.password
      } : undefined,
      folders: {
        monitored: ['INBOX', 'Spam'],
        inbox: 'INBOX',
        sent: 'Sent'
      },
      sync: {
        maxAgeDays: 0,
        analyzePdfs: true,
        batchSize: 50
      },
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
        security: payload.imapSecurity,
        username: imapUser,
        password: imapPass
      },
      smtp: {
        host: payload.smtpHost.trim(),
        port: payload.smtpPort,
        security: payload.smtpSecurity,
        username: smtpUser,
        password: smtpPass
      },
      folders: {
        monitored: ['INBOX', 'Spam'],
        inbox: 'INBOX',
        sent: 'Sent'
      },
      sync: {
        maxAgeDays: 0,
        analyzePdfs: true,
        batchSize: 50
      },
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...(orchRemote ? { orchestratorRemote: orchRemote } : {})
    }

    const imapProbe = new ImapProvider()
    const imapTest = await imapProbe.testConnection(draft)
    if (!imapTest.success) {
      throw new Error(
        `IMAP check failed: ${imapTest.error || 'Could not connect or log in.'} Check IMAP host, port, security (SSL/TLS on 993 vs STARTTLS on 143), username, and password or app password.`
      )
    }

    const smtpTest = await ImapProvider.testSmtpConnection(draft)
    if (!smtpTest.success) {
      throw new Error(
        `SMTP check failed: ${smtpTest.error || 'Could not connect or authenticate.'} IMAP succeeded. Verify SMTP host, port (often 587 + STARTTLS or 465 + SSL), security mode, and credentials.`
      )
    }

    const account: EmailAccountConfig = {
      ...draft,
      id: generateId(),
      createdAt: now,
      updatedAt: now
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
      case 'imap':
        return new ImapProvider()
      default:
        throw new Error(`Unknown provider: ${account.provider}`)
    }
  }
  
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
      hasAttachments: false, // Will be updated when we have attachment info
      attachmentCount: 0,
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

