import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifyWrdeskPolicyAnchor: PipelineStep = {
  name: 'verify_wrdesk_policy_anchor',
  execute(ctx) {
    const { input, receiverPolicy } = ctx

    if (!receiverPolicy.acceptedWrdeskPolicyHashes.includes(input.wrdesk_policy_hash)) {
      return { passed: false, reason: ReasonCode.WRDESK_POLICY_ANCHOR_MISMATCH }
    }

    return { passed: true }
  },
}
