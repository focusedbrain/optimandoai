/**
 * Email Gateway Types
 * 
 * Core types for the secure email pipeline.
 * These types ensure type safety and consistent data structures
 * across the email gateway, MCP tools, and UI.
 */

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Supported email providers
 */
export type EmailProvider = 
  | 'gmail'           // Google Gmail (OAuth2)
  | 'microsoft365'    // Microsoft 365 / Outlook.com (OAuth2)
  | 'imap'            // Generic IMAP provider

/**
 * Authentication type for email accounts
 */
export type AuthType = 
  | 'oauth2'          // OAuth2 (Gmail, Microsoft)
  | 'password'        // Username/password (IMAP)
  | 'app_password'    // App-specific password

/**
 * Connection security mode
 */
export type SecurityMode = 
  | 'ssl'             // SSL/TLS on connect
  | 'starttls'        // STARTTLS upgrade
  | 'none'            // No encryption (not recommended)

/**
 * Known IMAP provider presets
 */
export interface ImapPreset {
  name: string
  host: string
  port: number
  security: SecurityMode
  smtpHost?: string
  smtpPort?: number
}

/**
 * Built-in IMAP presets for common providers
 */
export const IMAP_PRESETS: Record<string, ImapPreset> = {
  'web.de': {
    name: 'WEB.DE',
    host: 'imap.web.de',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.web.de',
    smtpPort: 587
  },
  'gmx.de': {
    name: 'GMX',
    host: 'imap.gmx.net',
    port: 993,
    security: 'ssl',
    smtpHost: 'mail.gmx.net',
    smtpPort: 587
  },
  'gmx.com': {
    name: 'GMX (International)',
    host: 'imap.gmx.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'mail.gmx.com',
    smtpPort: 587
  },
  't-online.de': {
    name: 'T-Online',
    host: 'secureimap.t-online.de',
    port: 993,
    security: 'ssl',
    smtpHost: 'securesmtp.t-online.de',
    smtpPort: 465
  },
  'yahoo.com': {
    name: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 587
  },
  'icloud.com': {
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587
  },
  'aol.com': {
    name: 'AOL Mail',
    host: 'imap.aol.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.aol.com',
    smtpPort: 587
  },
  'gmail.com': {
    name: 'Gmail (App Password)',
    host: 'imap.gmail.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587
  },
  'outlook.com': {
    name: 'Outlook.com / Hotmail',
    host: 'outlook.office365.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587
  },
  'office365': {
    name: 'Microsoft 365 (Work/School)',
    host: 'outlook.office365.com',
    port: 993,
    security: 'ssl',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587
  },
  'custom': {
    name: 'Custom IMAP',
    host: '',
    port: 993,
    security: 'ssl'
  }
}

// =============================================================================
// Account Configuration
// =============================================================================

/**
 * Email account configuration
 * Stored securely in the local database
 */
export interface EmailAccountConfig {
  /** Unique account identifier */
  id: string
  
  /** User-friendly display name */
  displayName: string
  
  /** Email address */
  email: string
  
  /** Provider type */
  provider: EmailProvider
  
  /** Authentication type */
  authType: AuthType
  
  /** OAuth tokens (for gmail/microsoft365) */
  oauth?: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scope: string
  }
  
  /** IMAP credentials (for imap provider) */
  imap?: {
    host: string
    port: number
    security: SecurityMode
    username: string
    password: string  // Encrypted at rest
  }
  
  /** SMTP settings for sending (optional) */
  smtp?: {
    host: string
    port: number
    security: SecurityMode
    username: string
    password: string  // Encrypted at rest
  }
  
  /** Folder/label configuration */
  folders: {
    /** Folders to monitor for new emails */
    monitored: string[]
    /** Default folder for inbox (usually 'INBOX') */
    inbox: string
    /** Sent folder name */
    sent?: string
  }
  
  /** Sync settings */
  sync: {
    /** Only fetch emails from the last N days */
    maxAgeDays: number
    /** Whether to auto-analyze PDF attachments */
    analyzePdfs: boolean
    /** Maximum emails to fetch per sync */
    batchSize: number
  }
  
  /** Account status */
  status: 'active' | 'error' | 'disabled'
  
  /** Last error message if status is 'error' */
  lastError?: string
  
  /** Last successful sync timestamp */
  lastSyncAt?: number
  
  /** Created timestamp */
  createdAt: number
  
  /** Updated timestamp */
  updatedAt: number
}

/**
 * Safe subset of account config for UI display
 * (excludes sensitive credentials)
 */
export interface EmailAccountInfo {
  id: string
  displayName: string
  email: string
  provider: EmailProvider
  status: 'active' | 'error' | 'disabled'
  lastError?: string
  lastSyncAt?: number
  folders: {
    monitored: string[]
    inbox: string
  }
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Email flags/labels
 */
export interface EmailFlags {
  seen: boolean
  flagged: boolean
  answered: boolean
  draft: boolean
  deleted: boolean
  /** Custom labels/tags (Gmail labels, IMAP keywords) */
  labels: string[]
}

/**
 * Sanitized email message (list view)
 * Contains only safe, sanitized data for UI display
 */
export interface SanitizedMessage {
  /** Message ID (unique within account) */
  id: string
  
  /** Thread/conversation ID */
  threadId?: string
  
  /** Account this message belongs to */
  accountId: string
  
  /** Email subject (sanitized) */
  subject: string
  
  /** Sender address and name */
  from: {
    email: string
    name?: string
  }
  
  /** Recipients */
  to: Array<{
    email: string
    name?: string
  }>
  
  /** CC recipients */
  cc?: Array<{
    email: string
    name?: string
  }>
  
  /** Message date */
  date: string
  
  /** Date as timestamp */
  timestamp: number
  
  /** Short preview snippet (sanitized, ~100 chars) */
  snippet: string
  
  /** Message flags */
  flags: EmailFlags
  
  /** Whether message has attachments */
  hasAttachments: boolean
  
  /** Number of attachments */
  attachmentCount: number
  
  /** Folder/mailbox this message is in */
  folder: string
}

/**
 * Sanitized email message with full body (detail view)
 * Body is always sanitized - no raw HTML or dangerous content
 */
export interface SanitizedMessageDetail extends SanitizedMessage {
  /** Full sanitized body text (plain text only) */
  bodyText: string
  
  /** Optional: Safe HTML subset (heavily sanitized) */
  bodySafeHtml?: string
  
  /** Reply-to address if different from from */
  replyTo?: {
    email: string
    name?: string
  }
  
  /** Message headers (selected safe ones) */
  headers?: {
    messageId?: string
    inReplyTo?: string
    references?: string[]
  }
}

// =============================================================================
// Attachment Types
// =============================================================================

/**
 * Attachment metadata
 * Never contains actual binary data in the UI layer
 */
export interface AttachmentMeta {
  /** Attachment ID (unique within message) */
  id: string
  
  /** File name */
  filename: string
  
  /** MIME type */
  mimeType: string
  
  /** File size in bytes */
  size: number
  
  /** Content ID (for inline images) */
  contentId?: string
  
  /** Whether this is an inline attachment */
  isInline: boolean
  
  /** Whether text extraction is supported (PDFs, docs) */
  isTextExtractable: boolean
}

/**
 * Extracted text from an attachment
 */
export interface ExtractedAttachmentText {
  /** Attachment ID */
  attachmentId: string
  
  /** Extracted plain text */
  text: string
  
  /** Number of pages (for PDFs) */
  pageCount?: number
  
  /** Extraction warnings/notes */
  warnings?: string[]
}

// =============================================================================
// Operation Types
// =============================================================================

/**
 * Message search/filter options
 */
export interface MessageSearchOptions {
  /** Folder to search in (default: all monitored) */
  folder?: string
  
  /** Maximum results to return */
  limit?: number
  
  /** Offset for pagination */
  offset?: number
  
  /** Only return messages after this date */
  fromDate?: string
  
  /** Only return messages before this date */
  toDate?: string
  
  /** Full-text search query */
  search?: string
  
  /** Filter by sender email */
  from?: string
  
  /** Filter by subject contains */
  subject?: string
  
  /** Filter by unread only */
  unreadOnly?: boolean
  
  /** Filter by flagged only */
  flaggedOnly?: boolean
  
  /** Filter by has attachments */
  hasAttachments?: boolean
}

/**
 * Reply/send payload
 */
export interface SendEmailPayload {
  /** Recipients */
  to: string[]
  
  /** CC recipients */
  cc?: string[]
  
  /** BCC recipients */
  bcc?: string[]
  
  /** Email subject */
  subject: string
  
  /** Plain text body */
  bodyText: string
  
  /** Message ID being replied to (for threading) */
  inReplyTo?: string
  
  /** Reference message IDs (for threading) */
  references?: string[]
}

/**
 * Send operation result
 */
export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
}

// =============================================================================
// Sync/Event Types
// =============================================================================

/**
 * Email sync status
 */
export interface SyncStatus {
  accountId: string
  status: 'idle' | 'syncing' | 'error'
  lastSyncAt?: number
  nextSyncAt?: number
  error?: string
  progress?: {
    current: number
    total: number
    folder: string
  }
}

/**
 * New email event (for triggers)
 */
export interface NewEmailEvent {
  type: 'new_email'
  accountId: string
  message: SanitizedMessage
  timestamp: number
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Email gateway error codes
 */
export type EmailErrorCode = 
  | 'AUTH_FAILED'           // Authentication failed
  | 'CONNECTION_FAILED'     // Could not connect to server
  | 'ACCOUNT_NOT_FOUND'     // Account ID not found
  | 'MESSAGE_NOT_FOUND'     // Message ID not found
  | 'ATTACHMENT_NOT_FOUND'  // Attachment ID not found
  | 'EXTRACTION_FAILED'     // PDF/text extraction failed
  | 'SEND_FAILED'           // Failed to send email
  | 'OAUTH_EXPIRED'         // OAuth token expired
  | 'RATE_LIMITED'          // Rate limited by provider
  | 'INVALID_CONFIG'        // Invalid account configuration
  | 'UNKNOWN_ERROR'         // Unknown error

/**
 * Email gateway error
 */
export interface EmailGatewayError {
  code: EmailErrorCode
  message: string
  details?: any
}

// =============================================================================
// Gateway Interface
// =============================================================================

/**
 * Email Gateway interface
 * This is the main abstraction for all email operations.
 * All methods return sanitized, safe data - never raw HTML or binary.
 */
export interface IEmailGateway {
  // Account management
  listAccounts(): Promise<EmailAccountInfo[]>
  getAccount(id: string): Promise<EmailAccountInfo | null>
  addAccount(config: Omit<EmailAccountConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<EmailAccountInfo>
  updateAccount(id: string, updates: Partial<EmailAccountConfig>): Promise<EmailAccountInfo>
  deleteAccount(id: string): Promise<void>
  testConnection(id: string): Promise<{ success: boolean; error?: string }>
  
  // Message operations
  listMessages(accountId: string, options?: MessageSearchOptions): Promise<SanitizedMessage[]>
  getMessage(accountId: string, messageId: string): Promise<SanitizedMessageDetail | null>
  markAsRead(accountId: string, messageId: string): Promise<void>
  markAsUnread(accountId: string, messageId: string): Promise<void>
  flagMessage(accountId: string, messageId: string, flagged: boolean): Promise<void>
  
  // Attachment operations
  listAttachments(accountId: string, messageId: string): Promise<AttachmentMeta[]>
  extractAttachmentText(accountId: string, messageId: string, attachmentId: string): Promise<ExtractedAttachmentText>
  
  // Send operations
  sendReply(accountId: string, messageId: string, payload: Omit<SendEmailPayload, 'inReplyTo' | 'references'>): Promise<SendResult>
  sendEmail(accountId: string, payload: SendEmailPayload): Promise<SendResult>
  
  // Sync operations
  syncAccount(accountId: string): Promise<SyncStatus>
  getSyncStatus(accountId: string): Promise<SyncStatus>
  
  // OAuth helpers
  getOAuthUrl(provider: 'gmail' | 'microsoft365'): string
  handleOAuthCallback(provider: 'gmail' | 'microsoft365', code: string): Promise<EmailAccountInfo>
}


