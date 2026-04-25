import { afterEach, describe, expect, test } from 'vitest'
import {
  _resetHandshakeRateLimitForTests,
  tryConsumePerHandshakeInferenceSlot,
} from '../hostInferenceRequestRateLimit'

describe('hostInferenceRequestRateLimit', () => {
  afterEach(() => {
    _resetHandshakeRateLimitForTests()
  })

  test('allows up to N requests per 60s window per handshake', () => {
    expect(tryConsumePerHandshakeInferenceSlot('hs-1', 2)).toBe(true)
    expect(tryConsumePerHandshakeInferenceSlot('hs-1', 2)).toBe(true)
    expect(tryConsumePerHandshakeInferenceSlot('hs-1', 2)).toBe(false)
  })

  test('handshakes are isolated', () => {
    expect(tryConsumePerHandshakeInferenceSlot('a', 1)).toBe(true)
    expect(tryConsumePerHandshakeInferenceSlot('b', 1)).toBe(true)
  })
})
