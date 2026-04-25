/**
 * STEP 8 — Sandbox Host AI target discovery + capabilities outcomes (listInferenceTargets).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { listSandboxHostInternalInferenceTargets } from '../listInferenceTargets'

const { isHostModeMock, isSandboxModeMock } = vi.hoisted(() => ({
  isHostModeMock: vi.fn(() => false),
  isSandboxModeMock: vi.fn(() => false),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => isHostModeMock(),
  isSandboxMode: () => isSandboxModeMock(),
}))

const listHandshakeRecordsMock = vi.fn<
  (db: unknown, filter: { state?: string; handshake_type?: string }) => HandshakeRecord[]
>()
vi.mock('../../handshake/db', () => ({
  listHandshakeRecords: (db: unknown, filter: { state?: string; handshake_type?: string }) =>
    listHandshakeRecordsMock(db, filter),
}))

const getHandshakeDbMock = vi.fn<() => Promise<object | null>>()
vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

const probeHostInferencePolicyFromSandboxMock = vi.fn()
vi.mock('../sandboxHostUi', () => ({
  probeHostInferencePolicyFromSandbox: (hid: string) => probeHostInferencePolicyFromSandboxMock(hid),
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    coordination_url: 'https://coord.test.invalid',
  }),
}))

function party(uid: string): PartyIdentity {
  return {
    email: `${uid}@test.dev`,
    wrdesk_user_id: uid,
    iss: 'https://idp',
    sub: `sub-${uid}`,
  }
}

/** Sandbox (initiator) ↔ Host (acceptor), same principal — matches assertSandboxRequestToHost. */
function activeInternalSandboxToHost(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-internal-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    initiator: party('same-user'),
    acceptor: party('same-user'),
    local_role: 'initiator',
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    acceptor_device_name: 'Konge-AS1',
    initiator_device_name: 'Laptop',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
    internal_peer_pairing_code: '123456',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'http://192.168.1.10:51249/beap/ingest',
    counterparty_p2p_token: 'tok',
    handshake_type: 'internal',
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
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    ...over,
  } as HandshakeRecord
}

beforeEach(() => {
  isHostModeMock.mockReturnValue(false)
  isSandboxModeMock.mockReturnValue(false)
  getHandshakeDbMock.mockResolvedValue({})
  listHandshakeRecordsMock.mockReturnValue([])
  probeHostInferencePolicyFromSandboxMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('STEP 8 — listInferenceTargets / target discovery', () => {
  it('Host mode returns no Host AI targets', async () => {
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.ok).toBe(true)
    expect(r.targets).toEqual([])
    expect(listHandshakeRecordsMock).not.toHaveBeenCalled()
  })

  it('Sandbox + no internal handshake rows returns empty targets', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.ok).toBe(true)
    expect(r.targets).toHaveLength(0)
  })

  it('external (non-internal) handshake row is ignored', async () => {
    isSandboxModeMock.mockReturnValue(true)
    const ext = activeInternalSandboxToHost({
      handshake_type: 'standard' as any,
    })
    listHandshakeRecordsMock.mockReturnValue([ext])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
  })

  it('cross-email internal row (different principals) is ignored', async () => {
    isSandboxModeMock.mockReturnValue(true)
    const bad = activeInternalSandboxToHost({
      initiator: party('u-a'),
      acceptor: party('u-b'),
    })
    listHandshakeRecordsMock.mockReturnValue([bad])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
  })

  it('Sandbox + ACTIVE internal Host handshake returns an available Host AI target when probe has model', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'gemma3:12b',
      modelId: 'gemma3:12b',
      displayLabelFromHost: 'Host AI · gemma3:12b',
      hostComputerNameFromHost: 'Konge-AS1',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '123-456',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: true,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.kind).toBe('host_internal')
    expect(t.available).toBe(true)
    expect(t.model).toBe('gemma3:12b')
    expect(t.host_computer_name).toBe('Konge-AS1')
    expect(t.secondary_label).toMatch(/Konge-AS1/)
    expect(t.secondary_label).toMatch(/Host orchestrator/)
    expect(t.secondary_label).toMatch(/123-456/)
    expect(t.label).toMatch(/gemma3:12b|Host AI/)
  })
})

describe('STEP 8 — capabilities-driven availability', () => {
  beforeEach(() => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
  })

  it('Host with no default model returns model_unavailable + MODEL_UNAVAILABLE', async () => {
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: undefined,
      modelId: undefined,
      displayLabelFromHost: 'Host AI · —',
      hostComputerNameFromHost: 'Konge-AS1',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '123-456',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: true,
      inferenceErrorCode: InternalInferenceErrorCode.MODEL_UNAVAILABLE,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.availability).toBe('model_unavailable')
    expect(t.inference_error_code).toBe(InternalInferenceErrorCode.MODEL_UNAVAILABLE)
  })

  it('Direct P2P unavailable from probe maps to direct_unreachable (HOST_DIRECT_P2P_UNAVAILABLE)', async () => {
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      message: 'unreachable',
      directP2pAvailable: false,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.availability).toBe('direct_unreachable')
    expect(t.direct_reachable).toBe(false)
  })
})
