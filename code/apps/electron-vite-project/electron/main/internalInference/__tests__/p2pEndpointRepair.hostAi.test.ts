/**
 * Repair pass must not promote relay → “direct” using this process’s published URL on sandbox rows
 * (that URL can be the local sandbox BEAP, not the peer host’s).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { resetP2pEndpointRepairSessionGates, runP2pEndpointRepairPass } from '../p2pEndpointRepair'

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-sand-1',
}))

const updateHandshakeRecord = vi.fn()
const listRows: HandshakeRecord[] = []

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    enabled: true,
    coordination_url: 'https://coord.example/beap/ingest',
  }),
  computeLocalP2PEndpoint: () => 'http://192.168.0.5:9/beap/ingest',
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(),
  listHandshakeRecords: () => listRows,
  updateHandshakeRecord: (_db: unknown, next: HandshakeRecord) => {
    updateHandshakeRecord(next)
  },
}))

function relayRow(hid: string): HandshakeRecord {
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
    p2p_endpoint: 'https://coord.example/beap/ingest/relay?x=1',
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

describe('runP2pEndpointRepairPass', () => {
  afterEach(() => {
    listRows.length = 0
    updateHandshakeRecord.mockReset()
    resetP2pEndpointRepairSessionGates()
  })

  it('C: does not set relay p2p_endpoint to local published direct URL when no Host-advertised header was stored', () => {
    listRows.push(relayRow('hs-relay'))
    runP2pEndpointRepairPass({} as any, 'test_ctx')
    expect(updateHandshakeRecord).not.toHaveBeenCalled()
  })
})
