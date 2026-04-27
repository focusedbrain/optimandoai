/**
 * Host AI routing correctness — regression targets (expected to FAIL until production fixes land).
 *
 * Run from workspace `code/code` so Node resolves `crypto` correctly (not the Vite electron-renderer stub):
 *   npx vitest run apps/electron-vite-project/electron/main/internalInference/__tests__/hostAiRoutingCorrectness.regression.test.ts --config vitest.config.ts
 *
 * Documents:
 * - No dial to sandbox-local BEAP as paired Host; no policy_fallback_get on raw ledger/local URL when
 *   peer Host direct BEAP is missing.
 * - Without ANY trust source (neither BEAP peer attestation nor inference handshake+bearer trust),
 *   direct_http_available / legacy_http must not be selected from a syntactic direct /beap/ingest URL alone.
 * - BEAP role denial (forbidden_host_role) must be terminal — no policy GET, typed error not PROBE_AUTH_REJECTED.
 * - HTTP fallback after DC errors must not hit unverified ledger-only direct routes (no peer advertisement).
 *
 * Identity: coordination device IDs + initiator/acceptor roles on the handshake row (not IP as identity).
 *
 * Note: `getP2pInferenceFlags().p2pInferenceCapsOverP2p` is true when **either**
 * `WRDESK_P2P_INFERENCE_CAPS_OVER_P2P` or `WRDESK_P2P_INFERENCE_DC_CAPABILITIES` resolves true.
 * Tests that need the HTTP capabilities branch must set **both** to `0`, or `listHostCapabilities`
 * keeps selecting `webrtc_p2p` / await-DC even when WebRTC env flags are off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord, type PartyIdentity } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import {
  resetHostAdvertisedMvpDirectForTests,
  setHostAdvertisedMvpDirectForTests,
} from '../p2pEndpointRepair'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/wrdesk-host-ai-routing-regression', getAppPath: () => '/tmp' },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
  },
}))

/** Vitest resolves `crypto` to an electron-renderer stub that uses `require` — use Node-safe mock. */
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000099'),
}))

const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'dev-sand-coord-1'))
const getHandshakeDbMock = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const getHandshakeRecordMock = vi.hoisted(() => vi.fn())

/**
 * Avoid importing real `orchestratorModeStore` in app-local Vitest; from repo root it is fine but we stub for consistency.
 * `logHostAiEndpointSelect` calls `getOrchestratorMode()` — must be mocked.
 */
vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceIdMock(),
  getOrchestratorMode: () => ({ mode: 'sandbox' }),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbMock(),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, hid: string) => getHandshakeRecordMock(hid),
  listHandshakeRecords: () => [],
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    enabled: true,
    coordination_url: 'https://coord.example/beap/ingest',
  }),
  computeLocalP2PEndpoint: () => 'http://192.168.0.5:51249/beap/ingest',
}))

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({ timeoutMs: 10_000 }),
}))

vi.mock('../hostAiPairingStateStore', () => ({
  hostAiPairingListBlock: () => ({ block: false as const }),
  recordHostAiLedgerAsymmetric: vi.fn(),
  recordHostAiReciprocalCapabilitiesSuccess: vi.fn(),
}))

vi.mock('../hostAiRelayCapability', () => ({
  resolveRelayHostAiP2pSignalingForTransportDecider: vi.fn().mockResolvedValue('supported' as const),
}))

/** Same string used by mocked `computeLocalP2PEndpoint` — ledger must not be dialed as peer Host when equal. */
const LOCAL_SANDBOX_MVP_DIRECT_BEAP = 'http://192.168.0.5:51249/beap/ingest'
/**
 * Distinct direct ingest — not equal to local published URL; ledger-only (no relay/header ad).
 * Hostname (not RFC1918 literal) avoids `internal_direct_http_preferred` short-circuit in the decider.
 */
const LEDGER_DIRECT_NON_LOCAL = 'http://peer-host.test:51249/beap/ingest'

const getSessionStateMock = vi.hoisted(() => vi.fn())
const isDcUpMock = vi.hoisted(() => vi.fn())
const requestCapsMock = vi.hoisted(() => vi.fn())

/**
 * Do not `importOriginal` here — the real module imports `crypto` / `electron` in ways that break Vitest ESM.
 * Export only symbols used by `listHostCapabilities` / `decideInternalInferenceTransport`.
 */
vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  P2pSessionPhase: {
    idle: 'idle',
    starting: 'starting',
    signaling: 'signaling',
    connecting: 'connecting',
    datachannel_open: 'datachannel_open',
    ready: 'ready',
    failed: 'failed',
    closed: 'closed',
  },
  getSessionState: (h: string) => getSessionStateMock(h),
}))

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: (h: string) => isDcUpMock(h),
}))

vi.mock('../p2pDc/p2pDcCapabilities', () => ({
  requestHostInferenceCapabilitiesOverDataChannel: (
    h: string,
    sid: string,
    t: number,
    o: { requestId: string },
  ) => requestCapsMock(h, sid, t, o),
}))

function party(): PartyIdentity {
  return { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' }
}

function sandboxToHostRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-routing-regression',
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
    initiator_coordination_device_id: 'dev-sand-coord-1',
    acceptor_coordination_device_id: 'dev-host-coord-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: LOCAL_SANDBOX_MVP_DIRECT_BEAP,
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    ...over,
  } as HandshakeRecord
}

describe('Host AI routing regression (expected failures until resolver hardens)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
    getInstanceIdMock.mockReturnValue('dev-sand-coord-1')
    getHandshakeDbMock.mockResolvedValue({})
    getHandshakeRecordMock.mockImplementation((hid: string) =>
      hid === 'hs-routing-regression' ? sandboxToHostRecord() : null,
    )
    getSessionStateMock.mockReturnValue(null)
    isDcUpMock.mockReturnValue(false)
    requestCapsMock.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'unexpected_fetch' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
  })

  it('(1) Sandbox must not fetch local BEAP (ingest or policy) when ledger p2p_endpoint is this device MVP direct BEAP', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    resetP2pInferenceFlagsForTests()

    const fetchMock = vi.mocked(fetch)
    const consoleLines: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map(String).join(' '))
    })

    const { probeHostInferencePolicyFromSandbox } = await import('../sandboxHostUi')
    const r = await probeHostInferencePolicyFromSandbox('hs-routing-regression')

    logSpy.mockRestore()

    expect(r.ok).toBe(false)
    /** Regression: `policy_fallback_get` hits raw ledger URL (local BEAP) today. */
    expect(fetchMock).not.toHaveBeenCalled()
    /** After fix: surface peer Host BEAP missing without any `fetch` to local/policy URL. */
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
    const p2p = consoleLines.filter((l) => l.includes('[HOST_INFERENCE_P2P]'))
    expect(p2p.some((l) => l.includes('policy_fallback_get'))).toBe(false)
    expect(p2p.some((l) => l.includes(LOCAL_SANDBOX_MVP_DIRECT_BEAP))).toBe(false)
    expect(r.code).not.toBe(InternalInferenceErrorCode.PROBE_AUTH_REJECTED)
  })

  it('(2) direct_http_available must be false without any trust source (no BEAP attestation, no inference bearer trust)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    resetP2pInferenceFlagsForTests()

    const routeLog = await import('../hostAiRouteSelectLog')
    const spy = vi.spyOn(routeLog, 'logHostAiRouteSelect')

    getHandshakeRecordMock.mockImplementation((hid: string) =>
      hid === 'hs-routing-regression'
        ? sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL, counterparty_p2p_token: null })
        : null,
    )

    getSessionStateMock.mockReturnValue({
      handshakeId: 'hs-routing-regression',
      sessionId: null,
      phase: 'starting',
      p2pUiPhase: 'connecting',
      lastErrorCode: null,
      connectedAt: null,
      updatedAt: Date.now(),
      signalingExpiresAt: null,
      boundLocalDeviceId: 'dev-sand-coord-1',
      boundPeerDeviceId: 'dev-host-coord-1',
      offerStartRequested: false,
      offerCreateDispatched: false,
      observedPeerConnectionCreateBegin: false,
      observedCreateOfferBegin: false,
      p2pWebrtcLocalRole: 'offerer',
    } as any)

    const { listHostCapabilities } = await import('../transport/internalInferenceTransport')
    await listHostCapabilities('hs-routing-regression', {
      record: sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL, counterparty_p2p_token: null }),
      token: 'tok',
      timeoutMs: 5000,
    })

    const routeCalls = spy.mock.calls.map((c) => c[0])
    expect(routeCalls.length).toBeGreaterThan(0)
    for (const p of routeCalls) {
      expect(p.direct_http_available).toBe(false)
      expect(p.route_resolve_code).toBeTruthy()
      expect(p.route_resolve_reason).toBeTruthy()
    }
    spy.mockRestore()
  })

  it('(2b) transport decider must not select legacy_http without any trust source (no BEAP attestation, no inference bearer trust)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    resetP2pInferenceFlagsForTests()

    const { buildHostAiTransportDeciderInput, decideInternalInferenceTransport } = await import(
      '../transport/decideInternalInferenceTransport'
    )
    const { getP2pInferenceFlags } = await import('../p2pInferenceFlags')

    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: sandboxToHostRecord({
          p2p_endpoint: LEDGER_DIRECT_NON_LOCAL,
          counterparty_p2p_token: null,
        }),
        featureFlags: getP2pInferenceFlags(),
      }),
    )

    expect(dec.preferredTransport).not.toBe('legacy_http')
    expect(dec.selectorPhase).not.toBe('legacy_http_available')
  })

  it('(3) HTTP 403 with POLICY_FORBIDDEN / forbidden_host_role body must surface as typed terminal — not generic forbidden only', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    /** Otherwise `decideHostAiIntentRoute` waits on WebRTC for caps even when WebRTC is disabled. */
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
    /** Required with caps-over-P2P off: legacy DC_CAPABILITIES flag ORs in and keeps P2P caps preference. */
    vi.stubEnv('WRDESK_P2P_INFERENCE_DC_CAPABILITIES', '0')
    resetP2pInferenceFlagsForTests()

    setHostAdvertisedMvpDirectForTests('hs-routing-regression', LEDGER_DIRECT_NON_LOCAL, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'relay',
    })

    const body = JSON.stringify({ code: InternalInferenceErrorCode.POLICY_FORBIDDEN, message: 'forbidden_host_role' })
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } }),
      )

    const { listHostCapabilities } = await import('../transport/internalInferenceTransport')
    const cap = await listHostCapabilities('hs-routing-regression', {
      record: sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL }),
      token: 'tok',
      timeoutMs: 5000,
    })

    expect(cap.ok).toBe(false)
    if (!cap.ok) {
      /**
       * Regression: HTTP 403 handler returns string reason `forbidden` and ignores JSON
       * `{ code: POLICY_FORBIDDEN, message: forbidden_host_role }` (typed role/ownership terminal).
       */
      expect(cap.reason).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('(3a) HTTP 403 body with only message forbidden_host_role maps to POLICY_FORBIDDEN', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_DC_CAPABILITIES', '0')
    resetP2pInferenceFlagsForTests()

    setHostAdvertisedMvpDirectForTests('hs-routing-regression', LEDGER_DIRECT_NON_LOCAL, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'relay',
    })

    const body = JSON.stringify({ message: 'forbidden_host_role' })
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } }),
    )

    const { listHostCapabilities } = await import('../transport/internalInferenceTransport')
    const cap = await listHostCapabilities('hs-routing-regression', {
      record: sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL }),
      token: 'tok',
      timeoutMs: 5000,
    })

    expect(cap.ok).toBe(false)
    if (!cap.ok) {
      expect(cap.reason).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
  })

  it('(3b) probe: capability POST 403 role denial must not run policy_fallback_get (single fetch)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_DC_CAPABILITIES', '0')
    resetP2pInferenceFlagsForTests()

    setHostAdvertisedMvpDirectForTests('hs-routing-regression', LEDGER_DIRECT_NON_LOCAL, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'relay',
    })

    const body = JSON.stringify({ code: InternalInferenceErrorCode.POLICY_FORBIDDEN, message: 'forbidden_host_role' })
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValue(
        new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } }),
      )

    getHandshakeRecordMock.mockImplementation((hid: string) =>
      hid === 'hs-routing-regression'
        ? sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL })
        : null,
    )

    const { probeHostInferencePolicyFromSandbox } = await import('../sandboxHostUi')
    const r = await probeHostInferencePolicyFromSandbox('hs-routing-regression')

    expect(r.ok).toBe(false)
    expect(r.code).not.toBe(InternalInferenceErrorCode.PROBE_AUTH_REJECTED)
    expect(fetchMock.mock.calls.length).toBe(1)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => u.includes('/beap/ingest'))).toBe(true)
    expect(urls.some((u) => u.includes('internal-inference-policy'))).toBe(false)
  })

  it('(4) When capability POST cannot resolve verified Host-owned endpoint, policy GET must be skipped', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
    resetP2pInferenceFlagsForTests()

    const fetchMock = vi.mocked(fetch)

    const { probeHostInferencePolicyFromSandbox } = await import('../sandboxHostUi')
    const r = await probeHostInferencePolicyFromSandbox('hs-routing-regression')

    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
  })

  it('(5) DC non-role failure + HTTP fallback must not POST ingest when only ledger direct exists (no peer advertisement)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()

    getHandshakeRecordMock.mockImplementation((hid: string) =>
      hid === 'hs-routing-regression'
        ? sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL })
        : null,
    )

    getSessionStateMock.mockReturnValue({
      handshakeId: 'hs-routing-regression',
      sessionId: 'sess-dc-fallback',
      phase: 'ready',
      p2pUiPhase: 'ready',
      lastErrorCode: null,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
      signalingExpiresAt: null,
      boundLocalDeviceId: 'dev-sand-coord-1',
      boundPeerDeviceId: 'dev-host-coord-1',
      offerStartRequested: true,
      offerCreateDispatched: true,
      observedPeerConnectionCreateBegin: true,
      observedCreateOfferBegin: true,
      p2pWebrtcLocalRole: 'offerer',
    } as any)
    isDcUpMock.mockReturnValue(true)
    requestCapsMock.mockResolvedValue({ ok: false, reason: 'timeout', code: undefined })

    const fetchMock = vi.mocked(fetch)

    const { listHostCapabilities } = await import('../transport/internalInferenceTransport')
    await listHostCapabilities('hs-routing-regression', {
      record: sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL }),
      token: 'tok',
      timeoutMs: 5000,
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(5a) DC terminal identity code (e.g. POLICY_FORBIDDEN) must not invoke HTTP fallback (no ingest fetch)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()

    getHandshakeRecordMock.mockImplementation((hid: string) =>
      hid === 'hs-routing-regression'
        ? sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL })
        : null,
    )

    getSessionStateMock.mockReturnValue({
      handshakeId: 'hs-routing-regression',
      sessionId: 'sess-policy',
      phase: 'ready',
      p2pUiPhase: 'ready',
      lastErrorCode: null,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
      signalingExpiresAt: null,
      boundLocalDeviceId: 'dev-sand-coord-1',
      boundPeerDeviceId: 'dev-host-coord-1',
      offerStartRequested: true,
      offerCreateDispatched: true,
      observedPeerConnectionCreateBegin: true,
      observedCreateOfferBegin: true,
      p2pWebrtcLocalRole: 'offerer',
    } as any)
    isDcUpMock.mockReturnValue(true)
    requestCapsMock.mockResolvedValue({
      ok: false,
      reason: 'inference_error',
      code: InternalInferenceErrorCode.POLICY_FORBIDDEN,
    })

    const fetchMock = vi.mocked(fetch)

    const { listHostCapabilities } = await import('../transport/internalInferenceTransport')
    const out = await listHostCapabilities('hs-routing-regression', {
      record: sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL }),
      token: 'tok',
      timeoutMs: 5000,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(5b) DC capability role rejection must stay visible and must not invoke HTTP fallback (no ingest fetch)', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()

    getHandshakeRecordMock.mockImplementation((hid: string) =>
      hid === 'hs-routing-regression'
        ? sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL })
        : null,
    )

    getSessionStateMock.mockReturnValue({
      handshakeId: 'hs-routing-regression',
      sessionId: 'sess-role',
      phase: 'ready',
      p2pUiPhase: 'ready',
      lastErrorCode: null,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
      signalingExpiresAt: null,
      boundLocalDeviceId: 'dev-sand-coord-1',
      boundPeerDeviceId: 'dev-host-coord-1',
      offerStartRequested: true,
      offerCreateDispatched: true,
      observedPeerConnectionCreateBegin: true,
      observedCreateOfferBegin: true,
      p2pWebrtcLocalRole: 'offerer',
    } as any)
    isDcUpMock.mockReturnValue(true)
    requestCapsMock.mockResolvedValue({
      ok: false,
      reason: 'role',
      code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
    })

    const fetchMock = vi.mocked(fetch)

    const { listHostCapabilities } = await import('../transport/internalInferenceTransport')
    const out = await listHostCapabilities('hs-routing-regression', {
      record: sandboxToHostRecord({ p2p_endpoint: LEDGER_DIRECT_NON_LOCAL }),
      token: 'tok',
      timeoutMs: 5000,
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toBe(InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
