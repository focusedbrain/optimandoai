/**
 * Identifies which function the multi-trigger bar is currently controlling.
 * 'watchdog' is the default. Each auto-optimizer project with an allocated icon
 * gets its own entry identified by projectId.
 */
export type TriggerFunctionId =
  | { type: 'watchdog' }
  | { type: 'auto-optimizer'; projectId: string }
  /** Pinned custom automation row — only modes with `metadata.triggerBarIcon` set appear in the bar. */
  | { type: 'custom-automation'; modeId: string }

/**
 * Chat focus mode — determines how WRChat behaves when the speech bubble is clicked.
 * This is NOT the same as wrChatRuntimeSurface ('dashboard' | 'popup').
 * This controls the conversational focus/context of the chat.
 */
export type ChatFocusMode =
  | { mode: 'default' }
  | { mode: 'scam-watchdog' }
  | {
      mode: 'auto-optimizer'
      projectId: string
      projectTitle: string
      startedAt: string
      projectIcon?: string
      milestoneTitle?: string
      runId?: string
      activeMilestoneId?: string
    }
  | {
      mode: 'custom-automation'
      modeId: string
      modeName: string
      triggerBarIcon: string
      startedAt: string
    }

/**
 * Minimal project info needed by the extension sidepanel trigger bar.
 * Synced from Electron useProjectStore — only projects with icons.
 */
export interface TriggerProjectEntry {
  projectId: string
  title: string
  /** Emoji or icon id — only projects WITH icons appear */
  icon: string
  activeMilestoneTitle?: string
  /** When set, extension can map orchestrator session → auto-optimizer project */
  linkedSessionIds?: string[]
}

/**
 * Dropdown item for the multi-trigger bar.
 */
export interface TriggerDropdownItem {
  /** 'watchdog' or projectId */
  id: string
  label: string
  /** Emoji/SVG identifier */
  icon: string
  functionId: TriggerFunctionId
}
