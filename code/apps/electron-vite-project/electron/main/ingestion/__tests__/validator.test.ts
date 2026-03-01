import { describe, test, expect } from 'vitest'
import { validateCapsule } from '../validator'
import type { CandidateCapsuleEnvelope, ProvenanceMetadata } from '../types'

function makeProvenance(overrides?: Partial<ProvenanceMetadata>): ProvenanceMetadata {
  return {
    source_type: 'email',
    origin_classification: 'external',
    ingested_at: new Date().toISOString(),
    transport_metadata: {},
    input_classification: 'beap_capsule_present',
    raw_input_hash: 'a'.repeat(64),
    ingestor_version: '1.0.0',
    ...overrides,
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

function validAccept(): Record<string, unknown> {
  return {
    ...validInitiate(),
    capsule_type: 'accept',
    sharing_mode: 'receive-only',
  }
}

function validRefresh(): Record<string, unknown> {
  return {
    ...validInitiate(),
    capsule_type: 'refresh',
    prev_hash: 'c'.repeat(64),
  }
}

function validRevoke(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'revoke',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
  }
}

function validInternalDraft(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'internal_draft',
    timestamp: new Date().toISOString(),
    content: 'Hello world',
  }
}

describe('Validator', () => {
  // Test 1: Missing schema_version
  test('missing schema_version → MISSING_REQUIRED_FIELD', () => {
    const payload = validInitiate()
    delete payload.schema_version
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_REQUIRED_FIELD')
  })

  // Test 2: schema_version = 0
  test('schema_version = 0 → SCHEMA_VERSION_UNSUPPORTED', () => {
    const result = validateCapsule(makeCandidate({ ...validInitiate(), schema_version: 0 }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('SCHEMA_VERSION_UNSUPPORTED')
  })

  // Test 3: schema_version = 2
  test('schema_version = 2 → SCHEMA_VERSION_UNSUPPORTED', () => {
    const result = validateCapsule(makeCandidate({ ...validInitiate(), schema_version: 2 }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('SCHEMA_VERSION_UNSUPPORTED')
  })

  // Test 4: Unknown capsule_type
  test('unknown capsule_type → INVALID_ENUM_VALUE', () => {
    const result = validateCapsule(makeCandidate({ ...validInitiate(), capsule_type: 'unknown' }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_ENUM_VALUE')
  })

  // Test 5: Missing handshake_id on initiate
  test('missing handshake_id on initiate → MISSING_REQUIRED_FIELD', () => {
    const payload = validInitiate()
    delete payload.handshake_id
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_REQUIRED_FIELD')
  })

  // Test 6: Missing handshake_id on accept
  test('missing handshake_id on accept → MISSING_REQUIRED_FIELD', () => {
    const payload = validAccept()
    delete payload.handshake_id
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_REQUIRED_FIELD')
  })

  // Test 7: Missing sharing_mode on accept
  test('missing sharing_mode on accept → MISSING_REQUIRED_FIELD', () => {
    const payload = validAccept()
    delete payload.sharing_mode
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_REQUIRED_FIELD')
  })

  // Test 8: Missing sender_id on refresh
  test('missing sender_id on refresh → MISSING_REQUIRED_FIELD', () => {
    const payload = validRefresh()
    delete payload.sender_id
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_REQUIRED_FIELD')
  })

  // Test 9: Malformed hash (not hex)
  test('malformed capsule_hash (not hex) → HASH_BINDING_MISMATCH', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      capsule_hash: 'g'.repeat(64),
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('HASH_BINDING_MISMATCH')
  })

  // Test 10: Hash wrong length
  test('capsule_hash wrong length → HASH_BINDING_MISMATCH', () => {
    const result = validateCapsule(makeCandidate({
      ...validInitiate(),
      capsule_hash: 'a'.repeat(32),
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('HASH_BINDING_MISMATCH')
  })

  // Test 11: Missing signature field (capsule_hash on non-draft)
  test('missing cryptographic field on non-draft → CRYPTOGRAPHIC_FIELD_MISSING', () => {
    const payload = validInitiate()
    delete payload.capsule_hash
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(['MISSING_REQUIRED_FIELD', 'CRYPTOGRAPHIC_FIELD_MISSING']).toContain(result.reason)
    }
  })

  // Test 12: Payload exceeds size limit
  test('payload exceeds size limit → PAYLOAD_SIZE_EXCEEDED', () => {
    const payload = { ...validInitiate(), huge_field: 'x'.repeat(11 * 1024 * 1024) }
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('PAYLOAD_SIZE_EXCEEDED')
  })

  // Test 13: ingestion_error_flag = true
  test('ingestion_error_flag = true → INGESTION_ERROR_PROPAGATED', () => {
    const result = validateCapsule(makeCandidate(null, {
      ingestion_error_flag: true,
      ingestion_error_details: 'Bad JSON',
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INGESTION_ERROR_PROPAGATED')
  })

  // Test 14: Valid initiate
  test('valid initiate → returns ValidatedCapsule', () => {
    const result = validateCapsule(makeCandidate(validInitiate()))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.__brand).toBe('ValidatedCapsule')
      expect(result.validated.capsule.capsule_type).toBe('initiate')
    }
  })

  // Test 15: Valid accept
  test('valid accept → returns ValidatedCapsule', () => {
    const result = validateCapsule(makeCandidate(validAccept()))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.capsule.capsule_type).toBe('accept')
    }
  })

  // Test 16: Valid refresh
  test('valid refresh → returns ValidatedCapsule', () => {
    const result = validateCapsule(makeCandidate(validRefresh()))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.capsule.capsule_type).toBe('refresh')
    }
  })

  // Test 17: Valid revoke
  test('valid revoke → returns ValidatedCapsule', () => {
    const result = validateCapsule(makeCandidate(validRevoke()))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.capsule.capsule_type).toBe('revoke')
    }
  })

  // Test 18: Valid internal_draft
  test('valid internal_draft → returns ValidatedCapsule', () => {
    const result = validateCapsule(makeCandidate(validInternalDraft()))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.capsule.capsule_type).toBe('internal_draft')
    }
  })

  // Test 19: Only Validator can produce ValidatedCapsule (structural check)
  test('ValidatedCapsule has correct structure', () => {
    const result = validateCapsule(makeCandidate(validInitiate()))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.validated.__brand).toBe('ValidatedCapsule')
      expect(result.validated.validated_at).toBeDefined()
      expect(result.validated.validator_version).toBeDefined()
      expect(result.validated.schema_version).toBe(1)
      expect(result.validated.provenance).toBeDefined()
    }
  })
})
