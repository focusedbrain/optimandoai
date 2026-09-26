/**
 * Phase 3 — Core store + runtime split: acceptance tests.
 *
 * 4. Migration parity — dry-run harness over a fixture DB with real-shape
 *    legacy rows: (a) row-count parity old table ↔ core+runtime, (b) every
 *    legacy row resolves to a `legacy_v0` core record the dispatcher
 *    accepts, (c) post-migration state round-trips pass on migrated
 *    relationships, (d) sign/decrypt key material still resolves (Phase-2
 *    key store).
 * 5. Hash stability (T2) — a core record's hash is stable across process
 *    restarts (file reopen), migrations (re-run), and read/write round
 *    trips; no code path mutates a core record in place (SQL triggers +
 *    structural writer scan).
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  migrateHandshakeTables,
  insertHandshakeRecord,
  updateHandshakeRecord,
  getHandshakeRecord,
  getHandshakeKeys,
  LEDGER_SCHEMA_FREEZE_VERSION,
} from '../db'
import {
  buildSyntheticLegacyCore,
  computeCoreStoreHash,
  getCoreRow,
  getRuntimeRow,
  verifyCoreRowHash,
  insertCoreRecord,
  hasWrCoreStore,
} from '../coreStore'
import { getHighWater } from '../antiRollback'
import { resolveProfile } from '@repo/ingestion-core'
import type { WrHandshakeCore } from '@repo/ingestion-core'
import { HandshakeState } from '../types'
import { buildActiveHandshakeRecord } from './helpers'

function record(id: string, overrides?: Parameters<typeof buildActiveHandshakeRecord>[0]) {
  return buildActiveHandshakeRecord({
    handshake_id: id,
    relationship_id: `rel-${id}`,
    local_private_key: 'a'.repeat(64),
    local_public_key: 'b'.repeat(64),
    ...overrides,
  })
}

/** Fixture: a DB in the PRE-SPLIT shape (frozen at v74) with legacy rows. */
function makePreSplitDbWithRows(ids: string[]): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db, { freezeAtVersion: LEDGER_SCHEMA_FREEZE_VERSION })
  expect(hasWrCoreStore(db)).toBe(false)
  for (const id of ids) insertHandshakeRecord(db, record(id))
  return db
}

describe('Phase 3 — acceptance 4: migration parity (dry-run harness)', () => {
  it('(a) row-count parity: handshakes ↔ wr_handshake_core ↔ wr_handshake_runtime', () => {
    const ids = ['hs-p3-1', 'hs-p3-2', 'hs-p3-3']
    const db = makePreSplitDbWithRows(ids)

    // The split migration + backfill (what a real DB experiences on upgrade).
    migrateHandshakeTables(db)
    expect(hasWrCoreStore(db)).toBe(true)

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    expect(count('wr_handshake_core')).toBe(count('handshakes'))
    expect(count('wr_handshake_runtime')).toBe(count('handshakes'))
    expect(count('handshakes')).toBe(ids.length)
  })

  it('(b) every legacy row resolves to a legacy_v0 core record the dispatcher accepts — no fabricated signatures/provenance', () => {
    const db = makePreSplitDbWithRows(['hs-p3-b1', 'hs-p3-b2'])
    migrateHandshakeTables(db)

    for (const id of ['hs-p3-b1', 'hs-p3-b2']) {
      const row = getCoreRow(db, id)
      expect(row).toBeTruthy()
      expect(row!.profile_id).toBe('legacy_v0')
      expect(row!.profile_version).toBe(1)
      expect(resolveProfile(row!.profile_id, row!.profile_version).ok).toBe(true)
      expect(row!.backfilled).toBe(1)
      expect(row!.capture_provenance).toBe('unknown_legacy')
      // NEVER fabricated: empty signature list, null ingress_path.
      expect(JSON.parse(row!.signatures_json)).toEqual([])
      const core = JSON.parse(row!.core_json) as WrHandshakeCore
      expect(core.ingress_path).toBeNull()
      expect(core.nonce).toBe('')
      // High-water tracking begins for core-record versions.
      expect(getHighWater(db, 'wr.handshake.core', id)).toBe(1)
    }
  })

  it('(c) post-migration state round-trips pass on migrated relationships; runtime mirrors, core stays frozen', () => {
    const db = makePreSplitDbWithRows(['hs-p3-c1'])
    migrateHandshakeTables(db)

    const before = getCoreRow(db, 'hs-p3-c1')!
    const rec = getHandshakeRecord(db, 'hs-p3-c1')!
    expect(rec.state).toBe(HandshakeState.ACTIVE)

    // Refresh-style mutation.
    updateHandshakeRecord(db, { ...rec, last_seq_sent: 7, last_capsule_hash_sent: 'h7' })
    // Revoke.
    const rec2 = getHandshakeRecord(db, 'hs-p3-c1')!
    updateHandshakeRecord(db, {
      ...rec2,
      state: HandshakeState.REVOKED,
      revoked_at: new Date().toISOString(),
      revocation_source: 'local-user',
    })

    const runtime = getRuntimeRow(db, 'hs-p3-c1')!
    expect(runtime.state).toBe('REVOKED')
    expect(runtime.last_seq_sent).toBe(7)

    // The core record is byte-identical after all mutations.
    const after = getCoreRow(db, 'hs-p3-c1')!
    expect(after.core_hash).toBe(before.core_hash)
    expect(after.core_json).toBe(before.core_json)
  })

  it('(d) key material still resolves post-split (Phase-2 key store intact)', () => {
    const db = makePreSplitDbWithRows(['hs-p3-d1'])
    migrateHandshakeTables(db)

    const keys = getHandshakeKeys(db, 'hs-p3-d1')
    expect(keys?.local_private_key).toBe('a'.repeat(64))
    const rec = getHandshakeRecord(db, 'hs-p3-d1')!
    expect(rec.local_private_key).toBe('a'.repeat(64))
    // Rows stay clean of key material.
    const raw = db.prepare('SELECT local_private_key FROM handshakes WHERE handshake_id = ?').get('hs-p3-d1') as any
    expect(raw.local_private_key).toBeNull()
  })

  it('backfill is idempotent: re-running migrations leaves core rows byte-identical', () => {
    const db = makePreSplitDbWithRows(['hs-p3-i1'])
    migrateHandshakeTables(db)
    const first = getCoreRow(db, 'hs-p3-i1')!
    migrateHandshakeTables(db)
    const second = getCoreRow(db, 'hs-p3-i1')!
    expect(second.core_hash).toBe(first.core_hash)
    expect(second.core_json).toBe(first.core_json)
    const n = (db.prepare('SELECT COUNT(*) AS n FROM wr_handshake_core').get() as { n: number }).n
    expect(n).toBe(1)
  })

  it('new relationship writes dual-write through the adapter (single writer in db.ts)', () => {
    const db = new Database(':memory:')
    migrateHandshakeTables(db)
    insertHandshakeRecord(db, record('hs-p3-new'))
    const core = getCoreRow(db, 'hs-p3-new')
    expect(core).toBeTruthy()
    expect(core!.profile_id).toBe('legacy_v0')
    expect(core!.backfilled).toBe(0)
    expect(getRuntimeRow(db, 'hs-p3-new')).toBeTruthy()
  })
})

describe('Phase 3 — acceptance 5: hash stability (T2) + append-only store', () => {
  it('core hash is stable across serialize/parse round-trips and independent equal constructions', () => {
    const rec = record('hs-p3-h1')
    const core1 = buildSyntheticLegacyCore(rec)
    const core2 = buildSyntheticLegacyCore({ ...rec })
    expect(computeCoreStoreHash(core1)).toBe(computeCoreStoreHash(core2))
    const roundTripped = JSON.parse(JSON.stringify(core1)) as WrHandshakeCore
    expect(computeCoreStoreHash(roundTripped)).toBe(computeCoreStoreHash(core1))
  })

  it('core hash is stable across a process-restart-shaped reopen (file-backed DB)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wr-core-'))
    const path = join(dir, 'fixture.db')
    try {
      let db = new Database(path)
      migrateHandshakeTables(db)
      insertHandshakeRecord(db, record('hs-p3-h2'))
      const before = getCoreRow(db, 'hs-p3-h2')!
      db.close()

      db = new Database(path)
      migrateHandshakeTables(db) // migrations re-run on every open — must be inert
      const after = getCoreRow(db, 'hs-p3-h2')!
      expect(after.core_hash).toBe(before.core_hash)
      expect(after.core_json).toBe(before.core_json)
      expect(verifyCoreRowHash(after)).toBe(true)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the store itself aborts UPDATE and DELETE on wr_handshake_core (append-only triggers)', () => {
    const db = new Database(':memory:')
    migrateHandshakeTables(db)
    insertHandshakeRecord(db, record('hs-p3-h3'))

    expect(() =>
      db.prepare("UPDATE wr_handshake_core SET capture_provenance = 'forged' WHERE handshake_id = ?").run('hs-p3-h3'),
    ).toThrow(/append-only/)
    expect(() =>
      db.prepare('DELETE FROM wr_handshake_core WHERE handshake_id = ?').run('hs-p3-h3'),
    ).toThrow(/append-only/)
  })

  it('a differing core for an existing handshake is refused (immutability, [VII.3.3])', () => {
    const db = new Database(':memory:')
    migrateHandshakeTables(db)
    insertHandshakeRecord(db, record('hs-p3-h4'))
    const original = getCoreRow(db, 'hs-p3-h4')!

    const differing = buildSyntheticLegacyCore(record('hs-p3-h4', { created_at: '2001-01-01T00:00:00.000Z' }))
    const result = insertCoreRecord(db, {
      core: differing,
      handshakeId: 'hs-p3-h4',
      signatures: [],
      captureProvenance: 'unknown_legacy',
      backfilled: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.inserted).toBe(false)
      expect(result.coreHash).toBe(original.core_hash) // existing core wins
    }
    expect(getCoreRow(db, 'hs-p3-h4')!.core_json).toBe(original.core_json)
  })

  it('anti-rollback: a core version below the high-water mark is rejected', () => {
    const db = new Database(':memory:')
    migrateHandshakeTables(db)
    const core = buildSyntheticLegacyCore(record('hs-p3-h5'))
    const v2 = insertCoreRecord(db, {
      core,
      handshakeId: 'hs-p3-h5',
      signatures: [],
      captureProvenance: 'unknown_legacy',
      backfilled: false,
      coreVersion: 2,
    })
    expect(v2.ok).toBe(true)
    const v1 = insertCoreRecord(db, {
      core,
      handshakeId: 'hs-p3-h5',
      signatures: [],
      captureProvenance: 'unknown_legacy',
      backfilled: false,
      coreVersion: 1,
    })
    expect(v1.ok).toBe(false)
    if (!v1.ok) expect(v1.reason).toBe('rollback')
  })

  it('structural: no source writer targets wr_handshake_core rows for UPDATE or DELETE', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const roots = [resolve(here, '..', '..')] // electron/main
    const offenders: string[] = []
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const st = statSync(full)
        if (st.isDirectory()) {
          if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue
          visit(full)
        } else if (/\.(ts|js)$/.test(entry)) {
          const text = readFileSync(full, 'utf8')
          if (/UPDATE\s+wr_handshake_core/i.test(text) || /DELETE\s+FROM\s+wr_handshake_core/i.test(text)) {
            offenders.push(full)
          }
        }
      }
    }
    for (const root of roots) visit(root)
    expect(offenders).toEqual([])
  })
})
