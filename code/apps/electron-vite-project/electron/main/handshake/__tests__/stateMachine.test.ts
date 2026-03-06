import { describe, test, expect } from 'vitest'
import { checkStateTransition } from '../steps/stateTransition'
import { HandshakeState, ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildHandshakeRecord } from './helpers'

describe('Handshake State Machine', () => {
  test('initiate on new handshake → PENDING_ACCEPT', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate' }), handshakeRecord: null })
    expect(checkStateTransition.execute(ctx)).toEqual({ passed: true })
  })

  test('accept (receive-only) on PENDING_ACCEPT → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'receive-only' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }),
    })
    expect(checkStateTransition.execute(ctx).passed).toBe(true)
  })

  test('accept (reciprocal) on PENDING_ACCEPT → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'reciprocal' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }),
    })
    expect(checkStateTransition.execute(ctx).passed).toBe(true)
  })

  test('refresh on ACTIVE → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', seq: 2, prev_hash: 'capsule-hash-accept' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.ACTIVE, last_seq_received: 1 }),
    })
    expect(checkStateTransition.execute(ctx).passed).toBe(true)
  })

  test('revoke on ACTIVE → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-revoke', seq: 2, prev_hash: 'capsule-hash-accept' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.ACTIVE, last_seq_received: 1 }),
    })
    expect(checkStateTransition.execute(ctx).passed).toBe(true)
  })

  test('revoke on PENDING_ACCEPT → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-revoke', seq: 1, prev_hash: 'capsule-hash-init' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }),
    })
    expect(checkStateTransition.execute(ctx).passed).toBe(true)
  })

  test('any capsule on REVOKED → HANDSHAKE_REVOKED', () => {
    for (const capsuleType of ['handshake-initiate', 'handshake-accept', 'handshake-refresh', 'handshake-revoke'] as const) {
      const ctx = buildCtx({
        input: buildVerifiedCapsuleInput({ capsuleType }),
        handshakeRecord: buildHandshakeRecord({ state: HandshakeState.REVOKED }),
      })
      const result = checkStateTransition.execute(ctx)
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe(ReasonCode.HANDSHAKE_REVOKED)
    }
  })

  test('any capsule on EXPIRED → HANDSHAKE_EXPIRED', () => {
    for (const capsuleType of ['handshake-initiate', 'handshake-accept', 'handshake-refresh', 'handshake-revoke'] as const) {
      const ctx = buildCtx({
        input: buildVerifiedCapsuleInput({ capsuleType }),
        handshakeRecord: buildHandshakeRecord({ state: HandshakeState.EXPIRED }),
      })
      const result = checkStateTransition.execute(ctx)
      expect(result.passed).toBe(false)
      if (!result.passed) expect(result.reason).toBe(ReasonCode.HANDSHAKE_EXPIRED)
    }
  })

  test('initiate on ACTIVE → INVALID_STATE_TRANSITION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.ACTIVE }),
    })
    const result = checkStateTransition.execute(ctx)
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe(ReasonCode.INVALID_STATE_TRANSITION)
  })

  test('accept on ACTIVE → INVALID_STATE_TRANSITION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.ACTIVE }),
    })
    const result = checkStateTransition.execute(ctx)
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe(ReasonCode.INVALID_STATE_TRANSITION)
  })

  test('refresh on PENDING_ACCEPT → INVALID_STATE_TRANSITION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh' }),
      handshakeRecord: buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }),
    })
    const result = checkStateTransition.execute(ctx)
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe(ReasonCode.INVALID_STATE_TRANSITION)
  })

  test('accept on nonexistent handshake → HANDSHAKE_NOT_FOUND', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept' }),
      handshakeRecord: null,
    })
    const result = checkStateTransition.execute(ctx)
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
  })
})

describe('Pipeline Modes: Create vs Update', () => {
  test('handshake-accept with no prior record → HANDSHAKE_NOT_FOUND', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept' }),
      handshakeRecord: null,
    })
    const result = checkStateTransition.execute(ctx)
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe(ReasonCode.HANDSHAKE_NOT_FOUND)
  })

  test('all pipeline steps handle null handshakeRecord in create mode', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate' }),
      handshakeRecord: null,
    })
    expect(checkStateTransition.execute(ctx).passed).toBe(true)
  })
})
