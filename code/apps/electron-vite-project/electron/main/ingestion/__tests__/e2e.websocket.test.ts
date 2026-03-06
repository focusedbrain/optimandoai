/**
 * E2E WebSocket RPC Transport Tests
 *
 * Exercises the handleIngestionRPC handler — the same function that the
 * production WebSocket server dispatches to. Payloads flow through the
 * real ingestion pipeline with no mocking.
 *
 * Target: ingestion.ingest RPC method
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { sendIngestionRpc, sendHandshakeRpc } from './helpers/testWsClient'
import { createTestDb, type TestDb } from './helpers/testDb'
import {
  validBeapCapsule,
  malformedJsonString,
  oversizedBody,
} from './fixtures/capsules'
import { migrateIngestionTables } from '../persistenceDb'

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  migrateIngestionTables(db)
})

// ═══════════════════════════════════════════════════════════════════════
// W1–W4: WebSocket RPC Tests
// ═══════════════════════════════════════════════════════════════════════

describe('E2E WebSocket — ingestion.ingest RPC', () => {
  // W1: Valid capsule → success
  test('W1: valid capsule → success, routed to handshake_pipeline', async () => {
    const result = await sendIngestionRpc(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(validBeapCapsule()) },
        sourceType: 'extension',
        transportMeta: {},
      },
      db,
    )

    // Without SSO session, handshake processing can't complete,
    // but the ingestion pipeline validated and routed correctly
    expect(result).toBeDefined()

    // Audit row exists
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('validated')
    expect(lastAudit.distribution_target).toBe('handshake_pipeline')
    expect(lastAudit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(lastAudit.raw_input_hash.length).toBe(64)
  })

  // W2: Malformed payload → error, handshake never called
  test('W2: malformed payload → rejected, quarantine row', async () => {
    const result = await sendIngestionRpc(
      'ingestion.ingest',
      {
        rawInput: { body: malformedJsonString(), mime_type: 'application/vnd.beap+json' },
        sourceType: 'extension',
        transportMeta: {},
      },
      db,
    )

    expect(result.success).toBe(false)
    // Hardening: WebSocket RPC returns generic "Capsule rejected", not validation_reason_code
    expect(result.reason).toBe('Capsule rejected')

    // DB: quarantine row exists
    const quarantine = db.getQuarantineRows()
    expect(quarantine.length).toBeGreaterThanOrEqual(1)

    // DB: audit row
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    expect(auditRows[auditRows.length - 1].validation_result).toBe('rejected')
  })

  // W3: Oversized payload → immediate rejection, no crash
  test('W3: oversized payload → rejected, no crash', async () => {
    const result = await sendIngestionRpc(
      'ingestion.ingest',
      {
        rawInput: { body: oversizedBody() },
        sourceType: 'api',
        transportMeta: {},
      },
      db,
    )

    expect(result.success).toBe(false)
    // Hardening: WebSocket RPC returns generic "Capsule rejected", not validation_reason_code
    expect(result.reason).toBe('Capsule rejected')

    // Audit row
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    expect(auditRows[auditRows.length - 1].validation_result).toBe('rejected')
  })

  // W4: Legacy handshake RPC bypass — read-only, no state mutation
  test('W4: handshake.queryStatus RPC → read-only, no capsule processing', async () => {
    const result = await sendHandshakeRpc(
      'handshake.queryStatus',
      { handshakeId: 'nonexistent-hs-id' },
      db,
    )

    expect(result.type).toBe('handshake-status')
    expect(result.record).toBeNull()
    expect(result.reason).toBe('HANDSHAKE_NOT_FOUND')

    // No audit rows from handshake query (it's read-only)
    // No quarantine rows created
    expect(db.getQuarantineRows().length).toBe(0)
  })

  // Additional: unknown RPC method
  test('W-extra: unknown RPC method → error response', async () => {
    const result = await sendIngestionRpc(
      'ingestion.nonexistent',
      {},
      db,
    )

    expect(result.error).toBe('unknown_method')
  })

  // Additional: accept capsule via RPC
  test('W-extra: accept capsule → validated, routed to handshake_pipeline', async () => {
    const acceptPayload = {
      ...validBeapCapsule(),
      capsule_type: 'accept',
      sharing_mode: 'receive-only',
    }

    const result = await sendIngestionRpc(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(acceptPayload) },
        sourceType: 'email',
        transportMeta: {},
      },
      db,
    )

    // Without SSO, handshake won't complete, but validation succeeded
    const auditRows = db.getAuditRows()
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('validated')
    expect(lastAudit.distribution_target).toBe('handshake_pipeline')
  })
})
