/**
 * BEAP Builder Module
 *
 * Canonical types, envelope/capsule assembly, and shared helpers
 * for BEAP message construction. Legacy stores (useBeapBuilder,
 * useCapsuleBuilder, deliveryService, sendPipeline) have been removed —
 * handshake sends use handshakeRpc.ts / handshakeRefresh.ts.
 *
 * @version 3.0.0
 */

// Types — dispatch-types takes precedence for DeliveryMethod / DeliveryConfig
export {
  type BuilderMode,
  type BuilderContext,
  type BuilderAttachment,
  type ModeTriggerResult,
  type ExplicitModeReason,
  type SilentBuildRequest,
  type ExplicitBuildRequest,
  type BeapBuildResult,
  type BuilderState,
} from './types'
export * from './canonical-types'
export * from './dispatch-types'
export * from './boundary-types'

// Shared helper
export {
  requiresBeapBuilder,
  canSendSilently,
  getBuilderRequiredReasons,
  type BuilderDecisionContext
} from './requiresBuilder'

// Handshake refresh (proof-only context references, no content)
export {
  sendViaHandshakeRefresh,
  buildContextBlockProofs,
  buildContextBlocks,
  type UserMessage,
  type HandshakeRefreshResult
} from './handshakeRefresh'

// Outbox store
export {
  useOutboxStore,
  useOutboxEntries,
  usePendingOutboxEntries,
  useOutboxStatusCounts,
  useOutboxEntry
} from './useOutboxStore'

// Envelope generator store
export {
  useEnvelopeGenerator,
  useExecutionBoundary,
  useEnvelopeDisplaySummary,
  useIsEnvelopeRegenerating,
  useEgressDeclaration,
  useIngressDeclaration,
  useGenerationCount
} from './useEnvelopeGenerator'

// Parser service
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

// Components (active)
export { DeliveryOptions } from './components/DeliveryOptions'
export {
  EnvelopeSection,
  CapsuleSection,
  ExecutionBoundarySection,
  ExecutionBoundaryPanel,
  EnvelopeSummaryPanel,
  EnvelopeBadge
} from './components'

