import { describe, test, expect } from 'vitest'
import { verifyHandshakeCapsule, type HandshakeCapsuleFields } from '../handshakeVerification'
import { computeContextHash, generateNonce, type ContextHashInput } from '../contextHash'
import { computeCapsuleHash, type CapsuleHashInput } from '../capsuleHash'

function buildValidCapsule(overrides?: Partial<HandshakeCapsuleFields>): HandshakeCapsuleFields {
  const base: Omit<HandshakeCapsuleFields, 'capsule_hash' | 'context_hash'> = {
    schema_version: 2,
    capsule_type: 'initiate',
    handshake_id: 'hs-abc123def456',
    relationship_id: 'rel:aabbccdd',
    sender_id: 'sender-user-001',
    sender_wrdesk_user_id: 'sender-user-001',
    sender_email: 'sender@example.com',
    receiver_id: 'receiver-user-002',
    receiver_email: 'receiver@example.com',
    timestamp: new Date().toISOString(),
    nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    seq: 0,
    wrdesk_policy_hash: 'f'.repeat(64),
    wrdesk_policy_version: '1.0',
    context_commitment: null,
    receiverIdentity: null,
    ...overrides,
  }

  const capsuleHashInput: CapsuleHashInput = {
    capsule_type: base.capsule_type,
    handshake_id: base.handshake_id,
    relationship_id: base.relationship_id,
    schema_version: base.schema_version,
    sender_wrdesk_user_id: base.sender_wrdesk_user_id,
    receiver_email: base.receiver_email,
    seq: base.seq,
    timestamp: base.timestamp,
    sharing_mode: base.sharing_mode,
    prev_hash: base.prev_hash,
    wrdesk_policy_hash: base.wrdesk_policy_hash,
    wrdesk_policy_version: base.wrdesk_policy_version,
    context_commitment: base.context_commitment,
    senderIdentity_sub: base.capsule_type === 'accept' ? base.senderIdentity?.sub : undefined,
    receiverIdentity_sub: base.capsule_type === 'accept' ? base.receiverIdentity?.sub ?? undefined : undefined,
  }

  const contextHashInput: ContextHashInput = {
    schema_version: base.schema_version,
    capsule_type: base.capsule_type,
    handshake_id: base.handshake_id,
    relationship_id: base.relationship_id,
    sender_id: base.sender_id,
    sender_wrdesk_user_id: base.sender_wrdesk_user_id,
    sender_email: base.sender_email,
    receiver_id: base.receiver_id,
    receiver_email: base.receiver_email,
    timestamp: base.timestamp,
    nonce: base.nonce,
    seq: base.seq,
    wrdesk_policy_hash: base.wrdesk_policy_hash,
    wrdesk_policy_version: base.wrdesk_policy_version,
    sharing_mode: base.sharing_mode,
    prev_hash: base.prev_hash,
  }

  return {
    ...base,
    capsule_hash: overrides?.capsule_hash ?? computeCapsuleHash(capsuleHashInput),
    context_hash: overrides?.context_hash ?? computeContextHash(contextHashInput),
  }
}

describe('Handshake Verification', () => {
  const expectedReceiverEmail = 'receiver@example.com'
  const emptyNonces = new Set<string>()

  test('valid capsule passes all checks', () => {
    const capsule = buildValidCapsule()
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(true)
  })

  test('missing required field fails', () => {
    const capsule = buildValidCapsule()
    ;(capsule as any).nonce = ''
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('required_fields')
  })

  test('invalid nonce format fails', () => {
    const capsule = buildValidCapsule({ nonce: 'short' })
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('nonce_format')
  })

  test('expired timestamp fails', () => {
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const capsule = buildValidCapsule({ timestamp: oldTimestamp })
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('timestamp_freshness')
  })

  test('replayed nonce fails', () => {
    const capsule = buildValidCapsule()
    const seenNonces = new Set([capsule.nonce])
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, seenNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('nonce_replay')
  })

  test('wrong receiver_email fails', () => {
    const capsule = buildValidCapsule()
    const result = verifyHandshakeCapsule(capsule, 'wrong@example.com', emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('receiver_binding')
  })

  test('tampered context_hash fails', () => {
    const capsule = buildValidCapsule({ context_hash: '0'.repeat(64) })
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('context_hash')
  })

  test('tampered capsule_hash fails', () => {
    const capsule = buildValidCapsule({ capsule_hash: '0'.repeat(64) })
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('capsule_hash')
  })

  test('tampered sender_email detected via context_hash', () => {
    const capsule = buildValidCapsule()
    ;(capsule as any).sender_email = 'attacker@evil.com'
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('context_hash')
  })

  test('tampered receiver_id detected via context_hash', () => {
    const capsule = buildValidCapsule()
    ;(capsule as any).receiver_id = 'hijacked-user'
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(false)
    if (!result.verified) expect(result.step).toBe('context_hash')
  })

  test('accept capsule with sharing_mode verifies correctly', () => {
    const capsule = buildValidCapsule({ capsule_type: 'accept', sharing_mode: 'reciprocal' })
    const result = verifyHandshakeCapsule(capsule, expectedReceiverEmail, emptyNonces)
    expect(result.verified).toBe(true)
  })
})
