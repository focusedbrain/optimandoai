/**
 * Prompt 0 — sandbox topology kind discriminator tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../types'
import {
  inferSandboxPairingKindFromHandshake,
  isHostLocalP2pTarget,
  resolveSandboxTopologyKind,
} from '../sandboxTopologyKind'

const listActiveInternalHandshakesForHostAi = vi.hoisted(() => vi.fn((): HandshakeRecord[] => []))
const getOrchestratorMode = vi.hoisted(() =>
  vi.fn(() => ({
    mode: 'host' as const,
    deviceName: 'host',
    instanceId: 'host-dev',
    pairingCode: '123456',
    connectedPeers: [] as [],
    linked: [] as [],
  })),
)

function makeInternalPair(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-topo-1',
    relationship_id: 'rel-1',
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'host-dev',
    acceptor_coordination_device_id: 'sandbox-dev',
    internal_coordination_identity_complete: true,
    initiator: { wrdesk_user_id: 'u1', email: 'a@test.com' },
    acceptor: { wrdesk_user_id: 'u1', email: 'a@test.com' },
    p2p_endpoint: 'http://192.168.1.50:51249/beap/ingest',
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: {} as HandshakeRecord['tier_snapshot'],
    current_tier_signals: {} as HandshakeRecord['current_tier_signals'],
    last_seq_sent: 1,
    last_seq_received: 1,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as HandshakeRecord['effective_policy'],
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    counterparty_p2p_token: null,
    ...overrides,
  }
}

vi.mock('../../internalInference/hostAiInternalPairingLedger', () => ({
  listActiveInternalHandshakesForHostAi,
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: vi.fn(() => 'host-dev'),
  getOrchestratorMode,
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: vi.fn(() => ({
    relay_mode: 'remote',
    coordination_url: 'https://relay.wrdesk.com',
    relay_url: null,
  })),
}))

describe('inferSandboxPairingKindFromHandshake', () => {
  it('returns explicit stored marker when present', () => {
    expect(
      inferSandboxPairingKindFromHandshake(
        makeInternalPair({ topology_pairing_kind: 'local_inner_vm', p2p_endpoint: 'http://192.168.1.50/beap/ingest' }),
      ),
    ).toBe('local_inner_vm')
  })

  it('infers local_inner_vm from loopback peer p2p_endpoint (legacy row)', () => {
    expect(
      inferSandboxPairingKindFromHandshake(
        makeInternalPair({ topology_pairing_kind: null, p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest' }),
      ),
    ).toBe('local_inner_vm')
  })

  it('infers remote_dedicated from LAN peer endpoint when not local', () => {
    expect(isHostLocalP2pTarget('192.168.1.50', { localAddresses: ['10.0.0.1'] })).toBe(false)
    expect(
      inferSandboxPairingKindFromHandshake(
        makeInternalPair({ p2p_endpoint: 'http://192.168.1.50:51249/beap/ingest' }),
        { localAddresses: ['10.0.0.1'] },
      ),
    ).toBe('remote_dedicated')
  })

  it('infers local_inner_vm when peer endpoint matches a local NIC address', () => {
    expect(
      inferSandboxPairingKindFromHandshake(
        makeInternalPair({ p2p_endpoint: 'http://192.168.1.100:51249/beap/ingest' }),
        { localAddresses: ['192.168.1.100', '127.0.0.1'] },
      ),
    ).toBe('local_inner_vm')
  })
})

describe('resolveSandboxTopologyKind', () => {
  beforeEach(() => {
    listActiveInternalHandshakesForHostAi.mockReturnValue([])
    getOrchestratorMode.mockReturnValue({
      mode: 'host',
      deviceName: 'host',
      instanceId: 'host-dev',
      pairingCode: '123456',
      connectedPeers: [],
      linked: [],
    })
  })

  it('returns none when no ACTIVE internal Host↔Sandbox pair', () => {
    expect(resolveSandboxTopologyKind({})).toBe('none')
  })

  it('returns single_machine for co-located pair (loopback peer endpoint)', () => {
    listActiveInternalHandshakesForHostAi.mockReturnValue([
      makeInternalPair({ p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest' }),
    ])
    expect(resolveSandboxTopologyKind({})).toBe('single_machine')
  })

  it('returns dedicated for separate-machine pair (remote LAN peer)', () => {
    listActiveInternalHandshakesForHostAi.mockReturnValue([
      makeInternalPair({ p2p_endpoint: 'http://192.168.1.50:51249/beap/ingest' }),
    ])
    expect(resolveSandboxTopologyKind({})).toBe('dedicated')
  })

  it('uses linked[] pairingKind marker when present (legacy inference override)', () => {
    listActiveInternalHandshakesForHostAi.mockReturnValue([
      makeInternalPair({ handshake_id: 'hs-linked', p2p_endpoint: 'http://192.168.1.50/beap/ingest' }),
    ])
    getOrchestratorMode.mockReturnValue({
      mode: 'host',
      deviceName: 'host',
      instanceId: 'host-dev',
      pairingCode: '123456',
      connectedPeers: [],
      linked: [{ role: 'sandbox', handshakeId: 'hs-linked', jobKinds: ['depackage-email'], pairingKind: 'local_inner_vm' }],
    })
    expect(resolveSandboxTopologyKind({})).toBe('single_machine')
  })
})

describe('resolveIngestionOwnership — no regression from topology discriminator', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('linked sandbox still disables host read-poll (ownership unchanged)', async () => {
    vi.doMock('../../email/opaqueIngestion', () => ({
      hasLinkedDepackageSandbox: vi.fn(() => true),
      __resetOpaqueIngestionCacheForTests: vi.fn(),
    }))
    vi.doMock('../../orchestrator/orchestratorModeStore', () => ({
      getOrchestratorMode: vi.fn(() => ({
        mode: 'host',
        linked: [{ role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['depackage-email'], pairingKind: 'local_inner_vm' }],
      })),
    }))
    const { resolveIngestionOwnership } = await import('../../email/ingestionOwnership')
    const ownership = resolveIngestionOwnership()
    expect(ownership.owner).toBe('sandbox')
    expect(ownership.hostShouldReadPoll).toBe(false)
  })
})
