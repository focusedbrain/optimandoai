import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

/**
 * Verify context block proofs (hash-only references).
 *
 * In the hardened model, handshake capsules carry only proof hashes —
 * never full content blocks. Binding verification against relationship_id
 * and data_classification happens later when the actual BEAP-Capsule
 * carrying the content enters the full ingestor pipeline.
 *
 * Here we only validate structural integrity of the proof objects.
 */
export const verifyContextBinding: PipelineStep = {
  name: 'verify_context_binding',
  execute(ctx) {
    const { input } = ctx
    const proofs = input.context_block_proofs ?? []

    for (const proof of proofs) {
      if (!proof.block_id || typeof proof.block_id !== 'string') {
        return { passed: false, reason: ReasonCode.INVALID_CONTEXT_BINDING }
      }
      if (!proof.block_hash || typeof proof.block_hash !== 'string') {
        return { passed: false, reason: ReasonCode.INVALID_CONTEXT_BINDING }
      }
    }

    return { passed: true }
  },
}
