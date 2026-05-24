/**
 * packages/pod-client/src/__tests__/podClient.test.ts
 *
 * Tests for createPodClient and PodClient.ingest.
 *
 * Uses real Node.js HTTP servers rather than mocking fetch so that the
 * network path (request serialisation, response parsing, error mapping) is
 * exercised end-to-end.
 *
 * Scenarios:
 *   1. Happy path — 200 response returns PodIngestResult with parsed body.
 *   2. Request envelope — all fields (transport metadata) forwarded correctly.
 *   3. 4xx response — surfaces as PodIngestHttpError, not retried.
 *   4. 5xx response — surfaces as PodIngestHttpError, not retried.
 *   5. Connection refused — retried once (2 total attempts) then surfaces
 *      as PodConnectionError.
 *   6. Timeout — surfaces as PodTimeoutError, not retried.
 *   7. Content-Type — ingest request uses application/json.
 *   8. Partial transport metadata — missing keys not included in envelope.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createPodClient } from '../client.js'
import { PodIngestHttpError, PodConnectionError, PodTimeoutError } from '../types.js'

// ── Mock server helpers ───────────────────────────────────────────────────────

interface MockServer {
  baseUrl: string
  stop(): Promise<void>
}

/**
 * Start a minimal HTTP server on a random port.
 * handler receives the full request and must send the complete response.
 */
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

/** Read the full request body as a string. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Send a JSON response. */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(json)),
  })
  res.end(json)
}

// ── Test helpers ──────────────────────────────────────────────────────────────

const RAW_INPUT = { body: 'Hello BEAP world' }
const SOURCE_TYPE = 'api' as const

// ── Suite 1: happy path ───────────────────────────────────────────────────────

describe('PodClient.ingest — happy path', () => {
  let srv: MockServer

  beforeAll(async () => {
    srv = await startServer(async (req, res) => {
      await readBody(req) // consume body
      sendJson(res, 200, { status: 'validated', sealed: true })
    })
  })

  afterAll(() => srv.stop())

  test('resolves with status 200 and parsed body', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    const result = await client.ingest(RAW_INPUT, SOURCE_TYPE)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'validated', sealed: true })
  })
})

// ── Suite 2: request envelope ─────────────────────────────────────────────────

describe('PodClient.ingest — request envelope', () => {
  let srv: MockServer
  let capturedBody: Record<string, unknown>

  beforeAll(async () => {
    srv = await startServer(async (req, res) => {
      const raw = await readBody(req)
      capturedBody = JSON.parse(raw) as Record<string, unknown>
      sendJson(res, 200, { ok: true })
    })
  })

  afterAll(() => srv.stop())

  test('sends correct Content-Type header', async () => {
    let capturedCt: string | undefined
    const localSrv = await startServer(async (req, res) => {
      capturedCt = req.headers['content-type']
      await readBody(req)
      sendJson(res, 200, {})
    })

    try {
      const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 5_000 })
      await client.ingest(RAW_INPUT, SOURCE_TYPE)
      expect(capturedCt).toContain('application/json')
    } finally {
      await localSrv.stop()
    }
  })

  test('body and source_type are always included', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    await client.ingest({ body: 'test-body' }, 'email')
    expect(capturedBody['body']).toBe('test-body')
    expect(capturedBody['source_type']).toBe('email')
  })

  test('transport metadata fields are forwarded', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    await client.ingest(RAW_INPUT, SOURCE_TYPE, {
      channel_id: 'ch-1',
      message_id: 'msg-42',
      sender_address: 'alice@example.com',
      recipient_address: 'bob@example.com',
    })
    expect(capturedBody['channel_id']).toBe('ch-1')
    expect(capturedBody['message_id']).toBe('msg-42')
    expect(capturedBody['sender_address']).toBe('alice@example.com')
    expect(capturedBody['recipient_address']).toBe('bob@example.com')
  })

  test('optional rawInput fields (mime_type, filename, headers) are forwarded when set', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    await client.ingest(
      {
        body: 'msg',
        mime_type: 'text/html',
        filename: 'email.html',
        headers: { 'x-beap': '1' },
      },
      'email',
    )
    expect(capturedBody['mime_type']).toBe('text/html')
    expect(capturedBody['filename']).toBe('email.html')
    expect(capturedBody['headers']).toEqual({ 'x-beap': '1' })
  })

  test('undefined transport metadata fields are not included in the envelope', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    await client.ingest(RAW_INPUT, SOURCE_TYPE, { channel_id: undefined })
    expect(Object.prototype.hasOwnProperty.call(capturedBody, 'channel_id')).toBe(false)
  })
})

// ── Suite 3: 4xx error ────────────────────────────────────────────────────────

describe('PodClient.ingest — 4xx response', () => {
  let srv: MockServer

  beforeAll(async () => {
    srv = await startServer(async (req, res) => {
      await readBody(req)
      sendJson(res, 400, { error: 'Invalid JSON body' })
    })
  })

  afterAll(() => srv.stop())

  test('throws PodIngestHttpError with status and body', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    await expect(client.ingest(RAW_INPUT, SOURCE_TYPE)).rejects.toThrow(PodIngestHttpError)
  })

  test('PodIngestHttpError.status is 400', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    try {
      await client.ingest(RAW_INPUT, SOURCE_TYPE)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PodIngestHttpError)
      expect((err as PodIngestHttpError).status).toBe(400)
      expect((err as PodIngestHttpError).body).toEqual({ error: 'Invalid JSON body' })
    }
  })

  test('4xx is NOT retried (server called exactly once)', async () => {
    let callCount = 0
    const localSrv = await startServer(async (req, res) => {
      callCount++
      await readBody(req)
      sendJson(res, 422, { error: 'unprocessable' })
    })

    try {
      const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 5_000 })
      await client.ingest(RAW_INPUT, SOURCE_TYPE).catch(() => {})
      expect(callCount).toBe(1)
    } finally {
      await localSrv.stop()
    }
  })
})

// ── Suite 4: 5xx error ────────────────────────────────────────────────────────

describe('PodClient.ingest — 5xx response', () => {
  let srv: MockServer

  beforeAll(async () => {
    srv = await startServer(async (req, res) => {
      await readBody(req)
      sendJson(res, 502, { error: 'Upstream validator error' })
    })
  })

  afterAll(() => srv.stop())

  test('throws PodIngestHttpError with status 502', async () => {
    const client = createPodClient({ baseUrl: srv.baseUrl, requestTimeoutMs: 5_000 })
    try {
      await client.ingest(RAW_INPUT, SOURCE_TYPE)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PodIngestHttpError)
      expect((err as PodIngestHttpError).status).toBe(502)
    }
  })

  test('5xx is NOT retried (server called exactly once)', async () => {
    let callCount = 0
    const localSrv = await startServer(async (req, res) => {
      callCount++
      await readBody(req)
      sendJson(res, 503, { error: 'unavailable' })
    })

    try {
      const client = createPodClient({ baseUrl: localSrv.baseUrl, requestTimeoutMs: 5_000 })
      await client.ingest(RAW_INPUT, SOURCE_TYPE).catch(() => {})
      expect(callCount).toBe(1)
    } finally {
      await localSrv.stop()
    }
  })
})

// ── Suite 5: connection error with retry ──────────────────────────────────────

describe('PodClient.ingest — connection error', () => {
  test('retries once on connection refused (2 total attempts), then throws PodConnectionError', async () => {
    let callCount = 0

    // Start a server, capture the port, then immediately close it so nothing
    // is actually listening.  We need a port number that ECONNREFUSED-es.
    const unusedPort = await new Promise<number>((resolve, reject) => {
      const probe = http.createServer()
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number }
        probe.close(() => resolve(port))
      })
      probe.once('error', reject)
    })

    // Patch fetch to count calls without a real network request
    const originalFetch = globalThis.fetch
    let patchedFetchCallCount = 0
    globalThis.fetch = async (..._args: Parameters<typeof fetch>) => {
      patchedFetchCallCount++
      callCount++
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    }

    try {
      const client = createPodClient({
        baseUrl: `http://127.0.0.1:${unusedPort}`,
        requestTimeoutMs: 5_000,
      })
      await client.ingest(RAW_INPUT, SOURCE_TYPE)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PodConnectionError)
      // MAX_RETRIES = 1: original attempt + 1 retry = 2 total calls
      expect(patchedFetchCallCount).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// ── Suite 6: timeout ──────────────────────────────────────────────────────────

describe('PodClient.ingest — timeout', () => {
  let srv: MockServer

  beforeAll(async () => {
    // Server that never responds (holds the socket open)
    srv = await startServer(async (req, _res) => {
      await readBody(req)
      // intentionally never call res.end() — response hangs
      await new Promise<void>(() => { /* never resolves */ })
    })
  })

  afterAll(() => srv.stop())

  test('throws PodTimeoutError after requestTimeoutMs', async () => {
    const client = createPodClient({
      baseUrl: srv.baseUrl,
      requestTimeoutMs: 150, // very short for test speed
    })
    const err = await client.ingest(RAW_INPUT, SOURCE_TYPE).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PodTimeoutError)
  }, 3_000)

  test('PodTimeoutError.timeoutMs matches config', async () => {
    const client = createPodClient({
      baseUrl: srv.baseUrl,
      requestTimeoutMs: 120,
    })
    try {
      await client.ingest(RAW_INPUT, SOURCE_TYPE)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PodTimeoutError)
      expect((err as PodTimeoutError).timeoutMs).toBe(120)
    }
  }, 3_000)

  test('timeout is NOT retried (fetch called exactly once)', async () => {
    const originalFetch = globalThis.fetch
    let fetchCallCount = 0
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchCallCount++
      // Simulate a hanging request that fires when the AbortSignal fires.
      // DOMException(message, name) — name is a getter-only on DOMException,
      // so we use the constructor form rather than Object.assign.
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () =>
          reject(new DOMException('signal is aborted without reason', 'AbortError'))
        if (init?.signal?.aborted) {
          onAbort()
        } else {
          init?.signal?.addEventListener('abort', onAbort, { once: true })
        }
      })
    }

    try {
      const client = createPodClient({
        baseUrl: 'http://127.0.0.1:19999',
        requestTimeoutMs: 80,
      })
      await client.ingest(RAW_INPUT, SOURCE_TYPE).catch(() => {})
      expect(fetchCallCount).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  }, 3_000)
})
