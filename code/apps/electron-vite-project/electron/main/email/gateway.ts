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
  SyncStatus
} from './types'
import { IEmailProvider, RawEmailMessage } from './providers/base'
import { GmailProvider, gmailProvider, saveOAuthConfig } from './providers/gmail'
import { ImapProvider } from './providers/imap'
import {
  sanitizeHtmlToText,
  sanitizeSubject,
  sanitizeEmailAddress,
  sanitizeDisplayName,
  generateSnippet
} from './sanitizer'
import { extractPdfText, isPdfFile, supportsTextExtraction } from './pdf-extractor'

/**
 * Storage file for email accounts
 */
function getAccountsPath(): string {
  return path.join(app.getPath('userData'), 'email-accounts.json')
}

/**
 * Load accounts from disk
 */
function loadAccounts(): EmailAccountConfig[] {
  try {
    const accountsPath = getAccountsPath()
    if (fs.existsSync(accountsPath)) {
      const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      return data.accounts || []
    }
  } catch (err) {
    console.error('[EmailGateway] Error loading accounts:', err)
  }
  return []
}

/**
 * Save accounts to disk
 */
function saveAccounts(accounts: EmailAccountConfig[]): void {
  try {
    const accountsPath = getAccountsPath()
    fs.writeFileSync(accountsPath, JSON.stringify({ accounts }, null, 2), 'utf-8')
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
  
  async addAccount(config: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<EmailAccountInfo> {
    const now = Date.now()
    const account: EmailAccountConfig = {
      ...config,
      id: generateId(),
      createdAt: now,
      updatedAt: now
    }
    
    // Validate and test connection
    const testResult = await this.testConnection(account.id)
    if (!testResult.success) {
      account.status = 'error'
      account.lastError = testResult.error
    }
    
    this.accounts.push(account)
    saveAccounts(this.accounts)
    
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
    
    const folder = options?.folder || account.folders.inbox
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
    
    // For plain text files
    if (attachment.mimeType.startsWith('text/')) {
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
        maxAgeDays: 30,
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
  async connectOutlookAccount(_displayName?: string): Promise<EmailAccountInfo> {
    // TODO: Implement Microsoft OAuth flow
    // For now, throw an informative error
    throw new Error('Microsoft 365/Outlook integration coming soon. Please use IMAP for now.')
  }
  
  /**
   * Connect IMAP account with credentials
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
        security: config.security,
        username: config.username,
        password: config.password
      } : undefined,
      folders: {
        monitored: ['INBOX'],
        inbox: 'INBOX',
        sent: 'Sent'
      },
      sync: {
        maxAgeDays: 30,
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
        // TODO: Implement Microsoft provider
        throw new Error('Microsoft 365 provider not yet implemented. Please use IMAP or Gmail.')
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
      await provider.connect(account)
      this.providers.set(account.id, provider)
    } else if (!provider.isConnected()) {
      await provider.connect(account)
    }
    
    return provider
  }
  
  private toAccountInfo(account: EmailAccountConfig): EmailAccountInfo {
    return {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      provider: account.provider,
      status: account.status,
      lastError: account.lastError,
      lastSyncAt: account.lastSyncAt,
      folders: {
        monitored: account.folders.monitored,
        inbox: account.folders.inbox
      }
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

