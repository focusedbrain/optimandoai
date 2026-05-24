/**
 * @repo/beap-cert
 *
 * Shared edge certificate format, canonical serialization, signing, and verification.
 * Pure crypto + serialization — no HTTP, no key storage, no SSO attestation checks.
 */

export { canonicalizeForSigning } from './canonical.js';
export { bytesToHex, formatEdgeSignature, parseEdgeSignature } from './encoding.js';
export {
  capsuleCanonicalHash,
  packageHash,
  sha256Hex,
  validationResultDigest,
} from './hashing.js';
export { signCertificate } from './sign.js';
export type { EdgeCertificate, EdgeCertificateVersion, UnsignedCertificate } from './types.js';
export { verifyCertificate } from './verify.js';
export type { VerifyCertificateResult } from './verify.js';
