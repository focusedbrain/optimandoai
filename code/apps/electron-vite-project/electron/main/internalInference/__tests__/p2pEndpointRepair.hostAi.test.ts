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
  applyHostAiDirectBeapAdFromRelayPayload,
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

  it('Test 4: no peer Host advert and ledger/caller is local sandbox BEAP → HOST_AI_PEER_ENDPOINT_MISSING', () => {
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      'hs-a',
      { ...relayRow('hs-a'), p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING)
    expect(r.host_ai_endpoint_deny_detail).toBe('peer_host_beap_not_advertised')
    expect(r.selected_endpoint_provenance).toBe('local_beap')
  })

  it('A: no peer ad, empty candidate → HOST_DIRECT_ENDPOINT_MISSING', () => {
    const r = resolveSandboxToHostHttpDirectIngest(db, 'hs-miss', { ...relayRow('hs-miss'), p2p_endpoint: '' }, '')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING)
    expect(r.selected_endpoint_provenance).toBe('not_applicable')
  })

  it('Test 3: peer advert (header) with owner=ledger host → selected_endpoint uses peer URL', () => {
    const hid = 'hs-b'
    setHostAdvertisedMvpDirectForTests(hid, PEER_HOST_DIRECT, { ownerDeviceId: 'dev-host-1' })
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { ...relayRow(hid), p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.url).toMatch(/192\.168\.1\.20/)
    expect(r.selected_endpoint_source).toBe('peer_advertised_header')
    expect(r.selected_endpoint_provenance).toBe('peer_advertised_header')
    expect(r.resolutionCategory).toBe('accepted_peer_header')
  })

  it('B2: relay_control_plane peer ad + host owner → accepted_relay_ad', () => {
    const hid = 'hs-b2'
    setHostAdvertisedMvpDirectForTests(hid, PEER_HOST_DIRECT, { ownerDeviceId: 'dev-host-1', adSource: 'relay' })
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { ...relayRow(hid), p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.selected_endpoint_source).toBe('relay_control_plane')
    expect(r.resolutionCategory).toBe('accepted_relay_ad')
  })

  it('peer ad owner sandbox (metadata) → reject', () => {
    const hid = 'hs-peer-sandbox-owner'
    setHostAdvertisedMvpDirectForTests(hid, PEER_HOST_DIRECT, { ownerDeviceId: 'dev-sand-1' })
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { ...relayRow(hid), p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)
    expect(r.host_ai_endpoint_deny_detail).toBe('peer_ad_owner_sandbox')
  })

  it('Test 5: peer ad owner_device_id ≠ ledger host coordination id → reject (stale/wrong owner ignored)', () => {
    const hid = 'hs-wrong-host-owner'
    setHostAdvertisedMvpDirectForTests(hid, PEER_HOST_DIRECT, { ownerDeviceId: '8929353a-5cbc-46f7-b4d9-6439b82a14ca' })
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { ...relayRow(hid), p2p_endpoint: LOCAL_SANDBOX_DIRECT },
      LOCAL_SANDBOX_DIRECT,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)
    expect(r.host_ai_endpoint_deny_detail).toBe('host_owner_mismatch')
  })

  it('ledger endpoint with host coordination + distinct direct URL → accept ledger', () => {
    const hid = 'hs-ledger-ok'
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { ...relayRow(hid), p2p_endpoint: PEER_HOST_DIRECT },
      PEER_HOST_DIRECT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.selected_endpoint_provenance).toBe('internal_handshake_ledger')
    expect(r.resolutionCategory).toBe('accepted_ledger')
  })

  it('ledger endpoint but host coordination id missing → provenance missing', () => {
    const hid = 'hs-no-host-coord'
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      {
        ...relayRow(hid),
        p2p_endpoint: PEER_HOST_DIRECT,
        acceptor_coordination_device_id: '',
      },
      PEER_HOST_DIRECT,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING)
    expect(r.host_ai_endpoint_deny_detail).toBe('provenance_incomplete')
  })

  it('C: peer ad that matches local BEAP → OWNER_MISMATCH / self_local_beap_selected (hard reject before meaningful host probe)', () => {
    const hid = 'hs-poison'
    setHostAdvertisedMvpDirectForTests(hid, LOCAL_SANDBOX_DIRECT)
    const r = resolveSandboxToHostHttpDirectIngest(
      db,
      hid,
      { ...relayRow(hid), p2p_endpoint: '' },
      '',
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)
    expect(r.host_ai_endpoint_deny_detail).toBe('self_local_beap_selected')
    expect(peekHostAdvertisedMvpDirectP2pEndpoint(hid)).toBeNull()
  })
})

describe('applyHostAiDirectBeapAdFromRelayPayload', () => {
  const db = {}
  const future = new Date(Date.now() + 120_000).toISOString()
  const basePayload = (overrides: Record<string, unknown> = {}) => ({
    schema_version: 1,
    signal_type: 'p2p_host_ai_direct_beap_ad',
    handshake_id: 'hs-apply',
    correlation_id: 'c1',
    session_id: 's1',
    sender_device_id: 'dev-host-1',
    receiver_device_id: 'dev-sand-1',
    created_at: new Date().toISOString(),
    expires_at: future,
    endpoint_url: PEER_HOST_DIRECT,
    ad_seq: 1,
    owner_role: 'host',
    ...overrides,
  })

  afterEach(() => {
    vi.mocked(getHandshakeRecord).mockReset()
    updateHandshakeRecord.mockReset()
    resetHostAdvertisedMvpDirectForTests()
  })

  it('accepts valid host ad, updates peer map + ledger', () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(relayRow('hs-apply') as any)
    const r = applyHostAiDirectBeapAdFromRelayPayload(db, basePayload() as any, 'rm-1')
    expect(r).toEqual({ ok: true })
    expect(peekHostAdvertisedMvpDirectP2pEndpoint('hs-apply')).toMatch(/192\.168\.1\.20/)
  })

  it('rejects stale ad_seq', () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(relayRow('hs-apply') as any)
    expect(applyHostAiDirectBeapAdFromRelayPayload(db, basePayload({ ad_seq: 2 }) as any, 'r1').ok).toBe(true)
    expect(applyHostAiDirectBeapAdFromRelayPayload(db, basePayload({ ad_seq: 1 }) as any, 'r2').ok).toBe(false)
  })

  it('rejects wrong owner (sender not ledger host coord id)', () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(relayRow('hs-apply') as any)
    const r = applyHostAiDirectBeapAdFromRelayPayload(
      db,
      basePayload({ sender_device_id: 'other-host' }) as any,
      'r1',
    )
    expect(r.ok).toBe(false)
  })

  it('rejects same-as-local sandbox BEAP URL', () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(relayRow('hs-apply') as any)
    const r = applyHostAiDirectBeapAdFromRelayPayload(
      db,
      basePayload({ endpoint_url: LOCAL_SANDBOX_DIRECT }) as any,
      'r1',
    )
    expect(r.ok).toBe(false)
  })

  it('rejects when handshake is not active internal sandbox→host', () => {
    const bad = { ...relayRow('hs-apply'), state: HandshakeState.REVOKED }
    vi.mocked(getHandshakeRecord).mockReturnValue(bad as any)
    const r = applyHostAiDirectBeapAdFromRelayPayload(db, basePayload() as any, 'r1')
    expect(r.ok).toBe(false)
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
      code === InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING ||
      code === InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING ||
      code === InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING
    expect(isTerminal(InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH)).toBe(true)
    expect(isTerminal(InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING)).toBe(true)
    expect(isTerminal(InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING)).toBe(true)
    expect(isTerminal('forbidden_host_role')).toBe(false)
  })
})
