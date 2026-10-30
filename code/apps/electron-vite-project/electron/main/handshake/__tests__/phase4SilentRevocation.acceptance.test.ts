/**
 * Phase 4 — Silent revocation (V5) [VII.10.7.2–7.4] — acceptance test 5.
 *
 *  A. Revocation produces NO outbound capsule, bounce, or counterparty-visible
 *     state change: the outbound queue stays empty and revocation.ts is
 *     structurally free of capsule-building/enqueueing code.
 *  B. Post-revocation inbound transmissions die pre-visibility at the
 *     receiver-side ingress filter with a logged record — this is the sole
 *     enforcement, and it is exactly why old-build peers with a zombie ACTIVE
 *     record are acceptable (their sends are killed here).
 *  C. Q8: history/evidence survives revocation — context blocks, embeddings,
 *     and audit rows all persist. Content deletion is a SEPARATE explicit
 *     operator action (`deleteRevokedRelationshipContent`), valid only on an
 *     already-revoked relationship, and it never deletes audit rows.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { migrateHandshakeTables, insertHandshakeRecord } from '../db'
import { revokeHandshake, deleteRevokedRelationshipContent } from '../revocation'
import { admitInboundDelivery } from '../ingressAdmission'
import { HandshakeState } from '../types'
import { buildActiveHandshakeRecord } from './helpers'

const HS = 'hs-001' // buildActiveHandshakeRecord default id

function makeDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  return db
}

function seedContent(db: any, handshakeId: string): void {
  db.prepare(
    `INSERT INTO context_blocks
       (sender_wrdesk_user_id, block_id, block_hash, relationship_id, handshake_id,
        type, data_classification, version, source, payload, created_at)
     VALUES ('sender-user-001', 'blk-1', 'hash-1', 'rel-001', ?, 'note', 'public', 1,
             'received', '{"t":"payload"}', '2025-01-01T00:00:00.000Z')`,
  ).run(handshakeId)
  db.prepare(
    `INSERT INTO context_embeddings
       (sender_wrdesk_user_id, block_id, block_hash, embedding, model_id, created_at)
     VALUES ('sender-user-001', 'blk-1', 'hash-1', ?, 'model-1', '2025-01-01T00:00:00.000Z')`,
  ).run(Buffer.from([1, 2, 3]))
}

const count = (db: any, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('Phase 4 — silent revocation (V5)', () => {
  let db: any

  beforeEach(() => {
    db = makeDb()
    insertHandshakeRecord(db, buildActiveHandshakeRecord())
    seedContent(db, HS)
  })

  it('A: revocation enqueues no outbound capsule and marks REVOKED', async () => {
    await revokeHandshake(db, HS, 'local-user', 'local-user-001')

    const row = db.prepare('SELECT state, revocation_source FROM handshakes WHERE handshake_id=?').get(HS)
    expect(row.state).toBe(HandshakeState.REVOKED)
    expect(row.revocation_source).toBe('local-user')

    // No peer notification of any kind: nothing entered the outbound queue.
    expect(count(db, 'outbound_capsule_queue')).toBe(0)
  })

  it('A (structural): revocation.ts contains no capsule-building or enqueue path', () => {
    const src = readFileSync(join(__dirname, '..', 'revocation.ts'), 'utf8')
    for (const forbidden of [
      'buildRevokeCapsule',
      'enqueueOutboundCapsule',
      'processOutboundQueue',
      'getEffectiveRelayEndpoint',
      'internalRelayCapsuleWireOptsFromRecord',
    ]) {
      expect(src.includes(forbidden), `revocation.ts must not reference ${forbidden}`).toBe(false)
    }
  })

  it('B: post-revocation inbound dies pre-visibility with a logged record (zombie-peer case)', async () => {
    await revokeHandshake(db, HS, 'local-user', 'local-user-001')

    // An old-build peer still holds a zombie ACTIVE record and keeps sending.
    for (const kind of ['beap_message', 'handshake_capsule'] as const) {
      const r = admitInboundDelivery(db, { handshakeId: HS, kind, source: 'relay_pull' })
      expect(r.admitted).toBe(false)
      if (!r.admitted) expect(r.reason).toBe('relationship_revoked')
    }

    const blocked = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action='INGRESS_ADMISSION_BLOCKED' AND handshake_id=?`)
      .get(HS) as { n: number }
    expect(blocked.n).toBe(2)
  })

  it('C: evidence and content survive revocation (Q8)', async () => {
    const auditBefore = count(db, 'audit_log')

    await revokeHandshake(db, HS, 'local-user', 'local-user-001')

    expect(count(db, 'context_blocks')).toBe(1)
    expect(count(db, 'context_embeddings')).toBe(1)
    // Audit only grows (revocation entry added), never shrinks.
    expect(count(db, 'audit_log')).toBe(auditBefore + 1)
  })

  it('C: content deletion is a separate explicit operator action, revoked-only', async () => {
    // Refused while the relationship is still ACTIVE.
    const early = deleteRevokedRelationshipContent(db, HS, 'local-user-001')
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.reason).toBe('not_revoked')
    expect(count(db, 'context_blocks')).toBe(1)

    await revokeHandshake(db, HS, 'local-user', 'local-user-001')
    const auditAfterRevoke = count(db, 'audit_log')

    const r = deleteRevokedRelationshipContent(db, HS, 'local-user-001')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.blocks_deleted).toBe(1)
      expect(r.embeddings_deleted).toBe(1)
    }
    expect(count(db, 'context_blocks')).toBe(0)
    expect(count(db, 'context_embeddings')).toBe(0)
    // Evidence persists: audit rows never deleted; the explicit action logs itself.
    expect(count(db, 'audit_log')).toBe(auditAfterRevoke + 1)

    expect(deleteRevokedRelationshipContent(db, 'hs-missing').ok).toBe(false)
  })

  it('idempotent: second revoke is a no-op', async () => {
    await revokeHandshake(db, HS, 'local-user', 'local-user-001')
    const auditAfter = count(db, 'audit_log')
    await revokeHandshake(db, HS, 'local-user', 'local-user-001')
    expect(count(db, 'audit_log')).toBe(auditAfter)
  })
})
