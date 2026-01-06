/**
 * BEAP Builder Module
 * 
 * Unified BEAP Builder with Silent and Explicit modes.
 * Single implementation shared across WR Chat, Drafts, and content scripts.
 * 
 * ARCHITECTURE (v2):
 * - Envelope: Authoritative, read-only consent boundary
 * - Capsule: Editable task payload
 * - Builder opens automatically when envelope-relevant content present
 * 
 * SEND & DISPATCH (v2):
 * - Shared send pipeline for all contexts
 * - Delivery methods: email, messenger, download, chat
 * - Outbox tracking with state transitions
 * 
 * @version 2.1.0
 */

// Legacy types and store (for backwards compatibility)
export * from './types'
export * from './useBeapBuilder'
export * from './deliveryService'

// New canonical types (v2)
export * from './canonical-types'

// Dispatch types (v2.1)
export * from './dispatch-types'

// Boundary types (v2.1)
export * from './boundary-types'

// New capsule builder store (v2)
export {
  useCapsuleBuilder,
  useIsBuilderOpen,
  useEnvelopeSummary,
  useCapsuleDraft,
  useEnvelopeRequiresRegeneration,
  useBuilderValidationErrors
} from './useCapsuleBuilder'

// Shared helper
export {
  requiresBeapBuilder,
  canSendSilently,
  getBuilderRequiredReasons,
  type BuilderDecisionContext
} from './requiresBuilder'

// Send pipeline (v2.1)
export {
  sendBeapMessage,
  confirmMessengerSent,
  confirmDownloadDelivered,
  retryEmailSend
} from './sendPipeline'

// Send hooks (v2.1)
export { useSendBeapMessage } from './useSendBeapMessage'
export { useWRChatSend, useQuickSend } from './useWRChatSend'

// Outbox store (v2.1)
export {
  useOutboxStore,
  useOutboxEntries,
  usePendingOutboxEntries,
  useOutboxStatusCounts,
  useOutboxEntry
} from './useOutboxStore'

// Envelope generator store (v2.1)
export {
  useEnvelopeGenerator,
  useExecutionBoundary,
  useEnvelopeDisplaySummary,
  useIsEnvelopeRegenerating,
  useEgressDeclaration,
  useIngressDeclaration,
  useGenerationCount
} from './useEnvelopeGenerator'

// Parser service (v2.3)
export {
  extractPdfText,
  processAttachmentForParsing,
  isParseableFormat,
  isParserServiceAvailable,
  assertNoSemanticContentInTransport,
  getSafeAttachmentInfo,
  rasterizePdf,
  processAttachmentForRasterization,
  type ParserResult,
  type ParserProvenance,
  type RasterResult,
  type RasterPageData
} from './parserService'

// Legacy components
export { BeapBuilderModal } from './components/BeapBuilderModal'
export { DeliveryOptions } from './components/DeliveryOptions'

// New capsule builder components (v2)
export {
  BeapCapsuleBuilder,
  EnvelopeSection,
  CapsuleSection,
  ExecutionBoundarySection,
  ExecutionBoundaryPanel,
  EnvelopeSummaryPanel,
  EnvelopeBadge
} from './components'

