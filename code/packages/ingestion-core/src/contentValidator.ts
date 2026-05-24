/**
 * Content Validator — post-decrypt artefact structural check.
 *
 * Called by every path that writes depackaged_json to inbox_messages after
 * decrypting or decoding a qBEAP/pBEAP capsule in the Electron main process.
 *
 * Architecture (PR 2/7):
 *   Decryption happens in callers (Decision 3b); callers hand the decrypted
 *   plaintext to this function before writing inbox_messages.validated_at.
 *   The function is the sole path that produces the validated mark for
 *   message-package content (I.3.3 analogue for the content layer).
 *
 * Phase B, PR B-3 additions:
 *   - 'plain_email': conformant shape for plain-text emails with no BEAP capsule.
 *     The validator recognises the content_type discriminator and returns ok.
 *     Callers set inbox_messages.validation_reason = 'plain_email_no_validation_required'.
 *   - 'host_quarantine': conformant shape for BEAP emails the host cannot depackage.
 *     Required fields are structurally checked; the sealed row lands in quarantine_messages.
 *
 * Phase B, PR B-5 addition:
 *   - 'beap_message': canonical shape for fully-depackaged BEAP content produced
 *     by the extension Stage-5 merge path.  Carries optional session_import_artefact
 *     and required attachments_canonical (Att-2 Binding for BEAP rows).
 *     New writes through mergeExtensionDepackaged MUST include this content_type and
 *     MUST include attachments_canonical (empty array for messages with no attachments).
 *     Old-shape BEAP rows sealed without content_type use the default branch; their
 *     existing seals are valid and not re-validated (Decision 1.5 — no legacy migration).
 *
 * Invariants:
 *   - Never throws. Returns rejection state on any unexpected error.
 *   - Never logs artefact content — only the failed check name.
 *   - Artefact absence is conformant per A.3.054.8.
 *   - Callers MUST NOT render artefact-related UI when validation_reason is
 *     non-null (I.3.4).
 *
 * per Canon A.3.054.8, Annex I.3.3, Annex I.3.4
 */

import { validateSessionImportArtefact } from './validator.js';
import type { ValidationReasonCode } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Version token written to inbox_messages.validator_version. */
export const CONTENT_VALIDATOR_VERSION = '1.1.0' as const;

/**
 * Result written to the three validated-mark columns on inbox_messages.
 * per Decision 2 (PR 2/7): three columns, not a JSON blob, to allow indexed
 * queries on validation state.
 */
export interface ContentValidationResult {
  /** RFC 3339 UTC timestamp of when validation ran. Never null. */
  validated_at: string;
  /** Identifies the validator version that produced the mark. Never null. */
  validator_version: string;
  /**
   * Null if validation passed (or no artefact was present — absence is
   * conformant per A.3.054.8). Non-null ValidationReasonCode if rejected.
   */
  validation_reason: ValidationReasonCode | null;
  /**
   * Human-readable rejection detail. Null when validation_reason is null.
   * Stored in inbox_messages for operator diagnostics; never surfaced in UI.
   */
  validation_details: string | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Validate the decoded BEAP message content before it is written to
 * inbox_messages.depackaged_json.
 *
 * Accepts:
 *   - A JSON string (the raw depackaged_json value), or
 *   - An already-parsed object (e.g. the DecryptedQBeapContent shape).
 *
 * If the content contains a `session_import_artefact` field, delegates to
 * `validateSessionImportArtefact` from PR 1. If the field is absent the
 * content is conformant — the validated mark is still written (absence is not
 * an error; it just means the message has no artefact payload).
 *
 * Does NOT execute, render, or interpret artefact content. Structural
 * validation only, per Annex I.3.3.
 */
export function validateDecryptedBeapContent(content: unknown): ContentValidationResult {
  const validated_at = new Date().toISOString();
  const validator_version = CONTENT_VALIDATOR_VERSION;

  try {
    // 1. Normalize to a parsed object.
    let parsed: unknown = content;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (!trimmed) {
        // Empty string — no artefact; conformant.
        return ok(validated_at, validator_version);
      }
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Not valid JSON — no artefact to validate; conformant.
        return ok(validated_at, validator_version);
      }
    }

    // 2. Must be a non-null, non-array object to carry an artefact.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ok(validated_at, validator_version);
    }

    const obj = parsed as Record<string, unknown>;

    // 3. Dispatch on content_type discriminator (Phase B, PR B-3).
    const contentType = typeof obj.content_type === 'string' ? obj.content_type : undefined;

    if (contentType === 'plain_email') {
      // Plain emails carry no BEAP capsule. Structural check: required transport fields.
      return validatePlainEmailContent(obj, validated_at, validator_version);
    }

    if (contentType === 'host_quarantine') {
      // Quarantine records: BEAP email the host cannot depackage. Structural check only.
      return validateHostQuarantineContent(obj, validated_at, validator_version);
    }

    if (contentType === 'beap_message') {
      // Fully-depackaged BEAP content from extension Stage-5 merge (PR B-5).
      return validateBeapMessageContent(obj, validated_at, validator_version);
    }

    // 4. Check for session_import_artefact. Absence is conformant.
    if (!('session_import_artefact' in obj) || obj.session_import_artefact === undefined) {
      return ok(validated_at, validator_version);
    }

    // 5. Artefact present — run structural validation (PR 1).
    const artefactResult = validateSessionImportArtefact(obj.session_import_artefact);

    if (artefactResult.success) {
      return ok(validated_at, validator_version);
    }

    // Log only the check name, never the content (I.3.3 operator-log rule).
    console.warn(
      '[ContentValidator] session_import_artefact structural check failed:',
      artefactResult.reason,
    );

    return {
      validated_at,
      validator_version,
      validation_reason: artefactResult.reason,
      validation_details: artefactResult.details,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[ContentValidator] unexpected error during content validation:', msg);
    return {
      validated_at,
      validator_version,
      validation_reason: 'INTERNAL_VALIDATION_ERROR',
      validation_details: 'content validator threw unexpectedly',
    };
  }
}

function ok(validated_at: string, validator_version: string): ContentValidationResult {
  return { validated_at, validator_version, validation_reason: null, validation_details: null };
}

// ---------------------------------------------------------------------------
// BEAP message structural check (Phase B, PR B-5)
// ---------------------------------------------------------------------------

/**
 * Validates a fully-depackaged BEAP message content object
 * (`content_type: 'beap_message'`).
 *
 * Written by the extension Stage-5 merge path (`mergeExtensionDepackaged`).
 * Structural checks:
 *   1. attachments_canonical is required (even as an empty array). This
 *      enforces the Att-2 property: the seal binds every attachment's hash.
 *   2. If session_import_artefact is present, it is structurally validated.
 *   3. attachments_canonical entries are validated via validateAttachmentsCanonical.
 *
 * Old-shape BEAP rows (sealed without content_type) are handled by the
 * default branch — they are never re-validated through this path.
 *
 * per Phase B Architecture, PR B-5, Decision B.
 */
function validateBeapMessageContent(
  obj: Record<string, unknown>,
  validated_at: string,
  validator_version: string,
): ContentValidationResult {
  // attachments_canonical is required for new beap_message writes (Att-2).
  if (!('attachments_canonical' in obj)) {
    console.warn('[ContentValidator] beap_message missing required field: attachments_canonical');
    return {
      validated_at,
      validator_version,
      validation_reason: 'MISSING_REQUIRED_FIELD',
      validation_details: 'beap_message missing required field: attachments_canonical (empty array required for messages with no attachments)',
    };
  }

  // Validate the structure of attachments_canonical entries.
  const attResult = validateAttachmentsCanonical(
    obj['attachments_canonical'],
    validated_at,
    validator_version,
    'beap_message',
  );
  if (attResult !== null) return attResult;

  // Validate session_import_artefact if present.
  if ('session_import_artefact' in obj && obj.session_import_artefact !== undefined) {
    const artefactResult = validateSessionImportArtefact(obj.session_import_artefact);
    if (!artefactResult.success) {
      console.warn(
        '[ContentValidator] beap_message session_import_artefact structural check failed:',
        artefactResult.reason,
      );
      return {
        validated_at,
        validator_version,
        validation_reason: artefactResult.reason,
        validation_details: artefactResult.details,
      };
    }
  }

  // B-7: validate optional ai_analysis_json if present.
  const aiResult = validateAiAnalysisField(obj, validated_at, validator_version, 'beap_message');
  if (aiResult !== null) return aiResult;

  return ok(validated_at, validator_version);
}

// ---------------------------------------------------------------------------
// Plain email structural check (Phase B, PR B-3)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Attachment canonical validation helper (Phase B, PR B-3.1 — Att-2)
// ---------------------------------------------------------------------------

/**
 * Validates the optional `attachments_canonical` array that may appear on
 * any content type whose parent seal should cover attachment integrity.
 *
 * Att-2 property: the seal binds `sha256(canonical_json)`, and
 * `canonical_json` includes `attachments_canonical` with each attachment's
 * `content_sha256`.  Any post-write tampering with an `inbox_attachments`
 * row's stored content is therefore detectable at read time.
 *
 * Absence is conformant.  An empty array is conformant.  Each entry must be
 * an object with at minimum a non-empty `attachment_id` string.
 * `content_sha256`, when present, must be a non-empty string.
 *
 * per Phase B Architecture, PR B-3.1, Gap 1, Option Att-2.
 */
function validateAttachmentsCanonical(
  arr: unknown,
  validated_at: string,
  validator_version: string,
  context: string,
): ContentValidationResult | null {
  if (arr === undefined || arr === null) return null;
  if (!Array.isArray(arr)) {
    console.warn(`[ContentValidator] ${context}: attachments_canonical must be an array`);
    return {
      validated_at,
      validator_version,
      validation_reason: 'MISSING_REQUIRED_FIELD',
      validation_details: `${context}: attachments_canonical must be an array`,
    };
  }
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      console.warn(`[ContentValidator] ${context}: attachments_canonical[${i}] must be an object`);
      return {
        validated_at,
        validator_version,
        validation_reason: 'MISSING_REQUIRED_FIELD',
        validation_details: `${context}: attachments_canonical[${i}] must be an object`,
      };
    }
    const entry = a as Record<string, unknown>;
    if (typeof entry['attachment_id'] !== 'string' || !entry['attachment_id'].trim()) {
      console.warn(`[ContentValidator] ${context}: attachments_canonical[${i}].attachment_id missing`);
      return {
        validated_at,
        validator_version,
        validation_reason: 'MISSING_REQUIRED_FIELD',
        validation_details: `${context}: attachments_canonical[${i}].attachment_id must be a non-empty string`,
      };
    }
    if ('content_sha256' in entry && entry['content_sha256'] !== null) {
      if (typeof entry['content_sha256'] !== 'string' || !entry['content_sha256'].trim()) {
        console.warn(`[ContentValidator] ${context}: attachments_canonical[${i}].content_sha256 invalid`);
        return {
          validated_at,
          validator_version,
          validation_reason: 'MISSING_REQUIRED_FIELD',
          validation_details: `${context}: attachments_canonical[${i}].content_sha256 must be a non-empty string when present`,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// AI analysis canonical field validation (Phase B, PR B-7 / P2.1)
// ---------------------------------------------------------------------------

// ISO 8601 basic check: accepts YYYY-MM-DDTHH:MM:SS[.frac][Z|±HH:MM]
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

// ── TypeScript types for ai_analysis_json sub-fields (P2.1) ──────────────────

export type PhishingLabel = 'low' | 'elevated' | 'high';
export type CrosscheckConfidence = 'low' | 'medium' | 'high';

/** Shape of ai_analysis_json.phishing_assessment (P2.1). */
export interface PhishingAssessment {
  /** Integer in the range 0..100 (inclusive). */
  score: number;
  label: PhishingLabel;
  /** Array of signal strings or objects describing why the score was assigned. */
  signals: unknown[];
  /** URLs extracted from the message that the scorer flagged. */
  flagged_urls: unknown[];
  /** Version token for the disclaimer text rendered to the user. */
  disclaimer_version: string;
  /** Model identifier string (e.g. "wrdesk-phishing-v1"). */
  model: string;
  /** ISO 8601 timestamp of when the assessment was generated. */
  generated_at: string;
}

/** Shape of ai_analysis_json.validation_crosscheck (P2.1). */
export interface ValidationCrosscheck {
  /** Whether the AI assessment agrees with the structural validator's outcome. */
  agrees_with_validator: boolean;
  /** Array of finding strings or objects produced by the cross-check. */
  findings: unknown[];
  confidence: CrosscheckConfidence;
  /** Model identifier string. */
  model: string;
  /** ISO 8601 timestamp of when the cross-check was generated. */
  generated_at: string;
}

/** Top-level type for the ai_analysis_json column (P2.1). */
export interface AiAnalysisJson {
  phishing_assessment?: PhishingAssessment;
  validation_crosscheck?: ValidationCrosscheck;
  [key: string]: unknown;
}

// ── Sub-field validators ──────────────────────────────────────────────────────

const PHISHING_LABELS: ReadonlySet<string> = new Set(['low', 'elevated', 'high']);
const CROSSCHECK_CONFIDENCES: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

/**
 * Returns a human-readable error string if `v` is not a valid PhishingAssessment,
 * or null if it is valid.
 */
function validatePhishingAssessment(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return 'phishing_assessment must be a non-array object';
  }
  const a = v as Record<string, unknown>;

  if (
    typeof a['score'] !== 'number' ||
    !Number.isInteger(a['score']) ||
    (a['score'] as number) < 0 ||
    (a['score'] as number) > 100
  ) {
    return 'phishing_assessment.score must be an integer in 0..100';
  }

  if (typeof a['label'] !== 'string' || !PHISHING_LABELS.has(a['label'] as string)) {
    return 'phishing_assessment.label must be "low", "elevated", or "high"';
  }

  if (!Array.isArray(a['signals'])) {
    return 'phishing_assessment.signals must be an array';
  }

  if (!Array.isArray(a['flagged_urls'])) {
    return 'phishing_assessment.flagged_urls must be an array';
  }

  if (typeof a['disclaimer_version'] !== 'string') {
    return 'phishing_assessment.disclaimer_version must be a string';
  }

  if (typeof a['model'] !== 'string') {
    return 'phishing_assessment.model must be a string';
  }

  if (typeof a['generated_at'] !== 'string' || !ISO_8601_RE.test(a['generated_at'])) {
    return 'phishing_assessment.generated_at must be an ISO 8601 string';
  }

  return null;
}

/**
 * Returns a human-readable error string if `v` is not a valid ValidationCrosscheck,
 * or null if it is valid.
 */
function validateValidationCrosscheck(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return 'validation_crosscheck must be a non-array object';
  }
  const a = v as Record<string, unknown>;

  if (typeof a['agrees_with_validator'] !== 'boolean') {
    return 'validation_crosscheck.agrees_with_validator must be a boolean';
  }

  if (!Array.isArray(a['findings'])) {
    return 'validation_crosscheck.findings must be an array';
  }

  if (typeof a['confidence'] !== 'string' || !CROSSCHECK_CONFIDENCES.has(a['confidence'] as string)) {
    return 'validation_crosscheck.confidence must be "low", "medium", or "high"';
  }

  if (typeof a['model'] !== 'string') {
    return 'validation_crosscheck.model must be a string';
  }

  if (typeof a['generated_at'] !== 'string' || !ISO_8601_RE.test(a['generated_at'])) {
    return 'validation_crosscheck.generated_at must be an ISO 8601 string';
  }

  return null;
}

/**
 * Validates the optional `ai_analysis_json` field that may appear on any
 * content type after the AI analysis write path (PR B-7).
 *
 * `ai_analysis_json` is AI-generated advisory output. The validator checks
 * structural conformance only — it does NOT validate the semantic correctness
 * of the AI's analysis.
 *
 * Absence is conformant. `null` is conformant (represents "cleared").
 * When present, the top-level value must be a non-array object. When the
 * optional sub-fields `phishing_assessment` or `validation_crosscheck` are
 * present they must match their respective schemas exactly (P2.1).
 *
 * per Phase B Architecture, PR B-7 / P2.1.
 */
export function validateAiAnalysisField(
  obj: Record<string, unknown>,
  validated_at: string,
  validator_version: string,
  context: string,
): ContentValidationResult | null {
  if (!('ai_analysis_json' in obj)) return null;
  const v = obj['ai_analysis_json'];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) {
    console.warn(`[ContentValidator] ${context}: ai_analysis_json must be an object or null`);
    return {
      validated_at,
      validator_version,
      validation_reason: 'MISSING_REQUIRED_FIELD',
      validation_details: `${context}: ai_analysis_json must be a non-array object or null when present`,
    };
  }

  const ai = v as Record<string, unknown>;

  // Validate phishing_assessment sub-field (P2.1).
  if ('phishing_assessment' in ai && ai['phishing_assessment'] != null) {
    const err = validatePhishingAssessment(ai['phishing_assessment']);
    if (err !== null) {
      console.warn(`[ContentValidator] ${context}: ${err}`);
      return {
        validated_at,
        validator_version,
        validation_reason: 'AI_PHISHING_ASSESSMENT_INVALID',
        validation_details: `${context}: ${err}`,
      };
    }
  }

  // Validate validation_crosscheck sub-field (P2.1).
  if ('validation_crosscheck' in ai && ai['validation_crosscheck'] != null) {
    const err = validateValidationCrosscheck(ai['validation_crosscheck']);
    if (err !== null) {
      console.warn(`[ContentValidator] ${context}: ${err}`);
      return {
        validated_at,
        validator_version,
        validation_reason: 'AI_VALIDATION_CROSSCHECK_INVALID',
        validation_details: `${context}: ${err}`,
      };
    }
  }

  return null;
}

const PLAIN_EMAIL_REQUIRED_STRINGS = ['transport_sender', 'transport_received_at'] as const;

/**
 * Validates a plain-email content object (`content_type: 'plain_email'`).
 *
 * Plain emails carry no BEAP capsule. They are conformant by design.
 * The validator checks that the minimum transport-metadata fields are present
 * and non-empty strings, then returns ok. Callers set
 * `inbox_messages.validation_reason = 'plain_email_no_validation_required'`.
 *
 * per Phase B Architecture, Amendment 1 to B-3, Q3 resolution.
 */
function validatePlainEmailContent(
  obj: Record<string, unknown>,
  validated_at: string,
  validator_version: string,
): ContentValidationResult {
  for (const field of PLAIN_EMAIL_REQUIRED_STRINGS) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string).trim()) {
      console.warn('[ContentValidator] plain_email missing required field:', field);
      return {
        validated_at,
        validator_version,
        validation_reason: 'MISSING_REQUIRED_FIELD',
        validation_details: `plain_email missing required field: ${field}`,
      };
    }
  }
  // Att-2 (PR B-3.1): validate optional attachments_canonical if present.
  const attResult = validateAttachmentsCanonical(
    obj['attachments_canonical'],
    validated_at,
    validator_version,
    'plain_email',
  );
  if (attResult !== null) return attResult;
  // B-7: validate optional ai_analysis_json if present.
  const aiResult = validateAiAnalysisField(obj, validated_at, validator_version, 'plain_email');
  if (aiResult !== null) return aiResult;
  return ok(validated_at, validator_version);
}

// ---------------------------------------------------------------------------
// Host-quarantine structural check (Phase B, PR B-3)
// ---------------------------------------------------------------------------

const QUARANTINE_REQUIRED_STRINGS = [
  'id',
  'blob_storage_id',
  'blob_sha256',
  'rejection_reason',
  'paired_sandbox_handshake_id',
] as const;

/**
 * Validates a host-quarantine content object (`content_type: 'host_quarantine'`).
 *
 * Quarantine records represent BEAP-bearing emails the host cannot depackage.
 * The blob (original email bytes) is already encrypted to the sandbox's
 * public key before this function is called; the validator performs structural
 * checking only — it does not inspect the ciphertext.
 *
 * Required fields must be non-empty strings. blob_size_bytes must be a
 * positive integer.
 *
 * per Phase B Architecture, Amendment 1 to B-3, Q2 resolution.
 */
function validateHostQuarantineContent(
  obj: Record<string, unknown>,
  validated_at: string,
  validator_version: string,
): ContentValidationResult {
  for (const field of QUARANTINE_REQUIRED_STRINGS) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string).trim()) {
      console.warn('[ContentValidator] host_quarantine missing required field:', field);
      return {
        validated_at,
        validator_version,
        validation_reason: 'MISSING_REQUIRED_FIELD',
        validation_details: `host_quarantine missing required field: ${field}`,
      };
    }
  }
  const blobSize = obj['blob_size_bytes'];
  if (typeof blobSize !== 'number' || !Number.isInteger(blobSize) || blobSize < 0) {
    console.warn('[ContentValidator] host_quarantine invalid blob_size_bytes:', blobSize);
    return {
      validated_at,
      validator_version,
      validation_reason: 'MISSING_REQUIRED_FIELD',
      validation_details: 'host_quarantine blob_size_bytes must be a non-negative integer',
    };
  }
  return ok(validated_at, validator_version);
}
