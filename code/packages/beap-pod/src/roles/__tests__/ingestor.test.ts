/**
 * Tests for the ingestor role HTTP server.
 *
 * The server is started on a random port (port 0) for each test group so
 * tests can run in parallel without port conflicts.
 *
 * authedFetch is injected as a vi.fn() mock — it represents the server's
 * outbound calls to the validator container.  Test code uses globalThis.fetch
 * (real Node.js fetch) to make inbound HTTP requests to the server; the two
 * never conflict.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createIngestorServer } from '../ingestor.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-ingestor-suite';

/** Resolve when the server is listening; returns its base URL. */
function startServer(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

/** Resolve when the server has fully closed. */
function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

/** POST /ingest on the given base URL with a JSON body. */
async function postIngest(
  baseUrl: string,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const body = JSON.stringify(payload);
  const res = await fetch(`${baseUrl}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('POST /ingest — happy path', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createIngestorServer(TEST_SECRET, {
      authedFetch: mockFetch,
      validatorBase: 'http://mock-validator',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('forwards candidate to validator and relays 200 response', async () => {
    const validatorPayload = { valid: true, capsule_type: 'plain_external_content' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(validatorPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { status, json } = await postIngest(baseUrl, {
      body: 'Hello from the ingestor test',
      source_type: 'api',
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({ valid: true });

    // Verify the validator was called with a POST containing a candidate envelope
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/validate');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string) as { candidate: { __brand: string } };
    expect(sent.candidate.__brand).toBe('CandidateCapsule');
  });
});

describe('POST /ingest — validator rejection', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createIngestorServer(TEST_SECRET, {
      authedFetch: mockFetch,
      validatorBase: 'http://mock-validator',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('relays validator 422 rejection to the caller', async () => {
    const rejectionPayload = {
      valid: false,
      reason: 'MISSING_REQUIRED_FIELD',
      details: 'header.version is required',
    };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(rejectionPayload), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { status, json } = await postIngest(baseUrl, { body: '{"partial":"data"}' });

    expect(status).toBe(422);
    expect(json).toMatchObject({ valid: false, reason: 'MISSING_REQUIRED_FIELD' });
  });
});

describe('POST /ingest — oversized body', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // Set a tiny body limit so the test does not need to send megabytes
    server = createIngestorServer(TEST_SECRET, {
      authedFetch: vi.fn(), // should never be called
      validatorBase: 'http://mock-validator',
      maxBodyBytes: 100,
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('returns 413 for a body exceeding maxBodyBytes before reaching ingestInput', async () => {
    // Body is 200+ bytes — well above the 100-byte limit
    const oversizedBody = JSON.stringify({ body: 'x'.repeat(200) });
    expect(Buffer.byteLength(oversizedBody)).toBeGreaterThan(100);

    const res = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedBody,
    });

    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: string; limit_bytes: number };
    expect(json.error).toMatch(/too large/i);
    expect(json.limit_bytes).toBe(100);
  });

  test('rejects via Content-Length fast-path when declared size exceeds limit', async () => {
    // Send with a fake Content-Length header larger than the 100-byte limit
    // Node.js fetch does not let you override Content-Length directly, so we
    // use node:http for this case.
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: (server.address() as { port: number }).port,
          path: '/ingest',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '500', // declare 500 bytes > 100-byte limit
          },
        },
        (r) => {
          r.resume();
          resolve({ status: r.statusCode ?? 0 });
        },
      );
      req.on('error', reject);
      req.write('{}');
      req.end();
    });

    expect(result.status).toBe(413);
  });
});

describe('GET /ready', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createIngestorServer(TEST_SECRET, {
      authedFetch: mockFetch,
      validatorBase: 'http://mock-validator',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('returns 503 when validator /ready is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:18101'));

    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { reason: string };
    expect(json.reason).toBe('validator_unreachable');
  });

  test('returns 200 when validator /ready responds 200', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready' }), { status: 200 }),
    );

    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
  });
});

describe('GET /health', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createIngestorServer(TEST_SECRET);
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('always returns 200 with role:ingestor', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; role: string };
    expect(json.status).toBe('ok');
    expect(json.role).toBe('ingestor');
  });
});
