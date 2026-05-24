/**
 * @repo/beap-cert
 *
 * Shared edge certificate format, canonical serialization, signing, and verification.
 * Pure crypto + serialization — no HTTP, no key storage, no SSO attestation checks.
 */

export { canonicalizeForSigning, canonicalizeStableJson } from './canonical.js';
export {
  buildMessageUnderProcessing,
  filterEnvelopeFrom,
  filterEnvelopeSubject,
  filterEnvelopeTo,
  resolveDiagnosticReportSigner,
  signDiagnosticReport,
  UNSAFE_ENVELOPE_PLACEHOLDER,
  verifyDiagnosticReport,
} from './diagnosticReport.js';
export type {
  DiagnosticContainerRole,
  DiagnosticExceptionKind,
  DiagnosticReportFailure,
  DiagnosticReportMessageUnderProcessing,
  DiagnosticReportSigner,
  DiagnosticReportSystemMetrics,
  DiagnosticReportV1,
  DiagnosticStage,
  UnsignedDiagnosticReportV1,
  VerifyDiagnosticReportResult,
} from './diagnosticReport.js';
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
