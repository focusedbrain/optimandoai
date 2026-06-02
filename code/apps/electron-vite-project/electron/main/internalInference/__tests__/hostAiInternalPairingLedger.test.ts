/**
 * Host-AI internal-handshake enumeration must be symmetric across the host/sandbox process split and
 * must NOT depend on the in-memory SSO session filter (the SSO-encrypted ledger DB is the boundary).
 */
const listHandshakeRecordsMock = vi.hoisted(() => vi.fn())
const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'host-dev'))

vi.mock('../../handshake/db', () => ({
  listHandshakeRecords: (...a: unknown[]) => listHandshakeRecordsMock(...a),
}))
vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceIdMock(),
}))

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  hostHasActiveInternalLedgerHostPeerSandboxFromDb,
  listActiveInternalHandshakesForHostAi,
} from '../hostAiInternalPairingLedger'

function row(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'host-dev',
    acceptor_coordination_device_id: 'sand-dev',
    initiator: { email: 'a@w.com', wrdesk_user_id: 'u', iss: 'i', sub: 's' },
    acceptor: { email: 'a@w.com', wrdesk_user_id: 'u', iss: 'i', sub: 's' },
    internal_coordination_identity_complete: true,
    ...overrides,
  } as HandshakeRecord
}

describe('listActiveInternalHandshakesForHostAi', () => {
  beforeEach(() => {
    listHandshakeRecordsMock.mockReset()
    getInstanceIdMock.mockReturnValue('host-dev')
  })

  it('returns ACTIVE internal rows only, with no session filter applied', () => {
    listHandshakeRecordsMock.mockReturnValue([
      row({ handshake_id: 'internal-active' }),
      row({ handshake_id: 'standard', handshake_type: 'standard' as any }),
      row({ handshake_id: 'internal-pending', state: HandshakeState.PENDING_REVIEW }),
    ])
    const out = listActiveInternalHandshakesForHostAi({})
    expect(out.map((r) => r.handshake_id)).toEqual(['internal-active'])
  })

  it('returns [] for a missing db (fail-closed)', () => {
    expect(listActiveInternalHandshakesForHostAi(null)).toEqual([])
  })
})

describe('hostHasActiveInternalLedgerHostPeerSandboxFromDb (symmetric, filter-free)', () => {
  beforeEach(() => {
    listHandshakeRecordsMock.mockReset()
    getInstanceIdMock.mockReturnValue('host-dev')
  })

  it('true when this instance is host + peer sandbox on a same-principal internal row', () => {
    listHandshakeRecordsMock.mockReturnValue([row()])
    expect(hostHasActiveInternalLedgerHostPeerSandboxFromDb({})).toBe(true)
  })

  it('false for a cross-principal row even if roles parse (§2 anchor: handshakeSamePrincipal)', () => {
    listHandshakeRecordsMock.mockReturnValue([
      row({ acceptor: { email: 'b@w.com', wrdesk_user_id: 'other', iss: 'i', sub: 's2' } }),
    ])
    expect(hostHasActiveInternalLedgerHostPeerSandboxFromDb({})).toBe(false)
  })
})
