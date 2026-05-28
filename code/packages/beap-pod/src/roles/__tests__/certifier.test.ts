/**
 * Certifier role — test suite (P3.4)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import http from 'node:http';
import { ed25519 } from '@noble/curves/ed25519.js';
import { verifyCertificate } from '@repo/beap-cert';
import {
  buildEdgeCertificate,
  createCertifierServer,
  loadCertifierRuntimeState,
  parseEdgePrivateKeyHex,
  parseEdgePodId,
  parseSsoAttestationJwt,
} from '../certifier.js';

const TEST_SECRET = 'certifier-test-secret-32-bytes!!';
const FIXTURE_SECRET_KEY = ed25519.utils.randomSecretKey();
const FIXTURE_PUBLIC_KEY = ed25519.getPublicKey(FIXTURE_SECRET_KEY);
const FIXTURE_PRIVATE_HEX = Buffer.from(FIXTURE_SECRET_KEY).toString('hex');
const FIXTURE_POD_ID = '550e8400-e29b-41d4-a716-446655440000';
const FIXTURE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.stub';

function fixtureState() {
  return loadCertifierRuntimeState({
    EDGE_PRIVATE_KEY_HEX: FIXTURE_PRIVATE_HEX,
    EDGE_POD_ID: FIXTURE_POD_ID,
    SSO_ATTESTATION_JWT: FIXTURE_JWT,
    CERT_TTL_SECONDS: '86400',
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolveStop) => {
    if (typeof (server as unknown as Record<string, unknown>)['closeAllConnections'] === 'function') {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    }
    server.close(() => resolveStop());
  });
}

async function startServer(server: http.Server): Promise<void> {
  return new Promise((resolveStart) => server.listen(0, '127.0.0.1', resolveStart));
}

async function postCertify(
  server: http.Server,
  body: Record<string, unknown>,
  secret: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const bodyStr = JSON.stringify(body);
  return new Promise((resolvePost, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/certify',
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
            resolvePost({
              status: res.statusCode ?? 0,
              json: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
            });
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

function sampleCertifyBody(overrides: Record<string, unknown> = {}) {
  const raw = Buffer.from('{"capsule":"smoke-bytes"}', 'utf8');
  const capsule = Buffer.from('{"normalized":true}', 'utf8');
  const validation = Buffer.from('{"valid":true}', 'utf8');
  return {
    depackaged: { subject: 'test', body: '<p>hi</p>' },
    raw_package_bytes_b64: raw.toString('base64'),
    canonical_capsule_bytes_b64: capsule.toString('base64'),
    canonical_validation_result_bytes_b64: validation.toString('base64'),
    ...overrides,
  };
}

function sanitizeCertSnapshot(cert: Record<string, unknown>) {
  const { edge_signature: _sig, issued_at: _i, expires_at: _e, ...rest } = cert;
  return rest;
}

describe('parseEdgePrivateKeyHex', () => {
  test('missing or empty → throws', () => {
    expect(() => parseEdgePrivateKeyHex(undefined)).toThrow('not set or is empty');
    expect(() => parseEdgePrivateKeyHex('')).toThrow('not set or is empty');
  });

  test('invalid hex or wrong length → throws', () => {
    expect(() => parseEdgePrivateKeyHex('zz'.repeat(32))).toThrow('non-hex');
    expect(() => parseEdgePrivateKeyHex('abc')).toThrow('odd length');
    expect(() => parseEdgePrivateKeyHex('ab'.repeat(16))).toThrow('32 bytes');
  });

  test('valid 32-byte key → Uint8Array length 32', () => {
    const key = parseEdgePrivateKeyHex(FIXTURE_PRIVATE_HEX);
    expect(key.length).toBe(32);
  });
});

describe('parseEdgePodId / parseSsoAttestationJwt', () => {
  test('invalid pod id → throws', () => {
    expect(() => parseEdgePodId(undefined)).toThrow('EDGE_POD_ID');
    expect(() => parseEdgePodId('not-a-uuid')).toThrow('valid UUID');
  });

  test('malformed JWT → throws', () => {
    expect(() => parseSsoAttestationJwt(undefined)).toThrow('SSO_ATTESTATION_JWT');
    expect(() => parseSsoAttestationJwt('only.two')).toThrow('malformed');
  });
});

describe('buildEdgeCertificate', () => {
  test('happy path: signature verifies against public key', () => {
    const state = fixtureState();
    const input = {
      rawPackageBytes: Uint8Array.from(Buffer.from('raw-package', 'utf8')),
      canonicalCapsuleBytes: Uint8Array.from(Buffer.from('{"capsule":1}', 'utf8')),
      canonicalValidationResultBytes: Uint8Array.from(Buffer.from('{"valid":true}', 'utf8')),
    };
    const cert = buildEdgeCertificate(state, input, new Date('2026-05-24T10:00:00.000Z'));
    const verified = verifyCertificate(cert, FIXTURE_PUBLIC_KEY);
    expect(verified.ok).toBe(true);
    expect(cert.edge_signature).toMatch(/^ed25519:[0-9a-f]{128}$/);
    expect(cert.edge_pod_id).toBe(FIXTURE_POD_ID);
    expect(cert.sso_attestation).toBe(FIXTURE_JWT);
  });

  test('same input twice → same hashes, different timestamps, both verify', () => {
    const state = fixtureState();
    const input = {
      rawPackageBytes: Uint8Array.from(Buffer.from('same', 'utf8')),
      canonicalCapsuleBytes: Uint8Array.from(Buffer.from('{"c":1}', 'utf8')),
      canonicalValidationResultBytes: Uint8Array.from(Buffer.from('{"v":1}', 'utf8')),
    };
    const cert1 = buildEdgeCertificate(state, input, new Date('2026-05-24T10:00:00.000Z'));
    const cert2 = buildEdgeCertificate(state, input, new Date('2026-05-24T11:00:00.000Z'));
    expect(cert1.package_hash).toBe(cert2.package_hash);
    expect(cert1.capsule_canonical_hash).toBe(cert2.capsule_canonical_hash);
    expect(cert1.validation_result_digest).toBe(cert2.validation_result_digest);
    expect(cert1.issued_at).not.toBe(cert2.issued_at);
    expect(cert1.expires_at).not.toBe(cert2.expires_at);
    expect(verifyCertificate(cert1, FIXTURE_PUBLIC_KEY).ok).toBe(true);
    expect(verifyCertificate(cert2, FIXTURE_PUBLIC_KEY).ok).toBe(true);
  });

  test('certificate structure snapshot (dynamic fields stripped)', () => {
    const cert = buildEdgeCertificate(
      fixtureState(),
      {
        rawPackageBytes: Uint8Array.from(Buffer.from('snap', 'utf8')),
        canonicalCapsuleBytes: Uint8Array.from(Buffer.from('{"snap":true}', 'utf8')),
        canonicalValidationResultBytes: Uint8Array.from(Buffer.from('{"valid":true}', 'utf8')),
      },
      new Date('2026-05-24T10:00:00.000Z'),
    );
    expect(sanitizeCertSnapshot(cert as unknown as Record<string, unknown>)).toMatchSnapshot();
  });
});

describe('certifier HTTP server', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  test('POST /certify happy path returns verifiable edge_certificate', async () => {
    server = createCertifierServer(TEST_SECRET, fixtureState());
    await startServer(server);

    const result = await postCertify(server, sampleCertifyBody(), TEST_SECRET);
    expect(result.status).toBe(200);
    const cert = result.json['edge_certificate'] as Record<string, unknown>;
    expect(result.json['depackaged_payload']).toBeDefined();
    const verified = verifyCertificate(cert as never, FIXTURE_PUBLIC_KEY);
    expect(verified.ok).toBe(true);
  });

  test('POST /certify binds extracted_text_v1 into validation_result_digest', async () => {
    server = createCertifierServer(TEST_SECRET, fixtureState());
    await startServer(server);

    const plain = await postCertify(server, sampleCertifyBody(), TEST_SECRET);
    const withExtract = await postCertify(
      server,
      sampleCertifyBody({
        depackaged: {
          subject: 'test',
          body: '<p>hi</p>',
          attachments: [
            {
              id: 'att-1',
              filename: 'f.pdf',
              content_type: 'application/pdf',
              size: 1,
              extracted_text_v1: {
                text: 'edge text',
                structural_hash: 'edge-hash',
                extractor_version: 'beap-pdf-extract-v1',
              },
            },
          ],
        },
      }),
      TEST_SECRET,
    );

    const plainDigest = (plain.json['edge_certificate'] as Record<string, unknown>)[
      'validation_result_digest'
    ];
    const extractDigest = (withExtract.json['edge_certificate'] as Record<string, unknown>)[
      'validation_result_digest'
    ];
    expect(plainDigest).not.toBe(extractDigest);
  });

  test('missing X-Pod-Auth → 401', async () => {
    server = createCertifierServer(TEST_SECRET, fixtureState());
    await startServer(server);

    const result = await postCertify(server, sampleCertifyBody(), 'wrong-secret');
    expect(result.status).toBe(401);
  });

  test('GET /health returns 200', async () => {
    server = createCertifierServer(TEST_SECRET, fixtureState());
    await startServer(server);
    const addr = server.address() as { port: number };
    const result = await new Promise<{ status: number; json: Record<string, unknown> }>((resolveGet, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/health`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolveGet({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }),
        );
      }).on('error', reject);
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'ok', role: 'certifier' });
  });

  test('GET /ready returns 200 when configured', async () => {
    server = createCertifierServer(TEST_SECRET, fixtureState());
    await startServer(server);
    const addr = server.address() as { port: number };
    const result = await new Promise<{ status: number }>((resolveGet, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/ready`, (res) => {
        res.resume();
        res.on('end', () => resolveGet({ status: res.statusCode ?? 0 }));
      }).on('error', reject);
    });
    expect(result.status).toBe(200);
  });
});

describe('startup failure', () => {
  test('missing EDGE_PRIVATE_KEY_HEX → exit code 1', async () => {
    const certifierPath = resolve(fileURLToPath(new URL('../certifier.js', import.meta.url)));
    const code = await new Promise<number>((resolveCode) => {
      const child = spawn(process.execPath, [certifierPath], {
        env: {
          ...process.env,
          POD_AUTH_SECRET: TEST_SECRET,
          EDGE_POD_ID: FIXTURE_POD_ID,
          SSO_ATTESTATION_JWT: FIXTURE_JWT,
          EDGE_PRIVATE_KEY_HEX: '',
        },
        stdio: 'ignore',
      });
      child.on('exit', (c) => resolveCode(c ?? -1));
    });
    expect(code).toBe(1);
  });

  test('invalid EDGE_PRIVATE_KEY_HEX length → exit code 1', async () => {
    const certifierPath = resolve(fileURLToPath(new URL('../certifier.js', import.meta.url)));
    const code = await new Promise<number>((resolveCode) => {
      const child = spawn(process.execPath, [certifierPath], {
        env: {
          ...process.env,
          POD_AUTH_SECRET: TEST_SECRET,
          EDGE_POD_ID: FIXTURE_POD_ID,
          SSO_ATTESTATION_JWT: FIXTURE_JWT,
          EDGE_PRIVATE_KEY_HEX: 'ab'.repeat(16),
        },
        stdio: 'ignore',
      });
      child.on('exit', (c) => resolveCode(c ?? -1));
    });
    expect(code).toBe(1);
  });
});

describe('log safety', () => {
  test('parseEdgePrivateKeyHex errors do not echo key material', () => {
    const bad = 'gg'.repeat(32);
    let msg = '';
    try {
      parseEdgePrivateKeyHex(bad);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain(bad);
  });
});
