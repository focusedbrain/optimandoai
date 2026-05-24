/**
 * P1.10 parity tests — WR_POD_HOT_PATH feature flag
 *
 * Verifies that processIncomingInput produces equivalent results whether it
 * routes through the in-process path (flag OFF) or the pod hot path (flag ON,
 * backed by a mock ingestor server here).
 *
 * Mock server contract:
 *   The mock handler calls ingestInput + validateCapsule from ingestion-core
 *   directly (the same logic the real pod validator uses) and returns
 *   pod-format JSON so the Electron mapping layer is exercised end-to-end.
 *
 * Parity assertions:
 *   • success flag matches
 *   • validation_reason_code matches (rejection cases)
 *   • distribution.target matches (success cases)
 *   • distribution.validated_capsule.capsule content matches
 *     (excluding timestamp/version fields that legitimately differ)
 *
 * Note: audit timestamps and processing_duration_ms intentionally differ
 * between paths; only the fields above are compared.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import { ingestInput, validateCapsule, routeValidatedCapsule } from '@repo/ingestion-core'
import type { CandidateCapsuleEnvelope } from '@repo/ingestion-core'
import { processIncomingInput, isPodHotPathEnabled } from '../ingestionPipeline'
import type { RawInput, TransportMetadata } from '../types'

// ── Mock server ───────────────────────────────────────────────────────────────

interface MockServer {
  baseUrl: string
  stop(): Promise<void>
}

/**
 * Minimal pod-ingestor mock.
 *
 * Calls ingestInput + validateCapsule from ingestion-core and returns the
 * pod-format JSON response identical to what the real validator role returns.
 */
function startMockPodIngestor(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/ingest') {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }

      // Read body
      const chunks: Buffer[] = []
      for await (const chunk of req as AsyncIterable<Buffer>) {
        chunks.push(chunk)
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

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

      // Run ingestion-core ingestInput + validateCapsule — same as real pod validator
      let candidate: CandidateCapsuleEnvelope
      try {
        candidate = ingestInput(rawInput, sourceType as any, transportMeta)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'ingestInput threw', details: String(err) }))
        return
      }

      const validationResult = validateCapsule(candidate)

      const sendJson = (status: number, body: unknown) => {
        const json = JSON.stringify(body)
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(json)),
        })
        res.end(json)
      }

      if (!validationResult.success) {
        // Pod validator returns 422 { valid: false, reason, details }
        sendJson(422, {
          valid: false,
          reason: validationResult.reason,
          details: validationResult.details,
        })
        return
      }

      const validated = validationResult.validated

      // message_package → depackager not available in test; return validated inline
      // (In Phase 1, processIncomingInput for message_package routes to sandbox
      // without depackaging — this is consistent with the in-process path.)
      sendJson(200, {
        valid: true,
        needs_depackaging: validated.capsule.capsule_type === 'message_package',
        validated,
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        stop: () =>
          new Promise<void>((res, rej) => {
            if (typeof (server as any).closeAllConnections === 'function') {
              ;(server as any).closeAllConnections()
            }
            server.close((err) => (err ? rej(err) : res()))
          }),
      })
    })
    server.once('error', reject)
  })
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A structurally valid initiate capsule — routes to handshake_pipeline. */
function validInitiateCapsule(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-parity-001',
    sender_id: 'user-parity-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: '2026-05-24T09:00:00.000Z',
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  }
}

/** A plain email — routes to sandbox_sub_orchestrator (internal_draft). */
function plainEmail(): string {
  return 'Hello, this is a plain email with no BEAP capsule.'
}

/** Malformed JSON that triggers INGESTION_ERROR_PROPAGATED. */
function malformedBeap(): string {
  return '{ this is not valid json !!!'
}

const emptyTransport: TransportMetadata = {}

// ── Setup ─────────────────────────────────────────────────────────────────────

let mockServer: MockServer

beforeAll(async () => {
  mockServer = await startMockPodIngestor()
})

afterAll(async () => {
  await mockServer.stop()
})

afterEach(() => {
  // Always restore env after each test
  delete process.env['WR_POD_HOT_PATH']
  delete process.env['WR_POD_BASE_URL']
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runBothPaths(rawInput: RawInput, sourceType = 'email', transport = emptyTransport) {
  // In-process path (flag off)
  delete process.env['WR_POD_HOT_PATH']
  const inProcess = await processIncomingInput(rawInput, sourceType as any, transport)

  // Pod path (flag on, pointing at mock server)
  process.env['WR_POD_HOT_PATH'] = '1'
  process.env['WR_POD_BASE_URL'] = mockServer.baseUrl
  const podPath = await processIncomingInput(rawInput, sourceType as any, transport)

  return { inProcess, podPath }
}

// ── Parity tests ──────────────────────────────────────────────────────────────

describe('isPodHotPathEnabled', () => {
  test('returns false when WR_POD_HOT_PATH is unset', () => {
    delete process.env['WR_POD_HOT_PATH']
    expect(isPodHotPathEnabled()).toBe(false)
  })

  test('returns false when WR_POD_HOT_PATH=0', () => {
    process.env['WR_POD_HOT_PATH'] = '0'
    expect(isPodHotPathEnabled()).toBe(false)
  })

  test('returns true when WR_POD_HOT_PATH=1', () => {
    process.env['WR_POD_HOT_PATH'] = '1'
    expect(isPodHotPathEnabled()).toBe(true)
  })
})

describe('flag default is OFF', () => {
  test('WR_POD_HOT_PATH unset → in-process path used (no pod network call)', async () => {
    delete process.env['WR_POD_HOT_PATH']
    // The mock server is not targeted; any network call would go to the default
    // port 18100 which is not listening → would produce an error if called.
    // But since flag is off, this must succeed (in-process path used).
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
  })
})

describe('Parity — valid initiate capsule → handshake_pipeline', () => {
  test('success flag matches', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    expect(podPath.success).toBe(inProcess.success)
    expect(podPath.success).toBe(true)
  })

  test('distribution.target matches', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    if (inProcess.success && podPath.success) {
      expect(podPath.distribution.target).toBe(inProcess.distribution.target)
      expect(podPath.distribution.target).toBe('handshake_pipeline')
    }
  })

  test('capsule type in validated_capsule matches', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    if (inProcess.success && podPath.success) {
      expect(podPath.distribution.validated_capsule.capsule.capsule_type).toBe(
        inProcess.distribution.validated_capsule.capsule.capsule_type,
      )
      expect(podPath.distribution.validated_capsule.capsule.capsule_type).toBe('initiate')
    }
  })

  test('handshake_id in validated_capsule matches', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    if (inProcess.success && podPath.success) {
      const inProcessHsId = (inProcess.distribution.validated_capsule.capsule as any)['handshake_id']
      const podHsId = (podPath.distribution.validated_capsule.capsule as any)['handshake_id']
      expect(podHsId).toBe(inProcessHsId)
      expect(podHsId).toBe('hs-parity-001')
    }
  })

  test('audit validation_result matches', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    expect(podPath.audit.validation_result).toBe(inProcess.audit.validation_result)
    expect(podPath.audit.validation_result).toBe('validated')
  })
})

describe('Parity — plain email → sandbox_sub_orchestrator', () => {
  test('success flag matches', async () => {
    const rawInput: RawInput = { body: plainEmail() }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    expect(podPath.success).toBe(inProcess.success)
    expect(podPath.success).toBe(true)
  })

  test('distribution.target matches', async () => {
    const rawInput: RawInput = { body: plainEmail() }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    if (inProcess.success && podPath.success) {
      expect(podPath.distribution.target).toBe(inProcess.distribution.target)
      expect(podPath.distribution.target).toBe('sandbox_sub_orchestrator')
    }
  })

  test('capsule type matches (internal_draft)', async () => {
    const rawInput: RawInput = { body: plainEmail() }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    if (inProcess.success && podPath.success) {
      expect(podPath.distribution.validated_capsule.capsule.capsule_type).toBe(
        inProcess.distribution.validated_capsule.capsule.capsule_type,
      )
    }
  })
})

describe('Parity — rejection (INGESTION_ERROR_PROPAGATED)', () => {
  test('success flag matches (both false)', async () => {
    const rawInput: RawInput = {
      body: malformedBeap(),
      mime_type: 'application/vnd.beap+json',
    }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    expect(podPath.success).toBe(inProcess.success)
    expect(podPath.success).toBe(false)
  })

  test('validation_reason_code matches', async () => {
    const rawInput: RawInput = {
      body: malformedBeap(),
      mime_type: 'application/vnd.beap+json',
    }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    if (!inProcess.success && !podPath.success) {
      expect(podPath.validation_reason_code).toBe(inProcess.validation_reason_code)
    }
  })

  test('audit validation_result is "rejected" for both', async () => {
    const rawInput: RawInput = {
      body: malformedBeap(),
      mime_type: 'application/vnd.beap+json',
    }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    expect(podPath.audit.validation_result).toBe('rejected')
    expect(inProcess.audit.validation_result).toBe('rejected')
  })
})

describe('Parity — rejection (MISSING_REQUIRED_FIELD)', () => {
  test('success flag and reason code match for incomplete capsule', async () => {
    // capsule_hash missing — triggers MISSING_REQUIRED_FIELD
    const incomplete = {
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: 'hs-incomplete',
      sender_id: 'user-1',
      // capsule_hash deliberately omitted
      timestamp: new Date().toISOString(),
      wrdesk_policy_hash: 'b'.repeat(64),
      seq: 1,
      sender_public_key: 'c'.repeat(64),
      sender_signature: 'd'.repeat(128),
    }
    const rawInput: RawInput = { body: JSON.stringify(incomplete) }
    const { inProcess, podPath } = await runBothPaths(rawInput)
    expect(podPath.success).toBe(false)
    expect(podPath.success).toBe(inProcess.success)
    if (!inProcess.success && !podPath.success) {
      expect(podPath.validation_reason_code).toBe(inProcess.validation_reason_code)
    }
  })
})

describe('[pod-hot-path] logging prefix', () => {
  test('logs are prefixed [pod-hot-path] when flag is on', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
      origLog(...args)
    }

    try {
      process.env['WR_POD_HOT_PATH'] = '1'
      process.env['WR_POD_BASE_URL'] = mockServer.baseUrl
      const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
      await processIncomingInput(rawInput, 'email', emptyTransport)
    } finally {
      console.log = origLog
    }

    const podLogs = logs.filter((l) => l.includes('[pod-hot-path]'))
    expect(podLogs.length).toBeGreaterThan(0)
  })
})
