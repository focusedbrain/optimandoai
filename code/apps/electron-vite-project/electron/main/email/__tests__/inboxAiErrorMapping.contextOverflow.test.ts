import { describe, expect, it } from 'vitest'
import {
  classifyInboxAiError,
  INBOX_CONTEXT_OVERFLOW_USER_MESSAGE,
} from '../inboxAiErrorMapping'
import { LlamaContextOverflowError } from '../../llm/llamaContextOverflow'

describe('inboxAiErrorMapping context_overflow', () => {
  it('maps llama-server send_error body to context_overflow', () => {
    const err = new LlamaContextOverflowError(
      'request (5086 tokens) exceeds the available context size (2304 tokens)',
      5086,
      2304,
    )
    const { code, debug } = classifyInboxAiError(err, {
      operation: 'analyze',
      aiExecution: { lane: 'local', model: 'gemma3:12b', baseUrl: 'http://127.0.0.1:8080' },
    })
    expect(code).toBe('context_overflow')
    expect(debug.promptTokens).toBe(5086)
    expect(debug.slotLimit).toBe(2304)
    expect(INBOX_CONTEXT_OVERFLOW_USER_MESSAGE).toMatch(/Inference Settings/)
  })

  it('maps message-pattern overflow without typed error', () => {
    const err = new Error('Local LLM 400: request (3320 tokens) exceeds the available context size (2304 tokens)')
    const { code } = classifyInboxAiError(err, { operation: 'analyze' })
    expect(code).toBe('context_overflow')
  })
})
