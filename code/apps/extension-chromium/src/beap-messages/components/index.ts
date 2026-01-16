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

// Recipient selection components
export { RecipientModeSwitch } from './RecipientModeSwitch'
export type { RecipientMode, RecipientModeSwitchProps } from './RecipientModeSwitch'
export { RecipientHandshakeSelect } from './RecipientHandshakeSelect'
export type { SelectedRecipient, RecipientHandshakeSelectProps } from './RecipientHandshakeSelect'

// Delivery method components
export { DeliveryMethodPanel } from './DeliveryMethodPanel'
export type { DeliveryMethod, DeliveryMethodPanelProps } from './DeliveryMethodPanel'

// Re-export SelectedRecipient at top-level for convenience
export type { SelectedRecipient as BeapRecipient } from './RecipientHandshakeSelect'

