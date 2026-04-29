/**
 * Regression: With BEAP endpoint missing (trusted=false, HOST_AI_DIRECT_PEER_BEAP_MISSING), LAN `/api/tags`
 * must still surface two `ollama_direct` selector rows (`ollama_direct_only`), not an empty list.
 *
 * Mirrors trust case G (`peer_host_endpoint_missing`) from `inferenceHandshakeTrust.test.ts` —
 * ledger / local MVP BEAP URL with no verified peer-hosted BEAP advertisement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-beap-missing-odl-regression',
    getAppPath: () => '/tmp/wrdesk-beap-missing-odl-regression',
  },
}))

import type { SandboxOllamaDirectTagsFetchResult } from '../sandboxHostAiOllamaDirectTags'
import type { HandshakeRecord } from '../../handshake/types'
import type { HostAiTransportDeciderResult } from '../transport/decideInternalInferenceTransport'
import * as decideInternalInferenceTransportModule from '../transport/decideInternalInferenceTransport'
import { InternalInferenceErrorCode } from '../errors'
import {
  resetP2pEnsureThrottleCacheForTests,
  resetWebrtcListHostCapsCacheForTests,
  listSandboxHostInternalInferenceTargets,
} from '../listInferenceTargets'
import { resetHostAdvertisedMvpDirectForTests } from '../p2pEndpointRepair'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import {
  resetHostAiRelayCapabilityCacheForTests,
  setHostAiRelayCapabilityFetchForTests,
} from '../hostAiRelayCapability'

/** Same MVP BEAP string as inference trust case G (`peer_host_endpoint_missing`, poisoned ledger, no relay ad). */
const LOCAL_BEAP_OTHER = 'http://192.168.178.55:51249/beap/ingest'

/** Deterministic transport decider output — handshake trust denies BEAP; ODL prefetch still fills models. */
const peerMissingBeapDeciderStub: HostAiTransportDeciderResult = {
  targetDetected: true,
  selectorPhase: 'connecting',
  preferredTransport: 'webrtc_p2p',
  mayUseLegacyHttpFallback: false,
  legacyHttpFallbackViable: false,
  /** Semantics preserved from decision case G against real `decideInternalInferenceTransport`: BEAP ingest path gated. */
  p2pTransportEndpointOpen: true,
  failureCode: null,
  userSafeReason: null,
  hostAiVerifiedDirectHttp: false,
  hostAiRouteResolveFailureCode: null,
  hostAiRouteResolveFailureReason: null,
  inferenceHandshakeTrusted: false,
  inferenceTrustedUrl: null,
  inferenceHandshakeTrustReason: 'peer_host_endpoint_missing',
}

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
  return { isHostModeMock: isHost, isSandboxModeMock: isSandbox, getOrchestratorModeMock: getOrch, getInstanceIdMock: getInst }
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

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    coordination_url: 'https://coord.test.invalid',
    use_coordination: true,
  }),
  /** Must equal ledger `LOCAL_BEAP_OTHER` for peer_host_endpoint_missing wiring (trust tests). */
  computeLocalP2PEndpoint: () => LOCAL_BEAP_OTHER,
}))

const probeHostInferencePolicyFromSandboxMock = vi.fn()
vi.mock('../sandboxHostUi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../sandboxHostUi')>()
  return {
    ...mod,
    probeHostInferencePolicyFromSandbox: (hid: string, o?: { correlationChain?: string }) =>
      probeHostInferencePolicyFromSandboxMock(hid, o),
  }
})
vi.mock('../transport/internalInferenceTransport', () => ({
  listHostCapabilities: vi.fn(async () => ({ ok: false, reason: 'not_used_odl_bypass' })),
}))

const odTagsResult = (): SandboxOllamaDirectTagsFetchResult => ({
  classification: 'available',
  ok: true,
  http_status: 200,
  models_count: 2,
  models: [
    {
      id: 'model-a',
      model: 'model-a',
      label: 'model-a',
      provider: 'ollama',
      transport: 'ollama_direct',
      source: 'remote_ollama_tags',
      endpoint_owner_device_id: 'dev-host-coord-1',
    },
    {
      id: 'model-b',
      model: 'model-b',
      label: 'model-b',
      provider: 'ollama',
      transport: 'ollama_direct',
      source: 'remote_ollama_tags',
      endpoint_owner_device_id: 'dev-host-coord-1',
    },
  ],
  error_code: null,
  duration_ms: 1,
  cache_hit: false,
  inflight_reused: false,
})

const fetchOdTagsMock = vi.hoisted(() => vi.fn(async () => odTagsResult()))
const getSandboxOdlCandMock = vi.hoisted(() =>
  vi.fn((hid: string) => ({
    route_kind: 'ollama_direct' as const,
    handshake_id: String(hid ?? '').trim(),
    base_url: 'http://192.168.199.88:11434/',
    endpoint_owner_device_id: 'dev-host-coord-1',
    peer_host_device_id: 'dev-host-coord-1',
    validated_at_ms: Date.now(),
  })),
)

vi.mock('../sandboxHostAiOllamaDirectTags', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../sandboxHostAiOllamaDirectTags')>()
  return {
    ...mod,
    fetchSandboxOllamaDirectTags: fetchOdTagsMock,
  }
})

vi.mock('../sandboxHostAiOllamaDirectCandidate', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../sandboxHostAiOllamaDirectCandidate')>()
  return {
    ...mod,
    getSandboxOllamaDirectRouteCandidate: getSandboxOdlCandMock,
  }
})

const getSessionStateListMock = vi.hoisted(() => vi.fn(() => null as any))
const ensureSessionListMiniMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    handshakeId: 'hs-internal-1',
    sessionId: 'p2p-mini',
    phase: 'ready' as const,
    p2pUiPhase: 'ready' as const,
    lastErrorCode: null,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
    signalingExpiresAt: null,
    boundLocalDeviceId: 'dev-sand-coord-1',
    boundPeerDeviceId: 'dev-host-coord-1',
  }),
)
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
  ensureHostAiP2pSession: (...a: unknown[]) => ensureSessionListMiniMock(...a),
  evictHostAiP2pSessionForStuckListCache: vi.fn(),
  subscribeSessionState: vi.fn(() => () => {}),
  getSessionState: (...a: unknown[]) => getSessionStateListMock(...a),
}))

const isDcUpListMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('../p2pSession/p2pSessionWait', () => ({
  HOST_AI_CAPABILITY_DC_WAIT_MS: 8_000,
  isP2pDataChannelUpForHandshake: (hid: string) => isDcUpListMock(hid),
  p2pCapabilityDcWaitOutcomeLogReason: () => 'timeout',
  waitForP2pDataChannelOpenOrTerminal: vi.fn(async () => ({ ok: false as const, reason: 'dc_open_timeout' as const })),
}))

/** Same principal — internal Sandbox ↔ Host handshake. */
function party(uid: string) {
  return { email: `${uid}@test.dev`, wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function handshakeBeapPoisonedSandboxLedgerNoPeerAd(): HandshakeRecord {
  return {
    handshake_id: 'hs-internal-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    local_role: 'initiator',
    initiator: party('same'),
    acceptor: party('same'),
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    /** Align with inferenceHandshakeTrust wiring tests — matches getInstanceId in beforeEach */
    initiator_coordination_device_id: 'dev-sand-coord-1',
    acceptor_coordination_device_id: 'dev-host-coord-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    /** Poisoned MVP row — equals local MVP BEAP; no peer-Host verified BEAP ⇒ peer_host_endpoint_missing when no relay ad */
    p2p_endpoint: LOCAL_BEAP_OTHER,
    local_p2p_auth_token: 'tok-local',
    counterparty_p2p_token: 'bearer-g',
    acceptor_device_name: 'Host-PC',
    initiator_device_name: 'Sandbox-PC',
    internal_peer_pairing_code: '123456',
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: {} as unknown,
    current_tier_signals: {} as unknown,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as unknown,
    external_processing: {} as unknown,
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
  } as HandshakeRecord
}

describe('sandbox_lists_remote_ollama_models_even_when_beap_endpoint_missing', () => {
  let decideSpy: ReturnType<typeof vi.spyOn<typeof decideInternalInferenceTransportModule, 'decideInternalInferenceTransport'>>

  beforeEach(() => {
    vi.unstubAllEnvs()
    resetHostAiRelayCapabilityCacheForTests()
    setHostAiRelayCapabilityFetchForTests(async () => new Response('', { status: 404 }))
    resetWebrtcListHostCapsCacheForTests()
    resetP2pEnsureThrottleCacheForTests()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getHandshakeDbMock.mockResolvedValue({})
    getInstanceIdMock.mockReturnValue('dev-sand-coord-1')
    fetchOdTagsMock.mockImplementation(async () => odTagsResult())
    decideSpy = vi
      .spyOn(decideInternalInferenceTransportModule, 'decideInternalInferenceTransport')
      .mockReturnValue(peerMissingBeapDeciderStub)
    listHandshakeRecordsMock.mockReturnValue([handshakeBeapPoisonedSandboxLedgerNoPeerAd()])
    /** Synthetic probe fallback should not shadow ODL enumeration when prefetch succeeded */
    probeHostInferencePolicyFromSandboxMock.mockResolvedValue({
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      message: 'probe_fail_but_odl_bypass_should_heal',
      directP2pAvailable: false,
    })
    isDcUpListMock.mockReturnValue(false)
  })

  afterEach(() => {
    decideSpy?.mockRestore()
    vi.unstubAllEnvs()
    setHostAiRelayCapabilityFetchForTests(null)
    resetHostAiRelayCapabilityCacheForTests()
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
    vi.clearAllMocks()
  })

  it('lists two remote ODL rows while BEAP is missing (trusted=false, HOST_AI_DIRECT_PEER_BEAP_MISSING)', async () => {
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown, ...rest: unknown[]) => {
      const line = typeof msg === 'string' ? `${msg}${rest.join(' ')}` : String(msg)
      logs.push(line)
    })

    const r = await listSandboxHostInternalInferenceTargets()
    logSpy.mockRestore()

    expect(r.ok).toBe(true)
    const ts = r.targets ?? []
    expect(ts.length).toBe(2)

    const listDone = logs.find((l) => l.includes('[HOST_INFERENCE_TARGETS]') && l.includes('list_done'))
    expect(listDone).toBeDefined()
    expect(listDone!).toMatch(/count=1\b/)
    expect(listDone!).toMatch(/available_count=1\b/)
    expect(listDone!).toMatch(/ollama_direct_count=1\b/)
    expect(listDone!).toMatch(/beap_ready_count=0\b/)

    const aggregatedModels = [...new Set(ts.map((x) => String(x.model ?? '').trim()))].sort()
    expect(aggregatedModels).toEqual(['model-a', 'model-b'])
    /** Equivalent to IPC consumers that join per-model selector rows (`models.length` on the handshake). */
    expect(aggregatedModels.length).toBe(2)

    expect(logs.some((l) => l.includes('peer_host_endpoint_missing'))).toBe(true)
    const odOnlyLog = logs.find(
      (l) =>
        l.includes('[HOST_INFERENCE_TARGETS]') &&
        l.includes('beap_target_available=false') &&
        l.includes('ollama_direct_available=true') &&
        l.includes('ollama_direct_models=2'),
    )
    expect(odOnlyLog).toBeDefined()

    const summary = logs.find((l) => l.includes('[HOST_AI_TARGET_SUMMARY]'))
    expect(summary).toBeDefined()
    expect(String(summary)).toMatch(/status=ollama_direct_only/)
    expect(String(summary)).toMatch(/modelsCount=2\b/)
    expect(String(summary)).toMatch(/visibleInModelSelector=true\b/)

    const target = ts.find((t) => String(t.model) === 'model-a')
    expect(target).toBeDefined()
    const t = target!

    expect(t.host_ai_target_status).toBe('ollama_direct_only')
    expect(t.beapReady).toBe(false)
    expect(t.ollamaDirectReady).toBe(true)
    expect(t.canUseTopChatTools).toBe(false)
    expect(t.canUseOllamaDirect).toBe(true)
    expect(t.visibleInModelSelector).toBe(true)
    expect(String(t.failureCode ?? '')).toBe('')
    expect(t.beapFailureCode).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
    expect(String(t.ollamaDirectFailureCode ?? '')).toBe('')
    /** Row-level semantics: BEAP-route trust unavailable; OD lane still enumerated */
    expect(t.trusted ?? false).toBe(false)

    expect(fetchOdTagsMock).toHaveBeenCalled()
  })
})
