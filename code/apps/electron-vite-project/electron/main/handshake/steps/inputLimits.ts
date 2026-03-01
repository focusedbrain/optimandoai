import type { PipelineStep } from '../types'
import { ReasonCode, INPUT_LIMITS } from '../types'

const encoder = new TextEncoder()

function byteLength(s: string): number {
  return encoder.encode(s).length
}

export const verifyInputLimits: PipelineStep = {
  name: 'verify_input_limits',
  execute(ctx) {
    const { input, receiverPolicy } = ctx
    const maxBlocks = receiverPolicy.maxContextBlocksPerCapsule
    const maxPayload = receiverPolicy.maxBlockPayloadBytes

    if (input.handshake_id.length > INPUT_LIMITS.MAX_ID_LENGTH) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }
    if (input.relationship_id.length > INPUT_LIMITS.MAX_ID_LENGTH) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }
    if (input.capsule_hash.length > INPUT_LIMITS.MAX_HASH_LENGTH) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }

    const blocks = input.context_blocks ?? []
    if (blocks.length > maxBlocks) {
      return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
    }

    for (const block of blocks) {
      if (block.block_id.length > INPUT_LIMITS.MAX_ID_LENGTH) {
        return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
      }
      if (block.block_hash.length > INPUT_LIMITS.MAX_HASH_LENGTH) {
        return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
      }
      if (block.type.length > INPUT_LIMITS.MAX_TYPE_LENGTH) {
        return { passed: false, reason: ReasonCode.INPUT_LIMIT_EXCEEDED }
      }
      if (byteLength(block.payload) > maxPayload) {
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
