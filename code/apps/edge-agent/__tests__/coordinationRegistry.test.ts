import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  ensureRegistryPairingCodeRegistered,
  registerPairingCode,
  resetRegistryRegistrationCacheForTests,
} from '../src/coordination/registry.js'

describe('registerPairingCode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('maps HTTP status to result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 201 })),
    )
    expect(
      await registerPairingCode({
        coordinationUrl: 'https://relay.test',
        accessToken: 'tok',
        userId: 'user-1',
        instanceId: 'inst-1',
        pairingCode: '123456',
        deviceName: 'vps-1',
      }),
    ).toBe('inserted')
  })

  test('returns collision on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 409 })),
    )
    expect(
      await registerPairingCode({
        coordinationUrl: 'https://relay.test',
        accessToken: 'tok',
        userId: 'user-1',
        instanceId: 'inst-1',
        pairingCode: '123456',
        deviceName: 'vps-1',
      }),
    ).toBe('collision')
  })
})

describe('ensureRegistryPairingCodeRegistered', () => {
  afterEach(() => {
    resetRegistryRegistrationCacheForTests()
    vi.restoreAllMocks()
  })

  test('retries on collision with rotated code', async () => {
    let calls = 0
    const register = vi.fn(async () => {
      calls += 1
      return calls === 1 ? 'collision' : ('inserted' as const)
    })
    const rotatePairingCode = vi.fn(async () => '654321')

    const out = await ensureRegistryPairingCodeRegistered({
      coordinationUrl: 'https://relay.test',
      getAccessToken: async () => 'tok',
      getUserId: async () => 'user-1',
      getIdentity: async () => ({
        instanceId: 'inst-1',
        deviceName: 'vps',
        registryPairingCode: '111111',
      }),
      rotatePairingCode,
      register,
    })

    expect(out.status).toBe('inserted')
    expect(out.code).toBe('654321')
    expect(rotatePairingCode).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(2)
  })
})
