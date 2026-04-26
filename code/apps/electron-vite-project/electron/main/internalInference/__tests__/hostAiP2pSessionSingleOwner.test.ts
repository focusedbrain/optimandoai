/**
 * Host AI P2P: one begin per burst; reuse_active / reuse_inflight for concurrent list-style calls.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { getInstanceIdMock, getHSMock, getOrchModeMock } = vi.hoisted(() => {
  const getInst = vi.fn(() => 'dev-sand-1')
  const getHS = vi.fn()
  const getOrch = vi.fn(() => ({
    mode: 'sandbox' as const,
    deviceName: 'd',
    instanceId: 'dev-sand-1',
    pairingCode: '000000',
    connectedPeers: [] as const,
  }))
  return { getInstanceIdMock: getInst, getHSMock: getHS, getOrchModeMock: getOrch }
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

import {
  _resetP2pInferenceSessionsForTests,
  ensureHostAiP2pSession,
} from '../p2pSession/p2pInferenceSessionManager'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

function baseHS() {
  return {
    handshake_id: 'hs-so-1',
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

describe('ensureHostAiP2pSession single-owner', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
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
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
  })

  it('20 parallel ensures: one begin, rest reuse_inflight', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ps = Array.from({ length: 20 }, () => ensureHostAiP2pSession('hs-so-1', 'model_selector'))
    await Promise.all(ps)
    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    const begins = (joined.match(/\[HOST_AI_SESSION_ENSURE\] begin /g) ?? []).length
    const inflight = (joined.match(/\[HOST_AI_SESSION_ENSURE\] reuse_inflight /g) ?? []).length
    expect(begins).toBe(1)
    expect(inflight).toBe(19)
    log.mockRestore()
  })

})
