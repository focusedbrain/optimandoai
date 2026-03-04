/**
 * Tests for Gate 2 — Canonical Rebuild
 *
 * Verifies allowlist enforcement, denied field rejection, proof validation,
 * sanitization, size limits, and correct canonical output construction.
 */

import { describe, it, expect } from 'vitest'
import { canonicalRebuild } from '../canonicalRebuild'

function buildValidCapsule(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: 2,
    capsule_type: 'initiate',
    handshake_id: 'hs-aaaabbbb-cccc-dddd-eeee-ffffffffffff',
    relationship_id: 'rel-aaaabbbb-cccc-dddd-eeee-ffffffffffff',
    sender_id: 'user-001',
    sender_wrdesk_user_id: 'user-001',
    sender_email: 'alice@example.com',
    receiver_id: 'user-002',
    receiver_email: 'bob@example.com',
    capsule_hash: 'a'.repeat(64),
    context_hash: 'b'.repeat(64),
    nonce: 'c'.repeat(64),
    timestamp: '2026-01-15T10:30:00.000Z',
    seq: 0,
    external_processing: 'none',
    reciprocal_allowed: false,
    wrdesk_policy_hash: 'policy-hash-abc',
    wrdesk_policy_version: '1.0.0',
    senderIdentity: {
      email: 'alice@example.com',
      iss: 'https://auth.wrdesk.com',
      sub: 'sub-alice-001',
      email_verified: true,
      wrdesk_user_id: 'user-001',
    },
    tierSignals: {
      plan: 'pro',
      hardwareAttestation: null,
      dnsVerification: null,
      wrStampStatus: null,
    },
    ...overrides,
  }
}

describe('canonicalRebuild', () => {
  // Test 1: Unknown field is silently ignored, capsule accepted
  it('should accept a valid capsule and ignore unknown fields', () => {
    const raw = buildValidCapsule({ evil: 'payload', extra_field: 42 })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.capsule as any).evil).toBeUndefined()
      expect((result.capsule as any).extra_field).toBeUndefined()
      expect(result.capsule.capsule_type).toBe('initiate')
      expect(result.capsule.handshake_id).toBe('hs-aaaabbbb-cccc-dddd-eeee-ffffffffffff')
    }
  })

  // Test 2: malformed context_blocks → REJECT (structural validation)
  it('should reject capsule with malformed context_blocks', () => {
    const raw = buildValidCapsule({
      context_blocks: [{ block_id: 'blk_abc', payload: 'secret data' }],
    })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toContain('context_blocks')
    }
  })

  // Test 2b: valid context_blocks → ACCEPT
  it('should accept capsule with valid context_blocks', () => {
    const raw = buildValidCapsule({
      context_blocks: [{
        block_id: 'ctx-001',
        block_hash: 'a'.repeat(64),
        type: 'plaintext',
        content: 'Hello Beap',
        scope_id: null,
      }],
      context_commitment: 'b'.repeat(64),
    })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.capsule.context_blocks).toHaveLength(1)
      expect(result.capsule.context_blocks![0].block_id).toBe('ctx-001')
      expect(result.capsule.context_blocks![0].content).toBe('Hello Beap')
    }
  })

  // Test 3: data (denied field) → REJECT
  it('should reject capsule with "data" field (denied field)', () => {
    const raw = buildValidCapsule({ data: 'malicious content' })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toBe('data')
      expect(result.reason).toContain('Denied field')
    }
  })

  // Test 4: Invalid handshake_id format → REJECT
  it('should reject handshake_id with SQL injection attempt', () => {
    const raw = buildValidCapsule({ handshake_id: "hs-'; DROP TABLE" })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toBe('handshake_id')
    }
  })

  // Test 5: Null bytes in sender_id → stripped, then regex check
  it('should strip null bytes from sender_id and validate', () => {
    const raw = buildValidCapsule({ sender_id: 'user\u0000-001' })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.capsule.sender_id).toBe('user-001')
    }
  })

  // Test 6: 100MB capsule → REJECT at size limit
  it('should reject capsule exceeding 64KB size limit', () => {
    const raw = buildValidCapsule({ wrdesk_policy_hash: 'x'.repeat(200_000) })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('byte limit')
    }
  })

  // Test 7: Valid capsule round-trip
  it('should produce a valid canonical capsule from a correct input', () => {
    const raw = buildValidCapsule()
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.capsule.schema_version).toBe(2)
      expect(result.capsule.capsule_type).toBe('initiate')
      expect(result.capsule.sender_id).toBe('user-001')
      expect(result.capsule.senderIdentity.email).toBe('alice@example.com')
      expect(result.capsule.senderIdentity.email_verified).toBe(true)
      expect(result.capsule.tierSignals.plan).toBe('pro')
      expect(result.capsule.reciprocal_allowed).toBe(false)
    }
  })

  // Test 8: All denied fields individually rejected
  it('should reject each denied field', () => {
    const deniedFields = [
      'data', 'payload', 'body', 'content',
      'attachment', 'attachments', 'file', 'files', 'binary',
      'script', 'code', 'html', 'exec', 'command', 'eval',
    ]
    for (const field of deniedFields) {
      const raw = buildValidCapsule({ [field]: 'anything' })
      const result = canonicalRebuild(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.field).toBe(field)
      }
    }
  })

  // Test 9: Valid context_block_proofs accepted
  it('should accept valid context_block_proofs', () => {
    const raw = buildValidCapsule({
      context_block_proofs: [
        { block_id: 'blk_abcdef1234', block_hash: 'b'.repeat(64) },
        { block_id: 'blk_1234567890abcdef', block_hash: 'c'.repeat(64) },
      ],
    })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.capsule.context_block_proofs).toHaveLength(2)
      expect(result.capsule.context_block_proofs![0].block_id).toBe('blk_abcdef1234')
    }
  })

  // Test 10: Invalid context_block_proofs rejected
  it('should reject context_block_proofs with invalid hash format', () => {
    const raw = buildValidCapsule({
      context_block_proofs: [
        { block_id: 'blk_abc', block_hash: 'not-a-valid-hash' },
      ],
    })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toContain('context_block_proofs')
    }
  })

  // Test 11: Missing required fields rejected
  it('should reject capsule missing required fields', () => {
    const raw = { schema_version: 1, capsule_type: 'initiate' }
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Missing required field')
    }
  })

  // Test 12: Accept capsule with sharing_mode
  it('should accept a valid accept capsule with sharing_mode', () => {
    const raw = buildValidCapsule({
      capsule_type: 'accept',
      sharing_mode: 'reciprocal',
    })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.capsule.sharing_mode).toBe('reciprocal')
    }
  })

  // Test 13: Non-object input rejected
  it('should reject non-object input', () => {
    expect(canonicalRebuild(null).ok).toBe(false)
    expect(canonicalRebuild(42).ok).toBe(false)
    expect(canonicalRebuild('string').ok).toBe(false)
    expect(canonicalRebuild([]).ok).toBe(false)
  })

  // Test 14: Invalid email in senderIdentity
  it('should reject invalid email in senderIdentity', () => {
    const raw = buildValidCapsule({
      senderIdentity: {
        email: 'not-an-email',
        iss: 'https://auth.wrdesk.com',
        sub: 'sub-001',
        email_verified: true,
        wrdesk_user_id: 'user-001',
      },
    })
    const result = canonicalRebuild(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toContain('senderIdentity.email')
    }
  })
})
