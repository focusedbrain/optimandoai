/**
 * Audit Module Index
 * 
 * Archival, audit trail & export for BEAP messages.
 * 
 * @version 1.0.0
 */

// Types
export type {
  AuditEventType,
  AuditActor,
  AuditRefs,
  AuditEvent,
  AuditChain,
  ArchiveRecord,
  AuditLogExport,
  ProofBundleManifest,
  RejectedProofBundle,
  ArchiveEligibility
} from './types'

// Audit Store
export {
  useAuditStore,
  useAuditEvents,
  useAuditChain,
  logImportEvent,
  logVerificationEvent,
  logDispatchEvent,
  logDeliveryEvent,
  logReconstructionEvent,
  logArchiveEvent,
  logExportEvent
} from './useAuditStore'

// Archival Service
export {
  checkArchiveEligibility,
  archiveMessage,
  storeArchiveRecord,
  getArchiveRecord,
  isArchived
} from './archivalService'

// Export Service
export {
  exportAuditLog,
  downloadAuditLog,
  buildProofBundle,
  downloadProofBundle,
  exportRejectedProof
} from './exportService'

// Components
export {
  AuditTrailPanel,
  ArchiveButton
} from './components'

