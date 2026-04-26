/**
 * STEP 8 / STEP 9 — Sandbox Host AI target discovery + capabilities + regression.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { assertP2pEndpointDirect, p2pEndpointKind } from '../policy'
import {
  listSandboxHostInternalInferenceTargets,
  resetP2pEnsureThrottleCacheForTests,
  resetWebrtcListHostCapsCacheForTests,
} from '../listInferenceTargets'
import {
  resetHostAiRelayCapabilityCacheForTests,
  setHostAiRelayCapabilityFetchForTests,
} from '../hostAiRelayCapability'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

const { isHostModeMock, isSandboxModeMock, getOrchestratorModeMock, getInstanceIdMock } = vi.hoisted(() => {
  const isHost = vi.fn(() => false)
  const isSandbox = vi.fn(() => false)
  const getInst = vi.fn(() => 'dev-sand-1')
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
  return {
    isHostModeMock: isHost,
    isSandboxModeMock: isSandbox,
    getOrchestratorModeMock: getOrch,
    getInstanceIdMock: getInst,
    _minimalOrch: minimal,
  }
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
  getInstanceId: () => getInstanceIdMock(),
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
const listHostCapabilitiesListMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    wire: {
      type: 'internal_inference_capabilities_result' as const,
      schema_version: 1,
      request_id: 'req-1',
      handshake_id: 'hs-internal-1',
      sender_device_id: 'dev-sand-1',
      target_device_id: 'dev-host-1',
      created_at: new Date().toISOString(),
      host_computer_name: 'Konge-AS1',
      host_pairing_code: '123456',
      models: [{ provider: 'ollama' as const, model: 'gemma3:12b', label: 'g', enabled: true }],
      policy_enabled: true,
      active_local_llm: { provider: 'ollama' as const, model: 'gemma3:12b', label: 'g', enabled: true },
      active_chat_model: 'gemma3:12b',
    },
  }),
)
vi.mock('../sandboxHostUi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../sandboxHostUi')>()
  return {
    ...mod,
    probeHostInferencePolicyFromSandbox: (hid: string, o?: { correlationChain?: string }) =>
      probeHostInferencePolicyFromSandboxMock(hid, o),
  }
})
vi.mock('../transport/internalInferenceTransport', () => ({
  listHostCapabilities: (hid: string, opts: unknown) => listHostCapabilitiesListMock(hid, opts),
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    coordination_url: 'https://coord.test.invalid',
    use_coordination: true,
  }),
}))

const getSessionStateListMock = vi.hoisted(() => vi.fn(() => null as any))

const ensureSessionListMock = vi.hoisted(() =>
  vi.fn().mockImplementation(async (hid: string) => ({
    handshakeId: hid,
    sessionId: 'p2p-sess-1',
    phase: 'ready' as const,
    p2pUiPhase: 'ready' as const,
    lastErrorCode: null,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
    signalingExpiresAt: null,
    boundLocalDeviceId: 'a',
    boundPeerDeviceId: 'b',
  })),
)
const isDcUpListMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  P2P_SIGNALING_WINDOW_MS: 120_000,
  P2pSessionPhase: {
    idle: 'idle',
    signaling: 'signaling',
    connecting: 'connecting',
    datachannel_open: 'datachannel_open',
    ready: 'ready',
    failed: 'failed',
    closed: 'closed',
  },
  P2pSessionUiPhase: {
    ledger: 'ledger',
    connecting: 'connecting',
    ready: 'ready',
    p2p_unavailable: 'p2p_unavailable',
    no_model: 'no_model',
    policy_disabled: 'policy_disabled',
  },
  P2pSessionLogReason: {
    user: 'user',
    unknown: 'unknown',
    p2p_disabled: 'p2p_disabled',
    signaling_disabled: 'signaling_disabled',
    unauthorized: 'unauthorized',
    no_db: 'no_db',
    host_policy: 'host_policy',
    not_found: 'not_found',
    stale_signal: 'stale_signal',
    handshake_revoked: 'handshake_revoked',
    orchestrator_mode_change: 'orchestrator_mode_change',
    account_switch: 'account_switch',
  },
  getSessionState: (...a: unknown[]) => getSessionStateListMock(...a),
  subscribeSessionState: vi.fn(() => () => {}),
  ensureHostAiP2pSession: (hid: string, reason: string) => ensureSessionListMock(hid, reason),
  ensureSessionSingleFlight: (hid: string, reason: string) => ensureSessionListMock(hid, reason),
  preflightP2pRelaySignal: vi.fn(() => Promise.resolve(false)),
  handleSignal: vi.fn(),
  markDataChannelOpenForP2pSession: vi.fn(),
  closeSession: vi.fn(),
  closeAllP2pInferenceSessions: vi.fn(),
  _resetP2pInferenceSessionsForTests: vi.fn(),
}))

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: (hid: string) => isDcUpListMock(hid),
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
  vi.unstubAllEnvs()
  resetHostAiRelayCapabilityCacheForTests()
  setHostAiRelayCapabilityFetchForTests(async (url: RequestInfo | URL) => {
    const s = String(url)
    if (s.includes('/health')) {
      return new Response(
        JSON.stringify({
          status: 'ok',
          host_ai_p2p_signaling: {
            supported: true,
            schema_version: 1,
            ws_path: '/beap/ws',
            signal_path: '/beap/p2p-signal',
          },
        }),
        { status: 200 },
      )
    }
    return new Response('', { status: 404 })
  })
  resetWebrtcListHostCapsCacheForTests()
  resetP2pEnsureThrottleCacheForTests()
  /** Most STEP 8 tests assert legacy-HTTP or pre-WebRTC behavior — force P2P stack off. Default-on tests use a nested describe with unstub. */
  vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '0')
  resetP2pInferenceFlagsForTests()
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
  listHostCapabilitiesListMock.mockReset()
  listHostCapabilitiesListMock.mockResolvedValue({
    ok: true,
    wire: {
      type: 'internal_inference_capabilities_result' as const,
      schema_version: 1,
      request_id: 'req-1',
      handshake_id: 'hs-internal-1',
      sender_device_id: 'dev-sand-1',
      target_device_id: 'dev-host-1',
      created_at: new Date().toISOString(),
      host_computer_name: 'Konge-AS1',
      host_pairing_code: '123456',
      models: [{ provider: 'ollama' as const, model: 'gemma3:12b', label: 'g', enabled: true }],
      policy_enabled: true,
      active_local_llm: { provider: 'ollama' as const, model: 'gemma3:12b', label: 'g', enabled: true },
      active_chat_model: 'gemma3:12b',
    },
  })
  isDcUpListMock.mockReturnValue(true)
  getSessionStateListMock.mockReset()
  getSessionStateListMock.mockReturnValue(null)
  getInstanceIdMock.mockReturnValue('dev-sand-1')
  ensureSessionListMock.mockImplementation(async (hid: string) => ({
    handshakeId: hid,
    sessionId: 'p2p-sess-1',
    phase: 'ready' as const,
    p2pUiPhase: 'ready' as const,
    lastErrorCode: null,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
    signalingExpiresAt: null,
    boundLocalDeviceId: 'a',
    boundPeerDeviceId: 'b',
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  setHostAiRelayCapabilityFetchForTests(null)
  resetHostAiRelayCapabilityCacheForTests()
  resetP2pInferenceFlagsForTests()
  vi.clearAllMocks()
})

describe('STEP 8 — listInferenceTargets / target discovery', () => {
  it('Host mode returns no Host AI targets when ledger has no internal Sandbox↔Host row', async () => {
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    listHandshakeRecordsMock.mockReturnValue([])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.ok).toBe(true)
    expect(r.targets).toEqual([])
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    expect(listHandshakeRecordsMock).toHaveBeenCalled()
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
    expect(t.host_orchestrator_role_label).toBe('Host orchestrator')
    expect(t.secondary_label).toMatch(/Konge-AS1 · ID 123-456/)
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
    expect(t.secondary_label).toMatch(/Konge-AS1 · ID 123-456/)
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
    expect(t.secondary_label).toMatch(/Konge-AS1 · ID 123-456/)
    expect(t.unavailable_reason).toBe('HOST_DIRECT_P2P_UNREACHABLE')
  })

  it('probe throws: returns disabled target with capabilities message (not empty)', async () => {
    probeHostInferencePolicyFromSandboxMock.mockRejectedValue(new Error('network'))
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.id).toContain(':unavailable')
    expect(t.unavailable_reason).toBe('CAPABILITY_PROBE_FAILED')
    expect(t.secondary_label).toMatch(/Konge-AS1 · ID 123-456/)
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

  it('persisted orchestrator "host" does not block Host AI when ledger row is internal Sandbox↔Host', async () => {
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getOrchestratorModeMock.mockImplementation(() => minimalOrch('host'))
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'm1',
      modelId: 'm1',
      displayLabelFromHost: 'Host AI · m1',
      hostComputerNameFromHost: 'Konge-AS1',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '123-456',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: true,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets.length).toBeGreaterThan(0)
    expect(listHandshakeRecordsMock).toHaveBeenCalled()
  })

  it('p2p relay URL is not direct — with P2P stack off, list shows disabled target (no capabilities probe)', async () => {
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
    expect(t.unavailable_reason).toBe('MVP_P2P_ENDPOINT_INVALID')
    expect(t.legacyEndpointKind).toBe('relay')
    expect(t.p2pUiPhase).toBe('legacy_http_invalid')
    expect(t.secondary_label).toMatch(/Konge-AS1 · ID 123-456/)
  })

  it('STEP 3: relay + full P2P stack on — one row, relay signaling OK, not MVP; p2pUiPhase ready after probe', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    expect(p2pEndpointKind({}, relay)).toBe('relay')
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ p2p_endpoint: relay }),
    ])
    listHostCapabilitiesListMock.mockResolvedValue({
      ok: true,
      wire: {
        type: 'internal_inference_capabilities_result' as const,
        schema_version: 1,
        request_id: 'req-1',
        handshake_id: 'hs-internal-1',
        sender_device_id: 'dev-sand-1',
        target_device_id: 'dev-host-1',
        created_at: new Date().toISOString(),
        host_computer_name: 'Konge-AS1',
        host_pairing_code: '123456',
        models: [{ provider: 'ollama' as const, model: 'm1', label: 'm', enabled: true }],
        policy_enabled: true,
        active_local_llm: { provider: 'ollama' as const, model: 'm1', label: 'm', enabled: true },
        active_chat_model: 'm1',
      },
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(listHostCapabilitiesListMock).toHaveBeenCalled()
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(true)
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.legacyEndpointKind).toBe('relay')
    expect(t.p2pUiPhase).toBe('ready')
    expect(t.transportMode).toBe('webrtc_p2p')
    expect(t.inference_error_code).not.toBe('MVP_P2P_ENDPOINT_INVALID')
    expect(t.type).toBe('host_internal')
    expect(t.hostTargetAvailable).toBe(true)
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('relay + full P2P stack on but coordination health missing host_ai_p2p_signaling → p2p_unavailable', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    resetHostAiRelayCapabilityCacheForTests()
    setHostAiRelayCapabilityFetchForTests(async (url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }
      return new Response('', { status: 404 })
    })
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ p2p_endpoint: relay }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.p2pUiPhase).toBe('p2p_unavailable')
    expect(t.failureCode).toBe('RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE')
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('STEP 6: WebRTC stack on, session signaling and no DC yet → not selectable (transport_not_ready); ensureSession; no probe yet', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    isDcUpListMock.mockReturnValue(false)
    ensureSessionListMock.mockResolvedValue({
      handshakeId: 'hs-internal-1',
      sessionId: 'sess-sig-1',
      phase: 'signaling',
      p2pUiPhase: 'connecting',
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: Date.now() + 60_000,
      boundLocalDeviceId: 'dev-sand-1',
      boundPeerDeviceId: 'dev-host-1',
    })
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ p2p_endpoint: relay }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(ensureSessionListMock).toHaveBeenCalledWith('hs-internal-1', 'model_selector')
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('hidden')
    expect(t.available).toBe(false)
    expect(t.availability).toBe('host_offline')
    expect(t.hostAiStructuredUnavailableReason).toBe('transport_not_ready')
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
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
    expect(t.secondary_label).toMatch(/Konge-AS1 · ID 123-456/)
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

  it('assertSandboxRequestToHost fails (local_role vs device roles) but host+sandbox pairing still gets a gated Host row, not an empty list', async () => {
    isSandboxModeMock.mockReturnValue(true)
    /** Ledger local_role acceptor, but this instance id is the Host side of the pair → instance-id roles are host↔sandbox, not S→H client. */
    getInstanceIdMock.mockReturnValue('dev-host-1')
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ local_role: 'acceptor' as const })])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.id).toContain(':unavailable')
    expect(t.p2pUiPhase).toBe('hidden')
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

/**
 * STEP 8 — Production safety: relay vs WebRTC, Host-side invariants, session failure, identity, MVP finals.
 * Locks the contracts requested for ship readiness (alongside STEP 3 / STEP 6 / STEP 10 cases above).
 */
describe('STEP 8 — Production safety (unit contracts)', () => {
  it('(1) ACTIVE Sandbox→Host + relay + WebRTC on: target_detected=true in log; final p2pUiPhase is not legacy_http_invalid (ready path)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'm1',
      modelId: 'm1',
      displayLabelFromHost: 'Host AI · m1',
      hostComputerNameFromHost: 'Konge-AS1',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '123-456',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: false,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    const joined = log.mock.calls.flat().join('\n')
    expect(joined).toMatch(/\[HOST_AI_FLAGS\] p2pInferenceEnabled=true/)
    expect(joined).toMatch(/\[HOST_AI_TRANSPORT_DECIDE\].*target_detected=true.*preferred=webrtc_p2p.*reason=relay_signaling_webrtc/s)
    expect(joined).not.toMatch(
      /target_disabled[^\n]*reason=legacy_http_invalid[^\n]*MVP_P2P_ENDPOINT_INVALID/,
    )
    expect(t.p2pUiPhase).toBe('ready')
    expect(t.p2pUiPhase).not.toBe('legacy_http_invalid')
    expect(t.unavailable_reason).not.toBe('MVP_P2P_ENDPOINT_INVALID')
    log.mockRestore()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(1a) CONTRACT: WebRTC on + relay + ACTIVE Sandbox→Host — no MVP disable; DC down → not selectable (hidden), legacy invalid only', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    isDcUpListMock.mockReturnValue(false)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    ensureSessionListMock.mockResolvedValue({
      handshakeId: 'hs-internal-1',
      sessionId: 'sess-1a',
      phase: 'signaling',
      p2pUiPhase: 'connecting',
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: Date.now() + 60_000,
      boundLocalDeviceId: 'dev-sand-1',
      boundPeerDeviceId: 'dev-host-1',
    })
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'm1',
      modelId: 'm1',
      displayLabelFromHost: 'Host AI · m1',
      hostComputerNameFromHost: 'H',
      hostOrchestratorRoleLabelFromHost: 'Host',
      internalIdentifierDisplayFromHost: '1-2-3',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: false,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('hidden')
    expect(t.transportMode).toBe('webrtc_p2p')
    expect(t.p2pUiPhase).not.toBe('legacy_http_invalid')
    expect(t.inference_error_code).not.toBe('MVP_P2P_ENDPOINT_INVALID')
    expect(ensureSessionListMock).toHaveBeenCalled()
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(1b) relay + WebRTC on + still signaling: hidden row (transport not ready), not legacy invalid', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    isDcUpListMock.mockReturnValue(false)
    ensureSessionListMock.mockResolvedValue({
      handshakeId: 'hs-internal-1',
      sessionId: 'sess-sig-1',
      phase: 'signaling',
      p2pUiPhase: 'connecting',
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: Date.now() + 60_000,
      boundLocalDeviceId: 'dev-sand-1',
      boundPeerDeviceId: 'dev-host-1',
    })
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('hidden')
    expect(t.p2pUiPhase).not.toBe('legacy_http_invalid')
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(2) relay + WebRTC off + HTTP-only path: legacy_http_invalid (stack-off MVP)', async () => {
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('legacy_http_invalid')
    expect(t.unavailable_reason).toBe('MVP_P2P_ENDPOINT_INVALID')
  })

  it('(3) ACTIVE internal Host (local host role) on configured Host machine: no Host AI self-target', async () => {
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({
        local_role: 'initiator',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
      }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
  })

  it('CONTRACT (4): WebRTC env on + local side Host — no Host AI self-target', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({
        local_role: 'initiator',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
      }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(4) standard/external handshake: no Host AI target', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ handshake_type: 'standard' as any })])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
  })

  it('CONTRACT (3): WebRTC env on + external/standard handshake — target_detected path not used; no Host row', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ handshake_type: 'standard' as any })])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(5) cross-principal internal row: rejected (no target)', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ initiator: party('a'), acceptor: party('b') })])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(0)
  })

  it('(6) internal_coordination_identity_complete=false: hidden / repair state, not selectable', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ internal_coordination_identity_complete: false as any })])
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('hidden')
    expect(t.available).toBe(false)
    expect(t.host_selector_state).toBe('unavailable')
  })

  it('CONTRACT (5): WebRTC env on + internal_coordination_identity_complete=false — not selectable; no P2P session', async () => {
    ensureSessionListMock.mockClear()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ internal_coordination_identity_complete: false as any })])
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('hidden')
    expect(ensureSessionListMock).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(7) WebRTC session failed: p2p_unavailable, not legacy_http_invalid', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    isDcUpListMock.mockReturnValue(false)
    const failedSess = {
      handshakeId: 'hs-internal-1',
      sessionId: 'sess-dead',
      phase: 'failed',
      p2pUiPhase: 'p2p_unavailable',
      lastErrorCode: 'ICE_FAILED',
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: null,
      boundLocalDeviceId: 'a',
      boundPeerDeviceId: 'b',
    }
    getSessionStateListMock.mockReturnValue(failedSess)
    ensureSessionListMock.mockResolvedValue(failedSess)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('p2p_unavailable')
    expect(t.p2pUiPhase).not.toBe('legacy_http_invalid')
    expect(t.inference_error_code).toBe('ICE_FAILED')
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(8) DataChannel path + listHostCapabilities: ready and model on row; no policy probe', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    isDcUpListMock.mockReturnValue(true)
    probeHostInferencePolicyFromSandboxMock.mockReset()
    listHostCapabilitiesListMock.mockResolvedValue({
      ok: true,
      wire: {
        type: 'internal_inference_capabilities_result' as const,
        schema_version: 1,
        request_id: 'req-dc-8',
        handshake_id: 'hs-internal-1',
        sender_device_id: 'dev-sand-1',
        target_device_id: 'dev-host-1',
        created_at: new Date().toISOString(),
        host_computer_name: 'Konge-AS1',
        host_pairing_code: '123456',
        models: [{ provider: 'ollama' as const, model: 'gem', label: 'g', enabled: true }],
        policy_enabled: true,
        active_local_llm: { provider: 'ollama' as const, model: 'gem', label: 'g', enabled: true },
        active_chat_model: 'gem',
      },
    })
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.p2pUiPhase).toBe('ready')
    expect(t.model).toBe('gem')
    expect(t.displayTitle ?? t.label).toMatch(/gem/)
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
    expect(listHostCapabilitiesListMock).toHaveBeenCalled()
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('(10) relay + WebRTC on: p2p_endpoint_kind=relay must not emit MVP_P2P_ENDPOINT_INVALID as final inference_error_code on success', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    const { resetP2pInferenceFlagsForTests } = await import('../p2pInferenceFlags')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'm1',
      modelId: 'm1',
      displayLabelFromHost: 'Host AI · m1',
      hostComputerNameFromHost: 'H',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '1-2-3',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: false,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    expect(t.legacyEndpointKind).toBe('relay')
    expect(t.inference_error_code).not.toBe('MVP_P2P_ENDPOINT_INVALID')
    expect(t.p2pUiPhase).toBe('ready')
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })
})

/** Ledger: this device = Host, peer = Sandbox (same principal). Not a Sandbox→Host discovery client. */
function activeInternalLocalIsHost(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return activeInternalSandboxToHost({
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    ...over,
  })
}

describe('STEP 10 — named regression (main: listSandboxHostInternalInferenceTargets)', () => {
  it('(1) configured Host + internal row proves Sandbox (this device): discovery runs, mode_mismatch logged, capabilities probed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'm1',
      modelId: 'm1',
      displayLabelFromHost: 'Host AI · m1',
      hostComputerNameFromHost: 'H',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '1-2-3',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: true,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(true)
    expect(r.targets[0]?.available).toBe(true)
    const joined = log.mock.calls.flat().join('\n')
    expect(joined).toMatch(/mode_mismatch configured_mode=host/)
    log.mockRestore()
  })

  it('(2) configured Sandbox + ledger local Host (this device is Host on pair): no usable Host target, no capability probe', async () => {
    isSandboxModeMock.mockReturnValue(true)
    isHostModeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([activeInternalLocalIsHost()])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(false)
    const t = r.targets[0]!
    expect(t.available).toBe(false)
    expect(t.id).toContain(':unavailable')
  })

  it('(3) configured Host, no internal handshake: no Host AI targets', async () => {
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    listHandshakeRecordsMock.mockReturnValue([])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
  })

  it('(4) configured Sandbox, no internal handshake: no Host AI targets', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
  })

  it('(5) ACTIVE Sandbox→Host + direct P2P + active model: available target', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost()])
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'gem',
      modelId: 'gem',
      displayLabelFromHost: 'Host AI · gem',
      hostComputerNameFromHost: 'H',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifierDisplayFromHost: '1-2-3',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: true,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets[0]?.available).toBe(true)
    expect(r.targets[0]?.model).toBe('gem')
  })

  it('(6) ACTIVE Sandbox→Host + missing/invalid direct endpoint: disabled row, not empty', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ p2p_endpoint: null as unknown as string }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0]?.available).toBe(false)
    expect(probeHostInferencePolicyFromSandboxMock).not.toHaveBeenCalled()
  })

  it('(7) external (non-internal) handshake: no Host AI target', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ handshake_type: 'standard' as any }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
  })

  it('(8) cross-principal internal row: no Host AI target', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ initiator: party('a'), acceptor: party('b') }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
  })
})

/**
 * Shipped Host AI: unset env → P2P stack defaults on; `WRDESK_HOST_AI_DISABLED=1` removes list rows.
 */
describe('Host AI P2P — bundle defaults (no WRDESK env)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('ACTIVE Sandbox→Host + relay + no env: getP2pInferenceFlags on; [HOST_AI_FLAGS_SOURCE]; transport preferred=webrtc_p2p; row hidden until DC', async () => {
    const { getP2pInferenceFlags } = await import('../p2pInferenceFlags')
    const f = getP2pInferenceFlags()
    expect(f.p2pInferenceEnabled).toBe(true)
    expect(f.p2pInferenceSignalingEnabled).toBe(true)
    expect(f.p2pInferenceWebrtcEnabled).toBe(true)
    expect(f.p2pInferenceCapsOverP2p).toBe(true)
    expect(f.p2pInferenceRequestOverP2p).toBe(true)
    expect(f.p2pInferenceHttpFallback).toBe(false)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    isSandboxModeMock.mockReturnValue(true)
    isDcUpListMock.mockReturnValue(false)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    ensureSessionListMock.mockResolvedValue({
      handshakeId: 'hs-internal-1',
      sessionId: 'sess-defaults',
      phase: 'signaling',
      p2pUiPhase: 'connecting',
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: Date.now() + 60_000,
      boundLocalDeviceId: 'dev-sand-1',
      boundPeerDeviceId: 'dev-host-1',
    })
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: true as const,
      allowSandboxInference: true,
      defaultChatModel: 'mdef',
      modelId: 'mdef',
      displayLabelFromHost: 'Host AI · mdef',
      hostComputerNameFromHost: 'H',
      hostOrchestratorRoleLabelFromHost: 'Host',
      internalIdentifierDisplayFromHost: '1-2-3',
      internalIdentifier6FromHost: '123456',
      directP2pAvailable: false,
    })
    const r = await listSandboxHostInternalInferenceTargets()
    const t = r.targets[0]!
    const joined = log.mock.calls.flat().join('\n')
    expect(joined).toMatch(/\[HOST_AI_FLAGS_SOURCE\] source=default/)
    expect(joined).toMatch(/p2pInferenceEnabled=true.*signaling=true.*webrtc=true/s)
    expect(joined).toMatch(/\[HOST_AI_TRANSPORT_DECIDE\].*preferred=webrtc_p2p.*selector_phase=connecting/s)
    expect(t.transportMode).toBe('webrtc_p2p')
    expect(t.p2pUiPhase).toBe('hidden')
    expect(t.available).toBe(false)
    log.mockRestore()
  })

  it('WRDESK_HOST_AI_DISABLED: empty list (no Host AI row, not legacy_http_invalid)', async () => {
    vi.stubEnv('WRDESK_HOST_AI_DISABLED', '1')
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(true)
    const relay = 'https://relay.wrdesk.com/xyz/beap/ingest'
    listHandshakeRecordsMock.mockReturnValue([activeInternalSandboxToHost({ p2p_endpoint: relay })])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
    const joined = log.mock.calls.flat().join('\n')
    expect(joined).toMatch(/list_skip reason=host_ai_p2p_ux_disabled/)
    expect(joined).not.toMatch(/legacy_http_invalid.*MVP_P2P_ENDPOINT_INVALID/)
    log.mockRestore()
  })
})

/**
 * Final acceptance: Host device (orchestrator file host, ledger local Host on internal pair) must not
 * get a Sandbox→Host "Host AI" self-target; discovery list exits before emitting client rows.
 */
describe('FINAL ACCEPTANCE — main: no Host AI self-target on Host side of pair', () => {
  it('configured Host + only local-Host internal row: empty targets (not a S→H client)', async () => {
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getHandshakeDbMock.mockResolvedValue({})
    listHandshakeRecordsMock.mockReturnValue([activeInternalLocalIsHost()])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toEqual([])
  })
})

/**
 * Direct P2P unavailable: one disabled explanatory row, never a silent empty selector when the row is otherwise relevant.
 * (Complements `FINAL ACCEPTANCE` static tests in `finalAcceptance.hostAiInvariants.test.ts`.)
 */
describe('FINAL ACCEPTANCE — main: P2P down, selector not silently empty', () => {
  it('missing direct endpoint: one disabled target with unavailable_reason', async () => {
    isSandboxModeMock.mockReturnValue(true)
    listHandshakeRecordsMock.mockReturnValue([
      activeInternalSandboxToHost({ p2p_endpoint: null as unknown as string }),
    ])
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.targets).toHaveLength(1)
    expect(r.targets[0]?.available).toBe(false)
    expect(r.targets[0]?.unavailable_reason).toBe('MISSING_P2P_ENDPOINT')
  })
})
