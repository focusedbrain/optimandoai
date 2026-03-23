import { describe, test, expect } from 'vitest'
import {
  computeContextHash,
  buildCanonicalContextPayload,
  generateNonce,
  verifyContextHash,
  validateTimestamp,
  validateNonce,
  type ContextHashInput,
} from '../contextHash'

function buildTestInput(overrides?: Partial<ContextHashInput>): ContextHashInput {
  return {
    schema_version: 2,
    capsule_type: 'initiate',
    handshake_id: 'hs-abc123',
    relationship_id: 'rel:def456',
    sender_id: 'sender-user-001',
    sender_wrdesk_user_id: 'sender-user-001',
    sender_email: 'sender@example.com',
    receiver_id: 'receiver-user-002',
    receiver_email: 'receiver@example.com',
    timestamp: '2026-03-04T12:00:00.000Z',
    nonce: 'a'.repeat(64),
    seq: 0,
    wrdesk_policy_hash: 'b'.repeat(64),
    wrdesk_policy_version: '1.0',
    ...overrides,
  }
}

describe('Context Hash', () => {
  describe('computeContextHash', () => {
    test('produces a 64-char lowercase hex string', () => {
      const hash = computeContextHash(buildTestInput())
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    test('is deterministic — same input produces same hash', () => {
      const input = buildTestInput()
      expect(computeContextHash(input)).toBe(computeContextHash(input))
    })

    test('changes when sender_email is modified', () => {
      const h1 = computeContextHash(buildTestInput({ sender_email: 'alice@example.com' }))
      const h2 = computeContextHash(buildTestInput({ sender_email: 'bob@example.com' }))
      expect(h1).not.toBe(h2)
    })

    test('changes when receiver_email is modified', () => {
      const h1 = computeContextHash(buildTestInput({ receiver_email: 'alice@example.com' }))
      const h2 = computeContextHash(buildTestInput({ receiver_email: 'bob@example.com' }))
      expect(h1).not.toBe(h2)
    })

    test('changes when nonce is modified', () => {
      const h1 = computeContextHash(buildTestInput({ nonce: 'a'.repeat(64) }))
      const h2 = computeContextHash(buildTestInput({ nonce: 'b'.repeat(64) }))
      expect(h1).not.toBe(h2)
    })

    test('changes when timestamp is modified', () => {
      const h1 = computeContextHash(buildTestInput({ timestamp: '2026-03-04T12:00:00.000Z' }))
      const h2 = computeContextHash(buildTestInput({ timestamp: '2026-03-04T12:01:00.000Z' }))
      expect(h1).not.toBe(h2)
    })

    test('changes when seq is modified', () => {
      const h1 = computeContextHash(buildTestInput({ seq: 0 }))
      const h2 = computeContextHash(buildTestInput({ seq: 1 }))
      expect(h1).not.toBe(h2)
    })

    test('changes when handshake_id is modified', () => {
      const h1 = computeContextHash(buildTestInput({ handshake_id: 'hs-aaa' }))
      const h2 = computeContextHash(buildTestInput({ handshake_id: 'hs-bbb' }))
      expect(h1).not.toBe(h2)
    })

    test('includes sharing_mode for accept capsules', () => {
      const h1 = computeContextHash(buildTestInput({ capsule_type: 'accept', sharing_mode: 'reciprocal' }))
      const h2 = computeContextHash(buildTestInput({ capsule_type: 'accept', sharing_mode: 'receive-only' }))
      expect(h1).not.toBe(h2)
    })

    test('includes prev_hash for refresh capsules', () => {
      const h1 = computeContextHash(buildTestInput({ capsule_type: 'refresh', prev_hash: 'a'.repeat(64) }))
      const h2 = computeContextHash(buildTestInput({ capsule_type: 'refresh', prev_hash: 'b'.repeat(64) }))
      expect(h1).not.toBe(h2)
    })
  })

  describe('buildCanonicalContextPayload', () => {
    test('keys are sorted alphabetically', () => {
      const payload = buildCanonicalContextPayload(buildTestInput())
      const keys = Object.keys(payload)
      const sorted = [...keys].sort()
      expect(keys).toEqual(sorted)
    })

    test('omits undefined optional fields', () => {
      const payload = buildCanonicalContextPayload(buildTestInput({ sharing_mode: undefined, prev_hash: undefined }))
      expect('sharing_mode' in payload).toBe(false)
      expect('prev_hash' in payload).toBe(false)
    })
  })

  describe('generateNonce', () => {
    test('produces a 64-char lowercase hex string', () => {
      const nonce = generateNonce()
      expect(nonce).toMatch(/^[a-f0-9]{64}$/)
    })

    test('produces unique values', () => {
      const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()))
      expect(nonces.size).toBe(100)
    })
  })

  describe('verifyContextHash', () => {
    test('valid hash passes verification', () => {
      const input = buildTestInput()
      const hash = computeContextHash(input)
      const result = verifyContextHash(input, hash)
      expect(result.valid).toBe(true)
    })

    test('tampered sender_email fails verification', () => {
      const input = buildTestInput()
      const hash = computeContextHash(input)
      const tampered = buildTestInput({ sender_email: 'attacker@evil.com' })
      const result = verifyContextHash(tampered, hash)
      expect(result.valid).toBe(false)
    })

    test('wrong hash format fails', () => {
      const input = buildTestInput()
      const result = verifyContextHash(input, 'not-a-valid-hash')
      expect(result.valid).toBe(false)
    })

    test('empty string fails', () => {
      const input = buildTestInput()
      const result = verifyContextHash(input, '')
      expect(result.valid).toBe(false)
    })
  })

  describe('validateTimestamp', () => {
    test('current timestamp passes', () => {
      const now = new Date()
      const result = validateTimestamp(now.toISOString(), now)
      expect(result.valid).toBe(true)
    })

    test('timestamp within tolerance passes', () => {
      const now = new Date()
      const fourMinAgo = new Date(now.getTime() - 4 * 60 * 1000)
      const result = validateTimestamp(fourMinAgo.toISOString(), now)
      expect(result.valid).toBe(true)
    })

    test('timestamp beyond tolerance fails', () => {
      const now = new Date()
      const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000)
      const result = validateTimestamp(tenMinAgo.toISOString(), now)
      expect(result.valid).toBe(false)
    })

    test('invalid timestamp string fails', () => {
      const result = validateTimestamp('not-a-date')
      expect(result.valid).toBe(false)
    })
  })

  describe('validateNonce', () => {
    test('valid 64-char hex passes', () => {
      expect(validateNonce('a'.repeat(64)).valid).toBe(true)
    })

    test('short string fails', () => {
      expect(validateNonce('abc').valid).toBe(false)
    })

    test('uppercase hex fails', () => {
      expect(validateNonce('A'.repeat(64)).valid).toBe(false)
    })
  })
})
