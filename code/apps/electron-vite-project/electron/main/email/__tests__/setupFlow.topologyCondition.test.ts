/**
 * Prompt 4 — setup-flow topology condition tests (unified connect UI).
 *
 * Sandbox read scopes are chosen in main via resolveConnectOAuthScopeRole;
 * both roles use the same EmailConnectWizard surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeOwnershipDeps(mode: 'host' | 'sandbox', hasLinked: boolean) {
  vi.doMock('../opaqueIngestion', () => ({
    hasLinkedDepackageSandbox: vi.fn(() => hasLinked),
    __resetOpaqueIngestionCacheForTests: vi.fn(),
  }))
  vi.doMock('../../orchestrator/orchestratorModeStore', () => ({
    getOrchestratorMode: vi.fn(() => ({ mode, linked: hasLinked ? [{ role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['depackage-email'] }] : [] })),
    isSandboxMode: vi.fn(() => mode === 'sandbox'),
    isHostMode: vi.fn(() => mode === 'host'),
    getInstanceId: vi.fn(() => 'instance-1'),
    getDeviceName: vi.fn(() => 'test-device'),
  }))
}

describe('resolveIngestionOwnership — topology conditions', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sandbox mode (multi-machine): sandboxShouldReadPoll=true even without linked[] entry', async () => {
    makeOwnershipDeps('sandbox', false)
    const { resolveIngestionOwnership } = await import('../ingestionOwnership')
    const ownership = resolveIngestionOwnership()

    expect(ownership.owner).toBe('sandbox')
    expect(ownership.sandboxShouldReadPoll).toBe(true)
    expect(ownership.hostShouldReadPoll).toBe(false)
    expect(ownership.thisNodeRole).toBe('sandbox')
  })

  it('host mode, no linked sandbox: host owns, hostShouldReadPoll=true (single-machine)', async () => {
    makeOwnershipDeps('host', false)
    const { resolveIngestionOwnership } = await import('../ingestionOwnership')
    const ownership = resolveIngestionOwnership()

    expect(ownership.owner).toBe('host')
    expect(ownership.hostShouldReadPoll).toBe(true)
    expect(ownership.sandboxShouldReadPoll).toBe(false)
    expect(ownership.thisNodeRole).toBe('host')
  })

  it('host mode + linked sandbox: sandbox owns, host read-poll disabled', async () => {
    makeOwnershipDeps('host', true)
    const { resolveIngestionOwnership } = await import('../ingestionOwnership')
    const ownership = resolveIngestionOwnership()

    expect(ownership.owner).toBe('sandbox')
    expect(ownership.hostShouldReadPoll).toBe(false)
    expect(ownership.sandboxShouldReadPoll).toBe(false)
    expect(ownership.thisNodeRole).toBe('host')
  })
})

describe('unified connect scope role (sandbox under-the-hood read)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sandbox persisted mode → read OAuth scope role', async () => {
    vi.doMock('../../orchestrator/orchestratorModeStore', () => ({
      getOrchestratorMode: () => ({ mode: 'sandbox' }),
    }))
    vi.doMock('../../internalInference/listInferenceTargets', () => ({
      hasActiveInternalLedgerSandboxToHostForHostAi: async () => false,
    }))
    const { resolveConnectOAuthScopeRole } = await import('../resolveConnectOAuthScopeRole')
    expect(await resolveConnectOAuthScopeRole()).toBe('read')
  })

  it('host single-machine → bundled all scope role', async () => {
    vi.doMock('../../orchestrator/orchestratorModeStore', () => ({
      getOrchestratorMode: () => ({ mode: 'host' }),
    }))
    vi.doMock('../../internalInference/listInferenceTargets', () => ({
      hasActiveInternalLedgerSandboxToHostForHostAi: async () => false,
    }))
    const { resolveConnectOAuthScopeRole } = await import('../resolveConnectOAuthScopeRole')
    expect(await resolveConnectOAuthScopeRole()).toBe('all')
  })
})
