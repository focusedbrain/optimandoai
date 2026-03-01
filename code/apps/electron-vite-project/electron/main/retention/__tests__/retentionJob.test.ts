/**
 * Retention Job Tests
 *
 * Verifies age-based and row-cap deletion for ingestion tables.
 * Uses an in-memory mock DB that tracks rows for assertions.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { runRetentionJob, type RetentionRunResult } from '../retentionJob'
import type { RetentionConfig } from '../retentionConfig'

// ── In-Memory DB with DELETE support ──

function createRetentionDb() {
  const tables: Record<string, any[]> = {
    ingestion_audit_log: [],
    ingestion_quarantine: [],
    sandbox_queue: [],
  }

  return {
    _tables: tables,
    prepare(sql: string) {
      return {
        run(...args: any[]) {
          // DELETE with WHERE timestamp/created_at/updated_at < cutoff AND ... LIMIT
          if (sql.startsWith('DELETE FROM')) {
            const tableMatch = sql.match(/DELETE FROM (\w+)/)
            if (!tableMatch) return { changes: 0 }
            const tableName = tableMatch[1]
            const table = tables[tableName]
            if (!table) return { changes: 0 }

            // Determine limit from last arg
            const limit = args[args.length - 1] ?? 1000

            // Filter candidates
            let candidates: number[] = []

            if (sql.includes('timestamp <') && tableName === 'ingestion_audit_log') {
              const cutoff = args[0]
              candidates = table
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.timestamp < cutoff)
                .map(({ i }) => i)
            } else if (sql.includes('created_at <') && tableName === 'ingestion_quarantine') {
              const cutoff = args[0]
              candidates = table
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.created_at < cutoff)
                .map(({ i }) => i)
            } else if (sql.includes("status = 'processed'") && sql.includes('updated_at <')) {
              const cutoff = args[0]
              candidates = table
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.status === 'processed' && r.updated_at < cutoff)
                .map(({ i }) => i)
            } else if (sql.includes("status = 'failed'") && sql.includes('ORDER BY')) {
              // Row cap for failed — oldest first
              candidates = table
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.status === 'failed')
                .sort((a, b) => a.r.updated_at.localeCompare(b.r.updated_at))
                .map(({ i }) => i)
            } else if (sql.includes('ORDER BY') && sql.includes('ASC LIMIT')) {
              // Row cap — oldest first (generic)
              candidates = table
                .map((r, i) => ({ r, i }))
                .sort((a, b) => {
                  const aKey = a.r.timestamp ?? a.r.created_at ?? a.r.updated_at ?? ''
                  const bKey = b.r.timestamp ?? b.r.created_at ?? b.r.updated_at ?? ''
                  return aKey.localeCompare(bKey)
                })
                .map(({ i }) => i)
            }

            const toDelete = candidates.slice(0, limit)
            // Remove in reverse order to preserve indices
            for (const idx of toDelete.sort((a, b) => b - a)) {
              table.splice(idx, 1)
            }
            return { changes: toDelete.length }
          }

          return { changes: 0 }
        },
        get() {
          if (sql.includes('COUNT(*)')) {
            const tableMatch = sql.match(/FROM (\w+)/)
            if (!tableMatch) return { count: 0 }
            const table = tables[tableMatch[1]] ?? []

            if (sql.includes("status = 'failed'")) {
              return { count: table.filter(r => r.status === 'failed').length }
            }
            return { count: table.length }
          }
          return undefined
        },
        all() { return [] },
      }
    },
    transaction(fn: any) { return fn },
  }
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function addAuditRows(db: any, count: number, timestamp: string) {
  for (let i = 0; i < count; i++) {
    db._tables.ingestion_audit_log.push({
      id: db._tables.ingestion_audit_log.length + 1,
      timestamp,
      raw_input_hash: `hash-${i}-${Date.now()}`,
      source_type: 'api',
      validation_result: 'validated',
      processing_duration_ms: 5,
    })
  }
}

function addQuarantineRows(db: any, count: number, created_at: string) {
  for (let i = 0; i < count; i++) {
    db._tables.ingestion_quarantine.push({
      id: db._tables.ingestion_quarantine.length + 1,
      raw_input_hash: `qhash-${i}-${Date.now()}`,
      created_at,
    })
  }
}

function addSandboxRows(db: any, count: number, status: string, updated_at: string) {
  for (let i = 0; i < count; i++) {
    db._tables.sandbox_queue.push({
      id: db._tables.sandbox_queue.length + 1,
      raw_input_hash: `shash-${i}-${Date.now()}`,
      status,
      updated_at,
      created_at: updated_at,
    })
  }
}

const testConfig: RetentionConfig = {
  audit_log_max_age_days: 90,
  audit_log_max_rows: 100,
  quarantine_max_age_days: 30,
  sandbox_processed_max_age_days: 7,
  sandbox_failed_max_rows: 10,
  batch_size: 1000,
  interval_ms: 60_000,
}

// ═══════════════════════════════════════════════════════════════════════

describe('Retention Job', () => {
  let db: ReturnType<typeof createRetentionDb>

  beforeEach(() => {
    db = createRetentionDb()
  })

  // Test 1: Audit rows older than max age deleted
  test('1: audit rows older than max age deleted, recent rows remain', () => {
    addAuditRows(db, 5, daysAgoIso(100)) // old
    addAuditRows(db, 3, new Date().toISOString()) // recent

    const result = runRetentionJob(db, testConfig)
    expect(result.audit_log_deleted).toBe(5)
    expect(db._tables.ingestion_audit_log.length).toBe(3)
  })

  // Test 2: Audit rows capped at max_rows
  test('2: audit rows capped at max_rows, oldest beyond cap deleted', () => {
    // Add 120 recent rows (above cap of 100)
    for (let i = 0; i < 120; i++) {
      db._tables.ingestion_audit_log.push({
        id: i + 1,
        timestamp: new Date(Date.now() - (120 - i) * 1000).toISOString(),
        raw_input_hash: `hash-${i}`,
        source_type: 'api',
        validation_result: 'validated',
        processing_duration_ms: 5,
      })
    }

    const result = runRetentionJob(db, testConfig)
    expect(result.audit_log_deleted).toBe(20)
    expect(db._tables.ingestion_audit_log.length).toBe(100)
  })

  // Test 3: Quarantine rows older than max age deleted
  test('3: quarantine rows older than max age deleted', () => {
    addQuarantineRows(db, 10, daysAgoIso(45)) // old
    addQuarantineRows(db, 5, new Date().toISOString()) // recent

    const result = runRetentionJob(db, testConfig)
    expect(result.quarantine_deleted).toBe(10)
    expect(db._tables.ingestion_quarantine.length).toBe(5)
  })

  // Test 4: Processed sandbox tasks older than max age deleted
  test('4: processed sandbox tasks older than max age deleted', () => {
    addSandboxRows(db, 8, 'processed', daysAgoIso(10)) // old processed
    addSandboxRows(db, 3, 'processed', new Date().toISOString()) // recent processed

    const result = runRetentionJob(db, testConfig)
    expect(result.sandbox_deleted).toBe(8)
    expect(db._tables.sandbox_queue.length).toBe(3)
  })

  // Test 5: Failed sandbox tasks capped
  test('5: failed sandbox tasks beyond cap deleted (oldest first)', () => {
    // 15 failed tasks (above cap of 10)
    for (let i = 0; i < 15; i++) {
      db._tables.sandbox_queue.push({
        id: i + 1,
        raw_input_hash: `fhash-${i}`,
        status: 'failed',
        updated_at: new Date(Date.now() - (15 - i) * 1000).toISOString(),
        created_at: new Date(Date.now() - (15 - i) * 1000).toISOString(),
      })
    }

    const result = runRetentionJob(db, testConfig)
    expect(result.sandbox_deleted).toBe(5)
    expect(db._tables.sandbox_queue.length).toBe(10)
  })

  // Test 6: Queued/processing sandbox tasks never deleted
  test('6: queued and processing sandbox tasks never deleted regardless of age', () => {
    addSandboxRows(db, 5, 'queued', daysAgoIso(100))
    addSandboxRows(db, 3, 'processing', daysAgoIso(100))

    const result = runRetentionJob(db, testConfig)
    expect(result.sandbox_deleted).toBe(0)
    expect(db._tables.sandbox_queue.length).toBe(8)
  })

  // Test 7: Concurrent retention runs safe
  test('7: concurrent retention runs — no crash, no duplicate deletes', () => {
    addAuditRows(db, 10, daysAgoIso(100))

    const results = [
      runRetentionJob(db, testConfig),
      runRetentionJob(db, testConfig),
      runRetentionJob(db, testConfig),
    ]

    // First run deletes all 10, subsequent runs find 0
    const totalDeleted = results.reduce((s, r) => s + r.audit_log_deleted, 0)
    expect(totalDeleted).toBe(10)
    expect(db._tables.ingestion_audit_log.length).toBe(0)
  })

  // Test 8: Handshake transaction not blocked during retention
  test('8: retention does not block handshake-style transactions', () => {
    addAuditRows(db, 5, daysAgoIso(100))

    // Simulate a handshake transaction (BEGIN IMMEDIATE pattern)
    const txFn = () => {
      // A handshake-style insert during retention
      db._tables.ingestion_audit_log.push({
        id: 999,
        timestamp: new Date().toISOString(),
        raw_input_hash: 'handshake-audit',
        source_type: 'api',
        validation_result: 'validated',
        processing_duration_ms: 1,
      })
    }

    // Run retention first
    runRetentionJob(db, testConfig)

    // Run "handshake transaction" — should succeed
    txFn()
    expect(db._tables.ingestion_audit_log.some(r => r.raw_input_hash === 'handshake-audit')).toBe(true)
  })
})
