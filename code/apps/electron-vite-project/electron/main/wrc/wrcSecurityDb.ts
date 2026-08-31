/**
 * Run 5 — the WRC SECURITY DATABASE: the durable substrate for every piece of
 * WR Code security state that must survive process restart.
 *
 * Why its own native DB file (and not the handshake ledger or the vault):
 *
 *  - the ledger handle is FROZEN at schema v74 (G5, `LEDGER_SCHEMA_FREEZE_VERSION`)
 *    and hygiene-swept — tables from later handshake migrations are
 *    structurally prohibited there, which is precisely why the v77/v78 WRC
 *    tables never materialized on the production handle and the Run-2 stores
 *    silently fell back to memory (the Slice-0 inventory finding);
 *  - the vault handle is unlock-gated and account-scoped — generation floors
 *    and replay ledgers must exist whenever the runtime does, not whenever a
 *    vault happens to be open;
 *  - trust state must live in the same protection class as the ledger
 *    (`~/.opengiraffe/electron-data/`), where deleting a userData JSON file
 *    cannot reset it.
 *
 * Own additive migration chain (`wrc_schema_migrations`), versioned, never
 * destructive: existing rows are never modified or reinterpreted, and a DB
 * with no Run-5 rows starts from the empty state safely. The handshake
 * migration chain and the ledger freeze are untouched.
 *
 * FAIL CLOSED: `openWrcSecurityDb` throws when the DB cannot be opened or
 * migrated. Production composition (`wrcRuntime.ts`) does not catch that into
 * an in-memory store — persistence unavailable means resolution unavailable,
 * visibly, per the Run-5 order.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WrcGenerationFloorStore } from './namespaceDirectory'

const _require = createRequire(import.meta.url)
const moduleDir = dirname(fileURLToPath(import.meta.url))

/** Minimal handle shape shared with the other wrc store modules. */
export interface WrcSecurityDb {
  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { changes: number }
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  pragma(source: string): unknown
  close(): void
}

// ── SQLite loader (same resolution chain as the handshake ledger) ─────────────

let _DatabaseConstructor: (new (path: string) => WrcSecurityDb) | null = null

function loadSQLite(): new (path: string) => WrcSecurityDb {
  if (_DatabaseConstructor) return _DatabaseConstructor
  try {
    try {
      _DatabaseConstructor = _require('better-sqlite3')
    } catch {
      const path = _require('path') as typeof import('node:path')
      try {
        _DatabaseConstructor = _require(path.join(moduleDir, '..', '..', 'node_modules', 'better-sqlite3'))
      } catch {
        const { app } = _require('electron') as typeof import('electron')
        const resourcesPath = path.dirname(app.getAppPath())
        try {
          _DatabaseConstructor = _require(
            path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3'),
          )
        } catch {
          _DatabaseConstructor = _require(path.join(resourcesPath, 'node_modules', 'better-sqlite3'))
        }
      }
    }
    if (typeof _DatabaseConstructor !== 'function') {
      throw new Error('Could not find Database constructor in better-sqlite3')
    }
    return _DatabaseConstructor
  } catch (err) {
    throw new Error(
      `[WRC-SECURITY-DB] better-sqlite3 not available: ${err instanceof Error ? err.message : err}`,
    )
  }
}

// ── Migration chain (additive only) ───────────────────────────────────────────

interface WrcSecurityMigration {
  version: number
  description: string
  sql: string[]
}

export const WRC_SECURITY_MIGRATIONS: readonly WrcSecurityMigration[] = [
  {
    version: 1,
    description:
      'WRC security schema v1 (Run 5, Slice 2): durable trust floors and one-time-use state. ' +
      'wrc_directory_generation_floor — §XVI.6.4 Namespace Directory Record generation floor ' +
      'per Publisher Identifier (monotonic; a restart must never lower it). ' +
      'wrc_publisher_epoch_floor and wrc_entry_use_state re-home the v77/v78 handshake-chain ' +
      'tables (identical DDL) onto a handle production can actually reach — the ledger handle ' +
      'is frozen at v74 and never carried them. Insert-or-raise / CAS semantics live in the ' +
      'store statements; there is no lowering path in schema or code.',
    sql: [
      `CREATE TABLE IF NOT EXISTS wrc_directory_generation_floor (
        publisher_part TEXT PRIMARY KEY,
        generation_floor INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS wrc_publisher_epoch_floor (
        publisher_part TEXT PRIMARY KEY,
        epoch_floor INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS wrc_entry_use_state (
        publisher_part TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        use_limit INTEGER NOT NULL,
        use_scope TEXT NOT NULL,
        consume_at TEXT NOT NULL,
        claim_timeout_s INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        uses_taken INTEGER NOT NULL DEFAULT 0,
        claimed_by TEXT,
        claimed_at_s INTEGER,
        claim_request_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (publisher_part, entry_id)
      )`,
    ],
  },
  {
    version: 2,
    description:
      'WRC security schema v2 (Run 5, Slice 3): durable §XVI.13.7 device registry. ' +
      'wrc_device_record — tenant-signed Device Records, keyed (tenant_part, device_party_id) ' +
      'so a device registered beneath one tenant confers nothing beneath another; the signed ' +
      'JSON is authoritative, the columns are its index. Updates are generation-gated in the ' +
      'statement (only a HIGHER generation replaces a row), so revocations cannot be rolled ' +
      'back and a stale record cannot overwrite a newer one. wrc_counterpart_pass — Device ' +
      'Passes held by the C initiator, keyed by the FULL establishment triple ' +
      '(initiator, responder, device): a pass under C-parent A is a different row, and ' +
      'therefore a different trust decision, than the same device under C-parent B.',
    sql: [
      `CREATE TABLE IF NOT EXISTS wrc_device_record (
        tenant_part TEXT NOT NULL,
        device_party_id TEXT NOT NULL,
        principal_party_id TEXT NOT NULL,
        device_class TEXT NOT NULL,
        generation INTEGER NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_part, device_party_id)
      )`,
      `CREATE TABLE IF NOT EXISTS wrc_counterpart_pass (
        c_initiator_part TEXT NOT NULL,
        c_responder_part TEXT NOT NULL,
        device_party_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        pass_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (c_initiator_part, c_responder_part, device_party_id)
      )`,
    ],
  },
  {
    version: 3,
    description:
      'WRC security schema v3 (Run 5, Slices 4+5): durable Gate-5/Gate-6 replay and idempotency. ' +
      'wrc_relay_envelope — recipient-bound capsule custody (§XVI.7.5.2); envelope JSON authoritative, ' +
      'slot lookups take the latest deposit. wrc_relay_request_ledger — §XVI.7.5.9 relay replay ledger: ' +
      '(capsule_id, request_instance_id) → first claimant, INSERT-if-absent semantics in the store, so ' +
      'a used claim stays used across restart and concurrent first uses settle on one claimant. ' +
      'wrc_admission_request_ledger — Gate-6 request-id idempotency (§XVI.7.6): request_instance_id → ' +
      'admitted capsule, written only after every other admission leg passed; distinct from the relay ' +
      'ledger (idempotency is not replay) but sharing the same durable substrate.',
    sql: [
      `CREATE TABLE IF NOT EXISTS wrc_relay_envelope (
        capsule_id TEXT PRIMARY KEY,
        publisher_part TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        envelope_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_wrc_relay_envelope_slot
         ON wrc_relay_envelope (publisher_part, entry_key)`,
      `CREATE TABLE IF NOT EXISTS wrc_relay_request_ledger (
        capsule_id TEXT NOT NULL,
        request_instance_id TEXT NOT NULL,
        party_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (capsule_id, request_instance_id)
      )`,
      `CREATE TABLE IF NOT EXISTS wrc_admission_request_ledger (
        request_instance_id TEXT PRIMARY KEY,
        capsule_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 4,
    description:
      'WRC security schema v4 (Run 5, Slice 13): pruning indexes for bounded maintenance. ' +
      'Expiry/created-at indexes so maintainWrcSecurityDb can find prunable replay rows without ' +
      'a table scan. Indexes only — no row is modified, and nothing about the trust semantics ' +
      'of any store changes.',
    sql: [
      `CREATE INDEX IF NOT EXISTS idx_wrc_relay_envelope_expiry
         ON wrc_relay_envelope (expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_wrc_relay_request_ledger_created
         ON wrc_relay_request_ledger (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_wrc_admission_request_ledger_created
         ON wrc_admission_request_ledger (created_at)`,
    ],
  },
]

/** Apply the WRC security chain — additive, versioned, idempotent. */
export function migrateWrcSecuritySchema(db: WrcSecurityDb): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS wrc_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )`,
  ).run()
  for (const migration of WRC_SECURITY_MIGRATIONS) {
    const row = db
      .prepare('SELECT version FROM wrc_schema_migrations WHERE version = ?')
      .get(migration.version)
    if (row) continue
    const tx = db.transaction(() => {
      for (const sql of migration.sql) db.prepare(sql).run()
      db.prepare(
        'INSERT INTO wrc_schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
      ).run(migration.version, new Date().toISOString(), migration.description)
    })
    tx()
  }
}

// ── Open ──────────────────────────────────────────────────────────────────────

export function defaultWrcSecurityDbPath(): string {
  const env = process.env.WRDESK_WRC_SECURITY_DB
  if (env && env.trim()) return env.trim()
  const dir = join(homedir(), '.opengiraffe', 'electron-data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'wrc-security.db')
}

/**
 * Open (creating if absent) and migrate the security DB. THROWS on any
 * failure — the caller must treat that as "resolution unavailable", never as
 * "start with an empty memory store".
 */
export function openWrcSecurityDb(path?: string): WrcSecurityDb {
  const Database = loadSQLite()
  const db = new Database(path ?? defaultWrcSecurityDbPath())
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')
    migrateWrcSecuritySchema(db)
  } catch (e) {
    // Fail closed WITHOUT leaking the native handle (an open handle keeps the
    // file locked on Windows, blocking any operator remediation).
    try {
      db.close()
    } catch {
      /* the throw below is the story */
    }
    throw e
  }
  return db
}

// ── Maintenance (Run 5, Slice 13) ─────────────────────────────────────────────

export interface WrcMaintenanceOptions {
  /** Wall-clock seconds; injectable for tests. */
  nowS?: number
  /**
   * How long a replay/idempotency row outlives its security relevance before
   * pruning (seconds). Conservative default: 30 days — orders of magnitude
   * beyond any capsule validity window, so a pruned request id can only ever
   * belong to a capsule whose freshness check already refuses it. Override:
   * `WRDESK_WRC_REPLAY_RETENTION_S`.
   */
  retentionS?: number
  /** Per-table batch cap so resolution can never trigger an unbounded scan. */
  maxRowsPerTable?: number
}

export interface WrcMaintenanceResult {
  relayEnvelopesPruned: number
  relayLedgerRowsPruned: number
  admissionLedgerRowsPruned: number
}

function defaultRetentionS(): number {
  const env = Number(process.env.WRDESK_WRC_REPLAY_RETENTION_S)
  return Number.isFinite(env) && env > 0 ? env : 30 * 24 * 3600
}

/**
 * Bounded, lazy maintenance — the ONLY pruning path for the security DB.
 *
 * What it prunes, and why each cut cannot weaken security:
 *
 *  - `wrc_relay_envelope` rows whose `expires_at` passed more than the
 *    retention window ago. An expired envelope already refuses release
 *    (`capsule_expired`); retention keeps even that reason code stable for a
 *    generous window before the sealed bytes are finally dropped.
 *  - `wrc_relay_request_ledger` rows older than retention AND whose capsule
 *    envelope is gone or expired. A row whose envelope is still live is NEVER
 *    pruned regardless of age — pruning it would reopen a usable claim.
 *  - `wrc_admission_request_ledger` rows older than retention. A replayed
 *    request id after that point references a capsule far past every
 *    freshness window, so Gate 6 refuses it on its own predicates.
 *
 * What it deliberately RETAINS forever: generation floors and epoch floors
 * (rollback resistance), `wrc_entry_use_state` (consumption is permanent),
 * `wrc_device_record` and `wrc_counterpart_pass` (forgetting a revocation or
 * withdrawal could re-authorize stale material).
 *
 * Every DELETE is bounded via `rowid IN (SELECT … LIMIT ?)` — no unbounded
 * table scan can ride a resolution. No scheduler: the composition root calls
 * this once at startup.
 */
export function maintainWrcSecurityDb(
  db: WrcSecurityDb,
  options: WrcMaintenanceOptions = {},
): WrcMaintenanceResult {
  const nowS = options.nowS ?? Math.floor(Date.now() / 1000)
  const retentionS = options.retentionS ?? defaultRetentionS()
  const limit = options.maxRowsPerTable ?? 1000
  const expiryCutoffS = nowS - retentionS
  const createdCutoffIso = new Date(expiryCutoffS * 1000).toISOString()

  const relayEnvelopesPruned = db
    .prepare(
      `DELETE FROM wrc_relay_envelope WHERE rowid IN (
         SELECT rowid FROM wrc_relay_envelope WHERE expires_at < ? LIMIT ?
       )`,
    )
    .run(expiryCutoffS, limit).changes

  const relayLedgerRowsPruned = db
    .prepare(
      `DELETE FROM wrc_relay_request_ledger WHERE rowid IN (
         SELECT l.rowid FROM wrc_relay_request_ledger l
         LEFT JOIN wrc_relay_envelope e ON e.capsule_id = l.capsule_id
         WHERE l.created_at < ? AND (e.capsule_id IS NULL OR e.expires_at < ?)
         LIMIT ?
       )`,
    )
    .run(createdCutoffIso, nowS, limit).changes

  const admissionLedgerRowsPruned = db
    .prepare(
      `DELETE FROM wrc_admission_request_ledger WHERE rowid IN (
         SELECT rowid FROM wrc_admission_request_ledger WHERE created_at < ? LIMIT ?
       )`,
    )
    .run(createdCutoffIso, limit).changes

  return { relayEnvelopesPruned, relayLedgerRowsPruned, admissionLedgerRowsPruned }
}

// ── Store: §XVI.6.4 Directory Record generation floor ─────────────────────────

/**
 * Durable, monotonic Directory generation floor. Same two-operation contract
 * as the epoch floor (read / raise, never lower): the `WHERE excluded >`
 * upsert makes monotonicity a property of the statement, so concurrent
 * resolutions cannot race the floor backwards, and a restart reads whatever
 * the statement last accepted.
 */
export function createDbDirectoryGenerationFloorStore(db: WrcSecurityDb): WrcGenerationFloorStore {
  return {
    get(publisherPart) {
      const row = db
        .prepare(
          'SELECT generation_floor FROM wrc_directory_generation_floor WHERE publisher_part = ?',
        )
        .get(publisherPart) as { generation_floor?: unknown } | undefined
      if (row === undefined) return null
      const v = row.generation_floor
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
        // A PRESENT but malformed floor row is unknown history — that must
        // refuse (the client fails closed on a throwing store), never read as
        // "never seen" and wave a rolled-back record through.
        throw new Error(`malformed generation floor row for ${publisherPart}`)
      }
      return v
    },
    raise(publisherPart, generation) {
      if (!Number.isSafeInteger(generation) || generation < 0) return
      db.prepare(
        `INSERT INTO wrc_directory_generation_floor (publisher_part, generation_floor, updated_at)
           VALUES (?, ?, ?)
         ON CONFLICT(publisher_part) DO UPDATE SET
           generation_floor = excluded.generation_floor,
           updated_at       = excluded.updated_at
         WHERE excluded.generation_floor > wrc_directory_generation_floor.generation_floor`,
      ).run(publisherPart, generation, new Date().toISOString())
    },
  }
}
