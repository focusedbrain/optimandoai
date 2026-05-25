/**
 * Canary tests — isolated suite must NOT inherit global test/setup.ts mock pod.
 *
 * Run: npx vitest --config vitest.modeResolver.config.ts run
 */

import { describe, test, expect } from 'vitest'

describe('test harness isolation (canary)', () => {
  test('global mock pod server is NOT running in this suite', async () => {
    expect(process.env['WR_POD_BASE_URL']).toBeUndefined()
  })

  test('fetch to mock pod port fails (no mock server)', async () => {
    let failed = false
    try {
      await fetch('http://127.0.0.1:18100/ingest', { method: 'POST', body: '{}' })
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  })

  test('resolver probe defaults from test/setup.ts are NOT applied', async () => {
    const { getResolverProbeOverrides } = await import('../../ingestionModeService.js')
    expect(getResolverProbeOverrides()).toBeUndefined()
  })
})
