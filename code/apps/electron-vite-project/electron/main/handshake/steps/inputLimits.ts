import type { PipelineStep } from '../types'
import { ReasonCode, INPUT_LIMITS } from '../types'

export const verifyInputLimits: PipelineStep = {
  name: 'verify_input_limits',
  execute(ctx) {
    const { input } = ctx

    if (input.handshake_id.length > INPUT_LIMITS.MAX_ID_LENGTH) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }
    if (input.relationship_id.length > INPUT_LIMITS.MAX_ID_LENGTH) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }
    if (input.capsule_hash.length > INPUT_LIMITS.MAX_HASH_LENGTH) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }

    const proofs = input.context_block_proofs ?? []
    if (proofs.length > 100) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }

    for (const proof of proofs) {
      if (proof.block_id.length > INPUT_LIMITS.MAX_ID_LENGTH) {
        return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
      }
      if (proof.block_hash.length > INPUT_LIMITS.MAX_HASH_LENGTH) {
        return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
      }
    }

    if (input.scopes) {
      for (const scope of input.scopes) {
        if (scope.length > INPUT_LIMITS.MAX_SCOPE_LENGTH) {
          return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
        }
      }
    }

    return { passed: true }
  },
}
