import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';

import { signCertificate } from '../sign.js';
import { verifyCertificate } from '../verify.js';
import type { EdgeCertificate, UnsignedCertificate } from '../types.js';

function sampleUnsigned(overrides: Partial<UnsignedCertificate> = {}): UnsignedCertificate {
  return {
    v: 1,
    package_hash: 'sha256:abc123',
    capsule_canonical_hash: 'sha256:def456',
    validation_result_digest: 'sha256:789abc',
    edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
    issued_at: '2026-05-24T10:00:00Z',
    expires_at: '2026-05-25T10:00:00Z',
    sso_attestation: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test',
    ...overrides,
  };
}

describe('signCertificate / verifyCertificate', () => {
  it('round-trip: sign with one keypair, verify with matching public key → ok', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const unsigned = sampleUnsigned();

    const cert = signCertificate(unsigned, privateKey);
    expect(cert.edge_signature).toMatch(/^ed25519:[0-9a-f]{128}$/);

    const result = verifyCertificate(cert, publicKey);
    expect(result).toEqual({ ok: true });
  });

  it('verify with wrong public key → not ok', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const wrongPublicKey = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const cert = signCertificate(sampleUnsigned(), privateKey);

    const result = verifyCertificate(cert, wrongPublicKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('mutate one byte of the certificate → verification fails', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const cert = signCertificate(sampleUnsigned(), privateKey);

    const tampered: EdgeCertificate = {
      ...cert,
      package_hash: 'sha256:abc124',
    };

    const result = verifyCertificate(tampered, publicKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects malformed edge_signature format', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const cert = signCertificate(sampleUnsigned(), privateKey);

    const badFormat: EdgeCertificate = { ...cert, edge_signature: 'not-ed25519:deadbeef' };
    expect(verifyCertificate(badFormat, publicKey)).toEqual({
      ok: false,
      reason: 'invalid_signature_format',
    });
  });
});
