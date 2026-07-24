import { describe, expect, it } from 'vitest'
import {
  applyModelFallbackBanner,
  formatModelFallbackBanner,
  parseModelFallbackFromChatData,
} from '../declaredModelAvailability'

describe('declaredModelAvailability UI helpers', () => {
  it('formatModelFallbackBanner shows requested vs actual', () => {
    const banner = formatModelFallbackBanner({
      requestedModel: 'gemma3:12b',
      actualModel: 'gemma4:12b-it-q8_0',
      fellBack: true,
      reason: 'not_installed',
    })
    expect(banner).toContain('gemma3:12b')
    expect(banner).toContain('gemma4:12b-it-q8_0')
    expect(banner).toContain('unavailable')
  })

  it('applyModelFallbackBanner prepends only when fellBack', () => {
    const plain = applyModelFallbackBanner('hello', null)
    expect(plain).toBe('hello')
    const withFb = applyModelFallbackBanner('hello', {
      requestedModel: 'a',
      actualModel: 'b',
      fellBack: true,
      reason: 'not_installed',
    })
    expect(withFb.startsWith('⚠️')).toBe(true)
    expect(withFb).toContain('hello')
  })

  it('parseModelFallbackFromChatData reads server wire', () => {
    const fb = parseModelFallbackFromChatData({
      content: 'x',
      modelFallback: {
        requestedModel: 'gemma3:12b',
        actualModel: 'gemma4:12b-it-q8_0',
        fellBack: true,
        reason: 'not_installed',
      },
    })
    expect(fb?.requestedModel).toBe('gemma3:12b')
    expect(fb?.actualModel).toBe('gemma4:12b-it-q8_0')
  })
})
