import { describe, test, expect } from 'vitest'
import { routeValidatedCapsule } from '../distributionGate'
import type { ValidatedCapsule, ValidatedCapsulePayload, ProvenanceMetadata } from '../types'

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

function makeValidated(
  capsule_type: string,
  origin: 'external' | 'internal' = 'external',
): ValidatedCapsule {
  return {
    __brand: 'ValidatedCapsule',
    provenance: makeProvenance({ origin_classification: origin }),
    capsule: {
      capsule_type: capsule_type as any,
      schema_version: 1,
    },
    validated_at: new Date().toISOString(),
    validator_version: '1.0.0',
    schema_version: 1,
  }
}

describe('Distribution Gate', () => {
  // Test 1: initiate → handshake_pipeline
  test('initiate → handshake_pipeline', () => {
    const decision = routeValidatedCapsule(makeValidated('initiate'))
    expect(decision.target).toBe('handshake_pipeline')
  })

  // Test 2: accept → handshake_pipeline
  test('accept → handshake_pipeline', () => {
    const decision = routeValidatedCapsule(makeValidated('accept'))
    expect(decision.target).toBe('handshake_pipeline')
  })

  // Test 3: refresh → handshake_pipeline
  test('refresh → handshake_pipeline', () => {
    const decision = routeValidatedCapsule(makeValidated('refresh'))
    expect(decision.target).toBe('handshake_pipeline')
  })

  // Test 4: revoke → handshake_pipeline
  test('revoke → handshake_pipeline', () => {
    const decision = routeValidatedCapsule(makeValidated('revoke'))
    expect(decision.target).toBe('handshake_pipeline')
  })

  // Test 5: External internal_draft → sandbox_sub_orchestrator
  test('external internal_draft → sandbox_sub_orchestrator', () => {
    const decision = routeValidatedCapsule(makeValidated('internal_draft', 'external'))
    expect(decision.target).toBe('sandbox_sub_orchestrator')
  })

  // Test 6: Internal internal_draft → handshake_pipeline
  test('internal internal_draft → handshake_pipeline', () => {
    const decision = routeValidatedCapsule(makeValidated('internal_draft', 'internal'))
    expect(decision.target).toBe('handshake_pipeline')
  })
})
