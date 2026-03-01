import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const checkDuplicateCapsule: PipelineStep = {
  name: 'check_duplicate_capsule',
  execute(ctx) {
    const key = `${ctx.input.handshake_id}:${ctx.input.capsule_hash}`
    if (ctx.seenCapsuleHashes.has(key)) {
      return { passed: false, reason: ReasonCode.DUPLICATE_CAPSULE }
    }
    return { passed: true }
  },
}
