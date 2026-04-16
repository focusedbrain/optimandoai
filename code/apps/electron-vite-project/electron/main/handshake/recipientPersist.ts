/**
 * Recipient Persist — Import .beap file as PENDING_REVIEW
 *
 * When the acceptor imports an initiate capsule from a file, we create a
 * local record with state PENDING_REVIEW. The user needs to review and decide
 * (accept or decline). PENDING_ACCEPT is the initiator's state (waiting for
 * the other side); PENDING_REVIEW is the recipient's state (reviewing the request).
 *
 * Validation is done via processIncomingInput before this is called.
 */

import type { HandshakeRecord } from './types'
import { HandshakeState as HS, INPUT_LIMITS } from './types'

/** Use capsule expires_at only if it is in the future; otherwise default to PENDING_TIMEOUT. Prevents "expired" on import when capsule has stale expires_at. */
function resolveExpiresAt(capsuleExpiresAt: string | undefined): string {
  if (!capsuleExpiresAt) return new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString()
  const parsed = Date.parse(capsuleExpiresAt)
  if (isNaN(parsed) || parsed <= Date.now()) return new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString()
  return capsuleExpiresAt
}
import { buildDefaultReceiverPolicy } from './types'
import { classifyHandshakeTier } from './tierClassification'
import { resolveEffectivePolicyFn } from './steps/policyResolution'
import { insertHandshakeRecord, insertSeenCapsuleHash } from './db'
import type { ValidatedCapsule } from '../ingestion/types'
import { validateInternalInitiateCapsuleWire } from './internalPersistence'

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
    const senderX25519: string | null =
      (typeof c?.sender_x25519_public_key_b64 === 'string' && c.sender_x25519_public_key_b64.trim().length > 0)
        ? c.sender_x25519_public_key_b64.trim()
        : null
    const senderMlkem768: string | null =
      (typeof c?.sender_mlkem768_public_key_b64 === 'string' && c.sender_mlkem768_public_key_b64.trim().length > 0)
        ? c.sender_mlkem768_public_key_b64.trim()
        : null
    const initiatorCoordinationDeviceId: string | null =
      typeof c?.sender_device_id === 'string' && c.sender_device_id.trim().length > 0
        ? c.sender_device_id.trim()
        : null

    const wireInternal = c?.handshake_type === 'internal'
    if (wireInternal) {
      // Phase 2: the initiator may have used the pairing-time sentinel
      // (INTERNAL_COMPUTER_NAME_SENTINEL, see shared/handshake/internalEndpointValidation.ts)
      // for the receiver's computer name when they didn't yet know it. The shared
      // validator treats that sentinel as non-colliding, so it flows through here
      // into `internal_peer_computer_name` and is overwritten with the real name via
      // the normal update path once the accept round-trip completes.
      const w = validateInternalInitiateCapsuleWire(c as Record<string, unknown>)
      if (!w.ok) {
        return { success: false, error: w.error ?? 'Internal initiate capsule invalid', reason: w.code }
      }
    }

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
      expires_at: resolveExpiresAt(c.expires_at),
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
      peer_x25519_public_key_b64: senderX25519,
      peer_mlkem768_public_key_b64: senderMlkem768,
      initiator_coordination_device_id: initiatorCoordinationDeviceId,
      ...(wireInternal
        ? {
            handshake_type: 'internal' as const,
            initiator_device_name:
              typeof c.sender_computer_name === 'string' ? c.sender_computer_name.trim() : null,
            initiator_device_role: c.sender_device_role ?? null,
            acceptor_device_name:
              typeof c.receiver_computer_name === 'string' ? c.receiver_computer_name.trim() : null,
            acceptor_device_role: c.receiver_device_role ?? null,
            acceptor_coordination_device_id: null,
            internal_peer_device_id:
              typeof c.receiver_device_id === 'string' ? c.receiver_device_id.trim() : null,
            internal_peer_device_role: c.receiver_device_role ?? null,
            internal_peer_computer_name:
              typeof c.receiver_computer_name === 'string' ? c.receiver_computer_name.trim() : null,
          }
        : {}),
    }

    insertHandshakeRecord(db, record)
    insertSeenCapsuleHash(db, record.handshake_id, record.last_capsule_hash_received)
    console.log('[HANDSHAKE] Recipient import OK:', record.handshake_id, 'state=PENDING_REVIEW')

    return { success: true, handshake_id: record.handshake_id, handshakeRecord: record }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    const stack = err?.stack ?? ''
    console.error('[HANDSHAKE] Recipient persist failed:', msg, stack)
    try {
      const fs = require('fs')
      const path = require('path')
      const logDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.opengiraffe')
      const logFile = path.join(logDir, 'import-error.log')
      fs.mkdirSync(logDir, { recursive: true })
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] persistRecipientHandshakeRecord: ${msg}\n${stack}\n\n`)
    } catch (_) { /* ignore */ }
    return {
      success: false,
      error: msg,
      reason: 'INTERNAL_ERROR',
    }
  }
}
