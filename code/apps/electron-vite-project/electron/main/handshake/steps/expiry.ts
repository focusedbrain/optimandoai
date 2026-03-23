import type { PipelineStep } from '../types'
import { ReasonCode, HandshakeState, INPUT_LIMITS } from '../types'

export const checkExpiry: PipelineStep = {
  name: 'check_expiry',
  execute(ctx) {
    const { input, handshakeRecord } = ctx
    const now = Date.now()

    // Check if handshake record has already expired.
    // Skip for accept capsules on PENDING_ACCEPT/PENDING_REVIEW records —
    // the user may be accepting a capsule whose stored expires_at was set from
    // an old capsule timestamp. The accept action itself is the activity that
    // resets the clock, so we allow it through.
    const isPendingAccept = handshakeRecord?.state === HandshakeState.PENDING_ACCEPT
      || handshakeRecord?.state === HandshakeState.PENDING_REVIEW
    const isAcceptCapsule = input.capsuleType === 'handshake-accept'
    if (handshakeRecord?.expires_at && !(isPendingAccept && isAcceptCapsule)) {
      const expiresAt = Date.parse(handshakeRecord.expires_at)
      if (!isNaN(expiresAt) && now > expiresAt) {
        return { passed: false, reason: ReasonCode.HANDSHAKE_EXPIRED }
      }
    }

    // For accept: can narrow expiry but cannot extend
    if (input.capsuleType === 'handshake-accept' && input.expires_at && handshakeRecord) {
      if (handshakeRecord.expires_at) {
        const existingExpiry = Date.parse(handshakeRecord.expires_at)
        const newExpiry = Date.parse(input.expires_at)
        if (!isNaN(existingExpiry) && !isNaN(newExpiry)) {
          if (newExpiry > existingExpiry) {
            return { passed: false, reason: ReasonCode.EXPIRY_EXTENSION_DENIED }
          }
        }
      }
      // If initiator had no expiry, acceptor can set one (narrowing)
    }

    // For refresh: cannot change expires_at
    if (input.capsuleType === 'handshake-refresh' && input.expires_at != null) {
      return { passed: false, reason: ReasonCode.EXPIRY_MUTATION_FORBIDDEN }
    }

    return { passed: true }
  },
}
