/**
 * Log / contract validation for Host AI route resolver (no I/O).
 * Complements hostAiRoutingCorrectness.regression.test.ts (probe + listHostCapabilities).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { deriveInternalHostAiPeerRoles } from '../policy'
import { resolveHostAiRoute, type HostAiCanonicalRouteResolveInput } from '../transport/hostAiRouteResolve'

function baseRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-log-contract',
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
    handshakeId: 'hs-log-contract',
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

function parseRouteResolveJsonFromCalls(calls: Array<Array<unknown>>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const c of calls) {
    const s = c.map(String).join(' ')
    const idx = s.indexOf('[HOST_AI_ROUTE_RESOLVE]')
    if (idx === -1) continue
    const jsonStart = s.indexOf('{', idx)
    if (jsonStart === -1) continue
    try {
      out.push(JSON.parse(s.slice(jsonStart)) as Record<string, unknown>)
    } catch {
      /* ignore */
    }
  }
  return out
}

describe('Host AI log contracts — resolveHostAiRoute (emitLog)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('sandbox-local BEAP / peer ad equals local MVP: deny + failure_code HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST', () => {
    const localBeap = 'http://192.168.0.5:51249/beap/ingest'
    resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: localBeap,
          ownerDeviceId: 'dev-host-1',
          source: 'http_header',
        },
        localBeapEndpoint: localBeap,
      }),
      { emitLog: true },
    )
    const rows = parseRouteResolveJsonFromCalls(logSpy.mock.calls as Array<Array<unknown>>)
    expect(rows.length).toBeGreaterThan(0)
    const last = rows[rows.length - 1]
    expect(last.outcome).toBe('deny')
    expect(last.decision).toBe('failed')
    expect(last.failure_code).toBe(InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST)
    expect(last.direct_http_available).toBe(false)
  })

  it('no peer advertisement and no relay: deny + failure_code HOST_AI_DIRECT_PEER_BEAP_MISSING', () => {
    resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: null,
        relay: { serverAttestedAvailable: false },
      }),
      { emitLog: true },
    )
    const rows = parseRouteResolveJsonFromCalls(logSpy.mock.calls as Array<Array<unknown>>)
    const last = rows[rows.length - 1]
    expect(last.outcome).toBe('deny')
    expect(last.failure_code).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
  })

  it('peer ad present but not viable (invalid source at runtime): deny + HOST_AI_NO_VERIFIED_PEER_ROUTE', () => {
    resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: 'http://real-host.test/beap/ingest',
          ownerDeviceId: 'dev-host-1',
          source: 'invalid' as 'http_header',
        },
      }),
      { emitLog: true },
    )
    const rows = parseRouteResolveJsonFromCalls(logSpy.mock.calls as Array<Array<unknown>>)
    const last = rows[rows.length - 1]
    expect(last.outcome).toBe('deny')
    expect(last.failure_code).toBe(InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE)
  })

  it('peer advertisement owner mismatch: deny + HOST_AI_ROUTE_OWNER_MISMATCH', () => {
    resolveHostAiRoute(
      baseInput({
        ledgerP2pEndpoint: 'http://looks-direct.test/beap/ingest',
        peerDirectAdvertisement: {
          url: 'http://other.test/beap/ingest',
          ownerDeviceId: 'wrong-owner',
          source: 'http_header',
        },
      }),
      { emitLog: true },
    )
    const rows = parseRouteResolveJsonFromCalls(logSpy.mock.calls as Array<Array<unknown>>)
    const last = rows[rows.length - 1]
    expect(last.outcome).toBe('deny')
    expect(last.failure_code).toBe(InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH)
  })

  it('verified peer-Host direct HTTP: allow, selected_transport=direct_http, peer_host_device_id=owner', () => {
    resolveHostAiRoute(
      baseInput({
        peerDirectAdvertisement: {
          url: 'http://real-host.test:51249/beap/ingest',
          ownerDeviceId: 'dev-host-1',
          source: 'relay',
        },
      }),
      { emitLog: true },
    )
    const rows = parseRouteResolveJsonFromCalls(logSpy.mock.calls as Array<Array<unknown>>)
    const last = rows[rows.length - 1]
    expect(last.outcome).toBe('allow')
    expect(last.decision).toBe('ok')
    expect(last.selected_transport).toBe('direct_http')
    expect(last.peer_host_device_id).toBe('dev-host-1')
    expect(last.failure_code).toBeUndefined()
  })

  it('WebRTC DC ready: allow, selected_transport=webrtc_dc (direct HTTP also advertised)', () => {
    resolveHostAiRoute(
      baseInput({
        webrtc: {
          dataChannelUp: true,
          sessionHandshakeId: 'hs-log-contract',
          boundPeerDeviceId: 'dev-host-1',
        },
        peerDirectAdvertisement: {
          url: 'http://real-host.test/beap/ingest',
          ownerDeviceId: 'dev-host-1',
          source: 'http_header',
        },
      }),
      { emitLog: true },
    )
    const rows = parseRouteResolveJsonFromCalls(logSpy.mock.calls as Array<Array<unknown>>)
    const last = rows[rows.length - 1]
    expect(last.outcome).toBe('allow')
    expect(last.selected_transport).toBe('webrtc_dc')
  })
})
