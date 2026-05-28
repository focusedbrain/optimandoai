/**
 * BEAP capsule per-attachment extraction fields (Workstream 2).
 *
 * Optional on depackaged payloads; backward-compatible when absent.
 */

import { canonicalizeStableJson } from '@repo/beap-cert';
import {
  canonicalizePagesForHash,
  computeStructuralHash,
  PDF_EXTRACTOR_VERSION,
} from './pdfExtractCore.js';

export { PDF_EXTRACTOR_VERSION };

export interface ExtractedTextV1 {
  text: string;
  structural_hash: string;
  extractor_version: string;
}

export interface ExtractionFailed {
  reason: string;
}

export interface DepackagedAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  extracted_text_v1?: ExtractedTextV1;
  extraction_failed?: ExtractionFailed;
}

export type PdfParserMode = 'eager' | 'on_demand';

const PDF_MIME_RE = /^application\/pdf\b/i;

export function isPdfContentType(contentType: string): boolean {
  return PDF_MIME_RE.test(contentType.trim());
}

export function parsePdfParserMode(
  raw: string | undefined,
  podMode?: string,
): PdfParserMode {
  const trimmed = raw?.trim().toLowerCase();
  if (trimmed === 'eager' || trimmed === 'on_demand') {
    return trimmed;
  }
  if (podMode === 'REMOTE_EDGE') return 'eager';
  return 'on_demand';
}

/** Stable binding manifest for cert digest and seal canonical form (hash-only, no raw text). */
export function buildAttachmentsExtractionBinding(
  attachments: DepackagedAttachment[] | undefined,
): Array<Record<string, unknown>> | null {
  if (!attachments?.length) return null;

  const rows: Array<Record<string, unknown>> = [];
  for (const att of attachments) {
    if (att.extracted_text_v1) {
      rows.push({
        id: att.id,
        structural_hash: att.extracted_text_v1.structural_hash,
        extractor_version: att.extracted_text_v1.extractor_version,
      });
    } else if (att.extraction_failed) {
      rows.push({
        id: att.id,
        extraction_failed: { reason: att.extraction_failed.reason },
      });
    }
  }

  if (rows.length === 0) return null;
  rows.sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
  return rows;
}

/**
 * Validation result bytes for edge certifier / LOCAL_VERIFY deep verify.
 * Augments validator output with attachment extraction bindings when present.
 */
export function validationResultBytesForCertify(
  canonicalValidationResultBytes: Uint8Array,
  attachments: DepackagedAttachment[] | undefined,
): Uint8Array {
  const binding = buildAttachmentsExtractionBinding(attachments);
  if (!binding) return canonicalValidationResultBytes;

  let validationObj: unknown;
  try {
    validationObj = JSON.parse(new TextDecoder().decode(canonicalValidationResultBytes));
  } catch {
    return canonicalValidationResultBytes;
  }

  const augmented = {
    validation: validationObj,
    attachments_extraction_v1: binding,
  };
  return canonicalizeStableJson(augmented as object);
}

/**
 * Canonical JSON sealed by the host sealer (and verified on replay).
 * Binds capsule content plus per-attachment structural hashes when present.
 */
export function buildSealCanonicalJson(depackaged: {
  rawCapsuleJson: string;
  attachments?: DepackagedAttachment[];
}): string {
  let capsule: unknown;
  try {
    capsule = JSON.parse(depackaged.rawCapsuleJson);
  } catch {
    capsule = depackaged.rawCapsuleJson;
  }

  const binding = buildAttachmentsExtractionBinding(depackaged.attachments);
  const payload = binding
    ? { capsule, attachments_extraction_v1: binding }
    : { capsule };

  return new TextDecoder().decode(canonicalizeStableJson(payload as object));
}

/** Recompute structural_hash from stored text (single-page canonical form). */
export function verifyExtractedTextStructuralHash(extracted: ExtractedTextV1): boolean {
  const pages = extracted.text.split('\n\n');
  const expected = computeStructuralHash(pages.length > 1 ? pages : [extracted.text]);
  return expected === extracted.structural_hash;
}

export function buildExtractedTextV1(text: string, structuralHash: string): ExtractedTextV1 {
  return {
    text,
    structural_hash: structuralHash,
    extractor_version: PDF_EXTRACTOR_VERSION,
  };
}

export { canonicalizePagesForHash };
