/**
 * Run 5 Slice 13 — persistence maintenance.
 *
 * `maintainWrcSecurityDb` is the ONLY pruning path: bounded (rowid-limited
 * batches over the v4 indexes), lazy (composition root calls it once at
 * startup), and provably unable to weaken security — everything it deletes
 * is past the point where any gate could give a different answer because the
 * row existed. Monotonic floors, one-time-use state, device records, and
 * counterpart passes are NEVER touched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  maintainWrcSecurityDb,
  openWrcSecurityDb,
  type WrcSecurityDb,
} from '../wrcSecurityDb'

const _require = createRequire(import.meta.url)
let Database: unknown = null
try {
  const D = _require('better-sqlite3')
  const probe = new D(':memory:')
  probe.close()
  Database = D
} catch {
  Database = null
}

const NOW = 1_754_650_100
const RETENTION = 3600
const ISO = (s: number) => new Date(s * 1000).toISOString()

let dir: string
let db: WrcSecurityDb

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-maint-'))
  db = openWrcSecurityDb(join(dir, 'wrc-security.db'))
})

afterEach(() => {
  if (!Database) return
  try {
    db.close()
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

function insertEnvelope(capsuleId: string, expiresAt: number) {
  db.prepare(
    `INSERT INTO wrc_relay_envelope
       (capsule_id, publisher_part, entry_key, status, expires_at, envelope_json, updated_at)
     VALUES (?, 'WR7X4K', 'EK', 'available', ?, '{}', ?)`,
  ).run(capsuleId, expiresAt, ISO(NOW))
}

function insertRelayLedger(capsuleId: string, requestId: string, createdAtS: number) {
  db.prepare(
    `INSERT INTO wrc_relay_request_ledger (capsule_id, request_instance_id, party_id, created_at)
     VALUES (?, ?, 'party-9', ?)`,
  ).run(capsuleId, requestId, ISO(createdAtS))
}

function insertAdmissionLedger(requestId: string, createdAtS: number) {
  db.prepare(
    `INSERT INTO wrc_admission_request_ledger (request_instance_id, capsule_id, created_at)
     VALUES (?, 'cap-x', ?)`,
  ).run(requestId, ISO(createdAtS))
}

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

describe.skipIf(!Database)('maintenance: relay envelopes', () => {
  it('prunes an envelope only once it is expired PAST the retention window', () => {
    insertEnvelope('cap-live', NOW + 600) // live
    insertEnvelope('cap-fresh-expired', NOW - 10) // expired, inside retention
    insertEnvelope('cap-old-expired', NOW - RETENTION - 10) // past retention

    const r = maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION })
    expect(r.relayEnvelopesPruned).toBe(1)
    const left = db.prepare('SELECT capsule_id FROM wrc_relay_envelope').all() as Array<{
      capsule_id: string
    }>
    expect(left.map((x) => x.capsule_id).sort()).toEqual(['cap-fresh-expired', 'cap-live'])
  })
})

describe.skipIf(!Database)('maintenance: relay request ledger', () => {
  it('never prunes a row whose envelope is still live — regardless of age', () => {
    insertEnvelope('cap-live', NOW + 600)
    insertRelayLedger('cap-live', 'req-ancient', NOW - 10 * RETENTION)

    const r = maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION })
    expect(r.relayLedgerRowsPruned).toBe(0)
    expect(count('wrc_relay_request_ledger')).toBe(1)
  })

  it('prunes old rows whose envelope is expired or gone; keeps recent ones', () => {
    insertEnvelope('cap-exp', NOW - 10)
    insertRelayLedger('cap-exp', 'req-old-expired', NOW - RETENTION - 10)
    insertRelayLedger('cap-gone', 'req-old-orphan', NOW - RETENTION - 10)
    insertRelayLedger('cap-gone', 'req-recent-orphan', NOW - 10)

    const r = maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION })
    expect(r.relayLedgerRowsPruned).toBe(2)
    const left = db
      .prepare('SELECT request_instance_id FROM wrc_relay_request_ledger')
      .all() as Array<{ request_instance_id: string }>
    expect(left.map((x) => x.request_instance_id)).toEqual(['req-recent-orphan'])
  })
})

describe.skipIf(!Database)('maintenance: admission ledger', () => {
  it('prunes only rows older than the retention window', () => {
    insertAdmissionLedger('req-old', NOW - RETENTION - 10)
    insertAdmissionLedger('req-recent', NOW - 10)

    const r = maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION })
    expect(r.admissionLedgerRowsPruned).toBe(1)
    const left = db
      .prepare('SELECT request_instance_id FROM wrc_admission_request_ledger')
      .all() as Array<{ request_instance_id: string }>
    expect(left.map((x) => x.request_instance_id)).toEqual(['req-recent'])
  })
})

describe.skipIf(!Database)('maintenance: what is NEVER pruned', () => {
  it('floors, use state, device records and passes survive maintenance untouched', () => {
    db.prepare(
      `INSERT INTO wrc_directory_generation_floor (publisher_part, generation_floor, updated_at)
       VALUES ('WR7X4K', 3, ?)`,
    ).run(ISO(NOW - 10 * RETENTION))
    db.prepare(
      `INSERT INTO wrc_publisher_epoch_floor (publisher_part, epoch_floor, updated_at)
       VALUES ('WR7X4K', 2, ?)`,
    ).run(ISO(NOW - 10 * RETENTION))
    db.prepare(
      `INSERT INTO wrc_entry_use_state
         (publisher_part, entry_id, use_limit, use_scope, consume_at, claim_timeout_s,
          state, uses_taken, updated_at)
       VALUES ('WR7X4K', 'E1', 1, 'per_entry', 'acceptance', 120, 'consumed', 1, ?)`,
    ).run(ISO(NOW - 10 * RETENTION))
    db.prepare(
      `INSERT INTO wrc_device_record
         (tenant_part, device_party_id, principal_party_id, device_class, generation,
          status, record_json, updated_at)
       VALUES ('WR7X4K', 'party-1:dev', 'party-1', 'workstation', 2, 'revoked', '{}', ?)`,
    ).run(ISO(NOW - 10 * RETENTION))
    db.prepare(
      `INSERT INTO wrc_counterpart_pass
         (c_initiator_part, c_responder_part, device_party_id, status, expires_at, pass_json, updated_at)
       VALUES ('WR7X4K', 'RCVPBX', 'party-9:dev', 'withdrawn', ?, '{}', ?)`,
    ).run(NOW - 10 * RETENTION, ISO(NOW - 10 * RETENTION))

    maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION })

    expect(count('wrc_directory_generation_floor')).toBe(1)
    expect(count('wrc_publisher_epoch_floor')).toBe(1)
    expect(count('wrc_entry_use_state')).toBe(1)
    expect(count('wrc_device_record')).toBe(1)
    expect(count('wrc_counterpart_pass')).toBe(1)
    // Restart-equivalent read: the revocation and the consumed use are intact.
    const dev = db
      .prepare(`SELECT status FROM wrc_device_record WHERE device_party_id = 'party-1:dev'`)
      .get() as { status: string }
    expect(dev.status).toBe('revoked')
  })
})

describe.skipIf(!Database)('maintenance: boundedness and idempotency', () => {
  it('a batch cap limits every table to that many deletions per call', () => {
    for (let i = 0; i < 5; i += 1) {
      insertEnvelope(`cap-${i}`, NOW - RETENTION - 10)
      insertAdmissionLedger(`req-${i}`, NOW - RETENTION - 10)
    }
    const first = maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION, maxRowsPerTable: 2 })
    expect(first.relayEnvelopesPruned).toBe(2)
    expect(first.admissionLedgerRowsPruned).toBe(2)
    // Repeated bounded calls converge; a no-op run deletes nothing.
    maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION, maxRowsPerTable: 2 })
    maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION, maxRowsPerTable: 2 })
    const done = maintainWrcSecurityDb(db, { nowS: NOW, retentionS: RETENTION, maxRowsPerTable: 2 })
    expect(done.relayEnvelopesPruned).toBe(0)
    expect(done.admissionLedgerRowsPruned).toBe(0)
    expect(count('wrc_relay_envelope')).toBe(0)
    expect(count('wrc_admission_request_ledger')).toBe(0)
  })

  it('the v4 migration is idempotent across reopen (indexes only, rows intact)', () => {
    insertAdmissionLedger('req-keep', NOW - 10)
    db.close()
    db = openWrcSecurityDb(join(dir, 'wrc-security.db'))
    expect(count('wrc_admission_request_ledger')).toBe(1)
    const version = db
      .prepare('SELECT MAX(version) AS v FROM wrc_schema_migrations')
      .get() as { v: number }
    expect(version.v).toBe(4)
  })
})
