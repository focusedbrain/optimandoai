import { describe, expect, it } from 'vitest'
import {
  isLlamaContextOverflowError,
  LlamaContextOverflowError,
  parseLlamaContextOverflowFromBody,
} from '../llamaContextOverflow'

describe('llamaContextOverflow', () => {
  it('parses send_error overflow body', () => {
    const err = parseLlamaContextOverflowFromBody(
      'request (5086 tokens) exceeds the available context size (2304 tokens)',
    )
    expect(err).toBeInstanceOf(LlamaContextOverflowError)
    expect(err?.promptTokens).toBe(5086)
    expect(err?.slotLimit).toBe(2304)
  })

  it('detects typed and message-shaped errors', () => {
    const typed = new LlamaContextOverflowError('overflow', 100, 50)
    expect(isLlamaContextOverflowError(typed)).toBe(true)
    expect(
      isLlamaContextOverflowError(
        new Error('request (100 tokens) exceeds the available context size (50 tokens)'),
      ),
    ).toBe(true)
  })
})
