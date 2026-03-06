import { describe, test, expect, vi } from 'vitest'
import { validateCapsule, ingestInput } from '@repo/ingestion-core'
import { processIncomingInput } from '../ingestionPipeline'
import type {
  CandidateCapsuleEnvelope,
  ProvenanceMetadata,
  RawInput,
  TransportMetadata,
} from '../types'
import { INGESTION_CONSTANTS } from '../types'

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

describe('Hardening — Runtime Non-Bypassability', () => {
  // Test 1: No registered handler calls handshake directly
  test('handshake IPC handler does not import processHandshakeCapsule', async () => {
    const handshakeIpc = await import('../../handshake/ipc')
    const methods = Object.keys(handshakeIpc)
    expect(methods).toContain('handleHandshakeRPC')
    expect(methods).toContain('registerHandshakeRoutes')
    expect(methods).not.toContain('processHandshakeCapsule')
  })

  // Test 2: processHandshakeCapsule with fabricated input → rejection
  test('processHandshakeCapsule rejects fabricated input at runtime', async () => {
    const { processHandshakeCapsule } = await import('../../handshake/enforcement')
    const { buildDefaultReceiverPolicy } = await import('../../handshake/types')

    const fakeInput = {
      __brand: 'NotValidated',
      provenance: makeProvenance(),
      capsule: { capsule_type: 'initiate', schema_version: 1 },
    } as any

    const mockDb = {
      prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }),
      transaction: (fn: any) => fn,
    }

    const result = processHandshakeCapsule(
      mockDb,
      fakeInput,
      buildDefaultReceiverPolicy(),
      {
        wrdesk_user_id: 'u-1',
        email: 'test@test.com',
        iss: 'test',
        sub: 'test',
        email_verified: true as const,
        plan: 'free' as const,
        currentHardwareAttestation: null,
        currentDnsVerification: null,
        currentWrStampStatus: null,
        session_expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  // Test 3: CI grep check — no forbidden casts outside validator.ts
  test('no "as ValidatedCapsule" casts in production code outside validator.ts', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const ingestionDir = path.resolve(__dirname, '..')
    const files = fs.readdirSync(ingestionDir).filter(
      (f: string) => f.endsWith('.ts') && f !== 'validator.ts' && !f.endsWith('.test.ts'),
    )

    for (const file of files) {
      const content = fs.readFileSync(path.join(ingestionDir, file), 'utf-8')
      const hasForbiddenCast = content.includes('as ValidatedCapsule')
      expect(
        hasForbiddenCast,
        `File ${file} contains forbidden "as ValidatedCapsule" cast`,
      ).toBe(false)
    }
  })
})

describe('Hardening — DoS / Parser Protections', () => {
  // Test 9: Oversized input rejected before parsing
  test('oversized raw input rejected before parsing', () => {
    const hugeBody = 'x'.repeat(INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES + 1)
    const input: RawInput = { body: hugeBody }
    const candidate = ingestInput(input, 'email')
    expect(candidate.ingestion_error_flag).toBe(true)
    expect(candidate.ingestion_error_details).toContain('exceeds limit')
  })

  // Test 10: Deeply nested JSON rejected safely
  test('deeply nested JSON rejected by validator', () => {
    let nested: any = { value: 'leaf' }
    for (let i = 0; i < 60; i++) {
      nested = { child: nested }
    }
    nested.schema_version = 1
    nested.capsule_type = 'initiate'
    const result = validateCapsule(makeCandidate(nested))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE')
      expect(result.details).toContain('depth')
    }
  })

  // Test 11: Prototype pollution has no effect on global prototypes
  test('prototype pollution attempt does not affect Object.prototype', () => {
    const before = Object.keys(Object.prototype)

    const payload = JSON.parse('{"schema_version":1,"capsule_type":"initiate","__proto__":{"polluted":true}}')
    validateCapsule(makeCandidate(payload))

    const after = Object.keys(Object.prototype)
    expect(after).toEqual(before)
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  // Test 12: High-rate duplicates do not create unbounded growth (dedup via hash)
  test('same input produces same raw_input_hash (dedup key)', () => {
    const body = 'duplicate input for dedup test'
    const input: RawInput = { body }
    const hashes = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const candidate = ingestInput(input, 'email')
      hashes.add(candidate.provenance.raw_input_hash)
    }
    expect(hashes.size).toBe(1)
  })

  // Test 13: Wall-clock budget — fast inputs complete within budget
  test('normal input completes within pipeline timeout', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validInitiate()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.audit.processing_duration_ms).toBeLessThan(INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS)
  })

  // Additional: Field count limit
  test('object with too many fields rejected', () => {
    const payload: Record<string, unknown> = {
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: 'hs-001',
      sender_id: 'user-1',
      capsule_hash: 'a'.repeat(64),
      timestamp: new Date().toISOString(),
      wrdesk_policy_hash: 'b'.repeat(64),
      seq: 1,
    }
    for (let i = 0; i < 600; i++) {
      payload[`field_${i}`] = `value_${i}`
    }
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('STRUCTURAL_INTEGRITY_FAILURE')
    }
  })

  // prototype key in nested object stripped by sanitizer
  test('prototype key in nested object stripped from ValidatedCapsule', () => {
    const payload: Record<string, unknown> = {
      ...validInitiate(),
      nested: { constructor: 'evil', normal_key: 'safe' },
    }
    const result = validateCapsule(makeCandidate(payload))
    expect(result.success).toBe(true)
    if (result.success) {
      const nested = (result.validated.capsule as any).nested
      expect(nested.constructor).toBeUndefined()
      expect(nested.normal_key).toBe('safe')
    }
  })

  // Empty body handled gracefully
  test('empty body does not crash', () => {
    const input: RawInput = { body: '' }
    const candidate = ingestInput(input, 'email')
    expect(candidate.__brand).toBe('CandidateCapsule')
  })

  // Null bytes in raw input
  test('null bytes in raw input handled', () => {
    const input: RawInput = { body: 'test\x00data\x00more' }
    const candidate = ingestInput(input, 'email')
    expect(candidate.__brand).toBe('CandidateCapsule')
  })
})
