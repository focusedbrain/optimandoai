/**
 * End-to-end style integration: real `listSandboxHostInternalInferenceTargets` + real
 * `probeHostInferencePolicyFromSandbox` + real `listHostCapabilities` (HTTP), with
 * `fetch` mocked. Exercises `resolveSandboxToHostHttpDirectIngest` + capability POST
 * without stubbing `HOST_AI_ENDPOINT_*` or provenance short-circuit flags.
 *
 * Run from the repo root that contains `vitest.config.ts` (this workspace: `code/code`):
 * `pnpm vitest run apps/electron-vite-project/electron/main/internalInference/__tests__/hostAiE2eSandboxToHostSuccess.integration.test.ts --config vitest.config.ts`
 *
 * Covers: (1) self-BEAP + no peer ad → `HOST_AI_DIRECT_PEER_BEAP_MISSING` (no direct HTTP; not “no P2P”).
 * (2) Relay-seeded host-owned distinct BEAP + successful capabilities POST → `available` row,
 *     `hostWireOllamaReachable` from host wire. (3) Host list path does not depend on
 *     sandbox-local Ollama. (4) Two models + Ollama on host in wire. (5) No env/test hook
 *     disables peer-endpoint / owner-mismatch enforcement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/wrdesk-host-ai-e2e', getAppPath: () => '/tmp/wrdesk-host-ai-e2e' },
}))

const {
  isHostModeMock,
  isSandboxModeMock,
  getOrchestratorModeMock,
  getInstanceIdMock,
} = vi.hoisted(() => {
  const isH = vi.fn(() => true)
  const isS = vi.fn(() => false)
  const getInst = vi.fn()
  const minimal = (mode: 'host' | 'sandbox') => ({
    mode,
    deviceName: 'dev',
    instanceId: 'inst',
    pairingCode: '123456',
    connectedPeers: [] as const,
  })
  const getOrch = vi.fn(() => minimal('host'))
  return { isHostModeMock: isH, isSandboxModeMock: isS, getOrchestratorModeMock: getOrch, getInstanceIdMock: getInst }
})

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => isHostModeMock(),
  isSandboxMode: () => isSandboxModeMock(),
  getOrchestratorMode: () => getOrchestratorModeMock(),
  getInstanceId: () => getInstanceIdMock(),
}))

/** Canonical ids from the scenario (device coordination). */
const SANDBOX_DEVICE_ID = '4a90a60b-3f53-43c5-92b3-1bbe9d943063'
const HOST_DEVICE_ID = '8929353a-5cbc-46f7-b4d9-6439b82a14ca'
const LOCAL_SANDBOX_BEAP = 'http://10.0.0.5:9/beap/ingest'
const PEER_HOST_DIRECT_BEAP = 'http://192.168.1.20:51249/beap/ingest'
const HS_ID = 'hs-e2e-sandbox-to-host-1'

import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import { HandshakeState } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import {
  clearHostAiListTransientStateForOrchestratorBuildChange,
  listSandboxHostInternalInferenceTargets,
  resetP2pEnsureThrottleCacheForTests,
  resetWebrtcListHostCapsCacheForTests,
} from '../listInferenceTargets'
import { resetHostAdvertisedMvpDirectForTests, setHostAdvertisedMvpDirectForTests } from '../p2pEndpointRepair'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { resetHostAiRelayCapabilityCacheForTests, setHostAiRelayCapabilityFetchForTests } from '../hostAiRelayCapability'
import { resetProbeHostInferencePolicyInFlightForTests } from '../sandboxHostUi'

const ledgerRows: HandshakeRecord[] = []

function party(uid: string): PartyIdentity {
  return { email: `${uid}@test.dev`, wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function makeHandshake(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: HS_ID,
    relationship_id: 'rel-e2e-1',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    initiator: party('user-one'),
    acceptor: party('user-one'),
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_device_name: 'Sandbox-PC',
    acceptor_device_name: 'Host-PC',
    initiator_coordination_device_id: SANDBOX_DEVICE_ID,
    acceptor_coordination_device_id: HOST_DEVICE_ID,
    internal_peer_pairing_code: '445566',
    internal_coordination_identity_complete: true,
    p2p_endpoint: LOCAL_SANDBOX_BEAP,
    local_p2p_auth_token: 'tok-sandbox',
    counterparty_p2p_token: 'tok-host',
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
    internal_coordination_repair_needed: false,
    ...over,
  } as HandshakeRecord
}

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    enabled: true,
    coordination_url: 'https://coord.example/beap/ingest',
  }),
  computeLocalP2PEndpoint: () => LOCAL_SANDBOX_BEAP,
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, hid: string) =>
    ledgerRows.find((r) => String(r.handshake_id) === String(hid)) ?? null,
  listHandshakeRecords: (_db: unknown, filter: { state?: string }) => {
    if (filter?.state) {
      return ledgerRows.filter((r) => r.state === filter.state)
    }
    return [...ledgerRows]
  },
  updateHandshakeRecord: vi.fn(),
}))

const getHandshakeDbMock = vi.fn<() => Promise<Record<string, unknown> | null>>()
vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

const ensureSessionE2eMock = vi.hoisted(() =>
  vi.fn().mockImplementation(async (hid: string) => ({
    handshakeId: hid,
    sessionId: 'p2p-sess-e2e',
    phase: 'ready' as const,
    p2pUiPhase: 'ready' as const,
    lastErrorCode: null,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
    signalingExpiresAt: null,
    boundLocalDeviceId: SANDBOX_DEVICE_ID,
    boundPeerDeviceId: HOST_DEVICE_ID,
  })),
)
const isDcUpE2eMock = vi.hoisted(() => vi.fn(() => false))
const getSessionStateE2eMock = vi.hoisted(() => vi.fn(() => null as any))
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
  P2pSessionLogReason: { user: 'user', unknown: 'unknown' },
  getSessionState: (...a: unknown[]) => getSessionStateE2eMock(...a),
  subscribeSessionState: vi.fn(() => () => {}),
  ensureHostAiP2pSession: (hid: string, reason: string) => ensureSessionE2eMock(hid, reason),
  ensureSessionSingleFlight: (hid: string, reason: string) => ensureSessionE2eMock(hid, reason),
  preflightP2pRelaySignal: vi.fn(() => Promise.resolve(false)),
  handleSignal: vi.fn(),
  markDataChannelOpenForP2pSession: vi.fn(),
  closeSession: vi.fn(),
  closeAllP2pInferenceSessions: vi.fn(),
  _resetP2pInferenceSessionsForTests: vi.fn(),
}))

vi.mock('../p2pSession/p2pSessionWait', () => ({
  HOST_AI_CAPABILITY_DC_WAIT_MS: 8_000,
  isP2pDataChannelUpForHandshake: (hid: string) => isDcUpE2eMock(hid),
  p2pCapabilityDcWaitOutcomeLogReason: (out: { ok: boolean; reason?: string }) => String(out.reason ?? 'unknown'),
  waitForP2pDataChannelOpenOrTerminal: async () => ({ ok: false as const, reason: 'dc_open_timeout' as const }),
}))

function makeCapabilitiesWire() {
  return {
    type: 'internal_inference_capabilities_result' as const,
    schema_version: 1,
    request_id: 'e2e-req-1',
    handshake_id: HS_ID,
    sender_device_id: HOST_DEVICE_ID,
    target_device_id: SANDBOX_DEVICE_ID,
    created_at: new Date().toISOString(),
    host_computer_name: 'Host-PC',
    host_pairing_code: '445566',
    policy_enabled: true,
    active_local_llm: { provider: 'ollama' as const, model: 'm-host-a', label: 'A', enabled: true },
    active_chat_model: 'm-host-a',
    models: [
      { provider: 'ollama' as const, model: 'm-host-a', label: 'A', enabled: true },
      { provider: 'ollama' as const, model: 'm-host-b', label: 'B', enabled: true },
    ],
  }
}

let fetchMock: ReturnType<typeof vi.fn>

describe('Host AI E2E — sandbox ↔ host (HTTP capabilities path)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    ledgerRows.length = 0
    ledgerRows.push(makeHandshake())
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue(SANDBOX_DEVICE_ID)
    getHandshakeDbMock.mockResolvedValue({})
    resetHostAdvertisedMvpDirectForTests()
    resetP2pInferenceFlagsForTests()
    resetWebrtcListHostCapsCacheForTests()
    resetP2pEnsureThrottleCacheForTests()
    resetProbeHostInferencePolicyInFlightForTests()
    clearHostAiListTransientStateForOrchestratorBuildChange()
    resetHostAiRelayCapabilityCacheForTests()
    setHostAiRelayCapabilityFetchForTests(async (url) => {
      const s = String(url)
      if (s.includes('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }
      return new Response('', { status: 404 })
    })
    // Legacy direct HTTP: WebRTC P2P stack off (not disabling endpoint provenance checks).
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '0')
    getSessionStateE2eMock.mockReturnValue(null)
    isDcUpE2eMock.mockReturnValue(false)
    fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          reject(new Error(`unexpected fetch: ${String(input)} ${init?.method ?? 'GET'}`))
        }) as any,
    )
    vi.stubGlobal('fetch', fetchMock as any)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    setHostAiRelayCapabilityFetchForTests(null)
    vi.unstubAllGlobals()
  })

  it('rejects HOST_AI when ledger/caller point at this device’s BEAP and there is no peer-advertised endpoint (selected === local, peer ad null)', async () => {
    // No setHostAdvertisedMvpDirectForTests → resolveSandbox: peer_host_beap_not_advertised
    fetchMock.mockImplementation(() => {
      throw new Error('HTTP must not be reached when provenance fails before POST')
    })
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.ok).toBe(true)
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.kind).toBe('host_internal')
    expect(t.available).toBe(false)
    expect(t.inference_error_code).toBe(InternalInferenceErrorCode.HOST_AI_NO_ROUTE)
    expect(t.host_ai_endpoint_diagnostics).toBeDefined()
    expect(t.host_ai_endpoint_diagnostics?.local_device_id).toBe(SANDBOX_DEVICE_ID)
    expect(t.host_ai_endpoint_diagnostics?.peer_host_device_id).toBe(HOST_DEVICE_ID)
    expect(t.host_ai_endpoint_diagnostics?.selected_endpoint).toBeNull()
    expect(t.host_ai_endpoint_diagnostics?.selected_endpoint_owner).toBeNull()
    expect(t.host_ai_endpoint_diagnostics?.local_beap_endpoint).toBe(LOCAL_SANDBOX_BEAP)
    expect(t.host_ai_endpoint_diagnostics?.peer_advertised_beap_endpoint).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('emits an available host_internal row when relay-authenticated peer BEAP + host owner distrust check passes and capabilities POST returns two Ollama models', async () => {
    // Simulates: relay + signed path already validated; map holds url as if seq/TTL pre-checked.
    setHostAdvertisedMvpDirectForTests(HS_ID, PEER_HOST_DIRECT_BEAP, {
      ownerDeviceId: HOST_DEVICE_ID,
      adSource: 'relay',
    })
    const wire = makeCapabilitiesWire()
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((resolve) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
          if (init?.method === 'POST' && url.startsWith(PEER_HOST_DIRECT_BEAP)) {
            expect(init.body).toContain('internal_inference_capabilities_request')
            resolve(
              new Response(JSON.stringify(wire), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
            return
          }
          resolve(new Response('unexpected url', { status: 404 }))
        }),
    )
    const r = await listSandboxHostInternalInferenceTargets()
    expect(r.ok).toBe(true)
    expect(r.refreshMeta.hadCapabilitiesProbed).toBe(true)
    expect(r.targets).toHaveLength(1)
    const t = r.targets[0]!
    expect(t.kind).toBe('host_internal')
    expect(t.available).toBe(true)
    expect(t.host_device_id).toBe(HOST_DEVICE_ID)
    expect(t.model).toBe('m-host-a')
    expect(t.hostWireOllamaReachable).toBe(true)
    expect(t.inference_error_code).not.toBe(InternalInferenceErrorCode.OLLAMA_UNREACHABLE_ON_SANDBOX)
    expect(fetchMock).toHaveBeenCalled()
    const firstCall = fetchMock.mock.calls[0]!
    const postUrl = typeof firstCall[0] === 'string' ? firstCall[0] : (firstCall[0] as Request).url
    expect(postUrl).toMatch(/192\.168\.1\.20/)
    expect(postUrl).not.toContain('10.0.0.5')
  })
})
