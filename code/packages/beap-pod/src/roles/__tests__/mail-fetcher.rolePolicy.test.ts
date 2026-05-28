import { describe, test, expect } from 'vitest'
import { isMailFetcherSendShapedRequest } from '@repo/role-policy'

describe('mail-fetcher send guard', () => {
  test('detects send-shaped URLs', () => {
    expect(isMailFetcherSendShapedRequest('POST', '/accounts/send')).toBe(true)
    expect(isMailFetcherSendShapedRequest('GET', '/health')).toBe(false)
    expect(isMailFetcherSendShapedRequest('POST', '/accounts/start')).toBe(false)
  })
})
