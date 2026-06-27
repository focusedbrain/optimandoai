import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const assertGate = vi.fn()

vi.mock('../../inference/inferenceGate', () => ({
  assertGpuInferenceAvailable: (...a: unknown[]) => assertGate(...a),
}))

vi.mock('../../inference/gpuStatus', () => ({
  clearGpuStatusCache: vi.fn(),
}))

vi.mock('../localLlmBulkPrewarm', () => ({
  noteLocalLlmActiveModelChangedForBulkPrewarm: vi.fn(),
}))

import type { ChatMessage } from '../types'

describe('LocalLlmManager.chat + inference gate', () => {
  const prevFetch = globalThis.fetch
  beforeEach(async () => {
    assertGate.mockReset()
    assertGate.mockResolvedValue(undefined)
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'hi' } }],
          model: 'm',
        }),
      }
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = prevFetch
  })

  it('calls assertGpuInferenceAvailable before POST /v1/chat/completions', async () => {
    const { LocalLlmManager } = await import('../local-llm-manager')
    const m = new LocalLlmManager()
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x' }]
    await m.chat('m', msgs)
    expect(assertGate).toHaveBeenCalledTimes(1)
    expect(assertGate.mock.invocationCallOrder[0]).toBeLessThan(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 999999999,
    )
  })
})
