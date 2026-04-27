/**
 * Host AI `listHostCapabilities` route order: WebRTC (incl. over relay signaling) → direct HTTP.
 * `HOST_AI_DIRECT_PEER_BEAP_MISSING` is direct-HTTP resolution only, not “no P2P route.”
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord, type PartyIdentity } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { P2pSessionPhase, type P2pSessionState } from '../p2pSession/p2pInferenceSessionManager'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceCapabilitiesResultWire } from '../types'
import { listHostCapabilities } from '../transport/internalInferenceTransport'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import * as p2pEndpointRepair from '../p2pEndpointRepair'
import { resetHostAdvertisedMvpDirectForTests } from '../p2pEndpointRepair'
import {
  HostAiProbeCode,
  hostAiUserFacingMessageFromTarget,
  shouldSuppressOllamaUnreachableSandboxAsHostFailure,
} from '../../../../src/lib/hostAiUiDiagnostics'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/wrdesk-lhc-route', getAppPath: () => '/tmp' },
}))

const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'dev-sand-1'))
const getHandshakeDbMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const getSessionStateMock = vi.hoisted(() => vi.fn())
const isDcUpMock = vi.hoisted(() => vi.fn())
const requestCapsMock = vi.hoisted(() => vi.fn())

vi.mock('../../orchestrator/orchestratorModeStore', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../orchestrator/orchestratorModeStore')>()
  return { ...a, getInstanceId: () => getInstanceIdMock() }
})

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

vi.mock('../p2pSession/p2pInferenceSessionManager', async (orig) => {
  const a = await orig<typeof import('../p2pSession/p2pInferenceSessionManager')>()
  return { ...a, getSessionState: (h: string) => getSessionStateMock(h) }
})

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: (h: string) => isDcUpMock(h),
}))

vi.mock('../p2pDc/p2pDcCapabilities', () => ({
  requestHostInferenceCapabilitiesOverDataChannel: (
    h: string,
    sid: string,
    t: number,
    o: { requestId: string },
  ) => requestCapsMock(h, sid, t, o),
}))

vi.mock('../hostAiRelayCapability', async (orig) => {
  const a = await orig<typeof import('../hostAiRelayCapability')>()
  return {
    ...a,
    resolveRelayHostAiP2pSignalingForTransportDecider: vi.fn().mockResolvedValue('supported' as const),
  }
})

function party(): PartyIdentity {
  return { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' }
}

function baseRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-route',
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    initiator: party(),
    acceptor: party(),
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: 'a',
    last_capsule_hash_received: 'b',
    effective_policy: {} as any,
    external_processing: 'none' as any,
    created_at: '2020-01-01',
    activated_at: '2020-01-01',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: '1',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_device_name: 'S',
    acceptor_device_name: 'H',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: 'https://relay.example/beap/ingest/relay?x=1',
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    ...over,
  } as HandshakeRecord
}

const minWire: InternalInferenceCapabilitiesResultWire = {
  type: 'internal_inference_capabilities_result',
  schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
  request_id: 'rid',
  handshake_id: 'hs-route',
  sender_device_id: 'dev-host-1',
  target_device_id: 'dev-sand-1',
  created_at: new Date().toISOString(),
  host_computer_name: 'H',
  host_pairing_code: '000000',
  models: [],
  policy_enabled: true,
  active_local_llm: { provider: 'ollama', model: 'm1', label: 'm1', enabled: true },
  active_chat_model: 'm1',
}

describe('listHostCapabilities — Host AI route (WebRTC/relay before direct HTTP)', () => {
  const sess: P2pSessionState = {
    handshakeId: 'hs-route',
    sessionId: 'p2p-sess-1',
    phase: P2pSessionPhase.ready,
    p2pUiPhase: 'ready',
    lastErrorCode: null,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
    signalingExpiresAt: null,
    boundLocalDeviceId: 'dev-sand-1',
    boundPeerDeviceId: 'dev-host-1',
  }

  beforeEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    getHandshakeDbMock.mockResolvedValue({})
    isDcUpMock.mockReturnValue(false)
    requestCapsMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('(1) relay + full P2P + no direct peer BEAP ad: capabilities succeed via data-channel (not peer-ad missing)', async () => {
    const resolveDirect = vi.spyOn(p2pEndpointRepair, 'resolveSandboxToHostHttpDirectIngest')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    isDcUpMock.mockReturnValue(true)
    getSessionStateMock.mockReturnValue(sess)
    requestCapsMock.mockResolvedValue({ ok: true, wire: minWire, rawJson: null })
    const r = await listHostCapabilities('hs-route', {
      record: baseRecord(),
      token: 'tok',
      timeoutMs: 10_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.wire.type).toBe('internal_inference_capabilities_result')
    }
    expect(requestCapsMock).toHaveBeenCalled()
    /** Direct-HTTP `resolve` must not be required when DC delivers capabilities. */
    expect(resolveDirect).not.toHaveBeenCalled()
    resolveDirect.mockRestore()
  })

  it('(2) relay + data channel up + no peer direct: still use WebRTC path (not HTTP-only failure)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    isDcUpMock.mockReturnValue(true)
    getSessionStateMock.mockReturnValue(sess)
    requestCapsMock.mockResolvedValue({ ok: true, wire: minWire, rawJson: null })
    const r = await listHostCapabilities('hs-route', {
      record: baseRecord(),
      token: 'tok',
      timeoutMs: 10_000,
    })
    expect(r.ok).toBe(true)
    expect(requestCapsMock).toHaveBeenCalled()
  })

  it('(3) P2P/WebRTC off + no peer-attested direct BEAP: HOST_AI_DIRECT_PEER_BEAP_MISSING (resolver, not raw ledger dial)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
    getSessionStateMock.mockReturnValue(null)
    const localBeap = 'http://192.168.0.5:9/beap/ingest'
    const resolveDirect = vi.spyOn(p2pEndpointRepair, 'resolveSandboxToHostHttpDirectIngest')
    const r = await listHostCapabilities('hs-route', {
      record: baseRecord({ p2p_endpoint: localBeap }),
      token: 'tok',
      timeoutMs: 10_000,
    })
    expect(r.ok).toBe(false)
    expect(resolveDirect).not.toHaveBeenCalled()
    resolveDirect.mockRestore()
    if (!r.ok) {
      expect(r.reason).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
    }
  })

  it('(5) sandbox-local Ollama down must not be labeled as Host failure when host wire says Ollama is up', () => {
    expect(
      shouldSuppressOllamaUnreachableSandboxAsHostFailure(HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX, true),
    ).toBe(true)
    const msg = hostAiUserFacingMessageFromTarget(
      { inference_error_code: HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX, hostWireOllamaReachable: true },
    )
    expect(msg).toBeNull()
  })
})
