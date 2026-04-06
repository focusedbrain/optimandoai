/**
 * Shared UI Components Index
 * 
 * Export all mode-ready UI shell components.
 */

export { ModeSelect } from './ModeSelect'
export { CustomModeWizard } from './CustomModeWizard'
export { AddModeWizardHost } from './AddModeWizardHost'
export { ComposerToolbelt } from './ComposerToolbelt'
export { AIAssistPopover } from './AIAssistPopover'
export { ModeHeaderBadge } from './ModeHeaderBadge'
export { CommandChatView } from './CommandChatView'
export { PopupChatView } from './PopupChatView'
export { WrChatCaptureButton, WrChatCaptureIcon } from './WrChatCaptureButton'
export { DiffTriggerDialog, type DiffTrigger, type DiffTriggerDialogProps } from './DiffTriggerDialog'
export { WrChatDiffButton, WrChatDiffIcon, type WrChatDiffButtonProps } from './WrChatDiffButton'
export { default as WatchdogIcon, WATCHDOG_EMOJI } from './WatchdogIcon'
export type { WatchdogThreat } from '../../utils/formatWatchdogAlert'
export { formatWatchdogAlert } from '../../utils/formatWatchdogAlert'

export {
  WrMultiTriggerBar,
  WRCHAT_CHAT_FOCUS_REQUEST_EVENT,
  WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT,
  type WrMultiTriggerBarProps,
  TriggerButtonShell,
  type TriggerButtonShellProps,
} from './wrMultiTrigger'

export {
  useChatFocusStore,
  WRCHAT_APPEND_ASSISTANT_EVENT,
  type ChatFocusMeta,
} from '../../stores/chatFocusStore'

export {
  useActiveCustomModeRuntime,
  getActiveCustomModeRuntime,
  getEffectiveLlmModelNameForActiveMode,
  type CustomModeRuntimeConfig,
} from '../../stores/activeCustomModeRuntime'

/** @deprecated Use WrMultiTriggerBar */
export { default as WrChatWatchdogButton, type WrChatWatchdogButtonProps } from './WrChatWatchdogButton'
export { startWrChatScreenCapture } from './wrChatCaptureDispatch'
export { P2PChatPlaceholder } from './P2PChatPlaceholder'
export { P2PStreamPlaceholder } from './P2PStreamPlaceholder'
export { GroupChatPlaceholder } from './GroupChatPlaceholder'
export { AdminPoliciesPlaceholder } from './AdminPoliciesPlaceholder'

export type {
  TriggerFunctionId,
  ChatFocusMode,
  TriggerProjectEntry,
  TriggerDropdownItem,
} from '../../types/triggerTypes'



