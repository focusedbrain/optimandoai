/**
 * WSL status cache — no repeated wsl.exe shell-out unless forced.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const diagnoseWslState = vi.hoisted(() => vi.fn())

vi.mock('../wslProbe.js', () => ({
  diagnoseWslState,
}))

import {
  clearWslStatusCacheForTest,
  getWslStatusCache,
  refreshWslStatusCache,
} from '../podmanWslStatusCache.js'

describe('podmanWslStatusCache', () => {
  beforeEach(() => {
    clearWslStatusCacheForTest()
    diagnoseWslState.mockReset()
    diagnoseWslState.mockResolvedValue({
      issue: 'not_installed',
      rebootRequired: false,
      userMessage: 'WSL required',
      logSummary: [],
    })
  })

  test('returns cached diagnosis without re-shelling wsl.exe', async () => {
    const first = await refreshWslStatusCache({ force: true, reason: 'startup' })
    const second = await refreshWslStatusCache({ force: false, reason: 'startup' })

    expect(first?.issue).toBe('not_installed')
    expect(second?.issue).toBe('not_installed')
    expect(diagnoseWslState).toHaveBeenCalledTimes(1)
    expect(getWslStatusCache()?.issue).toBe('not_installed')
  })

  test('force refresh runs diagnosis again', async () => {
    await refreshWslStatusCache({ force: true, reason: 'startup' })
    await refreshWslStatusCache({ force: true, reason: 'user_setup' })
    expect(diagnoseWslState).toHaveBeenCalledTimes(2)
  })
})
