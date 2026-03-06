import { describe, test, expect } from 'vitest';
import {
  validateInput,
  ingestInput,
  validateCapsule,
  detectBeapCapsule,
  routeValidatedCapsule,
  type RawInput,
  type TransportMetadata,
} from '../src/index.js';

const emptyTransport: TransportMetadata = {};

function validBeapPayload(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
  };
}

describe('ingestion-core', () => {
  test('validateInput: valid BEAP → success, handshake_pipeline', () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) };
    const result = validateInput(rawInput, 'email', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.validated).toBeDefined();
      expect(result.distribution).toBeDefined();
      expect(result.distribution!.target).toBe('handshake_pipeline');
      expect(result.validated!.__brand).toBe('ValidatedCapsule');
    }
  });

  test('validateInput: malformed JSON → rejected', () => {
    const rawInput: RawInput = {
      body: '{invalid json!',
      mime_type: 'application/vnd.beap+json',
    };
    const result = validateInput(rawInput, 'email', emptyTransport);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED');
    }
  });

  test('validateInput: plain content → internal_draft → sandbox', () => {
    const rawInput: RawInput = { body: 'Hello, plain email.' };
    const result = validateInput(rawInput, 'email', emptyTransport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.distribution!.target).toBe('sandbox_sub_orchestrator');
      expect(result.validated!.capsule.capsule_type).toBe('internal_draft');
    }
  });

  test('validateInput: unsupported schema_version → rejected', () => {
    const rawInput: RawInput = {
      body: JSON.stringify({ schema_version: 99, capsule_type: 'initiate' }),
    };
    const result = validateInput(rawInput, 'api', emptyTransport);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.validation_reason_code).toBe('SCHEMA_VERSION_UNSUPPORTED');
    }
  });

  test('detectBeapCapsule: JSON structure detection', () => {
    const input: RawInput = { body: JSON.stringify(validBeapPayload()) };
    const result = detectBeapCapsule(input);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.detection_method).toBe('json_structure');
      expect((result.raw_capsule_json as Record<string, unknown>).capsule_type).toBe('initiate');
    }
  });

  test('ingestInput + validateCapsule: chain works', () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) };
    const candidate = ingestInput(rawInput, 'p2p', emptyTransport);
    expect(candidate.__brand).toBe('CandidateCapsule');
    expect(candidate.ingestion_error_flag).toBe(false);

    const validation = validateCapsule(candidate);
    expect(validation.success).toBe(true);
    if (validation.success) {
      const distribution = routeValidatedCapsule(validation.validated);
      expect(distribution.target).toBe('handshake_pipeline');
    }
  });

  test('runs without Electron, DB, or better-sqlite3', () => {
    expect(typeof process).toBe('object');
    expect(typeof process.versions.node).toBe('string');
    const result = validateInput(
      { body: JSON.stringify(validBeapPayload()) },
      'internal',
      emptyTransport,
    );
    expect(result.success).toBe(true);
  });
});
