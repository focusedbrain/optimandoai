/**
 * BEAP Messages Hooks
 */

export { 
  useBeapDraftActions,
  type BeapDraftState,
  type BeapDraftValidation,
  type BeapDraftActions,
  type UseBeapDraftActionsOptions
} from './useBeapDraftActions'

export { useBeapMessageAi } from './useBeapMessageAi'
export type { AiOutputEntry, AiOutputType } from './useBeapMessageAi'

// Bulk inbox classification hook — drives the AI engine + store updates + grace period manager
export { useBulkClassification } from './useBulkClassification'
export type {
  MessageClassificationStatus,
  MessageClassificationState,
  UseBulkClassificationConfig,
  UseBulkClassificationReturn,
} from './useBulkClassification'

// Reply composer hook — mode determination, send logic, AI draft generation
export { useReplyComposer, getResponseMode, deriveReplySubject, EMAIL_SIGNATURE } from './useReplyComposer'
export type {
  ReplyAttachment,
  ReplyComposerState,
  ReplyComposerActions,
  SendResult,
  UseReplyComposerConfig,
} from './useReplyComposer'

// Bulk send hook — "Send All Drafts" batch flow with progress + retry
export { useBulkSend } from './useBulkSend'
export type {
  BulkSendItemStatus,
  BulkSendItem,
  BulkSendProgress,
  UseBulkSendConfig,
  UseBulkSendReturn,
} from './useBulkSend'

// Responsive breakpoints
export { useMediaQuery, NARROW_VIEWPORT, BULK_GRID_1COL, BULK_GRID_3COL } from './useMediaQuery'

// Inbox keyboard navigation + custom events
export {
  useInboxKeyboardNav,
  onBeapFocusReply,
  onBeapToggleAi,
  onBeapSendReply,
  BEAP_FOCUS_REPLY_EVENT,
  BEAP_TOGGLE_AI_EVENT,
  BEAP_SEND_REPLY_EVENT,
} from './useInboxKeyboardNav'
export type {
  UseInboxKeyboardNavOptions,
  BeapMessageEventDetail,
} from './useInboxKeyboardNav'

