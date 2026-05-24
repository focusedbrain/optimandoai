/**
 * Ingestor POD_MODE branching — test suite (P3.7)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { CERT_MISSING, createIngestorServer } from '../ingestor.js';

const TEST_SECRET = 'ingestor-modes-test-secret-32b!!';

const SAMPLE_CERT = {
  v: 1,
  package_hash: 'sha256:abc',
  capsule_canonical_hash: 'sha256:def',
  validation_result_digest: 'sha256:ghi',
  edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
  issued_at: '2026-05-24T10:00:00.000Z',
  expires_at: '2026-05-25T10:00:00.000Z',
  sso_attestation: 'eyJhbGci.test',
  edge_signature: 'ed25519:' + 'a'.repeat(128),
};

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

async function postIngest(
  baseUrl: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('LOCAL_HOST mode', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createIngestorServer(TEST_SECRET, {
      podMode: 'LOCAL_HOST',
      authedFetch: mockFetch,
      validatorBase: 'http://mock-validator',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('forwards to validator and relays response (Phase 1 behavior unchanged)', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ valid: true, seal: 'local-host-seal' }), { status: 200 }),
    );

    const { status, json } = await postIngest(baseUrl, {
      body: 'Hello LOCAL_HOST',
      source_type: 'api',
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({ valid: true, seal: 'local-host-seal' });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/validate');
  });
});

describe('LOCAL_VERIFY mode', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  const verifyMetadata = {
    canonical_capsule_bytes_b64: Buffer.from('{"capsule":true}', 'utf8').toString('base64'),
    canonical_validation_result_bytes_b64: Buffer.from('{"valid":true}', 'utf8').toString('base64'),
  };

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createIngestorServer(TEST_SECRET, {
      podMode: 'LOCAL_VERIFY',
      authedFetch: mockFetch,
      validatorBase: 'http://mock-validator',
      verifierBase: 'http://mock-verifier',
      sealerBase: 'http://mock-sealer',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('happy path: shallow verify → validator → deep verify → seal', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, edge_pod_id: SAMPLE_CERT.edge_pod_id, sub: 'user' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pending_seal: true,
            verify_metadata: verifyMetadata,
            depackaged_for_seal: { subject: 't', body: '<p>hi</p>', rawCapsuleJson: '{}' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, edge_pod_id: SAMPLE_CERT.edge_pod_id, sub: 'user' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sealed: true, seal: 'verified-seal', rowId: 'row-1' }), {
          status: 200,
        }),
      );

    const { status, json } = await postIngest(baseUrl, {
      body: '{"wire":"package"}',
      edge_certificate: SAMPLE_CERT,
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({ sealed: true, seal: 'verified-seal' });
    expect(json['depackaged']).toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const urls = mockFetch.mock.calls.map((c) => (c as [string])[0]);
    expect(urls[0]).toContain('/verify-cert');
    expect(urls[1]).toContain('/validate');
    expect(urls[2]).toContain('/verify-cert');
    expect(urls[3]).toContain('/seal');

    const shallowBody = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(shallowBody.expected_capsule_canonical_bytes_b64).toBeUndefined();

    const deepBody = JSON.parse((mockFetch.mock.calls[2] as [string, RequestInit])[1].body as string);
    expect(deepBody.expected_capsule_canonical_bytes_b64).toBe(verifyMetadata.canonical_capsule_bytes_b64);
  });

  test('shallow verify fail: validator NOT called', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, reason: 'EDGE_NOT_TRUSTED' }), { status: 200 }),
    );

    const { status, json } = await postIngest(baseUrl, {
      body: '{"wire":"package"}',
      edge_certificate: SAMPLE_CERT,
    });

    expect(status).toBe(403);
    expect(json).toMatchObject({ verification_failed: true, reason: 'EDGE_NOT_TRUSTED' });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect((mockFetch.mock.calls[0] as [string])[0]).toContain('/verify-cert');
  });

  test('missing certificate → CERT_MISSING, validator NOT called', async () => {
    const { status, json } = await postIngest(baseUrl, { body: '{"wire":"package"}' });

    expect(status).toBe(403);
    expect(json).toMatchObject({ verification_failed: true, reason: CERT_MISSING });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('deep verify fail: sealer NOT called, no seal returned', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            verify_metadata: verifyMetadata,
            depackaged_for_seal: { body: 'x' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, reason: 'CAPSULE_CANONICAL_HASH_MISMATCH' }), {
          status: 200,
        }),
      );

    const { status, json } = await postIngest(baseUrl, {
      body: '{"wire":"package"}',
      edge_certificate: SAMPLE_CERT,
    });

    expect(status).toBe(403);
    expect(json).toMatchObject({
      verification_failed: true,
      reason: 'CAPSULE_CANONICAL_HASH_MISMATCH',
    });
    expect(json['seal']).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const urls = mockFetch.mock.calls.map((c) => (c as [string])[0]);
    expect(urls.some((u) => u.includes('/seal'))).toBe(false);
  });

  test('validator always runs between shallow and deep verify (cert is a gate, not a substitute)', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verify_metadata: verifyMetadata, depackaged_for_seal: {} }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sealed: true, seal: 's' }), { status: 200 }),
      );

    await postIngest(baseUrl, { body: 'x', edge_certificate: SAMPLE_CERT });

    const callOrder = mockFetch.mock.calls.map((c) => (c as [string])[0]);
    const shallowIdx = callOrder.findIndex((u) => u.includes('/verify-cert'));
    const validateIdx = callOrder.indexOf('http://mock-validator/validate');
    const deepIdx = callOrder.lastIndexOf('http://mock-verifier/verify-cert');
    expect(shallowIdx).toBeLessThan(validateIdx);
    expect(validateIdx).toBeLessThan(deepIdx);
  });
});

describe('REMOTE_EDGE mode', () => {
  let server: http.Server;
  let baseUrl: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    server = createIngestorServer(TEST_SECRET, {
      podMode: 'REMOTE_EDGE',
      authedFetch: mockFetch,
      validatorBase: 'http://mock-validator',
    });
    baseUrl = await startServer(server);
  });

  afterEach(() => stopServer(server));

  test('happy path returns depackaged_payload and certificate', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          depackaged: { subject: 'edge', body: '<p>edge</p>' },
          edge_certificate: { v: 1, edge_pod_id: 'edge-1' },
          certified: true,
        }),
        { status: 200 },
      ),
    );

    const { status, json } = await postIngest(baseUrl, {
      body: '{"pbeap":true}',
      depackage_keys: { x25519_priv_b64: Buffer.alloc(32, 1).toString('base64') },
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({
      depackaged_payload: { subject: 'edge', body: '<p>edge</p>' },
      certificate: { v: 1, edge_pod_id: 'edge-1' },
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect((mockFetch.mock.calls[0] as [string])[0]).toContain('/validate');
  });
});
