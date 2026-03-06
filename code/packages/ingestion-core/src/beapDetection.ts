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
    return { detected: true, raw_capsule_json: parsed, detection_method: method };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'JSON parse failed';
    return { detected: false, malformed: true, detection_error: msg };
  }
}
