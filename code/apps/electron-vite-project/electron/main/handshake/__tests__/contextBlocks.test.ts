import { describe, test, expect } from 'vitest'
import { verifyContextBinding } from '../steps/contextBinding'
import { verifyContextVersions } from '../steps/contextVersions'
import { ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildReceiverPolicy, buildContextBlock } from './helpers'

describe('Context Binding', () => {
  test('relationship_id mismatch → INVALID_CONTEXT_BINDING', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        relationship_id: 'rel-001',
        context_blocks: [buildContextBlock({ relationship_id: 'rel-WRONG' })],
      }),
    })
    const r = verifyContextBinding.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CONTEXT_BINDING)
  })

  test('block.handshake_id mismatch → INVALID_CONTEXT_BINDING', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        handshake_id: 'hs-001',
        context_blocks: [buildContextBlock({ handshake_id: 'hs-WRONG' })],
      }),
    })
    const r = verifyContextBinding.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CONTEXT_BINDING)
  })

  test('all correct → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        relationship_id: 'rel-001',
        handshake_id: 'hs-001',
        context_blocks: [buildContextBlock({ relationship_id: 'rel-001', handshake_id: 'hs-001' })],
      }),
    })
    expect(verifyContextBinding.execute(ctx).passed).toBe(true)
  })

  test('unaccepted data classification → CLASSIFICATION_NOT_ACCEPTED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        context_blocks: [buildContextBlock({ data_classification: 'sensitive-personal-data' })],
      }),
      receiverPolicy: buildReceiverPolicy({ acceptedClassifications: ['public'] }),
    })
    const r = verifyContextBinding.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLASSIFICATION_NOT_ACCEPTED)
  })
})

describe('Context Version Monotonicity', () => {
  test('version > last → passes', () => {
    const versions = new Map([['sender-user-001:block-1', 1]])
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ context_blocks: [buildContextBlock({ block_id: 'block-1', version: 2 })] }),
      contextBlockVersions: versions,
    })
    expect(verifyContextVersions.execute(ctx).passed).toBe(true)
  })

  test('version == last → INVALID_CONTEXT_BINDING', () => {
    const versions = new Map([['sender-user-001:block-1', 2]])
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ context_blocks: [buildContextBlock({ block_id: 'block-1', version: 2 })] }),
      contextBlockVersions: versions,
    })
    const r = verifyContextVersions.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CONTEXT_BINDING)
  })

  test('version < last → INVALID_CONTEXT_BINDING', () => {
    const versions = new Map([['sender-user-001:block-1', 3]])
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ context_blocks: [buildContextBlock({ block_id: 'block-1', version: 1 })] }),
      contextBlockVersions: versions,
    })
    const r = verifyContextVersions.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CONTEXT_BINDING)
  })

  test('first block (no prior version) → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ context_blocks: [buildContextBlock({ block_id: 'new-block', version: 1 })] }),
      contextBlockVersions: new Map(),
    })
    expect(verifyContextVersions.execute(ctx).passed).toBe(true)
  })
})

describe('Context Block Dedup', () => {
  test('same block_id from different senders → both valid (separate namespace)', () => {
    const versions = new Map<string, number>()
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        sender_wrdesk_user_id: 'user-A',
        context_blocks: [buildContextBlock({ block_id: 'shared-block', version: 1 })],
      }),
      contextBlockVersions: versions,
    })
    expect(verifyContextVersions.execute(ctx).passed).toBe(true)
  })
})
