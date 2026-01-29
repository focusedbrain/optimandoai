/**
 * Handshake Types
 * 
 * Data model for BEAP™ handshakes with cryptographic fingerprints.
 */

// =============================================================================
// Verification Status
// =============================================================================

/**
 * Handshake lifecycle status:
 * - PENDING: Handshake request sent, awaiting accept
 * - LOCAL: Established locally (not verified via wrdesk.com)
 * - VERIFIED_WR: Verified via wrdesk.com
 */
export type HandshakeStatus = 'PENDING' | 'LOCAL' | 'VERIFIED_WR'

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
  
  /** Timestamp when verified via wrdesk.com (null if LOCAL) */
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
  
  // =========================================================================
  // X25519 Key Agreement (for qBEAP encryption)
  // =========================================================================
  
  /** 
   * Peer's X25519 public key (base64, 32 bytes).
   * Received during handshake establishment.
   * Used for ECDH key agreement in qBEAP encryption.
   */
  peerX25519PublicKey?: string
  
  /**
   * ID of the local X25519 keypair used with this handshake.
   * References a keypair stored in local key storage.
   * If null, the default device keypair is used.
   */
  localX25519KeyId?: string
  
  // =========================================================================
  // ML-KEM-768 Key Agreement (for qBEAP post-quantum encryption)
  // Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
  // =========================================================================
  
  /**
   * Peer's ML-KEM-768 public key (base64, 1184 bytes).
   * Received during handshake establishment.
   * Used for KEM encapsulation in qBEAP hybrid key agreement.
   * 
   * Required for qBEAP package creation per canon A.3.054.10 / A.3.13.
   */
  peerMlkem768PublicKeyB64?: string
  
  /**
   * ID of the local ML-KEM-768 keypair used with this handshake.
   * References a keypair stored in local key storage / vault.
   * If null, the device's default ML-KEM keypair is used.
   */
  localMlkem768KeyId?: string
  
  /**
   * Key agreement version for future-proofing.
   * 1 = X25519 only (deprecated for qBEAP)
   * 2 = Hybrid X25519 + ML-KEM-768 (current for qBEAP)
   */
  keyAgreementVersion?: number
  
  // =========================================================================
  // Mock/Demo Indicator
  // =========================================================================
  
  /**
   * If true, this is a demo/mock handshake without real cryptographic keys.
   * Mock handshakes cannot be used for qBEAP encryption.
   * They are for UI demonstration purposes only.
   */
  isMock?: boolean
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
  
  // =========================================================================
  // X25519 Key Agreement (required for real handshakes)
  // =========================================================================
  
  /**
   * Our X25519 public key (base64, 32 bytes).
   * Sent in the request so recipient can establish key agreement.
   * Required for qBEAP encryption.
   */
  senderX25519PublicKeyB64: string
  
  /**
   * Our ML-KEM-768 public key (base64, 1184 bytes).
   * Optional: enables post-quantum hybrid encryption.
   * Per canon A.3.054.10 / A.3.13: recommended for qBEAP.
   */
  senderMlkem768PublicKeyB64?: string
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
  
  // =========================================================================
  // X25519 Key Agreement (from sender's request)
  // =========================================================================
  
  /**
   * Sender's X25519 public key (base64, 32 bytes).
   * Received in the handshake request.
   * Required for qBEAP key agreement.
   */
  senderX25519PublicKeyB64: string
  
  /**
   * Sender's ML-KEM-768 public key (base64, 1184 bytes).
   * Optional: enables post-quantum hybrid encryption.
   */
  senderMlkem768PublicKeyB64?: string
}

// =============================================================================
// Wire Payload Types (for serialized handshake messages)
// =============================================================================

/**
 * Handshake Request Payload
 * 
 * Wire format for a BEAP handshake request message.
 * Sent via email, messenger, or download to initiate a handshake.
 * 
 * Contains the sender's cryptographic identity:
 * - X25519 public key (required for key agreement)
 * - ML-KEM-768 public key (optional for post-quantum upgrade)
 * - Fingerprint derived from X25519 public key
 */
export interface HandshakeRequestPayload {
  /** Message type discriminator */
  type: 'BEAP_HANDSHAKE_REQUEST'
  
  /** Payload version for forward compatibility */
  version: 1
  
  /** Sender's display name */
  senderDisplayName: string
  
  /** Sender's email address (optional) */
  senderEmail?: string
  
  /** Sender's organization (optional) */
  senderOrganization?: string
  
  /**
   * Sender's fingerprint (64 hex chars).
   * SHA-256 hash of the X25519 public key.
   * Used for identity verification.
   */
  senderFingerprint: string
  
  /**
   * Sender's X25519 public key (base64, 32 bytes).
   * Required for ECDH key agreement.
   */
  senderX25519PublicKeyB64: string
  
  /**
   * Sender's ML-KEM-768 public key (base64, 1184 bytes).
   * Optional: enables post-quantum hybrid key agreement.
   * Per canon A.3.054.10 / A.3.13.
   */
  senderMlkem768PublicKeyB64?: string
  
  /** Human-readable message to recipient */
  message: string
  
  /** Creation timestamp (Unix ms) */
  createdAt: number
  
  /** Expiration timestamp (Unix ms, optional) */
  expiresAt?: number
}

/**
 * Handshake Accept Payload
 * 
 * Wire format for a BEAP handshake accept response.
 * Sent in reply to a HandshakeRequestPayload.
 * 
 * Contains the acceptor's cryptographic identity:
 * - X25519 public key (required for key agreement)
 * - ML-KEM-768 public key (optional for post-quantum upgrade)
 * - Chosen automation mode for the handshake
 */
export interface HandshakeAcceptPayload {
  /** Message type discriminator */
  type: 'BEAP_HANDSHAKE_ACCEPT'
  
  /** Payload version for forward compatibility */
  version: 1
  
  /** ID of the request being accepted */
  requestId: string
  
  /** Acceptor's display name */
  acceptorDisplayName: string
  
  /** Acceptor's email address (optional) */
  acceptorEmail?: string
  
  /** Acceptor's organization (optional) */
  acceptorOrganization?: string
  
  /**
   * Acceptor's fingerprint (64 hex chars).
   * SHA-256 hash of the X25519 public key.
   * Used for identity verification.
   */
  acceptorFingerprint: string
  
  /**
   * Acceptor's X25519 public key (base64, 32 bytes).
   * Required for ECDH key agreement.
   */
  acceptorX25519PublicKeyB64: string
  
  /**
   * Acceptor's ML-KEM-768 public key (base64, 1184 bytes).
   * Optional: enables post-quantum hybrid key agreement.
   * Per canon A.3.054.10 / A.3.13.
   */
  acceptorMlkem768PublicKeyB64?: string
  
  /** Automation mode chosen for this handshake */
  automationMode: AutomationMode
  
  /** Creation timestamp (Unix ms) */
  createdAt: number
}

