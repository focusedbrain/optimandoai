/**
 * Dashboard interval scheduling — mirrors MV3 `modeIntervalScheduler` using renderer timers
 * (chrome.alarms is unavailable in the dashboard chrome shim).
 */

import type { CustomModeDefinition } from '@ext/shared/ui/customModeTypes'
import { modeNeedsIntervalRun } from '@ext/services/modeIntervalScheduler'
import { SYNC_MODE_INTERVAL_SCHEDULERS_TYPE } from '@ext/services/modeIntervalRunner'
import { handleDashboardRunModeAllocatedSession } from './wrChatDashboardModeRunBridge'

export { SYNC_MODE_INTERVAL_SCHEDULERS_TYPE }

const intervalSecondsByModeId = new Map<string, number>()
const timersByModeId = new Map<string, ReturnType<typeof setTimeout>>()

function clearModeTimer(modeId: string): void {
  const t = timersByModeId.get(modeId)
  if (t) clearTimeout(t)
  timersByModeId.delete(modeId)
}

function scheduleModeIntervalTimer(modeId: string, intervalSeconds: number): void {
  clearModeTimer(modeId)
  const ms = Math.max(intervalSeconds, 1) * 1000
  const timer = setTimeout(() => {
    void handleDashboardModeIntervalTick(modeId)
  }, ms)
  timersByModeId.set(modeId, timer)
}

async function handleDashboardModeIntervalTick(modeId: string): Promise<void> {
  try {
    const { requestModeModelWarmOnTrigger } = await import('@ext/services/modeModelWarmOnTrigger')
    requestModeModelWarmOnTrigger(modeId, 'interval')
  } catch {
    /* noop */
  }

  try {
    const result = await handleDashboardRunModeAllocatedSession({
      modeId,
      trigger: 'interval',
      refreshIfActive: true,
    })
    if (result.busy) {
      console.log('[DashboardModeInterval] skipped — run in flight:', modeId)
    } else if (!result.ok && !result.skipped) {
      const { reportModeSessionRunResult } = await import('@ext/services/modeSessionRunResultReporting')
      reportModeSessionRunResult('DashboardModeInterval', modeId, 'interval', result)
    }
  } catch (e) {
    console.warn('[DashboardModeInterval] tick error:', modeId, e)
  } finally {
    const seconds = intervalSecondsByModeId.get(modeId)
    if (seconds) scheduleModeIntervalTimer(modeId, seconds)
  }
}

/** Sync renderer timers to the current mode list (same contract as background SYNC_MODE_INTERVAL_SCHEDULERS). */
export function syncDashboardModeIntervalSchedulers(modes: readonly CustomModeDefinition[]): void {
  const keep = new Set<string>()

  for (const def of modes) {
    if (!modeNeedsIntervalRun(def)) {
      intervalSecondsByModeId.delete(def.id)
      clearModeTimer(def.id)
      continue
    }

    keep.add(def.id)
    const seconds = Math.max(1, Number(def.intervalSeconds))
    const prev = intervalSecondsByModeId.get(def.id)
    intervalSecondsByModeId.set(def.id, seconds)
    if (prev !== seconds || !timersByModeId.has(def.id)) {
      scheduleModeIntervalTimer(def.id, seconds)
    }
  }

  for (const modeId of [...intervalSecondsByModeId.keys()]) {
    if (keep.has(modeId)) continue
    intervalSecondsByModeId.delete(modeId)
    clearModeTimer(modeId)
  }
}
