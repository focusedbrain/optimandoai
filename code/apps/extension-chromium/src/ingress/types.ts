/**
 * Ingress Types
 * 
 * Types for BEAP message import/ingress pipelines.
 * 
 * Three ingress paths:
 * 1. Email import (via configured providers)
 * 2. Messenger (Web) paste/import
 * 3. Download file import (USB/wallet)
 * 
 * Identity handling: LOCAL-ONLY (no wrcode.org dependency)
 * 
 * @version 1.0.0
 */

// =============================================================================
// Ingress Sources
// =============================================================================

/**
 * Ingress source types
 */
export type IngressSource = 'email' | 'messenger' | 'download'

/**
 * Identity hint for local-only identity handling
 * No remote identity resolution allowed
 */
export type IdentityHint =
  | 'unknown'
  | `email:${string}` // email:<sender>
  | 'local' // For messenger paste or downloaded file

// =============================================================================
// Raw Import Data
// =============================================================================

/**
 * Raw envelope data (may be partial)
 */
export interface RawEnvelopeData {
  /** Envelope ID if present */
  envelopeId?: string
  
  /** Envelope hash if present */
  envelopeHash?: string
  
  /** Signature status stub */
  signatureStatus?: 'unknown' | 'present' | 'invalid'
  
  /** Sender fingerprint if present */
  senderFingerprint?: string
  
  /** Receiver fingerprint if present */
  receiverFingerprint?: string
  
  /** Handshake reference if present */
  handshakeRef?: string
  
  /** Ingress channel */
  ingressChannel?: string
  
  /** Raw ingress declarations */
  ingressDeclarations?: Array<{
    type: string
    source: string
    verified?: boolean
  }>
  
  /** Raw egress declarations */
  egressDeclarations?: Array<{
    type: string
    target: string
    required?: boolean
  }>
  
  /** Creation timestamp */
  createdAt?: number
  
  /** Expiry timestamp */
  expiresAt?: number
}

/**
 * Raw capsule reference (NOT parsed content)
 */
export interface RawCapsuleRef {
  /** Capsule ID if present */
  capsuleId?: string
  
  /** Title/subject hint (from envelope metadata only) */
  titleHint?: string
  
  /** Attachment count hint */
  attachmentCountHint?: number
  
  /** Whether data request is present */
  hasDataRequestHint?: boolean
  
  /** Content length hint */
  contentLengthHint?: number
}

// =============================================================================
// Import Payload
// =============================================================================

/**
 * Raw import payload (stored, not parsed)
 */
export interface ImportPayload {
  /** Unique payload ID */
  payloadId: string
  
  /** Raw text/data */
  rawData: string
  
  /** MIME type if known */
  mimeType?: string
  
  /** Original filename if from file */
  originalFilename?: string
  
  /** Size in bytes */
  size: number
  
  /** Stored timestamp */
  storedAt: number
}

// =============================================================================
// Ingress Event (append-only log)
// =============================================================================

/**
 * Ingress event record (append-only)
 */
export interface IngressEvent {
  /** Unique event ID */
  eventId: string
  
  /** Associated message ID */
  messageId: string
  
  /** Ingress source */
  source: IngressSource
  
  /** Event timestamp */
  timestamp: number
  
  /** Pointer to stored raw import payload */
  rawRef: string
  
  /** Email provider ID (for email source) */
  emailProviderId?: string
  
  /** Email sender (for email source) */
  emailSender?: string
  
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Inbox Item (created by import)
// =============================================================================

/**
 * Canonical inbox item created by import
 */
export interface InboxImportItem {
  /** Local canonical message ID */
  messageId: string
  
  /** Ingress source */
  source: IngressSource
  
  /** Received/imported timestamp */
  receivedAt: number
  
  /** Raw envelope data (may be partial) */
  envelope: RawEnvelopeData
  
  /** Capsule reference (no parsing) */
  capsuleRef: RawCapsuleRef
  
  /** Signature status stub */
  signatureStatus: 'unknown' | 'present' | 'invalid'
  
  /** Verification state (always pending after import) */
  verificationState: 'pending_verification'
  
  /** Identity hint (local-only) */
  identityHint: IdentityHint
  
  /** Pointer to raw payload */
  rawRef: string
  
  /** Email provider ID if applicable */
  emailProviderId?: string
}

// =============================================================================
// Import Result
// =============================================================================

/**
 * Result of an import operation
 */
export interface ImportResult {
  /** Whether import succeeded */
  success: boolean
  
  /** Created message ID */
  messageId?: string
  
  /** Error message if failed */
  error?: string
  
  /** Ingress event ID */
  eventId?: string
}

// =============================================================================
// Import Validation
// =============================================================================

/**
 * Minimal validation result (no parsing)
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  
  /** Error message if invalid */
  error?: string
  
  /** Detected format hint */
  formatHint?: 'beap-package' | 'beap-insert' | 'unknown'
  
  /** Extracted envelope data (minimal, no parsing) */
  envelopeHint?: Partial<RawEnvelopeData>
  
  /** Extracted capsule reference (minimal) */
  capsuleHint?: Partial<RawCapsuleRef>
}

// =============================================================================
// Email Import Specific
// =============================================================================

/**
 * Email candidate for import
 */
export interface EmailCandidate {
  /** Email message ID */
  emailId: string
  
  /** Provider ID */
  providerId: string
  
  /** Sender email */
  sender: string
  
  /** Subject line */
  subject: string
  
  /** Received timestamp */
  receivedAt: number
  
  /** Whether it appears to contain BEAP content */
  hasBeapContent: boolean
  
  /** Preview text */
  preview?: string
}

