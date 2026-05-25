/**
 * P3.9 — edge-tier routing through pod-client
 *
 * Exercises processIncomingInput with edge_tier enabled and mock edge + local pods.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ingestInput, validateCapsule } from '@repo/ingestion-core'
import type { CandidateCapsuleEnvelope } from '@repo/ingestion-core'
import { processIncomingInput } from '../ingestionPipeline'
import type { RawInput, TransportMetadata } from '../types'
import { _setSettingsPathForTest } from '../../edge-tier/settings.js'
import {
  _setResolverInputsOverrideForTest,
  _resetIngestionModeServiceForTest,
} from '../ingestionModeService.js'

interface MockServer {
  baseUrl: string
  stop(): Promise<void>
}

function startServer(handler: http.RequestListener): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        stop: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          }),
      })
    })
    server.once('error', reject)
  })
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(json)),
  })
  res.end(json)
}

const STUB_CERTIFICATE = {
  v: 1,
  package_hash: 'sha256:' + 'bb'.repeat(32),
  capsule_canonical_hash: 'sha256:' + 'cc'.repeat(32),
  validation_result_digest: 'sha256:' + 'dd'.repeat(32),
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  sso_attestation: 'stub',
  edge_signature: 'ed25519:' + 'ee'.repeat(64),
}

function validInitiateCapsule(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-edge-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  }
}

const emptyTransport: TransportMetadata = {}

let tempDir = ''
let edgeSrv: MockServer
let localSrv: MockServer
let edgePort = 0

function writeEdgeSettings(enabled: boolean, edgeHost = '127.0.0.1'): void {
  writeFileSync(
    join(tempDir, 'edge-tier-settings.json'),
    JSON.stringify({
      enabled,
      replicas: enabled
        ? [
            {
              host: edgeHost,
              port: edgePort,
              edge_pod_id: STUB_CERTIFICATE.edge_pod_id,
              edge_public_key: 'ed25519:' + 'aa'.repeat(32),
              sso_attestation_jwt: 'stub.jwt.here',
            },
          ]
        : [],
      fallback_policy: 'reject',
      cached_jwks_json: JSON.stringify({ keys: [] }),
    }),
    { mode: 0o600 },
  )
}

beforeAll(async () => {
  edgeSrv = await startServer(async (req, res) => {
    if (req.url !== '/ingest') {
      res.writeHead(404)
      res.end()
      return
    }
    await readBody(req)
    sendJson(res, 200, { depackaged_payload: {}, certificate: STUB_CERTIFICATE })
  })
  edgePort = Number(new URL(edgeSrv.baseUrl).port)

  localSrv = await startServer(async (req, res) => {
    if (req.url !== '/ingest') {
      res.writeHead(404)
      res.end()
      return
    }
    const raw = await readBody(req)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const rawInput = {
      body: String(parsed['body'] ?? ''),
      mime_type: parsed['mime_type'] as string | undefined,
    }
    let candidate: CandidateCapsuleEnvelope
    try {
      candidate = ingestInput(rawInput, (parsed['source_type'] as string) ?? 'email', {})
    } catch {
      sendJson(res, 500, { error: 'ingestInput failed' })
      return
    }
    const vr = validateCapsule(candidate)
    if (!vr.success) {
      sendJson(res, 422, { valid: false, reason: vr.reason, details: vr.details })
      return
    }
    sendJson(res, 200, { valid: true, needs_depackaging: false, validated: vr.validated })
  })
})

afterAll(async () => {
  await edgeSrv.stop()
  await localSrv.stop()
})

beforeEach(() => {
  _resetIngestionModeServiceForTest()
  tempDir = mkdtempSync(join(tmpdir(), 'ingestion-edge-'))
  _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
  process.env['WR_POD_BASE_URL'] = localSrv.baseUrl
  writeEdgeSettings(false)
  _setResolverInputsOverrideForTest({
    generalConnectivity: true,
    hostPodReady: true,
    podmanAvailable: true,
    sessionHostFallbackAuthorized: false,
    edgeReachable: false,
  })
})

afterEach(() => {
  _setSettingsPathForTest(null)
  _resetIngestionModeServiceForTest()
  delete process.env['WR_POD_BASE_URL']
  rmSync(tempDir, { recursive: true, force: true })
})

describe('processIncomingInput — edge tier', () => {
  test('edge disabled → local-only path unchanged', async () => {
    writeEdgeSettings(false)
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })

  test('edge enabled → routes through edge then local LOCAL_VERIFY → success', async () => {
    writeEdgeSettings(true)
    _setResolverInputsOverrideForTest({
      generalConnectivity: true,
      hostPodReady: true,
      podmanAvailable: true,
      sessionHostFallbackAuthorized: false,
      edgeReachable: true,
    })
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })

  test('edge enabled, edge unreachable → EDGE_UNREACHABLE', async () => {
    writeEdgeSettings(true)
    writeFileSync(
      join(tempDir, 'edge-tier-settings.json'),
      JSON.stringify({
        enabled: true,
        replicas: [
          {
            host: '127.0.0.1',
            port: 59999,
            edge_pod_id: STUB_CERTIFICATE.edge_pod_id,
            edge_public_key: 'ed25519:' + 'aa'.repeat(32),
            sso_attestation_jwt: 'stub.jwt.here',
          },
        ],
        fallback_policy: 'reject',
      }),
      { mode: 0o600 },
    )
    _setResolverInputsOverrideForTest({
      generalConnectivity: true,
      hostPodReady: true,
      podmanAvailable: true,
      sessionHostFallbackAuthorized: false,
      edgeReachable: false,
    })
    const rawInput: RawInput = { body: JSON.stringify(validInitiateCapsule()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    expect('held' in result && result.held).toBe(true)
    expect(result.audit.validation_reason_code).toBe('EDGE_UNREACHABLE')
  })
})
