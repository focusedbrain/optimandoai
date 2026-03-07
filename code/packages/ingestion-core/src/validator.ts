/**
 * Stage 2: Validator
 *
 * Validates structural correctness of CandidateCapsuleEnvelope.
 * Produces ValidatedCapsule on success.
 *
 * Fail-closed: ANY structural violation → rejection.
 */

import type {
  CandidateCapsuleEnvelope,
  ValidatedCapsule,
  ValidatedCapsulePayload,
  ValidationResult,
  ValidationReasonCode,
  CapsuleType,
} from './types.js';
import { INGESTION_CONSTANTS } from './types.js';

const VALID_CAPSULE_TYPES = new Set([
  'accept',
  'context_sync',
  'initiate',
  'internal_draft',
  'refresh',
  'revoke',
]);

const VALID_SHARING_MODES = new Set(['receive-only', 'reciprocal']);

const VALID_EXTERNAL_PROCESSING = new Set(['none', 'local_only']);

const VALID_CLOUD_PAYLOAD_MODES = new Set(['none', 'snippet', 'full']);

interface RequiredFieldSpec {
  field: string;
  types?: string[];
  nullable?: boolean;
}

const REQUIRED_FIELDS_BY_TYPE: Record<string, RequiredFieldSpec[]> = {
  initiate: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  accept: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'sharing_mode' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
    { field: 'countersigned_hash' },
  ],
  refresh: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'prev_hash' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  revoke: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  context_sync: [
    { field: 'handshake_id' },
    { field: 'sender_id' },
    { field: 'capsule_hash' },
    { field: 'timestamp' },
    { field: 'wrdesk_policy_hash' },
    { field: 'seq' },
    { field: 'prev_hash' },
    { field: 'context_hash' },
    { field: 'context_commitment', nullable: true },
    { field: 'sender_public_key' },
    { field: 'sender_signature' },
  ],
  internal_draft: [{ field: 'timestamp' }],
};

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const POISONED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function measureJsonDepth(value: unknown, currentDepth = 0): number {
  if (currentDepth > INGESTION_CONSTANTS.MAX_JSON_DEPTH) return currentDepth;
  if (value === null || value === undefined || typeof value !== 'object') return currentDepth;
  if (Array.isArray(value)) {
    let max = currentDepth;
    for (const item of value) {
      max = Math.max(max, measureJsonDepth(item, currentDepth + 1));
      if (max > INGESTION_CONSTANTS.MAX_JSON_DEPTH) return max;
    }
    return max;
  }
  let max = currentDepth;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    max = Math.max(max, measureJsonDepth((value as Record<string, unknown>)[key], currentDepth + 1));
    if (max > INGESTION_CONSTANTS.MAX_JSON_DEPTH) return max;
  }
  return max;
}

function countFields(value: unknown, limit: number, count: { n: number }): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!countFields(item, limit, count)) return false;
    }
    return true;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    count.n++;
    if (count.n > limit) return false;
    if (!countFields((value as Record<string, unknown>)[key], limit, count)) return false;
  }
  return true;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (POISONED_KEYS.has(key)) continue;
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      safe[key] = sanitizeObject(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      safe[key] = val.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeObject(item as Record<string, unknown>)
          : item,
      );
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

export function validateCapsule(candidate: CandidateCapsuleEnvelope): ValidationResult {
  try {
    return runValidation(candidate);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown validation error';
    return { success: false, reason: 'INTERNAL_VALIDATION_ERROR', details: msg };
  }
}

function runValidation(candidate: CandidateCapsuleEnvelope): ValidationResult {
  if (candidate.ingestion_error_flag) {
    return fail('INGESTION_ERROR_PROPAGATED', candidate.ingestion_error_details ?? 'Ingestion error propagated');
  }

  const payload = candidate.raw_payload;
  if (payload === null || payload === undefined || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('MALFORMED_JSON', 'raw_payload is not a valid JSON object');
  }

  const obj = payload as Record<string, unknown>;

  if (
    Object.prototype.hasOwnProperty.call(obj, '__proto__') ||
    Object.prototype.hasOwnProperty.call(obj, 'prototype')
  ) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', 'Prototype pollution attempt detected');
  }

  const depth = measureJsonDepth(obj);
  if (depth > INGESTION_CONSTANTS.MAX_JSON_DEPTH) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', `JSON depth ${depth} exceeds limit ${INGESTION_CONSTANTS.MAX_JSON_DEPTH}`);
  }

  const fieldCount = { n: 0 };
  if (!countFields(obj, INGESTION_CONSTANTS.MAX_FIELDS, fieldCount)) {
    return fail('STRUCTURAL_INTEGRITY_FAILURE', `Field count exceeds limit ${INGESTION_CONSTANTS.MAX_FIELDS}`);
  }

  if (!('schema_version' in obj)) {
    return fail('MISSING_REQUIRED_FIELD', 'Missing required field: schema_version');
  }
  if (!INGESTION_CONSTANTS.SUPPORTED_SCHEMA_VERSIONS.includes(obj.schema_version as number)) {
    return fail('SCHEMA_VERSION_UNSUPPORTED', `Unsupported schema_version: ${obj.schema_version}`);
  }

  if (!('capsule_type' in obj)) {
    return fail('MISSING_REQUIRED_FIELD', 'Missing required field: capsule_type');
  }
  if (typeof obj.capsule_type !== 'string' || !VALID_CAPSULE_TYPES.has(obj.capsule_type)) {
    return fail('INVALID_ENUM_VALUE', `Invalid capsule_type: ${obj.capsule_type}`);
  }
  const capsuleType = obj.capsule_type as CapsuleType;

  const requiredFields = REQUIRED_FIELDS_BY_TYPE[capsuleType] ?? [];
  for (const spec of requiredFields) {
    if (!(spec.field in obj) || obj[spec.field] === undefined) {
      return fail('MISSING_REQUIRED_FIELD', `Missing required field: ${spec.field} for capsule_type ${capsuleType}`);
    }
    if (!spec.nullable && obj[spec.field] === null) {
      return fail('MISSING_REQUIRED_FIELD', `Required field ${spec.field} cannot be null for capsule_type ${capsuleType}`);
    }
  }

  if ('sharing_mode' in obj && obj.sharing_mode !== undefined) {
    if (typeof obj.sharing_mode !== 'string' || !VALID_SHARING_MODES.has(obj.sharing_mode)) {
      return fail('INVALID_ENUM_VALUE', `Invalid sharing_mode: ${obj.sharing_mode}`);
    }
  }
  if ('external_processing' in obj && obj.external_processing !== undefined) {
    if (typeof obj.external_processing !== 'string') {
      return fail('INVALID_ENUM_VALUE', `Invalid external_processing: ${obj.external_processing}`);
    }
    if (!VALID_EXTERNAL_PROCESSING.has(obj.external_processing) && !String(obj.external_processing).match(/^[a-z0-9_-]+$/i)) {
      return fail('INVALID_ENUM_VALUE', `Invalid external_processing: ${obj.external_processing}`);
    }
  }
  if ('cloud_payload_mode' in obj && obj.cloud_payload_mode !== undefined) {
    if (typeof obj.cloud_payload_mode !== 'string' || !VALID_CLOUD_PAYLOAD_MODES.has(obj.cloud_payload_mode)) {
      return fail('INVALID_ENUM_VALUE', `Invalid cloud_payload_mode: ${obj.cloud_payload_mode}`);
    }
  }

  if ('seq' in obj && obj.seq !== undefined) {
    if (typeof obj.seq !== 'number' || !Number.isInteger(obj.seq) || obj.seq < 0) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'Invalid seq: must be a non-negative integer');
    }
  }
  if ('timestamp' in obj && obj.timestamp !== undefined) {
    if (typeof obj.timestamp !== 'string') {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'timestamp must be a string');
    }
  }
  if ('handshake_id' in obj && obj.handshake_id !== undefined) {
    if (typeof obj.handshake_id !== 'string' || obj.handshake_id.length === 0) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'handshake_id must be a non-empty string');
    }
  }
  if ('context_blocks' in obj && obj.context_blocks !== undefined) {
    if (!Array.isArray(obj.context_blocks)) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'context_blocks must be an array');
    }
  }

  if (capsuleType !== 'internal_draft') {
    if (!('capsule_hash' in obj) || typeof obj.capsule_hash !== 'string') {
      return fail('CRYPTOGRAPHIC_FIELD_MISSING', 'capsule_hash is required');
    }
    if (!('sender_id' in obj) || typeof obj.sender_id !== 'string') {
      return fail('CRYPTOGRAPHIC_FIELD_MISSING', 'sender_id is required');
    }
  }

  if ('capsule_hash' in obj && typeof obj.capsule_hash === 'string') {
    if (!HEX_REGEX.test(obj.capsule_hash)) {
      return fail('HASH_BINDING_MISMATCH', 'capsule_hash is not valid hex');
    }
    if (obj.capsule_hash.length !== 64) {
      return fail('HASH_BINDING_MISMATCH', `capsule_hash wrong length: expected 64, got ${obj.capsule_hash.length}`);
    }
  }
  if ('prev_hash' in obj && obj.prev_hash !== undefined && typeof obj.prev_hash === 'string') {
    if (!HEX_REGEX.test(obj.prev_hash)) {
      return fail('HASH_BINDING_MISMATCH', 'prev_hash is not valid hex');
    }
    if (obj.prev_hash.length !== 64) {
      return fail('HASH_BINDING_MISMATCH', `prev_hash wrong length: expected 64, got ${(obj.prev_hash as string).length}`);
    }
  }

  if ('sender_public_key' in obj && obj.sender_public_key !== undefined) {
    if (typeof obj.sender_public_key !== 'string' || !HEX_REGEX.test(obj.sender_public_key) || obj.sender_public_key.length !== 64) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'sender_public_key must be exactly 64-char hex');
    }
  }
  if ('sender_signature' in obj && obj.sender_signature !== undefined) {
    if (typeof obj.sender_signature !== 'string' || !HEX_REGEX.test(obj.sender_signature) || obj.sender_signature.length !== 128) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'sender_signature must be exactly 128-char hex');
    }
  }
  if ('countersigned_hash' in obj && obj.countersigned_hash !== undefined) {
    if (typeof obj.countersigned_hash !== 'string' || !HEX_REGEX.test(obj.countersigned_hash) || obj.countersigned_hash.length !== 128) {
      return fail('STRUCTURAL_INTEGRITY_FAILURE', 'countersigned_hash must be exactly 128-char hex');
    }
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(payload));
  if (payloadSize > INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES) {
    return fail('PAYLOAD_SIZE_EXCEEDED', `Payload size ${payloadSize} exceeds limit ${INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES}`);
  }

  const safeObj = sanitizeObject(obj);
  const validatedPayload: ValidatedCapsulePayload = {
    capsule_type: capsuleType,
    schema_version: (obj.schema_version as number) ?? 2,
    handshake_id: typeof safeObj.handshake_id === 'string' ? safeObj.handshake_id : undefined,
    ...safeObj,
  };

  const validated = createValidatedCapsule(candidate, validatedPayload);
  return { success: true, validated };
}

function createValidatedCapsule(
  candidate: CandidateCapsuleEnvelope,
  parsedPayload: ValidatedCapsulePayload,
): ValidatedCapsule {
  return {
    __brand: 'ValidatedCapsule',
    provenance: candidate.provenance,
    capsule: parsedPayload,
    validated_at: new Date().toISOString(),
    validator_version: INGESTION_CONSTANTS.VALIDATOR_VERSION,
    schema_version: (parsedPayload.schema_version as number) ?? 2,
  };
}

function fail(reason: ValidationReasonCode, details: string): ValidationResult {
  return { success: false, reason, details };
}
