import { createHash } from 'node:crypto';

/** SHA-256 digest as `sha256:<lowercase-hex>`. */
export function sha256Hex(bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `sha256:${digest}`;
}

/** Hash of raw inbound package bytes (strategy §2.4 — transit tampering binding). */
export function packageHash(rawBytes: Uint8Array): string {
  return sha256Hex(rawBytes);
}

/** Hash of post-validator-normalization canonical capsule bytes. */
export function capsuleCanonicalHash(canonicalCapsuleBytes: Uint8Array): string {
  return sha256Hex(canonicalCapsuleBytes);
}

/** Hash of canonical validation result JSON bytes. */
export function validationResultDigest(canonicalResultJson: Uint8Array): string {
  return sha256Hex(canonicalResultJson);
}
