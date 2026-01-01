/**
 * BEAP Messages UI Types
 * 
 * UI-specific model for rendering BEAP message lists.
 * Extends the canonical BeapPackage with display fields.
 * 
 * @version 1.0.0
 */

// =============================================================================
// UI Message Model
// =============================================================================

/**
 * Folder types for message organization
 */
export type BeapFolder = 'inbox' | 'outbox' | 'archived' | 'rejected'

/**
 * Delivery method for a message
 */
export type BeapDeliveryMethod = 'email' | 'messenger' | 'download' | 'chat' | 'unknown'

/**
 * Direction of message
 */
export type BeapDirection = 'inbound' | 'outbound'

/**
 * Status chips by folder
 */
export type BeapMessageStatus = 
  | 'imported'              // Inbox: just imported
  | 'pending_verification'  // Inbox: awaiting verification
  | 'verifying'             // Inbox: verification in progress
  | 'accepted'              // Inbox: passed verification
  | 'pending'               // Inbox: legacy pending status
  | 'queued'                // Outbox: awaiting send
  | 'sending'               // Outbox: send in progress
  | 'sent'                  // Outbox: successfully sent (email)
  | 'failed'                // Outbox: send failed
  | 'pending_user_action'   // Outbox: awaiting user confirmation (messenger/download)
  | 'sent_manual'           // Outbox: user confirmed sent (messenger/download)
  | 'sent_chat'             // Outbox: sent via chat
  | 'archived'              // Archived
  | 'rejected'              // Rejected

/**
 * Message attachment for display
 */
export interface BeapAttachment {
  name: string
  size?: number
  type?: string
}

/**
 * UI model for a BEAP message
 * Used for rendering in list views
 */
export interface BeapMessageUI {
  /** Unique identifier */
  id: string
  
  /** Which folder this message belongs to */
  folder: BeapFolder
  
  /** Sender/recipient fingerprint (short form) */
  fingerprint: string
  
  /** Full fingerprint for detail view */
  fingerprintFull?: string
  
  /** Delivery method used */
  deliveryMethod: BeapDeliveryMethod
  
  /** Message title/subject */
  title: string
  
  /** Message timestamp */
  timestamp: number
  
  /** Message body text */
  bodyText: string
  
  /** Attachments list */
  attachments: BeapAttachment[]
  
  /** Status for display chip */
  status: BeapMessageStatus
  
  /** Direction: inbound or outbound */
  direction: BeapDirection
  
  /** Rejection reason (for rejected folder) */
  rejectReason?: string
  
  /** Associated handshake ID */
  handshakeId?: string
  
  /** Hardware attestation status */
  hardwareAttestation?: 'verified' | 'pending' | 'unknown'
  
  /** Channel/site where received */
  channelSite?: string
  
  /** Sender name if known */
  senderName?: string
  
  // =========================================================================
  // Delivery Tracking (Outbox specific)
  // =========================================================================
  
  /** Current delivery status (for outbox) */
  deliveryStatus?: BeapDeliveryStatus
  
  /** Delivery error message */
  deliveryError?: string
  
  /** Delivery attempts log */
  deliveryAttempts?: DeliveryAttempt[]
  
  /** For messenger: payload text to copy */
  messengerPayload?: string
  
  /** For download: download reference */
  downloadRef?: string
  
  /** Associated package ID */
  packageId?: string
  
  /** Envelope reference */
  envelopeRef?: string
  
  /** Capsule reference */
  capsuleRef?: string
  
  // =========================================================================
  // Verification Fields (Inbox specific)
  // =========================================================================
  
  /** Verification status */
  verificationStatus?: VerificationStatus
  
  /** Rejection reason (structured) */
  rejectionReasonData?: RejectionReasonUI
  
  /** Envelope summary (safe to display after verification) */
  envelopeSummary?: EnvelopeSummaryUI
  
  /** Capsule metadata (safe to display after verification) */
  capsuleMetadata?: CapsuleMetadataUI
  
  /** Raw incoming message reference (for re-verification) */
  incomingMessageRef?: string
}

/**
 * Delivery status for outbox tracking
 */
export type BeapDeliveryStatus =
  | 'queued'              // Email: awaiting send
  | 'sending'             // Email: send in progress
  | 'sent'                // Email: successfully sent
  | 'failed'              // Email: send failed
  | 'pending_user_action' // Messenger/Download: awaiting confirmation
  | 'sent_manual'         // Messenger/Download: user confirmed
  | 'sent_chat'           // Chat: sent immediately

/**
 * Single delivery attempt record
 */
export interface DeliveryAttempt {
  at: number
  status: BeapDeliveryStatus
  error?: string
}

// =============================================================================
// Verification States (Inbox gating)
// =============================================================================

/**
 * Verification status for inbox items
 */
export type VerificationStatus =
  | 'pending_verification'  // Awaiting verification
  | 'verifying'             // Verification in progress
  | 'accepted'              // Passed all checks
  | 'rejected'              // Failed verification

/**
 * Structured rejection reason
 */
export interface RejectionReasonUI {
  /** Rejection code */
  code: string
  
  /** Human-readable summary */
  humanSummary: string
  
  /** Additional details (optional) */
  details?: string
  
  /** Timestamp of rejection */
  timestamp: number
  
  /** Evaluation step that failed */
  failedStep?: string
}

/**
 * Envelope summary for display (read-only, safe after verification)
 */
export interface EnvelopeSummaryUI {
  /** Envelope ID (truncated) */
  envelopeIdShort: string
  
  /** Sender fingerprint (formatted) */
  senderFingerprintDisplay: string
  
  /** Channel display */
  channelDisplay: string
  
  /** Ingress summary */
  ingressSummary: string
  
  /** Egress summary */
  egressSummary: string
  
  /** Created timestamp */
  createdAt: number
  
  /** Expiry status */
  expiryStatus: 'valid' | 'expired' | 'no_expiry'
  
  /** Signature status display */
  signatureStatusDisplay: string
  
  /** Hash verification display */
  hashVerificationDisplay: string
}

/**
 * Capsule metadata for display (safe after verification)
 */
export interface CapsuleMetadataUI {
  /** Capsule ID */
  capsuleId: string
  
  /** Title/subject */
  title: string
  
  /** Attachment count */
  attachmentCount: number
  
  /** Attachment names */
  attachmentNames: string[]
  
  /** Session reference count */
  sessionRefCount: number
  
  /** Has data/automation request */
  hasDataRequest: boolean
}

// =============================================================================
// Folder Configuration
// =============================================================================

export interface FolderConfig {
  icon: string
  title: string
  emptyIcon: string
  emptyTitle: string
  emptyDescription: string
  ctaLabel?: string
  ctaAction?: 'import' | 'create-draft' | 'back-to-inbox' | null
}

export const FOLDER_CONFIGS: Record<BeapFolder, FolderConfig> = {
  inbox: {
    icon: '📥',
    title: 'Inbox',
    emptyIcon: '📥',
    emptyTitle: 'No imported messages.',
    emptyDescription: 'Import BEAP™ packages from email, messenger, or file download.',
    ctaLabel: 'Import',
    ctaAction: 'import'
  },
  outbox: {
    icon: '📤',
    title: 'Outbox',
    emptyIcon: '📤',
    emptyTitle: 'Nothing sent yet.',
    emptyDescription: 'Create a draft to send your first BEAP™ message.',
    ctaLabel: 'Create draft',
    ctaAction: 'create-draft'
  },
  archived: {
    icon: '📁',
    title: 'Archived',
    emptyIcon: '📁',
    emptyTitle: 'No archived messages.',
    emptyDescription: 'Successfully executed packages will appear here.',
    ctaLabel: 'Back to Inbox',
    ctaAction: 'back-to-inbox'
  },
  rejected: {
    icon: '🚫',
    title: 'Rejected',
    emptyIcon: '🚫',
    emptyTitle: 'No rejected messages.',
    emptyDescription: 'Packages that failed verification or were declined appear here.',
    ctaLabel: undefined,
    ctaAction: null
  }
}

// =============================================================================
// Status Configuration
// =============================================================================

export const STATUS_CONFIG: Record<BeapMessageStatus, { label: string; color: string; bgColor: string }> = {
  imported: { label: 'Imported', color: '#3b82f6', bgColor: 'rgba(59,130,246,0.15)' },
  pending_verification: { label: 'Pending Verification', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.15)' },
  verifying: { label: 'Verifying...', color: '#8b5cf6', bgColor: 'rgba(139,92,246,0.15)' },
  accepted: { label: 'Accepted', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
  pending: { label: 'Pending', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.15)' },
  queued: { label: 'Queued', color: '#3b82f6', bgColor: 'rgba(59,130,246,0.15)' },
  sending: { label: 'Sending...', color: '#8b5cf6', bgColor: 'rgba(139,92,246,0.15)' },
  sent: { label: 'Sent', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
  failed: { label: 'Failed', color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)' },
  pending_user_action: { label: 'Awaiting Confirmation', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.15)' },
  sent_manual: { label: 'Sent (Manual)', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
  sent_chat: { label: 'Sent (Chat)', color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
  archived: { label: 'Archived', color: '#64748b', bgColor: 'rgba(100,116,139,0.15)' },
  rejected: { label: 'Rejected', color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)' }
}

export const DELIVERY_METHOD_CONFIG: Record<BeapDeliveryMethod, { label: string; icon: string }> = {
  email: { label: 'Email', icon: '📧' },
  messenger: { label: 'Messenger', icon: '💬' },
  download: { label: 'Download', icon: '💾' },
  chat: { label: 'Chat', icon: '🗨️' },
  unknown: { label: 'Unknown', icon: '❓' }
}

