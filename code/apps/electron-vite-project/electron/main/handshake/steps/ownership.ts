import type { PipelineStep } from '../types'
import { ReasonCode, HandshakeState } from '../types'
import { isSameAccountHandshakeEmails } from '../../../../../../packages/shared/src/handshake/receiverEmailValidation'

export const verifyHandshakeOwnership: PipelineStep = {
  name: 'verify_handshake_ownership',
  execute(ctx) {
    const { input, handshakeRecord, localUserId, existingHandshakes } = ctx
    const senderId = input.sender_wrdesk_user_id

    if (input.capsuleType === 'handshake-initiate') {
      // Same wrdesk_user_id on two devices is only valid for internal (same-account) handshakes.
      if (senderId === localUserId) {
        if (!isSameAccountHandshakeEmails(input.sender_email, input.receiver_email)) {
          return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
        }
      }

      // Check for duplicate active/pending handshake for same tuple
      const duplicate = existingHandshakes.find(h =>
        (h.state === HandshakeState.PENDING_ACCEPT || h.state === HandshakeState.ACCEPTED || h.state === HandshakeState.ACTIVE) &&
        h.relationship_id === input.relationship_id &&
        ((h.initiator.wrdesk_user_id === senderId && h.acceptor?.wrdesk_user_id === localUserId) ||
         (h.initiator.wrdesk_user_id === localUserId && h.acceptor?.wrdesk_user_id === senderId) ||
         (h.initiator.wrdesk_user_id === senderId && h.acceptor === null))
      )
      if (duplicate) {
        return { passed: false, reason: ReasonCode.DUPLICATE_ACTIVE_HANDSHAKE }
      }

      return { passed: true }
    }

    // Update mode: record must exist
    if (!handshakeRecord) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_NOT_FOUND }
    }

    // For accept: sender must NOT be the initiator unless internal same-account (second device).
    if (input.capsuleType === 'handshake-accept') {
      if (senderId === handshakeRecord.initiator.wrdesk_user_id) {
        if (!isSameAccountHandshakeEmails(handshakeRecord.initiator.email, handshakeRecord.receiver_email)) {
          return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
        }
      }
      return { passed: true }
    }

    // For refresh/revoke: sender must be the OTHER party
    const isInitiator = senderId === handshakeRecord.initiator.wrdesk_user_id
    const isAcceptor = handshakeRecord.acceptor != null &&
      senderId === handshakeRecord.acceptor.wrdesk_user_id
    if (!isInitiator && !isAcceptor) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
    }

    return { passed: true }
  },
}
