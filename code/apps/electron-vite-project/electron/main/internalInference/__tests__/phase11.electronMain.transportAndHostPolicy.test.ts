/**
 * Phase 11 — Electron main: transport decision, handshake policy, device binding.
 * Complements `internalInferenceTransport.decide.test.ts` and `hostInferenceCore.policy.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { stubP2pInferenceEnvLegacyHttpOnlyForTests } from './p2pInferenceFlagsTestSetup'
import { decideHostAiIntentRoute } from '../transport/transportDecide'
import { tryHandleInternalServiceP2P } from '../p2pServiceDispatch'
import { InternalInferenceErrorCode } from '../errors'
import { _resetHostInferencePolicyForTests } from '../hostInferencePolicyStore'
import { _resetHandshakeRateLimitForTests } from '../hostInferenceRequestRateLimit'
import { _resetPendingForTests } from '../pendingRequests'
import { _resetConcurrencyForTests } from '../hostInferenceConcurrency'
import { INTERNAL_INFERENCE_SCHEMA_VERSION } from '../types'

const { isHostModeMock, isSandboxModeMock, getInstanceIdMock, getHSMock } = vi.hoisted(() => ({
  isHostModeMock: vi.fn(() => true),
  isSandboxModeMock: vi.fn(() => false),
  getInstanceIdMock: vi.fn(() => 'dev-host-1'),
  getHSMock: vi.fn(),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => isHostModeMock(),
  isSandboxMode: () => isSandboxModeMock(),
  getInstanceId: () => getInstanceIdMock(),
  getOrchestratorMode: () => ({
    mode: 'host',
    deviceName: 'T',
    instanceId: 'dev-host-1',
    pairingCode: '000000',
    connectedPeers: [],
  }),
  setOrchestratorMode: vi.fn(),
  setDeviceName: vi.fn(),
  getDeviceName: () => 'T',
  getPairingCode: () => '000000',
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (...a: unknown[]) => getHSMock(...a),
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({ coordination_url: 'https://coord.test/' }),
}))

vi.mock('../hostInferenceCapabilities', () => ({
  buildInternalInferenceCapabilitiesResult: vi.fn(async () => ({
    type: 'internal_inference_capabilities_result',
    schema_version: 1,
    request_id: 'r1',
    handshake_id: 'hs-1',
    sender_device_id: 'dev-host-1',
    target_device_id: 'dev-sand-1',
    created_at: new Date().toISOString(),
    transport_policy: 'direct_only',
    host_computer_name: 'H',
    host_pairing_code: '123456',
    models: [],
    policy_enabled: true,
  })),
}))

vi.mock('electron', () => ({
  app: { getPath: () => 't', getAppPath: () => 't', isPackaged: true },
}))

import { getHandshakeRecord } from '../../handshake/db'

describe('Phase 11 — transport (flags)', () => {
  beforeEach(() => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  it('P2P flags off → http_direct (capabilities)', () => {
    const d = decideHostAiIntentRoute('hs', 'capabilities', true)
    expect(d.choice.selected).toBe('http_direct')
    expect(d.choice.reason).toBe('http_default')
  })

  it('request path: P2P preferred but DC not up → http only if HTTP fallback on', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '0')
    resetP2pInferenceFlagsForTests()
    const d = decideHostAiIntentRoute('hs', 'request', true)
    expect(d.choice.selected).toBe('unavailable')
    expect(d.choice.reason).toBe('p2p_not_ready_no_fallback')
  })

  it('request path: fallback on → http_direct when DC not up', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()
    const d = decideHostAiIntentRoute('hs', 'request', true)
    expect(d.choice.selected).toBe('http_direct')
    expect(d.choice.reason).toBe('p2p_not_ready_fallback_http')
  })
})

describe('Phase 11 — Host ingest policy', () => {
  beforeEach(() => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue('dev-host-1')
    getHSMock.mockReset()
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
    _resetPendingForTests()
    _resetConcurrencyForTests()
    _resetHandshakeRateLimitForTests()
  })

  function defaultRecord() {
    return {
      handshake_id: 'hs-1',
      relationship_id: 'rel-1',
      state: 'ACTIVE',
      initiator: { email: 'a@test.dev', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
      acceptor: { email: 'a@test.dev', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
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
      initiator_wrdesk_policy_hash: '',
      initiator_wrdesk_policy_version: '',
      acceptor_wrdesk_policy_hash: null,
      acceptor_wrdesk_policy_version: null,
      initiator_context_commitment: null,
      acceptor_context_commitment: null,
      p2p_endpoint: 'http://10.0.0.2:1/beap/ingest',
      local_p2p_auth_token: 'tok',
      counterparty_p2p_token: 'peer-tok',
      handshake_type: 'internal',
      internal_coordination_repair_needed: false,
      internal_coordination_identity_complete: true,
      initiator_device_name: 'H',
      acceptor_device_name: 'S',
      initiator_device_role: 'host',
      acceptor_device_role: 'sandbox',
      initiator_coordination_device_id: 'dev-host-1',
      acceptor_coordination_device_id: 'dev-sand-1',
    }
  }

  it('rejects internal_inference_request when sender_device_id is not the ledger peer', async () => {
    getHSMock.mockReturnValue(defaultRecord())
    const res: { status?: number } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: () => {},
    } as any
    const t = Date.now()
    await tryHandleInternalServiceP2P(
      {},
      {
        type: 'internal_inference_request',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: 'r1',
        handshake_id: 'hs-1',
        sender_device_id: 'wrong-sender',
        target_device_id: 'dev-host-1',
        created_at: new Date(t).toISOString(),
        expires_at: new Date(t + 60_000).toISOString(),
        messages: [{ role: 'user', content: 'x' }],
      },
      r,
    )
    expect(res.status).toBe(403)
  })

  it('internal_inference_cancel returns 200 JSON ack on Host (no Ollama)', async () => {
    getHSMock.mockReturnValue(defaultRecord())
    const res: { body?: string; status?: number } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    const t = Date.now()
    await tryHandleInternalServiceP2P(
      {},
      {
        type: 'internal_inference_cancel',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: 'r-cancel',
        handshake_id: 'hs-1',
        sender_device_id: 'dev-sand-1',
        target_device_id: 'dev-host-1',
        created_at: new Date(t).toISOString(),
      },
      r,
    )
    expect(res.status).toBe(200)
    const j = JSON.parse(res.body as string) as { internal_inference?: string }
    expect(j.internal_inference).toBe('cancel_ack')
  })

  it('Host inference capabilities: orchestrator `mode` hint (sandbox) does not reject; ledger+receiver host role is authoritative', async () => {
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getHSMock.mockReturnValue(defaultRecord())
    const res: { status?: number; body?: string } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    const t = Date.now()
    const handled = await tryHandleInternalServiceP2P(
      {},
      {
        type: 'internal_inference_capabilities_request',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: 'r1',
        handshake_id: 'hs-1',
        sender_device_id: 'dev-sand-1',
        target_device_id: 'dev-host-1',
        created_at: new Date(t).toISOString(),
      },
      r,
    )
    expect(handled).toBe(true)
    expect(res.status).toBe(200)
    const j = JSON.parse((res.body as string) || '{}') as { type: string }
    expect(j.type).toBe('internal_inference_capabilities_result')
  })
})
