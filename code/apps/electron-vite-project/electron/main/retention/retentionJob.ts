/**
 * Retention Job — Ingestion Tables
 *
 * Bounded DB growth for ingestion_audit_log, ingestion_quarantine, sandbox_queue.
 *
 * Behavior:
 *   - Runs at app start + periodic interval (configurable)
 *   - Deletes rows per table (age first, then row cap)
 *   - Uses small batched deletes — no long-held locks
 *   - Never blocks handshake transactions (BEGIN IMMEDIATE unaffected)
 *   - Logs deletion counts per table (no sensitive content)
 *   - Idempotent and safe under concurrent invocation
 *   - Never deletes queued or processing sandbox tasks
 */

import type { RetentionConfig } from './retentionConfig'
import { DEFAULT_RETENTION_CONFIG } from './retentionConfig'

export interface RetentionRunResult {
  readonly audit_log_deleted: number;
  readonly quarantine_deleted: number;
  readonly sandbox_deleted: number;
  readonly duration_ms: number;
}

let retentionTimer: ReturnType<typeof setInterval> | null = null

export function startRetentionSchedule(
  db: any,
  config: RetentionConfig = DEFAULT_RETENTION_CONFIG,
): void {
  runRetentionJob(db, config)
  retentionTimer = setInterval(() => {
    runRetentionJob(db, config)
  }, config.interval_ms)
}

export function stopRetentionSchedule(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }
}

export function runRetentionJob(
  db: any,
  config: RetentionConfig = DEFAULT_RETENTION_CONFIG,
): RetentionRunResult {
  const startTime = performance.now()

  const auditDeleted = purgeAuditLog(db, config)
  const quarantineDeleted = purgeQuarantine(db, config)
  const sandboxDeleted = purgeSandboxQueue(db, config)

  const durationMs = Math.round(performance.now() - startTime)

  if (auditDeleted > 0 || quarantineDeleted > 0 || sandboxDeleted > 0) {
    console.log(
      `[RETENTION] Deleted: audit_log=${auditDeleted}, quarantine=${quarantineDeleted}, sandbox=${sandboxDeleted} (${durationMs}ms)`,
    )
  }

  return {
    audit_log_deleted: auditDeleted,
    quarantine_deleted: quarantineDeleted,
    sandbox_deleted: sandboxDeleted,
    duration_ms: durationMs,
  }
}

// ── Per-Table Purge Functions ──

function purgeAuditLog(db: any, config: RetentionConfig): number {
  let totalDeleted = 0

  // Age-based: delete rows older than max_age_days
  const cutoffDate = daysAgo(config.audit_log_max_age_days)
  totalDeleted += batchDelete(
    db,
    `DELETE FROM ingestion_audit_log WHERE timestamp < ? AND rowid IN (SELECT rowid FROM ingestion_audit_log WHERE timestamp < ? LIMIT ?)`,
    [cutoffDate, cutoffDate, config.batch_size],
    config.batch_size,
  )

  // Row-cap: if still over max_rows, delete oldest
  totalDeleted += enforceRowCap(
    db,
    'ingestion_audit_log',
    'timestamp',
    config.audit_log_max_rows,
    config.batch_size,
  )

  return totalDeleted
}

function purgeQuarantine(db: any, config: RetentionConfig): number {
  const cutoffDate = daysAgo(config.quarantine_max_age_days)
  return batchDelete(
    db,
    `DELETE FROM ingestion_quarantine WHERE created_at < ? AND rowid IN (SELECT rowid FROM ingestion_quarantine WHERE created_at < ? LIMIT ?)`,
    [cutoffDate, cutoffDate, config.batch_size],
    config.batch_size,
  )
}

function purgeSandboxQueue(db: any, config: RetentionConfig): number {
  let totalDeleted = 0

  // Age-based: delete processed tasks older than max_age_days
  // NEVER delete queued or processing tasks
  const cutoffDate = daysAgo(config.sandbox_processed_max_age_days)
  totalDeleted += batchDelete(
    db,
    `DELETE FROM sandbox_queue WHERE status = 'processed' AND updated_at < ? AND rowid IN (SELECT rowid FROM sandbox_queue WHERE status = 'processed' AND updated_at < ? LIMIT ?)`,
    [cutoffDate, cutoffDate, config.batch_size],
    config.batch_size,
  )

  // Row-cap: cap failed tasks
  totalDeleted += enforceRowCapFiltered(
    db,
    'sandbox_queue',
    'updated_at',
    "status = 'failed'",
    config.sandbox_failed_max_rows,
    config.batch_size,
  )

  return totalDeleted
}

// ── Helpers ──

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function batchDelete(
  db: any,
  sql: string,
  params: any[],
  batchSize: number,
): number {
  let totalDeleted = 0
  try {
    let deleted: number
    do {
      const result = db.prepare(sql).run(...params)
      deleted = result?.changes ?? 0
      totalDeleted += deleted
    } while (deleted >= batchSize)
  } catch {
    // Table may not exist yet — safe to ignore
  }
  return totalDeleted
}

function enforceRowCap(
  db: any,
  table: string,
  orderCol: string,
  maxRows: number,
  batchSize: number,
): number {
  let totalDeleted = 0
  try {
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
    if (countRow.count <= maxRows) return 0

    const excess = countRow.count - maxRows
    const batches = Math.ceil(excess / batchSize)
    for (let i = 0; i < batches; i++) {
      const limit = Math.min(batchSize, excess - totalDeleted)
      const result = db.prepare(
        `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} ORDER BY ${orderCol} ASC LIMIT ?)`,
      ).run(limit)
      totalDeleted += result?.changes ?? 0
    }
  } catch {
    // Table may not exist yet
  }
  return totalDeleted
}

function enforceRowCapFiltered(
  db: any,
  table: string,
  orderCol: string,
  filter: string,
  maxRows: number,
  batchSize: number,
): number {
  let totalDeleted = 0
  try {
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE ${filter}`).get() as { count: number }
    if (countRow.count <= maxRows) return 0

    const excess = countRow.count - maxRows
    const batches = Math.ceil(excess / batchSize)
    for (let i = 0; i < batches; i++) {
      const limit = Math.min(batchSize, excess - totalDeleted)
      const result = db.prepare(
        `DELETE FROM ${table} WHERE ${filter} AND rowid IN (SELECT rowid FROM ${table} WHERE ${filter} ORDER BY ${orderCol} ASC LIMIT ?)`,
      ).run(limit)
      totalDeleted += result?.changes ?? 0
    }
  } catch {
    // Table may not exist yet
  }
  return totalDeleted
}
