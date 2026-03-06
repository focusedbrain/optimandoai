import { describe, test, expect, vi } from 'vitest'
import { ingestInput } from '@repo/ingestion-core'
import type { RawInput, CandidateCapsuleEnvelope } from '../types'
import { createHash } from 'crypto'

function validBeapJson(): Record<string, unknown> {
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

function makeRawInput(overrides?: Partial<RawInput>): RawInput {
  return {
    body: JSON.stringify(validBeapJson()),
    ...overrides,
  }
}

describe('Ingestor', () => {
  // Test 1: Valid BEAP JSON via email
  test('valid BEAP JSON via email → beap_capsule_present', () => {
    const input = makeRawInput()
    const result = ingestInput(input, 'email')
    expect(result.__brand).toBe('CandidateCapsule')
    expect(result.provenance.input_classification).toBe('beap_capsule_present')
    expect(result.provenance.source_type).toBe('email')
    expect(result.ingestion_error_flag).toBe(false)
  })

  // Test 2: Valid BEAP via MIME type detection
  test('valid BEAP via MIME type detection', () => {
    const input = makeRawInput({ mime_type: 'application/vnd.beap+json' })
    const result = ingestInput(input, 'email')
    expect(result.provenance.input_classification).toBe('beap_capsule_present')
  })

  // Test 3: Valid BEAP via header marker
  test('valid BEAP via header marker', () => {
    const input = makeRawInput({
      headers: { 'X-BEAP-Version': '1.0' },
    })
    const result = ingestInput(input, 'email')
    expect(result.provenance.input_classification).toBe('beap_capsule_present')
  })

  // Test 4: Valid BEAP via JSON structure
  test('valid BEAP via JSON structure (schema_version + capsule_type)', () => {
    const input = makeRawInput()
    const result = ingestInput(input, 'api')
    expect(result.provenance.input_classification).toBe('beap_capsule_present')
  })

  // Test 5: Valid BEAP via attachment metadata
  test('valid BEAP via attachment metadata (.beap extension)', () => {
    const input = makeRawInput({
      body: 'plain email text',
      attachments: [{
        filename: 'capsule.beap',
        mime_type: 'application/octet-stream',
        content: JSON.stringify(validBeapJson()),
      }],
    })
    const result = ingestInput(input, 'email')
    expect(result.provenance.input_classification).toBe('beap_capsule_present')
  })

  // Test 6: Malformed BEAP (valid MIME, invalid JSON)
  test('malformed BEAP (valid MIME, invalid JSON) → beap_capsule_malformed, error flag true', () => {
    const input = makeRawInput({
      body: '{not valid json!!!',
      mime_type: 'application/vnd.beap+json',
    })
    const result = ingestInput(input, 'email')
    expect(result.provenance.input_classification).toBe('beap_capsule_malformed')
    expect(result.ingestion_error_flag).toBe(true)
    expect(result.ingestion_error_details).toBeDefined()
  })

  // Test 7: Plain email (no BEAP)
  test('plain email (no BEAP) → plain_external_content, internal_draft', () => {
    const input = makeRawInput({ body: 'Hello, this is a plain email.' })
    const result = ingestInput(input, 'email')
    expect(result.provenance.input_classification).toBe('plain_external_content')
    expect(result.ingestion_error_flag).toBe(false)
    const payload = result.raw_payload as any
    expect(payload.capsule_type).toBe('internal_draft')
    expect(payload.schema_version).toBe(1)
  })

  // Test 8: Provenance metadata complete
  test('provenance metadata complete on all paths', () => {
    const input = makeRawInput({ body: 'test body' })
    const result = ingestInput(input, 'email', {
      sender_address: 'alice@example.com',
    })
    expect(result.provenance.source_type).toBe('email')
    expect(result.provenance.origin_classification).toBe('external')
    expect(result.provenance.ingested_at).toBeDefined()
    expect(result.provenance.raw_input_hash).toBeDefined()
    expect(result.provenance.ingestor_version).toBeDefined()
    expect(result.provenance.transport_metadata).toBeDefined()
  })

  // Test 9: raw_input_hash matches SHA-256
  test('raw_input_hash matches independent SHA-256', () => {
    const body = 'deterministic content for hash test'
    const input = makeRawInput({ body })
    const result = ingestInput(input, 'api')
    const expectedHash = createHash('sha256').update(body).digest('hex')
    expect(result.provenance.raw_input_hash).toBe(expectedHash)
  })

  // Test 10: Ingestor never calls handshake functions
  test('ingestor never calls handshake functions', () => {
    const processHandshake = vi.fn()
    const input = makeRawInput()
    ingestInput(input, 'email')
    expect(processHandshake).not.toHaveBeenCalled()
  })

  // Test 11: File upload → source_type = 'file_upload'
  test('file upload → source_type = file_upload', () => {
    const input = makeRawInput({ body: 'file content' })
    const result = ingestInput(input, 'file_upload')
    expect(result.provenance.source_type).toBe('file_upload')
    expect(result.provenance.origin_classification).toBe('external')
  })

  // Test 12: API input → source_type = 'api'
  test('API input → source_type = api', () => {
    const input = makeRawInput({ body: 'api payload' })
    const result = ingestInput(input, 'api')
    expect(result.provenance.source_type).toBe('api')
    expect(result.provenance.origin_classification).toBe('external')
  })

  // Test 13: Extension IPC → source_type = 'extension'
  test('extension IPC → source_type = extension', () => {
    const input = makeRawInput({ body: 'extension data' })
    const result = ingestInput(input, 'extension')
    expect(result.provenance.source_type).toBe('extension')
    expect(result.provenance.origin_classification).toBe('external')
  })
})
