import { describe, expect, it } from 'vitest'

/** Mirrors HybridSearch success-path merge for streamed RAG + host-internal chat (zero retrieved blocks). */
function mergeStreamedHybridAnswer(args: {
  streamed: boolean
  answer: string | null | undefined
  streamedAccumulator: string
  previousResponse: string | null | undefined
}): string {
  const answerText = (args.answer || args.streamedAccumulator) || ''
  if (!args.streamed) return answerText
  const prev = (args.previousResponse ?? '').trim()
  return prev.length > 0 ? (args.previousResponse ?? '') : answerText
}

describe('Hybrid chat streamed answer merge', () => {
  it('uses streamed accumulator when result.answer is empty but stream tokens were not mirrored to UI state', () => {
    const displayed = mergeStreamedHybridAnswer({
      streamed: true,
      answer: '',
      streamedAccumulator: 'LAN reply text',
      previousResponse: null,
    })
    expect(displayed).toBe('LAN reply text')
  })

  it('keeps live UI text when tokens already updated React state', () => {
    const displayed = mergeStreamedHybridAnswer({
      streamed: true,
      answer: '',
      streamedAccumulator: 'LAN reply text',
      previousResponse: 'LAN reply text',
    })
    expect(displayed).toBe('LAN reply text')
  })
})
