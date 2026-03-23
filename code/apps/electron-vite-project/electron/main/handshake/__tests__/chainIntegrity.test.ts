import { describe, test, expect } from 'vitest'
import { verifyChainIntegrity } from '../steps/chainIntegrity'
import { ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildActiveHandshakeRecord } from './helpers'

describe('Chain Integrity', () => {
  test('handshake-initiate must have seq=0', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', seq: 0, prev_hash: undefined }) })
    expect(verifyChainIntegrity.execute(ctx).passed).toBe(true)
  })

  test('handshake-initiate with seq!=0 → INVALID_CHAIN', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', seq: 1, prev_hash: undefined }) })
    const r = verifyChainIntegrity.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CHAIN)
  })

  test('handshake-accept must have seq=0 (independent of initiator)', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', seq: 0, prev_hash: undefined }) })
    expect(verifyChainIntegrity.execute(ctx).passed).toBe(true)
  })

  test('first capsule (seq 0) with prev_hash present → INVALID_CHAIN', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', seq: 0, prev_hash: 'some-hash' }) })
    const r = verifyChainIntegrity.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CHAIN)
  })

  test('correct chain for refresh → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', seq: 1, prev_hash: 'capsule-hash-accept', sender_wrdesk_user_id: 'sender-user-001' }),
      handshakeRecord: buildActiveHandshakeRecord({ last_seq_received: 0, last_capsule_hash_received: 'capsule-hash-accept' }),
    })
    expect(verifyChainIntegrity.execute(ctx).passed).toBe(true)
  })

  test('wrong prev_hash → INVALID_CHAIN', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', seq: 1, prev_hash: 'wrong-hash', sender_wrdesk_user_id: 'sender-user-001' }),
      handshakeRecord: buildActiveHandshakeRecord({ last_seq_received: 0, last_capsule_hash_received: 'correct-hash' }),
    })
    const r = verifyChainIntegrity.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CHAIN)
  })

  test('replayed seq → SEQ_REPLAY', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', seq: 0, prev_hash: 'h', sender_wrdesk_user_id: 'sender-user-001' }),
      handshakeRecord: buildActiveHandshakeRecord({ last_seq_received: 1, last_capsule_hash_received: 'h' }),
    })
    const r = verifyChainIntegrity.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SEQ_REPLAY)
  })

  test('seq gap → INVALID_CHAIN', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', seq: 3, prev_hash: 'h', sender_wrdesk_user_id: 'sender-user-001' }),
      handshakeRecord: buildActiveHandshakeRecord({ last_seq_received: 0, last_capsule_hash_received: 'h' }),
    })
    const r = verifyChainIntegrity.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CHAIN)
  })
})
