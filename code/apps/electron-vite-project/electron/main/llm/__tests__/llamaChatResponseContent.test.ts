/**
 * build038 response parsing tests:
 *  - content preferred when non-empty
 *  - reasoning_content fallback when content is empty (deep-reasoning + --jinja)
 *  - both empty → flagged as empty (callers throw instead of coercing to a fake success)
 */
import { describe, expect, it } from 'vitest'

import { extractLlamaChatContent } from '../llamaChatResponseContent'

describe('extractLlamaChatContent', () => {
  it('prefers non-empty content and does not touch reasoning_content', () => {
    const r = extractLlamaChatContent({ content: '{"ok":true}', reasoning_content: 'thinking...' })
    expect(r.content).toBe('{"ok":true}')
    expect(r.usedReasoningFallback).toBe(false)
    expect(r.empty).toBe(false)
  })

  it('falls back to reasoning_content when content is empty', () => {
    const r = extractLlamaChatContent({ content: '', reasoning_content: 'the actual answer' })
    expect(r.content).toBe('the actual answer')
    expect(r.usedReasoningFallback).toBe(true)
    expect(r.empty).toBe(false)
  })

  it('treats whitespace-only content as empty for fallback purposes', () => {
    const r = extractLlamaChatContent({ content: '   \n', reasoning_content: 'fallback text' })
    expect(r.content).toBe('fallback text')
    expect(r.usedReasoningFallback).toBe(true)
  })

  it('reports empty when both fields are missing or blank', () => {
    expect(extractLlamaChatContent({}).empty).toBe(true)
    expect(extractLlamaChatContent(null).empty).toBe(true)
    expect(extractLlamaChatContent(undefined).empty).toBe(true)
    expect(extractLlamaChatContent({ content: '', reasoning_content: ' ' }).empty).toBe(true)
  })

  it('ignores non-string field types safely', () => {
    const r = extractLlamaChatContent({ content: 42 as unknown as string, reasoning_content: ['x'] as unknown as string })
    expect(r.empty).toBe(true)
    expect(r.content).toBe('')
  })
})
