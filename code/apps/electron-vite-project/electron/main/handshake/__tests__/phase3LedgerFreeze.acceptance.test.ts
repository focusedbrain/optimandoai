/**
 * Phase 3 — acceptance 6: ledger freeze & sweep (G5).
 *
 * The ledger handle is frozen at LEDGER_SCHEMA_FREEZE_VERSION (v74): the
 * core-store split (v75+) never lands on it. The one-time sweep copies out
 * and removes private-key material from relationship rows and any
 * undocumented tables; afterwards the hygiene assertion holds — documented
 * tables only, no key-material values on rows, integrity check passes on
 * both the frozen (ledger-shaped) and full (vault-shaped) handles.
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { migrateHandshakeTables, LEDGER_SCHEMA_FREEZE_VERSION } from '../db'
import { auditLedgerTables, sweepLedgerForFreeze, assertLedgerHygiene } from '../ledgerHygiene'

function makeLedgerShapedDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  // Ledger-native tables (subset sufficient for the sweep/meta paths).
  db.prepare(`CREATE TABLE ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run()
  db.prepare(`CREATE TABLE ledger_handshakes (handshake_id TEXT PRIMARY KEY, relationship_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', capsule_type TEXT NOT NULL, sender_id TEXT NOT NULL,
    sender_email TEXT, receiver_id TEXT, receiver_email TEXT, local_role TEXT NOT NULL,
    sharing_mode TEXT, capsule_hash TEXT NOT NULL, context_hash TEXT, context_commitment TEXT,
    nonce TEXT, policy_hash TEXT, policy_version TEXT, tier_signals TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run()
  db.prepare(`CREATE TABLE ledger_context_blocks (block_id TEXT NOT NULL, handshake_id TEXT NOT NULL,
    block_hash TEXT NOT NULL, block_type TEXT NOT NULL, scope_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (block_id, handshake_id))`).run()
  db.prepare(`CREATE TABLE ledger_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL,
    description TEXT NOT NULL)`).run()
  // Persisted freeze marker + FROZEN handshake schema — what openLedger
  // applies from Phase 3 on.
  db.prepare(`INSERT OR REPLACE INTO ledger_meta (key, value) VALUES ('wr_schema_freeze', ?)`).run(
    String(LEDGER_SCHEMA_FREEZE_VERSION),
  )
  migrateHandshakeTables(db, { freezeAtVersion: LEDGER_SCHEMA_FREEZE_VERSION })
  return db
}

describe('Phase 3 — ledger freeze (G5)', () => {
  it('frozen handles never receive the core-store split (v75+)', () => {
    const db = makeLedgerShapedDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r: any) => r.name)
    expect(tables).not.toContain('wr_handshake_core')
    expect(tables).not.toContain('wr_handshake_runtime')

    const maxApplied = db
      .prepare('SELECT MAX(version) AS v FROM handshake_schema_migrations')
      .get() as { v: number }
    expect(maxApplied.v).toBeLessThanOrEqual(LEDGER_SCHEMA_FREEZE_VERSION)

    // Re-running the frozen migration stays frozen (idempotent freeze).
    migrateHandshakeTables(db, { freezeAtVersion: LEDGER_SCHEMA_FREEZE_VERSION })
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'wr_handshake_core'").get(),
    ).toBeUndefined()
  })

  it('the persisted freeze marker protects the handle against LAZY migration calls (no options)', () => {
    const db = makeLedgerShapedDb()
    // What the ingestion IPC layer does: migrateHandshakeTables(db) with no
    // idea which handle it received. The ledger_meta marker must hold the line.
    migrateHandshakeTables(db)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'wr_handshake_core'").get(),
    ).toBeUndefined()
    const maxApplied = db
      .prepare('SELECT MAX(version) AS v FROM handshake_schema_migrations')
      .get() as { v: number }
    expect(maxApplied.v).toBeLessThanOrEqual(LEDGER_SCHEMA_FREEZE_VERSION)
  })

  it('≤v74 tables the pipeline needs (key store, high-water, nonces) DO exist on the frozen handle', () => {
    const db = makeLedgerShapedDb()
    for (const table of ['handshakes', 'handshake_key_store', 'wr_high_water_versions', 'wr_core_nonces']) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table),
        table,
      ).toBeTruthy()
    }
  })
})

describe('Phase 3 — ledger sweep & hygiene assertion (G5)', () => {
  it('sweep moves row-level key material to the key store and nulls the columns', () => {
    const db = makeLedgerShapedDb()
    // A row written with key material ON the row (pre-v73-shaped write that
    // landed after the migration already ran — exactly what the sweep exists for).
    db.prepare(
      `INSERT INTO handshakes (handshake_id, relationship_id, state, initiator_json, local_role,
         reciprocal_allowed, external_processing, tier_snapshot_json, current_tier_signals_json,
         effective_policy_json, created_at, local_private_key, local_x25519_private_key_b64)
       VALUES ('hs-sweep-1', 'rel-sweep-1', 'ACTIVE', '{}', 'initiator', 1, 'none', '{}', '{}',
         '{}', datetime('now'), 'PRIVATE_KEY_HEX', 'X25519_SECRET_B64')`,
    ).run()

    const summary = sweepLedgerForFreeze(db)
    expect(summary.keyRowsSwept).toBe(1)
    expect(summary.errors).toEqual([])

    const row = db
      .prepare('SELECT local_private_key, local_x25519_private_key_b64 FROM handshakes WHERE handshake_id = ?')
      .get('hs-sweep-1') as any
    expect(row.local_private_key).toBeNull()
    expect(row.local_x25519_private_key_b64).toBeNull()

    // Copy-before-null: the material survived in the (documented) key store.
    const stored = db
      .prepare('SELECT local_private_key, local_x25519_private_key_b64 FROM handshake_key_store WHERE handshake_id = ?')
      .get('hs-sweep-1') as any
    expect(stored.local_private_key).toBe('PRIVATE_KEY_HEX')
    expect(stored.local_x25519_private_key_b64).toBe('X25519_SECRET_B64')

    // Idempotent re-run is a no-op.
    const second = sweepLedgerForFreeze(db)
    expect(second.keyRowsSwept).toBe(0)
    expect(second.undocumentedTablesRemoved).toEqual([])
  })

  it('sweep copies out and drops undocumented tables; hygiene assertion passes afterwards', () => {
    const db = makeLedgerShapedDb()
    // An undocumented table written through the ledger handle (the
    // edge_ingestor class of schema bleed named in migration-and-risk §1.1).
    db.prepare(`CREATE TABLE edge_ingestor_pairings (id TEXT PRIMARY KEY, secret TEXT)`).run()
    db.prepare(`INSERT INTO edge_ingestor_pairings VALUES ('pair-1', 's3cret')`).run()

    const before = auditLedgerTables(db)
    expect(before.undocumented).toEqual(['edge_ingestor_pairings'])

    const dir = mkdtempSync(join(tmpdir(), 'wr-ledger-'))
    try {
      const summary = sweepLedgerForFreeze(db, { sidecarDir: dir })
      expect(summary.undocumentedTablesRemoved).toEqual(['edge_ingestor_pairings'])
      expect(summary.sidecarPath).toBeTruthy()

      // Copy-out happened before the drop.
      const sidecar = JSON.parse(readFileSync(summary.sidecarPath!, 'utf8'))
      expect(sidecar.tables.edge_ingestor_pairings).toEqual([{ id: 'pair-1', secret: 's3cret' }])
      expect(readdirSync(dir).length).toBe(1)

      const after = auditLedgerTables(db)
      expect(after.undocumented).toEqual([])

      const hygiene = assertLedgerHygiene(db)
      expect(hygiene).toEqual({ ok: true, undocumented: [], keyColumnsClear: true, integrityOk: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('integrity check passes on both handles: frozen (ledger-shaped) and full (vault-shaped)', () => {
    const frozen = makeLedgerShapedDb()
    sweepLedgerForFreeze(frozen)
    expect(assertLedgerHygiene(frozen).integrityOk).toBe(true)

    const full = new Database(':memory:')
    migrateHandshakeTables(full)
    // The full handle legitimately carries v75 tables — hygiene's
    // undocumented-check is ledger-specific, but integrity must hold.
    expect(assertLedgerHygiene(full).integrityOk).toBe(true)
    expect(assertLedgerHygiene(full).keyColumnsClear).toBe(true)
  })
})
