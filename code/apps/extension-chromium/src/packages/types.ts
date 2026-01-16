/**
 * BEAP Package Registry Types
 * 
 * Canonical data model for BEAP packages and ingress events.
 * This module defines the single source of truth for package state.
 * 
 * INVARIANTS:
 * - package_id must be unique and stable
 * - IngressEvents are append-only (never modify/delete)
 * - Multiple channel imports of same package link to same package_id
 * 
 * @version 1.0.0
 */

// =============================================================================
// Package Status
// =============================================================================

/**
 * Package lifecycle status
 * 
 * Flow:
 * - Incoming: Pending → Registered → Executed | Rejected
 * - Outgoing: Draft → Outbox → Executed | Rejected
 */
export type PackageStatus = 
  | 'pending'     // Awaiting user consent or auto-registration
  | 'registered'  // Accepted into the registry
  | 'draft'       // User is composing (outbox workflow)
  | 'outbox'      // Queued for delivery
  | 'executed'    // Successfully processed/delivered
  | 'rejected'    // Denied or quarantined

/**
 * Map status to BEAP Packages workspace sections
 */
export const STATUS_TO_SECTION: Record<PackageStatus, string> = {
  pending: 'inbox',
  registered: 'inbox',
  draft: 'drafts',
  outbox: 'outbox',
  executed: 'archive',
  rejected: 'quarantine'
}

// =============================================================================
// Ingress Channel
// =============================================================================

/**
 * Channel through which a package was received/imported
 */
export type IngressChannel = 
  | 'gmail'
  | 'outlook'
  | 'web-messenger'
  | 'download'
  | 'import'
  | 'api'
  | 'filesystem'

// =============================================================================
// Canonical Package
// =============================================================================

/**
 * Canonical BEAP Package
 * 
 * The single source of truth for a package. Multiple channel imports
 * of the same package should link to this same record via package_id.
 */
export interface BeapPackage {
  /** 
   * Unique, stable package identifier
   * Format: "beap_" + SHA-256 hash of envelope contents
   * This ensures the same package from different channels maps to same ID
   */
  package_id: string
  
  /**
   * Current lifecycle status
   */
  status: PackageStatus
  
  /**
   * Reference to capsule payload (encrypted blob or storage pointer)
   * Could be: base64 data, storage key, or external URL
   */
  capsule_ref: string | null
  
  /**
   * Reference to envelope metadata
   * Contains sender fingerprint, recipient, signature, etc.
   */
  envelope_ref: string | null
  
  /**
   * Associated handshake ID (null if unknown sender)
   */
  handshake_id: string | null
  
  /**
   * Sender fingerprint (short form for display)
   */
  sender_fingerprint: string | null
  
  /**
   * Sender display name (cached from handshake)
   */
  sender_name: string | null
  
  /**
   * Package subject/title
   */
  subject: string
  
  /**
   * Brief preview/snippet
   */
  preview: string | null
  
  /**
   * Whether this package was auto-registered (vs user consent)
   */
  auto_registered: boolean
  
  /**
   * Creation timestamp (when first seen)
   */
  created_at: number
  
  /**
   * Last updated timestamp
   */
  updated_at: number
  
  /**
   * Execution timestamp (when status became 'executed')
   */
  executed_at: number | null
  
  /**
   * Rejection timestamp and reason
   */
  rejected_at: number | null
  rejected_reason: string | null
  
  /**
   * Optional: Policy that applies to this package (CAP)
   */
  policy_id: string | null
  
  /**
   * Optional: Attachments count
   */
  attachments_count: number
  
  /**
   * Direction: incoming or outgoing
   */
  direction: 'incoming' | 'outgoing'
}

// =============================================================================
// Ingress Event (Append-Only Log)
// =============================================================================

/**
 * Ingress Event
 * 
 * Records each time a package is received through a channel.
 * This is an append-only log - events are never modified or deleted.
 * 
 * Multiple events can reference the same package_id (e.g., same email
 * arriving via Gmail sync and manual import).
 */
export interface IngressEvent {
  /**
   * Unique event identifier
   * Format: "evt_" + UUID
   */
  event_id: string
  
  /**
   * Reference to canonical package
   * FK to BeapPackage.package_id
   */
  package_id: string
  
  /**
   * Channel through which this event occurred
   */
  channel: IngressChannel
  
  /**
   * Site/domain where package was received (if applicable)
   * e.g., "mail.google.com", "outlook.office.com"
   */
  site: string | null
  
  /**
   * Event timestamp
   */
  timestamp: number
  
  /**
   * Pointer to channel-native raw message/package object
   * This preserves the original format for auditing
   */
  raw_ref: string | null
  
  /**
   * Optional: Message ID from the channel (for deduplication)
   * e.g., Gmail message ID, Outlook conversation ID
   */
  channel_message_id: string | null
  
  /**
   * Optional: Additional channel-specific metadata
   */
  channel_metadata: Record<string, unknown> | null
}

// =============================================================================
// Auto-Registration Policy
// =============================================================================

/**
 * Auto-registration permission level
 * 
 * Determines whether packages from a handshake can be auto-registered
 */
export type AutoRegisterPolicy = 
  | 'deny'          // Never auto-register, always require consent
  | 'review'        // Show for review but don't auto-register
  | 'full-auto'     // Auto-register without consent (trusted partner)

/**
 * Auto-registration check result
 */
export interface AutoRegisterCheckResult {
  /** Whether auto-registration is allowed */
  allowed: boolean
  
  /** Reason for the decision */
  reason: string
  
  /** Handshake ID if found */
  handshake_id: string | null
  
  /** Policy that was applied */
  policy: AutoRegisterPolicy
}

// =============================================================================
// Registration Request
// =============================================================================

/**
 * Request to register a package from a channel import
 */
export interface PackageRegistrationRequest {
  /**
   * Proposed package ID (will be validated for uniqueness)
   */
  package_id: string
  
  /**
   * Envelope data for fingerprint extraction
   */
  envelope_data: {
    sender_fingerprint: string | null
    recipient_fingerprint: string | null
    signature: string | null
    timestamp: number
  }
  
  /**
   * Capsule reference
   */
  capsule_ref: string
  
  /**
   * Channel through which this was received
   */
  channel: IngressChannel
  
  /**
   * Site where received
   */
  site: string | null
  
  /**
   * Raw channel reference
   */
  raw_ref: string | null
  
  /**
   * Channel-specific message ID
   */
  channel_message_id: string | null
  
  /**
   * Package subject
   */
  subject: string
  
  /**
   * Preview content
   */
  preview: string | null
}

// =============================================================================
// Registration Result
// =============================================================================

/**
 * Result of a package registration attempt
 */
export interface PackageRegistrationResult {
  /** Whether registration succeeded */
  success: boolean
  
  /** The canonical package (existing or newly created) */
  package: BeapPackage | null
  
  /** The ingress event that was created */
  event: IngressEvent | null
  
  /** Whether this was a new package or existing */
  was_new: boolean
  
  /** Whether auto-registration was used */
  auto_registered: boolean
  
  /** If failed, the reason */
  error: string | null
  
  /** If consent is required, this will be true */
  requires_consent: boolean
}



