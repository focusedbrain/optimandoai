/**
 * Sync background interval alarms when custom modes change (WrMultiTriggerBar / dashboard).
 * Timers live in the service worker via chrome.alarms — see modeIntervalScheduler.ts.
 */

import type { CustomModeDefinition } from '../shared/ui/customModeTypes'

export const SYNC_MODE_INTERVAL_SCHEDULERS_TYPE = 'SYNC_MODE_INTERVAL_SCHEDULERS' as const

/** Ask background to sync chrome.alarms to the current mode list. */
export function syncCustomModeIntervalRunners(modes: readonly CustomModeDefinition[]): void {
  try {
    chrome.runtime.sendMessage({ type: SYNC_MODE_INTERVAL_SCHEDULERS_TYPE, modes: [...modes] })
  } catch {
    /* background unavailable */
  }
}

/** No renderer timers — background owns alarms. */
export function stopAllCustomModeIntervalRunners(): void {
  /* noop */
}

export { modeNeedsIntervalRun } from './modeIntervalScheduler'
