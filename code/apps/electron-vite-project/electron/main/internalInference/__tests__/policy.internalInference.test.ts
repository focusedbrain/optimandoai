import { describe, expect, test, vi } from 'vitest'

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: vi.fn(() => ({ coordination_url: 'https://coord.test.invalid' })),
}))
import { getP2PConfig } from '../../p2p/p2pConfig'
import { InternalInferenceErrorCode } from '../errors'
import {
  assertRecordForServiceRpc,
  internalInferenceEndpointGateOk,
  isCoordinationServiceEndpointUrl,
  outboundP2pBearerToCounterpartyIngest,
  p2pEndpointKind,
  p2pEndpointMvpClass,
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
  test('returns local_p2p_auth_token (Bearer to present on peer /beap/ingest), not counterparty token', () => {
    // baseRecord has local_p2p_auth_token='t', counterparty_p2p_token='pt'
    // Outbound must present OUR token ('t'), NOT the peer's token ('pt').
    expect(outboundP2pBearerToCounterpartyIngest(baseRecord({}))).toBe('t')
    expect(outboundP2pBearerToCounterpartyIngest(baseRecord({ local_p2p_auth_token: '  my-secret  ' }))).toBe('my-secret')
    // Sanity: must NOT return the counterparty token — that is the pre-fd61df3e bug value.
    expect(outboundP2pBearerToCounterpartyIngest(baseRecord({}))).not.toBe('pt')
  })
})

// ---------------------------------------------------------------------------
// Regression: isCoordinationServiceEndpointUrl over-matched /beap/ingest
// When coordination and the P2P server share the same host:port (single-machine
// setup), /beap/ingest was misclassified 'relay' — blocking the host BEAP ad
// and breaking cross-device host-AI inference.
// ---------------------------------------------------------------------------
describe('isCoordinationServiceEndpointUrl — /beap/ingest must never be relay (regression)', () => {
  const coordSameHost = 'http://192.168.178.28:51249'

  test('REGRESSION: /beap/ingest on same host:port as coordination_url → false (not coordination)', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/ingest', coordSameHost)).toBe(false)
  })

  test('REGRESSION: /beap/ingest with trailing path segment on same host → false', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/ingest/foo', coordSameHost)).toBe(false)
  })

  test('/beap/capsule on same host → true (genuine coordination route)', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/capsule', coordSameHost)).toBe(true)
  })

  test('/beap/ws on same host → true (genuine coordination route)', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/ws', coordSameHost)).toBe(true)
  })

  test('/beap/p2p-signal on same host → true (genuine coordination route)', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/p2p-signal', coordSameHost)).toBe(true)
  })

  test('/beap/flush-queued on same host → true (genuine coordination route)', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/flush-queued', coordSameHost)).toBe(true)
  })

  test('different host → false regardless of path', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.29:51249/beap/capsule', coordSameHost)).toBe(false)
  })

  test('relay.wrdesk.com /beap/capsule → true (fast-path preserved)', () => {
    expect(isCoordinationServiceEndpointUrl('https://relay.wrdesk.com/beap/capsule', null)).toBe(true)
  })

  test('no coordinationBase → false for non-wrdesk URLs', () => {
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/ingest', null)).toBe(false)
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/ingest', undefined)).toBe(false)
    expect(isCoordinationServiceEndpointUrl('http://192.168.178.28:51249/beap/ingest', '')).toBe(false)
  })
})

describe('p2pEndpointKind — same-host coordination regression', () => {
  test('REGRESSION: /beap/ingest on same host as coordination_url → direct', () => {
    vi.mocked(getP2PConfig).mockReturnValueOnce({ coordination_url: 'http://192.168.178.28:51249' } as any)
    expect(p2pEndpointKind({}, 'http://192.168.178.28:51249/beap/ingest')).toBe('direct')
  })

  test('/beap/capsule on same host as coordination_url → relay', () => {
    vi.mocked(getP2PConfig).mockReturnValueOnce({ coordination_url: 'http://192.168.178.28:51249' } as any)
    expect(p2pEndpointKind({}, 'http://192.168.178.28:51249/beap/capsule')).toBe('relay')
  })

  test('different host → direct', () => {
    vi.mocked(getP2PConfig).mockReturnValueOnce({ coordination_url: 'http://192.168.178.28:51249' } as any)
    expect(p2pEndpointKind({}, 'http://10.0.0.5:51249/beap/ingest')).toBe('direct')
  })
})

describe('p2pEndpointMvpClass — same-host coordination regression', () => {
  test('REGRESSION: /beap/ingest on same host as coordination_url → direct_lan (not relay)', () => {
    vi.mocked(getP2PConfig).mockReturnValueOnce({ coordination_url: 'http://192.168.178.28:51249' } as any)
    expect(p2pEndpointMvpClass({}, 'http://192.168.178.28:51249/beap/ingest')).toBe('direct_lan')
  })
})
