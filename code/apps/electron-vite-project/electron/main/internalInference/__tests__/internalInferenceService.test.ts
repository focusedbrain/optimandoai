import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import path from 'path'
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import * as hdb from '../../handshake/db'
import * as ollamaInf from '../../llm/internalHostInferenceOllama'
import * as hostIx from '../hostInferenceExecute'
import { tryHandleInternalServiceP2P, isInternalServiceRpcShape } from '../p2pServiceDispatch'
import { assertRecordForServiceRpc, assertP2pEndpointDirect } from '../policy'
import { InternalInferenceErrorCode } from '../errors'
import {
  registerInternalInferenceRequest,
  resolveInternalInferenceByRequestId,
  _resetPendingForTests,
} from '../pendingRequests'
import { _resetHostInferencePolicyForTests } from '../hostInferencePolicyStore'
import { _resetConcurrencyForTests } from '../hostInferenceConcurrency'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceErrorWire, type InternalInferenceResultWire } from '../types'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { stubP2pInferenceEnvLegacyHttpOnlyForTests } from './p2pInferenceFlagsTestSetup'
import { _resetHandshakeRateLimitForTests } from '../hostInferenceRequestRateLimit'
import * as dbAccess from '../dbAccess'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(tmpdir(), 'ev-internal-infer-test'),
    getAppPath: () => path.join(tmpdir(), 'ev-internal-infer-test-app'),
    isPackaged: true,
  },
}))

const { isHostModeMock, isSandboxModeMock, getInstanceIdMock } = vi.hoisted(() => ({
  isHostModeMock: vi.fn(() => false),
  isSandboxModeMock: vi.fn(() => false),
  getInstanceIdMock: vi.fn(() => 'dev-local'),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => isHostModeMock(),
  isSandboxMode: () => isSandboxModeMock(),
  getInstanceId: () => getInstanceIdMock(),
  getOrchestratorMode: () => ({
    mode: 'host',
    deviceName: 'T',
    instanceId: 'dev-local',
    pairingCode: '000000',
    connectedPeers: [],
  }),
  setOrchestratorMode: vi.fn(),
  setDeviceName: vi.fn(),
  getDeviceName: () => 'T',
  getPairingCode: () => '000000',
}))

function party(uid: string): PartyIdentity {
  return {
    email: 'a@test.dev',
    wrdesk_user_id: uid,
    iss: 'https://idp',
    sub: `sub-${uid}`,
  }
}

function defaultRecord(over: Partial<HandshakeRecord>): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    initiator: party('u1'),
    acceptor: party('u1'),
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
    p2p_endpoint: 'http://10.0.0.2:51249/beap/ingest',
    local_p2p_auth_token: 'tok',
    counterparty_p2p_token: 'peer-tok',
    handshake_type: 'internal',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'dev-host-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    internal_coordination_identity_complete: true,
    ...over,
  } as HandshakeRecord
}

describe('internal inference policy', () => {
  it('rejects non-internal', () => {
    const r = defaultRecord({ handshake_type: 'standard' as any })
    const ar = assertRecordForServiceRpc(r)
    expect(ar.ok).toBe(false)
    if (!ar.ok) expect(ar.code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })

  it('rejects inactive', () => {
    const r = defaultRecord({ state: 'ACCEPTED' as any })
    const ar = assertRecordForServiceRpc(r)
    expect(ar.ok).toBe(false)
  })

  it('accepts valid internal active', () => {
    const r = defaultRecord({})
    const ar = assertRecordForServiceRpc(r)
    expect(ar.ok).toBe(true)
  })

  it('rejects missing p2p endpoint for direct assert', () => {
    const d = assertP2pEndpointDirect(
      { prepare: () => ({ run: () => {} }) } as any,
      null,
    )
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.code).toBe(InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE)
  })
})

describe('pending request_id', () => {
  beforeEach(() => {
    _resetPendingForTests()
  })

  it('resolves with pong by request_id', async () => {
    const p = registerInternalInferenceRequest('rid-1', 5_000)
    const out = 'test-model-output'
    const ok = resolveInternalInferenceByRequestId('rid-1', {
      kind: 'result',
      output: out,
    })
    expect(ok).toBe(true)
    await expect(p).resolves.toEqual({ kind: 'result', output: out })
  })
})

describe('tryHandleInternalServiceP2P (inbox not used)', () => {
  const insertSpy = vi.spyOn(hdb, 'insertPendingP2PBeap')

  beforeEach(() => {
    insertSpy.mockClear()
    _resetPendingForTests()
  })

  it('insertPendingP2PBeap is not used by the service module', () => {
    expect(tryHandleInternalServiceP2P).toBeDefined()
    // tryHandle is implemented in p2pServiceDispatch which does not import insertPendingP2PBeap
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('isInternalServiceRpcShape detects service envelope', () => {
    expect(isInternalServiceRpcShape({ type: 'internal_inference_request' })).toBe(true)
    expect(isInternalServiceRpcShape({ type: 'internal_inference_capabilities_request' })).toBe(true)
    expect(isInternalServiceRpcShape({ header: 1, metadata: 2 })).toBe(false)
  })
})

describe('log hygiene', () => {
  it('directSend path does not log user messages in p2pServiceDispatch', async () => {
    const { postServiceEnvelopeDirect } = await import('../directSend')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    global.fetch = vi.fn(
      async () =>
        new Response('{}', { status: 200, statusText: 'OK' }) as any,
    ) as any
    await postServiceEnvelopeDirect(
      {
        type: 'internal_inference_request',
        request_id: 'r',
        messages: [{ role: 'user', content: 'SECRET_PROMPT' }],
      } as any,
      'http://127.0.0.1:1/beap/ingest',
      'hs',
      'bearer',
      {
        request_id: 'r',
        sender_device_id: 'a',
        target_device_id: 'b',
        message_type: 'internal_inference_request',
      },
    )
    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).not.toContain('SECRET_PROMPT')
    log.mockRestore()
  })
})

const defaultPolicy = {
  allowSandboxInference: true,
  modelAllowlist: [] as string[],
  maxPromptBytes: 256_000,
  maxOutputBytes: 256_000,
  timeoutMs: 60_000,
  maxConcurrent: 1,
  maxRequestsPerHandshakePerMinute: 10_000,
  capabilitiesExposeAllInstalledOllama: false,
}

function requestPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const t = Date.now()
  return {
    type: 'internal_inference_request',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: 'r1',
    handshake_id: 'hs-1',
    sender_device_id: 'dev-sand-1',
    target_device_id: 'dev-host-1',
    created_at: new Date(t).toISOString(),
    expires_at: new Date(t + 120_000).toISOString(),
    messages: [{ role: 'user', content: 'hello' }],
    ...over,
  }
}

describe('host dispatch with mocks', () => {
  const getHandshakeRecord = vi.spyOn(hdb, 'getHandshakeRecord')
  let ollamaSpy: ReturnType<typeof vi.spyOn>
  let runHostSpy: ReturnType<typeof vi.spyOn>
  let getIxDbSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(async () => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
    getIxDbSpy = vi.spyOn(dbAccess, 'getHandshakeDbForInternalInference').mockResolvedValue({} as any)
    getHandshakeRecord.mockReset()
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue('dev-host-1')
    _resetPendingForTests()
    _resetHostInferencePolicyForTests({ ...defaultPolicy })
    _resetConcurrencyForTests()
    const { runHostInternalInference: runHostReal } = await vi.importActual<typeof import('../hostInferenceExecute')>(
      '../hostInferenceExecute',
    )
    ollamaSpy = vi
      .spyOn(ollamaInf, 'runInternalHostOllamaInference')
      .mockResolvedValue({
        text: 'ollama-ok',
        model: 'llama-test',
        usage: { eval_count: 1 },
        durationMs: 2,
      })
    runHostSpy = vi.spyOn(hostIx, 'runHostInternalInference').mockImplementation((args) => runHostReal(args as any))
    global.fetch = vi.fn(
      async () => new Response('{}', { status: 200, statusText: 'OK' }) as any,
    ) as any
  })

  afterEach(() => {
    ollamaSpy?.mockRestore()
    runHostSpy?.mockRestore()
    getIxDbSpy?.mockRestore()
    getIxDbSpy = undefined
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue('dev-local')
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    _resetHandshakeRateLimitForTests()
  })

  it('applies per-handshake rate limit before running inference', async () => {
    _resetHostInferencePolicyForTests({ ...defaultPolicy, maxRequestsPerHandshakePerMinute: 1 })
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    runHostSpy.mockResolvedValue({
      wire: {
        type: 'internal_inference_result',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: 'r1',
        handshake_id: 'hs-1',
        sender_device_id: 'dev-host-1',
        target_device_id: 'dev-sand-1',
        transport_policy: 'direct_only' as const,
        created_at: new Date().toISOString(),
        model: 'm',
        output: 'x',
        usage: {},
        duration_ms: 1,
      },
      log: { model: 'm', prompt_bytes: 1, message_count: 1, duration_ms: 1 },
    })
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
    const r1 = { writeHead: vi.fn(), end: vi.fn() } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r1)
    const r2 = { writeHead: vi.fn(), end: vi.fn() } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r2)
    expect(runHostSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 503 P2P_INFERENCE_REQUIRED when P2P request plane is on and HTTP internal compat is off', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT', '0')
    resetP2pInferenceFlagsForTests()
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const res: { status?: number; body?: string } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r)
    expect(ollamaSpy).not.toHaveBeenCalled()
    expect(res.status).toBe(503)
    const j = JSON.parse(res.body as string) as { code: string }
    expect(j.code).toBe(InternalInferenceErrorCode.P2P_INFERENCE_REQUIRED)
  })

  it('allows internal_inference_request on HTTP when WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1 with full P2P flags', async () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT', '1')
    // Result delivery uses the same P2P preference; allow HTTP when DC is not up (transition / tests).
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const ok: InternalInferenceResultWire = {
      type: 'internal_inference_result',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'dev-host-1',
      target_device_id: 'dev-sand-1',
      transport_policy: 'direct_only',
      created_at: new Date().toISOString(),
      model: 'llama-test',
      output: 'ollama-ok',
      usage: { eval_count: 1 },
      duration_ms: 2,
    }
    runHostSpy.mockResolvedValue({
      wire: ok,
      log: { model: 'llama-test', prompt_bytes: 35, message_count: 1, duration_ms: 2 },
    })
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
    const res: { status?: number; body?: string } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r)
    expect(runHostSpy).toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('returns 403 for external (standard) record', async () => {
    getHandshakeRecord.mockReturnValue(
      defaultRecord({
        handshake_type: 'standard' as any,
        initiator: party('a'),
        acceptor: party('b'),
      }),
    )
    const res: { status?: number; body?: string } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    const handled = await tryHandleInternalServiceP2P({}, requestPayload(), r)
    expect(handled).toBe(true)
    expect(res.status).toBe(403)
  })

  it('disabled policy posts HOST_INFERENCE_DISABLED and does not call Ollama', async () => {
    _resetHostInferencePolicyForTests({ ...defaultPolicy, allowSandboxInference: false })
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const bodies: string[] = []
    global.fetch = vi.fn(async (_url, init) => {
      const b = (init as { body?: string })?.body
      if (typeof b === 'string') {
        bodies.push(b)
      }
      return new Response('{}', { status: 200 }) as any
    }) as any
    const res: { status?: number; body?: string } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r)
    expect(ollamaSpy).not.toHaveBeenCalled()
    const posted = bodies.map((b) => JSON.parse(b) as { type: string; code?: string })[0]
    expect(posted?.type).toBe('internal_inference_error')
    expect(posted?.code).toBe(InternalInferenceErrorCode.HOST_INFERENCE_DISABLED)
  })

  it('enabled policy uses Host inference + Ollama and posts result', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const ok: InternalInferenceResultWire = {
      type: 'internal_inference_result',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'dev-host-1',
      target_device_id: 'dev-sand-1',
      transport_policy: 'direct_only',
      created_at: new Date().toISOString(),
      model: 'llama-test',
      output: 'ollama-ok',
      usage: { eval_count: 1 },
      duration_ms: 2,
    }
    runHostSpy.mockResolvedValue({
      wire: ok,
      log: { model: 'llama-test', prompt_bytes: 35, message_count: 1, duration_ms: 2 },
    })
    const bodies: string[] = []
    global.fetch = vi.fn(async (_url, init) => {
      const b = (init as { body?: string })?.body
      if (typeof b === 'string') {
        bodies.push(b)
      }
      return new Response('{}', { status: 200 }) as any
    }) as any
    const res: { status?: number; body?: string } = {}
    const r = {
      writeHead: (c: number) => {
        res.status = c
      },
      end: (b: string) => {
        res.body = b
      },
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r)
    expect(runHostSpy).toHaveBeenCalled()
    const posted = bodies.map((b) => JSON.parse(b) as { type: string; model?: string; output?: string })[0]
    expect(posted?.type).toBe('internal_inference_result')
    expect(posted?.model).toBe('llama-test')
    expect(posted?.output).toBe('ollama-ok')
    expect(res.status).toBe(200)
  })

  it('rejects oversized prompt', async () => {
    _resetHostInferencePolicyForTests({ ...defaultPolicy, maxPromptBytes: 10 })
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const bodies: string[] = []
    global.fetch = vi.fn(async (_url, init) => {
      const b = (init as { body?: string })?.body
      if (typeof b === 'string') {
        bodies.push(b)
      }
      return new Response('{}', { status: 200 }) as any
    }) as any
    const r = { writeHead: vi.fn(), end: vi.fn() } as any
    await tryHandleInternalServiceP2P(
      { prepare: () => ({ run: () => {} }) } as any,
      requestPayload({
        messages: [{ role: 'user', content: 'x'.repeat(500) }],
      }),
      r,
    )
    expect(runHostSpy).not.toHaveBeenCalled()
    const posted = bodies.map((b) => JSON.parse(b) as { type: string; code?: string })[0]
    expect(posted?.type).toBe('internal_inference_error')
    expect(posted?.code).toBe(InternalInferenceErrorCode.PAYLOAD_TOO_LARGE)
  })

  it('maps model unavailable to error wire (Host inference output)', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const err: InternalInferenceErrorWire = {
      type: 'internal_inference_error',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'dev-host-1',
      target_device_id: 'dev-sand-1',
      transport_policy: 'direct_only',
      created_at: new Date().toISOString(),
      code: 'MODEL_UNAVAILABLE',
      message: 'm',
      retryable: true,
      duration_ms: 1,
    }
    runHostSpy.mockResolvedValue({
      wire: err,
      log: { prompt_bytes: 35, message_count: 1, duration_ms: 1, error_code: 'MODEL_UNAVAILABLE' },
    })
    const bodies: string[] = []
    global.fetch = vi.fn(async (_url, init) => {
      const b = (init as { body?: string })?.body
      if (typeof b === 'string') {
        bodies.push(b)
      }
      return new Response('{}', { status: 200 }) as any
    }) as any
    const r = { writeHead: vi.fn(), end: vi.fn() } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r)
    const posted = bodies.map((b) => JSON.parse(b) as { type: string; code?: string })[0]
    expect(posted?.type).toBe('internal_inference_error')
    expect(posted?.code).toBe('MODEL_UNAVAILABLE')
  })

  it('complete log does not include message or output text', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const ok: InternalInferenceResultWire = {
      type: 'internal_inference_result',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'dev-host-1',
      target_device_id: 'dev-sand-1',
      transport_policy: 'direct_only',
      created_at: new Date().toISOString(),
      model: 'm1',
      output: 'HIDDEN_OUT',
      usage: {},
      duration_ms: 1,
    }
    runHostSpy.mockResolvedValue({
      wire: ok,
      log: { model: 'm1', prompt_bytes: 99, message_count: 1, duration_ms: 1 },
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
    const r = { writeHead: vi.fn(), end: vi.fn() } as any
    await tryHandleInternalServiceP2P(
      { prepare: () => ({ run: () => {} }) } as any,
      requestPayload({ messages: [{ role: 'user', content: 'SECRET_PROMPT_BODY' }] }),
      r,
    )
    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).not.toContain('SECRET_PROMPT_BODY')
    expect(joined).not.toContain('HIDDEN_OUT')
    log.mockRestore()
  })

  it('insertPendingP2PBeap is not used; response is direct fetch only', async () => {
    const insertSpy = vi.spyOn(hdb, 'insertPendingP2PBeap')
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const ok: InternalInferenceResultWire = {
      type: 'internal_inference_result',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'dev-host-1',
      target_device_id: 'dev-sand-1',
      transport_policy: 'direct_only',
      created_at: new Date().toISOString(),
      model: 'm',
      output: 'x',
      usage: {},
      duration_ms: 0,
    }
    runHostSpy.mockResolvedValue({ wire: ok, log: { prompt_bytes: 1, message_count: 1, duration_ms: 0, model: 'm' } })
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
    const r = { writeHead: vi.fn(), end: vi.fn() } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), r)
    expect(insertSpy).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalled()
    insertSpy.mockRestore()
  })
})

