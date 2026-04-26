import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { listHandshakeRecords } from '../../handshake/db'
import {
  getEffectiveHostAiRoleForHandshake,
  getHostAiLedgerRoleSummaryFromDb,
} from '../hostAiEffectiveRole'

vi.mock('../../handshake/db', () => ({
  listHandshakeRecords: vi.fn(),
}))

const base = (hid: string): HandshakeRecord =>
  ({
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
    p2p_endpoint: 'https://x/beap',
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
  }) as HandshakeRecord

describe('getEffectiveHostAiRoleForHandshake', () => {
  it('dev-sand-1: can_probe, not publish; configured host is mismatch', () => {
    const r = base('h1')
    const o = getEffectiveHostAiRoleForHandshake(r, 'dev-sand-1', 'host')
    expect(o.source).toBe('handshake')
    expect(o.effective_role).toBe('sandbox')
    expect(o.mismatch).toBe(true)
    expect(o.can_probe_host_endpoint).toBe(true)
    expect(o.can_publish_host_endpoint).toBe(false)
  })

  it('dev-host-1: can_publish, not probe; configured sandbox is mismatch', () => {
    const r = base('h1')
    const o = getEffectiveHostAiRoleForHandshake(r, 'dev-host-1', 'sandbox')
    expect(o.effective_role).toBe('host')
    expect(o.mismatch).toBe(true)
    expect(o.can_publish_host_endpoint).toBe(true)
    expect(o.can_probe_host_endpoint).toBe(false)
  })

  it('dev-host-1 with configured host: no mismatch', () => {
    const r = base('h1')
    const o = getEffectiveHostAiRoleForHandshake(r, 'dev-host-1', 'host')
    expect(o.mismatch).toBe(false)
    expect(o.can_publish_host_endpoint).toBe(true)
  })
})

describe('getHostAiLedgerRoleSummaryFromDb', () => {
  beforeEach(() => {
    vi.mocked(listHandshakeRecords).mockReset()
  })

  it('aggregates a single row from listHandshakeRecords', () => {
    vi.mocked(listHandshakeRecords).mockReturnValue([base('h1')])
    const s = getHostAiLedgerRoleSummaryFromDb({} as any, 'dev-sand-1', 'host')
    expect(s.can_probe_host_endpoint).toBe(true)
    expect(s.can_publish_host_endpoint).toBe(false)
    expect(s.any_orchestrator_mismatch).toBe(true)
    expect(s.effective_host_ai_role).toBe('sandbox')
  })
})
