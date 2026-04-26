import { describe, expect, test, vi } from 'vitest'

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({ coordination_url: 'https://coord.test.invalid' }),
}))
import { InternalInferenceErrorCode } from '../errors'
import {
  assertRecordForServiceRpc,
  internalInferenceEndpointGateOk,
  outboundP2pBearerToCounterpartyIngest,
} from '../policy'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'

const uid = 'u1@x|s'

function baseRecord(over: Partial<HandshakeRecord>): HandshakeRecord {
  return {
    handshake_id: 'h',
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: false,
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
    initiator: { email: 'a@a', wrdesk_user_id: uid, iss: 'i', sub: 's' },
    acceptor: { email: 'a@a', wrdesk_user_id: uid, iss: 'i', sub: 's' },
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: 'v',
    acceptor_wrdesk_policy_hash: 'h',
    acceptor_wrdesk_policy_version: 'v',
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: 'http://10.0.0.1:1/beap/ingest',
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    handshake_type: 'internal',
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    initiator_device_name: 'H',
    acceptor_device_name: 'S',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'h1',
    acceptor_coordination_device_id: 's1',
    ...over,
  } as HandshakeRecord
}

describe('assertRecordForServiceRpc (Host inference gate)', () => {
  test('rejects REVOKED — inference must not use stale session rows', () => {
    const ar = assertRecordForServiceRpc(
      baseRecord({ state: HandshakeState.REVOKED, revoked_at: '2020-01-02' }),
    )
    expect(ar.ok).toBe(false)
    if (!ar.ok) expect(ar.code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })
})

describe('internalInferenceEndpointGateOk', () => {
  const relay = 'https://relay.wrdesk.com/beap/capsule'
  const stackOn = {
    p2pInferenceEnabled: true,
    p2pInferenceWebrtcEnabled: true,
    p2pInferenceSignalingEnabled: true,
  }
  const stackOff = {
    p2pInferenceEnabled: false,
    p2pInferenceWebrtcEnabled: false,
    p2pInferenceSignalingEnabled: false,
  }

  test('relay + full P2P stack passes (signaling-only URL; DC is data plane)', () => {
    expect(internalInferenceEndpointGateOk({}, relay, stackOn)).toBe(true)
  })

  test('relay without P2P stack fails (legacy: no direct HTTP ingest)', () => {
    expect(internalInferenceEndpointGateOk({}, relay, stackOff)).toBe(false)
  })

  test('direct LAN ingest passes without P2P stack', () => {
    expect(internalInferenceEndpointGateOk({}, 'http://192.168.1.2:51249/beap/ingest', stackOff)).toBe(true)
  })
})

describe('outboundP2pBearerToCounterpartyIngest', () => {
  test('returns counterparty_p2p_token (Bearer to peer /beap/ingest), not local', () => {
    expect(outboundP2pBearerToCounterpartyIngest(baseRecord({}))).toBe('pt')
    expect(outboundP2pBearerToCounterpartyIngest(baseRecord({ counterparty_p2p_token: '  secret  ' }))).toBe('secret')
  })
})
