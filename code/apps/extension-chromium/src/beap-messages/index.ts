/**
 * BEAP Messages Module
 * 
 * Exports types, store, and components for BEAP message lists.
 * Includes Outbox-specific components with delivery tracking.
 * 
 * @version 2.0.0
 */

// Types
export * from './types'

// Store
export { useBeapMessagesStore } from './useBeapMessagesStore'
export {
  useInboxMessages,
  useOutboxMessages,
  useArchivedMessages,
  useRejectedMessages,
  useSelectedMessage,
  useSearchQuery
} from './useBeapMessagesStore'

// Components
export { 
  BeapMessageListView, 
  BeapMessageRow, 
  BeapMessagePreview,
  OutboxMessagePreview,
  BeapDraftComposer,
  RecipientModeSwitch,
  RecipientHandshakeSelect,
  DeliveryMethodPanel
} from './components'

// Component types
export type { RecipientMode, SelectedRecipient, DeliveryMethod } from './components'

// Services
export {
  validatePackageConfig,
  canBuildPackage,
  buildPackage,
  executeDeliveryAction,
  executeEmailAction,
  executeMessengerAction,
  executeDownloadAction,
  BeapCanonViolationError
} from './services'
export type {
  BeapPackageConfig,
  BeapPackage,
  PackageBuildResult,
  DeliveryResult,
  ValidationResult
} from './services'

// Hooks
export { useBeapDraftActions } from './hooks'
export type {
  BeapDraftState,
  BeapDraftValidation,
  BeapDraftActions,
  UseBeapDraftActionsOptions
} from './hooks'

// Seed data (for development)
export { SEED_MESSAGES, getSeedMessagesByFolder } from './seedData'

