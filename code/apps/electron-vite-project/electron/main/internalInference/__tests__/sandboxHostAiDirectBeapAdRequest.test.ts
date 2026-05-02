/**
 * Sandbox requests Host republish via coordination POST (no Host AI publish from sandbox).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  peekHostAdvertisedMvpDirectEntry,
  resetHostAdvertisedMvpDirectForTests,
  resolveSandboxToHostHttpDirectIngest,
} from '../p2pEndpointRepair'
import { resetSandboxHostAiDirectBeapAdRequestStateForTests } from '../sandboxHostAiDirectBeapAdRequest'

vi.mock('../../../../src/auth/session', () => ({
  getAccessToken: () => 'tok',
}))

const listRows: HandshakeRecord[] = []

vi.mock('../../handshake/db', () => ({
  listHandshakeRecords: () => listRows,
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    enabled: true,
    use_coordination: true,
    coordination_url: 'https://coord.example',
  }),
  computeLocalP2PEndpoint: () => 'http://192.168.0.5:9/beap/ingest',
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-sand-1',
  getOrchestratorMode: () => ({ mode: 'sandbox' as const }),
}))

vi.mock('../hostAiEffectiveRole', () => ({
  getHostAiLedgerRoleSummaryFromDb: () => ({
    can_publish_host_endpoint: false,
    can_probe_host_endpoint: true,
    any_orchestrator_mismatch: false,
    effective_host_ai_role: 'sandbox' as const,
  }),
}))

const postReq = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 200 })))
vi.mock('../p2pSignalRelayPost', () => ({
  postHostAiDirectBeapAdRequestToCoordination: (...a: unknown[]) => postReq(...a),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/sandbox-beap-req-test' } }))

vi.mock('../hostAiPairingStateStore', () => ({
  isHostAiLedgerAsymmetricTerminal: () => false,
}))

function sandboxHostRow(hid: string): HandshakeRecord {
  return {
    handshake_id: hid,
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: false,
    initiator: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
    acceptor: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as any,
    external_processing: {} as any,
    created_at: '2020-01-01',
    activated_at: '2020-01-01',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: 'http://192.168.0.5:9/beap/ingest',
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    handshake_type: 'internal',
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    initiator_device_name: 'S',
    acceptor_device_name: 'H',
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
  } as HandshakeRecord
}

describe('sandboxMaybeRequestHostDirectBeapAdvertisement', () => {
  afterEach(() => {
    listRows.length = 0
    postReq.mockClear()
    resetHostAdvertisedMvpDirectForTests()
    resetSandboxHostAiDirectBeapAdRequestStateForTests()
  })

  it('posts republish request when peer ad missing and resolve denies peer_host_beap_not_advertised', async () => {
    listRows.push(sandboxHostRow('hs-sbx'))
    expect(peekHostAdvertisedMvpDirectEntry('hs-sbx')).toBeNull()
    const { sandboxMaybeRequestHostDirectBeapAdvertisement } = await import('../sandboxHostAiDirectBeapAdRequest')
    await sandboxMaybeRequestHostDirectBeapAdvertisement({} as any, 'test')
    expect(postReq).toHaveBeenCalledWith(
      expect.objectContaining({
        handshakeId: 'hs-sbx',
        senderDeviceId: 'dev-sand-1',
        receiverDeviceId: 'dev-host-1',
      }),
    )
  })

  it('does not post when peek already has peer URL', async () => {
    listRows.push(sandboxHostRow('hs-sbx2'))
    const { setHostAdvertisedMvpDirectForTests } = await import('../p2pEndpointRepair')
    setHostAdvertisedMvpDirectForTests('hs-sbx2', 'http://192.168.1.99:51249/beap/ingest', {
      ownerDeviceId: 'dev-host-1',
    })
    const { sandboxMaybeRequestHostDirectBeapAdvertisement } = await import('../sandboxHostAiDirectBeapAdRequest')
    await sandboxMaybeRequestHostDirectBeapAdvertisement({} as any, 'test')
    expect(postReq).not.toHaveBeenCalled()
  })
})

describe('resolveSandboxToHostHttpDirectIngest — poisoned ledger equals local BEAP', () => {
  afterEach(() => {
    resetHostAdvertisedMvpDirectForTests()
  })

  it('peer_host_beap_not_advertised (never treats local listener as Host)', () => {
    const row = sandboxHostRow('hs-p')
    const r = resolveSandboxToHostHttpDirectIngest({} as any, 'hs-p', row, '')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.host_ai_endpoint_deny_detail).toBe('peer_host_beap_not_advertised')
  })
})
