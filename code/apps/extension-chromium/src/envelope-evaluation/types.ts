/**
 * Envelope Evaluation Types
 * 
 * Types for deterministic, fail-closed evaluation of incoming BEAP messages.
 * 
 * Evaluation order (canonical):
 * 1. Envelope verification (integrity + identity metadata)
 * 2. Envelope-declared ingress/egress boundaries
 * 3. Intersection with local WRGuard configuration
 * 
 * If any step fails → message is Rejected with a reason.
 * 
 * @version 1.0.0
 */

// =============================================================================
// Envelope Structure (for verification)
// =============================================================================

/**
 * Channel through which the message arrived
 */
export type IngressChannel = 'email' | 'messenger' | 'download' | 'chat' | 'unknown'

/**
 * Egress destination type
 */
export type EgressType = 'web' | 'email' | 'file' | 'api' | 'none'

/**
 * Declared egress destination
 */
export interface EgressDeclaration {
  /** Type of egress */
  type: EgressType
  
  /** Target (domain, email, path, etc.) */
  target: string
  
  /** Whether this is required for execution */
  required: boolean
}

/**
 * Declared ingress source
 */
export interface IngressDeclaration {
  /** Source type */
  type: 'session' | 'allowlist' | 'handshake' | 'public'
  
  /** Source identifier */
  source: string
  
  /** Whether this is verified */
  verified: boolean
}

/**
 * Envelope structure for verification
 * This is the cleartext portion of a BEAP package
 */
export interface BeapEnvelope {
  /** Unique envelope ID */
  envelopeId: string
  
  /** Package ID reference */
  packageId: string
  
  /** Envelope hash for integrity verification (stub) */
  envelopeHash?: string
  
  /** Signature status (stub) */
  signatureStatus?: 'valid' | 'invalid' | 'missing' | 'unknown'
  
  /** Sender fingerprint */
  senderFingerprint?: string
  
  /** Receiver fingerprint (if targeted) */
  receiverFingerprint?: string
  
  /** Handshake reference ID */
  handshakeRef?: string
  
  /** Channel through which message arrived */
  ingressChannel: IngressChannel
  
  /** Email provider ID (if email channel) */
  emailProviderId?: string
  
  /** Declared ingress sources */
  ingressDeclarations: IngressDeclaration[]
  
  /** Declared egress destinations */
  egressDeclarations: EgressDeclaration[]
  
  /** Timestamp of creation */
  createdAt: number
  
  /** Expiry timestamp (if applicable) */
  expiresAt?: number
  
  /** Hardware attestation (stub) */
  hardwareAttestation?: {
    present: boolean
    verified: boolean
  }
}

// =============================================================================
// Capsule Metadata (safe to display after verification)
// =============================================================================

/**
 * Capsule metadata - safe to display after envelope verification
 * Does NOT include decrypted content
 */
export interface CapsuleMetadata {
  /** Capsule ID */
  capsuleId: string
  
  /** Title/subject */
  title: string
  
  /** Attachment count */
  attachmentCount: number
  
  /** Attachment names (encrypted, not content) */
  attachmentNames: string[]
  
  /** Session reference count */
  sessionRefCount: number
  
  /** Has data/automation request */
  hasDataRequest: boolean
  
  /** Content length hint */
  contentLengthHint: number
}

// =============================================================================
// Verification States
// =============================================================================

/**
 * Inbox verification status
 */
export type VerificationStatus = 
  | 'pending_verification'
  | 'verifying'
  | 'accepted'
  | 'rejected'

/**
 * Rejection reason codes
 */
export type RejectionCode =
  | 'envelope_missing'
  | 'envelope_hash_missing'
  | 'envelope_hash_invalid'
  | 'signature_invalid'
  | 'signature_missing'
  | 'ingress_missing'
  | 'egress_missing'
  | 'provider_not_configured'
  | 'egress_not_allowed_by_wrguard'
  | 'ingress_not_allowed_by_wrguard'
  | 'envelope_expired'
  | 'handshake_not_found'
  | 'evaluation_error'

/**
 * Structured rejection reason
 */
export interface RejectionReason {
  /** Rejection code */
  code: RejectionCode
  
  /** Human-readable summary */
  humanSummary: string
  
  /** Additional details (optional) */
  details?: string
  
  /** Timestamp of rejection */
  timestamp: number
  
  /** Evaluation step that failed */
  failedStep: 'envelope_verification' | 'boundary_check' | 'wrguard_intersection'
}

// =============================================================================
// Evaluation Result
// =============================================================================

/**
 * Result of envelope evaluation
 */
export interface EvaluationResult {
  /** Whether the message passed evaluation */
  passed: boolean
  
  /** Final status */
  status: 'accepted' | 'rejected'
  
  /** Rejection reason if rejected */
  rejectionReason?: RejectionReason
  
  /** Envelope summary (safe to display) */
  envelopeSummary?: EnvelopeSummaryDisplay
  
  /** Capsule metadata (safe to display if accepted) */
  capsuleMetadata?: CapsuleMetadata
  
  /** Evaluation steps completed */
  stepsCompleted: {
    envelopeVerification: boolean
    boundaryCheck: boolean
    wrguardIntersection: boolean
  }
  
  /** Timestamp of evaluation */
  evaluatedAt: number
}

/**
 * Envelope summary for display (read-only)
 */
export interface EnvelopeSummaryDisplay {
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

// =============================================================================
// Incoming Message Structure (for evaluation)
// =============================================================================

/**
 * Incoming BEAP message for evaluation
 */
export interface IncomingBeapMessage {
  /** Message ID */
  id: string
  
  /** Raw envelope data */
  envelope: BeapEnvelope
  
  /** Raw capsule metadata (no decrypted content) */
  capsuleMetadata: CapsuleMetadata
  
  /** Encrypted capsule content (not processed before verification) */
  encryptedCapsule: string
  
  /** Encrypted artefacts (not processed before verification) */
  encryptedArtefacts?: string[]
  
  /** Import source */
  importSource: 'email' | 'file' | 'clipboard' | 'chat'
  
  /** Import timestamp */
  importedAt: number
}

