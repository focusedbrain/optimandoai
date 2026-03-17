import { describe, test, expect } from 'vitest';
import { validateBeapStructure, SIZE_LIMITS } from '../src/beapStructuralValidator.js';

describe('beapStructuralValidator', () => {
  test('valid minimal pBEAP structure', () => {
    const pkg = {
      header: {
        version: '1.0',
        encoding: 'pBEAP',
        template_hash: 'a'.repeat(64),
        policy_hash: 'b'.repeat(64),
        content_hash: 'c'.repeat(64),
      },
      metadata: { created_at: 123, delivery_method: 'download', filename: 'test.beap' },
      payload: Buffer.from('{}').toString('base64'),
      signature: { value: 'd'.repeat(88) },
    };
    const result = validateBeapStructure(JSON.stringify(pkg));
    expect(result.valid).toBe(true);
    expect(result.inputHash).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  test('valid qBEAP with receiver_binding', () => {
    const pkg = {
      header: {
        version: '2.0',
        encoding: 'qBEAP',
        template_hash: 'a'.repeat(64),
        policy_hash: 'b'.repeat(64),
        content_hash: 'c'.repeat(64),
        receiver_binding: { handshake_id: 'hs-1', display_name: 'Test' },
      },
      metadata: { created_at: 123, delivery_method: 'email', filename: 'test.beap' },
      innerEnvelopeCiphertext: 'nonce.ciphertext',
      payloadEnc: { chunks: [] },
      signature: { value: 'e'.repeat(88) },
    };
    const result = validateBeapStructure(JSON.stringify(pkg));
    expect(result.valid).toBe(true);
  });

  test('invalid JSON', () => {
    const result = validateBeapStructure('{ invalid }');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('missing header', () => {
    const pkg = { metadata: {}, payload: '', signature: {} };
    const result = validateBeapStructure(JSON.stringify(pkg));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid header');
  });

  test('missing signature', () => {
    const pkg = {
      header: { version: '1.0', encoding: 'pBEAP', template_hash: 'a', policy_hash: 'b', content_hash: 'c' },
      metadata: {},
      payload: '',
    };
    const result = validateBeapStructure(JSON.stringify(pkg));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing signature');
  });

  test('prototype pollution rejected', () => {
    // Use raw JSON string so __proto__ is an actual key (object literal __proto__ sets prototype)
    const rawJson = `{"__proto__":{"polluted":true},"header":{"version":"1.0","encoding":"pBEAP","template_hash":"a","policy_hash":"b","content_hash":"c"},"metadata":{},"payload":"","signature":{"value":"${'x'.repeat(88)}"}}`;
    const result = validateBeapStructure(rawJson);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Prototype pollution attempt detected');
  });

  test('qBEAP without receiver_binding or receiver_fingerprint', () => {
    const pkg = {
      header: {
        version: '1.0',
        encoding: 'qBEAP',
        template_hash: 'a',
        policy_hash: 'b',
        content_hash: 'c',
      },
      metadata: {},
      payloadEnc: {},
      signature: { value: 'x'.repeat(88) },
    };
    const result = validateBeapStructure(JSON.stringify(pkg));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('receiver_binding') || e.includes('receiver_fingerprint'))).toBe(true);
  });

  test('v2.0 qBEAP without innerEnvelopeCiphertext', () => {
    const pkg = {
      header: {
        version: '2.0',
        encoding: 'qBEAP',
        template_hash: 'a',
        policy_hash: 'b',
        content_hash: 'c',
        receiver_binding: { handshake_id: 'hs-1', display_name: 'Test' },
      },
      metadata: {},
      payloadEnc: {},
      signature: { value: 'x'.repeat(88) },
    };
    const result = validateBeapStructure(JSON.stringify(pkg));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('v2.0 qBEAP requires innerEnvelopeCiphertext');
  });

  test('SIZE_LIMITS exported', () => {
    expect(SIZE_LIMITS.PACKAGE_MAX_BYTES).toBe(500 * 1024 * 1024);
    expect(SIZE_LIMITS.PAYLOAD_MAX_BYTES).toBe(14 * 1024 * 1024);
    expect(SIZE_LIMITS.ARTEFACT_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(SIZE_LIMITS.ENVELOPE_MAX_BYTES).toBe(64 * 1024);
  });
});
