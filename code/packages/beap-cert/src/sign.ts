import { ed25519 } from '@noble/curves/ed25519.js';

import { canonicalizeForSigning } from './canonical.js';
import { formatEdgeSignature } from './encoding.js';
import type { EdgeCertificate, UnsignedCertificate } from './types.js';

/** Sign an unsigned certificate with the edge Ed25519 private key (32 bytes). */
export function signCertificate(unsigned: UnsignedCertificate, privateKey: Uint8Array): EdgeCertificate {
  const message = canonicalizeForSigning(unsigned);
  const signature = ed25519.sign(message, privateKey);
  return {
    ...unsigned,
    edge_signature: formatEdgeSignature(signature),
  };
}
