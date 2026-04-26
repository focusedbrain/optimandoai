/**
 * Handshake + coordination id (canonical) vs orchestrator file for Host AI P2P.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import {
  deriveInternalHostAiPeerRoles,
} from '../policy'
import { ensureSession, P2pSessionPhase, _resetP2pInferenceSessionsForTests } from '../p2pSession/p2pInferenceSessionManager'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { _resetHostInferencePolicyForTests } from '../hostInferencePolicyStore'

const { getInstanceIdMock, getOrchModeMock } = vi.hoisted(() => ({
  getInstanceIdMock: vi.fn(() => 'dev-sand-1'),
  getOrchModeMock: vi.fn(() => ({
    mode: 'host' as const,
    deviceName: 'T',
    instanceId: 'dev-sand-1',
    pairingCode: '000000',
    connectedPeers: [] as const,
  })),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => Promise.resolve({}),
}))

const getHSMock = vi.fn()
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, hid: string) => getHSMock(_db, hid),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceIdMock(),
  getOrchestratorMode: () => getOrchModeMock(),
}))

function base(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
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
    p2p_endpoint: 'http://10.0.0.1:1/beap/ingest',
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

describe('deriveInternalHostAiPeerRoles', () => {
  it('maps initiator coordination id to initiator device roles', () => {
    const r = base()
    const d = deriveInternalHostAiPeerRoles(r, 'dev-sand-1')
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.localRole).toBe('sandbox')
      expect(d.peerRole).toBe('host')
      expect(d.roleSource).toBe('handshake')
    }
  })

  it('maps acceptor coordination id to acceptor device roles', () => {
    const d = deriveInternalHostAiPeerRoles(base(), 'dev-host-1')
    expect(d.ok).toBe(true)
    if (d.ok) {
      expect(d.localRole).toBe('host')
      expect(d.peerRole).toBe('sandbox')
    }
  })

  it('rejects unknown instance id', () => {
    const d = deriveInternalHostAiPeerRoles(base(), 'unknown')
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.reason).toBe('device_id_not_in_handshake')
    }
  })
})

describe('ensureSession — instance id (not orchestrator mode)', () => {
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
      maxRequestsPerHandshakePerMinute: 10_000,
      capabilitiesExposeAllInstalledOllama: false,
    })
    getHSMock.mockImplementation(() => base())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    _resetP2pInferenceSessionsForTests()
  })

  it('configured orchestrator host + instance sandbox id: model_selector gets session (no INVALID_INTERNAL_ROLE)', async () => {
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    getOrchModeMock.mockReturnValue({
      mode: 'host',
      deviceName: 'T',
      instanceId: 'dev-sand-1',
      pairingCode: '000000',
      connectedPeers: [],
    })
    const st = await ensureSession('hs-1', 'model_selector')
    expect(st.phase).toBe(P2pSessionPhase.signaling)
    expect(st.lastErrorCode).toBeNull()
    expect(st.sessionId).toBeTruthy()
  })

  it('configured orchestrator sandbox + same: model_selector gets session', async () => {
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    getOrchModeMock.mockReturnValue({
      mode: 'sandbox',
      deviceName: 'T',
      instanceId: 'dev-sand-1',
      pairingCode: '000000',
      connectedPeers: [],
    })
    const st = await ensureSession('hs-1', 'model_selector')
    expect(st.sessionId).toBeTruthy()
  })

  it('host instance + model_selector rejects (not S→H client)', async () => {
    getInstanceIdMock.mockReturnValue('dev-host-1')
    const st = await ensureSession('hs-1', 'model_selector')
    expect(st.phase).toBe(P2pSessionPhase.failed)
    expect(st.lastErrorCode).toBe(InternalInferenceErrorCode.INVALID_INTERNAL_ROLE)
  })

  it('internal row samePrincipal false: assertRecord fails before role (use standard mock)', async () => {
    getHSMock.mockImplementation(() =>
      base({
        initiator: { email: 'a@a', wrdesk_user_id: 'a', iss: 'i', sub: 's' },
        acceptor: { email: 'a@a', wrdesk_user_id: 'b', iss: 'i', sub: 's' },
      }),
    )
    const st = await ensureSession('hs-1', 'model_selector')
    expect(st.lastErrorCode).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })

  it('identity incomplete: POLICY_FORBIDDEN from assertRecord', async () => {
    getHSMock.mockImplementation(() => base({ internal_coordination_identity_complete: false as any }))
    const st = await ensureSession('hs-1', 'model_selector')
    expect(st.lastErrorCode).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })
})
