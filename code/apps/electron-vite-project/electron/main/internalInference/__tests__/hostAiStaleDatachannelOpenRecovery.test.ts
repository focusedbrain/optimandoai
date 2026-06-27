/**
 * Host AI P2P: stale cached datachannel_open recovery (transport reset + single re-offer on sandbox ad_request).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { getInstanceIdMock, getHSMock, getOrchModeMock, startOfferMock } = vi.hoisted(() => {
  const getInst = vi.fn(() => 'dev-host-1')
  const getHS = vi.fn()
  const getOrch = vi.fn(() => ({
    mode: 'host' as const,
    deviceName: 'host-box',
    instanceId: 'dev-host-1',
    pairingCode: '000000',
    connectedPeers: [] as const,
  }))
  const startOffer = vi.fn().mockResolvedValue(undefined)
  return { getInstanceIdMock: getInst, getHSMock: getHS, getOrchModeMock: getOrch, startOfferMock: startOffer }
})

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceIdMock(),
  getOrchestratorMode: () => getOrchModeMock(),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => ({}),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, _id: string) => getHSMock()(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../hostAiRemoteInferencePolicyResolve', () => ({
  resolveHostAiRemoteInferencePolicyBestEffort: () => ({
    allowRemoteInference: true,
    explicitUserDisabled: false,
    policySource: 'explicit_user_allow' as const,
    remoteChoice: 'allow' as const,
  }),
}))

vi.mock('../hostAiWebrtcOfferStart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hostAiWebrtcOfferStart')>()
  return {
    ...actual,
    startWebrtcOfferForHostAiSession: (...args: unknown[]) => startOfferMock(...args),
  }
})

import {
  _resetP2pInferenceSessionsForTests,
  _seedHostAiP2pSessionForTests,
  ensureHostAiP2pSession,
  getSessionState,
  markDataChannelOpenForP2pSession,
  notifyWebrtcTransportTerminalIceOrConnectionFailed,
  P2pSessionPhase,
  P2pSessionUiPhase,
  resetHostAiP2pSessionForTransportLoss,
} from '../p2pSession/p2pInferenceSessionManager'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

const OLD_SID = 'c6f9dadd-470e-4f8c-8ee3-97e798fab832'
const HID = 'hs-stale-dc-1'

function hostHS() {
  return {
    handshake_id: HID,
    handshake_type: 'internal' as const,
    state: 'ACTIVE' as const,
    local_role: 'initiator' as const,
    initiator_device_role: 'host' as const,
    acceptor_device_role: 'sandbox' as const,
    initiator_device_id: 'dev-host-1',
    acceptor_device_id: 'dev-sand-1',
    initiator_coordination_device_id: 'dev-host-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    internal_coordination_identity_complete: true,
    initiator: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's1' },
    acceptor: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's1' },
    local_p2p_auth_token: 'tok',
    counterparty_p2p_token: 'peer-tok',
    p2p_endpoint: 'http://192.168.1.1:9/beap/ingest',
  }
}

function seedOpenSession() {
  _seedHostAiP2pSessionForTests({
    handshakeId: HID,
    sessionId: OLD_SID,
    phase: P2pSessionPhase.datachannel_open,
    p2pUiPhase: P2pSessionUiPhase.ready,
    lastErrorCode: null,
    connectedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    signalingExpiresAt: null,
    boundLocalDeviceId: 'dev-host-1',
    boundPeerDeviceId: 'dev-sand-1',
    offerStartRequested: true,
    offerCreateDispatched: true,
    observedPeerConnectionCreateBegin: true,
    observedCreateOfferBegin: true,
    p2pWebrtcLocalRole: 'offerer',
  })
}

describe('stale datachannel_open recovery', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.useFakeTimers({ now: new Date('2026-06-27T08:08:00.000Z').getTime() })
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
    startOfferMock.mockClear()
    getInstanceIdMock.mockReturnValue('dev-host-1')
    getOrchModeMock.mockReturnValue({
      mode: 'host',
      deviceName: 'host-box',
      instanceId: 'dev-host-1',
      pairingCode: '000000',
      connectedPeers: [],
    })
    getHSMock.mockImplementation(() => hostHS)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
  })

  it('sandbox_peer_beap_ad_request on datachannel_open resets and starts one new offer', async () => {
    seedOpenSession()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const st = await ensureHostAiP2pSession(HID, 'sandbox_peer_beap_ad_request')

    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).toMatch(/stale_datachannel_peer_ad_request/)
    expect(joined).toMatch(/\[HOST_AI_SESSION_TRANSPORT_RESET\]/)
    expect(joined).not.toMatch(/\[HOST_AI_SESSION_ENSURE\] reuse_active handshake=/)
    expect(joined).toMatch(/\[HOST_AI_SESSION_ENSURE\] ensure_chain_start handshake=hs-stale-dc-1/)
    expect(joined).toMatch(/\[HOST_AI_SESSION_ENSURE\] begin handshake=hs-stale-dc-1/)

    expect(st.sessionId).toBeTruthy()
    expect(st.sessionId).not.toBe(OLD_SID)
    expect(st.phase).toBe(P2pSessionPhase.signaling)
    expect(startOfferMock).toHaveBeenCalledTimes(1)

    log.mockRestore()
  })

  it('second ad_request while recovery latched does not start another offer', async () => {
    seedOpenSession()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const p1 = ensureHostAiP2pSession(HID, 'sandbox_peer_beap_ad_request')
    const p2 = ensureHostAiP2pSession(HID, 'sandbox_peer_beap_ad_request')
    await Promise.all([p1, p2])

    expect(startOfferMock).toHaveBeenCalledTimes(1)
    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).toMatch(/reuse_inflight_stale_recovery|reuse_active_stale_recovery_latched|reuse_inflight handshake=/)

    log.mockRestore()
  })

  it('resetHostAiP2pSessionForTransportLoss ignores non-matching session id', () => {
    seedOpenSession()
    const ok = resetHostAiP2pSessionForTransportLoss(HID, 'other-session-id', 'test')
    expect(ok).toBe(false)
    expect(getSessionState(HID)?.phase).toBe(P2pSessionPhase.datachannel_open)
  })

  it('notifyWebrtcTransportTerminalIceOrConnectionFailed ignores disconnected', () => {
    seedOpenSession()
    notifyWebrtcTransportTerminalIceOrConnectionFailed(HID, OLD_SID, 'disconnected', 'connected')
    expect(getSessionState(HID)?.phase).toBe(P2pSessionPhase.datachannel_open)
  })

  it('notifyWebrtcTransportTerminalIceOrConnectionFailed resets on failed', () => {
    seedOpenSession()
    notifyWebrtcTransportTerminalIceOrConnectionFailed(HID, OLD_SID, 'failed', 'failed')
    expect(getSessionState(HID)).toBeNull()
  })

  it('markDataChannelOpen clears stale recovery latch for a new episode', async () => {
    seedOpenSession()
    await ensureHostAiP2pSession(HID, 'sandbox_peer_beap_ad_request')
    const newSid = getSessionState(HID)?.sessionId
    expect(newSid).toBeTruthy()
    markDataChannelOpenForP2pSession(HID, newSid!)
    expect(getSessionState(HID)?.phase).toBe(P2pSessionPhase.datachannel_open)

    startOfferMock.mockClear()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ensureHostAiP2pSession(HID, 'sandbox_peer_beap_ad_request')
    expect(startOfferMock).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })
})
