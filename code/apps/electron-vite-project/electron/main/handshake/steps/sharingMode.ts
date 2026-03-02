import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifySharingMode: PipelineStep = {
  name: 'verify_sharing_mode',
  execute(ctx) {
    const { input, handshakeRecord, receiverPolicy } = ctx

    if (input.capsuleType === 'handshake-initiate') {
      // Initiator must NOT set sharing_mode
      if (input.sharing_mode != null) {
        return { passed: false, reason: ReasonCode.INVALID_SHARING_MODE }
      }
      return { passed: true }
    }

    if (input.capsuleType === 'handshake-accept') {
      // sharing_mode MUST be present
      if (input.sharing_mode == null) {
        return { passed: false, reason: ReasonCode.INVALID_SHARING_MODE }
      }

      // Must be a valid value
      if (input.sharing_mode !== 'receive-only' && input.sharing_mode !== 'reciprocal') {
        return { passed: false, reason: ReasonCode.INVALID_SHARING_MODE }
      }

      // If reciprocal but initiator disallowed it
      if (input.sharing_mode === 'reciprocal' && handshakeRecord && !handshakeRecord.reciprocal_allowed) {
        return { passed: false, reason: ReasonCode.SHARING_MODE_VIOLATION }
      }

      // Must be in receiver policy's allowed modes
      if (!receiverPolicy.allowedSharingModes.includes(input.sharing_mode)) {
        return { passed: false, reason: ReasonCode.SHARING_MODE_DENIED }
      }

      // receive-only: context_block_proofs MUST be empty or absent
      if (input.sharing_mode === 'receive-only') {
        const proofs = input.context_block_proofs
        if (proofs != null && proofs.length > 0) {
          return { passed: false, reason: ReasonCode.SHARING_MODE_VIOLATION }
        }
      }

      return { passed: true }
    }

    if (input.capsuleType === 'handshake-refresh') {
      // sharing_mode must NOT be present (immutable after accept)
      if (input.sharing_mode != null) {
        return { passed: false, reason: ReasonCode.SHARING_MODE_MUTATION_FORBIDDEN }
      }

      // Enforce recorded sharing_mode from handshakeRecord
      if (handshakeRecord && handshakeRecord.sharing_mode === 'receive-only') {
        // Check if sender is the acceptor
        const senderIsAcceptor =
          handshakeRecord.acceptor != null &&
          input.sender_wrdesk_user_id === handshakeRecord.acceptor.wrdesk_user_id

        if (senderIsAcceptor) {
          const proofs = input.context_block_proofs
          if (proofs != null && proofs.length > 0) {
            return { passed: false, reason: ReasonCode.SHARING_MODE_VIOLATION }
          }
        }
      }

      return { passed: true }
    }

    // handshake-revoke: sharing_mode is irrelevant
    return { passed: true }
  },
}
