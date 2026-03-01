/**
 * Ingestion persistence layer.
 *
 * Tables:
 *   - ingestion_quarantine: invalid/rejected inputs
 *   - sandbox_queue: external drafts pending sandbox processing
 *   - ingestion_audit_log: per-pipeline audit records
 *
 * Dedup: raw_input_hash prevents unbounded growth.
 */

import type {
  IngestionAuditRecord,
  ValidationReasonCode,
  SandboxQueueStatus,
} from './types'

// ── Migration ──

const INGESTION_MIGRATIONS: Array<{
  version: number;
  description: string;
  sql: string[];
}> = [
  {
    version: 1,
    description: 'Ingestion quarantine, sandbox queue, audit tables',
    sql: [
      `CREATE TABLE IF NOT EXISTS ingestion_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_input_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        origin_classification TEXT NOT NULL,
        input_classification TEXT NOT NULL,
        validation_reason_code TEXT NOT NULL,
        validation_details TEXT,
        provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_quarantine_hash ON ingestion_quarantine(raw_input_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_quarantine_created ON ingestion_quarantine(created_at)`,

      `CREATE TABLE IF NOT EXISTS sandbox_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_input_hash TEXT NOT NULL,
        validated_capsule_json TEXT NOT NULL,
        routing_reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','processed','failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sandbox_hash ON sandbox_queue(raw_input_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_sandbox_status ON sandbox_queue(status)`,
      `CREATE INDEX IF NOT EXISTS idx_sandbox_created ON sandbox_queue(created_at)`,

      `CREATE TABLE IF NOT EXISTS ingestion_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        raw_input_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        origin_classification TEXT NOT NULL,
        input_classification TEXT NOT NULL,
        validation_result TEXT NOT NULL CHECK (validation_result IN ('validated','rejected','error')),
        validation_reason_code TEXT,
        distribution_target TEXT,
        processing_duration_ms INTEGER NOT NULL,
        pipeline_version TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ing_audit_ts ON ingestion_audit_log(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_ing_audit_hash ON ingestion_audit_log(raw_input_hash)`,

      `CREATE TABLE IF NOT EXISTS ingestion_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      )`,
    ],
  },
]

export function migrateIngestionTables(db: any): void {
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS ingestion_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )`).run()
  } catch (e: any) {
    console.warn('[INGESTION DB] Could not create migrations table:', e?.message)
  }

  for (const migration of INGESTION_MIGRATIONS) {
    try {
      const row = db.prepare(
        'SELECT version FROM ingestion_schema_migrations WHERE version = ?',
      ).get(migration.version) as { version: number } | undefined
      if (row) continue
    } catch { /* table may not exist yet */ }

    console.log(`[INGESTION DB] Applying migration v${migration.version}: ${migration.description}`)
    const tx = db.transaction(() => {
      for (const sql of migration.sql) {
        db.prepare(sql).run()
      }
      db.prepare(
        'INSERT INTO ingestion_schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
      ).run(migration.version, new Date().toISOString(), migration.description)
    })
    tx()
  }
}

// ── Quarantine Operations ──

export function insertQuarantineRecord(
  db: any,
  record: {
    raw_input_hash: string;
    source_type: string;
    origin_classification: string;
    input_classification: string;
    validation_reason_code: string;
    validation_details?: string;
    provenance_json: string;
  },
): boolean {
  try {
    db.prepare(`INSERT OR IGNORE INTO ingestion_quarantine
      (raw_input_hash, source_type, origin_classification, input_classification,
       validation_reason_code, validation_details, provenance_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.raw_input_hash,
      record.source_type,
      record.origin_classification,
      record.input_classification,
      record.validation_reason_code,
      record.validation_details ?? null,
      record.provenance_json,
      new Date().toISOString(),
    )
    return true
  } catch {
    return false
  }
}

export function listQuarantineRecords(db: any, limit: number = 100): any[] {
  try {
    return db.prepare(
      'SELECT * FROM ingestion_quarantine ORDER BY created_at DESC LIMIT ?',
    ).all(limit)
  } catch {
    return []
  }
}

export function getQuarantineCount(db: any): number {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM ingestion_quarantine').get() as { count: number }
    return row.count
  } catch {
    return 0
  }
}

// ── Sandbox Queue Operations ──

export function insertSandboxQueueItem(
  db: any,
  item: {
    raw_input_hash: string;
    validated_capsule_json: string;
    routing_reason: string;
  },
): boolean {
  const now = new Date().toISOString()
  try {
    db.prepare(`INSERT OR IGNORE INTO sandbox_queue
      (raw_input_hash, validated_capsule_json, routing_reason, status, created_at, updated_at, retry_count)
      VALUES (?, ?, ?, 'queued', ?, ?, 0)`,
    ).run(
      item.raw_input_hash,
      item.validated_capsule_json,
      item.routing_reason,
      now,
      now,
    )
    return true
  } catch {
    return false
  }
}

export function listSandboxQueueItems(
  db: any,
  status?: SandboxQueueStatus,
  limit: number = 100,
): any[] {
  try {
    if (status) {
      return db.prepare(
        'SELECT * FROM sandbox_queue WHERE status = ? ORDER BY created_at ASC LIMIT ?',
      ).all(status, limit)
    }
    return db.prepare(
      'SELECT * FROM sandbox_queue ORDER BY created_at ASC LIMIT ?',
    ).all(limit)
  } catch {
    return []
  }
}

export function updateSandboxQueueStatus(
  db: any,
  id: number,
  status: SandboxQueueStatus,
): void {
  db.prepare(
    'UPDATE sandbox_queue SET status = ?, updated_at = ? WHERE id = ?',
  ).run(status, new Date().toISOString(), id)
}

export function getSandboxQueueCount(db: any, status?: SandboxQueueStatus): number {
  try {
    if (status) {
      const row = db.prepare('SELECT COUNT(*) as count FROM sandbox_queue WHERE status = ?').get(status) as { count: number }
      return row.count
    }
    const row = db.prepare('SELECT COUNT(*) as count FROM sandbox_queue').get() as { count: number }
    return row.count
  } catch {
    return 0
  }
}

// ── Audit Log Operations ──

export function insertIngestionAuditRecord(db: any, record: IngestionAuditRecord): void {
  try {
    db.prepare(`INSERT INTO ingestion_audit_log
      (timestamp, raw_input_hash, source_type, origin_classification, input_classification,
       validation_result, validation_reason_code, distribution_target, processing_duration_ms, pipeline_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.timestamp,
      record.raw_input_hash,
      record.source_type,
      record.origin_classification,
      record.input_classification,
      record.validation_result,
      record.validation_reason_code ?? null,
      record.distribution_target ?? null,
      record.processing_duration_ms,
      record.pipeline_version,
    )
  } catch {
    // Audit log failures must not crash the pipeline
  }
}
