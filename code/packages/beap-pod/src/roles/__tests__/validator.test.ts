/**
 * Tests for the validator role HTTP server (P1.4).
 *
 * The validator server is started on port 0 for each suite.
 * Inbound HTTP requests come from the test process (real fetch).
 * Outbound calls to the depackager are injected as vi.fn() mocks.
 *
 * Coverage:
 *   1. Valid handshake capsule → 200 valid:true, needs_depackaging:false
 *   2. Oversized string field  → 422 PAYLOAD_STRING_TOO_LONG
 *   3. Disallowed MIME type    → 422 CONTENT_TYPE_NOT_ALLOWED
 *   4. Message-package capsule → forwarded to depackager, response relayed
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { ingestInput } from '@repo/ingestion-core';
import { createValidatorServer } from '../validator.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-validator-suite';

// ── Helpers ───────────────────────────────────────────────────────────────────

function startServer(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

/**
 * POST /validate with pod-auth header and a CandidateCapsuleEnvelope payload.
 * Returns { status, json }.
 */
async function postValidate(
  baseUrl: string,
  candidate: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pod-auth': TEST_SECRET,
    },
    body: JSON.stringify({ candidate }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Valid handshake initiate capsule — passes all validator checks. */
function makeInitiateCandidate() {
  const payload = {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: '2024-01-01T00:00:00Z',
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 0,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  };
  return ingestInput({ body: JSON.stringify(payload) }, 'api');
}

/**
 * Minimal pBEAP message package — detected as message_package by beapDetection,
 * validated as capsule_type:'message_package' by validateCapsule.
 */
function makeMessagePackageCandidate() {
  const payload = {
    header: { encoding: 'pBEAP' },
    metadata: {},
    payload: 'cGF5bG9hZA==', // base64 "payload"
  };
  return ingestInput({ body: JSON.stringify(payload) }, 'api');
}

// ── Suite 1: valid handshake capsule ─────────────────────────────────────────

describe('POST /validate — valid handshake capsule', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn(); // should NOT be called for handshake capsules
    server = createValidatorServer(TEST_SECRET, { authedFetch: mockFetch });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('returns valid:true, needs_depackaging:false for initiate capsule', async () => {
    const candidate = makeInitiateCandidate();
    const { status, json } = await postValidate(baseUrl, candidate);

    expect(status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.needs_depackaging).toBe(false);
    expect(json.validated).toBeDefined();
    expect((json.validated as Record<string, unknown>).__brand).toBe('ValidatedCapsule');

    // Depackager must not be contacted for handshake capsules
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Suite 2: oversized string ─────────────────────────────────────────────────

describe('POST /validate — oversized string rejection', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createValidatorServer(TEST_SECRET, {
      authedFetch: vi.fn(), // should never be called
      maxStringLength: 20, // tiny limit for the test
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('returns 422 PAYLOAD_STRING_TOO_LONG when a string field exceeds the limit', async () => {
    // Build an initiate capsule where sender_id (21 chars) exceeds the 20-char limit
    const longPayload = {
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: 'hs-001',
      sender_id: 'x'.repeat(21), // 21 > 20
      capsule_hash: 'a'.repeat(64),
      timestamp: '2024-01-01T00:00:00Z',
      wrdesk_policy_hash: 'b'.repeat(64),
      seq: 0,
      sender_public_key: 'c'.repeat(64),
      sender_signature: 'd'.repeat(128),
    };
    const candidate = ingestInput({ body: JSON.stringify(longPayload) }, 'api');

    const { status, json } = await postValidate(baseUrl, candidate);

    expect(status).toBe(422);
    expect(json.valid).toBe(false);
    expect(json.reason).toBe('PAYLOAD_STRING_TOO_LONG');
    expect(typeof json.details).toBe('string');
    expect(json.details as string).toContain('21');
  });
});

// ── Suite 3: disallowed MIME type ─────────────────────────────────────────────

describe('POST /validate — disallowed content type', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createValidatorServer(TEST_SECRET, { authedFetch: vi.fn() });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('returns 422 CONTENT_TYPE_NOT_ALLOWED for unknown MIME type', async () => {
    // Capsule arrives with an unsupported MIME type in transport metadata
    const candidate = ingestInput(
      { body: JSON.stringify({
          schema_version: 1,
          capsule_type: 'initiate',
          handshake_id: 'hs-001',
          sender_id: 'user-1',
          capsule_hash: 'a'.repeat(64),
          timestamp: '2024-01-01T00:00:00Z',
          wrdesk_policy_hash: 'b'.repeat(64),
          seq: 0,
          sender_public_key: 'c'.repeat(64),
          sender_signature: 'd'.repeat(128),
        }),
        mime_type: 'application/x-evil-payload',
      },
      'api',
    );

    const { status, json } = await postValidate(baseUrl, candidate);

    expect(status).toBe(422);
    expect(json.valid).toBe(false);
    expect(json.reason).toBe('CONTENT_TYPE_NOT_ALLOWED');
    expect((json.details as string).toLowerCase()).toContain('application/x-evil-payload');
  });
});

// ── Suite 4: message-package forwarded to depackager ─────────────────────────

describe('POST /validate — message-package forwarded to depackager', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createValidatorServer(TEST_SECRET, {
      authedFetch: mockFetch,
      depackagerBase: 'http://mock-depackager',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('forwards validated message-package to depackager and relays its response', async () => {
    const depackagedPayload = { status: 'depackaged', capsule_type: 'message_package' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(depackagedPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const candidate = makeMessagePackageCandidate();
    const { status, json } = await postValidate(baseUrl, candidate);

    // Validator relays the depackager's 200 response
    expect(status).toBe(200);
    expect(json).toMatchObject({ status: 'depackaged' });

    // Confirm depackager was called with the right endpoint and payload
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('mock-depackager');
    expect(url).toContain('/depackage');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string) as { validated: { __brand: string } };
    expect(sent.validated.__brand).toBe('ValidatedCapsule');
  });
});

// ── Suite 5: pod-auth enforcement ─────────────────────────────────────────────

describe('POST /validate — pod-auth enforcement', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createValidatorServer(TEST_SECRET, { authedFetch: vi.fn() });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('returns 401 when X-Pod-Auth header is missing', async () => {
    const candidate = makeInitiateCandidate();
    const res = await fetch(`${baseUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate }),
    });
    expect(res.status).toBe(401);
  });

  test('returns 401 when X-Pod-Auth header has wrong value', async () => {
    const candidate = makeInitiateCandidate();
    const res = await fetch(`${baseUrl}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pod-auth': 'wrong-secret',
      },
      body: JSON.stringify({ candidate }),
    });
    expect(res.status).toBe(401);
  });
});

// ── Suite 6: /health and /ready ───────────────────────────────────────────────

describe('GET /health and /ready', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createValidatorServer(TEST_SECRET);
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('/health always returns 200 with role:validator', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { role: string; status: string };
    expect(json.role).toBe('validator');
    expect(json.status).toBe('ok');
  });

  test('/ready returns 200 (validator has no upstream deps)', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ready');
  });
});
