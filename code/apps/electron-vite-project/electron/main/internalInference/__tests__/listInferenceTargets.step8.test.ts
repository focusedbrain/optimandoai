/**
 * STEP 8 / STEP 9 — Sandbox Host AI target discovery + capabilities + regression.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { assertP2pEndpointDirect, p2pEndpointKind } from '../policy'
import { listSandboxHostInternalInferenceTargets } from '../listInferenceTargets'

const { isHostModeMock, isSandboxModeMock, getOrchestratorModeMock } = vi.hoisted(() => {
  const isHost = vi.fn(() => false)
  const isSandbox = vi.fn(() => false)
  const minimal = (mode: 'host' | 'sandbox') => ({
    mode,
    deviceName: 'dev',
    instanceId: 'inst',
    pairingCode: '123456',
    connectedPeers: [] as const,
  })
  const getOrch = vi.fn(() => {
    if (isHost()) return minimal('host')
    if (isSandbox()) return minimal('sandbox')
    return minimal('host')
  })
  return { isHostModeMock: isHost, isSandboxModeMock: isSandbox, getOrchestratorModeMock: getOrch, _minimalOrch: minimal }
})

const minimalOrch = (mode: 'host' | 'sandbox') => ({
  mode,
  deviceName: 'dev',
  instanceId: 'inst',
  pairingCode: '123456',
  connectedPeers: [] as const,
})

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => isHostModeMock(),
  isSandboxMode: () => isSandboxModeMock(),
  getOrchestratorMode: () => getOrchestratorModeMock(),
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
  getOrchestratorModeMock.mockImplementation(() => {
    if (isHostModeMock()) return minimalOrch('host')
    if (isSandboxModeMock()) return minimalOrch('sandbox')
    return minimalOrch('host')
  })
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
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    expect(listHandshakeRecordsMock).not.toHaveBeenCalled()
  })

  it('Sandbox + no internal handshake rows returns empty targets', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.ok).toBe(true)
    expect(r.targets).toHaveLength(0)
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
  })

  it('external (non-internal) handshake row is ignored', async () => {
    isSandboxModeMock.mockReturnValue(true)
    const ext = activeInternalSandboxToHost({
      handshake_type: 'standard' as any,
    })
    listHandshakeRecordsMock.mockReturnValue([ext])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
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
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
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
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(true)
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
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(true)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.availability).toBe('model_unavailable')
    expect(t.inference_error_code).toBe(InternalInferenceErrorCode.MODEL_UNAVAILABLE)
    expect(t.model).toBeNull()
    expect(t.id).toContain(':unavailable')
    expect(t.secondary_label).toBe('Host has no active local model.')
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
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(true)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.availability).toBe('direct_unreachable')
    expect(t.direct_reachable).toBe(false)
    expect(t.id).toContain(':unavailable')
    expect(t.secondary_label).toBe('Host is paired but direct P2P is not reachable.')
  })

  it('probe throws: returns disabled target with capabilities message (not empty)', async () => {
    probeHostInferencePolicyFromSandboxMock.mockRejectedValue(new Error('network'))
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.id).toContain(':unavailable')
    expect(t.unavailable_reason).toBe('CAPABILITY_PROBE_FAILED')
    expect(t.secondary_label).toMatch(/Host capabilities could not be fetched/i)
  })
})

describe('STEP 9 — regression (listInferenceTargets)', () => {
  it('getHandshakeDb unavailable logs DB_UNAVAILABLE and returns no targets (no silent failure)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    isSandboxModeMock.mockReturnValue(true)
    getHandshakeDbMock.mockResolvedValue(null)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    expect(listHandshakeRecordsMock).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toMatch(/DB_UNAVAILABLE|rejected reason=DB_UNAVAILABLE|db_available=false/)
    log.mockRestore()
  })

  it('orchestrator mode host (persisted) yields empty list before DB — main mode wins over isSandbox flag', async () => {
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getOrchestratorModeMock.mockImplementation(() => minimalOrch('host'))
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
    expect(listHandshakeRecordsMock).not.toHaveBeenCalled()
  })

  it('p2p relay URL is not direct — policy rejects relay; list shows disabled target (no capabilities probe)', async () => {
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    expect(p2pEndpointKind({}, relay)).toBe('relay')
    const d = assertP2pEndpointDirect({}, relay)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.code).toBe(InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ p2p_endpoint: relay }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.availability).toBe('direct_unreachable')
    expect(t.secondary_label).toMatch(/direct \(non-relay\)|direct P2P/i)
  })

  it('identity-incomplete internal row produces disabled explanatory target (not dropped)', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ internal_coordination_identity_complete: false as any }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.availability).toBe('identity_incomplete')
    expect(t.secondary_label).toBe('Internal handshake identity is incomplete.')
  })

  it('HOST_NO_ACTIVE_LOCAL_LLM from probe is surfaced on the disabled row', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: undefined,
      modelId: undefined,
      directP2pAvailable: true,
      displayLabelFromHost: 'Host AI · —',
      hostComputerNameFromHost: 'H',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '1-2-3',
      internalIdentifier6FromHost: '123456',
      inferenceErrorCode: InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.inference_error_code).toBe(InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM)
    expect(t.unavailable_reason).toBe(InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM)
  })

  it('active Host model name updates when probe returns a different defaultChatModel', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    probeHostInferencePolicyFromSandboxMock
      .mockResolvedValueOnce({
        ok: true as const,
        allowSandboxInference: true,
        defaultChatModel: 'm-a',
        modelId: 'm-a',
        displayLabelFromHost: 'Host AI · m-a',
        hostComputerNameFromHost: 'H',
        hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
        internalIdentifierDisplayFromHost: '1-2-3',
        internalIdentifier6FromHost: '123456',
        directP2pAvailable: true,
      })
    const r1 = await listSandboxHostInternalInferenceTargets()
    expect(r1.targets[0]?.model).toBe('m-a')
    probeHostInferencePolicyFromSandboxMock
      .mockResolvedValueOnce({
        ok: true as const,
        allowSandboxInference: true,
        defaultChatModel: 'm-b',
        modelId: 'm-b',
        displayLabelFromHost: 'Host AI · m-b',
        hostComputerNameFromHost: 'H',
        hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
        internalIdentifierDisplayFromHost: '1-2-3',
        internalIdentifier6FromHost: '123456',
        directP2pAvailable: true,
      })
    const r2 = await listSandboxHostInternalInferenceTargets()
    expect(r2.targets[0]?.model).toBe('m-b')
  })

  it('assertSandboxRequestToHost fails (local_role vs device roles) but host+sandbox pairing still gets a checking Host row, not an empty list', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ local_role: 'acceptor' as const })])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.id).toContain(':checking')
    expect(t.display_label).toMatch(/checking Host/i)
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
  })

  it('assertSandboxRequestToHost fails and device roles are not host+sandbox: disabled explanatory target (not empty)', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ initiator_device_role: 'host' as any, acceptor_device_role: 'host' as any }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.id).toContain(':unavailable')
    expect(t.unavailable_reason).toBe('SANDBOX_HOST_ROLE_METADATA')
    expect(t.available).toBe(false)
    expect(t.host_selector_state).toBe('unavailable')
  })
})
