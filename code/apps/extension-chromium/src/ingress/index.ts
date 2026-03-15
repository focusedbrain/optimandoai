/**
 * Ingress Module Index
 * 
 * BEAP message ingress/import pipelines.
 * 
 * @version 1.0.0
 */

// Types
export type {
  IngressSource,
  IdentityHint,
  RawEnvelopeData,
  RawCapsuleRef,
  ImportPayload,
  IngressEvent,
  InboxImportItem,
  ImportResult,
  ValidationResult,
  EmailCandidate
} from './types'

// Store
export { useIngressStore, useIngressEvents, useRecentIngressEvents } from './useIngressStore'

// Import Pipeline
export {
  validateImportPayload,
  importBeapMessage,
  isEmailImportAvailable,
  getEmailCandidates,
  importFromEmail,
  importFromMessenger,
  importFromFile,
  // Stage 5: Sandbox isolation verification (Annex I §I.2 — Normative)
  verifyImportedMessage,
  type VerifyImportedMessageResult,
} from './importPipeline'

// Components
export {
  ImportEmailModal,
  ImportMessengerModal,
  ImportFileModal,
  InboxImportBar
} from './components'

