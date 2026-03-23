/**
 * BEAP Messages Components
 * 
 * Re-exports all BEAP message UI components.
 * Includes folder-specific preview components with verification support.
 */

export { BeapMessageListView } from './BeapMessageListView'
export { BeapMessageRow } from './BeapMessageRow'
export { BeapMessagePreview } from './BeapMessagePreview'
export { OutboxMessagePreview } from './OutboxMessagePreview'
export { InboxMessagePreview } from './InboxMessagePreview'
export { RejectedMessagePreview } from './RejectedMessagePreview'
export { BeapDraftComposer } from './BeapDraftComposer'

// Inbox sidebar — left-column message list styled like the Handshakes panel
export { BeapInboxSidebar } from './BeapInboxSidebar'

// Message detail panel — split-viewport: message content + AI output
export { BeapMessageDetailPanel } from './BeapMessageDetailPanel'
export type { BeapMessageDetailPanelProps, BeapMessageDetailPanelHandle } from './BeapMessageDetailPanel'

// Bulk inbox — power-user grid view for batch message processing
export { BeapBulkInbox } from './BeapBulkInbox'
export type { BeapBulkInboxProps, BeapBulkInboxHandle } from './BeapBulkInbox'

// Attachment reader — shared semantic content viewer
export { BeapAttachmentReader } from './BeapAttachmentReader'
export type { BeapAttachmentReaderProps } from './BeapAttachmentReader'

// Reply composer — shared component for inbox detail + bulk grid
export { BeapReplyComposer } from './BeapReplyComposer'
export type { BeapReplyComposerProps } from './BeapReplyComposer'

// Inbox view orchestrator — full inbox UX with sidebar + detail + bulk + nav
export { BeapInboxView } from './BeapInboxView'
export type { BeapInboxViewProps, BeapInboxViewHandle } from './BeapInboxView'

// Error boundary for inbox/builder (prevents blank panel on Linux or import failures)
export { InboxErrorBoundary } from './InboxErrorBoundary'

// Recipient selection components
export { RecipientModeSwitch } from './RecipientModeSwitch'
export type { RecipientMode, RecipientModeSwitchProps } from './RecipientModeSwitch'
export { RecipientHandshakeSelect } from './RecipientHandshakeSelect'
export type { SelectedHandshakeRecipient, RecipientHandshakeSelectProps } from './RecipientHandshakeSelect'
/** @deprecated Use SelectedHandshakeRecipient */
export type { SelectedRecipient } from './RecipientHandshakeSelect'

// Delivery method components
export { DeliveryMethodPanel } from './DeliveryMethodPanel'
export type { DeliveryMethod, DeliveryMethodPanelProps } from './DeliveryMethodPanel'

// Re-export at top-level for convenience
export type { SelectedHandshakeRecipient as BeapRecipient } from './RecipientHandshakeSelect'

