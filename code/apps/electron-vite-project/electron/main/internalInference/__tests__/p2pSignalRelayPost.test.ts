import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as authSession from '../../../../src/auth/session'
import { InternalInferenceErrorCode } from '../errors'
import {
  p2pSignalRelayPostTestHooks,
  sendHostAiP2pSignalOutbound,
  P2P_SIGNAL_WIRE_SCHEMA_VERSION,
} from '../p2pSignalRelayPost'

const failMock = vi.fn()
const getSessionStateMock = vi.fn(() => ({
  sessionId: 'sid-1',
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
    vi.spyOn(authSession, 'getAccessToken').mockReturnValue('test-access-token')
    p2pSignalRelayPostTestHooks.post = async (_base, bearer, body) => {
      expect(bearer).toBe('test-access-token')
      void body
      return { status: 200, bodyText: '' }
    }
  })

  afterEach(() => {
    p2pSignalRelayPostTestHooks.post = null
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
})
