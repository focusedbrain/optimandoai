/**
 * Verifier role — test suite (P3.6)
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import http from 'node:http';
import { ed25519 } from '@noble/curves/ed25519.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  capsuleCanonicalHash,
  packageHash,
  signCertificate,
  validationResultDigest,
} from '@repo/beap-cert';
import type { EdgeCertificate, UnsignedCertificate } from '@repo/beap-cert';
import {
  VERIFY_REASON,
  certCorrelationId,
  createVerifierServer,
  loadVerifierRuntimeState,
  parseEdgePubkeyClaim,
  parseKeycloakJwksJson,
  parseLocalSsoSub,
  parseTrustedEdgePodIds,
  verifyCertificateAcceptance,
} from '../verifier.js';

const TEST_SECRET = 'verifier-test-secret-32-bytes!!';
const LOCAL_SSO_SUB = 'verifier-test-user-sub';
const EDGE_POD_ID = '550e8400-e29b-41d4-a716-446655440000';
const UNTRUSTED_POD_ID = '660e8400-e29b-41d4-a716-446655440001';
const FIXED_NOW = new Date('2026-05-24T12:00:00.000Z');

const EDGE_SECRET_KEY = ed25519.utils.randomSecretKey();
const EDGE_PUBLIC_KEY = ed25519.getPublicKey(EDGE_SECRET_KEY);
const EDGE_PUBKEY_CLAIM = `ed25519:${Buffer.from(EDGE_PUBLIC_KEY).toString('hex')}`;

interface FixtureBundle {
  jwksJson: string;
  state: ReturnType<typeof loadVerifierRuntimeState>;
  rawPackageBytes: Uint8Array;
  certificate: EdgeCertificate;
}

async function buildFixture(overrides: {
  cert?: Partial<UnsignedCertificate>;
  attestation?: Record<string, unknown>;
  attestationExp?: number;
  signWithEdgeKey?: Uint8Array;
  trustedIds?: string;
} = {}): Promise<FixtureBundle> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-kid';
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  const jwksJson = JSON.stringify({ keys: [jwk] });

  const exp =
    overrides.attestationExp ?? Math.floor(Date.now() / 1000) + 86_400;
  const attestationPayload = {
    sub: LOCAL_SSO_SUB,
    pod_id: EDGE_POD_ID,
    edge_pubkey: EDGE_PUBKEY_CLAIM,
    ...overrides.attestation,
  };

  const ssoAttestation = await new SignJWT(attestationPayload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuedAt(Math.floor(FIXED_NOW.getTime() / 1000) - 60)
    .setExpirationTime(exp)
    .sign(privateKey);

  const rawPackageBytes = Uint8Array.from(Buffer.from('{"wire":"package"}', 'utf8'));
  const capsuleBytes = Uint8Array.from(Buffer.from('{"capsule":true}', 'utf8'));
  const validationBytes = Uint8Array.from(Buffer.from('{"valid":true}', 'utf8'));

  const unsigned: UnsignedCertificate = {
    v: 1,
    package_hash: packageHash(rawPackageBytes),
    capsule_canonical_hash: capsuleCanonicalHash(capsuleBytes),
    validation_result_digest: validationResultDigest(validationBytes),
    edge_pod_id: EDGE_POD_ID,
    issued_at: '2026-05-24T11:00:00.000Z',
    expires_at: '2026-05-25T12:00:00.000Z',
    sso_attestation: ssoAttestation,
    ...overrides.cert,
  };

  const signingKey = overrides.signWithEdgeKey ?? EDGE_SECRET_KEY;
  const certificate = signCertificate(unsigned, signingKey);

  const state = loadVerifierRuntimeState({
    LOCAL_SSO_SUB,
    TRUSTED_EDGE_POD_IDS: overrides.trustedIds ?? EDGE_POD_ID,
    KEYCLOAK_JWKS_JSON: jwksJson,
  });

  return { jwksJson, state, rawPackageBytes, certificate };
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

async function postVerifyCert(
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
        path: '/verify-cert',
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
          resolvePost({
            status: res.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

describe('parseLocalSsoSub / parseTrustedEdgePodIds / parseKeycloakJwksJson', () => {
  test('missing LOCAL_SSO_SUB → throws', () => {
    expect(() => parseLocalSsoSub(undefined)).toThrow('LOCAL_SSO_SUB');
  });

  test('invalid TRUSTED_EDGE_POD_IDS → throws', () => {
    expect(() => parseTrustedEdgePodIds(undefined)).toThrow('TRUSTED_EDGE_POD_IDS');
    expect(() => parseTrustedEdgePodIds('not-a-uuid')).toThrow('valid UUID');
  });

  test('missing JWKS → throws', () => {
    expect(() =>
      loadVerifierRuntimeState({
        LOCAL_SSO_SUB: 'x',
        TRUSTED_EDGE_POD_IDS: EDGE_POD_ID,
      }),
    ).toThrow('Neither KEYCLOAK_JWKS_JSON');
  });

  test('parseKeycloakJwksJson accepts valid JWK set', async () => {
    const { jwksJson } = await buildFixture();
    expect(parseKeycloakJwksJson(jwksJson)).toBeDefined();
  });
});

describe('parseEdgePubkeyClaim', () => {
  test('accepts ed25519: prefix and raw hex', () => {
    const hex = Buffer.from(EDGE_PUBLIC_KEY).toString('hex');
    expect(parseEdgePubkeyClaim(`ed25519:${hex}`)?.length).toBe(32);
    expect(parseEdgePubkeyClaim(hex)?.length).toBe(32);
  });

  test('rejects malformed values', () => {
    expect(parseEdgePubkeyClaim('ed25519:abc')).toBeNull();
    expect(parseEdgePubkeyClaim(42)).toBeNull();
  });
});

describe('verifyCertificateAcceptance — happy path', () => {
  test('valid attestation + cert → ok', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: true, edge_pod_id: EDGE_POD_ID, sub: LOCAL_SSO_SUB });
  });
});

describe('verifyCertificateAcceptance — reason codes', () => {
  test('EDGE_NOT_TRUSTED', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture({
      trustedIds: UNTRUSTED_POD_ID,
    });
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.EDGE_NOT_TRUSTED });
  });

  test('CERT_EXPIRED', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture({
      cert: { expires_at: '2026-05-24T11:00:00.000Z' },
    });
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.CERT_EXPIRED });
  });

  test('PACKAGE_HASH_MISMATCH (not generic signature failure)', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const tampered = {
      ...certificate,
      package_hash: 'sha256:' + '0'.repeat(64),
    };
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate: tampered },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.PACKAGE_HASH_MISMATCH });
  });

  test('SSO_ATTESTATION_INVALID', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const tampered = {
      ...certificate,
      sso_attestation: certificate.sso_attestation.slice(0, -4) + 'XXXX',
    };
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate: tampered },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.SSO_ATTESTATION_INVALID });
  });

  test('SSO_ATTESTATION_EXPIRED', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture({
      attestationExp: Math.floor(FIXED_NOW.getTime() / 1000) - 120,
    });
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.SSO_ATTESTATION_EXPIRED });
  });

  test('SSO_SUB_MISMATCH', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture({
      attestation: { sub: 'wrong-user' },
    });
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.SSO_SUB_MISMATCH });
  });

  test('ATTESTATION_POD_ID_MISMATCH', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture({
      attestation: { pod_id: UNTRUSTED_POD_ID },
    });
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.ATTESTATION_POD_ID_MISMATCH });
  });

  test('EDGE_SIGNATURE_INVALID on mutated signature', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const tampered = {
      ...certificate,
      edge_signature: 'ed25519:' + 'f'.repeat(128),
    };
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate: tampered },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.EDGE_SIGNATURE_INVALID });
  });

  test('EDGE_SIGNATURE_INVALID when signed with wrong edge key', async () => {
    const wrongKey = ed25519.utils.randomSecretKey();
    const { state, rawPackageBytes, certificate } = await buildFixture({
      signWithEdgeKey: wrongKey,
    });
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.EDGE_SIGNATURE_INVALID });
  });

  test('CAPSULE_CANONICAL_HASH_MISMATCH on deep check', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const wrongCapsule = Uint8Array.from(Buffer.from('{"wrong":true}', 'utf8'));
    const result = await verifyCertificateAcceptance(
      state,
      { rawPackageBytes, certificate, expectedCapsuleCanonicalBytes: wrongCapsule },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.CAPSULE_CANONICAL_HASH_MISMATCH });
  });

  test('VALIDATION_RESULT_DIGEST_MISMATCH on deep check', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const capsuleBytes = Uint8Array.from(Buffer.from('{"capsule":true}', 'utf8'));
    const wrongValidation = Uint8Array.from(Buffer.from('{"valid":false}', 'utf8'));
    const result = await verifyCertificateAcceptance(
      state,
      {
        rawPackageBytes,
        certificate,
        expectedCapsuleCanonicalBytes: capsuleBytes,
        expectedValidationResultBytes: wrongValidation,
      },
      FIXED_NOW,
    );
    expect(result).toEqual({ ok: false, reason: VERIFY_REASON.VALIDATION_RESULT_DIGEST_MISMATCH });
  });

  test('deep check passes when hashes match cert', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    const capsuleBytes = Uint8Array.from(Buffer.from('{"capsule":true}', 'utf8'));
    const validationBytes = Uint8Array.from(Buffer.from('{"valid":true}', 'utf8'));
    const result = await verifyCertificateAcceptance(
      state,
      {
        rawPackageBytes,
        certificate,
        expectedCapsuleCanonicalBytes: capsuleBytes,
        expectedValidationResultBytes: validationBytes,
      },
      FIXED_NOW,
    );
    expect(result.ok).toBe(true);
  });
});

describe('verifier HTTP server', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  test('POST /verify-cert happy path', async () => {
    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const { state, rawPackageBytes, certificate } = await buildFixture();
      server = createVerifierServer(TEST_SECRET, state);
      await startServer(server);

      const result = await postVerifyCert(
        server,
        {
          raw_package_bytes_b64: Buffer.from(rawPackageBytes).toString('base64'),
          certificate,
        },
        TEST_SECRET,
      );
      expect(result.status).toBe(200);
      expect(result.json).toEqual({ ok: true, edge_pod_id: EDGE_POD_ID, sub: LOCAL_SSO_SUB });

      const auditChunk = writes.find((w) => w.includes('beap_edge_verification'));
      expect(auditChunk).toBeDefined();
      const audit = JSON.parse(auditChunk!.trim());
      expect(audit.result).toBe('verified');
      expect(audit.phase).toBe('shallow');
      expect(audit.edge_pod_id).toBe(EDGE_POD_ID);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  test('missing X-Pod-Auth → 401', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture();
    server = createVerifierServer(TEST_SECRET, state);
    await startServer(server);

    const result = await postVerifyCert(
      server,
      {
        raw_package_bytes_b64: Buffer.from(rawPackageBytes).toString('base64'),
        certificate,
      },
      'wrong-secret',
    );
    expect(result.status).toBe(401);
  });

  test('GET /health and /ready', async () => {
    const { state } = await buildFixture();
    server = createVerifierServer(TEST_SECRET, state);
    await startServer(server);
    const addr = server.address() as { port: number };

    const health = await new Promise<{ status: number; json: Record<string, unknown> }>(
      (resolveGet, reject) => {
        http
          .get(`http://127.0.0.1:${addr.port}/health`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolveGet({
                status: res.statusCode ?? 0,
                json: JSON.parse(Buffer.concat(chunks).toString()),
              }),
            );
          })
          .on('error', reject);
      },
    );
    expect(health.json).toMatchObject({ status: 'ok', role: 'verifier' });

    const ready = await new Promise<number>((resolveGet, reject) => {
      http
        .get(`http://127.0.0.1:${addr.port}/ready`, (res) => {
          res.resume();
          res.on('end', () => resolveGet(res.statusCode ?? 0));
        })
        .on('error', reject);
    });
    expect(ready).toBe(200);
  });
});

describe('startup failure', () => {
  test('missing LOCAL_SSO_SUB → exit code 1', async () => {
    const verifierPath = resolve(fileURLToPath(new URL('../verifier.js', import.meta.url)));
    const code = await new Promise<number>((resolveCode) => {
      const child = spawn(process.execPath, [verifierPath], {
        env: {
          ...process.env,
          POD_AUTH_SECRET: TEST_SECRET,
          TRUSTED_EDGE_POD_IDS: EDGE_POD_ID,
          KEYCLOAK_JWKS_JSON: '{"keys":[]}',
          LOCAL_SSO_SUB: '',
        },
        stdio: 'ignore',
      });
      child.on('exit', (c) => resolveCode(c ?? -1));
    });
    expect(code).toBe(1);
  });
});

describe('log safety', () => {
  test('rejection logs reason + correlation only, not cert body', async () => {
    const { state, rawPackageBytes, certificate } = await buildFixture({
      trustedIds: UNTRUSTED_POD_ID,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await verifyCertificateAcceptance(state, { rawPackageBytes, certificate }, FIXED_NOW);
    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('EDGE_NOT_TRUSTED');
    expect(logged).toContain(certCorrelationId(certificate));
    expect(logged).not.toContain(certificate.sso_attestation);
    expect(logged).not.toContain(certificate.edge_signature);
    expect(logged).not.toContain(certificate.package_hash);
    logSpy.mockRestore();
  });
});
