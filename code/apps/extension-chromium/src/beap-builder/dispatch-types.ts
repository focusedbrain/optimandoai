/**
 * BEAP Dispatch Types
 * 
 * Types for the send pipeline, delivery tracking, and Outbox state transitions.
 * 
 * @version 1.0.0
 */

import type { BeapEnvelope, BeapCapsule, CapsuleBuilderContext } from './canonical-types'
import type { Handshake } from '../handshake/types'

// =============================================================================
// Delivery Method
// =============================================================================

/**
 * Delivery methods for BEAP packages
 */
export type DeliveryMethod = 'email' | 'messenger' | 'download' | 'chat'

/**
 * Delivery status for Outbox tracking
 */
export type DeliveryStatus =
  | 'queued'              // Email: awaiting send
  | 'sending'             // Email: send in progress
  | 'sent'                // Email: successfully sent
  | 'failed'              // Email: send failed
  | 'pending_user_action' // Messenger/Download: awaiting user confirmation
  | 'sent_manual'         // Messenger/Download: user confirmed sent
  | 'sent_chat'           // Chat: sent via WR Chat

// =============================================================================
// Send Context
// =============================================================================

/**
 * Input context for the send pipeline
 */
export interface SendContext {
  /** Source of the send (where it was initiated) */
  source: 'wr-chat-direct' | 'wr-chat-group' | 'beap-drafts'
  
  /** Message text content */
  text: string
  
  /** Subject line (for drafts) */
  subject?: string
  
  /** Attachments (if any) */
  attachments: SendAttachment[]
  
  /** Selected sessions (if any) */
  selectedSessions: SendSessionRef[]
  
  /** Data/automation request text */
  dataRequest: string
  
  /** Selected handshake (if available) */
  handshake?: Handshake | null
  
  /** Delivery configuration */
  delivery: DeliveryConfig
  
  /** Builder was explicitly used */
  builderUsed: boolean
  
  /** Explicit ingress constraints (from builder) */
  ingressConstraints: string[]
  
  /** Explicit egress constraints (from builder) */
  egressConstraints: string[]
  
  /** Offline-only execution */
  offlineOnly: boolean
}

/**
 * Attachment for send context
 */
export interface SendAttachment {
  id: string
  name: string
  size: number
  type: string
  dataRef: string
  semanticContent: string | null
  encryptedRef: string | null
}

/**
 * Session reference for send context
 */
export interface SendSessionRef {
  sessionId: string
  sessionName: string
  requiredCapability: string
}

// =============================================================================
// Delivery Configuration
// =============================================================================

/**
 * Delivery configuration for the send
 */
export interface DeliveryConfig {
  /** Delivery method */
  method: DeliveryMethod
  
  /** Email-specific config */
  email?: EmailDeliveryConfig
  
  /** Messenger-specific config */
  messenger?: MessengerDeliveryConfig
  
  /** Download-specific config */
  download?: DownloadDeliveryConfig
  
  /** Chat-specific config */
  chat?: ChatDeliveryConfig
}

export interface EmailDeliveryConfig {
  to: string[]
  cc?: string[]
  bcc?: string[]
  accountId: string
}

export interface MessengerDeliveryConfig {
  platform?: 'whatsapp' | 'signal' | 'telegram' | 'slack' | 'teams' | 'other'
  targetDescription?: string
}

export interface DownloadDeliveryConfig {
  format: 'file' | 'usb' | 'wallet'
  filename?: string
}

export interface ChatDeliveryConfig {
  chatType: 'direct' | 'group'
  sessionId?: string
  recipientFingerprint?: string
}

// =============================================================================
// Send Result
// =============================================================================

/**
 * Result of the send pipeline
 */
export interface SendResult {
  /** Whether send was successful */
  success: boolean
  
  /** Generated package ID */
  packageId: string | null
  
  /** Generated envelope */
  envelope: BeapEnvelope | null
  
  /** Generated capsule */
  capsule: BeapCapsule | null
  
  /** Outbox entry ID */
  outboxEntryId: string | null
  
  /** Error message if failed */
  error: string | null
  
  /** Delivery method used */
  deliveryMethod: DeliveryMethod
  
  /** Initial delivery status */
  deliveryStatus: DeliveryStatus
}

// =============================================================================
// Outbox Entry
// =============================================================================

/**
 * A single delivery attempt
 */
export interface DeliveryAttempt {
  /** Attempt timestamp */
  at: number
  
  /** Status after this attempt */
  status: DeliveryStatus
  
  /** Error message (if failed) */
  error?: string
}

/**
 * Outbox entry for tracking delivery
 */
export interface OutboxEntry {
  /** Unique entry ID */
  id: string
  
  /** Associated package ID */
  packageId: string
  
  /** Subject/title */
  subject: string
  
  /** Preview text */
  preview: string
  
  /** Sender fingerprint */
  senderFingerprint: string
  
  /** Recipient info (email, fingerprint, etc.) */
  recipient: string
  
  /** Delivery method */
  deliveryMethod: DeliveryMethod
  
  /** Current delivery status */
  deliveryStatus: DeliveryStatus
  
  /** Error message (if status is 'failed') */
  deliveryError?: string
  
  /** All delivery attempts */
  deliveryAttempts: DeliveryAttempt[]
  
  /** Attachments count */
  attachmentsCount: number
  
  /** Created timestamp */
  createdAt: number
  
  /** Last updated timestamp */
  updatedAt: number
  
  /** Envelope reference */
  envelopeRef: string | null
  
  /** Capsule reference */
  capsuleRef: string | null
  
  /** For messenger: the payload text to copy */
  messengerPayload?: string
  
  /** For download: the download URL/blob */
  downloadRef?: string
}

// =============================================================================
// Dispatch Handlers
// =============================================================================

/**
 * Result of a dispatch operation
 */
export interface DispatchResult {
  /** Whether dispatch was successful */
  success: boolean
  
  /** New status after dispatch */
  status: DeliveryStatus
  
  /** Error message if failed */
  error?: string
  
  /** For messenger: payload text */
  messengerPayload?: string
  
  /** For download: download ref */
  downloadRef?: string
}

/**
 * Confirmation action for manual delivery methods
 */
export type ManualConfirmAction = 'mark_sent' | 'cancel' | 'retry'

