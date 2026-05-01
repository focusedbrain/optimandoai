/**
 * Records the last dashboard speech-bubble (💬) open so WR Chat embed can correlate
 * focus activation with model sync / sends. Renderer-only; no message bodies.
 */

import type { TriggerFunctionId } from '@ext/types/triggerTypes'

export type DashboardWrChatSpeechOpenMeta = {
  origin: 'dashboard_wrchat'
  activation: 'speech_icon'
  dashboardModeKey: string
  recordedAt: number
}

let lastSpeechOpen: DashboardWrChatSpeechOpenMeta | null = null

export function dashboardModeKeyFromTriggerFunctionId(fid: TriggerFunctionId): string {
  if (fid.type === 'watchdog') return 'scam_watchdog'
  if (fid.type === 'auto-optimizer') return `project_wiki:${fid.projectId}`
  if (fid.type === 'custom-automation') return `custom_automation:${fid.modeId}`
  if (fid.type === 'composer-shortcut') return `composer:${fid.composerId}`
  return 'unknown'
}

/** Call from `App.ensureWrChatOpenThen` before switching to the WR Chat view. */
export function recordDashboardWrChatSpeechIconOpen(dashboardModeKey: string): void {
  lastSpeechOpen = {
    origin: 'dashboard_wrchat',
    activation: 'speech_icon',
    dashboardModeKey,
    recordedAt: Date.now(),
  }
}

/** Peek-only — activation stays until the next speech open (not consumed). */
export function peekDashboardWrChatSpeechOpenMeta(): DashboardWrChatSpeechOpenMeta | null {
  return lastSpeechOpen
}

/** Non–speech-icon navigations to WR Chat should not reuse the last 💬 activation in logs / context. */
export function clearDashboardWrChatSpeechOpenMeta(): void {
  lastSpeechOpen = null
}
