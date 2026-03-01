import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifyContextBinding: PipelineStep = {
  name: 'verify_context_binding',
  execute(ctx) {
    const { input, receiverPolicy } = ctx
    const blocks = input.context_blocks ?? []

    for (const block of blocks) {
      // Three-way binding
      if (block.relationship_id !== input.relationship_id) {
        return { passed: false, reason: ReasonCode.INVALID_CONTEXT_BINDING }
      }
      if (block.handshake_id !== input.handshake_id) {
        return { passed: false, reason: ReasonCode.INVALID_CONTEXT_BINDING }
      }

      // Data classification check
      if (!receiverPolicy.acceptedClassifications.includes(block.data_classification)) {
        return { passed: false, reason: ReasonCode.CLASSIFICATION_NOT_ACCEPTED }
      }
    }

    return { passed: true }
  },
}
