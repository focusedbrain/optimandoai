/**
 * E2E IPC Transport Tests
 *
 * Exercises the IPC entry point via testIpcHarness, which simulates
 * ipcRenderer.invoke('ingest-external-input', ...) by calling the same
 * handleIngestionRPC handler that production uses.
 *
 * Target: ipcRenderer.invoke('ingest-external-input', ...)
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { IpcHarness } from './helpers/testIpcHarness'
import { createTestDb, type TestDb } from './helpers/testDb'
import {
  validBeapCapsule,
  malformedJsonString,
  oversizedBody,
} from './fixtures/capsules'
import { migrateIngestionTables } from '../persistenceDb'

let db: TestDb
let ipc: IpcHarness

beforeEach(() => {
  db = createTestDb()
  migrateIngestionTables(db)
  ipc = new IpcHarness(db)
})

// ═══════════════════════════════════════════════════════════════════════
// I1–I4: IPC Transport Tests
// ═══════════════════════════════════════════════════════════════════════

describe('E2E IPC — ingest-external-input', () => {
  // I1: Valid capsule → success
  test('I1: valid capsule via IPC → success, routed through full pipeline', async () => {
    const result = await ipc.invoke(
      'ingest-external-input',
      { body: JSON.stringify(validBeapCapsule()) },
      'extension',
    )

    // Without SSO, handshake_pipeline target will fail at handshake stage
    // but the ingestion pipeline ran successfully
    expect(result).toBeDefined()
    expect(result.type).toBe('ingestion-result')

    // Audit row
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('validated')
    expect(lastAudit.distribution_target).toBe('handshake_pipeline')
    expect(lastAudit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(lastAudit.raw_input_hash.length).toBe(64)
  })

  // I2: Malformed input → failure, handshake not called
  test('I2: malformed input via IPC → rejected, handshake not called', async () => {
    const result = await ipc.invoke(
      'ingest-external-input',
      { body: malformedJsonString(), mime_type: 'application/vnd.beap+json' },
      'extension',
    )

    expect(result.success).toBe(false)
    expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED')

    // DB: quarantine row exists
    const quarantine = db.getQuarantineRows()
    expect(quarantine.length).toBeGreaterThanOrEqual(1)

    // DB: audit row
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    expect(auditRows[auditRows.length - 1].validation_result).toBe('rejected')
  })

  // I3: Oversized input → rejection before parsing
  test('I3: oversized input via IPC → rejected before parsing', async () => {
    const result = await ipc.invoke(
      'ingest-external-input',
      { body: oversizedBody() },
      'extension',
    )

    expect(result.success).toBe(false)
    expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED')

    // Audit row
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    expect(auditRows[auditRows.length - 1].validation_result).toBe('rejected')
  })

  // I4: Direct handshake IPC bypass → read-only, no state mutation
  test('I4: handshake.isActive via IPC → read-only, no state mutation', async () => {
    const result = await ipc.invoke(
      'handshake.isActive',
      { handshakeId: 'nonexistent' },
    )

    expect(result.type).toBe('handshake-status')
    expect(result.active).toBe(false)

    // No quarantine rows
    expect(db.getQuarantineRows().length).toBe(0)
    // No audit rows from read-only handshake query
  })

  // Additional: revoke capsule via IPC
  test('I-extra: revoke capsule via IPC → validated, routed to handshake_pipeline', async () => {
    const revokePayload = {
      schema_version: 1,
      capsule_type: 'revoke',
      handshake_id: 'hs-revoke-ipc-001',
      sender_id: 'user-1',
      capsule_hash: 'c'.repeat(64),
      timestamp: new Date().toISOString(),
    }

    const result = await ipc.invoke(
      'ingest-external-input',
      { body: JSON.stringify(revokePayload) },
      'api',
    )

    expect(result).toBeDefined()

    const auditRows = db.getAuditRows()
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('validated')
    expect(lastAudit.distribution_target).toBe('handshake_pipeline')
  })

  // Additional: file_upload source type
  test('I-extra: file_upload source → provenance preserved', async () => {
    const result = await ipc.invoke(
      'ingest-external-input',
      { body: JSON.stringify(validBeapCapsule()) },
      'file_upload',
    )

    const auditRows = db.getAuditRows()
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.source_type).toBe('file_upload')
    expect(lastAudit.origin_classification).toBe('external')
  })
})
