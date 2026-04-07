import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const checkExpiry: PipelineStep = {
  name: 'check_expiry',
  execute(ctx) {
    const { input, handshakeRecord } = ctx
    // Handshake trust is not invalidated by calendar `expires_at` (revocation only).

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
