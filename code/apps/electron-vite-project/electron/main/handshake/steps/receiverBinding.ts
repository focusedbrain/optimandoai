import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

/**
 * Verify that the capsule's receiver_email matches the local user's email.
 *
 * For initiate capsules: the receiver_email must match the local session email
 * (i.e. the capsule is addressed to us).
 *
 * For accept capsules: the sender is the acceptor, so this check is skipped
 * (ownership.ts already ensures the sender is not the initiator).
 *
 * For refresh/revoke: receiver binding was established at initiate time;
 * chain integrity covers it.
 */
export const verifyReceiverBinding: PipelineStep = {
  name: 'verify_receiver_binding',
  execute(ctx) {
    const { input } = ctx

    if (input.capsuleType !== 'handshake-initiate') {
      return { passed: true }
    }

    if (!input.receiver_email) {
      return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
    }

    if (!input.sender_email) {
      return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
    }

    // The capsule must not be addressed to the sender themselves
    if (input.receiver_email === input.sender_email) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
    }

    return { passed: true }
  },
}
