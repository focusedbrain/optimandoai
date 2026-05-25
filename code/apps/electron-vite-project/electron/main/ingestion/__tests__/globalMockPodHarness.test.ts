/**
 * Sanity: global test/setup.ts still provides mock pod for legacy suites.
 */
import { describe, test, expect } from 'vitest'

describe('global mock pod harness', () => {
  test('WR_POD_BASE_URL is set by test/setup.ts when CI mock is active', () => {
    if (process.env['CI_POD_URL']) {
      expect(process.env['WR_POD_BASE_URL']).toBe(process.env['CI_POD_URL'])
      return
    }
    expect(process.env['WR_POD_BASE_URL']).toBeTruthy()
    expect(process.env['WR_POD_BASE_URL']).toMatch(/^http:\/\//)
  })
})
