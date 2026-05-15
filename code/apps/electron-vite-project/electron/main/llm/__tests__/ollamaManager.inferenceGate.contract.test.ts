import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const assertGate = vi.fn()

vi.mock('../../inference/inferenceGate', () => ({
  assertGpuInferenceAvailable: (...a: unknown[]) => assertGate(...a),
}))

vi.mock('../../inference/gpuStatus', () => ({
  clearGpuStatusCache: vi.fn(),
}))

vi.mock('../ollamaBulkPrewarm', () => ({
  noteOllamaActiveModelChangedForBulkPrewarm: vi.fn(),
}))

import type { ChatMessage } from '../types'

describe('OllamaManager.chat + inference gate', () => {
  const prevFetch = globalThis.fetch
  beforeEach(async () => {
    assertGate.mockReset()
    assertGate.mockResolvedValue(undefined)
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          message: { content: 'hi' },
          model: 'm',
          done: true,
        }),
      }
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = prevFetch
  })

  it('calls assertGpuInferenceAvailable before POST /api/chat', async () => {
    const { OllamaManager } = await import('../ollama-manager')
    const m = new OllamaManager()
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x' }]
    await m.chat('m', msgs)
    expect(assertGate).toHaveBeenCalledTimes(1)
    expect(assertGate.mock.invocationCallOrder[0]).toBeLessThan(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 999999999,
    )
  })
})
