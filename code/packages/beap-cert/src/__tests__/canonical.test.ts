import { describe, expect, it } from 'vitest';

import { canonicalizeForSigning } from '../canonical.js';
import { bytesToHex } from '../encoding.js';
import type { UnsignedCertificate } from '../types.js';

const SAMPLE_UNSIGNED: UnsignedCertificate = {
  v: 1,
  package_hash: 'sha256:abc123',
  capsule_canonical_hash: 'sha256:def456',
  validation_result_digest: 'sha256:789abc',
  edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
  issued_at: '2026-05-24T10:00:00Z',
  expires_at: '2026-05-25T10:00:00Z',
  sso_attestation: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test',
};

describe('canonicalizeForSigning', () => {
  it('produces stable bytes regardless of input key order', () => {
    const reordered: UnsignedCertificate = {
      sso_attestation: SAMPLE_UNSIGNED.sso_attestation,
      expires_at: SAMPLE_UNSIGNED.expires_at,
      issued_at: SAMPLE_UNSIGNED.issued_at,
      edge_pod_id: SAMPLE_UNSIGNED.edge_pod_id,
      validation_result_digest: SAMPLE_UNSIGNED.validation_result_digest,
      capsule_canonical_hash: SAMPLE_UNSIGNED.capsule_canonical_hash,
      package_hash: SAMPLE_UNSIGNED.package_hash,
      v: SAMPLE_UNSIGNED.v,
    };

    const a = canonicalizeForSigning(SAMPLE_UNSIGNED);
    const b = canonicalizeForSigning(reordered);

    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('sorts keys lexicographically (capsule_canonical_hash before edge_pod_id)', () => {
    const bytes = canonicalizeForSigning(SAMPLE_UNSIGNED);
    const json = new TextDecoder().decode(bytes);
    expect(json.indexOf('"capsule_canonical_hash"')).toBeLessThan(json.indexOf('"edge_pod_id"'));
    expect(json.indexOf('"package_hash"')).toBeLessThan(json.indexOf('"v"'));
    expect(json).not.toMatch(/\s/);
    expect(json.endsWith('\n')).toBe(false);
  });

  it('is deterministic across repeated calls', () => {
    const first = bytesToHex(canonicalizeForSigning(SAMPLE_UNSIGNED));
    const second = bytesToHex(canonicalizeForSigning(SAMPLE_UNSIGNED));
    expect(first).toBe(second);
  });
});
