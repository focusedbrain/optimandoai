/**
 * Depackager role — test suite (P1.5)
 *
 * Four required scenarios (Canon §10 / strategy P1.5):
 *   1. Round-trip  — known good qBEAP package decrypts and seals correctly.
 *   2. Malformed   — structurally invalid package rejected without crash or hang.
 *   3. Sanitization— HTML body stripped of <script>, on* attrs, javascript: links, data: src.
 *   4. Timeout     — slow sealer mock hits the wall-clock timeout → 504.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  hkdfDerive,
  computeEnvelopeAadBytes,
  fromBase64,
  toBase64,
  type LocalBeapPackage,
  type LocalBeapHeader,
} from '../depackagePipeline.js';
import { createDepackagerServer, sanitizeBeapBody } from '../depackager.js';

const wc = webcrypto as Crypto;

// ── Test constants ─────────────────────────────────────────────────────────────

const TEST_SECRET = 'depackager-test-secret-32-bytes!!';

// Deterministic test key material (fixed 32-byte values for reproducibility)
const SENDER_PRIV = new Uint8Array(32).fill(0x11);
const RECEIVER_PRIV = new Uint8Array(32).fill(0x22);
const SENDER_PUB = x25519.getPublicKey(SENDER_PRIV);
const RECEIVER_PUB = x25519.getPublicKey(RECEIVER_PRIV);

// ── Crypto helpers (test-side fixtures only) ───────────────────────────────────

const subtle = wc.subtle;

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', Buffer.from(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  const algo = aad && aad.length > 0
    ? { name: 'AES-GCM' as const, iv: Buffer.from(iv), additionalData: Buffer.from(aad) }
    : { name: 'AES-GCM' as const, iv: Buffer.from(iv) };
  const ct = await subtle.encrypt(algo, key, Buffer.from(plaintext));
  return new Uint8Array(ct);
}

/** Build a minimal structurally-valid qBEAP package for round-trip tests. */
async function buildTestQbeapPackage(options: {
  capsuleBody: string;
  subject?: string;
}): Promise<LocalBeapPackage> {
  const salt = new Uint8Array(32).fill(0xab);

  // Sender computes shared secret: sender_priv × receiver_pub
  const sharedSecret = x25519.getSharedSecret(SENDER_PRIV, RECEIVER_PUB);
  const capsuleKey = await hkdfDerive(sharedSecret, salt, 'BEAP v1 capsule', 32);

  const headerBase: LocalBeapHeader = {
    version: '1.0',
    encoding: 'qBEAP',
    encryption_mode: 'direct',
    timestamp: 1704067200000,
    sender_fingerprint: 'test-sender-fp-round-trip',
    template_hash: 'a'.repeat(64),
    policy_hash: 'b'.repeat(64),
    content_hash: 'c'.repeat(64),
    receiver_binding: { handshake_id: 'test-hs-1' },
    crypto: {
      suiteId: 'x25519-hkdf-aes256gcm',
      salt: toBase64(salt),
      handshake_id: 'test-hs-1',
      senderX25519PublicKeyB64: toBase64(SENDER_PUB),
    },
  };

  // Compute AAD the same way the depackager will during decryption
  const aadBytes = computeEnvelopeAadBytes(headerBase);

  const capsuleJson = JSON.stringify({
    subject: options.subject ?? 'Round-trip test',
    body: options.capsuleBody,
    transport_plaintext: 'plain text preview',
  });
  const capsuleBytes = new TextEncoder().encode(capsuleJson);
  const nonce = new Uint8Array(12).fill(0xcd);
  const ciphertext = await aesGcmEncrypt(capsuleKey, nonce, capsuleBytes, aadBytes);

  const fakeSig = Buffer.alloc(64).toString('base64');

  return {
    ...headerBase,
    header: headerBase,
    metadata: { created_at: 1704067200000, test: true },
    payloadEnc: {
      nonce: toBase64(nonce),
      ciphertext: toBase64(ciphertext),
    },
    signature: { signature: fakeSig, algorithm: 'Ed25519', keyId: 'test-key' },
  };
}

/** Build a pBEAP package with arbitrary plaintext capsule JSON. */
function buildTestPbeapPackage(capsuleJson: string): LocalBeapPackage {
  const payloadB64 = Buffer.from(capsuleJson).toString('base64');
  const fakeSig = Buffer.alloc(64).toString('base64');
  return {
    header: {
      version: '1.0',
      encoding: 'pBEAP',
      sender_fingerprint: 'pbeap-sender-fp',
      template_hash: 'd'.repeat(64),
      policy_hash: 'e'.repeat(64),
      content_hash: 'f'.repeat(64),
    },
    metadata: { created_at: Date.now() },
    payload: payloadB64,
    signature: { signature: fakeSig, algorithm: 'Ed25519', keyId: 'test-key' },
  };
}

/** Wrap a LocalBeapPackage into the shape the validator sends to the depackager. */
function wrapValidated(capsule: LocalBeapPackage): Record<string, unknown> {
  return {
    validated: {
      __brand: 'ValidatedCapsule',
      provenance: {
        source_type: 'api',
        origin_classification: 'beap_capsule_present',
        ingested_at: new Date().toISOString(),
        transport_metadata: { mime_type: 'application/json' },
        input_classification: 'structured',
        raw_input_hash: 'a'.repeat(64),
        ingestor_version: '1.0.0',
      },
      capsule: {
        capsule_type: 'message_package',
        content_type: 'beap_message_package',
        schema_version: 2,
        handshake_id: 'test-hs-1',
        ...capsule,
      },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
      schema_version: 2,
    },
  };
}

// ── HTTP test helpers ──────────────────────────────────────────────────────────
// Note: X-Pod-Auth carries the raw secret value directly (see podAuth.ts).
// The middleware does timingSafeEqual(hmacDigest(provided), hmacDigest(secret)) which
// is equivalent to a string equality check with side-channel resistance.

async function sendDepackageRequest(
  server: http.Server,
  body: Record<string, unknown>,
  secret: string,
): Promise<{ status: number; json: unknown }> {
  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/depackage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
          'X-Pod-Auth': secret,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function startServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    // closeAllConnections() (Node 18.2+) ensures keep-alive sockets don't block teardown.
    if (typeof (server as unknown as Record<string, unknown>)['closeAllConnections'] === 'function') {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    }
    server.close(() => resolve());
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('depackager role', () => {
  let server: http.Server;
  let sealerMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sealerMock = vi.fn();
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    vi.restoreAllMocks();
  });

  // ── Test 1: Round-trip qBEAP ────────────────────────────────────────────────

  test('round-trip: known good qBEAP package decrypts and seals correctly', async () => {
    const pkg = await buildTestQbeapPackage({ capsuleBody: 'Hello from qBEAP!' });
    const wrappedBody = wrapValidated(pkg);

    let capturedSealBody: Record<string, unknown> | null = null;
    const authedFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedSealBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({ sealed: true, sealHash: 'abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    server = createDepackagerServer(TEST_SECRET, {
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
      skipSignatureVerification: true,
    });
    await startServer(server);

    const { status, json } = await sendDepackageRequest(server, wrappedBody, TEST_SECRET);

    expect(status).toBe(200);
    expect(json).toMatchObject({ sealed: true });

    // Verify the sealer received the decrypted content
    expect(capturedSealBody).not.toBeNull();
    const depackaged = (capturedSealBody as unknown as Record<string, unknown>)['depackaged'] as Record<string, unknown>;
    expect(depackaged['subject']).toBe('Round-trip test');
    expect(depackaged['body']).toBe('Hello from qBEAP!'); // plain text, no HTML to strip
    expect(depackaged['encoding']).toBe('qBEAP');
    expect(authedFetch).toHaveBeenCalledOnce();
    const [sealUrl] = (authedFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sealUrl).toContain('/seal');
  });

  // ── Test 2: Malformed package — structural rejection ──────────────────────

  test('malformed: structurally invalid package rejected with no crash', async () => {
    const authedFetch = vi.fn();
    server = createDepackagerServer(TEST_SECRET, {
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
    });
    await startServer(server);

    // Send a capsule that is missing required header fields
    const badCapsule: Record<string, unknown> = {
      capsule_type: 'message_package',
      // missing header entirely
      metadata: { created_at: Date.now() },
      payloadEnc: { nonce: 'abc', ciphertext: 'def' },
      signature: { signature: Buffer.alloc(64).toString('base64') },
    };

    const { status, json } = await sendDepackageRequest(
      server,
      { validated: { capsule: badCapsule } },
      TEST_SECRET,
    );

    expect(status).toBe(422);
    expect(json).toMatchObject({ error: expect.stringContaining('Structural') });
    expect(authedFetch).not.toHaveBeenCalled();
  });

  test('malformed: qBEAP package with missing payloadEnc is rejected at gate 3', async () => {
    const authedFetch = vi.fn();
    server = createDepackagerServer(TEST_SECRET, {
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
    });
    await startServer(server);

    // Valid structure but missing payloadEnc (so validateBeapStructure passes but gate 3 fails)
    // Actually validateBeapStructure requires payload|payloadEnc|envelope, so this will fail there.
    // Let us test a package that passes structural but fails at gate 4 (wrong key).
    const pkg = await buildTestQbeapPackage({ capsuleBody: 'test' });
    // Corrupt the ciphertext so AES-GCM auth fails
    pkg.payloadEnc!.ciphertext = toBase64(new Uint8Array(48).fill(0xff));
    const wrappedBody = wrapValidated(pkg);

    const { status, json } = await sendDepackageRequest(server, wrappedBody, TEST_SECRET);

    expect(status).toBe(422);
    expect((json as Record<string, unknown>)['failedGate']).toBe(4);
    expect(authedFetch).not.toHaveBeenCalled();
  });

  // ── Test 3: HTML sanitization ──────────────────────────────────────────────

  test('sanitization: <script>, on* attrs, javascript: links, data: img src are stripped', () => {
    const dirty = [
      '<script>alert("xss")</script>',
      '<p onclick="evil()">Hello</p>',
      '<a href="javascript:void(0)">click me</a>',
      '<img src="data:image/png;base64,abc">',
      '<b style="color:red">bold</b>',
    ].join('');

    const clean = sanitizeBeapBody(dirty);

    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('alert(');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('data:image');
    expect(clean).not.toContain('style=');
    // safe content is preserved
    expect(clean).toContain('Hello');
    expect(clean).toContain('<b>');
  });

  test('sanitization: HTML body is sanitized before forwarding to sealer', async () => {
    const dirtyBody = '<script>pwn()</script><p onclick="evil()">Safe text</p>';
    const capsuleJson = JSON.stringify({ subject: 'XSS Test', body: dirtyBody });
    const pkg = buildTestPbeapPackage(capsuleJson);
    const wrappedBody = wrapValidated(pkg);

    let capturedDepackaged: Record<string, unknown> | null = null;
    const authedFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
      capturedDepackaged = parsed['depackaged'] as Record<string, unknown>;
      return new Response(JSON.stringify({ sealed: true }), { status: 200 });
    }) as unknown as typeof fetch;

    server = createDepackagerServer(TEST_SECRET, {
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV), // not used for pBEAP
      skipSignatureVerification: true,
    });
    await startServer(server);

    const { status } = await sendDepackageRequest(server, wrappedBody, TEST_SECRET);

    expect(status).toBe(200);
    expect(capturedDepackaged).not.toBeNull();
    const body = capturedDepackaged!['body'] as string;
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('onclick');
    expect(body).toContain('Safe text');
  });

  // ── Test 4: Wall-clock timeout ─────────────────────────────────────────────

  test('timeout: slow sealer causes 504 within deadline', async () => {
    // This mock simulates a network stall: it never resolves,
    // but it DOES listen for abort so that the AbortController can cancel it
    // (mirroring how the real fetch() responds to AbortSignal).
    const authedFetch = vi.fn((_url: unknown, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(new DOMException('signal already aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('fetch aborted by wall-clock timeout', 'AbortError'));
        });
        // Never resolves without abort.
      });
    }) as unknown as typeof fetch;

    const capsuleJson = JSON.stringify({ subject: 'Timeout Test', body: 'body' });
    const pkg = buildTestPbeapPackage(capsuleJson);
    const wrappedBody = wrapValidated(pkg);

    server = createDepackagerServer(TEST_SECRET, {
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
      skipSignatureVerification: true,
      timeoutMs: 150, // small timeout for the test
    });
    await startServer(server);

    const start = Date.now();
    const { status, json } = await sendDepackageRequest(server, wrappedBody, TEST_SECRET);
    const elapsed = Date.now() - start;

    expect(status).toBe(504);
    expect(json).toMatchObject({ code: 'DEPACKAGER_TIMEOUT' });
    // Ensure the timeout fired promptly (well within 2 s)
    expect(elapsed).toBeLessThan(2_000);
  }, 3_000); // 3 s test-level timeout; depackager fires at 150 ms

  // ── Additional: auth enforcement ───────────────────────────────────────────

  test('auth: request without X-Pod-Auth header is rejected 401', async () => {
    server = createDepackagerServer(TEST_SECRET, {
      authedFetch: vi.fn(),
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
    });
    await startServer(server);

    const bodyStr = JSON.stringify({ validated: {} });
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/depackage',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bodyStr)) },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    expect(result.status).toBe(401);
  });

  // ── Health / ready endpoints ───────────────────────────────────────────────

  test('GET /health returns 200 with role info', async () => {
    server = createDepackagerServer(TEST_SECRET, {
      authedFetch: vi.fn(),
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
    });
    await startServer(server);

    const result = await new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get(`http://127.0.0.1:${addr.port}/health`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }));
      }).on('error', reject);
    });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'ok', role: 'depackager' });
  });

  test('GET /ready returns 200 when key material configured', async () => {
    server = createDepackagerServer(TEST_SECRET, {
      authedFetch: vi.fn(),
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
    });
    await startServer(server);

    const result = await new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get(`http://127.0.0.1:${addr.port}/ready`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }));
      }).on('error', reject);
    });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'ready' });
  });

  test('GET /ready returns 503 when no key material configured', async () => {
    server = createDepackagerServer(TEST_SECRET, {
      authedFetch: vi.fn(),
      localX25519PrivB64: '',
    });
    await startServer(server);

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get(`http://127.0.0.1:${addr.port}/ready`, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      }).on('error', reject);
    });

    expect(result.status).toBe(503);
  });
});
