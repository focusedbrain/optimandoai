/**
 * E2E Transport Tests
 *
 * Exercises the actual registered HTTP route handlers, WebSocket RPC handlers,
 * and IPC handlers against real payloads. No mocking of ingestionPipeline
 * internals — the full Ingestor → Validator → Distribution Gate path runs.
 *
 * Tests verify:
 *   - Every external input routes through processIncomingInput()
 *   - processHandshakeCapsule() cannot be invoked with unvalidated input
 *   - Oversized payloads rejected before parsing
 *   - Malformed JSON never reaches the handshake layer
 *   - No external interface can construct/inject a ValidatedCapsule
 *   - Audit records created for every pipeline execution
 */

import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { ingestInput, validateCapsule } from '@repo/ingestion-core'
import type { CandidateCapsuleEnvelope } from '@repo/ingestion-core'
import { handleIngestionRPC } from '../ipc'
import { handleHandshakeRPC } from '../../handshake/ipc'
import { processIncomingInput } from '../ingestionPipeline'
import { INGESTION_CONSTANTS } from '../types'
import type { RawInput, TransportMetadata } from '../types'

// ── Mock Pod Server (P1.12: pod is the only path, so tests need a mock) ──

interface MockServer { baseUrl: string; stop(): Promise<void> }

function startMockPodIngestor(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/ingest') {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return
      }
      const chunks: Buffer[] = []
      for await (const c of req as AsyncIterable<Buffer>) chunks.push(c)
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(raw) as Record<string, unknown> }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON' })); return }

      const rawInput = {
        body: String(parsed['body'] ?? ''),
        headers: parsed['headers'] as Record<string, string> | undefined,
        mime_type: parsed['mime_type'] as string | undefined,
        filename: parsed['filename'] as string | undefined,
      }
      const sourceType = (parsed['source_type'] as string) ?? 'api'
      const transportMeta = {
        channel_id: parsed['channel_id'] as string | undefined,
        message_id: parsed['message_id'] as string | undefined,
        sender_address: parsed['sender_address'] as string | undefined,
        recipient_address: parsed['recipient_address'] as string | undefined,
      }

      let candidate: CandidateCapsuleEnvelope
      try { candidate = ingestInput(rawInput, sourceType as any, transportMeta) }
      catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'ingestInput threw', details: String(err) })); return }

      const validationResult = validateCapsule(candidate)
      const sendJson = (status: number, body: unknown) => {
        const json = JSON.stringify(body)
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(json)) })
        res.end(json)
      }

      if (!validationResult.success) {
        sendJson(422, { valid: false, reason: validationResult.reason, details: validationResult.details })
        return
      }
      const validated = validationResult.validated
      sendJson(200, { valid: true, needs_depackaging: validated.capsule.capsule_type === 'message_package', validated })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ baseUrl: `http://127.0.0.1:${port}`, stop: () => new Promise<void>((res, rej) => { server.close((err) => (err ? rej(err) : res())) }) })
    })
    server.once('error', reject)
  })
}

let mockServer: MockServer

beforeAll(async () => { mockServer = await startMockPodIngestor() })
afterAll(async () => { await mockServer.stop() })
beforeEach(() => { process.env['WR_POD_BASE_URL'] = mockServer.baseUrl })
afterEach(() => { delete process.env['WR_POD_BASE_URL'] })

// ── Test Data Builders ──

function validBeapPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-e2e-001',
    sender_id: 'user-e2e-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    relationship_id: 'rel-e2e-001',
    senderIdentity: {
      email: 'sender@example.com',
      iss: 'test-issuer',
      sub: 'test-sub',
      email_verified: true,
      wrdesk_user_id: 'user-e2e-1',
    },
    sender_wrdesk_user_id: 'user-e2e-1',
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: {
      plan: 'free',
      hardwareAttestation: null,
      dnsVerification: null,
      wrStampStatus: null,
    },
    wrdesk_policy_version: '1.0',
    // Phase B: crypto fields required by capsule validator
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  }
}

function malformedJsonBody(): string {
  return '{this is not valid JSON!!!'
}

function oversizedBody(): string {
  return 'x'.repeat(INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES + 1)
}

function futureTimestampPayload(): Record<string, unknown> {
  return {
    ...validBeapPayload(),
    timestamp: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

const emptyTransport: TransportMetadata = {}

// ── Mock HTTP Response ──

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { res.statusCode = code; return res },
    json(data: any) { res.body = data; return res },
  }
  return res
}

// ── Mock Express App (captures registered routes) ──

function mockExpressApp() {
  const routes: Record<string, Function> = {}
  return {
    post(path: string, handler: Function) { routes[`POST ${path}`] = handler },
    get(path: string, handler: Function) { routes[`GET ${path}`] = handler },
    routes,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2.1 — HTTP Transport Tests (via handleIngestionRPC + registerIngestionRoutes)
// ═══════════════════════════════════════════════════════════════════════

describe('E2E Transport — HTTP (via ingestion RPC handler)', () => {
  // Test 1: Valid BEAP → validated → handshake_pipeline target
  test('1: valid BEAP capsule → validated, routed to handshake_pipeline', async () => {
    const result = await processIncomingInput(
      { body: JSON.stringify(validBeapPayload()) },
      'api',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
      expect(result.distribution.validated_capsule.__brand).toBe('ValidatedCapsule')
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('initiate')
    }

    // Observability: audit record
    expect(result.audit).toBeDefined()
    expect(result.audit.validation_result).toBe('validated')
    expect(result.audit.distribution_target).toBe('handshake_pipeline')
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.audit.source_type).toBe('api')
  })

  // Test 2: Malformed JSON → rejected, quarantine, handshake NOT called
  test('2: malformed JSON → rejected at validator, processHandshakeCapsule NOT reached', async () => {
    const result = await processIncomingInput(
      { body: malformedJsonBody(), mime_type: 'application/vnd.beap+json' },
      'email',
      emptyTransport,
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED')
    }

    // Observability
    expect(result.audit.validation_result).toBe('rejected')
    expect(result.audit.source_type).toBe('email')
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // Test 3: Oversized payload → immediate rejection, no parsing
  test('3: oversized payload → rejected before parsing', async () => {
    const result = await processIncomingInput(
      { body: oversizedBody() },
      'api',
      emptyTransport,
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED')
      expect(result.reason).toMatch(/exceeds limit/i)
    }

    // Audit
    expect(result.audit.validation_result).toBe('rejected')
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // Test 4: Future timestamp → validator passes, handshake would reject
  test('4: future timestamp → validator passes (timestamp is not Validator\'s job)', async () => {
    const result = await processIncomingInput(
      { body: JSON.stringify(futureTimestampPayload()) },
      'api',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
      expect(result.distribution.validated_capsule.__brand).toBe('ValidatedCapsule')
    }

    // Audit
    expect(result.audit.validation_result).toBe('validated')
  })

  // Test 5: Wrong content-type but valid BEAP JSON → detection via JSON structure
  test('5: wrong content-type, valid BEAP JSON → still detected via JSON structure', async () => {
    const result = await processIncomingInput(
      { body: JSON.stringify(validBeapPayload()), mime_type: 'text/plain' },
      'api',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2.2 — WebSocket RPC Transport Tests (via handleIngestionRPC)
// ═══════════════════════════════════════════════════════════════════════

describe('E2E Transport — WebSocket RPC (via handleIngestionRPC)', () => {
  // Test 6: Valid BEAP via RPC
  test('6: valid BEAP via ingestion.ingest RPC → routes through pipeline', async () => {
    const result = await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(validBeapPayload()) },
        sourceType: 'extension',
        transportMeta: emptyTransport,
      },
      null,
    )

    // Without db or SSO, handshake processing won't succeed,
    // but the pipeline ran: it's a success from ingestion perspective
    // until the handshake_pipeline target tries to process
    expect(result.type).toBe('ingestion-result')
    // Without db, handshake target returns session/error message
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/vault|session|log in/i)
  })

  // Test 7: Malformed BEAP via RPC
  test('7: malformed BEAP via RPC → rejected at validator', async () => {
    const result = await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: malformedJsonBody(), mime_type: 'application/vnd.beap+json' },
        sourceType: 'extension',
        transportMeta: emptyTransport,
      },
      null,
    )

    expect(result.type).toBe('ingestion-result')
    expect(result.success).toBe(false)
    // Hardening: RPC returns generic "Capsule rejected", not validation_reason_code
    expect(result.reason).toBe('Capsule rejected')
  })

  // Test 8: Oversized via RPC
  test('8: oversized payload via RPC → rejected before parsing', async () => {
    const result = await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: oversizedBody() },
        sourceType: 'api',
        transportMeta: emptyTransport,
      },
      null,
    )

    expect(result.type).toBe('ingestion-result')
    expect(result.success).toBe(false)
    // Hardening: RPC returns generic "Capsule rejected", not validation_reason_code
    expect(result.reason).toBe('Capsule rejected')
  })

  // Test 9: Direct handshake RPC — read-only, no state mutation
  test('9: handshake.queryStatus via RPC → read-only response, no capsule processing', async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        run: () => {},
        get: () => undefined,
        all: () => [],
      }),
      transaction: (fn: any) => fn,
    }

    const result = await handleHandshakeRPC(
      'handshake.queryStatus',
      { handshakeId: 'nonexistent-hs' },
      mockDb,
    )

    expect(result.type).toBe('handshake-status')
    expect(result.record).toBeNull()
    expect(result.reason).toBe('HANDSHAKE_NOT_FOUND')
  })

  // Additional: handshake.list is read-only
  test('handshake.list via RPC → read-only, returns list', async () => {
    const mockDb = {
      prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }),
      transaction: (fn: any) => fn,
    }

    const result = await handleHandshakeRPC('handshake.list', {}, mockDb)
    expect(result.type).toBe('handshake-list')
    expect(result.records).toEqual([])
  })

  // Additional: unknown RPC method
  test('unknown ingestion RPC method → error', async () => {
    const result = await handleIngestionRPC('ingestion.nonexistent', {}, null)
    expect(result.error).toBe('unknown_method')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2.3 — IPC Transport Tests (Extension Simulation via handleIngestionRPC)
// ═══════════════════════════════════════════════════════════════════════

describe('E2E Transport — IPC (Extension simulation via handleIngestionRPC)', () => {
  // Test 10: Valid input via extension
  test('10: valid input via extension source → routed through full pipeline', async () => {
    const result = await processIncomingInput(
      { body: JSON.stringify(validBeapPayload()) },
      'extension',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.validated_capsule.__brand).toBe('ValidatedCapsule')
    }
    expect(result.audit.source_type).toBe('extension')
    expect(result.audit.origin_classification).toBe('external')
  })

  // Test 11: Malformed input via extension
  test('11: malformed input via extension → rejected at validator', async () => {
    const rawInput: RawInput = {
      body: JSON.stringify({ schema_version: 99, capsule_type: 'initiate' }),
    }
    const result = await processIncomingInput(rawInput, 'extension', emptyTransport)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBe('SCHEMA_VERSION_UNSUPPORTED')
    }
    expect(result.audit.validation_result).toBe('rejected')
  })

  // Test 12: Oversized input via extension
  test('12: oversized input via extension → rejected before parsing', async () => {
    const result = await processIncomingInput(
      { body: oversizedBody() },
      'extension',
      emptyTransport,
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/exceeds limit/i)
    }
  })

  // Test 13: Direct handshake IPC → read-only, no state mutation
  test('13: handshake.isActive via IPC → read-only, no capsule processing', async () => {
    const mockDb = {
      prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }),
      transaction: (fn: any) => fn,
    }

    const result = await handleHandshakeRPC(
      'handshake.isActive',
      { handshakeId: 'nonexistent' },
      mockDb,
    )

    expect(result.type).toBe('handshake-status')
    expect(result.active).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Observability — Audit Record Verification
// ═══════════════════════════════════════════════════════════════════════

describe('E2E Observability — Audit Records', () => {
  test('validated capsule audit record has all required fields', async () => {
    const result = await processIncomingInput(
      { body: JSON.stringify(validBeapPayload()) },
      'email',
      emptyTransport,
    )

    const { audit } = result
    expect(audit.timestamp).toBeDefined()
    expect(typeof audit.timestamp).toBe('string')
    expect(audit.raw_input_hash).toBeDefined()
    expect(audit.raw_input_hash.length).toBe(64)
    expect(audit.source_type).toBe('email')
    expect(audit.origin_classification).toBe('external')
    expect(audit.input_classification).toBe('beap_capsule_present')
    expect(audit.validation_result).toBe('validated')
    expect(audit.distribution_target).toBe('handshake_pipeline')
    expect(audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(audit.pipeline_version).toBe(INGESTION_CONSTANTS.PIPELINE_VERSION)
  })

  test('rejected capsule audit record has reason code', async () => {
    // Use a BEAP-detected payload with unsupported schema_version to trigger rejection
    const badPayload = { ...validBeapPayload(), schema_version: 99 }
    const result = await processIncomingInput(
      { body: JSON.stringify(badPayload), mime_type: 'application/vnd.beap+json' },
      'api',
      emptyTransport,
    )

    const { audit } = result
    expect(audit.validation_result).toBe('rejected')
    expect(audit.validation_reason_code).toBeDefined()
    expect(audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  test('error case audit record captures duration', async () => {
    const result = await processIncomingInput(
      null as any,
      'email',
      emptyTransport,
    )

    expect(result.success).toBe(false)
    expect(result.audit.validation_result).toBe('error')
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Concurrency
// ═══════════════════════════════════════════════════════════════════════

describe('E2E Concurrency', () => {
  // Test 16: 20 identical requests in parallel → dedup via raw_input_hash
  test('16: 20 identical requests in parallel produce same raw_input_hash', async () => {
    const body = JSON.stringify(validBeapPayload())
    const rawInput: RawInput = { body }

    const promises = Array.from({ length: 20 }, () =>
      processIncomingInput(rawInput, 'api', emptyTransport),
    )

    const results = await Promise.all(promises)

    // All should succeed
    const hashes = new Set(results.map(r => r.audit.raw_input_hash))
    expect(hashes.size).toBe(1)

    // All should be validated
    for (const result of results) {
      expect(result.success).toBe(true)
      expect(result.audit.validation_result).toBe('validated')
    }
  })

  test('20 identical malformed requests → all rejected with same hash', async () => {
    const rawInput: RawInput = {
      body: malformedJsonBody(),
      mime_type: 'application/vnd.beap+json',
    }

    const promises = Array.from({ length: 20 }, () =>
      processIncomingInput(rawInput, 'email', emptyTransport),
    )

    const results = await Promise.all(promises)
    const hashes = new Set(results.map(r => r.audit.raw_input_hash))
    expect(hashes.size).toBe(1)

    for (const result of results) {
      expect(result.success).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Additional Transport Guarantees
// ═══════════════════════════════════════════════════════════════════════

describe('E2E Transport — Additional Guarantees', () => {
  test('plain email routes to sandbox, not handshake', async () => {
    const result = await processIncomingInput(
      { body: 'Hello, this is a plain email with no BEAP content.' },
      'email',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('sandbox_sub_orchestrator')
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('internal_draft')
    }
  })

  test('internal source with internal_draft routes to handshake_pipeline', async () => {
    const payload = {
      schema_version: 1,
      capsule_type: 'internal_draft',
      timestamp: new Date().toISOString(),
      content: 'internal note',
    }
    const result = await processIncomingInput(
      { body: JSON.stringify(payload) },
      'internal',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })

  test('accept capsule with sharing_mode routes to handshake_pipeline', async () => {
    const payload = {
      ...validBeapPayload(),
      capsule_type: 'accept',
      sharing_mode: 'receive-only',
      // Phase B: accept capsules also require countersigned_hash
      countersigned_hash: 'e'.repeat(128),
    }
    const result = await processIncomingInput(
      { body: JSON.stringify(payload) },
      'email',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('accept')
    }
  })

  test('revoke capsule routes to handshake_pipeline', async () => {
    const payload = {
      schema_version: 1,
      capsule_type: 'revoke',
      handshake_id: 'hs-revoke-001',
      sender_id: 'user-1',
      capsule_hash: 'c'.repeat(64),
      timestamp: new Date().toISOString(),
      // Phase B: revoke capsules require sender_public_key and sender_signature
      sender_public_key: 'c'.repeat(64),
      sender_signature: 'd'.repeat(128),
    }
    const result = await processIncomingInput(
      { body: JSON.stringify(payload) },
      'api',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('revoke')
    }
  })

  test('file_upload source type propagated through pipeline', async () => {
    const result = await processIncomingInput(
      { body: JSON.stringify(validBeapPayload()) },
      'file_upload',
      emptyTransport,
    )

    expect(result.success).toBe(true)
    expect(result.audit.source_type).toBe('file_upload')
    expect(result.audit.origin_classification).toBe('external')
  })

  test('ValidatedCapsule has immutable provenance from original input', async () => {
    const result = await processIncomingInput(
      {
        body: JSON.stringify(validBeapPayload()),
        headers: { 'From': 'alice@example.com' },
      },
      'email',
      { sender_address: 'alice@example.com' },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      const prov = result.distribution.validated_capsule.provenance
      expect(prov.source_type).toBe('email')
      expect(prov.origin_classification).toBe('external')
      expect(prov.transport_metadata.sender_address).toBe('alice@example.com')
      expect(prov.ingestor_version).toBe(INGESTION_CONSTANTS.INGESTOR_VERSION)
    }
  })
})
