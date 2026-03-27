/**
 * BEAP capsule detection.
 *
 * Checks (in priority order):
 *   1. MIME type: application/vnd.beap+json or application/beap
 *   2. Header markers: X-BEAP-Version, X-BEAP-Capsule-Type
 *   3. JSON structure: schema_version + capsule_type at top level
 *   4. Attachment metadata: .beap extension or BEAP MIME type
 */

import type { RawInput, BeapDetectionResult, DetectionMethod } from './types.js';

const BEAP_MIME_TYPES = ['application/vnd.beap+json', 'application/beap'];
const BEAP_HEADER_KEYS = ['x-beap-version', 'x-beap-capsule-type'];

export function detectBeapCapsule(input: RawInput): BeapDetectionResult {
  const mimeResult = checkMimeType(input);
  if (mimeResult) return mimeResult;

  const headerResult = checkHeaderMarkers(input);
  if (headerResult) return headerResult;

  const jsonResult = checkJsonStructure(input);
  if (jsonResult) return jsonResult;

  const messagePackageResult = checkJsonStructureMessagePackage(input);
  if (messagePackageResult) return messagePackageResult;

  const attachResult = checkAttachmentMetadata(input);
  if (attachResult) return attachResult;

  return { detected: false, malformed: false };
}

function checkMimeType(input: RawInput): BeapDetectionResult | null {
  const mime = (input.mime_type ?? input.headers?.['content-type'] ?? input.headers?.['Content-Type'] ?? '').toLowerCase().split(';')[0].trim();
  if (!BEAP_MIME_TYPES.includes(mime)) return null;
  return tryParseBeapJson(input.body, 'mime_type');
}

function checkHeaderMarkers(input: RawInput): BeapDetectionResult | null {
  if (!input.headers) return null;
  const normalised = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const hasBeapHeader = BEAP_HEADER_KEYS.some((key) => key in normalised);
  if (!hasBeapHeader) return null;
  return tryParseBeapJson(input.body, 'header_marker');
}

function checkJsonStructure(input: RawInput): BeapDetectionResult | null {
  const text = typeof input.body === 'string' ? input.body : input.body.toString('utf-8');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      'schema_version' in parsed &&
      'capsule_type' in parsed
    ) {
      return { detected: true, raw_capsule_json: parsed, detection_method: 'json_structure' };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

const VALID_MESSAGE_PACKAGE_ENCODINGS = new Set(['qBEAP', 'pBEAP', 'qbeap', 'pbeap']);

/**
 * True if the object carries the encrypted body of a qBEAP/pBEAP message package
 * (plain envelope/payload OR encrypted fields: payloadEnc, innerEnvelopeCiphertext).
 * Aligns with coordination `/beap/capsule` and Stage-2 message-package validation.
 */
export function hasEncryptedMessagePackageBody(obj: Record<string, unknown>): boolean {
  return (
    'envelope' in obj ||
    'payload' in obj ||
    'payloadEnc' in obj ||
    'innerEnvelopeCiphertext' in obj
  );
}

/**
 * Handshake capsules that use `capsule_type` at top level (relay gate on coordination).
 * Native BEAP wire must NOT use these strings — otherwise it is classified as handshake, not wire.
 */
const RELAY_HANDSHAKE_CAPSULE_TYPES = new Set(['accept', 'context_sync', 'refresh', 'revoke', 'initiate']);

/**
 * Detect qBEAP/pBEAP message packages: header + metadata + (envelope | payload | encrypted body).
 * `capsule_type` must not be a relay handshake discriminator (accept|context_sync|…).
 * Important: `capsule_type: null` still has the key after JSON parse — old logic used
 * `!('capsule_type' in obj)` and wrongly excluded valid native BEAP wire.
 */
export function isMessagePackageStructure(parsed: unknown): boolean {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  const hasHeader = 'header' in obj && obj.header != null && typeof obj.header === 'object';
  const hasMetadata = 'metadata' in obj && obj.metadata != null && typeof obj.metadata === 'object';
  if (!hasHeader || !hasMetadata) return false;

  const ct = obj.capsule_type;
  if (typeof ct === 'string' && RELAY_HANDSHAKE_CAPSULE_TYPES.has(ct.trim())) {
    return false;
  }

  return hasEncryptedMessagePackageBody(obj);
}

/**
 * Detect BEAP message package and return classification.
 * Checks: header + metadata + (envelope or payload), no capsule_type.
 * Optional: header.encoding in ['qBEAP', 'pBEAP'] for strictness.
 */
export function detectBeapMessagePackage(input: { body: string | Buffer }): 
  | { detected: true; classification: 'beap_message_package'; parsed: Record<string, unknown> }
  | { detected: false } {
  const text = typeof input.body === 'string' ? input.body : input.body.toString('utf-8');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return { detected: false };
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!isMessagePackageStructure(parsed)) return { detected: false };
    // Optional strictness: if header.encoding is present, must be qBEAP or pBEAP
    const header = parsed?.header;
    if (header && typeof header === 'object') {
      const enc = (header as Record<string, unknown>).encoding;
      if (typeof enc === 'string' && enc.trim().length > 0 && !VALID_MESSAGE_PACKAGE_ENCODINGS.has(enc)) {
        return { detected: false };
      }
    }
    return { detected: true, classification: 'beap_message_package', parsed };
  } catch {
    return { detected: false };
  }
}

function checkJsonStructureMessagePackage(input: RawInput): BeapDetectionResult | null {
  const text = typeof input.body === 'string' ? input.body : input.body.toString('utf-8');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (isMessagePackageStructure(parsed)) {
      return {
        detected: true,
        raw_capsule_json: parsed,
        detection_method: 'json_structure',
        is_message_package: true,
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function checkAttachmentMetadata(input: RawInput): BeapDetectionResult | null {
  if (input.filename && input.filename.endsWith('.beap')) {
    return tryParseBeapJson(input.body, 'attachment_metadata');
  }
  if (!input.attachments) return null;
  for (const att of input.attachments) {
    const isBeapMime = BEAP_MIME_TYPES.includes(att.mime_type.toLowerCase().split(';')[0].trim());
    const isBeapExt = att.filename.endsWith('.beap');
    if (isBeapMime || isBeapExt) {
      return tryParseBeapJson(att.content, 'attachment_metadata');
    }
  }
  return null;
}

function tryParseBeapJson(body: string | Buffer, method: DetectionMethod): BeapDetectionResult {
  const text = typeof body === 'string' ? body : body.toString('utf-8');
  try {
    const parsed = JSON.parse(text.trim());
    const isMessagePackage = isMessagePackageStructure(parsed);
    return {
      detected: true,
      raw_capsule_json: parsed,
      detection_method: method,
      ...(isMessagePackage ? { is_message_package: true as const } : {}),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'JSON parse failed';
    return { detected: false, malformed: true, detection_error: msg };
  }
}
