import type { PipelineStep, PartyIdentity, SSOSession, VerifiedCapsuleInput } from '../types'
import { ReasonCode, HandshakeState } from '../types'
import {
  fullClaimIdentityMatch,
  isPartialIdentityCollision,
} from '@repo/ingestion-core'
import { isSameAccountHandshakeEmails } from '../../../../../../packages/shared/src/handshake/receiverEmailValidation'
import { computeInternalRoutingKey } from '../internalPersistence'
import { wireDeclaresSamePrincipal } from '../samePrincipalWire'

function senderClaims(input: VerifiedCapsuleInput): {
  iss: string
  sub: string
  email: string
  wrdesk_user_id: string
} {
  return {
    iss: input.senderIdentity?.iss ?? '',
    sub: input.senderIdentity?.sub ?? '',
    email: input.senderIdentity?.email ?? input.sender_email ?? '',
    wrdesk_user_id: input.senderIdentity?.wrdesk_user_id ?? input.sender_wrdesk_user_id ?? '',
  }
}

/**
 * The routing fields (`sender_wrdesk_user_id`, `sender_email`) and the claim
 * block (`senderIdentity`) both describe the sender. Production capsules set
 * them from the same session; a disagreement means a crafted capsule asserting
 * two different senders at once — always an ownership violation.
 */
function senderFieldsConsistent(input: VerifiedCapsuleInput): boolean {
  const idWrdesk = (input.senderIdentity?.wrdesk_user_id ?? '').trim()
  const routeWrdesk = (input.sender_wrdesk_user_id ?? '').trim()
  if (idWrdesk && routeWrdesk && idWrdesk !== routeWrdesk) return false
  const idEmail = (input.senderIdentity?.email ?? '').trim().toLowerCase()
  const routeEmail = (input.sender_email ?? '').trim().toLowerCase()
  if (idEmail && routeEmail && idEmail !== routeEmail) return false
  return true
}

function sessionClaims(session: SSOSession): {
  iss: string
  sub: string
  email: string
  wrdesk_user_id: string
} {
  return {
    iss: session.iss,
    sub: session.sub,
    email: session.email,
    wrdesk_user_id: session.wrdesk_user_id,
  }
}

/**
 * Full-claim sender-vs-party comparison [VII.3.8–3.10].
 *
 * - `is_party`: every claim the party was bound with matches exactly.
 * - `collision`: guard failed but at least one identity claim collided
 *   (same sub/wrdesk id under a different issuer/email) — spoof indicator,
 *   must be rejected, never treated as "different principal".
 * - `distinct`: no identity overlap at all.
 */
function classifySenderAgainstParty(
  input: VerifiedCapsuleInput,
  party: PartyIdentity | null | undefined,
): 'is_party' | 'collision' | 'distinct' {
  if (!party) return 'distinct'
  const result = fullClaimIdentityMatch(senderClaims(input), party)
  if (result.ok) return 'is_party'
  return isPartialIdentityCollision(result) ? 'collision' : 'distinct'
}

export const verifyHandshakeOwnership: PipelineStep = {
  name: 'verify_handshake_ownership',
  execute(ctx) {
    const { input, handshakeRecord, ssoSession, existingHandshakes, localUserId } = ctx
    const senderId = input.sender_wrdesk_user_id

    if (!senderFieldsConsistent(input)) {
      return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
    }

    if (input.capsuleType === 'handshake-initiate') {
      // Sender claiming the local principal's identity is only valid for internal
      // (same-account) handshakes on a second device. Full-claim comparison: a
      // partial collision (e.g. same wrdesk id, different issuer) is a violation.
      const selfMatch = fullClaimIdentityMatch(senderClaims(input), sessionClaims(ssoSession))
      if (selfMatch.ok) {
        if (!isSameAccountHandshakeEmails(input.sender_email, input.receiver_email)) {
          return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
        }
      } else if (isPartialIdentityCollision(selfMatch)) {
        return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
      }

      // Same-principal internal: duplicate is keyed by device pair + owner, not email pair
      // (relationship_id embeds handshake_id so two device-pair handshakes differ on rel id alone).
      if (wireDeclaresSamePrincipal(input)) {
        const routeKey = computeInternalRoutingKey(
          input.sender_wrdesk_user_id,
          input.sender_device_id ?? undefined,
          input.receiver_device_id ?? undefined,
        )
        if (routeKey) {
          const dupByRoute = existingHandshakes.find(
            h =>
              h.same_principal === true &&
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
      const vsInitiator = classifySenderAgainstParty(input, handshakeRecord.initiator)
      if (vsInitiator === 'collision') {
        return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
      }
      if (vsInitiator === 'is_party') {
        if (!isSameAccountHandshakeEmails(handshakeRecord.initiator.email, handshakeRecord.receiver_email)) {
          return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
        }
      }
      return { passed: true }
    }

    // For refresh/revoke/context-sync: sender must be one of the bound parties
    // (party selection is legitimate; each candidate match is full-claim exact).
    const vsInitiator = classifySenderAgainstParty(input, handshakeRecord.initiator)
    const vsAcceptor = classifySenderAgainstParty(input, handshakeRecord.acceptor)
    if (vsInitiator !== 'is_party' && vsAcceptor !== 'is_party') {
      return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
    }

    return { passed: true }
  },
}
