/**
 * Host AI list: internal + relay + no data channel is still a valid **connecting** WebRTC+relay path
 * (not legacy HTTP to relay). DC-up and direct LAN are separate cases.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\\\tmp\\\\wrdesk-vitest' },
  BrowserWindow: class {},
}))
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import { P2pSessionPhase, type P2pSessionState } from '../p2pSession/p2pInferenceSessionManager'
import {
  buildHostAiTransportDeciderInput,
  decideInternalInferenceTransport,
} from '../transport/decideInternalInferenceTransport'
import { getP2pInferenceFlags, resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'dev-sand-1'))
vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceIdMock(),
}))

function party(uid: string): PartyIdentity {
  return { email: `${uid}@t`, wrdesk_user_id: uid, iss: 'i', sub: `sub-${uid}` }
}

function baseInternal(
  p2pEndpoint: string,
  over: Partial<HandshakeRecord> = {},
): HandshakeRecord {
  return {
    handshake_id: 'hs-gate-1',
    relationship_id: 'r1',
    state: 'ACTIVE',
    initiator: party('u1'),
    acceptor: party('u1'),
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 1,
    last_seq_received: 0,
    last_capsule_hash_sent: 'a',
    last_capsule_hash_received: 'b',
    effective_policy: {} as any,
    external_processing: 'none',
    created_at: new Date().toISOString(),
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: '1',
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_device_name: 'S',
    acceptor_device_name: 'H',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: p2pEndpoint,
    ...over,
  } as HandshakeRecord
}

describe('decideInternalInferenceTransport — internal same-principal relay gating', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
  })

  it('(1) internal + relay + no DC + live session (non-failed) → connecting + webrtc (not legacy closed)', () => {
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    const hr = baseInternal(relay)
    const p2pSession: P2pSessionState = {
      handshakeId: hr.handshake_id,
      sessionId: 's1',
      phase: P2pSessionPhase.signaling,
      p2pUiPhase: 'connecting',
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: Date.now() + 60_000,
      boundLocalDeviceId: 'a',
      boundPeerDeviceId: 'b',
    }
    const d = buildHostAiTransportDeciderInput({
      operationContext: 'list_targets',
      db: {},
      handshakeRecord: hr,
      featureFlags: getP2pInferenceFlags(),
      relayHostAiP2pSignaling: 'supported',
    })
    const dec = decideInternalInferenceTransport({
      ...d,
      sessionState: { handshakeId: hr.handshake_id, p2pSession, dataChannelUp: false },
    })
    expect(dec.selectorPhase).toBe('connecting')
    expect(dec.preferredTransport).toBe('webrtc_p2p')
    expect(dec.p2pTransportEndpointOpen).toBe(true)
    expect(dec.failureCode).toBeNull()
  })

  it('(2) internal + relay + DC up → ready + webrtc', () => {
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    const hr = baseInternal(relay)
    const p2pSession: P2pSessionState = {
      handshakeId: hr.handshake_id,
      sessionId: 's1',
      phase: P2pSessionPhase.ready,
      p2pUiPhase: 'ready',
      lastErrorCode: null,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
      signalingExpiresAt: null,
      boundLocalDeviceId: 'a',
      boundPeerDeviceId: 'b',
    }
    const d = buildHostAiTransportDeciderInput({
      operationContext: 'list_targets',
      db: {},
      handshakeRecord: hr,
      featureFlags: getP2pInferenceFlags(),
      relayHostAiP2pSignaling: 'supported',
    })
    const dec = decideInternalInferenceTransport({
      ...d,
      sessionState: { handshakeId: hr.handshake_id, p2pSession, dataChannelUp: true },
    })
    expect(dec.selectorPhase).toBe('ready')
    expect(dec.preferredTransport).toBe('webrtc_p2p')
  })

  it('(3) internal + direct LAN ingest + P2P stack off → legacy_http (not WebRTC when stack disabled)', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    const direct = 'http://192.168.0.5:51249/beap/ingest'
    const hr = baseInternal(direct)
    const d = buildHostAiTransportDeciderInput({
      operationContext: 'list_targets',
      db: { prepare: () => ({ get: () => ({ enabled: 1, port: 51249, bind_address: '0.0.0.0' }) }) } as any,
      handshakeRecord: hr,
      featureFlags: getP2pInferenceFlags(),
    })
    const dec = decideInternalInferenceTransport({
      ...d,
      sessionState: { handshakeId: hr.handshake_id, p2pSession: null, dataChannelUp: false },
    })
    expect(dec.preferredTransport).toBe('legacy_http')
    expect(dec.selectorPhase).toBe('legacy_http_available')
  })
})
