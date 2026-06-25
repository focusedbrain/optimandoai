import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import {
  modeIntervalAlarmName,
  modeNeedsIntervalRun,
  parseModeIdFromIntervalAlarm,
  syncModeIntervalSchedulers,
} from '../modeIntervalScheduler'
import { createDefaultScamWatchdogBuiltInMode } from '../../shared/ui/scamWatchdogBuiltIn'
import type { CustomModeDefinition } from '../../shared/ui/customModeTypes'

const customMode = (partial: Partial<CustomModeDefinition>): CustomModeDefinition =>
  ({
    id: 'custom:abc',
    type: 'custom',
    name: 'My Mode',
    modelProvider: 'ollama',
    modelName: '',
    endpoint: '',
    sessionId: 'session_linked_1',
    sessionMode: 'shared',
    systemInstructions: '',
    searchFocus: '',
    ignoreInstructions: '',
    intervalSeconds: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }) as CustomModeDefinition

describe('modeIntervalScheduler', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      alarms: {
        create: vi.fn(),
        clear: vi.fn(async () => true),
        get: vi.fn(async () => null),
        getAll: vi.fn(async () => []),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parseModeIdFromIntervalAlarm extracts mode id', () => {
    expect(parseModeIdFromIntervalAlarm(modeIntervalAlarmName('custom:xyz'))).toBe('custom:xyz')
    expect(parseModeIdFromIntervalAlarm('other')).toBeNull()
  })

  it('modeNeedsIntervalRun requires sessionId and intervalSeconds', () => {
    expect(modeNeedsIntervalRun(customMode({ intervalSeconds: 30 }))).toBe(true)
    expect(modeNeedsIntervalRun(customMode({ sessionId: null, intervalSeconds: 30 }))).toBe(false)
    expect(modeNeedsIntervalRun(customMode({ intervalSeconds: null }))).toBe(false)
    expect(modeNeedsIntervalRun(createDefaultScamWatchdogBuiltInMode())).toBe(false)
  })

  it('syncModeIntervalSchedulers creates alarm for eligible modes', async () => {
    await syncModeIntervalSchedulers([customMode({ id: 'custom:run', intervalSeconds: 15 })])
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      modeIntervalAlarmName('custom:run'),
      expect.objectContaining({ delayInMinutes: 0.25 }),
    )
  })

  it('syncModeIntervalSchedulers clears alarm when interval removed', async () => {
    await syncModeIntervalSchedulers([customMode({ intervalSeconds: null })])
    expect(chrome.alarms.clear).toHaveBeenCalledWith(modeIntervalAlarmName('custom:abc'))
  })
})
