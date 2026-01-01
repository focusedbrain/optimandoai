/**
 * Audit Trail Types
 * 
 * Types for append-only, hash-chained audit events.
 * Provides tamper-evident logging for BEAP message lifecycle.
 * 
 * @version 1.0.0
 */

// =============================================================================
// Audit Event Types
// =============================================================================

/**
 * Canonical audit event types
 */
export type AuditEventType =
  // Ingress events
  | 'imported'
  
  // Verification events
  | 'verified.accepted'
  | 'verified.rejected'
  
  // Builder events
  | 'envelope.generated'
  | 'builder.applied'
  
  // Dispatch events
  | 'dispatched'
  | 'delivery.confirmed'
  | 'delivery.failed'
  
  // Reconstruction events
  | 'reconstructed.started'
  | 'reconstructed.completed'
  | 'reconstructed.failed'
  
  // Archival events
  | 'archived'
  
  // Export events
  | 'exported.audit'
  | 'exported.proof'

/**
 * Actor who triggered the event
 */
export type AuditActor = 'system' | 'user'

// =============================================================================
// Audit Event
// =============================================================================

/**
 * Reference hashes for integrity binding
 */
export interface AuditRefs {
  /** Envelope hash */
  envelopeHash?: string
  
  /** Capsule hash */
  capsuleHash?: string
  
  /** Artefact hashes */
  artefactHashes?: string[]
  
  /** Ingress event ID */
  ingressEventId?: string
  
  /** Dispatch event ID */
  dispatchEventId?: string
  
  /** Reconstruction record hash */
  reconstructionHash?: string
  
  /** Related message IDs */
  relatedMessageIds?: string[]
}

/**
 * Single audit event (immutable once created)
 */
export interface AuditEvent {
  /** Unique event ID */
  eventId: string
  
  /** Message ID this event belongs to */
  messageId: string
  
  /** Event type */
  type: AuditEventType
  
  /** Event timestamp */
  timestamp: number
  
  /** Actor who triggered the event */
  actor: AuditActor
  
  /** Human-readable summary */
  summary: string
  
  /** Reference hashes for integrity */
  refs: AuditRefs
  
  /** Hash of previous event in chain (null for first event) */
  prevEventHash: string | null
  
  /** Hash of this event */
  eventHash: string
  
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Audit Chain
// =============================================================================

/**
 * Complete audit chain for a message
 */
export interface AuditChain {
  /** Message ID */
  messageId: string
  
  /** All events in chronological order */
  events: AuditEvent[]
  
  /** Hash of the last event (chain head) */
  headHash: string
  
  /** Total event count */
  eventCount: number
  
  /** Chain created timestamp */
  createdAt: number
  
  /** Last event timestamp */
  lastEventAt: number
  
  /** Whether chain integrity is verified */
  integrityVerified: boolean
}

// =============================================================================
// Archive Record
// =============================================================================

/**
 * Archive record - frozen snapshot of message state
 */
export interface ArchiveRecord {
  /** Message ID */
  messageId: string
  
  /** Archive timestamp */
  archivedAt: number
  
  /** Archive actor */
  archivedBy: AuditActor
  
  /** Frozen message snapshot */
  messageSnapshot: {
    title: string
    status: string
    direction: string
    deliveryMethod: string
    timestamp: number
    fingerprint: string
    fingerprintFull?: string
    senderName?: string
    channelSite?: string
  }
  
  /** Envelope reference */
  envelopeRef: {
    envelopeHash: string
    summary?: Record<string, unknown>
  }
  
  /** Capsule reference */
  capsuleRef: {
    capsuleHash?: string
    semanticTextHash?: string
    attachmentCount: number
  }
  
  /** Reconstruction references */
  reconstructionRef?: {
    reconstructionHash: string
    semanticTextHashes: string[]
    rasterHashes: string[]
  }
  
  /** Ingress event IDs */
  ingressEventIds: string[]
  
  /** Dispatch event IDs */
  dispatchEventIds: string[]
  
  /** Audit chain hash at archive time */
  auditChainHash: string
  
  /** Rejection reason if rejected */
  rejectionReason?: {
    code: string
    summary: string
    details?: string
    timestamp: number
  }
}

// =============================================================================
// Export Types
// =============================================================================

/**
 * Audit log export format
 */
export interface AuditLogExport {
  /** Export format version */
  version: '1.0'
  
  /** Export timestamp */
  exportedAt: number
  
  /** Message identifier */
  messageId: string
  
  /** Audit events */
  events: AuditEvent[]
  
  /** Hash chain verification */
  chainVerification: {
    headHash: string
    eventCount: number
    verified: boolean
  }
  
  /** Export hash */
  exportHash: string
}

/**
 * Proof bundle manifest
 */
export interface ProofBundleManifest {
  /** Manifest format version */
  version: '1.0'
  
  /** Bundle creation timestamp */
  createdAt: number
  
  /** Message identifier */
  messageId: string
  
  /** Message summary */
  messageSummary: {
    title: string
    status: string
    direction: string
    timestamp: number
  }
  
  /** Included files with hashes */
  files: Array<{
    path: string
    type: 'envelope' | 'semantic_text' | 'raster' | 'audit_log' | 'rejection_reason'
    hash: string
    size: number
  }>
  
  /** Total bundle hash */
  bundleHash: string
  
  /** Verification instructions */
  verificationInstructions: string
}

/**
 * Proof bundle contents (for rejected messages)
 */
export interface RejectedProofBundle {
  manifest: ProofBundleManifest
  envelopeSummary: Record<string, unknown>
  rejectionReason: {
    code: string
    summary: string
    details?: string
    timestamp: number
  }
  auditLog: AuditLogExport
}

// =============================================================================
// Archival Eligibility
// =============================================================================

/**
 * Check result for archive eligibility
 */
export interface ArchiveEligibility {
  /** Whether archiving is allowed */
  eligible: boolean
  
  /** Reason if not eligible */
  reason?: string
  
  /** Message status */
  status: string
  
  /** Whether reconstruction is complete */
  hasReconstruction: boolean
  
  /** Whether delivery is confirmed (for outbox) */
  hasDeliveryConfirmation: boolean
}

