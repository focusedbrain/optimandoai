/**
 * Base Email Provider
 * 
 * Abstract interface that all email providers must implement.
 * This provides a common abstraction over Gmail, Microsoft Graph, and IMAP.
 */

import { 
  EmailAccountConfig,
  MessageSearchOptions,
  SendEmailPayload,
  SendResult
} from '../types'

/**
 * Raw email message from provider (before sanitization)
 */
export interface RawEmailMessage {
  id: string
  threadId?: string
  subject: string
  from: { email: string; name?: string }
  to: Array<{ email: string; name?: string }>
  cc?: Array<{ email: string; name?: string }>
  replyTo?: { email: string; name?: string }
  date: Date
  bodyHtml?: string
  bodyText?: string
  flags: {
    seen: boolean
    flagged: boolean
    answered: boolean
    draft: boolean
    deleted: boolean
  }
  labels: string[]
  folder: string
  headers?: {
    messageId?: string
    inReplyTo?: string
    references?: string[]
  }
}

/**
 * Raw attachment from provider (before sanitization)
 */
export interface RawAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  contentId?: string
  isInline: boolean
}

/**
 * Folder/mailbox information
 */
export interface FolderInfo {
  name: string
  path: string
  delimiter: string
  flags: string[]
  totalMessages: number
  unreadMessages: number
}

/**
 * Base email provider interface
 * All providers (Gmail, IMAP, Microsoft) implement this interface.
 */
export interface IEmailProvider {
  /**
   * Provider type identifier
   */
  readonly providerType: 'gmail' | 'microsoft365' | 'imap'
  
  /**
   * Connect to the email server
   * @param config - Account configuration with credentials
   */
  connect(config: EmailAccountConfig): Promise<void>
  
  /**
   * Disconnect from the email server
   */
  disconnect(): Promise<void>
  
  /**
   * Check if currently connected
   */
  isConnected(): boolean
  
  /**
   * Test connection without fully connecting
   */
  testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }>
  
  /**
   * List available folders/mailboxes
   */
  listFolders(): Promise<FolderInfo[]>
  
  /**
   * Fetch messages from a folder
   * @param folder - Folder path (e.g., 'INBOX')
   * @param options - Search and filter options
   */
  fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]>
  
  /**
   * Fetch a single message with full body
   * @param messageId - Message ID
   */
  fetchMessage(messageId: string): Promise<RawEmailMessage | null>
  
  /**
   * List attachments for a message
   * @param messageId - Message ID
   */
  listAttachments(messageId: string): Promise<RawAttachment[]>
  
  /**
   * Fetch attachment content
   * @param messageId - Message ID
   * @param attachmentId - Attachment ID
   */
  fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer | null>
  
  /**
   * Mark a message as read
   * @param messageId - Message ID
   */
  markAsRead(messageId: string): Promise<void>
  
  /**
   * Mark a message as unread
   * @param messageId - Message ID
   */
  markAsUnread(messageId: string): Promise<void>
  
  /**
   * Set/unset flagged status
   * @param messageId - Message ID
   * @param flagged - Whether to flag or unflag
   */
  setFlagged(messageId: string, flagged: boolean): Promise<void>
  
  /**
   * Send an email
   * @param payload - Email content
   */
  sendEmail(payload: SendEmailPayload): Promise<SendResult>
  
  /**
   * Get the current sync token/state for incremental sync
   */
  getSyncState?(): Promise<string | null>
  
  /**
   * Fetch new messages since last sync
   * @param folder - Folder path
   * @param syncState - Previous sync state
   */
  fetchNewMessages?(folder: string, syncState?: string): Promise<{
    messages: RawEmailMessage[]
    newSyncState: string
  }>
}

/**
 * Token refresh callback type
 * Called when OAuth tokens are refreshed so they can be persisted
 */
export type TokenRefreshCallback = (newTokens: {
  accessToken: string
  refreshToken: string
  expiresAt: number
}) => void

/**
 * Base implementation with common helper methods
 */
export abstract class BaseEmailProvider implements IEmailProvider {
  abstract readonly providerType: 'gmail' | 'microsoft365' | 'imap'
  
  protected connected: boolean = false
  protected config: EmailAccountConfig | null = null
  
  /**
   * Optional callback for when OAuth tokens are refreshed
   * Set by the gateway to persist new tokens to disk
   */
  public onTokenRefresh?: TokenRefreshCallback
  
  abstract connect(config: EmailAccountConfig): Promise<void>
  abstract disconnect(): Promise<void>
  abstract testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }>
  abstract listFolders(): Promise<FolderInfo[]>
  abstract fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]>
  abstract fetchMessage(messageId: string): Promise<RawEmailMessage | null>
  abstract listAttachments(messageId: string): Promise<RawAttachment[]>
  abstract fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer | null>
  abstract markAsRead(messageId: string): Promise<void>
  abstract markAsUnread(messageId: string): Promise<void>
  abstract setFlagged(messageId: string, flagged: boolean): Promise<void>
  abstract sendEmail(payload: SendEmailPayload): Promise<SendResult>
  
  isConnected(): boolean {
    return this.connected
  }
  
  /**
   * Helper: Parse email address string "Name <email@domain.com>" 
   */
  protected parseEmailAddress(addr: string): { email: string; name?: string } {
    if (!addr) return { email: '' }
    
    // Try to match "Name <email>" format
    const match = addr.match(/^([^<]*)<([^>]+)>$/)
    if (match) {
      const name = match[1].trim().replace(/^["']|["']$/g, '')
      const email = match[2].trim().toLowerCase()
      return name ? { email, name } : { email }
    }
    
    // Just an email address
    return { email: addr.trim().toLowerCase() }
  }
  
  /**
   * Helper: Parse multiple email addresses from a header value
   */
  protected parseEmailAddresses(headerValue: string): Array<{ email: string; name?: string }> {
    if (!headerValue) return []
    
    // Split by comma, but be careful of commas in quoted names
    const addresses: string[] = []
    let current = ''
    let inQuotes = false
    
    for (const char of headerValue) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          addresses.push(current.trim())
        }
        current = ''
        continue
      }
      current += char
    }
    
    if (current.trim()) {
      addresses.push(current.trim())
    }
    
    return addresses.map(addr => this.parseEmailAddress(addr))
  }
  
  /**
   * Helper: Convert date to ISO string
   */
  protected formatDate(date: Date | string | number): string {
    if (date instanceof Date) {
      return date.toISOString()
    }
    if (typeof date === 'number') {
      return new Date(date).toISOString()
    }
    return new Date(date).toISOString()
  }
}

