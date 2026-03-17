/**
 * BEAP Structural Validator
 *
 * Validates .beap package structure WITHOUT decryption.
 * Pure function — no side effects, no I/O, no key material.
 * Uses node:crypto for SHA-256 hash of input.
 */

import { createHash } from 'node:crypto';

// ── Size Limits (per canon A.3.054.9, aligned with BeapPackageBuilder) ──

export const SIZE_LIMITS = {
  /** Maximum total package size (500 MB) */
  PACKAGE_MAX_BYTES: 500 * 1024 * 1024,
  /** Maximum payload/capsule size — base64 string limit (14 MB allows ~10 MB plaintext) */
  PAYLOAD_MAX_BYTES: 14 * 1024 * 1024,
  /** Maximum single artefact size (100 MB) */
  ARTEFACT_MAX_BYTES: 100 * 1024 * 1024,
  /** Maximum envelope size (64 KB) */
  ENVELOPE_MAX_BYTES: 64 * 1024,
  /** Maximum JSON depth */
  MAX_JSON_DEPTH: 50,
  /** Maximum field count */
  MAX_FIELDS: 500,
} as const;

const POISONED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ACCEPTED_VERSIONS = new Set(['1.0', '2.0']);
const ACCEPTED_ENCODINGS = new Set(['qBEAP', 'pBEAP']);
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

export interface StructuralValidationResult {
  readonly valid: boolean;
  readonly inputHash?: string;
  readonly errors: readonly string[];
  readonly warnings?: readonly string[];
}

function measureDepth(value: unknown, currentDepth = 0): number {
  if (currentDepth > SIZE_LIMITS.MAX_JSON_DEPTH) return currentDepth;
  if (value === null || value === undefined || typeof value !== 'object') return currentDepth;
  if (Array.isArray(value)) {
    let max = currentDepth;
    for (const item of value) {
      max = Math.max(max, measureDepth(item, currentDepth + 1));
      if (max > SIZE_LIMITS.MAX_JSON_DEPTH) return max;
    }
    return max;
  }
  let max = currentDepth;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    max = Math.max(max, measureDepth((value as Record<string, unknown>)[key], currentDepth + 1));
    if (max > SIZE_LIMITS.MAX_JSON_DEPTH) return max;
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

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Validate .beap package structure without decryption.
 *
 * Checks:
 * a. Valid JSON, top-level shape (header, metadata, envelope/payload, signature)
 * b. Header: version, encoding, sizing declarations, commitment hashes present
 * c. Size limits: total < 500MB, payload < 10MB, artefact < 100MB, envelope < 64KB
 * d. Field count < 500, depth < 50
 * e. Prototype pollution guard (__proto__, constructor, prototype)
 * f. Signature present and structurally valid (base64, correct length)
 * g. qBEAP: receiver_binding or receiver_fingerprint present
 * h. v2.0: innerEnvelopeCiphertext present when encoding is qBEAP
 */
export function validateBeapStructure(rawInput: string): StructuralValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const inputBytes = Buffer.byteLength(rawInput, 'utf8');
  if (inputBytes > SIZE_LIMITS.PACKAGE_MAX_BYTES) {
    errors.push(`Total size ${inputBytes} exceeds limit ${SIZE_LIMITS.PACKAGE_MAX_BYTES}`);
    return { valid: false, errors, warnings };
  }

  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawInput);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('Input must be a JSON object');
      return { valid: false, errors, warnings };
    }
    pkg = parsed as Record<string, unknown>;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Invalid JSON');
    return { valid: false, errors, warnings };
  }

  const inputHash = sha256Hex(rawInput);

  // e. Prototype pollution guard
  if (
    Object.prototype.hasOwnProperty.call(pkg, '__proto__') ||
    Object.prototype.hasOwnProperty.call(pkg, 'constructor') ||
    Object.prototype.hasOwnProperty.call(pkg, 'prototype')
  ) {
    errors.push('Prototype pollution attempt detected');
    return { valid: false, inputHash, errors, warnings };
  }

  // d. Field count and depth
  const fieldCount = { n: 0 };
  if (!countFields(pkg, SIZE_LIMITS.MAX_FIELDS, fieldCount)) {
    errors.push(`Field count exceeds limit ${SIZE_LIMITS.MAX_FIELDS}`);
  }
  const depth = measureDepth(pkg);
  if (depth > SIZE_LIMITS.MAX_JSON_DEPTH) {
    errors.push(`JSON depth ${depth} exceeds limit ${SIZE_LIMITS.MAX_JSON_DEPTH}`);
  }

  // a. Top-level shape
  if (!pkg.header || typeof pkg.header !== 'object') {
    errors.push('Missing or invalid header');
  }
  if (!pkg.metadata || typeof pkg.metadata !== 'object') {
    errors.push('Missing or invalid metadata');
  }
  const hasPayload = 'payload' in pkg;
  const hasPayloadEnc = 'payloadEnc' in pkg;
  const hasEnvelope = 'envelope' in pkg;
  if (!hasPayload && !hasPayloadEnc && !hasEnvelope) {
    errors.push('Missing payload, payloadEnc, or envelope');
  }

  // f. Signature present and structurally valid
  if (!pkg.signature) {
    errors.push('Missing signature');
  } else {
    const sig = pkg.signature as Record<string, unknown>;
    if (typeof sig !== 'object' || sig === null) {
      errors.push('Signature must be an object');
    } else {
      const sigValue = sig.value ?? sig.sig ?? sig.signature;
      if (typeof sigValue !== 'string') {
        errors.push('Signature value must be a string');
      } else if (!BASE64_REGEX.test(sigValue)) {
        errors.push('Signature value must be valid base64');
      } else {
        const decodedLen = Math.ceil((sigValue.length * 3) / 4);
        if (decodedLen !== 64) {
          warnings.push(`Signature length ${decodedLen} bytes; Ed25519 expects 64`);
        }
      }
    }
  }

  const header = pkg.header as Record<string, unknown> | undefined;
  if (header && typeof header === 'object') {
    // b. Header: version, encoding, sizing declarations, commitment hashes
    if (!ACCEPTED_VERSIONS.has(String(header.version ?? ''))) {
      errors.push(`Unsupported header.version: ${header.version}`);
    }
    if (!ACCEPTED_ENCODINGS.has(String(header.encoding ?? ''))) {
      errors.push(`Invalid header.encoding: ${header.encoding}`);
    }
    if (!header.template_hash || typeof header.template_hash !== 'string') {
      errors.push('Missing or invalid header.template_hash');
    }
    if (!header.policy_hash || typeof header.policy_hash !== 'string') {
      errors.push('Missing or invalid header.policy_hash');
    }
    if (!header.content_hash || typeof header.content_hash !== 'string') {
      errors.push('Missing or invalid header.content_hash');
    }

    // c. Size limits from header.sizeLimits (if present)
    const sizeLimits = header.sizeLimits as Record<string, number> | undefined;
    if (sizeLimits && typeof sizeLimits === 'object') {
      if (sizeLimits.envelopeMaxBytes > SIZE_LIMITS.ENVELOPE_MAX_BYTES) {
        errors.push(`header.sizeLimits.envelopeMaxBytes exceeds ${SIZE_LIMITS.ENVELOPE_MAX_BYTES}`);
      }
      if (sizeLimits.capsulePlaintextMaxBytes > SIZE_LIMITS.PAYLOAD_MAX_BYTES) {
        errors.push(`header.sizeLimits.capsulePlaintextMaxBytes exceeds ${SIZE_LIMITS.PAYLOAD_MAX_BYTES}`);
      }
      if (sizeLimits.artefactMaxBytes > SIZE_LIMITS.ARTEFACT_MAX_BYTES) {
        errors.push(`header.sizeLimits.artefactMaxBytes exceeds ${SIZE_LIMITS.ARTEFACT_MAX_BYTES}`);
      }
      if (sizeLimits.packageMaxBytes > SIZE_LIMITS.PACKAGE_MAX_BYTES) {
        errors.push(`header.sizeLimits.packageMaxBytes exceeds ${SIZE_LIMITS.PACKAGE_MAX_BYTES}`);
      }
    }

    // g. qBEAP: receiver_binding or receiver_fingerprint present
    const encoding = String(header.encoding ?? '');
    if (encoding === 'qBEAP') {
      const hasBinding = header.receiver_binding && typeof header.receiver_binding === 'object';
      const hasFingerprint = typeof header.receiver_fingerprint === 'string' && header.receiver_fingerprint.length > 0;
      if (!hasBinding && !hasFingerprint) {
        errors.push('qBEAP requires header.receiver_binding or header.receiver_fingerprint');
      }
    }

    // h. v2.0: innerEnvelopeCiphertext present when encoding is qBEAP
    const version = String(header.version ?? '1.0');
    if (version === '2.0' && encoding === 'qBEAP') {
      if (!pkg.innerEnvelopeCiphertext || typeof pkg.innerEnvelopeCiphertext !== 'string') {
        errors.push('v2.0 qBEAP requires innerEnvelopeCiphertext');
      }
    }
  }

  // c. Payload size (base64 string byte length as structural upper bound)
  if (hasPayload && typeof pkg.payload === 'string') {
    const payloadBytes = Buffer.byteLength(pkg.payload, 'utf8');
    if (payloadBytes > SIZE_LIMITS.PAYLOAD_MAX_BYTES) {
      errors.push(`Payload size ${payloadBytes} exceeds limit ${SIZE_LIMITS.PAYLOAD_MAX_BYTES}`);
    }
  }

  return {
    valid: errors.length === 0,
    inputHash,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
