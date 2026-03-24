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
  | 'zoho'            // Zoho Mail (OAuth2)
  | 'imap'            // Generic IMAP provider

/**
 * Authentication type for email accounts
 */
export type AuthType = 
  | 'oauth2'          // OAuth2 (Gmail, Microsoft, Zoho)
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
/**
 * Payload for “Custom email (IMAP + SMTP)” connect — both transports are required.
 * Validated in the main-process gateway before persistence.
 */
export interface CustomImapSmtpConnectPayload {
  displayName?: string
  email: string
  imapHost: string
  imapPort: number
  imapSecurity: SecurityMode
  /** If omitted, the gateway uses `email` as the IMAP login username. */
  imapUsername?: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: SecurityMode
  /** When true, SMTP uses the same username/password as IMAP. */
  smtpUseSameCredentials: boolean
  smtpUsername?: string
  smtpPassword?: string
  /** Optional lifecycle mailbox names — stored on the account as `orchestratorRemote` (see `mailboxLifecycleMapping`). */
  imapLifecycleArchiveMailbox?: string
  imapLifecyclePendingReviewMailbox?: string
  imapLifecyclePendingDeleteMailbox?: string
  imapLifecycleTrashMailbox?: string
  /** Initial inbox sync window in days; `0` = all mail (use with care). Default 30 when omitted. */
  syncWindowDays?: number
}

/** One row from IMAP lifecycle folder validation (`validateLifecycleRemoteBoxes` / IPC). */
export interface ImapLifecycleValidationEntry {
  role: 'archive' | 'pending_review' | 'pending_delete' | 'urgent' | 'trash'
  mailbox: string
  exists: boolean
  /** Set when the server had no mailbox but `CREATE` succeeded. */
  created?: boolean
  error?: string
}

export interface ImapLifecycleValidationResult {
  ok: boolean
  entries: ImapLifecycleValidationEntry[]
}

/**
 * Per-account overrides for remote lifecycle mirroring (labels / folders / IMAP mailboxes).
 * Merged with defaults in `domain/mailboxLifecycleMapping.ts` → `resolveOrchestratorRemoteNames`.
 */
export interface OrchestratorRemoteNamesInput {
  gmailPendingReviewLabel?: string
  gmailPendingDeleteLabel?: string
  gmailUrgentLabel?: string
  gmailArchiveRemoveLabelIds?: string[]
  outlookPendingReviewFolder?: string
  outlookPendingDeleteFolder?: string
  outlookUrgentFolder?: string
  zohoPendingReviewFolder?: string
  zohoPendingDeleteFolder?: string
  zohoUrgentFolder?: string
  zohoArchiveFolder?: string
  zohoTrashFolder?: string
  imapArchiveMailbox?: string
  imapPendingReviewMailbox?: string
  imapPendingDeleteMailbox?: string
  imapUrgentMailbox?: string
  imapTrashMailbox?: string
}

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
// Provider capabilities (derived; not stored per row except via authType + provider)
// =============================================================================

/**
 * What this **account row** can do, combining static provider implementation traits
 * with the row's `authType` (OAuth vs password).
 *
 * Computed in the main process — see `domain/capabilitiesRegistry.ts`.
 */
export interface ProviderAccountCapabilities {
  oauthBased: boolean
  passwordBased: boolean
  inboundSyncCapable: boolean
  outboundSendCapable: boolean
  remoteFolderMutationCapable: boolean
  /**
   * True when this build’s provider adapter can **discover** extra distinct mailboxes from the
   * vendor API under one saved account without user-defined slices (e.g. auto-listed shared mailboxes).
   * Does **not** claim vendor API limits — only what we implemented.
   */
  multiMailboxPerAuthGrantSupported: boolean
  /**
   * True when `EmailAccountConfig.mailboxes` may hold multiple logical mailbox/postbox slices on one row.
   * Structural feature of our persistence model (always true); slices may still be length 1 in practice.
   */
  supportsMultipleMailboxSlicesOnRow: boolean
}

// =============================================================================
// Account Configuration (persistence DTO — `email-accounts.json`)
// =============================================================================

/**
 * Persisted **provider account** row: credentials + folder routing + sync prefs.
 *
 * Domain separation (logical, not separate tables yet):
 * - **Provider** — `provider` + static profile in `domain/capabilitiesRegistry.ts`
 * - **Connected identity** — `email`, `displayName`, optional `externalPrincipalId`
 * - **Secrets** — `oauth` | `imap` | optional `smtp` (SMTP not wired for all paths yet)
 * - **Mailbox / sync targets** — root `folders` plus optional `mailboxes[]` slices (same OAuth/IMAP row)
 * - Normalized plans via `domain/mailboxResolution` + `domain/mailboxSyncPlan`
 */
/** Optional slice of a remote mailbox/postbox under one saved connection (same credentials). */
export interface ProviderMailboxSlice {
  /** Stable id within this account row (used with `MessageSearchOptions.mailboxId`). */
  mailboxId: string
  /** Shown in future multi-mailbox UI. */
  label: string
  /**
   * Provider-specific resource (e.g. shared mailbox SMTP address, Graph mailbox id).
   * Omit for the default mailbox served by the current credentials.
   */
  providerMailboxResourceRef?: string
  /** Per-slice folder routing; omitted fields inherit from the account root `folders`. */
  folders?: {
    monitored?: string[]
    inbox?: string
    sent?: string
  }
  /** Exactly one slice per row should be default; if omitted, first slice or implicit default is used. */
  isDefault?: boolean
}

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

  /**
   * Optional IdP / API principal id (e.g. OAuth `sub`, Graph user id) for linking or future multi-mailbox.
   */
  externalPrincipalId?: string
  
  /**
   * Zoho Mail API region: `mail.zoho.com` / `accounts.zoho.com` vs `.eu` for EU accounts.
   * Persisted at connect time from OAuth client config + wizard.
   */
  zohoDatacenter?: 'com' | 'eu'

  /** OAuth tokens (for gmail / microsoft365 / zoho) */
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
  
  /** Folder/label configuration for the default mailbox (and inherited base for slices). */
  folders: {
    /** Folders to monitor for new emails */
    monitored: string[]
    /** Default folder for inbox (usually 'INBOX') */
    inbox: string
    /** Sent folder name */
    sent?: string
  }

  /**
   * Remote lifecycle label/folder names (archive, pending review/delete, trash) — merged with product defaults
   * in `domain/mailboxLifecycleMapping.ts`.
   */
  orchestratorRemote?: OrchestratorRemoteNamesInput

  /**
   * Optional: multiple logical mailboxes/postboxes sharing this row’s credentials.
   * When absent, a single implicit slice is assumed (`mailboxId` `default` in resolution).
   */
  mailboxes?: ProviderMailboxSlice[]
  
  /** Sync settings */
  sync: {
    /** Only fetch emails from the last N days */
    maxAgeDays: number
    /**
     * Smart Sync initial/window: 7, 30, 90, or **0** = entire mailbox (UI warns).
     * When omitted, orchestrator falls back to `maxAgeDays` if > 0, else **30**.
     */
    syncWindowDays?: number
    /** Cap for first pull / Pull More batches (default 500). */
    maxMessagesPerPull?: number
    /** Whether to auto-analyze PDF attachments */
    analyzePdfs: boolean
    /** Maximum emails to fetch per sync */
    batchSize: number
  }
  
  /** Account status — `auth_error` = credentials rejected (IMAP / password); reconnect required */
  status: 'active' | 'error' | 'disabled' | 'auth_error'
  
  /** Last error message if status is 'error' */
  lastError?: string
  
  /** Last successful sync timestamp */
  lastSyncAt?: number
  
  /** Created timestamp */
  createdAt: number
  
  /** Updated timestamp */
  updatedAt: number
}

/** Safe summary of a mailbox slice for UI / IPC (no folder passwords). */
export interface EmailAccountMailboxSummary {
  mailboxId: string
  label: string
  isDefault: boolean
  providerMailboxResourceRef?: string
}

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

/** Non-secret fields to prefill “Update credentials” for IMAP (passwords never included). */
export interface ImapReconnectHints {
  email: string
  displayName: string
  imapHost: string
  imapPort: number
  imapSecurity: SecurityMode
  imapUsername: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: SecurityMode
  smtpUseSameCredentials: boolean
  smtpUsername: string
  /** True when a non-empty IMAP password exists in main-process memory (never sent to renderer). */
  hasImapPassword?: boolean
  /** True when a non-empty SMTP password exists in main-process memory. */
  hasSmtpPassword?: boolean
  /** Persisted Smart Sync window (for reconnect wizard; mirrors account.sync.syncWindowDays). */
  syncWindowDays?: number
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

  /**
   * When the account row has multiple `mailboxes` slices, selects which slice’s folder defaults apply.
   * Omit to use the default slice for that row.
   */
  mailboxId?: string
  
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

  /**
   * When true (sync orchestrator only), provider follows pagination (`pageToken` / `@odata.nextLink` /
   * IMAP chunking) until the provider returns no more pages. If `syncMaxMessages` is set, stops when that count is reached.
   */
  syncFetchAllPages?: boolean

  /** Optional hard cap on listed messages (sync); omit for uncapped pagination when `syncFetchAllPages` is true. */
  syncMaxMessages?: number
}

/**
 * Email attachment (base64-encoded content)
 */
export interface EmailAttachment {
  /** File name */
  filename: string
  /** MIME type */
  mimeType: string
  /** Base64-encoded content */
  contentBase64: string
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
  
  /** Attachments (optional) */
  attachments?: EmailAttachment[]
  
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
  patchAccountSyncPreferences(
    id: string,
    partial: Partial<Pick<EmailAccountConfig['sync'], 'syncWindowDays' | 'maxMessagesPerPull' | 'maxAgeDays' | 'batchSize'>>,
  ): Promise<EmailAccountInfo>
  deleteAccount(id: string): Promise<void>
  testConnection(id: string): Promise<{ success: boolean; error?: string }>
  getImapReconnectHints(id: string): Promise<ImapReconnectHints | null>
  updateImapCredentials(
    id: string,
    creds: { imapPassword: string; smtpPassword?: string; smtpUseSameCredentials?: boolean },
  ): Promise<{ success: boolean; error?: string }>
  
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

  /** IMAP only: LIST + optional CREATE for lifecycle mailboxes (see `domain/mailboxLifecycleMapping.ts`). */
  validateImapLifecycleRemote(
    accountId: string,
  ): Promise<{ ok: true; result: ImapLifecycleValidationResult } | { ok: false; error: string }>
}


