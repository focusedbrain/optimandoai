/**
 * Hardened diagnostic report schema (Phase 5 — P5.2).
 *
 * Structurally distinct from edge **message** certificates (`UnsignedCertificate` uses
 * `v: 1` + package/capsule hashes; diagnostic reports use `report_v: 1` + failure
 * metadata). Signatures use the same Ed25519 edge key and `ed25519:<hex>` encoding,
 * but the signed payload shape cannot be confused with a message cert.
 *
 * Security: no exception message strings, no Error stringification, no free-form fields.
 * Envelope strings are allowlist-filtered before inclusion.
 */

import { ed25519 } from '@noble/curves/ed25519.js';

import { canonicalizeStableJson } from './canonical.js';
import { formatEdgeSignature, parseEdgeSignature } from './encoding.js';

/** Extend as new exception classes are classified in trusted code. */
export type DiagnosticExceptionKind =
  | 'RangeError'
  | 'TypeError'
  | 'SyntaxError'
  | 'BufferOverflowError'
  | 'TimeoutError'
  | 'ResourceExhaustedError'
  | 'StuckHealthProbeError'
  | 'UnknownError';

/** Pipeline stage where failure was recorded (trusted enumeration only). */
export type DiagnosticStage =
  | 'mime_decode'
  | 'base64_parse'
  | 'header_parse'
  | 'attachment_extract'
  | 'imap_fetch'
  | 'oauth_refresh'
  | 'capsule_validate'
  | 'capsule_normalize'
  | 'seal_compute'
  | 'cert_sign'
  | 'pod_internal';

export type DiagnosticContainerRole =
  | 'ingestor'
  | 'validator'
  | 'depackager'
  | 'sealer'
  | 'certifier'
  | 'verifier'
  | 'mail-fetcher'
  | 'pdf-parser';

export interface DiagnosticReportFailedContainer {
  role: DiagnosticContainerRole;
  /** First 12 characters of the Podman container ID. */
  container_id_short: string;
  previous_uptime_seconds: number;
}

export interface DiagnosticReportFailure {
  exception_kind: DiagnosticExceptionKind;
  stage: DiagnosticStage;
  /** Basename only, e.g. `depackager.ts` — never a full path. */
  source_file_basename: string;
  source_line: number;
}

export interface DiagnosticReportSystemMetrics {
  cpu_percent: number;
  memory_mb: number;
  fd_count: number;
  container_uptime_seconds: number;
}

export interface DiagnosticReportMessageUnderProcessing {
  sha256_hex: string;
  size_bytes: number;
  envelope_from: string;
  envelope_to: string;
  envelope_date_iso8601: string;
  envelope_subject_filtered: string;
}

/** Who signed the report — edge container (default) or desktop supervisor (P5.9). */
export type DiagnosticReportSigner = 'edge' | 'supervisor';

/** Fields signed by the edge certifier or desktop supervisor; `certificate` is appended after signing. */
export interface UnsignedDiagnosticReportV1 {
  report_v: 1;
  /** Omitted on legacy edge reports; treated as `'edge'`. */
  signer?: DiagnosticReportSigner;
  edge_pod_id: string;
  replica_id: string;
  timestamp_iso8601: string;
  failed_container: DiagnosticReportFailedContainer;
  failure: DiagnosticReportFailure;
  system_metrics_at_failure: DiagnosticReportSystemMetrics;
  message_under_processing: DiagnosticReportMessageUnderProcessing | null;
}

export interface DiagnosticReportV1 extends UnsignedDiagnosticReportV1 {
  /** Ed25519 signature over canonical unsigned fields: `ed25519:<hex>`. */
  certificate: string;
}

/** Resolve signer with backward compatibility for reports without `signer`. */
export function resolveDiagnosticReportSigner(
  report: Pick<UnsignedDiagnosticReportV1, 'signer'>,
): DiagnosticReportSigner {
  return report.signer ?? 'edge';
}

export interface VerifyDiagnosticReportResult {
  ok: boolean;
  reason?: string;
}

const ENVELOPE_FROM_TO_MAX = 320;
const ENVELOPE_SUBJECT_MAX = 200;
const SUBJECT_TRUNCATED_SUFFIX = ' [truncated]';
export const UNSAFE_ENVELOPE_PLACEHOLDER = '[unsafe content stripped]';

/** CSI-style ANSI escape sequences (e.g. `\x1b[31m`). */
const ANSI_CSI_RE = /\u001b\[[0-9;]*[ -/]*[@-~]/g;

const ZERO_WIDTH_CODE_POINTS = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060,
]);

const RTL_OVERRIDE_CODE_POINTS = new Set([
  0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
]);

const SELECTED_PUNCTUATION = new Set([
  0x20, 0x40, 0x2b, 0x28, 0x29, 0x2d, 0x2e, 0x5f,
]);

function countCodePoints(value: string): number {
  let count = 0;
  for (const _ of value) {
    count += 1;
  }
  return count;
}

function stripAnsiEscapes(value: string): string {
  return value.replace(ANSI_CSI_RE, '');
}

function isLatin1SupplementLetter(codePoint: number): boolean {
  return (
    (codePoint >= 0x00c0 && codePoint <= 0x00d6) ||
    (codePoint >= 0x00d8 && codePoint <= 0x00f6) ||
    (codePoint >= 0x00f8 && codePoint <= 0x00ff)
  );
}

function isLatinExtendedALetter(codePoint: number): boolean {
  return codePoint >= 0x0100 && codePoint <= 0x017f;
}

function isAllowedCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return true;
  }
  if (isLatin1SupplementLetter(codePoint) || isLatinExtendedALetter(codePoint)) {
    return true;
  }
  if (SELECTED_PUNCTUATION.has(codePoint)) {
    return true;
  }
  return false;
}

function shouldStripCodePoint(codePoint: number): boolean {
  if (codePoint <= 0x1f || codePoint === 0x7f) {
    return true;
  }
  if (codePoint > 0xffff) {
    return true;
  }
  if (ZERO_WIDTH_CODE_POINTS.has(codePoint) || RTL_OVERRIDE_CODE_POINTS.has(codePoint)) {
    return true;
  }
  return false;
}

function filterAllowlistedText(raw: string): string {
  const withoutAnsi = stripAnsiEscapes(raw);
  let filtered = '';
  for (const char of withoutAnsi) {
    const codePoint = char.codePointAt(0)!;
    if (shouldStripCodePoint(codePoint)) {
      continue;
    }
    if (isAllowedCodePoint(codePoint)) {
      filtered += char;
    }
  }
  return filtered;
}

function applyLengthCap(value: string, maxLength: number, truncateSuffix = ''): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (truncateSuffix.length > 0 && truncateSuffix.length < maxLength) {
    return value.slice(0, maxLength - truncateSuffix.length) + truncateSuffix;
  }
  return value.slice(0, maxLength);
}

/**
 * Allowlist-filter an envelope address field (`from` / `to`).
 * RFC 5321 max length 320; strips control chars, ANSI, bidi overrides, and astral code points.
 */
export function filterEnvelopeFrom(raw: string): string {
  return filterEnvelopeField(raw, ENVELOPE_FROM_TO_MAX);
}

/** Allowlist-filter an envelope `to` field — same rules as `from`. */
export function filterEnvelopeTo(raw: string): string {
  return filterEnvelopeField(raw, ENVELOPE_FROM_TO_MAX);
}

/** Allowlist-filter envelope subject; capped at 200 chars with ` [truncated]` suffix when needed. */
export function filterEnvelopeSubject(raw: string): string {
  return filterEnvelopeField(raw, ENVELOPE_SUBJECT_MAX, SUBJECT_TRUNCATED_SUFFIX);
}

function filterEnvelopeField(raw: string, maxLength: number, truncateSuffix = ''): string {
  const originalLength = countCodePoints(raw);
  const filtered = filterAllowlistedText(raw);

  if (originalLength > 0 && filtered.length / originalLength < 0.5) {
    return UNSAFE_ENVELOPE_PLACEHOLDER;
  }

  return applyLengthCap(filtered, maxLength, truncateSuffix);
}

/** Build `message_under_processing` with envelope fields filtered in trusted code. */
export function buildMessageUnderProcessing(fields: {
  sha256_hex: string;
  size_bytes: number;
  envelope_from: string;
  envelope_to: string;
  envelope_date_iso8601: string;
  envelope_subject: string;
}): DiagnosticReportMessageUnderProcessing {
  return {
    sha256_hex: fields.sha256_hex,
    size_bytes: fields.size_bytes,
    envelope_from: filterEnvelopeFrom(fields.envelope_from),
    envelope_to: filterEnvelopeTo(fields.envelope_to),
    envelope_date_iso8601: fields.envelope_date_iso8601,
    envelope_subject_filtered: filterEnvelopeSubject(fields.envelope_subject),
  };
}

/** Sign an unsigned diagnostic report with the edge Ed25519 private key (32 bytes). */
export function signDiagnosticReport(
  unsigned: UnsignedDiagnosticReportV1,
  privateKey: Uint8Array,
): DiagnosticReportV1 {
  const payload = canonicalizeStableJson(unsigned);
  const signature = ed25519.sign(payload, privateKey);
  return {
    ...unsigned,
    certificate: formatEdgeSignature(signature),
  };
}

/**
 * Verify the Ed25519 signature on a diagnostic report.
 * Does not validate field semantics — only signature math and format.
 */
export function verifyDiagnosticReport(
  report: DiagnosticReportV1,
  publicKey: Uint8Array,
): VerifyDiagnosticReportResult {
  const signature = parseEdgeSignature(report.certificate);
  if (!signature) {
    return { ok: false, reason: 'invalid_signature_format' };
  }

  const { certificate: _certificate, ...unsigned } = report;
  const payload = canonicalizeStableJson(unsigned);

  try {
    const valid = ed25519.verify(signature, payload, publicKey);
    return valid ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch {
    return { ok: false, reason: 'signature_verification_failed' };
  }
}
