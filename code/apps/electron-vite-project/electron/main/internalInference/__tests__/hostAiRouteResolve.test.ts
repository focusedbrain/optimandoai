import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { deriveInternalHostAiPeerRoles } from '../policy'
import { resolveHostAiRoute, type HostAiCanonicalRouteResolveInput } from '../transport/hostAiRouteResolve'

function baseRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-resolve-1',
    relationship_id: 'r1',
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
    p2p_endpoint: 'http://peer.example/beap/ingest',
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
    ...over,
  } as HandshakeRecord
}

function baseInput(over: Partial<HostAiCanonicalRouteResolveInput> = {}): HostAiCanonicalRouteResolveInput {
  const record = baseRecord()
  const roles = deriveInternalHostAiPeerRoles(record, 'dev-sand-1')
  if (!roles.ok) throw new Error('fixture roles')
  return {
    handshakeId: 'hs-resolve-1',
    localDeviceId: 'dev-sand-1',
    peerHostDeviceId: 'dev-host-1',
    record,
    roles,
    webrtc: null,
    peerDirectAdvertisement: null,
    localBeapEndpoint: 'http://192.168.0.5:51249/beap/ingest',
    relay: { serverAttestedAvailable: false },
    ...over,
  }
}

describe('resolveHostAiRoute', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects peer advertisement URL that matches local BEAP (self is not peer Host)', () => {
    const localBeap = 'http://192.168.0.5:51249/beap/ingest'
    const r = resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: localBeap,
          ownerDeviceId: 'dev-host-1',
          source: 'memory_map',
        },
        localBeapEndpoint: localBeap,
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST)
    }
  })

  it('does not treat raw ledger p2p_endpoint as verified direct HTTP (syntactic URL only)', () => {
    const r = resolveHostAiRoute(
      baseInput({
        ledgerP2pEndpoint: 'http://looks-direct.test/beap/ingest',
        peerDirectAdvertisement: null,
        webrtc: null,
        relay: { serverAttestedAvailable: false },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
    }
  })

  it('accepts verified direct HTTP from memory_map advertisement with matching owner', () => {
    const r = resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: 'http://real-host.test:51249/beap/ingest',
          ownerDeviceId: 'dev-host-1',
          source: 'memory_map',
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.transport).toBe('direct_http')
      expect(r.route.endpoint).toContain('real-host.test')
      expect(r.route.isVerifiedPeerHost).toBe(true)
      expect(r.route.source).toBe('host_advertisement')
    }
  })

  it('accepts verified direct HTTP from ledger_fallback with matching owner', () => {
    const r = resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: 'http://real-host.test:51249/beap/ingest',
          ownerDeviceId: 'dev-host-1',
          source: 'ledger_fallback',
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.transport).toBe('direct_http')
      expect(r.route.source).toBe('ledger_candidate')
    }
  })

  it('rejects advertisement owner mismatch vs peerHostDeviceId', () => {
    const r = resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: 'http://real-host.test/beap/ingest',
          ownerDeviceId: 'wrong-host',
          source: 'memory_map',
        },
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH)
    }
  })

  it('prefers WebRTC when data channel is up for same handshake and peer', () => {
    const r = resolveHostAiRoute(
      baseInput({
        webrtc: {
          dataChannelUp: true,
          sessionHandshakeId: 'hs-resolve-1',
          boundPeerDeviceId: 'dev-host-1',
        },
        peerDirectAdvertisement: {
          url: 'http://real-host.test/beap/ingest',
          ownerDeviceId: 'dev-host-1',
          source: 'memory_map',
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.transport).toBe('webrtc_dc')
    }
  })

  it('selects relay tunnel when attested and other paths unavailable', () => {
    const r = resolveHostAiRoute(
      baseInput({
        relay: { serverAttestedAvailable: true, relayEndpointUrl: 'https://relay.example/beap/ingest' },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.transport).toBe('relay_tunnel')
      expect(r.route.source).toBe('server_attested_relay')
    }
  })
})
