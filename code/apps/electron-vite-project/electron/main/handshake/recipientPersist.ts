/**
 * Recipient Persist — Import .beap file as PENDING_REVIEW
 *
 * When the acceptor imports an initiate capsule from a file, we create a
 * local record with state PENDING_REVIEW (not PENDING_ACCEPT). The user
 * reviews and then clicks Accept to transition to ACCEPTED.
 *
 * Validation is done via processIncomingInput before this is called.
 */

import type { HandshakeRecord } from './types'
import { HandshakeState as HS, INPUT_LIMITS } from './types'
import { buildDefaultReceiverPolicy } from './types'
import { classifyHandshakeTier } from './tierClassification'
import { resolveEffectivePolicyFn } from './steps/policyResolution'
import { insertHandshakeRecord, insertSeenCapsuleHash } from './db'
import type { ValidatedCapsule } from '../ingestion/types'

export interface PersistRecipientResult {
  success: boolean
  error?: string
  reason?: string
  handshake_id?: string
  handshakeRecord?: HandshakeRecord
}

/**
 * Persist the acceptor's handshake record from an imported initiate capsule.
 * Creates record with state PENDING_REVIEW.
 */
export function persistRecipientHandshakeRecord(
  db: any,
  validated: ValidatedCapsule,
  ssoSession: { plan?: string; currentHardwareAttestation?: any; currentDnsVerification?: any; wrStampStatus?: any },
): PersistRecipientResult {
  try {
    const c = validated.capsule as Record<string, any>
    if ((c?.capsule_type ?? '') !== 'initiate') {
      return { success: false, error: 'Only initiate capsules can be imported', reason: 'NOT_INITIATE_CAPSULE' }
    }

    const tierDecision = classifyHandshakeTier({
      plan: ssoSession.plan ?? 'free',
      hardwareAttestation: ssoSession.currentHardwareAttestation,
      dnsVerification: ssoSession.currentDnsVerification,
      wrStampStatus: (ssoSession as any).wrStampStatus ?? (ssoSession as any).currentWrStampStatus,
    })

    const receiverPolicy = buildDefaultReceiverPolicy()
    const effectivePolicyResult = resolveEffectivePolicyFn(null, receiverPolicy)
    if ('unsatisfiable' in effectivePolicyResult) {
      return { success: false, error: 'Policy resolution failed' }
    }
    const effectivePolicy = effectivePolicyResult

    const senderP2PEndpoint: string | null =
      typeof c?.p2p_endpoint === 'string' && c.p2p_endpoint.trim().length > 0 ? c.p2p_endpoint.trim() : null
    const senderP2PAuthToken: string | null =
      typeof c?.p2p_auth_token === 'string' && c.p2p_auth_token.trim().length > 0 ? c.p2p_auth_token.trim() : null
    const senderPublicKey = typeof c?.sender_public_key === 'string' ? c.sender_public_key : ''

    const senderIdentity = c.senderIdentity ?? {
      email: c.sender_email ?? '',
      iss: c.iss ?? '',
      sub: c.sub ?? c.sender_id ?? '',
      wrdesk_user_id: c.sender_wrdesk_user_id ?? c.sender_id ?? '',
    }

    const record: HandshakeRecord = {
      handshake_id: c.handshake_id ?? '',
      relationship_id: c.relationship_id ?? '',
      state: HS.PENDING_REVIEW,
      initiator: {
        email: senderIdentity.email ?? '',
        wrdesk_user_id: (senderIdentity.wrdesk_user_id ?? c.sender_wrdesk_user_id ?? c.sender_id ?? '') as string,
        iss: senderIdentity.iss ?? '',
        sub: senderIdentity.sub ?? '',
      },
      acceptor: null,
      local_role: 'acceptor',
      sharing_mode: null,
      reciprocal_allowed: c.reciprocal_allowed ?? false,
      tier_snapshot: tierDecision,
      current_tier_signals: c.tierSignals ?? { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
      last_seq_sent: 0,
      last_seq_received: 0,
      last_capsule_hash_sent: '',
      last_capsule_hash_received: c.capsule_hash ?? '',
      effective_policy: effectivePolicy,
      external_processing: c.external_processing ?? 'none',
      created_at: c.timestamp ?? new Date().toISOString(),
      activated_at: null,
      expires_at: c.expires_at ?? new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString(),
      revoked_at: null,
      revocation_source: null,
      initiator_wrdesk_policy_hash: c.wrdesk_policy_hash ?? '',
      initiator_wrdesk_policy_version: c.wrdesk_policy_version ?? '',
      acceptor_wrdesk_policy_hash: null,
      acceptor_wrdesk_policy_version: null,
      initiator_context_commitment: c.context_commitment ?? null,
      acceptor_context_commitment: null,
      p2p_endpoint: senderP2PEndpoint,
      counterparty_p2p_token: senderP2PAuthToken,
      counterparty_public_key: senderPublicKey || null,
      receiver_email: c.receiver_email ?? null,
    }

    insertHandshakeRecord(db, record)
    insertSeenCapsuleHash(db, record.handshake_id, record.last_capsule_hash_received)
    console.log('[HANDSHAKE] Recipient import OK:', record.handshake_id, 'state=PENDING_REVIEW')

    return { success: true, handshake_id: record.handshake_id, handshakeRecord: record }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? 'Import failed',
      reason: 'INTERNAL_ERROR',
    }
  }
}
