/**
 * Visible reporting for mode-session run failures (not genuine busy skips).
 */

import type { RunModeAllocatedSessionAutomationResult } from './runModeAllocatedSessionAutomation'

export function reportModeSessionRunResult(
  logPrefix: string,
  modeId: string,
  trigger: string,
  result: RunModeAllocatedSessionAutomationResult,
): void {
  if (result.ok || result.skipped) return

  if ('timedOut' in result && result.timedOut) {
    console.warn(
      `[${logPrefix}] Mode session run timed out (${trigger}):`,
      modeId,
      result.error,
    )
    return
  }

  console.warn(`[${logPrefix}] Mode session run failed (${trigger}):`, modeId, result.error)
}
