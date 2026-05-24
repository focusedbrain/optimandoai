import stringify from 'fast-json-stable-stringify';

import type { UnsignedCertificate } from './types.js';

const textEncoder = new TextEncoder();

/**
 * Deterministic JSON bytes for any object signed by this package.
 * Keys are sorted lexicographically; no extra whitespace or trailing newline.
 */
export function canonicalizeStableJson(value: object): Uint8Array {
  const json = stringify(value);
  return textEncoder.encode(json);
}

/**
 * Deterministic JSON bytes the Ed25519 signature is over.
 * Keys are sorted lexicographically; no extra whitespace or trailing newline.
 */
export function canonicalizeForSigning(cert: UnsignedCertificate): Uint8Array {
  return canonicalizeStableJson(cert);
}
