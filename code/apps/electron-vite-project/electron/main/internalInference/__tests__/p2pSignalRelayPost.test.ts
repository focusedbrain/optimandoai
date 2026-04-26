import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as authSession from '../../../../src/auth/session'
import { InternalInferenceErrorCode } from '../errors'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import {
  p2pSignalRelayPostTestHooks,
  resetP2pSignalRelayOutboundStateForTests,
  sendHostAiP2pSignalOutbound,
  P2P_SIGNAL_WIRE_SCHEMA_VERSION,
} from '../p2pSignalRelayPost'

const failMock = vi.fn()
const getSessionStateMock = vi.fn(() => ({
  sessionId: 'sid-1',
  phase: 'signaling',
  boundLocalDeviceId: 'dev-a',
  boundPeerDeviceId: 'dev-b',
}))

vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  getSessionState: (...a: unknown[]) => getSessionStateMock(...a),
  failHostAiP2pSessionForTerminalSignalingError: (...a: unknown[]) => failMock(...a),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(() => ({ p2p_endpoint: 'https://relay.example/beap/capsule' })),
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    coordination_url: 'https://coord.example',
    use_coordination: true,
  }),
}))

vi.mock('../policy', () => ({
  p2pEndpointKind: () => 'relay',
}))

describe('p2pSignalRelayPost', () => {
  const db = {}

  beforeEach(() => {
    failMock.mockClear()
    resetP2pInferenceFlagsForTests()
    resetP2pSignalRelayOutboundStateForTests()
    p2pSignalRelayPostTestHooks.max429Retries = null
    getSessionStateMock.mockReset()
    getSessionStateMock.mockImplementation(() => ({
      sessionId: 'sid-1',
      phase: 'signaling',
      boundLocalDeviceId: 'dev-a',
      boundPeerDeviceId: 'dev-b',
    }))
    vi.spyOn(authSession, 'getAccessToken').mockReturnValue('test-access-token')
    p2pSignalRelayPostTestHooks.post = async (_base, bearer, body) => {
      expect(bearer).toBe('test-access-token')
      void body
      return { status: 200, bodyText: '' }
    }
  })

  afterEach(() => {
    p2pSignalRelayPostTestHooks.post = null
    p2pSignalRelayPostTestHooks.max429Retries = null
    resetP2pSignalRelayOutboundStateForTests()
    resetP2pInferenceFlagsForTests()
  })

  it('POST offer: body matches coordination schema v1 and bearer is sent', async () => {
    let captured = ''
    p2pSignalRelayPostTestHooks.post = async (_base, _bearer, body) => {
      captured = body
      return { status: 200, bodyText: '' }
    }
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'offer',
      sdp: 'v=0\r\n',
    })
    const p = JSON.parse(captured)
    expect(p.schema_version).toBe(P2P_SIGNAL_WIRE_SCHEMA_VERSION)
    expect(p.signal_type).toBe('p2p_inference_offer')
    expect(p.handshake_id).toBe('hs1')
    expect(p.session_id).toBe('sid-1')
    expect(p.sender_device_id).toBe('dev-a')
    expect(p.receiver_device_id).toBe('dev-b')
    expect(p.sdp).toBe('v=0\r\n')
    expect(p.correlation_id).toMatch(/[0-9a-f-]{36}/i)
    expect(failMock).not.toHaveBeenCalled()
  })

  it('200 → accepted; no session fail', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 200, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'answer',
      sdp: 'answer',
    })
    expect(failMock).not.toHaveBeenCalled()
  })

  it('202 → recipient offline; no session fail', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 202, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'ice',
      iceCandidateJson: JSON.stringify({ candidate: 'x', sdpMLineIndex: 0 }),
    })
    expect(failMock).not.toHaveBeenCalled()
  })

  it('401 → P2P_SIGNAL_AUTH_OR_ROUTE_FAILED', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 401, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'offer',
      sdp: 'o',
    })
    expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.P2P_SIGNAL_AUTH_OR_ROUTE_FAILED)
  })

  it('404 → RELAY_MISSING_P2P_SIGNAL_ROUTE', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 404, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'offer',
      sdp: 'o',
    })
    expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.RELAY_MISSING_P2P_SIGNAL_ROUTE)
  })

  it('405 → RELAY_MISSING_P2P_SIGNAL_ROUTE', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 405, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'offer',
      sdp: 'o',
    })
    expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.RELAY_MISSING_P2P_SIGNAL_ROUTE)
  })

  it('ICE 503 → non-fatal until threshold; 10th failure escalates', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 503, bodyText: '{}' })
    const ice = {
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'ice' as const,
      iceCandidateJson: JSON.stringify({ candidate: 'c', sdpMLineIndex: 0 }),
    }
    for (let i = 0; i < 9; i++) {
      await sendHostAiP2pSignalOutbound(ice)
      expect(failMock).not.toHaveBeenCalled()
    }
    await sendHostAiP2pSignalOutbound(ice)
    expect(failMock).toHaveBeenCalledTimes(1)
    expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.OFFER_SIGNAL_SEND_FAILED)
  })

  it('ICE 401 → session-fatal (auth)', async () => {
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 401, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'ice',
      iceCandidateJson: JSON.stringify({ candidate: 'c', sdpMLineIndex: 0 }),
    })
    expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.P2P_SIGNAL_AUTH_OR_ROUTE_FAILED)
  })

  it('ICE: drops stale session id vs ledger with [P2P_SIGNAL_OUT] dropped_stale_send', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ledger = {
      sessionId: 'sid-new',
      phase: 'signaling',
      boundLocalDeviceId: 'dev-a',
      boundPeerDeviceId: 'dev-b',
    }
    getSessionStateMock.mockReset()
    getSessionStateMock.mockImplementation(() => ledger)
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 200, bodyText: '{}' })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-old',
      kind: 'ice',
      iceCandidateJson: JSON.stringify({ candidate: 'c', sdpMLineIndex: 0 }),
    })
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[P2P_SIGNAL_OUT] dropped_stale_send session=sid-old current_session=sid-new handshake=hs1 kind=ice',
      ),
    )
    logSpy.mockRestore()
  })

  it('ICE 400 schema rejected → [P2P_SIGNAL_SCHEMA_DEBUG] only when WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_VERBOSE_LOGS', '1')
    resetP2pInferenceFlagsForTests()
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      const relayErr = JSON.stringify({ error: 'invalid_candidate', field: 'candidate' })
      p2pSignalRelayPostTestHooks.post = async () => ({ status: 400, bodyText: relayErr })
      const cand = JSON.stringify({
        candidate: 'candidate:1 1 udp 2130706431 127.0.0.1 9 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'uf',
      })
      await sendHostAiP2pSignalOutbound({
        db,
        handshakeId: 'hs1',
        p2pSessionId: 'sid-1',
        kind: 'ice',
        iceCandidateJson: cand,
      })
      expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.P2P_SIGNAL_SCHEMA_REJECTED)
      expect(debugSpy).toHaveBeenCalledTimes(1)
      const msg = String(debugSpy.mock.calls[0][0])
      expect(msg.startsWith('[P2P_SIGNAL_SCHEMA_DEBUG]')).toBe(true)
      expect(msg).toContain('payload_sent=')
      expect(msg).toContain('response_body=')
      expect(msg).toContain('candidate_object=')
      expect(msg).toContain('invalid_candidate')
      expect(msg).toContain('\\"field\\":\\"candidate\\"')
    } finally {
      debugSpy.mockRestore()
      vi.unstubAllEnvs()
      resetP2pInferenceFlagsForTests()
    }
  })

  it('ICE 400 schema rejected → no [P2P_SIGNAL_SCHEMA_DEBUG] when verbose logs off', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const relayErr = JSON.stringify({ error: 'invalid_candidate', field: 'candidate' })
    p2pSignalRelayPostTestHooks.post = async () => ({ status: 400, bodyText: relayErr })
    const cand = JSON.stringify({
      candidate: 'candidate:1 1 udp 2130706431 127.0.0.1 9 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'uf',
    })
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'ice',
      iceCandidateJson: cand,
    })
    expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.P2P_SIGNAL_SCHEMA_REJECTED)
    expect(debugSpy).not.toHaveBeenCalled()
    debugSpy.mockRestore()
  })

  it('ICE 400 schema rejected → [P2P_SIGNAL_SCHEMA_DEBUG] via console.debug when WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_VERBOSE_LOGS', '1')
    resetP2pInferenceFlagsForTests()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      const relayErr = JSON.stringify({ error: 'invalid_candidate', field: 'candidate' })
      p2pSignalRelayPostTestHooks.post = async () => ({ status: 400, bodyText: relayErr })
      const cand = JSON.stringify({
        candidate: 'candidate:1 1 udp 2130706431 127.0.0.1 9 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'uf',
      })
      await sendHostAiP2pSignalOutbound({
        db,
        handshakeId: 'hs1',
        p2pSessionId: 'sid-1',
        kind: 'ice',
        iceCandidateJson: cand,
      })
      expect(failMock).toHaveBeenCalledWith('hs1', InternalInferenceErrorCode.P2P_SIGNAL_SCHEMA_REJECTED)
      expect(debugSpy).toHaveBeenCalled()
      const msg = String(debugSpy.mock.calls.find((c) => String(c[0]).startsWith('[P2P_SIGNAL_SCHEMA_DEBUG]'))?.[0])
      expect(msg.startsWith('[P2P_SIGNAL_SCHEMA_DEBUG]')).toBe(true)
      expect(msg).toContain('payload_sent=')
      expect(msg).toContain('response_body=')
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('[P2P_SIGNAL_SCHEMA_DEBUG]'))).toBe(false)
    } finally {
      logSpy.mockRestore()
      debugSpy.mockRestore()
      vi.unstubAllEnvs()
      resetP2pInferenceFlagsForTests()
    }
  })

  it('offer: 429 then 200 retries same message; no session fail', async () => {
    let n = 0
    p2pSignalRelayPostTestHooks.post = async (_base, _bearer, body) => {
      n += 1
      if (n < 3) return { status: 429, bodyText: 'rate limit' }
      expect(body).toContain('p2p_inference_offer')
      return { status: 200, bodyText: '{}' }
    }
    p2pSignalRelayPostTestHooks.max429Retries = 8
    await sendHostAiP2pSignalOutbound({
      db,
      handshakeId: 'hs1',
      p2pSessionId: 'sid-1',
      kind: 'offer',
      sdp: 'v=0',
    })
    expect(failMock).not.toHaveBeenCalled()
    expect(n).toBe(3)
  })
})
