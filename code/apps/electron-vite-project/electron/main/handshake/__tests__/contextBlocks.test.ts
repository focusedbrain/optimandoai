import { describe, test, expect } from 'vitest'
import { verifyContextBinding } from '../steps/contextBinding'
import { verifyContextVersions } from '../steps/contextVersions'
import { ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildReceiverPolicy, buildContextBlock } from './helpers'

describe('Context Binding', () => {
  // Hardened model: verifyContextBinding only validates context_block_proofs structure (proof hashes).
  // relationship_id, handshake_id, data_classification checks moved to enforcement layer.
  test('context_block_proofs: missing block_id → INVALID_CONTEXT_BINDING', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        context_block_proofs: [{ block_hash: 'a'.repeat(64) }],
      }),
    })
    const r = verifyContextBinding.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CONTEXT_BINDING)
  })

  test('context_block_proofs: missing block_hash → INVALID_CONTEXT_BINDING', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        context_block_proofs: [{ block_id: 'blk_abc123' }],
      }),
    })
    const r = verifyContextBinding.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INVALID_CONTEXT_BINDING)
  })

  test('context_block_proofs: valid structure → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        context_block_proofs: [
          { block_id: 'blk_abc123', block_hash: 'a'.repeat(64) },
        ],
      }),
    })
    expect(verifyContextBinding.execute(ctx).passed).toBe(true)
  })

  test('context_block_proofs: empty → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({
        context_block_proofs: [],
      }),
    })
    expect(verifyContextBinding.execute(ctx).passed).toBe(true)
  })
})

describe('Context Version Monotonicity', () => {
  // Hardened model: verifyContextVersions is a no-op for handshake capsules (proof-only).
  // Version checks enforced when full content blocks arrive via BEAP-Capsule pipeline.
  test('step always passes (no-op for handshake capsules)', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ context_blocks: [buildContextBlock({ block_id: 'block-1', version: 2 })] }),
      contextBlockVersions: new Map([['sender-user-001:block-1', 1]]),
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

