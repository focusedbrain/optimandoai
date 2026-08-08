/**
 * Ledger freeze & sweep (Phase 3 — G5, prep for Q10).
 *
 * `handshake-ledger.db` historically received the FULL handshake migration
 * chain, so vault-schema tables (and, pre-v73, private-key columns) bled
 * into it. From Phase 3 on:
 *
 *  - the ledger handle is FROZEN at LEDGER_SCHEMA_FREEZE_VERSION (v74) —
 *    `migrateHandshakeTables(db, { freezeAtVersion })` never applies the
 *    core-store split (v75+) or anything later to it;
 *  - a ONE-TIME SWEEP (idempotent, re-runnable) copies out and removes
 *    private-key material from relationship rows and any undocumented
 *    tables written through the ledger handle;
 *  - a hygiene assertion verifies the ledger contains only documented
 *    tables, no key-material columns hold values, and the file passes
 *    SQLite integrity.
 *
 * Key-material destination: the ledger's OWN `handshake_key_store` (a
 * documented ≤v74 table). The ledger is the ACTIVE pipeline DB while the
 * vault is locked, so relationships formed through it must keep signing —
 * fully relocating keys off the ledger is coupled to its Phase-5
 * repurposing as the Tier-L evidence home (Q10). The sweep guarantees no
 * key ever sits on a RELATIONSHIP ROW (row-level v73 semantics, re-asserted).
 *
 * Undocumented tables are copied verbatim into a JSON sidecar file next to
 * the DB (copy-out) and then dropped.
 */

import { join } from 'path'
import { writeFileSync } from 'fs'
import { LEDGER_SCHEMA_FREEZE_VERSION, documentedHandshakeTableNames } from './db'

const LEDGER_NATIVE_TABLES: ReadonlySet<string> = new Set([
  'ledger_meta',
  'ledger_handshakes',
  'ledger_context_blocks',
  'ledger_schema_migrations',
  // Phase 5 (Q10): Tier-L evidence chain home — the only NEW table class
  // permitted on the ledger handle; written exclusively by evidenceChain.ts.
  'wr_evidence_chain',
])

const SWEEP_META_KEY = 'wr_ledger_sweep_v1'

function listUserTables(db: any): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

export interface LedgerTableAudit {
  documented: string[]
  undocumented: string[]
}

/** Classify every table on the handle against the documented manifest. */
export function auditLedgerTables(db: any): LedgerTableAudit {
  const manifest = documentedHandshakeTableNames(LEDGER_SCHEMA_FREEZE_VERSION)
  const documented: string[] = []
  const undocumented: string[] = []
  for (const name of listUserTables(db)) {
    if (manifest.has(name) || LEDGER_NATIVE_TABLES.has(name)) documented.push(name)
    else undocumented.push(name)
  }
  return { documented, undocumented }
}

export interface LedgerSweepSummary {
  keyRowsSwept: number
  undocumentedTablesRemoved: string[]
  sidecarPath: string | null
  errors: string[]
}

/**
 * One-time (idempotent) sweep before/under the freeze. Safe to call on every
 * open — a clean ledger sweeps to a no-op.
 */
export function sweepLedgerForFreeze(db: any, opts?: { sidecarDir?: string }): LedgerSweepSummary {
  const summary: LedgerSweepSummary = {
    keyRowsSwept: 0,
    undocumentedTablesRemoved: [],
    sidecarPath: null,
    errors: [],
  }

  // 1 — key material off relationship rows (re-assert v73 copy-before-null;
  // covers rows written by pre-v73 builds after the migration already ran).
  try {
    db.prepare(
      `INSERT INTO handshake_key_store (
         handshake_id, local_private_key, local_x25519_private_key_b64, local_mlkem768_secret_key_b64,
         created_at, updated_at
       )
       SELECT handshake_id, local_private_key, local_x25519_private_key_b64, local_mlkem768_secret_key_b64,
              datetime('now'), datetime('now')
         FROM handshakes
        WHERE local_private_key IS NOT NULL
           OR local_x25519_private_key_b64 IS NOT NULL
           OR local_mlkem768_secret_key_b64 IS NOT NULL
       ON CONFLICT(handshake_id) DO NOTHING`,
    ).run()
    const nulled = db.prepare(
      `UPDATE handshakes
          SET local_private_key = NULL,
              local_x25519_private_key_b64 = NULL,
              local_mlkem768_secret_key_b64 = NULL
        WHERE local_private_key IS NOT NULL
           OR local_x25519_private_key_b64 IS NOT NULL
           OR local_mlkem768_secret_key_b64 IS NOT NULL`,
    ).run()
    summary.keyRowsSwept = nulled.changes ?? 0
  } catch (e: any) {
    summary.errors.push(`key_sweep: ${e?.message}`)
  }

  // 2 — undocumented tables: copy out to a sidecar file, then drop.
  const audit = auditLedgerTables(db)
  if (audit.undocumented.length > 0) {
    const quarantine: Record<string, unknown[]> = {}
    for (const table of audit.undocumented) {
      try {
        // Table name comes from sqlite_master, not caller input; quote defensively.
        quarantine[table] = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all()
      } catch (e: any) {
        summary.errors.push(`copy_out:${table}: ${e?.message}`)
      }
    }
    if (opts?.sidecarDir) {
      try {
        const path = join(opts.sidecarDir, `handshake-ledger-sweep-${Date.now()}.json`)
        writeFileSync(path, JSON.stringify({ swept_at: new Date().toISOString(), tables: quarantine }, null, 2))
        summary.sidecarPath = path
      } catch (e: any) {
        summary.errors.push(`sidecar_write: ${e?.message}`)
      }
    }
    // Drop only what was copied out without error (copy-before-remove).
    for (const table of audit.undocumented) {
      if (!(table in quarantine)) continue
      if (opts?.sidecarDir && !summary.sidecarPath) continue
      try {
        db.prepare(`DROP TABLE IF EXISTS "${table.replace(/"/g, '""')}"`).run()
        summary.undocumentedTablesRemoved.push(table)
      } catch (e: any) {
        summary.errors.push(`drop:${table}: ${e?.message}`)
      }
    }
  }

  try {
    db.prepare(`INSERT OR REPLACE INTO ledger_meta (key, value) VALUES (?, ?)`).run(
      SWEEP_META_KEY,
      new Date().toISOString(),
    )
  } catch { /* meta marker is best-effort */ }

  return summary
}

export interface LedgerHygieneReport {
  ok: boolean
  undocumented: string[]
  keyColumnsClear: boolean
  integrityOk: boolean
}

/** Post-sweep assertion (acceptance test 6): documented tables only, no row-level keys, integrity ok. */
export function assertLedgerHygiene(db: any): LedgerHygieneReport {
  const audit = auditLedgerTables(db)
  let keyColumnsClear = true
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM handshakes
          WHERE local_private_key IS NOT NULL
             OR local_x25519_private_key_b64 IS NOT NULL
             OR local_mlkem768_secret_key_b64 IS NOT NULL`,
      )
      .get() as { n: number }
    keyColumnsClear = row.n === 0
  } catch {
    // No handshakes table at all — trivially clear.
  }
  let integrityOk = false
  try {
    const result = db.pragma('integrity_check')
    integrityOk = Array.isArray(result)
      ? result.length === 1 && String(result[0]?.integrity_check).toLowerCase() === 'ok'
      : String(result).toLowerCase() === 'ok'
  } catch {
    integrityOk = false
  }
  return {
    ok: audit.undocumented.length === 0 && keyColumnsClear && integrityOk,
    undocumented: audit.undocumented,
    keyColumnsClear,
    integrityOk,
  }
}
