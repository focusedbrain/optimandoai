import type { PipelineStep } from '../types'
import { ReasonCode, HandshakeState } from '../types'
import { isSameAccountHandshakeEmails } from '../../../../../../packages/shared/src/handshake/receiverEmailValidation'
import { computeInternalRoutingKey } from '../internalPersistence'

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

      // Same-principal internal: duplicate is keyed by device pair + owner, not email pair
      // (relationship_id embeds handshake_id so two device-pair handshakes differ on rel id alone).
      if (input.handshake_type === 'internal') {
        const routeKey = computeInternalRoutingKey(
          input.sender_wrdesk_user_id,
          input.sender_device_id ?? undefined,
          input.receiver_device_id ?? undefined,
        )
        if (routeKey) {
          const dupByRoute = existingHandshakes.find(
            h =>
              h.handshake_type === 'internal' &&
              (h.state === HandshakeState.PENDING_ACCEPT ||
                h.state === HandshakeState.ACCEPTED ||
                h.state === HandshakeState.ACTIVE) &&
              h.internal_routing_key === routeKey,
          )
          if (dupByRoute) {
            return { passed: false, reason: ReasonCode.DUPLICATE_ACTIVE_HANDSHAKE }
          }
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
