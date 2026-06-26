import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import {
  modeHasAllocatedSession,
  resolveModeAllocatedSessionRun,
  runModeAllocatedSessionAutomation,
} from '../runModeAllocatedSessionAutomation'
import { createDefaultScamWatchdogBuiltInMode } from '../../shared/ui/scamWatchdogBuiltIn'
import type { CustomModeDefinition } from '../../shared/ui/customModeTypes'

vi.mock('../customModesClient', () => ({
  customModesClient: {
    list: vi.fn(),
  },
}))

vi.mock('../fetchOrchestratorSession', () => ({
  fetchOrchestratorSession: vi.fn(),
}))

vi.mock('../sessionSurfaceResolver', () => ({
  findOpenSessionSurface: vi.fn(),
}))

vi.mock('../presentOrchestratorDisplayGridSession', () => ({
  maybePresentOrchestratorDisplayGridSession: vi.fn(),
}))

import { customModesClient } from '../customModesClient'
import { fetchOrchestratorSession } from '../fetchOrchestratorSession'
import { findOpenSessionSurface } from '../sessionSurfaceResolver'
import { maybePresentOrchestratorDisplayGridSession } from '../presentOrchestratorDisplayGridSession'

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

describe('modeHasAllocatedSession', () => {
  it('returns false for Scam Watchdog without sessionId (seed default)', () => {
    expect(modeHasAllocatedSession(createDefaultScamWatchdogBuiltInMode())).toBe(false)
  })

  it('returns true for built-in Scam Watchdog when sessionId is attached', () => {
    expect(
      modeHasAllocatedSession({
        ...createDefaultScamWatchdogBuiltInMode(),
        sessionId: 'session_1775237973387',
      }),
    ).toBe(true)
  })

  it('returns true when sessionId is a valid orchestrator key', () => {
    expect(modeHasAllocatedSession(customMode({ sessionId: 'session_123' }))).toBe(true)
  })

  it('returns false when sessionId is null', () => {
    expect(modeHasAllocatedSession(customMode({ sessionId: null }))).toBe(false)
  })
})

describe('resolveModeAllocatedSessionRun', () => {
  afterEach(() => {
    vi.mocked(customModesClient.list).mockReset()
  })

  it('skips Scam Watchdog when sessionId is null', async () => {
    vi.mocked(customModesClient.list).mockResolvedValue({
      ok: true,
      data: [createDefaultScamWatchdogBuiltInMode()],
    })
    const r = await resolveModeAllocatedSessionRun('built-in:scam-watchdog')
    expect(r).toEqual({ skip: true, reason: 'Mode has no allocated session' })
  })

  it('resolves session key for Scam Watchdog with attached sessionId', async () => {
    vi.mocked(customModesClient.list).mockResolvedValue({
      ok: true,
      data: [
        {
          ...createDefaultScamWatchdogBuiltInMode(),
          sessionId: 'session_1775237973387',
        },
      ],
    })
    const r = await resolveModeAllocatedSessionRun('built-in:scam-watchdog')
    expect('sessionKey' in r && r.sessionKey).toBe('session_1775237973387')
  })

  it('resolves session key for linked custom mode', async () => {
    vi.mocked(customModesClient.list).mockResolvedValue({
      ok: true,
      data: [customMode({ id: 'custom:abc', sessionId: 'session_999' })],
    })
    const r = await resolveModeAllocatedSessionRun('custom:abc', 'llama3')
    expect(r).toMatchObject({
      sessionKey: 'session_999',
      fallbackModel: 'llama3',
      modeRuntime: { modeId: 'custom:abc' },
    })
  })
})

describe('runModeAllocatedSessionAutomation refresh-if-active', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set: vi.fn((_items: unknown, cb?: () => void) => cb?.()),
        },
      },
      tabs: {
        update: vi.fn(async () => ({})),
      },
    })
    vi.mocked(customModesClient.list).mockResolvedValue({
      ok: true,
      data: [customMode({ id: 'custom:abc', sessionId: 'session_linked_1' })],
    })
    vi.mocked(fetchOrchestratorSession).mockResolvedValue({
      ok: true,
      data: { agentBoxes: [], agents: [] },
    })
  })

  afterEach(() => {
    vi.mocked(customModesClient.list).mockReset()
    vi.mocked(fetchOrchestratorSession).mockReset()
    vi.mocked(findOpenSessionSurface).mockReset()
    vi.mocked(maybePresentOrchestratorDisplayGridSession).mockReset()
    vi.unstubAllGlobals()
  })

  it('refresh path: grid open → direct execute, no present, no pending register', async () => {
    vi.mocked(findOpenSessionSurface).mockResolvedValue({
      kind: 'grid_tab',
      tabId: 42,
      gridSessionParam: 'session_linked_1',
    })

    const registerPending = vi.fn()
    const executeDirect = vi.fn().mockResolvedValue({
      ok: true,
      matchCount: 2,
      executed: ['Agent A', 'Agent B'],
    })

    const result = await runModeAllocatedSessionAutomation(
      { modeId: 'custom:abc', trigger: 'manual_icon', fallbackModel: 'llama3' },
      { registerPendingModeSessionRun: registerPending, executeModeSessionRunDirect: executeDirect },
    )

    expect(result).toMatchObject({ ok: true, phase: 'refreshed', sessionKey: 'session_linked_1' })
    expect(registerPending).not.toHaveBeenCalled()
    expect(maybePresentOrchestratorDisplayGridSession).not.toHaveBeenCalled()
    expect(executeDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'session_linked_1',
        fallbackModel: 'llama3',
        modeRuntime: expect.objectContaining({ modeId: 'custom:abc' }),
      }),
    )
    expect(chrome.tabs.update).toHaveBeenCalledWith(42, { active: true })
  })

  it('first-open path: no grid → register pending + present', async () => {
    vi.mocked(findOpenSessionSurface).mockResolvedValue(null)

    const registerPending = vi.fn()
    const executeDirect = vi.fn()

    const result = await runModeAllocatedSessionAutomation(
      { modeId: 'custom:abc', trigger: 'manual_icon' },
      { registerPendingModeSessionRun: registerPending, executeModeSessionRunDirect: executeDirect },
    )

    expect(result).toMatchObject({ ok: true, phase: 'presented', sessionKey: 'session_linked_1' })
    expect(registerPending).toHaveBeenCalledOnce()
    expect(maybePresentOrchestratorDisplayGridSession).toHaveBeenCalledOnce()
    expect(executeDirect).not.toHaveBeenCalled()
  })

  it('skips when session run already in flight', async () => {
    vi.mocked(findOpenSessionSurface).mockResolvedValue({
      kind: 'grid_tab',
      tabId: 42,
      gridSessionParam: 'session_linked_1',
    })

    const registerPending = vi.fn()
    const executeDirect = vi.fn()

    const result = await runModeAllocatedSessionAutomation(
      { modeId: 'custom:abc', trigger: 'interval' },
      {
        registerPendingModeSessionRun: registerPending,
        executeModeSessionRunDirect: executeDirect,
        isSessionRunInFlight: () => true,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      busy: true,
      skipped: true,
      error: 'Session run already in progress',
    })
    expect(fetchOrchestratorSession).not.toHaveBeenCalled()
    expect(executeDirect).not.toHaveBeenCalled()
    expect(registerPending).not.toHaveBeenCalled()
  })
})
