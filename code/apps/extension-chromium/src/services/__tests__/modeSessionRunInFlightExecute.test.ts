import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MODE_RUN_HARD_TIMEOUT_MS,
  MODE_RUN_TIMED_OUT_ERROR,
  executeModeSessionRunWithInFlightGuard,
} from '../modeSessionRunInFlightExecute'

vi.mock('../modeRunExecution', () => ({
  executeModeRunAgents: vi.fn(),
  resolveModeRunWrchatModelId: vi.fn(() => 'tinyllama'),
  fetchWrChatAvailableModelsForModeRun: vi.fn(async () => []),
}))

vi.mock('../beapRunAutomationResult', () => ({
  interpretBeapAutomationModeRun: vi.fn((_sk: string, runResult: { matches: unknown[] }) => ({
    ok: true,
    sessionKey: 'session_test',
    matchCount: runResult.matches?.length ?? 0,
    executed: ['Agent A'],
  })),
}))

import { executeModeRunAgents } from '../modeRunExecution'

describe('executeModeSessionRunWithInFlightGuard', () => {
  const inFlight = new Set<string>()

  beforeEach(() => {
    inFlight.clear()
    vi.useFakeTimers()
    vi.mocked(executeModeRunAgents).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns busy when the same sessionKey is already in flight', async () => {
    inFlight.add('session_test')
    const result = await executeModeSessionRunWithInFlightGuard({
      inFlight,
      sessionKey: 'session_test',
      fallbackModel: 'tinyllama',
      logPrefix: 'Test',
    })
    expect(result).toMatchObject({ ok: false, busy: true })
    expect(executeModeRunAgents).not.toHaveBeenCalled()
  })

  it('clears the latch after a successful run', async () => {
    vi.mocked(executeModeRunAgents).mockResolvedValue({ matches: [{}], executions: [] })
    const result = await executeModeSessionRunWithInFlightGuard({
      inFlight,
      sessionKey: 'session_ok',
      fallbackModel: 'tinyllama',
      logPrefix: 'Test',
    })
    expect(result.ok).toBe(true)
    expect(inFlight.has('session_ok')).toBe(false)
  })

  it(
    'clears the latch and returns timedOut after hard timeout',
    async () => {
      vi.useRealTimers()
      vi.mocked(executeModeRunAgents).mockImplementation(
        () =>
          new Promise(() => {
            /* never settles */
          }),
      )

      const result = await executeModeSessionRunWithInFlightGuard({
        inFlight,
        sessionKey: 'session_hung',
        fallbackModel: 'tinyllama',
        logPrefix: 'Test',
        hardTimeoutMs: 30,
      })

      expect(result).toMatchObject({
        ok: false,
        timedOut: true,
        error: MODE_RUN_TIMED_OUT_ERROR,
      })
      expect(inFlight.has('session_hung')).toBe(false)
    },
    2000,
  )

  it('passes AbortSignal to executeModeRunAgents', async () => {
    vi.mocked(executeModeRunAgents).mockResolvedValue({ matches: [], executions: [] })
    await executeModeSessionRunWithInFlightGuard({
      inFlight,
      sessionKey: 'session_signal',
      fallbackModel: 'tinyllama',
      logPrefix: 'Test',
    })
    expect(executeModeRunAgents).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('uses default hard timeout above per-LLM HTTP ceiling', () => {
    expect(MODE_RUN_HARD_TIMEOUT_MS).toBeGreaterThan(600_000)
  })
})
