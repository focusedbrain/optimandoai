import { ed25519 } from '@noble/curves/ed25519.js';

import { canonicalizeForSigning } from './canonical.js';
import { parseEdgeSignature } from './encoding.js';
import type { EdgeCertificate } from './types.js';

export interface VerifyCertificateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify the Ed25519 signature on an edge certificate.
 * Does not check SSO attestation, hash bindings, or expiry — those are composed
 * by the verifier role (P3.4/P3.6).
 */
export function verifyCertificate(cert: EdgeCertificate, publicKey: Uint8Array): VerifyCertificateResult {
  const signature = parseEdgeSignature(cert.edge_signature);
  if (!signature) {
    return { ok: false, reason: 'invalid_signature_format' };
  }

  const { edge_signature: _sig, ...unsigned } = cert;
  const message = canonicalizeForSigning(unsigned);

  try {
    const valid = ed25519.verify(signature, message, publicKey);
    return valid ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch {
    return { ok: false, reason: 'signature_verification_failed' };
  }
}
