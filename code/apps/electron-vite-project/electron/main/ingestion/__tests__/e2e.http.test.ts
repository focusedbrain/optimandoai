/**
 * E2E HTTP Transport Tests
 *
 * Exercises the real Express router registered by registerIngestionRoutes(),
 * bound to an ephemeral port. Payloads flow through the full ingestion
 * pipeline — no mocking of ingestor, validator, or distributionGate.
 *
 * Target: POST /api/ingestion/ingest (production route)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startTestServer, type TestServerContext } from './helpers/testServer'
import {
  validBeapCapsule,
  malformedJsonString,
  oversizedBody,
  futureTimestampCapsule,
} from './fixtures/capsules'

let ctx: TestServerContext

beforeAll(async () => {
  ctx = await startTestServer()
})

afterAll(async () => {
  await ctx?.close()
})

async function postIngest(body: any, contentType = 'application/json') {
  const res = await fetch(`${ctx.baseUrl}/api/ingestion/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, body: json }
}

function ingestPayload(rawBody: string | Record<string, unknown>, sourceType = 'api') {
  return {
    rawInput: {
      body: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
    },
    sourceType,
    transportMeta: {},
  }
}

// ═══════════════════════════════════════════════════════════════════════
// H1–H5: HTTP Transport Tests
// ═══════════════════════════════════════════════════════════════════════

describe('E2E HTTP — POST /api/ingestion/ingest', () => {
  // H1: Valid BEAP (happy path)
  test('H1: valid BEAP capsule → 200, validated, routed to handshake_pipeline', async () => {
    const { status, body } = await postIngest(ingestPayload(validBeapCapsule()))

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.distribution?.target).toBe('handshake_pipeline')

    // Audit assertions
    expect(body.audit).toBeDefined()
    expect(body.audit.validation_result).toBe('validated')
    expect(body.audit.distribution_target).toBe('handshake_pipeline')
    expect(body.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(body.audit.raw_input_hash).toBeDefined()
    expect(body.audit.raw_input_hash.length).toBe(64)

    // DB: audit row exists
    const auditRows = ctx.db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('validated')
    expect(lastAudit.distribution_target).toBe('handshake_pipeline')
    expect(lastAudit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // H2: Malformed JSON → rejected, quarantine row
  test('H2: malformed JSON → 200 (pipeline returns), rejected, quarantine row exists', async () => {
    const { status, body } = await postIngest({
      rawInput: {
        body: malformedJsonString(),
        mime_type: 'application/vnd.beap+json',
      },
      sourceType: 'email',
      transportMeta: {},
    })

    expect(status).toBe(200)
    expect(body.success).toBe(false)
    // Hardening: client gets generic "Capsule rejected", not validation_reason_code
    expect(body.reason).toBe('Capsule rejected')

    // DB: quarantine row
    const quarantine = ctx.db.getQuarantineRows()
    expect(quarantine.length).toBeGreaterThanOrEqual(1)

    // DB: audit row
    const auditRows = ctx.db.getAuditRows()
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('rejected')
    expect(lastAudit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // H3: Oversized payload → rejected before parsing
  test('H3: oversized payload → rejected, no parsing', async () => {
    const { status, body } = await postIngest(
      ingestPayload(oversizedBody()),
    )

    expect(status).toBe(200)
    expect(body.success).toBe(false)

    // Audit row
    const auditRows = ctx.db.getAuditRows()
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.validation_result).toBe('rejected')
    expect(lastAudit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // H4: Future timestamp → validator passes, handshake responsibility split
  test('H4: future timestamp → validator passes, routed to handshake_pipeline', async () => {
    const { status, body } = await postIngest(
      ingestPayload(futureTimestampCapsule()),
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.distribution?.target).toBe('handshake_pipeline')

    // Audit: validated
    expect(body.audit.validation_result).toBe('validated')
  })

  // H5: Wrong content-type on rawInput, valid BEAP JSON → detection via JSON structure
  test('H5: rawInput with text/plain mime_type, valid BEAP JSON → detected via JSON structure', async () => {
    // The HTTP wrapper always uses application/json for the outer POST body.
    // The rawInput's mime_type is text/plain, simulating wrong content-type
    // at the original source level. The pipeline should still detect BEAP
    // via JSON structure analysis.
    const { status, body } = await postIngest({
      rawInput: {
        body: JSON.stringify(validBeapCapsule()),
        mime_type: 'text/plain',
      },
      sourceType: 'api',
      transportMeta: {},
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.distribution?.target).toBe('handshake_pipeline')
  })

  // Additional: unsupported schema version
  test('H-extra: unsupported schema_version → rejected at validator', async () => {
    const badPayload = { ...validBeapCapsule(), schema_version: 99 }
    const { status, body } = await postIngest(
      ingestPayload(badPayload),
    )

    expect(status).toBe(200)
    expect(body.success).toBe(false)
    // Hardening: client gets generic "Capsule rejected", not validation_reason_code
    expect(body.reason).toBe('Capsule rejected')
  })

  // Additional: plain text email → sandbox routing
  test('H-extra: plain text email → routed to sandbox', async () => {
    const { status, body } = await postIngest({
      rawInput: { body: 'Hello, this is a plain email.' },
      sourceType: 'email',
      transportMeta: {},
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.distribution?.target).toBe('sandbox_sub_orchestrator')
  })
})
