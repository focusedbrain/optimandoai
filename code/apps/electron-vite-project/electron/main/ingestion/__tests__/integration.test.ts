import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { ingestInput, validateCapsule } from '@repo/ingestion-core'
import type { CandidateCapsuleEnvelope } from '@repo/ingestion-core'
import { processIncomingInput } from '../ingestionPipeline'
import type { RawInput, TransportMetadata } from '../types'

// ── Mock pod server (P1.12) ──
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
      const rawInput = { body: String(parsed['body'] ?? ''), mime_type: parsed['mime_type'] as string | undefined }
      const sourceType = (parsed['source_type'] as string) ?? 'api'
      let candidate: CandidateCapsuleEnvelope
      try { candidate = ingestInput(rawInput, sourceType as any, {}) }
      catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); return }
      const vr = validateCapsule(candidate)
      const json = vr.success
        ? JSON.stringify({ valid: true, needs_depackaging: false, validated: vr.validated })
        : JSON.stringify({ valid: false, reason: vr.reason, details: vr.details })
      res.writeHead(vr.success ? 200 : 422, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(json)) })
      res.end(json)
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

function validBeapPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    // Phase B: initiate now requires sender_public_key (64-char hex) and sender_signature (128-char hex).
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  }
}

const emptyTransport: TransportMetadata = {}

describe('Integration — Full Pipeline', () => {
  // Test 1: External valid BEAP → validated → distribution target
  test('external valid BEAP → validated → handshake_pipeline target', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
      expect(result.distribution.validated_capsule.__brand).toBe('ValidatedCapsule')
    }
  })

  // Test 2: Malformed BEAP → validator rejects
  test('malformed BEAP → validator rejects', async () => {
    const rawInput: RawInput = {
      body: '{invalid json!',
      mime_type: 'application/vnd.beap+json',
    }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED')
    }
  })

  // Test 3: Plain email → wrapped → validated → routed
  test('plain email → wrapped → validated → routed to sandbox', async () => {
    const rawInput: RawInput = { body: 'Hello, this is a plain email.' }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('sandbox_sub_orchestrator')
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('internal_draft')
    }
  })

  // Test 4: Valid capsule → audit record created
  test('valid capsule → audit record created', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.audit).toBeDefined()
    expect(result.audit.validation_result).toBe('validated')
    expect(result.audit.source_type).toBe('email')
    expect(result.audit.pipeline_version).toBeDefined()
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // Test 5: Rejected capsule → audit with reason
  test('rejected capsule → audit with reason code', async () => {
    const rawInput: RawInput = {
      body: JSON.stringify({ schema_version: 99, capsule_type: 'initiate' }),
    }
    const result = await processIncomingInput(rawInput, 'api', emptyTransport)
    expect(result.success).toBe(false)
    expect(result.audit.validation_result).toBe('rejected')
    if (!result.success) {
      expect(result.audit.validation_reason_code).toBeDefined()
    }
  })

  // Test 6: Internal source → internal origin classification
  test('internal source → origin_classification = internal', async () => {
    const rawInput: RawInput = {
      body: JSON.stringify({
        schema_version: 1,
        capsule_type: 'internal_draft',
        timestamp: new Date().toISOString(),
        content: 'internal',
      }),
    }
    const result = await processIncomingInput(rawInput, 'internal', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })

  // Test 7: Pipeline exception → fail-closed
  test('pipeline handles exceptions gracefully (fail-closed)', async () => {
    const rawInput = null as any
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(false)
    expect(result.audit).toBeDefined()
    expect(result.audit.validation_result).toBe('error')
  })

  // Test 8: Accept capsule routes to handshake_pipeline
  test('accept capsule routes to handshake_pipeline', async () => {
    const payload = {
      ...validBeapPayload(),
      capsule_type: 'accept',
      sharing_mode: 'receive-only',
      // Phase B: accept also requires countersigned_hash (128-char hex).
      countersigned_hash: 'e'.repeat(128),
    }
    const rawInput: RawInput = { body: JSON.stringify(payload) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })
})
