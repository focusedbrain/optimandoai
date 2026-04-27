/**
 * Host AI P2P: expired / stuck signaling sessions must be evicted before reuse_active or ensure allocation.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { getInstanceIdMock, getHSMock, getOrchModeMock, startOfferMock } = vi.hoisted(() => {
  const getInst = vi.fn(() => 'dev-sand-1')
  const getHS = vi.fn()
  const getOrch = vi.fn(() => ({
    mode: 'sandbox' as const,
    deviceName: 'd',
    instanceId: 'dev-sand-1',
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
  P2pSessionPhase,
  P2pSessionUiPhase,
} from '../p2pSession/p2pInferenceSessionManager'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

const OLD_SID = '11111111-1111-4111-8111-111111111111'

function baseHS() {
  return {
    handshake_id: 'hs-stale-1',
    handshake_type: 'internal' as const,
    state: 'ACTIVE' as const,
    local_role: 'initiator' as const,
    initiator_device_role: 'sandbox' as const,
    acceptor_device_role: 'host' as const,
    initiator_device_id: 'dev-sand-1',
    acceptor_device_id: 'dev-host-1',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
    internal_coordination_identity_complete: true,
    initiator: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's1' },
    acceptor: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's1' },
    local_p2p_auth_token: 'tok',
    counterparty_p2p_token: 'peer-tok',
    p2p_endpoint: 'http://192.168.1.1:9/beap/ingest',
  }
}

describe('ensureHostAiP2pSession stale signaling eviction', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.useFakeTimers({ now: new Date('2026-04-27T12:00:00.000Z').getTime() })
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
    startOfferMock.mockClear()
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    getOrchModeMock.mockReturnValue({
      mode: 'sandbox',
      deviceName: 'd',
      instanceId: 'dev-sand-1',
      pairingCode: '000000',
      connectedPeers: [],
    })
    getHSMock.mockImplementation(() => baseHS)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
  })

  it('expires stuck signaling, allocates new session, starts offer, never reuse_active', async () => {
    const t0 = Date.now()
    _seedHostAiP2pSessionForTests({
      handshakeId: 'hs-stale-1',
      sessionId: OLD_SID,
      phase: P2pSessionPhase.signaling,
      p2pUiPhase: P2pSessionUiPhase.connecting,
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: t0 - 130_000,
      signalingExpiresAt: t0 - 1,
      boundLocalDeviceId: 'dev-sand-1',
      boundPeerDeviceId: 'dev-host-1',
      offerStartRequested: true,
      offerCreateDispatched: true,
      observedPeerConnectionCreateBegin: true,
      observedCreateOfferBegin: false,
      p2pWebrtcLocalRole: 'offerer',
    })

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const st = await ensureHostAiP2pSession('hs-stale-1', 'model_selector')

    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).toMatch(/\[HOST_AI_SESSION_EXPIRE\]/)
    expect(joined).toMatch(/reason=signaling_window_expired|reason=stuck_signaling/)
    expect(joined).toMatch(/\[HOST_AI_SESSION_ENSURE\] begin handshake=hs-stale-1/)
    expect(joined).not.toMatch(/\[HOST_AI_SESSION_ENSURE\] reuse_active /)

    expect(st.sessionId).toBeTruthy()
    expect(st.sessionId).not.toBe(OLD_SID)

    expect(startOfferMock).toHaveBeenCalled()
    const offerArgSid = startOfferMock.mock.calls[0]?.[1]
    expect(offerArgSid).toBe(st.sessionId)

    const live = getSessionState('hs-stale-1')
    expect(live?.sessionId).toBe(st.sessionId)

    log.mockRestore()
  })
})
