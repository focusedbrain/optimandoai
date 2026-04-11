/**
 * BEAP Messages Module
 * 
 * Exports types, store, and components for BEAP message lists.
 * Includes Outbox-specific components with delivery tracking.
 * 
 * @version 2.1.0
 */

// Types
export * from './types'

// Inbox domain model types
export type {
  BeapMessage,
  BeapAttachment,
  AiClassification,
  DraftReply,
  DeletionSchedule,
  BulkViewPage,
  TrustLevel,
  UrgencyLevel,
  ReplyMode,
} from './beapInboxTypes'

// Store — legacy UI folder model (inbox/outbox/archived/rejected display)
export { useBeapMessagesStore } from './useBeapMessagesStore'
export {
  useInboxMessages,
  useOutboxMessages,
  useArchivedMessages,
  useRejectedMessages,
  useSelectedMessage,
  useSearchQuery
} from './useBeapMessagesStore'

// Store — canonical inbox domain model (inbox, handshake view, bulk inbox)
export { useBeapInboxStore } from './useBeapInboxStore'
export {
  useInboxView,
  useHandshakeMessages,
  useBulkViewPage,
  usePendingDeletionMessages,
  useUrgentMessages,
  useSelectedBeapMessage,
} from './useBeapInboxStore'

// Mapper: SanitisedDecryptedPackage → BeapMessage
export { sanitisedPackageToBeapMessage } from './sanitisedPackageToBeapMessage'

// Session export payload resolution (BEAP inbox → canonical session import)
export {
  resolveBeapSessionImportPayload,
  beapSessionImportActionsEnabled,
  beapSessionImportUiHint,
  isLikelySessionJsonAttachment,
  sessionJsonHasImportableSubstance,
} from './sessionImportPayloadResolver'
export type {
  BeapSessionImportResolution,
  BeapSessionImportResolutionValid,
  BeapSessionImportResolutionInvalid,
  BeapSessionImportResolutionNone,
} from './sessionImportPayloadResolver'

export {
  requestBeapSessionEditInActiveTab,
  BEAP_EDIT_SESSION_IMPORT_TYPE,
  type BeapSessionEditImportResponse,
} from './beapSessionEditBridge'

export {
  requestBeapRunAutomationInActiveTab,
  readBeapRunFallbackLlmModel,
  BEAP_RUN_AUTOMATION_TYPE,
  type BeapRunAutomationResponse,
  type BeapRunAutomationSuccess,
  type BeapRunAutomationFailure,
} from './beapSessionRunBridge'

export {
  narrowBeapImportPayloadForBridge,
  narrowBeapFallbackModel,
  assertBeapTabImportPayload,
} from './beapSessionBridgeGuards'
export type { BeapImportPayloadGuardResult } from './beapSessionBridgeGuards'

// Integration-scoped default automation metadata (not mode_trigger / not agent.icon)
export {
  BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY,
  validateBeapIntegrationIdentity,
  beapIntegrationIdentityFromMessage,
  beapIntegrationStableKey,
  emptyBeapIntegrationDefaultAutomationRoot,
  parseBeapIntegrationDefaultAutomationRoot,
  serializeBeapIntegrationDefaultAutomationRoot,
  loadBeapIntegrationDefaultAutomationRoot,
  saveBeapIntegrationDefaultAutomationRoot,
  getBeapIntegrationDefaultAutomationEntry,
  upsertBeapIntegrationDefaultAutomationEntry,
} from './integrationDefaultAutomationMetadata'
export type {
  BeapIntegrationIdentityV1,
  BeapIntegrationDefaultAutomationEntryV1,
  BeapIntegrationDefaultAutomationRootV1,
} from './integrationDefaultAutomationMetadata'

// Components
export { 
  BeapMessageListView, 
  BeapMessageRow, 
  BeapMessagePreview,
  OutboxMessagePreview,
  BeapDraftComposer,
  RecipientModeSwitch,
  RecipientHandshakeSelect,
  DeliveryMethodPanel,
  BeapInboxSidebar,
  BeapMessageDetailPanel,
  BeapBulkInbox,
  BeapReplyComposer,
} from './components'
export type { BeapMessageDetailPanelProps, BeapMessageDetailPanelHandle } from './components'
export type { BeapBulkInboxProps, BeapBulkInboxHandle } from './components'
export type { BeapReplyComposerProps } from './components'

// Component types
export type { RecipientMode, SelectedHandshakeRecipient, SelectedRecipient, DeliveryMethod } from './components'

// Services
export {
  validatePackageConfig,
  canBuildPackage,
  buildPackage,
  executeDeliveryAction,
  executeEmailAction,
  executeMessengerAction,
  executeDownloadAction,
  BeapCanonViolationError,
  // Classification engine
  heuristicClassify,
  projectContent,
  classifyBatch,
  selectMessagesForAutoDeletion,
  toStoreClassificationMap,
} from './services'
export type {
  BeapPackageConfig,
  BeapPackage,
  PackageBuildResult,
  DeliveryResult,
  ValidationResult,
  // Classification engine types
  ClassificationResult,
  ProjectedContent,
  AIProvider,
  ClassificationContext,
  AiClassificationResponse,
  ClassificationProgressEvent,
  ClassificationEngineConfig,
} from './services'

// Hooks
export {
  useBeapDraftActions,
  useBeapMessageAi,
  useBulkClassification,
  useReplyComposer,
  getResponseMode,
  deriveReplySubject,
  EMAIL_SIGNATURE,
  useBulkSend,
  useBeapSessionImportResolution,
} from './hooks'
export type {
  BeapDraftState,
  BeapDraftValidation,
  BeapDraftActions,
  UseBeapDraftActionsOptions,
  AiOutputEntry,
  AiOutputType,
  MessageClassificationStatus,
  MessageClassificationState,
  UseBulkClassificationConfig,
  UseBulkClassificationReturn,
  ReplyAttachment,
  ReplyComposerState,
  ReplyComposerActions,
  SendResult,
  UseReplyComposerConfig,
  BulkSendItemStatus,
  BulkSendItem,
  BulkSendProgress,
  UseBulkSendConfig,
  UseBulkSendReturn,
} from './hooks'

// Seed data (for development)
export { SEED_MESSAGES, getSeedMessagesByFolder } from './seedData'

// PQ auth init — call from sidepanel/popup on mount so qBEAP can reach Electron PQ API
export { setPqAuthHeadersProvider } from './services'
export { initBeapPqAuth } from './initBeapPqAuth'

