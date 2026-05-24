/**
 * Pod-client edge-tier routing tests (P3.9)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createPodClient } from '../client.js'
import {
  PodEdgeUnreachableError,
  PodIngestHttpError,
} from '../types.js'

interface MockServer {
  baseUrl: string
  stop(): Promise<void>
}

function startServer(handler: http.RequestListener): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        stop: () =>
          new Promise<void>((res, rej) => {
            if (typeof (server as unknown as Record<string, unknown>)['closeAllConnections'] === 'function') {
              ;(server as unknown as { closeAllConnections(): void }).closeAllConnections()
            }
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

const RAW_INPUT = { body: '{"schema_version":1}' }
const SOURCE_TYPE = 'email' as const

const EDGE_REPLICA = {
  host: '127.0.0.1',
  port: 0, // filled per test
  edge_pod_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  public_key: 'ed25519:' + 'aa'.repeat(32),
  attestation_jwt: 'stub.jwt.token',
}

const STUB_CERTIFICATE = {
  v: 1,
  package_hash: 'sha256:' + 'bb'.repeat(32),
  capsule_canonical_hash: 'sha256:' + 'cc'.repeat(32),
  validation_result_digest: 'sha256:' + 'dd'.repeat(32),
  edge_pod_id: EDGE_REPLICA.edge_pod_id,
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  sso_attestation: 'stub',
  edge_signature: 'ed25519:' + 'ee'.repeat(64),
}

describe('PodClient edge tier — disabled', () => {
  let localSrv: MockServer
  let localCalls = 0

  beforeAll(async () => {
    localSrv = await startServer(async (req, res) => {
      localCalls++
      await readBody(req)
      sendJson(res, 200, { valid: true, validated: { capsule: { capsule_type: 'initiate' } } })
    })
  })

  afterAll(() => localSrv.stop())

  test('edge disabled → local-only path unchanged', async () => {
    localCalls = 0
    const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 5_000 })
    client.configureEdgeTier(null)
    const result = await client.ingest(RAW_INPUT, SOURCE_TYPE)
    expect(result.status).toBe(200)
    expect(localCalls).toBe(1)
  })
})

describe('PodClient edge tier — enabled happy path', () => {
  let localSrv: MockServer
  let edgeSrv: MockServer
  let edgeCalls = 0
  let localBodies: Record<string, unknown>[] = []

  beforeAll(async () => {
    edgeSrv = await startServer(async (req, res) => {
      edgeCalls++
      await readBody(req)
      sendJson(res, 200, {
        depackaged_payload: { content: 'depackaged' },
        certificate: STUB_CERTIFICATE,
      })
    })
    const edgePort = Number(new URL(edgeSrv.baseUrl).port)

    localSrv = await startServer(async (req, res) => {
      const raw = await readBody(req)
      localBodies.push(JSON.parse(raw) as Record<string, unknown>)
      const parsed = localBodies[localBodies.length - 1]!
      if (!parsed['edge_certificate']) {
        sendJson(res, 403, { verification_failed: true, reason: 'CERT_MISSING' })
        return
      }
      sendJson(res, 200, {
        valid: true,
        needs_depackaging: false,
        validated: {
          capsule: { capsule_type: 'initiate' },
          provenance: { raw_input_hash: 'sealed-ok' },
          __brand: 'ValidatedCapsule',
        },
      })
    })

    EDGE_REPLICA.port = edgePort
  })

  afterAll(async () => {
    await localSrv.stop()
    await edgeSrv.stop()
  })

  test('edge reachable → local pod receives body + edge_certificate → sealed result', async () => {
    edgeCalls = 0
    localBodies = []
    const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 5_000 })
    client.configureEdgeTier([{ ...EDGE_REPLICA, port: Number(new URL(edgeSrv.baseUrl).port) }])

    const result = await client.ingest(RAW_INPUT, SOURCE_TYPE)
    expect(edgeCalls).toBe(1)
    expect(localBodies.length).toBe(1)
    expect(localBodies[0]!['body']).toBe(RAW_INPUT.body)
    expect(localBodies[0]!['edge_certificate']).toEqual(STUB_CERTIFICATE)
    expect(result.status).toBe(200)
    expect((result.body as Record<string, unknown>)['valid']).toBe(true)
  })
})

describe('PodClient edge tier — edge unreachable', () => {
  test('returns EDGE_UNREACHABLE rejection (reject fallback)', async () => {
    const unusedPort = await new Promise<number>((resolve, reject) => {
      const probe = http.createServer()
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number }
        probe.close(() => resolve(port))
      })
      probe.once('error', reject)
    })

    const localSrv = await startServer(async (req, res) => {
      await readBody(req)
      sendJson(res, 200, { valid: true })
    })

    try {
      const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 500 })
      client.configureEdgeTier([
        {
          ...EDGE_REPLICA,
          port: unusedPort,
        },
      ], 'reject')

      await expect(client.ingest(RAW_INPUT, SOURCE_TYPE)).rejects.toThrow(PodEdgeUnreachableError)
      try {
        await client.ingest(RAW_INPUT, SOURCE_TYPE)
      } catch (err) {
        expect(err).toBeInstanceOf(PodEdgeUnreachableError)
        expect((err as PodEdgeUnreachableError).code).toBe('EDGE_UNREACHABLE')
      }
    } finally {
      await localSrv.stop()
    }
  })
})

describe('PodClient edge tier — local cert rejection relayed', () => {
  test('edge returns cert but local pod rejects → surfaces local rejection reason', async () => {
    const edgeSrv = await startServer(async (req, res) => {
      await readBody(req)
      sendJson(res, 200, { certificate: STUB_CERTIFICATE })
    })

    const localSrv = await startServer(async (req, res) => {
      await readBody(req)
      sendJson(res, 403, {
        verification_failed: true,
        reason: 'EDGE_SIGNATURE_INVALID',
        error: 'Edge signature invalid',
      })
    })

    try {
      const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 5_000 })
      client.configureEdgeTier([
        { ...EDGE_REPLICA, port: Number(new URL(edgeSrv.baseUrl).port) },
      ])

      await expect(client.ingest(RAW_INPUT, SOURCE_TYPE)).rejects.toThrow(PodIngestHttpError)
      try {
        await client.ingest(RAW_INPUT, SOURCE_TYPE)
      } catch (err) {
        expect(err).toBeInstanceOf(PodIngestHttpError)
        const httpErr = err as PodIngestHttpError
        expect(httpErr.status).toBe(403)
        expect((httpErr.body as Record<string, unknown>)['reason']).toBe('EDGE_SIGNATURE_INVALID')
      }
    } finally {
      await edgeSrv.stop()
      await localSrv.stop()
    }
  })
})
