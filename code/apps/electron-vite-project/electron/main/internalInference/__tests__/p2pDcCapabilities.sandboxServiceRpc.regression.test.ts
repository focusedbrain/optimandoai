/**
 * Regression: sandbox inbound capabilities responses must pass
 * assertRecordForServiceRpc (not role-derive alone).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord, type PartyIdentity } from '../../handshake/types'
import {
  clearPendingP2pCapabilitiesForTests,
  handleP2pDcInferenceCapabilitiesAsSandbox,
} from '../p2pDc/p2pDcCapabilities'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/p2p-caps-sandbox-rpc', getAppPath: () => '/tmp' },
}))

const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'dev-sand-1'))
vi.mock('../../orchestrator/orchestratorModeStore', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../orchestrator/orchestratorModeStore')>()
  return { ...a, getInstanceId: () => getInstanceIdMock() }
})

const getHandshakeRecordMock = vi.hoisted(() => vi.fn())
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (...a: unknown[]) => getHandshakeRecordMock(...a),
}))

const getLedgerDbMock = vi.hoisted(() => vi.fn(() => ({ _ledger: true })))
vi.mock('../../handshake/ledger', () => ({
  getLedgerDb: () => getLedgerDbMock(),
}))

vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  getSessionState: () => null,
}))

function party(uid = 'u1'): PartyIdentity {
  return { email: 'a@a.com', wrdesk_user_id: uid, iss: 'i', sub: 's' }
}

/** Coordination ids map local instance to sandbox; derive alone would accept. */
function sandboxLedgerRow(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-caps-1',
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    same_principal: true,
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
    initiator_coordination_device_id: 'dev-sand-1',
    acceptor_coordination_device_id: 'dev-host-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: 'https://relay.example/beap/x',
    ...overrides,
  } as HandshakeRecord
}

describe('handleP2pDcInferenceCapabilitiesAsSandbox — service-RPC eligibility', () => {
  afterEach(() => {
    clearPendingP2pCapabilitiesForTests()
    vi.clearAllMocks()
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    getLedgerDbMock.mockReturnValue({ _ledger: true })
  })

  it('rejects when ledger role would be sandbox but assertRecordForServiceRpc fails (not ACTIVE)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getHandshakeRecordMock.mockReturnValue(
      sandboxLedgerRow({ state: HandshakeState.ACCEPTED }),
    )
    const consumed = handleP2pDcInferenceCapabilitiesAsSandbox('sid-1', 'hs-caps-1', {
      type: 'inference_capabilities_result',
      request_id: 'r1',
      handshake_id: 'hs-caps-1',
      session_id: 'sid-1',
      models: [],
    })
    expect(consumed).toBe(false)
    const reject = log.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes('HOST_AI_CAPS_RESPONSE_REJECT') && line.includes('service_rpc_ineligible'))
    expect(reject).toBeTruthy()
    log.mockRestore()
  })

  it('rejects when identity incomplete even if coordination ids map to sandbox', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getHandshakeRecordMock.mockReturnValue(
      sandboxLedgerRow({ internal_coordination_identity_complete: false }),
    )
    const consumed = handleP2pDcInferenceCapabilitiesAsSandbox('sid-1', 'hs-caps-1', {
      type: 'inference_error',
      request_id: 'r2',
      handshake_id: 'hs-caps-1',
      session_id: 'sid-1',
      code: 'x',
    })
    expect(consumed).toBe(false)
    const reject = log.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes('service_rpc_ineligible'))
    expect(reject).toBeTruthy()
    log.mockRestore()
  })

  it('rejects cross-principal internal rows (service RPC ineligible)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getHandshakeRecordMock.mockReturnValue(
      sandboxLedgerRow({
        initiator: party('u1'),
        acceptor: party('u2'),
      }),
    )
    const consumed = handleP2pDcInferenceCapabilitiesAsSandbox('sid-1', 'hs-caps-1', {
      type: 'inference_capabilities_result',
      request_id: 'r3',
      handshake_id: 'hs-caps-1',
      session_id: 'sid-1',
      models: [],
    })
    expect(consumed).toBe(false)
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('service_rpc_ineligible')),
    ).toBe(true)
    log.mockRestore()
  })

  it('passes service-RPC gate for eligible sandbox (does not reject as service_rpc_ineligible)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getHandshakeRecordMock.mockReturnValue(sandboxLedgerRow())
    // No pending correlation → still false, but must not be service_rpc_ineligible.
    const consumed = handleP2pDcInferenceCapabilitiesAsSandbox('sid-1', 'hs-caps-1', {
      type: 'inference_error',
      request_id: 'missing-pending',
      handshake_id: 'hs-caps-1',
      session_id: 'sid-1',
      code: 'x',
    })
    expect(consumed).toBe(false)
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('service_rpc_ineligible')),
    ).toBe(false)
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('no_pending_or_unknown_correlation')),
    ).toBe(true)
    log.mockRestore()
  })
})
