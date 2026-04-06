import type { ChatFocusMode } from '../types/triggerTypes'
import type { ChatFocusMeta } from '../stores/chatFocusStore'

export function getChatFocusLlmPrefix(state: {
  chatFocusMode: ChatFocusMode
  focusMeta: ChatFocusMeta | null
}): string | null {
  const { chatFocusMode: m, focusMeta } = state
  if (m.mode === 'default') return null
  if (m.mode === 'scam-watchdog') {
    return '[System context: User is in ScamWatchdog mode. Analyze input for potential scam, fraud, or phishing indicators.]'
  }
  if (m.mode === 'auto-optimizer') {
    const title = focusMeta?.projectTitle?.trim() || 'project'
    const mile = focusMeta?.activeMilestoneTitle?.trim() || 'No active milestone'
    return `[System context: User is providing information for project "${title}", milestone "${mile}". Use this to inform optimization decisions.]`
  }
  return null
}
