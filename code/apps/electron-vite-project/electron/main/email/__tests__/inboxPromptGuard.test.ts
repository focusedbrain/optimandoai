import { describe, expect, it } from 'vitest'
import {
  estimateTextTokens,
  guardInboxPromptForCtxSlot,
  truncateEmailLikeContent,
} from '../inboxPromptGuard'

describe('inboxPromptGuard', () => {
  it('estimateTextTokens is conservative', () => {
    const text = 'x'.repeat(3500)
    expect(estimateTextTokens(text)).toBeGreaterThanOrEqual(1000)
  })

  it('truncates oversized synthetic email to fit slot budget', () => {
    const body = 'Lorem ipsum dolor sit amet. '.repeat(800)
    const email = `From: sender@example.com\nSubject: Large thread\n\n${body}`
    const slot = 8192
    const guarded = guardInboxPromptForCtxSlot({
      system: 'You are an inbox analyzer. Return JSON.',
      user: email,
      ctxPerSlot: slot,
      maxOutputTokens: 2048,
    })
    expect(guarded.truncated).toBe(true)
    expect(guarded.estimatedPromptTokens + 2048 + 256).toBeLessThanOrEqual(slot)
    expect(guarded.user).toContain('From: sender@example.com')
    expect(guarded.user).toContain('truncated for AI memory limits')
  })

  it('keeps small prompts unchanged', () => {
    const guarded = guardInboxPromptForCtxSlot({
      system: 'Classify email.',
      user: 'Subject: Hi\n\nShort body.',
      ctxPerSlot: 8192,
      maxOutputTokens: 2048,
    })
    expect(guarded.truncated).toBe(false)
    expect(guarded.user).toBe('Subject: Hi\n\nShort body.')
  })

  it('truncateEmailLikeContent preserves headers and head/tail', () => {
    const body = 'A'.repeat(20_000)
    const email = `From: a@b.com\nTo: c@d.com\n\n${body}`
    const out = truncateEmailLikeContent(email, 500)
    expect(out.startsWith('From: a@b.com')).toBe(true)
    expect(out).toContain('truncated for AI memory limits')
    expect(out.endsWith('A')).toBe(true)
  })
})
