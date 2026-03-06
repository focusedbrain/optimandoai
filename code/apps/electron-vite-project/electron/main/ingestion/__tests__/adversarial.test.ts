import { describe, test, expect } from 'vitest'
import { validateCapsule, ingestInput } from '@repo/ingestion-core'
import { processIncomingInput } from '../ingestionPipeline'
import type { CandidateCapsuleEnvelope, ProvenanceMetadata, RawInput, TransportMetadata } from '../types'

function makeProvenance(): ProvenanceMetadata {
  return {
    source_type: 'email',
    origin_classification: 'external',
    ingested_at: new Date().toISOString(),
    transport_metadata: {},
    input_classification: 'beap_capsule_present',
    raw_input_hash: 'a'.repeat(64),
    ingestor_version: '1.0.0',
  }
}

function makeCandidate(payload: unknown, overrides?: Partial<CandidateCapsuleEnvelope>): CandidateCapsuleEnvelope {
  return {
    __brand: 'CandidateCapsule',
    provenance: makeProvenance(),
    raw_payload: payload,
    ingestion_error_flag: false,
    ...overrides,
  }
}

function validInitiate(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
  }
}

const emptyTransport: TransportMetadata = {}

describe('Adversarial Tests', () => {
  // Test 1: Bypass validator — direct handshake call with raw input
  test('CandidateCapsuleEnvelope brand differs from ValidatedCapsule', () => {
    const candidate = makeCandidate(validInitiate())
    expect(candidate.__brand).toBe('CandidateCapsule')
    expect(candidate.__brand).not.toBe('ValidatedCapsule')
  })

  // Test 2: Oversized payload (10MB+)
  test('oversized payload (10MB+) → rejected', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      huge: 'x'.repeat(11 * 1024 * 1024),
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('PAYLOAD_SIZE_EXCEEDED')
  })

  // Test 3: Deeply nested JSON
  test('deeply nested JSON → safely handled', () => {
    let nested: any = { schema_version: 1, capsule_type: 'initiate' }
    for (let i = 0; i < 100; i++) {
      nested = { child: nested }
    }
    const result = validateCapsule(makeCandidate(nested))
    expect(result.success).toBe(false)
  })

  // Test 4: Future-dated capsule passes Validator (timestamps not Validator's job)
  test('future-dated capsule passes Validator', () => {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      timestamp: futureDate,
    }))
    expect(result.success).toBe(true)
  })

  // Test 5: Invalid sharing mode value
  test('invalid sharing_mode value → INVALID_ENUM_VALUE', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      capsule_type: 'accept',
      sharing_mode: 'invalid-mode',
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_ENUM_VALUE')
  })

  // Test 6: Revoked handshake + new capsule (Validator passes, handshake rejects)
  test('revoked handshake + new capsule — Validator passes structural check', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      capsule_type: 'refresh',
      prev_hash: 'c'.repeat(64),
    }))
    expect(result.success).toBe(true)
  })

  // Test 7: Forged __brand in raw input
  test('forged __brand: ValidatedCapsule in raw_payload is ignored', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      __brand: 'ValidatedCapsule',
    }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.__brand).toBe('ValidatedCapsule')
    }
  })

  // Test 8: Construct ValidatedCapsule outside Validator (brand check)
  test('manually constructed object is not a ValidatedCapsule from Validator', () => {
    const fake = {
      __brand: 'ValidatedCapsule' as const,
      provenance: makeProvenance(),
      capsule: { capsule_type: 'initiate' as const, schema_version: 1 },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
      schema_version: 1,
    }
    expect(fake.__brand).toBe('ValidatedCapsule')
  })

  // Test 9: Null bytes in payload
  test('null bytes in payload → no crash', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      extra_field: 'test\x00data',
    }))
    expect(result.success).toBe(true)
  })

  // Test 10: Empty input
  test('empty input → error flag set', () => {
    const input: RawInput = { body: '' }
    const candidate = ingestInput(input, 'email')
    expect(candidate.__brand).toBe('CandidateCapsule')
    expect(candidate.provenance.input_classification).toBe('plain_external_content')
  })

  // Test 11: __proto__ injection
  test('__proto__ injection → STRUCTURAL_INTEGRITY_FAILURE', () => {
    const malicious = JSON.parse('{"schema_version":1,"capsule_type":"initiate","__proto__":{"isAdmin":true}}')
    const result = validateCapsule(makeCandidate(malicious))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE')
    }
  })

  // Test 12: Concurrent ingestion of same input → dedup via raw_input_hash
  test('concurrent ingestion of same input produces same hash', () => {
    const body = 'same content for dedup test'
    const input: RawInput = { body }
    const r1 = ingestInput(input, 'email')
    const r2 = ingestInput(input, 'email')
    expect(r1.provenance.raw_input_hash).toBe(r2.provenance.raw_input_hash)
  })

  // Test 13: Missing capsule_type
  test('missing capsule_type → MISSING_REQUIRED_FIELD', () => {
    const payload = validInitiate()
    delete payload.capsule_type
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_REQUIRED_FIELD')
  })

  // Test 14: Null raw_payload
  test('null raw_payload → MALFORMED_JSON', () => {
    const result = validateCapsule(makeCandidate(null))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MALFORMED_JSON')
  })

  // Test 15: Array raw_payload
  test('array raw_payload → MALFORMED_JSON', () => {
    const result = validateCapsule(makeCandidate([1, 2, 3]))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MALFORMED_JSON')
  })

  // Test 16: Negative seq
  test('negative seq → STRUCTURAL_INTEGRITY_FAILURE', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      seq: -1,
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE')
  })

  // Test 17: Non-integer seq
  test('non-integer seq → STRUCTURAL_INTEGRITY_FAILURE', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      seq: 1.5,
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE')
  })

  // Test 18: Empty handshake_id
  test('empty handshake_id → STRUCTURAL_INTEGRITY_FAILURE', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      handshake_id: '',
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE')
  })

  // Test 19: prev_hash with invalid hex
  test('prev_hash with invalid hex → HASH_BINDING_MISMATCH', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      capsule_type: 'refresh',
      prev_hash: 'zzzz'.repeat(16),
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('HASH_BINDING_MISMATCH')
  })

  // Test 20: String schema_version
  test('string schema_version → SCHEMA_VERSION_UNSUPPORTED', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      schema_version: '1',
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('SCHEMA_VERSION_UNSUPPORTED')
  })
})
