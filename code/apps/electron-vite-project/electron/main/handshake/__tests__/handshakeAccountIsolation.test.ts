import { describe, test, expect, vi } from 'vitest'
import { filterHandshakeRecordsForCurrentSession, handshakeRowVisibilityForSession } from '../handshakeAccountIsolation'
import { buildTestSession } from '../sessionFactory'
import type { HandshakeRecord, PartyIdentity } from '../types'
import { HandshakeState } from '../types'

function party(p: Partial<PartyIdentity> & Pick<PartyIdentity, 'email' | 'wrdesk_user_id' | 'iss' | 'sub'>): PartyIdentity {
  return {
    email: p.email,
    wrdesk_user_id: p.wrdesk_user_id,
    iss: p.iss,
    sub: p.sub,
  }
}

const iss = 'https://auth.optimando.ai'

function minimalRow(overrides: Partial<HandshakeRecord> & Pick<HandshakeRecord, 'handshake_id' | 'initiator'>): HandshakeRecord {
  const i = overrides.initiator
  return {
    handshake_id: overrides.handshake_id,
    relationship_id: 'rel-1',
    state: HandshakeState.ACTIVE,
    initiator: i,
    acceptor: overrides.acceptor ?? null,
    local_role: 'initiator',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: true,
    tier_snapshot: {} as HandshakeRecord['tier_snapshot'],
    current_tier_signals: {} as HandshakeRecord['current_tier_signals'],
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as HandshakeRecord['effective_policy'],
    external_processing: 'none',
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
    ...overrides,
  } as HandshakeRecord
}

describe('handshakeAccountIsolation', () => {
  const sessionA = buildTestSession({
    wrdesk_user_id: 'user-a',
    email: 'a@test.com',
    sub: 'sub-a',
    iss,
  })
  const sessionB = buildTestSession({
    wrdesk_user_id: 'user-b',
    email: 'b@test.com',
    sub: 'sub-b',
    iss,
  })

  test('hides internal row when initiator/acceptor are different principals', () => {
    const r = minimalRow({
      handshake_id: 'h1',
      handshake_type: 'internal',
      initiator: party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' }),
      acceptor: party({ email: 'b@test.com', wrdesk_user_id: 'user-b', iss, sub: 'sub-b' }),
    })
    expect(handshakeRowVisibilityForSession(r, sessionA).ok).toBe(false)
  })

  test('shows internal row when same principal and session matches', () => {
    const p = party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' })
    const r = minimalRow({
      handshake_id: 'h2',
      handshake_type: 'internal',
      initiator: p,
      acceptor: { ...p },
    })
    expect(handshakeRowVisibilityForSession(r, sessionA).ok).toBe(true)
  })

  test('hides internal row when session is a different account', () => {
    const p = party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' })
    const r = minimalRow({
      handshake_id: 'h3',
      handshake_type: 'internal',
      initiator: p,
      acceptor: { ...p },
    })
    expect(handshakeRowVisibilityForSession(r, sessionB).ok).toBe(false)
  })

  test('standard handshake visible to initiator', () => {
    const r = minimalRow({
      handshake_id: 'h4',
      handshake_type: 'standard',
      initiator: party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' }),
      acceptor: party({ email: 'b@test.com', wrdesk_user_id: 'user-b', iss, sub: 'sub-b' }),
    })
    expect(handshakeRowVisibilityForSession(r, sessionA).ok).toBe(true)
    expect(handshakeRowVisibilityForSession(r, sessionB).ok).toBe(true)
  })

  test('hides standard handshake for unrelated session', () => {
    const r = minimalRow({
      handshake_id: 'h5',
      handshake_type: 'standard',
      initiator: party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' }),
      acceptor: party({ email: 'b@test.com', wrdesk_user_id: 'user-b', iss, sub: 'sub-b' }),
    })
    const sessionC = buildTestSession({
      wrdesk_user_id: 'user-c',
      email: 'c@test.com',
      sub: 'sub-c',
      iss,
    })
    expect(handshakeRowVisibilityForSession(r, sessionC).ok).toBe(false)
  })

  test('filterHandshakeRecordsForCurrentSession returns empty when no session', () => {
    const r = minimalRow({
      handshake_id: 'h6',
      initiator: party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(filterHandshakeRecordsForCurrentSession([r], null)).toEqual([])
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  test('filterHandshakeRecordsForCurrentSession logs hidden internal mismatch', () => {
    const r = minimalRow({
      handshake_id: 'h-bad',
      handshake_type: 'internal',
      initiator: party({ email: 'a@test.com', wrdesk_user_id: 'user-a', iss, sub: 'sub-a' }),
      acceptor: party({ email: 'b@test.com', wrdesk_user_id: 'user-b', iss, sub: 'sub-b' }),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = filterHandshakeRecordsForCurrentSession([r], sessionA)
      expect(out).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[HANDSHAKE_ACCOUNT_ISOLATION] hidden_row'),
        expect.objectContaining({ handshake_id: 'h-bad', reason: 'internal_mismatched_principals' }),
      )
    } finally {
      warn.mockRestore()
    }
  })
})
