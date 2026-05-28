/**
 * Role policy gates on EmailGateway — isolated (Stream B7).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../../ingestion/ingestionModeService.js', () => ({
  getIngestionModeSnapshot: vi.fn(() => ({
    mode: 'EdgeActive',
    hostPodVariant: null,
    hostPodSupervisorState: 'healthy',
    hostPodHaltReason: null,
    waitForHostPod: false,
    blockedWithoutConnectivity: false,
    settings: { enabled: true, replicas: [] },
    probes: {},
    holdQueue: { count: 0, bytes: 0 },
    sessionHostFallbackAuthorized: false,
  })),
}))

import { RoleSendForbidden } from '../rolePolicyErrors.js'
import { enforceFetchPolicyForAccountId, enforceSendPolicyForAccountId } from '../rolePolicyEnforce.js'

describe('rolePolicy enforcement helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('blocks host fetch for edge-active account in EdgeActive mode', () => {
    const block = enforceFetchPolicyForAccountId('a1', {
      edgeFetch: { state: 'active', replicaId: 'r1', updatedAt: 1 },
    })
    expect(block).not.toBeNull()
    expect(block?.reason).toBe('edge_active_for_account')
  })

  test('allows host fetch for not_on_edge account', () => {
    const block = enforceFetchPolicyForAccountId('a1', {
      edgeFetch: { state: 'not_on_edge', replicaId: 'r1', updatedAt: 1 },
    })
    expect(block).toBeNull()
  })

  test('blocks send for edge-active account when mode is Blocked', async () => {
    const { getIngestionModeSnapshot } = await import('../../ingestion/ingestionModeService.js')
    vi.mocked(getIngestionModeSnapshot).mockReturnValue({
      mode: 'Blocked',
      hostPodVariant: null,
      hostPodSupervisorState: 'healthy',
      hostPodHaltReason: null,
      waitForHostPod: false,
      blockedWithoutConnectivity: false,
      settings: { enabled: true, replicas: [] },
      probes: {},
      holdQueue: { count: 0, bytes: 0 },
      sessionHostFallbackAuthorized: false,
    } as any)

    expect(() =>
      enforceSendPolicyForAccountId('a1', {
        edgeFetch: { state: 'active', replicaId: 'r1', updatedAt: 1 },
      }),
    ).toThrow(RoleSendForbidden)
  })

  test('allows send for edge-active account in EdgeActive mode', async () => {
    const { getIngestionModeSnapshot } = await import('../../ingestion/ingestionModeService.js')
    vi.mocked(getIngestionModeSnapshot).mockReturnValue({
      mode: 'EdgeActive',
      hostPodVariant: null,
      hostPodSupervisorState: 'healthy',
      hostPodHaltReason: null,
      waitForHostPod: false,
      blockedWithoutConnectivity: false,
      settings: { enabled: true, replicas: [] },
      probes: {},
      holdQueue: { count: 0, bytes: 0 },
      sessionHostFallbackAuthorized: false,
    } as any)

    expect(() =>
      enforceSendPolicyForAccountId('a1', {
        edgeFetch: { state: 'active', replicaId: 'r1', updatedAt: 1 },
      }),
    ).not.toThrow()
  })
})
