/**
 * Prompt 4 — setup-flow topology condition tests.
 *
 * Proofs required:
 *  F. Single-machine: no second email setup (SANDBOX_READ_CONSENT_UI_REACHABLE=true but
 *     topology is single-machine; the guard is the topology check, not the flag).
 *  G. Multi-machine (mode=sandbox): SANDBOX_READ_CONSENT_UI_REACHABLE=true and
 *     connectReadClient is callable.
 *  H. SANDBOX_READ_CONSENT_UI_REACHABLE is now true (Prompt 4 flip).
 *  I. ingestionOwnership sandbox-mode path: resolveIngestionOwnership returns
 *     sandboxShouldReadPoll=true for mode=sandbox even without linked[] entry.
 *  J. ingestionOwnership host path: resolveIngestionOwnership returns
 *     hostShouldReadPoll=true for single-machine (mode=host, no linked sandbox).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

describe('SANDBOX_READ_CONSENT_UI_REACHABLE (H)', () => {
  it('is true (Prompt 4 flipped it)', async () => {
    const { SANDBOX_READ_CONSENT_UI_REACHABLE } = await import('../roleAwareConsent')
    expect(SANDBOX_READ_CONSENT_UI_REACHABLE).toBe(true)
  })

  it('assertSandboxReadConsentEntryReachable no longer throws', async () => {
    const { assertSandboxReadConsentEntryReachable } = await import('../roleAwareConsent')
    expect(() => assertSandboxReadConsentEntryReachable()).not.toThrow()
  })
})

describe('resolveIngestionOwnership — topology conditions (I, J)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('I — sandbox mode (multi-machine): sandboxShouldReadPoll=true even without linked[] entry', async () => {
    makeOwnershipDeps('sandbox', false)
    const { resolveIngestionOwnership } = await import('../ingestionOwnership')
    const ownership = resolveIngestionOwnership()

    expect(ownership.owner).toBe('sandbox')
    expect(ownership.sandboxShouldReadPoll).toBe(true)
    expect(ownership.hostShouldReadPoll).toBe(false)
    expect(ownership.thisNodeRole).toBe('sandbox')
  })

  it('J — host mode, no linked sandbox: host owns, hostShouldReadPoll=true (single-machine)', async () => {
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
    expect(ownership.sandboxShouldReadPoll).toBe(false) // not the sandbox node
    expect(ownership.thisNodeRole).toBe('host')
  })
})

describe('setup-flow topology guard (F, G)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('F — single-machine topology: no second email setup needed (host mode, no linked sandbox)', async () => {
    makeOwnershipDeps('host', false)
    const { resolveIngestionOwnership } = await import('../ingestionOwnership')
    const ownership = resolveIngestionOwnership()

    // The UI should NOT show a sandbox email dialog when:
    // - This node is the host AND
    // - There is no linked sandbox
    // Resolution: owner=host, sandboxShouldReadPoll=false → no second setup
    expect(ownership.owner).toBe('host')
    expect(ownership.sandboxShouldReadPoll).toBe(false)

    // The SANDBOX_READ_CONSENT_UI_REACHABLE flag is true (it's reachable in principle)
    // but the topology condition gates whether we show it
    const { SANDBOX_READ_CONSENT_UI_REACHABLE } = await import('../roleAwareConsent')
    expect(SANDBOX_READ_CONSENT_UI_REACHABLE).toBe(true)
    // Topology says: no second setup for this (single-machine) topology
    expect(ownership.sandboxShouldReadPoll).toBe(false)
  })

  it('G — multi-machine sandbox topology: SANDBOX_READ_CONSENT_UI_REACHABLE=true and connectReadClient callable', async () => {
    makeOwnershipDeps('sandbox', false)
    const { resolveIngestionOwnership } = await import('../ingestionOwnership')
    const ownership = resolveIngestionOwnership()

    expect(ownership.owner).toBe('sandbox')
    expect(ownership.sandboxShouldReadPoll).toBe(true)

    // The flag is reachable
    const { SANDBOX_READ_CONSENT_UI_REACHABLE } = await import('../roleAwareConsent')
    expect(SANDBOX_READ_CONSENT_UI_REACHABLE).toBe(true)

    // connectReadClient exists and is a function (the consent path is real)
    const { connectReadClient } = await import('../roleAwareConsent')
    expect(typeof connectReadClient).toBe('function')
  })
})
