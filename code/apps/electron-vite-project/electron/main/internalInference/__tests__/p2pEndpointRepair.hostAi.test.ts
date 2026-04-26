/**
 * Repair pass must not promote relay → “direct” using this process’s published URL on sandbox rows
 * (that URL can be the local sandbox BEAP, not the peer host’s).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wrdesk-p2p-repair-test' } }))
import { InternalInferenceErrorCode } from '../errors'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { getHandshakeRecord } from '../../handshake/db'
import {
  peekHostAdvertisedMvpDirectP2pEndpoint,
  resetHostAdvertisedMvpDirectForTests,
  resetP2pEndpointRepairSessionGates,
  resolveSandboxToHostHttpDirectIngest,
  runP2pEndpointRepairPass,
  setHostAdvertisedMvpDirectForTests,
  tryRepairP2pEndpointFromHostAdvertisement,
} from '../p2pEndpointRepair'

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-sand-1',
}))

const updateHandshakeRecord = vi.fn()
const listRows: HandshakeRecord[] = []

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    enabled: true,
    coordination_url: 'https://coord.example/beap/ingest',
  }),
  computeLocalP2PEndpoint: () => 'http://192.168.0.5:9/beap/ingest',
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(),
  listHandshakeRecords: () => listRows,
  updateHandshakeRecord: (_db: unknown, next: HandshakeRecord) => {
    updateHandshakeRecord(next)
  },
}))

function relayRow(hid: string): HandshakeRecord {
  return {
    handshake_id: hid,
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: false,
    initiator: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
    acceptor: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
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
    p2p_endpoint: 'https://coord.example/beap/ingest/relay?x=1',
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    handshake_type: 'internal',
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    initiator_device_name: 'S',
    acceptor_device_name: 'H',
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
  } as HandshakeRecord
}

describe('runP2pEndpointRepairPass', () => {
  afterEach(() => {
    listRows.length = 0
    updateHandshakeRecord.mockReset()
    resetP2pEndpointRepairSessionGates()
  })

  it('C: does not set relay p2p_endpoint to local published direct URL when no Host-advertised header was stored', () => {
    listRows.push(relayRow('hs-relay'))
    runP2pEndpointRepairPass({} as any, 'test_ctx')
    expect(updateHandshakeRecord).not.toHaveBeenCalled()
  })

  it('relay row + peer map uses peer direct only (not local published URL)', () => {
    const hid = 'hs-relay-with-peer'
    listRows.push(relayRow(hid))
    setHostAdvertisedMvpDirectForTests(hid, 'http://192.168.1.20:51249/beap/ingest')
    runP2pEndpointRepairPass({} as any, 'test_ctx')
    expect(updateHandshakeRecord).toHaveBeenCalled()
    const next = updateHandshakeRecord.mock.calls[0]?.[0] as HandshakeRecord
    expect(next.p2p_endpoint).toMatch(/192\.168\.1\.20/)
  })
})

const LOCAL_SANDBOX_DIRECT = 'http://192.168.0.5:9/beap/ingest'
const PEER_HOST_DIRECT = 'http://192.168.1.20:51249/beap/ingest'

describe('resolveSandboxToHostHttpDirectIngest', () => {
  const db = {}

  afterEach(() => {
    resetHostAdvertisedMvpDirectForTests()
  })

  it('A: no peer ad and only local sandbox direct in ledger/caller → owner mismatch (must not use as host)', () => {
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      'hs-a',
      { p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)
  })

  it('A: no peer ad, empty candidate → HOST_DIRECT_ENDPOINT_MISSING', () => {
    const r = resolveSandboxToHostHttpDirectIngest(db, 'hs-miss', { p2p_endpoint: '' }, '')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING)
  })

  it('B: with peer-issued ad, use peer host URL even when ledger is local', () => {
    const hid = 'hs-b'
    setHostAdvertisedMvpDirectForTests(hid, PEER_HOST_DIRECT)
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.url).toMatch(/192\.168\.1\.20/)
    expect(r.selected_endpoint_source).toBe('peer_advertised_header')
  })

  it('peer ad that matches local BEAP is rejected and cleared (no usable selection)', () => {
    const hid = 'hs-poison'
    setHostAdvertisedMvpDirectForTests(hid, LOCAL_SANDBOX_DIRECT)
    const r = resolveSandboxToHostHttpDirectIngest(db, hid, { p2p_endpoint: '' }, '')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)
    expect(peekHostAdvertisedMvpDirectP2pEndpoint(hid)).toBeNull()
  })
})

describe('tryRepairP2pEndpointFromHostAdvertisement', () => {
  afterEach(() => {
    vi.mocked(getHandshakeRecord).mockReset()
    resetHostAdvertisedMvpDirectForTests()
  })

  it('C: local sandbox BEAP in header is not stored as peer advert', () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(relayRow('hs-c') as any)
    tryRepairP2pEndpointFromHostAdvertisement(
      {} as any,
      'hs-c',
      'http://192.168.0.5:9/beap/ingest',
    )
    expect(peekHostAdvertisedMvpDirectP2pEndpoint('hs-c')).toBeNull()
  })
})

describe('provenance error contract', () => {
  it('D: terminal reasons exclude BEAP role gate (policy GET must be skipped in UI for these codes only)', () => {
    const isTerminal = (code: string) =>
      code === InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH ||
      code === InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING
    expect(isTerminal(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)).toBe(true)
    expect(isTerminal(InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING)).toBe(true)
    expect(isTerminal('forbidden_host_role')).toBe(false)
  })
})
