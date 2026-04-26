/**
 * Phase 11 — P2P inference session: signaling binding, preflight, DataChannel handoff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { _resetHostInferencePolicyForTests } from '../hostInferencePolicyStore'
import { InternalInferenceErrorCode } from '../errors'

const { getHSMock, getDbMock } = vi.hoisted(() => ({
  getHSMock: vi.fn(),
  getDbMock: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getDbMock(),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (...args: unknown[]) => getHSMock(...args),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => true,
  isSandboxMode: () => false,
  getInstanceId: () => 'dev-host-11',
  getOrchestratorMode: () => ({
    mode: 'host',
    deviceName: 'T',
    instanceId: 'dev-host-11',
    pairingCode: '000000',
    connectedPeers: [],
  }),
}))

import {
  P2pSessionPhase,
  P2pSessionLogReason,
  P2pSessionUiPhase,
  preflightP2pRelaySignal,
  ensureSession,
  handleSignal,
  getSessionState,
  markDataChannelOpenForP2pSession,
  closeSession,
  _resetP2pInferenceSessionsForTests,
} from '../p2pSession/p2pInferenceSessionManager'

function baseHostRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-p2p-11',
    relationship_id: 'r1',
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
    initiator: { email: 'a@a', wrdesk_user_id: 'u@x|s', iss: 'i', sub: 's' },
    acceptor: { email: 'a@a', wrdesk_user_id: 'u@x|s', iss: 'i', sub: 's' },
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: 'v',
    acceptor_wrdesk_policy_hash: 'h',
    acceptor_wrdesk_policy_version: 'v',
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: 'http://10.0.0.2:1/beap/ingest',
    counterparty_p2p_token: 't',
    handshake_type: 'internal',
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    initiator_device_name: 'H',
    acceptor_device_name: 'S',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'dev-host-11',
    acceptor_coordination_device_id: 'dev-sand-11',
    ...over,
  } as HandshakeRecord
}

describe('Phase 11 — P2P session manager', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
    _resetHostInferencePolicyForTests({
      allowSandboxInference: true,
      modelAllowlist: [],
      maxPromptBytes: 256_000,
      maxOutputBytes: 256_000,
      timeoutMs: 60_000,
      maxConcurrent: 1,
      maxRequestsPerHandshakePerMinute: 30,
      capabilitiesExposeAllInstalledOllama: false,
    })
    getDbMock.mockReturnValue({})
    getHSMock.mockImplementation((_db: unknown, hid: string) => (hid === 'hs-p2p-11' ? baseHostRecord() : null))
  })

  afterEach(() => {
    _resetP2pInferenceSessionsForTests()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('ensureSession → signaling + sessionId; offer/ICE preflight + handleSignal advances toward connecting', async () => {
    const st = await ensureSession('hs-p2p-11', 'test')
    expect(st.phase).toBe(P2pSessionPhase.signaling)
    expect(st.sessionId).toBeTruthy()
    const sid = st.sessionId as string
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 15_000)
    const rawOffer = {
      signal_type: 'p2p_inference_offer',
      handshake_id: 'hs-p2p-11',
      session_id: sid,
      sender_device_id: 'dev-sand-11',
      receiver_device_id: 'dev-host-11',
      correlation_id: 'c1',
      created_at: t0.toISOString(),
      expires_at: t1.toISOString(),
      sdp: 'v=0',
    }
    const ok = await preflightP2pRelaySignal(rawOffer)
    expect(ok).toBe(true)
    handleSignal(rawOffer)
    const mid = getSessionState('hs-p2p-11')
    expect(mid?.phase).toBe(P2pSessionPhase.connecting)
  })

  it('unknown session_id rejected by preflight', async () => {
    const st = await ensureSession('hs-p2p-11', 'test')
    const sid = st.sessionId as string
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 15_000)
    const bad = await preflightP2pRelaySignal({
      signal_type: 'p2p_inference_answer',
      handshake_id: 'hs-p2p-11',
      session_id: '00000000-0000-0000-0000-000000000000',
      sender_device_id: 'dev-sand-11',
      receiver_device_id: 'dev-host-11',
      correlation_id: 'c2',
      created_at: t0.toISOString(),
      expires_at: t1.toISOString(),
      sdp: 'a=1',
    })
    expect(bad).toBe(false)
    void sid
  })

  it('markDataChannelOpenForP2pSession sets datachannel_open', async () => {
    const st = await ensureSession('hs-p2p-11', 'test')
    const sid = st.sessionId as string
    markDataChannelOpenForP2pSession('hs-p2p-11', sid)
    const s2 = getSessionState('hs-p2p-11')
    expect(s2?.phase).toBe(P2pSessionPhase.datachannel_open)
    expect(s2?.p2pUiPhase).toBe(P2pSessionUiPhase.ready)
  })

  it('closeSession yields closed / ledger UI phase', async () => {
    await ensureSession('hs-p2p-11', 'test')
    closeSession('hs-p2p-11', P2pSessionLogReason.user)
    expect(getSessionState('hs-p2p-11')).toBeNull()
  })

  it('preflight fails when ledger row revoked', async () => {
    getHSMock.mockImplementation(() =>
      baseHostRecord({ state: HandshakeState.REVOKED, revoked_at: '2020-01-02' }),
    )
    const st = await ensureSession('hs-p2p-11', 'test')
    expect(st.lastErrorCode).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })
})
