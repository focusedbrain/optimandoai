/**
 * Handshake Types
 * 
 * Data model for BEAP™ handshakes with cryptographic fingerprints.
 */

// =============================================================================
// Verification Status
// =============================================================================

export type HandshakeStatus = 'LOCAL' | 'VERIFIED_WR'

// =============================================================================
// Automation Mode
// =============================================================================

export type AutomationMode = 'DENY' | 'REVIEW' | 'ALLOW'

// =============================================================================
// Handshake Model
// =============================================================================

export interface Handshake {
  /** Unique identifier */
  id: string
  
  /** Display name for the handshake partner */
  displayName: string
  
  /** Full fingerprint (64 hex chars for SHA-256) */
  fingerprint_full: string
  
  /** Short fingerprint for display: "7C9F…A2D1" */
  fingerprint_short: string
  
  /** Verification status */
  status: HandshakeStatus
  
  /** Timestamp when verified via wrcode.org (null if LOCAL) */
  verified_at: number | null
  
  /** Automation control: Deny / Review / Allow */
  automation_mode: AutomationMode
  
  /** Optional: allowed ingress channels for this handshake */
  channels_allowed?: string[]
  
  /** Creation timestamp */
  created_at: number
  
  /** Last updated timestamp */
  updated_at: number
  
  /** Optional email address */
  email?: string
  
  /** Optional organization */
  organization?: string
  
  /** Public key or identity blob (base64) */
  identity_blob?: string
}

// =============================================================================
// Package Mapping
// =============================================================================

export interface PackageHandshakeMapping {
  /** Package ID */
  package_id: string
  
  /** Associated handshake ID (null if unknown sender) */
  handshake_id: string | null
  
  /** Short fingerprint for display */
  fingerprint_short: string | null
  
  /** Handshake display name (cached for display) */
  handshake_name: string | null
  
  /** Handshake status (cached for display) */
  handshake_status: HandshakeStatus | null
}

// =============================================================================
// Handshake Request (outgoing)
// =============================================================================

export interface HandshakeRequest {
  /** Request ID */
  id: string
  
  /** Our fingerprint to include in request */
  our_fingerprint: string
  
  /** Recipient email/identifier */
  recipient: string
  
  /** Request message */
  message: string
  
  /** Delivery method */
  delivery_method: 'email' | 'messenger' | 'download'
  
  /** Sent timestamp */
  sent_at: number
  
  /** Status */
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
}

// =============================================================================
// Handshake Accept (incoming)
// =============================================================================

export interface HandshakeAcceptRequest {
  /** Incoming request ID */
  id: string
  
  /** Sender display name */
  sender_name: string
  
  /** Sender email */
  sender_email?: string
  
  /** Sender organization */
  sender_organization?: string
  
  /** Received fingerprint from sender */
  received_fingerprint: string
  
  /** Expected fingerprint (if user pasted one for verification) */
  expected_fingerprint?: string
  
  /** Received timestamp */
  received_at: number
}

