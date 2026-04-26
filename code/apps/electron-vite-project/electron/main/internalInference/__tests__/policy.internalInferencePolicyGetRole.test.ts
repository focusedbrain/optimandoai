/**
 * B: internal-inference-policy authorization is `assertHostSendsResultToSandbox` (handshake), not isHostMode.
 */
import { describe, expect, test, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { assertHostSendsResultToSandbox } from '../policy'

const oms = vi.hoisted(() => ({ instanceId: 'dev-host' }))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({ coordination_url: 'https://c.test/' }),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => oms.instanceId,
}))

function base(): HandshakeRecord {
  return {
    handshake_id: 'h1',
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator' as any,
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as any,
    external_processing: 'none' as any,
    created_at: 'x',
    activated_at: 'x',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: 'v',
    acceptor_wrdesk_policy_hash: 'h',
    acceptor_wrdesk_policy_version: 'v',
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: 'http://x/beap/ingest',
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    initiator: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
    acceptor: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
    handshake_type: 'internal' as any,
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    internal_peer_pairing_code: '123456',
    initiator_device_name: 'H',
    acceptor_device_name: 'S',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'dev-host',
    acceptor_coordination_device_id: 'dev-sand',
  } as any
}

describe('policy — host-side policy GET (no configured_mode)', () => {
  test('B: same handshake passes assertHostSendsResultToSandbox with wrong orchestrator file mode', () => {
    oms.instanceId = 'dev-host'
    const a = assertHostSendsResultToSandbox(base())
    expect(a.ok).toBe(true)
  })
})
