/**
 * Phase 2 — acceptance test 6: generic anti-rollback high-water store (G4)
 * [IX.4.2, X.7.8].
 *
 *  - A validly signed object with a version BELOW the persisted high-water
 *    mark is rejected fail-closed as a rollback.
 *  - Equal versions are accepted (idempotent redelivery is not a rollback).
 *  - The documented backup/restore scenario is exercised: the store lives in
 *    the same DB file as the objects it guards, so a whole-file restore
 *    keeps marks and data coherent (no mass-rejection), and the operator
 *    restore marker records the discontinuity in the audit log.
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

import { migrateHandshakeTables } from '../db'
import { enforceHighWater, getHighWater, recordRestoreMarker } from '../antiRollback'
import { checkAndRecordNonce } from '../nonceStore'

function makeDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  return db
}

describe('Phase 2 — anti-rollback high-water store (G4)', () => {
  it('accepts first-seen, raises monotonically, rejects below the mark fail-closed', () => {
    const db = makeDb()

    expect(enforceHighWater(db, 'wr.core', 'obj-1', 3)).toEqual({ ok: true, raised: true, highWater: 3 })
    expect(enforceHighWater(db, 'wr.core', 'obj-1', 7)).toEqual({ ok: true, raised: true, highWater: 7 })

    // Equal version: idempotent redelivery, not a rollback.
    expect(enforceHighWater(db, 'wr.core', 'obj-1', 7)).toEqual({ ok: true, raised: false, highWater: 7 })

    // Below the mark: rejected regardless of signature validity upstream.
    const rejected = enforceHighWater(db, 'wr.core', 'obj-1', 5)
    expect(rejected).toEqual({ ok: false, reason: 'rollback', highWater: 7, presented: 5 })
    expect(getHighWater(db, 'wr.core', 'obj-1')).toBe(7)
  })

  it('keys by (object class, object identity) — no cross-object bleed', () => {
    const db = makeDb()
    enforceHighWater(db, 'wr.core', 'obj-a', 10)
    expect(enforceHighWater(db, 'wr.core', 'obj-b', 1).ok).toBe(true)
    expect(enforceHighWater(db, 'wr.policy', 'obj-a', 1).ok).toBe(true)
    expect(enforceHighWater(db, 'wr.core', 'obj-a', 9).ok).toBe(false)
  })

  it('rejects malformed versions fail-closed', () => {
    const db = makeDb()
    expect(enforceHighWater(db, 'wr.core', 'obj-x', -1).ok).toBe(false)
    expect(enforceHighWater(db, 'wr.core', 'obj-x', 1.5).ok).toBe(false)
    expect(enforceHighWater(db, 'wr.core', 'obj-x', Number.NaN).ok).toBe(false)
    // Nothing was persisted by the malformed attempts.
    expect(getHighWater(db, 'wr.core', 'obj-x')).toBeNull()
  })

  it('documented restore scenario: marks travel with the DB file; marker records the discontinuity', () => {
    // "Live" DB advances past the backup point.
    const live = makeDb()
    enforceHighWater(live, 'wr.core', 'rel-1', 4)
    enforceHighWater(live, 'wr.core', 'rel-1', 9)

    // The "backup" is a snapshot of the WHOLE file at version 4 — store and
    // objects together. Simulated as a second DB whose mark is 4.
    const restored = makeDb()
    enforceHighWater(restored, 'wr.core', 'rel-1', 4)

    // Post-restore: objects at the restored version are NOT mass-rejected —
    // the mark travelled with the data (primary risk-register failure mode).
    expect(enforceHighWater(restored, 'wr.core', 'rel-1', 4)).toEqual({ ok: true, raised: false, highWater: 4 })
    // Progress resumes from the restored mark.
    expect(enforceHighWater(restored, 'wr.core', 'rel-1', 5).ok).toBe(true)
    // Genuine rollback below the restored mark is still caught.
    expect(enforceHighWater(restored, 'wr.core', 'rel-1', 3).ok).toBe(false)

    // Step (c) of the restore procedure: operator marker in the audit log.
    recordRestoreMarker(restored, { restoredFrom: 'backup-2026-07-20', operator: 'ops@dev.test' })
    const marker = restored
      .prepare("SELECT action, reason_code, metadata FROM audit_log WHERE action = 'HIGH_WATER_RESTORE_MARKER'")
      .get() as { action: string; reason_code: string; metadata: string }
    expect(marker).toBeTruthy()
    expect(marker.reason_code).toBe('operator_restore')
    expect(JSON.parse(marker.metadata).restoredFrom).toBe('backup-2026-07-20')
  })
})

describe('Phase 2 — core nonce store unit semantics [VII.3.1]', () => {
  it('first-seen ok; same nonce + same bound hash ok (redelivery); different hash → replay', () => {
    const db = makeDb()
    expect(checkAndRecordNonce(db, 's', 'n1', 'hash-a')).toEqual({ ok: true, firstSeen: true })
    expect(checkAndRecordNonce(db, 's', 'n1', 'hash-a')).toEqual({ ok: true, firstSeen: false })
    expect(checkAndRecordNonce(db, 's', 'n1', 'hash-b')).toEqual({ ok: false, reason: 'replay', boundHash: 'hash-a' })
    // Scopes are independent.
    expect(checkAndRecordNonce(db, 'other-scope', 'n1', 'hash-b')).toEqual({ ok: true, firstSeen: true })
  })
})
