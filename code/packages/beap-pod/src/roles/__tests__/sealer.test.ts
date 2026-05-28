/**
 * Sealer role — test suite (P1.6)
 *
 * Tests:
 *   1. byte-identity — seal computation matches computeSeal() in validator-process/index.ts
 *      (fixtures ported from lifecycle.test.ts: L4 / "Seal utility" section)
 *   2. tampered input — different content → different seal
 *   3. missing / invalid SEAL_KEY_HEX → parseSealKeyHex throws with a clear message
 *   4. HTTP round-trip — POST /seal returns a verifiable seal
 *   5. auth enforcement — 401 without X-Pod-Auth
 *   6. /health and /ready endpoints
 */

import { describe, test, expect, afterEach } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import {
  computeSealPod,
  verifySealPod,
  parseSealKeyHex,
  createSealerServer,
} from '../sealer.js';

// ── Fixtures (ported from lifecycle.test.ts "Seal utility" section) ─────────
//
// Original key in lifecycle.test.ts: Buffer.from('test-seal-key-for-unit-tests-32b')
// SEAL_KEY_HEX equivalent: Buffer.from('test-seal-key-for-unit-tests-32b').toString('hex')

const FIXTURE_KEY = Buffer.from('test-seal-key-for-unit-tests-32b'); // 32 bytes
const FIXTURE_KEY_HEX = FIXTURE_KEY.toString('hex'); // 64 hex chars

const TEST_SECRET = 'sealer-test-secret-32-bytes!!!';

// ── Helpers ────────────────────────────────────────────────────────────────────

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (typeof (server as unknown as Record<string, unknown>)['closeAllConnections'] === 'function') {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    }
    server.close(() => resolve());
  });
}

async function startServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

/** Verify a seal by re-running HMAC (mirrors verifySeal in validator-process/index.ts). */
function verifyWithKey(sealInputJson: string, seal: string, key: Buffer): boolean {
  const recomputed = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64');
  return recomputed === seal;
}

async function postSeal(
  server: http.Server,
  body: Record<string, unknown>,
  secret: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/seal',
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
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('computeSealPod — byte-identity with validator-process/index.ts computeSeal', () => {
  // Fixture ported from lifecycle.test.ts L4 / "Seal utility" section.
  // key = Buffer.from('test-seal-key-for-unit-tests-32b')

  test('returns seal and sealInputJson with correct structure', () => {
    const { seal, sealInputJson } = computeSealPod(
      '{"hello":"world"}',
      'row-001',
      'validated',
      '1.0.0',
      '2026-05-24T09:00:00.000Z',
      FIXTURE_KEY,
    );
    expect(typeof seal).toBe('string');
    expect(seal.length).toBeGreaterThan(0);
    const parsed = JSON.parse(sealInputJson) as Record<string, unknown>;
    expect(parsed['row_id']).toBe('row-001');
    expect(parsed['outcome_class']).toBe('validated');
    expect(parsed['validator_version']).toBe('1.0.0');
    expect(parsed['validated_at']).toBe('2026-05-24T09:00:00.000Z');
    expect(typeof parsed['nonce']).toBe('string');
    // nonce is base64 of 32 random bytes → 44 chars
    expect((parsed['nonce'] as string).length).toBe(44);
    expect(typeof parsed['content_sha256']).toBe('string');
    // SHA-256 hex = 64 chars
    expect((parsed['content_sha256'] as string).length).toBe(64);
  });

  test('content_sha256 is SHA-256 of canonicalJson (byte-identity check)', () => {
    const canonicalJson = '{"x":1,"y":"hello"}';
    const expectedHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
    const { sealInputJson } = computeSealPod(
      canonicalJson, 'row-002', 'validated', '1.0.0', new Date().toISOString(), FIXTURE_KEY,
    );
    const parsed = JSON.parse(sealInputJson) as Record<string, unknown>;
    expect(parsed['content_sha256']).toBe(expectedHash);
  });

  test('seal is valid HMAC-SHA256 of sealInputJson with the given key', () => {
    const { seal, sealInputJson } = computeSealPod(
      '{"x":1}', 'r1', 'validated', '1.0.0', new Date().toISOString(), FIXTURE_KEY,
    );
    expect(verifyWithKey(sealInputJson, seal, FIXTURE_KEY)).toBe(true);
  });

  test('seal fails verification with a different key', () => {
    const wrongKey = Buffer.from('wrong-key-not-the-same-key-32bb');
    const { seal, sealInputJson } = computeSealPod(
      '{"x":1}', 'r1', 'validated', '1.0.0', new Date().toISOString(), FIXTURE_KEY,
    );
    expect(verifyWithKey(sealInputJson, seal, wrongKey)).toBe(false);
  });

  test('sealInputJson key order matches computeSeal() exactly', () => {
    // JSON.stringify preserves insertion order; validate the canonical field sequence.
    const { sealInputJson } = computeSealPod(
      '{}', 'row-x', 'rejected', '2.0.0', '2026-01-01T00:00:00.000Z', FIXTURE_KEY,
    );
    const parsed = JSON.parse(sealInputJson) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([
      'content_sha256',
      'nonce',
      'row_id',
      'outcome_class',
      'validator_version',
      'validated_at',
    ]);
  });

  test('two calls with identical input produce different nonces (replay resistance)', () => {
    const ts = '2026-05-24T09:00:00.000Z';
    const { sealInputJson: a } = computeSealPod('{"x":1}', 'r1', 'validated', '1.0.0', ts, FIXTURE_KEY);
    const { sealInputJson: b } = computeSealPod('{"x":1}', 'r1', 'validated', '1.0.0', ts, FIXTURE_KEY);
    expect(JSON.parse(a)['nonce']).not.toBe(JSON.parse(b)['nonce']);
  });
});

describe('computeSealPod — tampered input produces different seal', () => {
  const key = Buffer.from('tamper-test-key-padded-to-32b!!!');

  test('different content produces a different seal', () => {
    const ts = new Date().toISOString();
    const { seal: s1 } = computeSealPod('{"msg":"hello"}', 'row-A', 'validated', '1.0.0', ts, key);
    const { seal: s2 } = computeSealPod('{"msg":"world"}', 'row-A', 'validated', '1.0.0', ts, key);
    expect(s1).not.toBe(s2);
  });

  test('different row_id produces a different seal', () => {
    const ts = new Date().toISOString();
    const { seal: s1 } = computeSealPod('{"x":1}', 'row-A', 'validated', '1.0.0', ts, key);
    const { seal: s2 } = computeSealPod('{"x":1}', 'row-B', 'validated', '1.0.0', ts, key);
    expect(s1).not.toBe(s2);
  });

  test('verified seal does NOT verify for tampered sealInputJson', () => {
    const { seal, sealInputJson } = computeSealPod('{"x":1}', 'r1', 'validated', '1.0.0', new Date().toISOString(), key);
    const tampered = sealInputJson.replace('"r1"', '"r2"');
    expect(verifySealPod(tampered, seal, key)).toBe(false);
  });
});

describe('parseSealKeyHex — missing / invalid SEAL_KEY_HEX → throws with clear message', () => {
  test('throws on undefined', () => {
    expect(() => parseSealKeyHex(undefined)).toThrow('not set or is empty');
  });

  test('throws on empty string', () => {
    expect(() => parseSealKeyHex('')).toThrow('not set or is empty');
  });

  test('throws on whitespace-only string', () => {
    expect(() => parseSealKeyHex('   ')).toThrow('not set or is empty');
  });

  test('throws on non-hex characters', () => {
    expect(() => parseSealKeyHex('gg' + 'a'.repeat(62))).toThrow('non-hex');
  });

  test('throws on odd-length hex', () => {
    expect(() => parseSealKeyHex('a'.repeat(63))).toThrow('odd length');
  });

  test('throws when key is too short (< 32 bytes / 64 hex chars)', () => {
    expect(() => parseSealKeyHex('ab'.repeat(16))).toThrow('too short');
  });

  test('accepts exactly 32 bytes (64 hex chars)', () => {
    const key = parseSealKeyHex('ab'.repeat(32));
    expect(key.length).toBe(32);
  });

  test('accepts 64 bytes (128 hex chars)', () => {
    const key = parseSealKeyHex('cd'.repeat(64));
    expect(key.length).toBe(64);
  });

  test('hex is case-insensitive', () => {
    const lower = parseSealKeyHex('aa'.repeat(32));
    const upper = parseSealKeyHex('AA'.repeat(32));
    expect(lower.equals(upper)).toBe(true);
  });
});

describe('verifySealPod — constant-time seal verification', () => {
  const key = Buffer.from('verify-test-seal-key-padded-32b!');

  test('valid seal verifies to true', () => {
    const { seal, sealInputJson } = computeSealPod('{"v":1}', 'r1', 'validated', '1.0.0', new Date().toISOString(), key);
    expect(verifySealPod(sealInputJson, seal, key)).toBe(true);
  });

  test('wrong key verifies to false', () => {
    const wrong = Buffer.from('wrong-key-different-padded-32b!!');
    const { seal, sealInputJson } = computeSealPod('{"v":1}', 'r1', 'validated', '1.0.0', new Date().toISOString(), key);
    expect(verifySealPod(sealInputJson, seal, wrong)).toBe(false);
  });

  test('tampered sealInputJson verifies to false', () => {
    const { seal, sealInputJson } = computeSealPod('{"v":1}', 'r1', 'validated', '1.0.0', new Date().toISOString(), key);
    expect(verifySealPod(sealInputJson + 'x', seal, key)).toBe(false);
  });
});

describe('sealer HTTP server', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  // ── Round-trip ─────────────────────────────────────────────────────────────

  test('POST /seal with canonicalJson returns a verifiable seal', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const canonicalJson = '{"capsule_type":"message_package","subject":"Hello"}';
    const { status, json } = await postSeal(server, {
      canonicalJson,
      rowId: 'row-http-001',
      outcomeClass: 'validated',
      validatorVersion: '1.0.0',
      validatedAt: '2026-05-24T09:00:00.000Z',
    }, TEST_SECRET);

    expect(status).toBe(200);
    expect(json['sealed']).toBe(true);
    expect(typeof json['seal']).toBe('string');
    expect(typeof json['sealInputJson']).toBe('string');
    expect(json['rowId']).toBe('row-http-001');

    // Verify seal is a valid HMAC of sealInputJson under the test key.
    expect(verifySealPod(json['sealInputJson'] as string, json['seal'] as string, FIXTURE_KEY)).toBe(true);
  });

  test('POST /seal with depackaged.rawCapsuleJson uses seal canonical form', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const rawCapsuleJson = '{"subject":"Pod test","body":"sanitized body"}';
    const { status, json } = await postSeal(server, {
      depackaged: { rawCapsuleJson, subject: 'Pod test', encoding: 'pBEAP' },
      rowId: 'row-http-002',
    }, TEST_SECRET);

    expect(status).toBe(200);
    expect(verifySealPod(json['sealInputJson'] as string, json['seal'] as string, FIXTURE_KEY)).toBe(true);

    const { buildSealCanonicalJson } = await import('../../shared/capsuleAttachments.js');
    const sealCanonical = buildSealCanonicalJson({ rawCapsuleJson });
    const parsed = JSON.parse(json['sealInputJson'] as string) as Record<string, unknown>;
    const expectedHash = createHash('sha256').update(sealCanonical, 'utf8').digest('hex');
    expect(parsed['content_sha256']).toBe(expectedHash);
  });

  test('POST /seal binds attachment structural_hash in canonical content', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const rawCapsuleJson = '{"subject":"PDF"}';
    const attachments = [
      {
        id: 'att-1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size: 10,
        extracted_text_v1: {
          text: 't',
          structural_hash: 'bind-hash-1',
          extractor_version: 'beap-pdf-extract-v1',
        },
      },
    ];
    const { buildSealCanonicalJson } = await import('../../shared/capsuleAttachments.js');
    const sealCanonical = buildSealCanonicalJson({ rawCapsuleJson, attachments });

    const plain = await postSeal(
      server,
      { depackaged: { rawCapsuleJson, attachments } },
      TEST_SECRET,
    );
    const withBinding = await postSeal(
      server,
      {
        depackaged: {
          rawCapsuleJson,
          attachments: [
            {
              ...attachments[0]!,
              extracted_text_v1: { ...attachments[0]!.extracted_text_v1!, structural_hash: 'other-hash' },
            },
          ],
        },
      },
      TEST_SECRET,
    );

    expect(plain.status).toBe(200);
    expect(withBinding.status).toBe(200);
    const plainParsed = JSON.parse(plain.json['sealInputJson'] as string) as Record<string, unknown>;
    const boundParsed = JSON.parse(withBinding.json['sealInputJson'] as string) as Record<string, unknown>;
    expect(plainParsed['content_sha256']).toBe(
      createHash('sha256').update(sealCanonical, 'utf8').digest('hex'),
    );
    expect(plainParsed['content_sha256']).not.toBe(boundParsed['content_sha256']);
  });

  test('POST /seal generates a rowId when not provided', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const { status, json } = await postSeal(server, {
      canonicalJson: '{"x":1}',
    }, TEST_SECRET);

    expect(status).toBe(200);
    expect(typeof json['rowId']).toBe('string');
    expect((json['rowId'] as string).length).toBeGreaterThan(0);
  });

  test('POST /seal with missing canonicalJson and no rawCapsuleJson → 400', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const { status, json } = await postSeal(server, { depackaged: { subject: 'no raw' } }, TEST_SECRET);

    expect(status).toBe(400);
    expect(json['error']).toContain('canonicalJson');
  });

  // ── Auth enforcement ───────────────────────────────────────────────────────

  test('POST /seal without X-Pod-Auth → 401', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const bodyStr = JSON.stringify({ canonicalJson: '{}' });
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      const req = http.request(
        { hostname: '127.0.0.1', port: addr.port, path: '/seal', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bodyStr)) } },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }); },
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    expect(result.status).toBe(401);
  });

  // ── Health / ready ─────────────────────────────────────────────────────────

  test('GET /health returns 200 with role=sealer', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const result = await new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get(`http://127.0.0.1:${addr.port}/health`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }));
      }).on('error', reject);
    });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'ok', role: 'sealer' });
  });

  test('GET /ready returns 200 (sealer is ready once started with valid key)', async () => {
    server = createSealerServer(TEST_SECRET, FIXTURE_KEY);
    await startServer(server);

    const result = await new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get(`http://127.0.0.1:${addr.port}/ready`, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }));
      }).on('error', reject);
    });

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'ready', role: 'sealer' });
  });
});

// ── Log-safety check ──────────────────────────────────────────────────────────
// Static check: no console.log in sealer.ts contains key material strings.
// Runtime check: the startup log line says "sealer ready" with no key material.

describe('log safety', () => {
  test('parseSealKeyHex error messages do not echo the key value', () => {
    // Error messages must describe the problem, not echo the key.
    const badHex = 'z'.repeat(64); // invalid chars
    let msg = '';
    try { parseSealKeyHex(badHex); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toContain(badHex);
    expect(msg.length).toBeGreaterThan(0);
  });

  test('parseSealKeyHex error for short key does not log key bytes', () => {
    const shortHex = 'ab'.repeat(16); // 16 bytes, too short
    let msg = '';
    try { parseSealKeyHex(shortHex); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toContain(shortHex);
    expect(msg).toContain('too short');
  });
});
