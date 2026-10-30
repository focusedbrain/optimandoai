/**
 * Receiver-side ingress admission filter — [VII.2.7] acceptance tests.
 *
 * Phase 1: relationship must exist and be live before any inbound delivery is
 * processed; blocked transmissions die pre-visibility with an audit_log record.
 * Includes the cross-SSO regression (same sub, different issuer → rejected).
 */
import { describe, test, expect } from 'vitest'
import { admitInboundDelivery } from '../ingressAdmission'
import { insertHandshakeRecord } from '../db'
import { HandshakeState } from '../types'
import { createHandshakeTestDb } from './handshakeTestDb'
import { buildActiveHandshakeRecord, buildHandshakeRecord } from './helpers'

function dbWithRecord(record: ReturnType<typeof buildHandshakeRecord>) {
  const db = createHandshakeTestDb()
  insertHandshakeRecord(db, record)
  return db
}

describe('ingress admission filter — relationship existence and state', () => {
  test('beap_message for unknown relationship → blocked pre-visibility with audit record', () => {
    const db = createHandshakeTestDb()
    const r = admitInboundDelivery(db, { handshakeId: 'hs-missing', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('unknown_relationship')
    const audit = db.getAuditLog()
    expect(audit.length).toBe(1)
    expect(JSON.stringify(audit[0].args)).toContain('INGRESS_ADMISSION_BLOCKED')
  })

  test('beap_message for REVOKED relationship → blocked', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord({ state: HandshakeState.REVOKED }))
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('relationship_revoked')
    expect(db.getAuditLog().length).toBe(1)
  })

  test('beap_message for EXPIRED relationship → blocked', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord({ state: HandshakeState.EXPIRED }))
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('relationship_expired')
  })

  test('beap_message for ACTIVE relationship past expires_at → blocked (defense in depth)', () => {
    const db = dbWithRecord(
      buildActiveHandshakeRecord({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
    )
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('relationship_expired')
  })

  test('beap_message for PENDING_ACCEPT relationship → blocked (not operational)', () => {
    const db = dbWithRecord(buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }))
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('relationship_not_operational')
  })

  test('beap_message for ACTIVE relationship → admitted with record', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord())
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(true)
    if (r.admitted) expect(r.record?.handshake_id).toBe('hs-001')
    expect(db.getAuditLog().length).toBe(0)
  })

  test('beap_message for ACCEPTED relationship (pre-roundtrip operational window) → admitted', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord({ state: HandshakeState.ACCEPTED }))
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'p2p' })
    expect(r.admitted).toBe(true)
  })

  test('handshake_capsule with no record (formation) → admitted', () => {
    const db = createHandshakeTestDb()
    const r = admitInboundDelivery(db, { handshakeId: 'hs-new', kind: 'handshake_capsule', source: 'email' })
    expect(r.admitted).toBe(true)
    if (r.admitted) expect(r.record).toBeNull()
  })

  test('handshake_capsule for REVOKED relationship → blocked', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord({ state: HandshakeState.REVOKED }))
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'handshake_capsule', source: 'email' })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('relationship_revoked')
  })

  test('handshake_capsule for PENDING_ACCEPT relationship → admitted (state machine owns it)', () => {
    const db = dbWithRecord(buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }))
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'handshake_capsule', source: 'email' })
    expect(r.admitted).toBe(true)
  })
})

describe('ingress admission filter — full-claim identity guard [VII.3.8–3.10]', () => {
  // Local role is acceptor → counterparty is the initiator
  // (sender-user-001 / sub-sender-001 @ https://auth.wrdesk.com).

  test('cross-SSO regression: matching sub, different issuer → blocked', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord())
    const r = admitInboundDelivery(db, {
      handshakeId: 'hs-001',
      kind: 'beap_message',
      source: 'p2p',
      senderClaims: {
        iss: 'https://evil-idp.example.com',
        sub: 'sub-sender-001',
        email: 'sender@example.com',
        wrdesk_user_id: 'sender-user-001',
      },
    })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('sender_identity_mismatch')
  })

  test('full-claim match on the bound counterparty → admitted', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord())
    const r = admitInboundDelivery(db, {
      handshakeId: 'hs-001',
      kind: 'beap_message',
      source: 'p2p',
      senderClaims: {
        iss: 'https://auth.wrdesk.com',
        sub: 'sub-sender-001',
        email: 'sender@example.com',
        wrdesk_user_id: 'sender-user-001',
      },
    })
    expect(r.admitted).toBe(true)
  })

  test('sub-only presentation against fully bound counterparty → blocked (no sub-only shortcut)', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord())
    const r = admitInboundDelivery(db, {
      handshakeId: 'hs-001',
      kind: 'beap_message',
      source: 'p2p',
      senderClaims: { sub: 'sub-sender-001' },
    })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('sender_identity_mismatch')
  })

  test('no sender claims (unauthenticated transport) → identity deferred to downstream guard', () => {
    const db = dbWithRecord(buildActiveHandshakeRecord())
    const r = admitInboundDelivery(db, { handshakeId: 'hs-001', kind: 'beap_message', source: 'email' })
    expect(r.admitted).toBe(true)
  })
})

describe('ingress admission filter — sharing_mode scope', () => {
  test('context-bearing delivery from acceptor on receive-only relationship → blocked', () => {
    const db = dbWithRecord(
      buildActiveHandshakeRecord({ sharing_mode: 'receive-only', local_role: 'initiator' }),
    )
    const r = admitInboundDelivery(db, {
      handshakeId: 'hs-001',
      kind: 'beap_message',
      source: 'p2p',
      carriesContext: true,
    })
    expect(r.admitted).toBe(false)
    if (!r.admitted) expect(r.reason).toBe('sharing_mode_scope_violation')
  })

  test('context-bearing delivery to the acceptor on receive-only relationship → admitted', () => {
    const db = dbWithRecord(
      buildActiveHandshakeRecord({ sharing_mode: 'receive-only', local_role: 'acceptor' }),
    )
    const r = admitInboundDelivery(db, {
      handshakeId: 'hs-001',
      kind: 'beap_message',
      source: 'p2p',
      carriesContext: true,
    })
    expect(r.admitted).toBe(true)
  })
})
