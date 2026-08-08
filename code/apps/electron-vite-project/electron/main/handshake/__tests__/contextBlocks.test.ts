import { describe, test, expect } from 'vitest'
import { verifyContextBinding } from '../steps/contextBinding'
import { ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput } from './helpers'

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

// Phase 1 dead-path removal (A12): the no-op verify_context_versions step was
// deleted from the pipeline. Version monotonicity for full content blocks is
// enforced on the BEAP-Capsule content path, not on handshake capsules.

