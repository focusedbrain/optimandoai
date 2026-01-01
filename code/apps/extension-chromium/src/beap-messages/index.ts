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
  BeapDraftComposer
} from './components'

// Seed data (for development)
export { SEED_MESSAGES, getSeedMessagesByFolder } from './seedData'

