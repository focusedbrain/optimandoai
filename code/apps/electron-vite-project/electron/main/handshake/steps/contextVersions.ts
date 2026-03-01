import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifyContextVersions: PipelineStep = {
  name: 'verify_context_versions',
  execute(ctx) {
    const { input, contextBlockVersions } = ctx
    const blocks = input.context_blocks ?? []
    const senderId = input.sender_wrdesk_user_id

    for (const block of blocks) {
      const key = `${senderId}:${block.block_id}`
      const lastVersion = contextBlockVersions.get(key)

      if (lastVersion != null && block.version <= lastVersion) {
        return { passed: false, reason: ReasonCode.INVALID_CONTEXT_BINDING }
      }
    }

    return { passed: true }
  },
}
