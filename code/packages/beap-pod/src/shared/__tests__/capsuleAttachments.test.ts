import { describe, expect, it } from 'vitest';
import { validationResultDigest } from '@repo/beap-cert';
import {
  buildExtractedTextV1,
  buildSealCanonicalJson,
  parsePdfParserMode,
  validationResultBytesForCertify,
  verifyExtractedTextStructuralHash,
} from '../capsuleAttachments.js';
import { computeStructuralHash } from '../pdfExtractCore.js';
import { computeSealPod, verifySealPod } from '../../roles/sealer.js';

describe('capsuleAttachments', () => {
  it('parsePdfParserMode defaults by POD_MODE', () => {
    expect(parsePdfParserMode(undefined, 'REMOTE_EDGE')).toBe('eager');
    expect(parsePdfParserMode(undefined, 'LOCAL_HOST')).toBe('on_demand');
    expect(parsePdfParserMode('eager', 'LOCAL_HOST')).toBe('eager');
  });

  it('buildSealCanonicalJson includes attachment structural hashes', () => {
    const rawCapsuleJson = JSON.stringify({ subject: 's', body: 'b' });
    const attachments = [
      {
        id: 'att-1',
        filename: 'doc.pdf',
        content_type: 'application/pdf',
        size: 100,
        extracted_text_v1: buildExtractedTextV1('hello', 'abc123'),
      },
    ];
    const canonical = buildSealCanonicalJson({ rawCapsuleJson, attachments });
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    expect(parsed['attachments_extraction_v1']).toEqual([
      {
        extractor_version: 'beap-pdf-extract-v1',
        id: 'att-1',
        structural_hash: 'abc123',
      },
    ]);
  });

  it('validation digest changes when extraction binding is present', () => {
    const validationBytes = new TextEncoder().encode('{"valid":true}');
    const attachments = [
      {
        id: 'a1',
        filename: 'f.pdf',
        content_type: 'application/pdf',
        size: 1,
        extracted_text_v1: buildExtractedTextV1('t', 'deadbeef'),
      },
    ];
    const plain = validationResultDigest(validationBytes);
    const augmented = validationResultDigest(
      validationResultBytesForCertify(validationBytes, attachments),
    );
    expect(augmented).not.toBe(plain);
  });

  it('verifyExtractedTextStructuralHash detects tampered text', () => {
    const hash = computeStructuralHash(['page one']);
    const extracted = buildExtractedTextV1('page one', hash);
    expect(verifyExtractedTextStructuralHash(extracted)).toBe(true);
    const tampered = { ...extracted, text: 'page two' };
    expect(verifyExtractedTextStructuralHash(tampered)).toBe(false);
  });

  it('seal detects tampering of attachment structural hash in canonical input', () => {
    const key = Buffer.alloc(32, 0x42);
    const rawCapsuleJson = JSON.stringify({ body: 'x' });
    const attachments = [
      {
        id: 'att-1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size: 10,
        extracted_text_v1: buildExtractedTextV1('text', 'hash-a'),
      },
    ];
    const canonical = buildSealCanonicalJson({ rawCapsuleJson, attachments });
    const ts = new Date().toISOString();
    const { seal, sealInputJson } = computeSealPod(canonical, 'row-1', 'validated', '1.0.0', ts, key);
    expect(verifySealPod(sealInputJson, seal, key)).toBe(true);

    const tamperedCanonical = canonical.replace('hash-a', 'hash-b');
    const { sealInputJson: tamperedInput } = computeSealPod(
      tamperedCanonical,
      'row-1',
      'validated',
      '1.0.0',
      ts,
      key,
    );
    expect(verifySealPod(tamperedInput, seal, key)).toBe(false);
  });
});
