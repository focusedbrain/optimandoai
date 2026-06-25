/**
 * MV3 interval scheduling for session-linked custom modes (chrome.alarms).
 * Reschedules one-shot alarms so sub-minute presets (15s, 30s) work reliably.
 */

import type { CustomModeDefinition } from '../shared/ui/customModeTypes'
import { normalizeOrchestratorSessionKey } from '../lib/resolveOrchestratorSessionKey'
import { isScamWatchdogBuiltInMode } from '../shared/ui/scamWatchdogBuiltIn'
import { customModesClient } from './customModesClient'

export const MODE_INTERVAL_ALARM_PREFIX = 'mode-session-interval:'

const intervalSecondsByModeId = new Map<string, number>()

export function modeIntervalAlarmName(modeId: string): string {
  return `${MODE_INTERVAL_ALARM_PREFIX}${modeId.trim()}`
}

export function parseModeIdFromIntervalAlarm(alarmName: string): string | null {
  if (!alarmName.startsWith(MODE_INTERVAL_ALARM_PREFIX)) return null
  const id = alarmName.slice(MODE_INTERVAL_ALARM_PREFIX.length).trim()
  return id || null
}

export function modeNeedsIntervalRun(def: CustomModeDefinition): boolean {
  if (isScamWatchdogBuiltInMode(def)) return false
  const seconds = def.intervalSeconds
  if (seconds == null || seconds < 1) return false
  return !!normalizeOrchestratorSessionKey(def.sessionId)
}

function delayMinutesForInterval(seconds: number): number {
  return Math.max(seconds / 60, 15 / 60)
}

function scheduleModeIntervalAlarm(modeId: string, intervalSeconds: number): void {
  if (typeof chrome === 'undefined' || !chrome.alarms?.create) return
  try {
    chrome.alarms.create(modeIntervalAlarmName(modeId), {
      delayInMinutes: delayMinutesForInterval(intervalSeconds),
    })
  } catch (e) {
    console.warn('[ModeInterval] alarm create failed:', modeId, e)
  }
}

export async function clearAllModeIntervalAlarms(): Promise<void> {
  intervalSecondsByModeId.clear()
  if (typeof chrome === 'undefined' || !chrome.alarms?.getAll) return
  try {
    const alarms = await chrome.alarms.getAll()
    await Promise.all(
      alarms
        .filter((a) => a.name.startsWith(MODE_INTERVAL_ALARM_PREFIX))
        .map((a) => chrome.alarms.clear(a.name)),
    )
  } catch {
    /* noop */
  }
}

/** Sync alarms to the current mode list; clears alarms for removed/changed modes. */
export async function syncModeIntervalSchedulers(modes: readonly CustomModeDefinition[]): Promise<void> {
  const keep = new Set<string>()

  for (const def of modes) {
    if (!modeNeedsIntervalRun(def)) {
      const name = modeIntervalAlarmName(def.id)
      intervalSecondsByModeId.delete(def.id)
      try {
        await chrome.alarms?.clear?.(name)
      } catch {
        /* noop */
      }
      continue
    }

    keep.add(def.id)
    const seconds = Math.max(1, Number(def.intervalSeconds))
    const prev = intervalSecondsByModeId.get(def.id)
    intervalSecondsByModeId.set(def.id, seconds)
    if (prev !== seconds) {
      scheduleModeIntervalAlarm(def.id, seconds)
    } else if (typeof chrome !== 'undefined' && chrome.alarms?.get) {
      const name = modeIntervalAlarmName(def.id)
      const existing = await chrome.alarms.get(name).catch(() => null)
      if (!existing) scheduleModeIntervalAlarm(def.id, seconds)
    }
  }

  for (const modeId of [...intervalSecondsByModeId.keys()]) {
    if (keep.has(modeId)) continue
    intervalSecondsByModeId.delete(modeId)
    try {
      await chrome.alarms?.clear?.(modeIntervalAlarmName(modeId))
    } catch {
      /* noop */
    }
  }
}

export async function syncModeIntervalSchedulersFromStore(): Promise<void> {
  const listed = await customModesClient.list()
  if (!listed.ok) return
  await syncModeIntervalSchedulers(listed.data)
}

/** Reschedule the next tick after a run (or skip) completes. */
export function rescheduleModeIntervalAlarm(modeId: string): void {
  const seconds = intervalSecondsByModeId.get(modeId)
  if (seconds) scheduleModeIntervalAlarm(modeId, seconds)
}

export function getModeIntervalSeconds(modeId: string): number | undefined {
  return intervalSecondsByModeId.get(modeId)
}
