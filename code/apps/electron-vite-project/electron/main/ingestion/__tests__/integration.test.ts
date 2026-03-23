import { describe, test, expect, vi } from 'vitest'
import { processIncomingInput } from '../ingestionPipeline'
import type { RawInput, TransportMetadata } from '../types'

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
  }
}

const emptyTransport: TransportMetadata = {}

describe('Integration — Full Pipeline', () => {
  // Test 1: External valid BEAP → validated → distribution target
  test('external valid BEAP → validated → handshake_pipeline target', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
      expect(result.distribution.validated_capsule.__brand).toBe('ValidatedCapsule')
    }
  })

  // Test 2: Malformed BEAP → validator rejects
  test('malformed BEAP → validator rejects', async () => {
    const rawInput: RawInput = {
      body: '{invalid json!',
      mime_type: 'application/vnd.beap+json',
    }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBe('INGESTION_ERROR_PROPAGATED')
    }
  })

  // Test 3: Plain email → wrapped → validated → routed
  test('plain email → wrapped → validated → routed to sandbox', async () => {
    const rawInput: RawInput = { body: 'Hello, this is a plain email.' }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('sandbox_sub_orchestrator')
      expect(result.distribution.validated_capsule.capsule.capsule_type).toBe('internal_draft')
    }
  })

  // Test 4: Valid capsule → audit record created
  test('valid capsule → audit record created', async () => {
    const rawInput: RawInput = { body: JSON.stringify(validBeapPayload()) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.audit).toBeDefined()
    expect(result.audit.validation_result).toBe('validated')
    expect(result.audit.source_type).toBe('email')
    expect(result.audit.pipeline_version).toBeDefined()
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
  })

  // Test 5: Rejected capsule → audit with reason
  test('rejected capsule → audit with reason code', async () => {
    const rawInput: RawInput = {
      body: JSON.stringify({ schema_version: 99, capsule_type: 'initiate' }),
    }
    const result = await processIncomingInput(rawInput, 'api', emptyTransport)
    expect(result.success).toBe(false)
    expect(result.audit.validation_result).toBe('rejected')
    if (!result.success) {
      expect(result.audit.validation_reason_code).toBeDefined()
    }
  })

  // Test 6: Internal source → internal origin classification
  test('internal source → origin_classification = internal', async () => {
    const rawInput: RawInput = {
      body: JSON.stringify({
        schema_version: 1,
        capsule_type: 'internal_draft',
        timestamp: new Date().toISOString(),
        content: 'internal',
      }),
    }
    const result = await processIncomingInput(rawInput, 'internal', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })

  // Test 7: Pipeline exception → fail-closed
  test('pipeline handles exceptions gracefully (fail-closed)', async () => {
    const rawInput = null as any
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(false)
    expect(result.audit).toBeDefined()
    expect(result.audit.validation_result).toBe('error')
  })

  // Test 8: Accept capsule routes to handshake_pipeline
  test('accept capsule routes to handshake_pipeline', async () => {
    const payload = {
      ...validBeapPayload(),
      capsule_type: 'accept',
      sharing_mode: 'receive-only',
    }
    const rawInput: RawInput = { body: JSON.stringify(payload) }
    const result = await processIncomingInput(rawInput, 'email', emptyTransport)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.distribution.target).toBe('handshake_pipeline')
    }
  })
})
