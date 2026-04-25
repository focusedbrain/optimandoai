import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { HandshakeRecord, PartyIdentity } from '../../handshake/types'
import {
  reachabilityUrlFromP2pIngest,
  classifyDirectP2pReachabilityError,
  checkDirectP2pReachabilityFromHandshake,
  DIRECT_P2P_REACHABILITY_PATH,
} from '../directP2pReachability'

const { isSandboxModeMock, isHostModeMock } = vi.hoisted(() => ({
  isSandboxModeMock: vi.fn(() => true),
  isHostModeMock: vi.fn(() => false),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => isHostModeMock(),
  isSandboxMode: () => isSandboxModeMock(),
}))

const getHandshakeRecordMock = vi.fn<(_db: any, id: string) => HandshakeRecord | null>()

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: any, id: string) => getHandshakeRecordMock(_db, id),
  listHandshakeRecords: () => [],
}))

const getHandshakeDbForInternalInferenceMock = vi.fn<() => Promise<any>>()
vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: () => getHandshakeDbForInternalInferenceMock(),
}))

function party(uid: string): PartyIdentity {
  return {
    email: 'a@test.dev',
    wrdesk_user_id: uid,
    iss: 'https://idp',
    sub: `sub-${uid}`,
  }
}

function sandboxToHostRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-r1',
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
    counterparty_p2p_token: 'secrettok',
    handshake_type: 'internal',
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    acceptor_device_name: 'Workstation',
    initiator_device_name: 'Laptop',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
    internal_peer_pairing_code: '482917',
    internal_coordination_identity_complete: true,
    ...over,
  } as HandshakeRecord
}

describe('reachabilityUrlFromP2pIngest', () => {
  it('maps ingest url to p2p-reachability path', () => {
    expect(reachabilityUrlFromP2pIngest('http://192.168.0.1:9/beap/ingest')).toBe(
      `http://192.168.0.1:9${DIRECT_P2P_REACHABILITY_PATH}`,
    )
  })
})

describe('classifyDirectP2pReachabilityError', () => {
  it('treats TLS-like messages as tls_error', () => {
    const c = classifyDirectP2pReachabilityError(new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE'))
    expect(c).toEqual({ status: 'tls_error' })
  })
})

describe('checkDirectP2pReachabilityFromHandshake', () => {
  beforeEach(() => {
    isSandboxModeMock.mockReturnValue(true)
    isHostModeMock.mockReturnValue(false)
    getHandshakeDbForInternalInferenceMock.mockResolvedValue({})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    getHandshakeRecordMock.mockReset()
    getHandshakeDbForInternalInferenceMock.mockReset()
  })

  it('missing direct endpoint (empty p2p) → missing_endpoint', async () => {
    getHandshakeRecordMock.mockReturnValue(
      sandboxToHostRecord({ p2p_endpoint: '', counterparty_p2p_token: 't' }) as any,
    )
    const r = await checkDirectP2pReachabilityFromHandshake('hs-r1', { timeoutMs: 2000, fetchImpl: vi.fn() as any })
    expect(r.status).toBe('missing_endpoint')
  })

  it('reachable: GET 200, no request body in fetch', async () => {
    getHandshakeRecordMock.mockReturnValue(sandboxToHostRecord() as any)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    const r = await checkDirectP2pReachabilityFromHandshake('hs-r1', { timeoutMs: 3000, fetchImpl: fetchImpl as any })
    expect(r.status).toBe('reachable')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(reachabilityUrlFromP2pIngest('http://10.0.0.2:51249/beap/ingest'))
    expect(init?.method).toBe('GET')
    const body = (init as { body?: unknown } | undefined)?.body
    expect(body == null || body === undefined, 'reachability fetch must not send a body').toBe(true)
  })

  it('auth failure → auth_failed', async () => {
    getHandshakeRecordMock.mockReturnValue(sandboxToHostRecord() as any)
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const r = await checkDirectP2pReachabilityFromHandshake('hs-r1', { timeoutMs: 3000, fetchImpl: fetchImpl as any })
    expect(r.status).toBe('auth_failed')
  })

  it('timeout → timeout', async () => {
    getHandshakeRecordMock.mockReturnValue(sandboxToHostRecord() as any)
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_res, rej) => {
        const signal = (init as { signal?: AbortSignal })?.signal
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              rej(e)
            },
            { once: true },
          )
        }
      })
    })
    const r = await checkDirectP2pReachabilityFromHandshake('hs-r1', { timeoutMs: 20, fetchImpl: fetchImpl as any })
    expect(r.status).toBe('timeout')
  })
})
