/**
 * Depackager PDF integration — eager vs on_demand modes (Workstream 2).
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  hkdfDerive,
  computeEnvelopeAadBytes,
  toBase64,
  type LocalBeapPackage,
  type LocalBeapHeader,
} from '../depackagePipeline.js';
import { createDepackagerServer } from '../depackager.js';
import { PDF_EXTRACTOR_VERSION } from '../../shared/pdfExtractCore.js';

const wc = webcrypto as Crypto;
const TEST_SECRET = 'depackager-pdf-test-secret-32b!!';
const SENDER_PRIV = new Uint8Array(32).fill(0x31);
const RECEIVER_PRIV = new Uint8Array(32).fill(0x32);
const SENDER_PUB = x25519.getPublicKey(SENDER_PRIV);
const RECEIVER_PUB = x25519.getPublicKey(RECEIVER_PRIV);

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await wc.subtle.importKey('raw', Buffer.from(keyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const algo =
    aad && aad.length > 0
      ? { name: 'AES-GCM' as const, iv: Buffer.from(iv), additionalData: Buffer.from(aad) }
      : { name: 'AES-GCM' as const, iv: Buffer.from(iv) };
  const ct = await wc.subtle.encrypt(algo, key, Buffer.from(plaintext));
  return new Uint8Array(ct);
}

async function buildTestQbeapWithPdfAttachment(pdfBytes: Buffer): Promise<LocalBeapPackage> {
  const salt = new Uint8Array(32).fill(0xac);
  const sharedSecret = x25519.getSharedSecret(SENDER_PRIV, RECEIVER_PUB);
  const capsuleKey = await hkdfDerive(sharedSecret, salt, 'BEAP v1 capsule', 32);
  const artefactKey = await hkdfDerive(sharedSecret, salt, 'BEAP v1 artefact', 32);

  const headerBase: LocalBeapHeader = {
    version: '1.0',
    encoding: 'qBEAP',
    encryption_mode: 'direct',
    timestamp: 1704067200000,
    sender_fingerprint: 'pdf-sender-fp',
    template_hash: 'a'.repeat(64),
    policy_hash: 'b'.repeat(64),
    content_hash: 'c'.repeat(64),
    receiver_binding: { handshake_id: 'pdf-hs-1' },
    crypto: {
      suiteId: 'x25519-hkdf-aes256gcm',
      salt: toBase64(salt),
      handshake_id: 'pdf-hs-1',
      senderX25519PublicKeyB64: toBase64(SENDER_PUB),
    },
  };

  const aadBytes = computeEnvelopeAadBytes(headerBase);
  const capsuleJson = JSON.stringify({
    subject: 'PDF attachment test',
    body: 'See attachment',
    attachments: [
      {
        id: 'att-pdf-1',
        originalName: 'report.pdf',
        originalType: 'application/pdf',
        originalSize: pdfBytes.length,
      },
    ],
  });
  const capsuleBytes = new TextEncoder().encode(capsuleJson);
  const capsuleNonce = new Uint8Array(12).fill(0xce);
  const capsuleCt = await aesGcmEncrypt(capsuleKey, capsuleNonce, capsuleBytes, aadBytes);

  const artNonce = new Uint8Array(12).fill(0xde);
  const artCt = await aesGcmEncrypt(artefactKey, artNonce, pdfBytes, aadBytes);
  const fakeSig = Buffer.alloc(64).toString('base64');

  return {
    ...headerBase,
    header: headerBase,
    metadata: { created_at: 1704067200000 },
    payloadEnc: {
      nonce: toBase64(capsuleNonce),
      ciphertext: toBase64(capsuleCt),
    },
    artefactsEnc: [
      {
        attachmentId: 'att-pdf-1',
        nonce: toBase64(artNonce),
        ciphertext: toBase64(artCt),
        mime: 'application/pdf',
        bytesPlain: pdfBytes.length,
      },
    ],
    signature: { signature: fakeSig, algorithm: 'Ed25519', keyId: 'test-key' },
  };
}

function wrapValidated(capsule: LocalBeapPackage): Record<string, unknown> {
  return {
    validated: {
      __brand: 'ValidatedCapsule',
      message_id: 'msg-pdf-1',
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
        handshake_id: 'pdf-hs-1',
        ...capsule,
      },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
      schema_version: 2,
    },
  };
}

async function postJson(
  server: http.Server,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const bodyStr = JSON.stringify(body);
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
          'X-Pod-Auth': TEST_SECRET,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function mockPdfParserFetch(structuralHash = 'sha256:pdfhash111') {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/extract')) {
      return new Response(
        JSON.stringify({
          extracted_text: 'Extracted PDF line',
          page_count: 1,
          structural_hash: structuralHash,
          extractor_version: PDF_EXTRACTOR_VERSION,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ sealed: true, seal: 'mock' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('depackager PDF modes', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    vi.restoreAllMocks();
  });

  test('eager mode: edge capsule includes extracted_text_v1', async () => {
    const pkg = await buildTestQbeapWithPdfAttachment(Buffer.from('%PDF-1.4 mock'));
    const authedFetch = mockPdfParserFetch('edge-structural-hash');

    server = createDepackagerServer(TEST_SECRET, {
      pdfParserMode: 'eager',
      pdfParserBase: 'http://127.0.0.1:18107',
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
      skipSignatureVerification: true,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const { status, json } = await postJson(server, '/depackage', wrapValidated(pkg));
    expect(status).toBe(200);

    const depackaged = json['depackaged'] as Record<string, unknown>;
    const attachments = depackaged['attachments'] as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!['extracted_text_v1']).toMatchObject({
      text: 'Extracted PDF line',
      structural_hash: 'edge-structural-hash',
      extractor_version: PDF_EXTRACTOR_VERSION,
    });
    expect(authedFetch).toHaveBeenCalled();
    const extractCall = (authedFetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('/extract'),
    );
    expect(extractCall).toBeDefined();
  });

  test('on_demand mode: depackage omits extracted_text_v1', async () => {
    const pkg = await buildTestQbeapWithPdfAttachment(Buffer.from('%PDF-1.4 mock'));
    const authedFetch = mockPdfParserFetch();

    server = createDepackagerServer(TEST_SECRET, {
      pdfParserMode: 'on_demand',
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
      skipSignatureVerification: true,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const { status, json } = await postJson(server, '/depackage', wrapValidated(pkg));
    expect(status).toBe(200);

    const depackaged = json['depackaged'] as Record<string, unknown>;
    const attachments = depackaged['attachments'] as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!['extracted_text_v1']).toBeUndefined();
    expect(attachments[0]!['extraction_failed']).toBeUndefined();

    const extractCalls = (authedFetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/extract'),
    );
    expect(extractCalls).toHaveLength(0);
  });

  test('on_demand: POST /extract-pdf returns extraction for caller re-seal', async () => {
    const authedFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          extracted_text: 'On demand text',
          page_count: 1,
          structural_hash: 'ondemand-hash',
          extractor_version: PDF_EXTRACTOR_VERSION,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    server = createDepackagerServer(TEST_SECRET, {
      pdfParserMode: 'on_demand',
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const { status, json } = await postJson(server, '/extract-pdf', {
      attachment_id: 'att-pdf-1',
      message_id: 'msg-pdf-1',
      pdf_bytes_b64: Buffer.from('%PDF-1.4').toString('base64'),
    });

    expect(status).toBe(200);
    expect(json['extracted_text_v1']).toMatchObject({
      text: 'On demand text',
      structural_hash: 'ondemand-hash',
    });
  });

  test('eager mode: pdf-parser failure marks extraction_failed and continues', async () => {
    const pkg = await buildTestQbeapWithPdfAttachment(Buffer.from('%PDF-1.4 mock'));
    const authedFetch = vi.fn(async (url: string) => {
      if (String(url).includes('/extract')) {
        return new Response(
          JSON.stringify({ error: 'bad pdf', reason_code: 'pdf_malformed' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ sealed: true }), { status: 200 });
    }) as unknown as typeof fetch;

    server = createDepackagerServer(TEST_SECRET, {
      pdfParserMode: 'eager',
      authedFetch,
      localX25519PrivB64: toBase64(RECEIVER_PRIV),
      skipSignatureVerification: true,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const { status, json } = await postJson(server, '/depackage', wrapValidated(pkg));
    expect(status).toBe(200);
    const attachments = (json['depackaged'] as Record<string, unknown>)['attachments'] as Array<
      Record<string, unknown>
    >;
    expect(attachments[0]!['extraction_failed']).toBeDefined();
    expect(attachments[0]!['extracted_text_v1']).toBeUndefined();
  });
});
