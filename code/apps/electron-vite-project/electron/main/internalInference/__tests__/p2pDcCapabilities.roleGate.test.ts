/**
 * Ledger-authoritative role for DC capability RPC: must not use orchestrator configured_mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord, type PartyIdentity } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { clearPendingP2pCapabilitiesForTests, requestHostInferenceCapabilitiesOverDataChannel } from '../p2pDc/p2pDcCapabilities'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/p2p-caps-role', getAppPath: () => '/tmp' },
}))

const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'dev-sand-1'))
vi.mock('../../orchestrator/orchestratorModeStore', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../orchestrator/orchestratorModeStore')>()
  return { ...a, getInstanceId: () => getInstanceIdMock() }
})

const getHandshakeRecordMock = vi.hoisted(() => vi.fn())
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (...a: unknown[]) => getHandshakeRecordMock(...a),
}))

const getHandshakeDbMock = vi.hoisted(() => vi.fn().mockResolvedValue({ _h: true }))
vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

vi.mock('../webrtc/webrtcTransportIpc', () => ({
  webrtcSendData: vi.fn().mockResolvedValue(undefined),
}))

function party(): PartyIdentity {
  return { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' }
}

function recordSandboxInitiator(): HandshakeRecord {
  return {
    handshake_id: 'hs1',
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
    p2p_endpoint: 'https://relay.example/beap/x',
  } as HandshakeRecord
}

describe('requestHostInferenceCapabilitiesOverDataChannel (ledger role)', () => {
  afterEach(() => {
    clearPendingP2pCapabilitiesForTests()
    vi.clearAllMocks()
  })

  it('sends DC request when ledger says this device is sandbox (no isSandboxMode gate)', async () => {
    getHandshakeRecordMock.mockReturnValue(recordSandboxInitiator())
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    void requestHostInferenceCapabilitiesOverDataChannel('hs1', 'sid-1', 100, { requestId: 'r-fixed' })
    await new Promise((r) => setTimeout(r, 0))
    const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
    expect(webrtcSendData).toHaveBeenCalled()
    const arg = (webrtcSendData as ReturnType<typeof vi.fn>).mock.calls[0][2] as ArrayBuffer
    const txt = new TextDecoder().decode(new Uint8Array(arg))
    expect(txt).toContain('inference_capabilities_request')
    expect(txt).toContain('dev-sand-1')
    clearPendingP2pCapabilitiesForTests()
  })

  it('rejects with HOST_AI_CAPABILITY_ROLE_REJECTED when ledger says local is host (same orchestrator quirk as before)', async () => {
    getHandshakeRecordMock.mockReturnValue(recordSandboxInitiator())
    getInstanceIdMock.mockReturnValue('dev-host-1')
    const r = await requestHostInferenceCapabilitiesOverDataChannel('hs1', 'sid-1', 50, { requestId: 'r2' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED)
      expect(r.reason).toBe('not_sandbox_requester')
    }
  })
})
