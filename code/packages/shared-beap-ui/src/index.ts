// Components
export { CapsuleFields } from './CapsuleFields'
export { SessionSelector } from './SessionSelector'
export { AttachmentPicker } from './AttachmentPicker'
export { BeapMessageBody } from './BeapMessageBody'
export { BeapIdentityBadge } from './BeapIdentityBadge'

// Types
export type {
  CapsuleDraftState,
  SessionOption,
  AttachmentItem,
  BeapMessageBodySessionRef,
} from './types'

// Props types (for consumers that need to type-check)
export type { CapsuleFieldsProps } from './CapsuleFields'
export type { SessionSelectorProps } from './SessionSelector'
export type { AttachmentPickerProps } from './AttachmentPicker'
export type { BeapMessageBodyProps } from './BeapMessageBody'
export type { BeapIdentityBadgeProps } from './BeapIdentityBadge'

// Styles — consumers must import this OR include beap-ui.css in their build
import './styles/beap-ui.css'
