/**
 * Regression: direct Host inference over internal handshake (transport, isolation, auth, privacy, UI gates).
 * Complements `internalInferenceService.test.ts` with cross-cutting requirements.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import * as hdb from '../../handshake/db'
import { InternalInferenceErrorCode } from '../errors'
import {
  tryHandleInternalServiceP2P,
  isInternalServiceRpcShape,
} from '../p2pServiceDispatch'
import { postServiceEnvelopeDirect } from '../directSend'
import {
  INTERNAL_INFERENCE_SCHEMA_VERSION,
  type InternalInferenceResultWire,
} from '../types'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { stubP2pInferenceEnvLegacyHttpOnlyForTests } from './p2pInferenceFlagsTestSetup'
import { _resetPendingForTests, registerInternalInferenceRequest } from '../pendingRequests'
import { _resetHostInferencePolicyForTests } from '../hostInferencePolicyStore'
import { _resetConcurrencyForTests } from '../hostInferenceConcurrency'
import * as dbAccess from '../dbAccess'
import * as hostIx from '../hostInferenceExecute'
import * as ollamaInf from '../../llm/internalHostInferenceOllama'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const internalInfDir = join(__dirname, '..')

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

vi.mock('electron', () => ({
  app: {
    getPath: () => join(process.cwd(), 'tmp-ev-regression'),
    getAppPath: () => process.cwd(),
  },
}))

function party(uid: string): PartyIdentity {
  return {
    email: 'a@test.dev',
    wrdesk_user_id: uid,
    iss: 'https://idp',
    sub: `sub-${uid}`,
  }
}

function defaultRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
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

const defaultPolicy = {
  allowSandboxInference: true,
  maxOutputBytes: 256_000,
  maxRequestsPerHandshakePerMinute: 10_000,
  modelAllowlist: [] as string[],
  maxPromptBytes: 256_000,
  timeoutMs: 60_000,
  maxConcurrent: 1,
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

function resultPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const t = Date.now()
  return {
    type: 'internal_inference_result',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: 'r2',
    handshake_id: 'hs-1',
    sender_device_id: 'dev-host-1',
    target_device_id: 'dev-sand-1',
    created_at: new Date(t).toISOString(),
    output: 'out',
    model: 'm',
    duration_ms: 1,
    ...over,
  }
}

// ── 1. Transport & module invariants ─────────────────────────────

describe('direct Host inference — transport invariants', () => {
  it('postServiceEnvelopeDirect does not import coordination relay', () => {
    const src = readFileSync(join(internalInfDir, 'directSend.ts'), 'utf8')
    expect(src).not.toContain('sendCapsuleViaCoordination')
    expect(src).not.toContain('outboundQueue')
  })

  it('sandboxHostChat uses internal inference transport (no coordination)', () => {
    const src = readFileSync(join(internalInfDir, 'sandboxHostChat.ts'), 'utf8')
    expect(src).not.toContain('sendCapsuleViaCoordination')
    expect(src).toContain('requestHostCompletion')
  })

  it('POST targets peer p2p_endpoint (ingest) with JSON body and Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }) as any)
    globalThis.fetch = fetchMock as any
    await postServiceEnvelopeDirect(
      { type: 'internal_inference_request', x: 1 } as any,
      'http://192.168.1.2:9/beap/ingest',
      'hs-99',
      'bear',
      {
        request_id: 'rid',
        sender_device_id: 'a',
        target_device_id: 'b',
        message_type: 'internal_inference_request',
      },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://192.168.1.2:9/beap/ingest')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer /)
    const corr = (init?.headers as Record<string, string>)['X-Correlation-Id']
    expect(typeof corr).toBe('string')
    expect(corr!.length).toBeGreaterThan(8)
  })

  it('HTTP 202 Accepted is not treated as success (direct-only MVP)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202, statusText: 'Accepted' }) as any)
    globalThis.fetch = fetchMock as any
    const r = await postServiceEnvelopeDirect(
      { type: 'internal_inference_request' } as any,
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
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE)
    }
  })
})

// ── 2. Inbox / pending isolation (service RPC) ─────────────────────

describe('direct Host inference — inbox isolation', () => {
  const getHandshakeRecord = vi.spyOn(hdb, 'getHandshakeRecord')
  const insertPending = vi.spyOn(hdb, 'insertPendingP2PBeap')
  let runHostSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
    getHandshakeRecord.mockReset()
    insertPending.mockClear()
    _resetPendingForTests()
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue('dev-host-1')
    _resetHostInferencePolicyForTests({ ...defaultPolicy })
    _resetConcurrencyForTests()
    const { runHostInternalInference: runHostReal } = await vi.importActual<typeof import('../hostInferenceExecute')>(
      '../hostInferenceExecute',
    )
    vi.spyOn(ollamaInf, 'runInternalHostOllamaInference').mockResolvedValue({
      text: 'x',
      model: 'm',
      usage: {},
      durationMs: 0,
    })
    runHostSpy = vi.spyOn(hostIx, 'runHostInternalInference').mockImplementation((a) => runHostReal(a as any))
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    runHostSpy?.mockRestore()
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(false)
  })

  it('internal_inference_request handling never enqueues p2p_pending_beap', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const ins: InternalInferenceResultWire = {
      type: 'internal_inference_result',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'dev-host-1',
      target_device_id: 'dev-sand-1',
      transport_policy: 'direct_only',
      created_at: new Date().toISOString(),
      model: 'm',
      output: 'ok',
      usage: {},
      duration_ms: 0,
    }
    runHostSpy.mockResolvedValue({ wire: ins, log: { model: 'm', prompt_bytes: 1, message_count: 1, duration_ms: 0 } })
    const r = { writeHead: vi.fn(), end: vi.fn() } as any
    const handled = await tryHandleInternalServiceP2P(
      { prepare: () => ({ run: () => {} }) } as any,
      requestPayload(),
      r,
    )
    expect(handled).toBe(true)
    expect(insertPending).not.toHaveBeenCalled()
  })
})

// ── 3. Authorization (Host inbound) ─────────────────────────────

describe('direct Host inference — authorization (Host inbound)', () => {
  const getHandshakeRecord = vi.spyOn(hdb, 'getHandshakeRecord')
  const insertPending = vi.spyOn(hdb, 'insertPendingP2PBeap')
  let runHostSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
    getHandshakeRecord.mockReset()
    insertPending.mockClear()
    _resetPendingForTests()
    isHostModeMock.mockReturnValue(true)
    isSandboxModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue('dev-host-1')
    _resetHostInferencePolicyForTests({ ...defaultPolicy })
    _resetConcurrencyForTests()
    const { runHostInternalInference: runHostReal } = await vi.importActual<typeof import('../hostInferenceExecute')>(
      '../hostInferenceExecute',
    )
    vi.spyOn(ollamaInf, 'runInternalHostOllamaInference').mockResolvedValue({
      text: 'x',
      model: 'm',
      usage: {},
      durationMs: 0,
    })
    runHostSpy = vi.spyOn(hostIx, 'runHostInternalInference').mockImplementation((a) => runHostReal(a as any))
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    runHostSpy?.mockRestore()
    isHostModeMock.mockReturnValue(false)
  })

  it('rejects external (non-internal) handshake', async () => {
    getHandshakeRecord.mockReturnValue(
      defaultRecord({ handshake_type: 'standard' as any, initiator: party('a'), acceptor: party('b') }),
    )
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P({}, requestPayload(), res)
    expect(r.status).toBe(403)
  })

  it('rejects inactive internal handshake', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({ state: 'ACCEPTED' as any }))
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), res)
    expect(r.status).toBe(403)
  })

  it('rejects wrong Sandbox sender (coordination id mismatch)', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P(
      { prepare: () => ({ run: () => {} }) } as any,
      requestPayload({ sender_device_id: 'wrong-sandbox' }),
      res,
    )
    expect(r.status).toBe(403)
  })

  it('rejects when target_device_id is not this Host', async () => {
    getHandshakeRecord.mockReturnValue(defaultRecord({}))
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P(
      { prepare: () => ({ run: () => {} }) } as any,
      requestPayload({ target_device_id: 'not-the-host' }),
      res,
    )
    expect(r.status).toBe(403)
  })

  it('rejects cross-principal internal-looking row (different users)', async () => {
    getHandshakeRecord.mockReturnValue(
      defaultRecord({
        initiator: party('a'),
        acceptor: party('b'),
      }),
    )
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), res)
    expect(r.status).toBe(403)
  })
})

// ── Sandbox-inbound: result wire ───────────────────────────────────

describe('direct Host inference — authorization (Sandbox inbound result)', () => {
  const getHandshakeRecord = vi.spyOn(hdb, 'getHandshakeRecord')

  beforeEach(() => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
    getHandshakeRecord.mockReset()
    _resetPendingForTests()
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getInstanceIdMock.mockReturnValue('dev-sand-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(false)
  })

  it('rejects internal_inference_result when not Sandbox mode', async () => {
    isSandboxModeMock.mockReturnValue(false)
    isHostModeMock.mockReturnValue(true)
    getHandshakeRecord.mockReturnValue(
      defaultRecord({ local_role: 'acceptor', acceptor_device_role: 'sandbox', initiator_device_role: 'host' }),
    )
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, resultPayload(), res)
    expect(r.status).toBe(400)
  })

  it('internal_inference_request on Sandbox is not served (no Host on Sandbox)', async () => {
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    getHandshakeRecord.mockReturnValue(
      defaultRecord({ local_role: 'initiator', initiator_device_role: 'sandbox', acceptor_device_role: 'host' }),
    )
    const r: { status?: number } = {}
    const res = {
      writeHead: (c: number) => {
        r.status = c
      },
      end: () => {},
    } as any
    await tryHandleInternalServiceP2P({ prepare: () => ({ run: () => {} }) } as any, requestPayload(), res)
    expect(r.status).toBe(403)
  })
})

// ── 4. Privacy (logging) ───────────────────────────────────────────

describe('direct Host inference — log hygiene', () => {
  it('postServiceEnvelopeDirect does not log RELAY-POST full body pattern', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 }) as any) as any
    await postServiceEnvelopeDirect(
      { type: 'internal_inference_request', messages: [{ role: 'user', content: 'SECRET' }] } as any,
      'http://127.0.0.1:1/beap/ingest',
      'hs',
      'b',
      {
        request_id: 'r',
        sender_device_id: 'a',
        target_device_id: 'b',
        message_type: 'internal_inference_request',
      },
    )
    const joined = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(joined).not.toContain('SECRET')
    expect(joined).not.toMatch(/RELAY-POST.*Body:/i)
    log.mockRestore()
  })
})

// ── 5. runSandboxHostInferenceChat (entry) ──────────────────────────

describe('runSandboxHostInferenceChat (Sandbox entry)', () => {
  let ghr: ReturnType<typeof vi.spyOn>
  let dbGet: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ghr = vi.spyOn(hdb, 'getHandshakeRecord')
    dbGet = vi.spyOn(dbAccess, 'getHandshakeDbForInternalInference').mockResolvedValue({} as any)
    isSandboxModeMock.mockReturnValue(true)
    isHostModeMock.mockReturnValue(false)
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    globalThis.fetch = vi.fn() as any
  })

  afterEach(() => {
    ghr.mockRestore()
    dbGet.mockRestore()
    isSandboxModeMock.mockReturnValue(false)
  })

  it('returns HOST_DIRECT_P2P_UNAVAILABLE when p2p_endpoint is missing (direct only)', async () => {
    ghr.mockReturnValue(
      defaultRecord({
        local_role: 'initiator',
        initiator_device_role: 'sandbox',
        acceptor_device_role: 'host',
        initiator_coordination_device_id: 'dev-sand-1',
        acceptor_coordination_device_id: 'dev-host-1',
        p2p_endpoint: null as any,
      }) as any,
    )
    const { runSandboxHostInferenceChat } = await import('../sandboxHostChat')
    const r = await runSandboxHostInferenceChat({
      handshakeId: 'hs-1',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE)
    }
  })

  it('Host mode cannot use Sandbox host-chat entry point', async () => {
    isSandboxModeMock.mockReturnValue(false)
    isHostModeMock.mockReturnValue(true)
    ghr.mockReturnValue(defaultRecord({}) as any)
    const { runSandboxHostInferenceChat } = await import('../sandboxHostChat')
    const r = await runSandboxHostInferenceChat({
      handshakeId: 'hs-1',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.INVALID_INTERNAL_ROLE)
    }
    isSandboxModeMock.mockReturnValue(true)
    isHostModeMock.mockReturnValue(false)
  })

  it('stale or unavailable DB: no ledger returns no-active handshake / no db', async () => {
    dbGet.mockImplementationOnce(() => Promise.resolve(null))
    const { runSandboxHostInferenceChat } = await import('../sandboxHostChat')
    const r = await runSandboxHostInferenceChat({
      handshakeId: 'hs-1',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE)
    }
  })
})

// ── 6. Service shape vs qBEAP inbox ──────────────────────────────────

describe('internal inference service vs qBEAP inbox path', () => {
  it('isInternalServiceRpcShape is disjoint from isBeapMessagePackage shape in p2pServer', () => {
    const beapMsg = { header: {}, metadata: {} }
    expect(isInternalServiceRpcShape(beapMsg)).toBe(false)
    expect(isInternalServiceRpcShape({ type: 'internal_inference_request' })).toBe(true)
    expect(isInternalServiceRpcShape({ type: 'internal_inference_capabilities_request' })).toBe(true)
  })
})

// ── 6b. Dual transport paths (normal BEAP vs internal inference) ──

describe('existing app behavior — transport modules coexist', () => {
  it('coordination/relay path remains in p2pTransport; direct inference is internalInference/directSend', async () => {
    const p2p = await import('../../handshake/p2pTransport')
    const { postServiceEnvelopeDirect: postDirect } = await import('../directSend')
    expect(p2p.sendCapsuleViaCoordination).toBeTypeOf('function')
    expect(postDirect).toBeTypeOf('function')
  })
})

// ── 7. Result callback resolves pending (no DB inbox row) ─────────

describe('Sandbox receives internal_inference_result (pending only)', () => {
  const getHandshakeRecord = vi.spyOn(hdb, 'getHandshakeRecord')

  beforeEach(() => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
    getHandshakeRecord.mockReset()
    _resetPendingForTests()
    isHostModeMock.mockReturnValue(false)
    isSandboxModeMock.mockReturnValue(true)
    getInstanceIdMock.mockReturnValue('dev-sand-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    isSandboxModeMock.mockReturnValue(false)
  })

  it('resolves registerInternalInferenceRequest without inbox insert', async () => {
    getHandshakeRecord.mockReturnValue(
      defaultRecord({
        local_role: 'acceptor',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_coordination_device_id: 'dev-host-1',
        acceptor_coordination_device_id: 'dev-sand-1',
      }),
    )
    const p = registerInternalInferenceRequest('r-x', 10_000)
    const insertSpy = vi.spyOn(hdb, 'insertPendingP2PBeap')
    const r = { writeHead: vi.fn(), end: vi.fn() } as any
    const handled = await tryHandleInternalServiceP2P(
      { prepare: () => ({ run: () => {} }) } as any,
      resultPayload({ request_id: 'r-x', output: 'done', sender_device_id: 'dev-host-1' }),
      r,
    )
    expect(handled).toBe(true)
    const done = await Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))])
    expect((done as any).kind).toBe('result')
    expect((done as any).output).toBe('done')
    expect(insertSpy).not.toHaveBeenCalled()
    insertSpy.mockRestore()
  })
})
