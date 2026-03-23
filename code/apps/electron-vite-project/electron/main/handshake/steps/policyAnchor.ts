import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

/**
 * Wildcard sentinel: when `acceptedWrdeskPolicyHashes` contains `'*'`,
 * any non-empty policy hash is accepted. Used for open-policy MVP mode
 * and for receiver policies that have not yet been configured with a
 * specific sender policy hash.
 */
const POLICY_HASH_WILDCARD = '*'

export const verifyWrdeskPolicyAnchor: PipelineStep = {
  name: 'verify_wrdesk_policy_anchor',
  execute(ctx) {
    const { input, receiverPolicy } = ctx

    // Revoke capsules carry no policy hash by design — skip anchor check.
    if (input.capsuleType === 'handshake-revoke') {
      return { passed: true }
    }

    const hashes = receiverPolicy.acceptedWrdeskPolicyHashes

    // Wildcard: accept any non-empty policy hash
    if (hashes.includes(POLICY_HASH_WILDCARD)) {
      return input.wrdesk_policy_hash
        ? { passed: true }
        : { passed: false, reason: ReasonCode.WRDESK_POLICY_ANCHOR_MISMATCH }
    }

    // Strict: hash must be in the explicit whitelist
    if (!hashes.includes(input.wrdesk_policy_hash)) {
      return { passed: false, reason: ReasonCode.WRDESK_POLICY_ANCHOR_MISMATCH }
    }

    return { passed: true }
  },
}
