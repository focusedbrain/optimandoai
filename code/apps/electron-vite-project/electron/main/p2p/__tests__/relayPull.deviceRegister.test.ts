/**
 * P2 — effective-role device registration.
 *
 * registerDeviceRoleWithRelay must register by the LEDGER-AUTHORITATIVE role
 * (isEffectiveSandboxNode), not the persisted orchestrator mode. A ledger-proven
 * sandbox whose orchestrator-mode.json still says 'host' must register as
 * 'sandbox' so the relay/coordination role-based ingress guards apply.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const getInstanceIdMock = vi.fn<[], string>(() => 'dev-effective-1')
const getOrchestratorModeMock = vi.fn<[], { mode: string }>(() => ({ mode: 'host' }))
const isEffectiveSandboxNodeMock = vi.fn<[unknown], boolean>(() => false)
const getP2PConfigMock = vi.fn(() => ({
  relay_mode: 'remote',
  relay_pull_url: 'https://relay.example.com/beap/pull',
  relay_auth_secret: 'secret-123',
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceIdMock(),
  getOrchestratorMode: () => getOrchestratorModeMock(),
}))

vi.mock('../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: (db: unknown) => isEffectiveSandboxNodeMock(db),
}))

vi.mock('../p2pConfig', () => ({
  getP2PConfig: () => getP2PConfigMock(),
}))

import { registerDeviceRoleWithRelay } from '../relayPull'

describe('registerDeviceRoleWithRelay — effective-role registration (P2)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    getInstanceIdMock.mockReturnValue('dev-effective-1')
    getOrchestratorModeMock.mockReturnValue({ mode: 'host' })
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ registered: true }), { status: 200 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function registeredRole(): string {
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://relay.example.com/beap/device-register')
    return JSON.parse(String(init.body)).device_role
  }

  test('ledger-proven sandbox with file=host registers as SANDBOX', async () => {
    getOrchestratorModeMock.mockReturnValue({ mode: 'host' }) // local file says host
    isEffectiveSandboxNodeMock.mockReturnValue(true) // ledger proves sandbox
    await registerDeviceRoleWithRelay({})
    expect(registeredRole()).toBe('sandbox')
  })

  test('genuine host (not ledger-proven sandbox) registers as HOST', async () => {
    getOrchestratorModeMock.mockReturnValue({ mode: 'host' })
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    await registerDeviceRoleWithRelay({})
    expect(registeredRole()).toBe('host')
  })

  test('persisted-mode sandbox registers as SANDBOX', async () => {
    getOrchestratorModeMock.mockReturnValue({ mode: 'sandbox' })
    isEffectiveSandboxNodeMock.mockReturnValue(true)
    await registerDeviceRoleWithRelay({})
    expect(registeredRole()).toBe('sandbox')
  })

  test('undetermined mode and not ledger-proven sandbox → skips registration', async () => {
    getOrchestratorModeMock.mockReturnValue({ mode: 'single' })
    isEffectiveSandboxNodeMock.mockReturnValue(false)
    await registerDeviceRoleWithRelay({})
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
