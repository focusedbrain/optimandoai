/**
 * Roadmap item 0.24: images are refused, not dropped.
 * - The local text-only chat lane throws a typed `vision_not_supported` refusal for images.
 * - The watchdog then runs on tab text only and reports that screens were not analysed.
 */
import { describe, expect, it, vi } from 'vitest'
import { LocalLlmVisionUnsupportedError, localLlmManager } from '../local-llm-manager'
import { chatWithVisionFallback, screensNotAnalysedThreat } from '../../../watchdog/watchdogService'
import type { ChatMessage } from '../types'

describe('local chat lane refuses images', () => {
  it('throws vision_not_supported before any request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(
      localLlmManager.chat('any-model', [{ role: 'user', content: 'look', images: ['aGVsbG8='] }]),
    ).rejects.toMatchObject({ code: 'vision_not_supported' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('watchdog vision fallback', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'tab text', images: ['aGVsbG8='] },
  ]

  it('retries text-only and reports screens not analysed', async () => {
    const calls: ChatMessage[][] = []
    const manager = {
      chat: async (model: string, msgs: ChatMessage[]) => {
        calls.push(msgs)
        if (msgs.some((m) => m.images?.length)) throw new LocalLlmVisionUnsupportedError(model)
        return { content: '{"threats":[]}' }
      },
    }
    const out = await chatWithVisionFallback(manager, 'm', messages)
    expect(out.screensAnalysed).toBe(false)
    expect(calls).toHaveLength(2)
    expect(calls[1].some((m) => 'images' in m)).toBe(false)
    expect(screensNotAnalysedThreat().summary).toMatch(/Screens not analysed/)
  })

  it('passes other errors through', async () => {
    const manager = { chat: async () => { throw new Error('ECONNREFUSED') } }
    await expect(chatWithVisionFallback(manager, 'm', messages)).rejects.toThrow('ECONNREFUSED')
  })

  it('a vision-capable result keeps screensAnalysed', async () => {
    const manager = { chat: async () => ({ content: 'ok' }) }
    await expect(chatWithVisionFallback(manager, 'm', messages)).resolves.toMatchObject({ screensAnalysed: true })
  })
})
