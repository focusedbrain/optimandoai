import stringify from 'fast-json-stable-stringify';

import type { UnsignedCertificate } from './types.js';

const textEncoder = new TextEncoder();

/**
 * Deterministic JSON bytes the Ed25519 signature is over.
 * Keys are sorted lexicographically; no extra whitespace or trailing newline.
 */
export function canonicalizeForSigning(cert: UnsignedCertificate): Uint8Array {
  const json = stringify(cert);
  return textEncoder.encode(json);
}
