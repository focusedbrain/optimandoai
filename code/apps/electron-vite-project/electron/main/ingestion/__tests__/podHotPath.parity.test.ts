/**
 * P1.12 pod-path tests
 *
 * Verifies that processIncomingInput (now always pod-backed) routes through
 * the pod ingestor and produces correct results for the four key cases.
 *
 * All tests point WR_POD_BASE_URL at a local mock server that runs
 * ingestInput + validateCapsule from ingestion-core — the same logic as the
 * real pod validator — so the Electron mapping layer is exercised end-to-end.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import { ingestInput, validateCapsule } from '@repo/ingestion-core'
import type { CandidateCapsuleEnvelope } from '@repo/ingestion-core'
import { processIncomingInput } from '../ingestionPipeline'
import type { RawInput, TransportMetadata } from '../types'
import {
  _setResolverInputsOverrideForTest,
  _resetIngestionModeServiceForTest,
} from '../ingestionModeService.js'
import { DEFAULT_EDGE_TIER_SETTINGS } from '../../edge-tier/settings.js'

// ── Mock server ───────────────────────────────────────────────────────────────

interface MockServer {
  baseUrl: string
  stop(): Promise<void>
}

function startMockPodIngestor(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/ingest') {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }

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
        sendJson(422, {
          valid: false,
          reason: validationResult.reason,
          details: validationResult.details,
        })
        return
      }

      const validated = validationResult.validated
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

function validInitiateCapsule(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-pod-001',
    sender_id: 'user-pod-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: '2026-05-24T09:00:00.000Z',
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  }
}

function plainEmail(): string {
  return 'Hello, this is a plain email with no BEAP capsule.'
}

function malformedBeap(): string {
  return '{ this is not valid json !!!'
}

const emptyTransport: TransportMetadata = {}

// ── Setup ─────────────────────────────────────────────────────────────────────

let mockServer: MockServer

beforeAll(async () => {
  mockServer = await startMockPodIngestor()
})

beforeEach(() => {
  _resetIngestionModeServiceForTest()
  _setResolverInputsOverrideForTest({
    settings: DEFAULT_EDGE_TIER_SETTINGS,
    edgeReachable: false,
    generalConnectivity: true,
    hostPodReady: true,
    podmanAvailable: true,
    sessionHostFallbackAuthorized: false,
  })
})

afterAll(async () => {
  await mockServer.stop()
})

afterEach(() => {
  delete process.env['WR_POD_BASE_URL']
  _resetIngestionModeServiceForTest()
})

function withMock<T>(fn: () => Promise<T>): Promise<T> {
  process.env['WR_POD_BASE_URL'] = mockServer.baseUrl
  return fn()
}

// ── Pod path tests ─────────────────────────────────────────────────────────────

describe('Pod path — valid initiate capsule → handshake_pipeline', () => {
  test('success is true', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    expect(result.success).toBe(true)
    expect('held' in result && result.held).toBe(false)
  })

  test('distribution.target is handshake_pipeline', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })

  test('capsule_type is initiate', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    if (result.success) {
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('initiate')
    }
  })

  test('handshake_id is preserved', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    if (result.success) {
      const hsId = (result.distribution.validated_capsule.capsule as any)['handshake_id']
      expect(hsId).toBe('hs-pod-001')
    }
  })

  test('audit validation_result is validated', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    expect(result.audit.validation_result).toBe('validated')
  })
})

describe('Pod path — plain email → sandbox_sub_orchestrator', () => {
  test('success is true', async () => {
    const rawInput: RawInput = { body: plainEmail() }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    expect(result.success).toBe(true)
  })

  test('distribution.target is sandbox_sub_orchestrator', async () => {
    const rawInput: RawInput = { body: plainEmail() }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    if (result.success) {
      expect(result.distribution.target).toBe('sandbox_sub_orchestrator')
    }
  })
})

describe('Pod path — rejection (INGESTION_ERROR_PROPAGATED)', () => {
  test('success is false', async () => {
    const rawInput: RawInput = { body: malformedBeap(), mime_type: 'application/vnd.beap+json' }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    expect(result.success).toBe(false)
  })

  test('audit validation_result is rejected', async () => {
    const rawInput: RawInput = { body: malformedBeap(), mime_type: 'application/vnd.beap+json' }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    expect(result.audit.validation_result).toBe('rejected')
  })
})

describe('Pod path — rejection (MISSING_REQUIRED_FIELD)', () => {
  test('success is false and validation_reason_code is set', async () => {
    const incomplete = {
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: 'hs-incomplete',
      sender_id: 'user-1',
      timestamp: new Date().toISOString(),
      wrdesk_policy_hash: 'b'.repeat(64),
      seq: 1,
      sender_public_key: 'c'.repeat(64),
      sender_signature: 'd'.repeat(128),
    }
    const rawInput: RawInput = { body: JSON.stringify(incomplete) }
    const result = await withMock(() => processIncomingInput(rawInput, 'email', emptyTransport))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBeTruthy()
    }
  })
})

describe('[pod-hot-path] logging prefix', () => {
  test('log lines are prefixed [pod-hot-path]', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
      origLog(...args)
    }
    try {
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

describe('Pod unavailable → error result', () => {
  test('connection refused → success false with Pod unavailable reason', async () => {
    process.env['WR_POD_BASE_URL'] = 'http://127.0.0.1:1' // refuse
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/Pod unavailable/i)
    }
  })
})
