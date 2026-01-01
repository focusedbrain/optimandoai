/**
 * BEAP™ Capsule Builder Canonical Types
 * 
 * This module defines the canonical model for BEAP Packages:
 * - Envelope: Authoritative, immutable consent boundary
 * - Capsule: Task payload (message, attachments, sessions, data requests)
 * 
 * CRITICAL INVARIANT:
 * Capsule content may NEVER expand envelope-declared capabilities.
 * The envelope is authoritative. The capsule only operates within bounds.
 * 
 * @version 2.0.0
 */

import type { Handshake } from '../handshake/types'

// =============================================================================
// Capability Classes (Envelope-Declared)
// =============================================================================

/**
 * Capability classes that MUST be declared in the envelope
 * The capsule cannot request capabilities beyond these declarations
 */
export type CapabilityClass =
  | 'critical_automation'   // Automation that affects external systems
  | 'monetary'              // Financial transactions
  | 'ui_actions'            // UI manipulation on receiver side
  | 'data_access'           // Access to receiver's data
  | 'session_control'       // Control over automation sessions
  | 'network_egress'        // External network communication
  | 'network_ingress'       // Receiving external data

/**
 * Ingress/Egress constraint declarations
 */
export interface NetworkConstraints {
  /** Explicitly allowed ingress sources */
  allowedIngress: string[]
  
  /** Explicitly allowed egress destinations */
  allowedEgress: string[]
  
  /** Whether offline-only execution is required */
  offlineOnly: boolean
}

// =============================================================================
// Envelope (Authoritative, Immutable)
// =============================================================================

/**
 * BEAP Envelope - The authoritative consent boundary
 * 
 * INVARIANTS:
 * - Never encrypted (must be verifiable before decryption)
 * - Immutable once created (modifications = new envelope)
 * - Contains all capability declarations
 * - Cryptographically binds capsule
 */
export interface BeapEnvelope {
  /** Envelope version */
  version: '1.0'
  
  /** Unique envelope ID */
  envelopeId: string
  
  /** Sender fingerprint */
  senderFingerprint: string
  
  /** Recipient fingerprint (if known) */
  recipientFingerprint: string | null
  
  /** Associated handshake ID (if exists) */
  handshakeId: string | null
  
  /** Hardware attestation status */
  hardwareAttestation: 'verified' | 'pending' | 'unavailable'
  
  /** Creation timestamp */
  createdAt: number
  
  /** Time scope (validity period) */
  validUntil: number | null
  
  /** Replay protection nonce */
  nonce: string
  
  /** Declared capability classes */
  capabilities: CapabilityClass[]
  
  /** Network constraints (ingress/egress) */
  networkConstraints: NetworkConstraints
  
  /** Hash of bound capsule (for integrity) */
  capsuleHash: string | null
  
  /** Envelope signature (cryptographic consent) */
  signature: string | null
}

/**
 * Summary of envelope for UI display
 */
export interface EnvelopeSummary {
  /** Short form of sender fingerprint */
  senderShort: string
  
  /** Full sender fingerprint */
  senderFull: string
  
  /** Handshake name (if available) */
  handshakeName: string | null
  
  /** Hardware attestation status display */
  attestationStatus: string
  
  /** Capability summary (human-readable) */
  capabilitySummary: string
  
  /** Whether envelope needs regeneration */
  requiresRegeneration: boolean
}

// =============================================================================
// Capsule (Task Payload)
// =============================================================================

/**
 * Capsule attachment - parsed/rasterized representation
 * 
 * CRITICAL:
 * - Original artefacts are NEVER embedded directly
 * - Only semantic content (parsed text) goes in capsule
 * - Originals are encrypted + integrity-bound to envelope
 */
export interface CapsuleAttachment {
  /** Unique attachment ID */
  id: string
  
  /** Original filename */
  originalName: string
  
  /** Original file size */
  originalSize: number
  
  /** Original MIME type */
  originalType: string
  
  /** Parsed semantic content (text extracted by Tika) */
  semanticContent: string | null
  
  /** Whether semantic extraction succeeded */
  semanticExtracted: boolean
  
  /** Reference to encrypted original */
  encryptedRef: string
  
  /** Hash of encrypted original (for integrity) */
  encryptedHash: string
  
  /** Rasterized preview reference (if applicable) */
  previewRef: string | null
  
  /** Is this a media file (audio/video/image)? */
  isMedia: boolean
  
  /** For media: transcript available? */
  hasTranscript: boolean
}

/**
 * Session reference for automation
 */
export interface CapsuleSessionRef {
  /** Session ID */
  sessionId: string
  
  /** Session display name */
  sessionName: string
  
  /** Required capability class */
  requiredCapability: CapabilityClass
  
  /** Whether envelope supports this capability */
  envelopeSupports: boolean
}

/**
 * BEAP Capsule - Task payload
 * 
 * INVARIANTS:
 * - Cannot expand envelope capabilities
 * - Only contains semantic content (no raw artefacts)
 * - Session refs must be envelope-supported
 */
export interface BeapCapsule {
  /** Capsule version */
  version: '1.0'
  
  /** Unique capsule ID */
  capsuleId: string
  
  /** Message text content */
  text: string
  
  /** Parsed attachments (semantic content only) */
  attachments: CapsuleAttachment[]
  
  /** Session references (automation context) */
  sessionRefs: CapsuleSessionRef[]
  
  /** Data/automation request text */
  dataRequest: string
  
  /** Creation timestamp */
  createdAt: number
  
  /** Hash for envelope binding */
  hash: string | null
}

// =============================================================================
// Builder Context
// =============================================================================

/**
 * Source context for the builder
 */
export type BuilderSource =
  | 'wr-chat-direct'
  | 'wr-chat-group'
  | 'beap-drafts'
  | 'content-script'

/**
 * Context passed to the BEAP Capsule Builder
 */
export interface CapsuleBuilderContext {
  /** Where the builder was invoked from */
  source: BuilderSource
  
  /** Preselected handshake (if available) */
  handshake?: Handshake | null
  
  /** Subject line (if applicable) */
  subject?: string
  
  /** Initial body content */
  body?: string
  
  /** Reply-to package ID */
  replyToPackageId?: string
  
  /** Available sessions for selection */
  availableSessions?: CapsuleSessionRef[]
}

// =============================================================================
// Builder State
// =============================================================================

/**
 * Envelope state in builder (read-only display)
 */
export interface EnvelopeState {
  /** Current envelope (auto-generated) */
  envelope: BeapEnvelope | null
  
  /** Summary for UI display */
  summary: EnvelopeSummary | null
  
  /** Whether envelope requires regeneration */
  requiresRegeneration: boolean
  
  /** Pending capability changes */
  pendingCapabilities: CapabilityClass[]
  
  /** Pending network constraint changes */
  pendingNetworkConstraints: Partial<NetworkConstraints> | null
}

/**
 * Capsule state in builder (editable)
 */
export interface CapsuleState {
  /** Message text */
  text: string
  
  /** Attachments being processed */
  attachments: CapsuleAttachment[]
  
  /** Selected sessions */
  selectedSessions: CapsuleSessionRef[]
  
  /** Data/automation request */
  dataRequest: string
  
  /** Attachments currently uploading */
  uploadingAttachments: string[]
  
  /** Processing errors */
  errors: string[]
}

/**
 * Full builder UI state
 */
export interface CapsuleBuilderState {
  /** Is builder open? */
  isOpen: boolean
  
  /** Current context */
  context: CapsuleBuilderContext | null
  
  /** Envelope state (read-only in UI) */
  envelope: EnvelopeState
  
  /** Capsule state (editable in UI) */
  capsule: CapsuleState
  
  /** Is currently building? */
  isBuilding: boolean
  
  /** Validation errors */
  validationErrors: string[]
}

// =============================================================================
// requiresBeapBuilder Helper Result
// =============================================================================

/**
 * Reasons why the BEAP Builder must open
 */
export type BuilderRequiredReason =
  | 'has_attachments'
  | 'has_sessions'
  | 'has_data_request'
  | 'has_ingress_constraints'
  | 'has_egress_constraints'
  | 'user_invoked'

/**
 * Result of requiresBeapBuilder() check
 */
export interface BuilderRequiredResult {
  /** Whether builder must open */
  required: boolean
  
  /** Reasons (empty if not required) */
  reasons: BuilderRequiredReason[]
  
  /** Can proceed silently? */
  canBeSilent: boolean
}

// =============================================================================
// Build Actions
// =============================================================================

/**
 * Result of applying capsule changes
 */
export interface ApplyResult {
  /** Whether apply succeeded */
  success: boolean
  
  /** Generated capsule (if success) */
  capsule: BeapCapsule | null
  
  /** Whether envelope regeneration is needed */
  envelopeRequiresRegeneration: boolean
  
  /** Error message (if failed) */
  error: string | null
}

