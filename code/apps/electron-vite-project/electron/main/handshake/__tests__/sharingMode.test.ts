import { describe, test, expect } from 'vitest'
import { verifySharingMode } from '../steps/sharingMode'
import { ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildHandshakeRecord, buildActiveHandshakeRecord, buildReceiverPolicy } from './helpers'

describe('Asymmetric Sharing Mode', () => {
  test('accept with sharing_mode receive-only → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'receive-only', context_blocks: [] }),
      handshakeRecord: buildHandshakeRecord(),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('accept with sharing_mode reciprocal → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'reciprocal' }),
      handshakeRecord: buildHandshakeRecord(),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('accept with sharing_mode reciprocal + reciprocal_allowed=false → SHARING_MODE_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'reciprocal' }),
      handshakeRecord: buildHandshakeRecord({ reciprocal_allowed: false }),
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SHARING_MODE_VIOLATION)
  })

  test('accept with sharing_mode absent → INVALID_SHARING_MODE', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: undefined }),
      handshakeRecord: buildHandshakeRecord(),
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_SHARING_MODE)
  })

  test('accept receive-only with context_blocks present → SHARING_MODE_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-accept',
        sharing_mode: 'receive-only',
        context_blocks: [{ block_id: 'b1', block_hash: 'h1', relationship_id: 'rel-001', handshake_id: 'hs-001', type: 't', data_classification: 'public', version: 1, payload: 'p' }],
      }),
      handshakeRecord: buildHandshakeRecord(),
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SHARING_MODE_VIOLATION)
  })

  test('accept receive-only with context_blocks empty → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'receive-only', context_blocks: [] }),
      handshakeRecord: buildHandshakeRecord(),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('accept receive-only with context_blocks undefined → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'receive-only', context_blocks: undefined }),
      handshakeRecord: buildHandshakeRecord(),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('accept reciprocal with context_blocks present → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-accept',
        sharing_mode: 'reciprocal',
        context_blocks: [{ block_id: 'b1', block_hash: 'h1', relationship_id: 'rel-001', handshake_id: 'hs-001', type: 't', data_classification: 'public', version: 1, payload: 'p' }],
      }),
      handshakeRecord: buildHandshakeRecord(),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('accept reciprocal with context_blocks empty → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'reciprocal', context_blocks: [] }),
      handshakeRecord: buildHandshakeRecord(),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('initiate with sharing_mode present → INVALID_SHARING_MODE', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', sharing_mode: 'reciprocal' as any }),
      handshakeRecord: null,
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_SHARING_MODE)
  })

  test('refresh with sharing_mode present → SHARING_MODE_MUTATION_FORBIDDEN', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', sharing_mode: 'reciprocal' as any, seq: 1, prev_hash: 'h' }),
      handshakeRecord: buildActiveHandshakeRecord(),
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SHARING_MODE_MUTATION_FORBIDDEN)
  })

  test('receiver policy allowedSharingModes restricts available modes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sharing_mode: 'reciprocal' }),
      handshakeRecord: buildHandshakeRecord(),
      receiverPolicy: buildReceiverPolicy({ allowedSharingModes: ['receive-only'] }),
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SHARING_MODE_DENIED)
  })
})

describe('Sharing Mode Enforcement in Refresh', () => {
  test('receive-only: initiator sends refresh with blocks → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-refresh',
        sender_wrdesk_user_id: 'sender-user-001',
        senderIdentity: { email: 'sender@example.com', iss: 'https://auth.wrdesk.com', sub: 'sub-sender-001', email_verified: true, wrdesk_user_id: 'sender-user-001' },
        context_blocks: [{ block_id: 'b1', block_hash: 'h1', relationship_id: 'rel-001', handshake_id: 'hs-001', type: 't', data_classification: 'public', version: 1, payload: 'p' }],
        seq: 1, prev_hash: 'h',
      }),
      handshakeRecord: buildActiveHandshakeRecord({ sharing_mode: 'receive-only', initiator: { email: 'sender@example.com', wrdesk_user_id: 'sender-user-001', iss: 'https://auth.wrdesk.com', sub: 'sub-sender-001' }, acceptor: { email: 'local@wrdesk.com', wrdesk_user_id: 'local-user-001', iss: 'https://auth.wrdesk.com', sub: 'sub-local-001' } }),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('receive-only: acceptor sends refresh with blocks → SHARING_MODE_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-refresh',
        sender_wrdesk_user_id: 'local-user-001',
        senderIdentity: { email: 'local@wrdesk.com', iss: 'https://auth.wrdesk.com', sub: 'sub-local-001', email_verified: true, wrdesk_user_id: 'local-user-001' },
        context_blocks: [{ block_id: 'b1', block_hash: 'h1', relationship_id: 'rel-001', handshake_id: 'hs-001', type: 't', data_classification: 'public', version: 1, payload: 'p' }],
        seq: 1, prev_hash: 'h',
      }),
      handshakeRecord: buildActiveHandshakeRecord({ sharing_mode: 'receive-only', acceptor: { email: 'local@wrdesk.com', wrdesk_user_id: 'local-user-001', iss: 'https://auth.wrdesk.com', sub: 'sub-local-001' } }),
    })
    const r = verifySharingMode.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SHARING_MODE_VIOLATION)
  })

  test('receive-only: acceptor sends refresh without blocks → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        capsuleType: 'handshake-refresh',
        sender_wrdesk_user_id: 'local-user-001',
        senderIdentity: { email: 'local@wrdesk.com', iss: 'https://auth.wrdesk.com', sub: 'sub-local-001', email_verified: true, wrdesk_user_id: 'local-user-001' },
        context_blocks: [],
        seq: 1, prev_hash: 'h',
      }),
      handshakeRecord: buildActiveHandshakeRecord({ sharing_mode: 'receive-only', acceptor: { email: 'local@wrdesk.com', wrdesk_user_id: 'local-user-001', iss: 'https://auth.wrdesk.com', sub: 'sub-local-001' } }),
    })
    expect(verifySharingMode.execute(ctx).passed).toBe(true)
  })

  test('reciprocal: both parties can send blocks', () => {
    for (const userId of ['sender-user-001', 'local-user-001']) {
      const ctx = buildCtx({
        input: buildVerifiedCapsuleInput({
          capsuleType: 'handshake-refresh',
          sender_wrdesk_user_id: userId,
          senderIdentity: { email: `${userId}@wrdesk.com`, iss: 'https://auth.wrdesk.com', sub: `sub-${userId}`, email_verified: true, wrdesk_user_id: userId },
          context_blocks: [{ block_id: 'b1', block_hash: 'h1', relationship_id: 'rel-001', handshake_id: 'hs-001', type: 't', data_classification: 'public', version: 1, payload: 'p' }],
          seq: 1, prev_hash: 'h',
        }),
        handshakeRecord: buildActiveHandshakeRecord({ sharing_mode: 'reciprocal' }),
      })
      expect(verifySharingMode.execute(ctx).passed).toBe(true)
    }
  })
})
