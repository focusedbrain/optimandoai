/**
 * Initiator Persist — Direct DB Insert for Own Handshake Record
 *
 * When the initiator creates a handshake, they need a local record. This is NOT
 * an incoming capsule from a counterparty — it's the initiator persisting their
 * own outgoing handshake. It must NOT go through the receive/ingestion pipeline,
 * which rejects when senderId === localUserId (ownership check).
 *
 * This module provides direct DB insert that creates the same record shape the
 * pipeline would produce for the receiver, but with local_role: 'initiator'.
 */

import type { HandshakeCapsuleWire } from './capsuleBuilder'
import type { SigningKeypair } from './signatureKeys'
import type { SSOSession, HandshakeRecord, BeapKeyAgreementMaterial } from './types'
import type { ContextBlockForCommitment } from './contextCommitment'
import { HandshakeState as HS, INPUT_LIMITS } from './types'
import { buildDefaultReceiverPolicy } from './types'
import { classifyHandshakeTier } from './tierClassification'
import { resolveEffectivePolicyFn } from './steps/policyResolution'
import { insertHandshakeRecord, insertSeenCapsuleHash, insertContextStoreEntry, updateHandshakePolicySelections } from './db'
import { validateInternalInitiateCapsuleWire } from './internalPersistence'
import type { AiProcessingMode } from '../../../../../packages/shared/src/handshake/policyUtils'
import {
  createDefaultGovernance,
  createMessageGovernance,
  baselineFromHandshake,
  baselineFromPolicySelections,
  type ContextItemGovernance,
} from './contextGovernance'

export interface PersistInitiatorResult {
  success: boolean
  error?: string
}

/**
 * Persist the initiator's handshake record directly, bypassing the receive pipeline.
 * Creates the same record the receiver would get, but with local_role: 'initiator'.
 */
export function persistInitiatorHandshakeRecord(
  db: any,
  capsule: HandshakeCapsuleWire,
  session: SSOSession,
  localBlocks: ContextBlockForCommitment[],
  keypair: SigningKeypair,
  policySelections?: { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean },
  blockPolicyMap?: Map<string, { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean }>,
  beapKeys?: BeapKeyAgreementMaterial | null,
): PersistInitiatorResult {
  try {
    if (capsule.handshake_type === 'internal') {
      const w = validateInternalInitiateCapsuleWire(capsule as unknown as Record<string, unknown>)
      if (!w.ok) {
        return { success: false, error: w.error ?? 'Internal initiate capsule invalid' }
      }
    }

    const tierDecision = classifyHandshakeTier({
      plan: session.plan,
      hardwareAttestation: session.currentHardwareAttestation,
      dnsVerification: session.currentDnsVerification,
      wrStampStatus: session.currentWrStampStatus,
    })

    const receiverPolicy = buildDefaultReceiverPolicy()
    const effectivePolicyResult = resolveEffectivePolicyFn(null, receiverPolicy)
    if ('unsatisfiable' in effectivePolicyResult) {
      return { success: false, error: 'Policy resolution failed' }
    }
    const effectivePolicy = effectivePolicyResult

    const senderP2PEndpoint: string | null =
      typeof capsule.p2p_endpoint === 'string' && capsule.p2p_endpoint.trim().length > 0
        ? capsule.p2p_endpoint.trim()
        : null
    const senderP2PAuthToken: string | null =
      typeof capsule.p2p_auth_token === 'string' && capsule.p2p_auth_token.trim().length > 0
        ? capsule.p2p_auth_token.trim()
        : null

    const record: HandshakeRecord = {
      handshake_id: capsule.handshake_id,
      relationship_id: capsule.relationship_id,
      state: HS.PENDING_ACCEPT,
      initiator: {
        email: capsule.senderIdentity.email,
        wrdesk_user_id: capsule.sender_wrdesk_user_id,
        iss: capsule.senderIdentity.iss,
        sub: capsule.senderIdentity.sub,
      },
      acceptor: null,
      local_role: 'initiator',
      sharing_mode: null,
      reciprocal_allowed: capsule.reciprocal_allowed,
      tier_snapshot: tierDecision,
      current_tier_signals: capsule.tierSignals,
      last_seq_sent: 0,
      last_seq_received: 0,
      last_capsule_hash_sent: '',
      last_capsule_hash_received: capsule.capsule_hash,
      effective_policy: effectivePolicy,
      external_processing: capsule.external_processing,
      created_at: new Date().toISOString(),
      activated_at: null,
      expires_at: new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString(),
      revoked_at: null,
      revocation_source: null,
      initiator_wrdesk_policy_hash: capsule.wrdesk_policy_hash,
      initiator_wrdesk_policy_version: capsule.wrdesk_policy_version,
      acceptor_wrdesk_policy_hash: null,
      acceptor_wrdesk_policy_version: null,
      initiator_context_commitment: capsule.context_commitment ?? null,
      acceptor_context_commitment: null,
      p2p_endpoint: senderP2PEndpoint,
      counterparty_p2p_token: senderP2PAuthToken,
      local_public_key: keypair.publicKey,
      local_private_key: keypair.privateKey,
      receiver_email: capsule.receiver_email ?? null,
      ...(beapKeys
        ? {
            local_x25519_private_key_b64: beapKeys.sender_x25519_private_key_b64,
            local_x25519_public_key_b64: beapKeys.sender_x25519_public_key_b64,
            local_mlkem768_secret_key_b64: beapKeys.sender_mlkem768_secret_key_b64,
            local_mlkem768_public_key_b64: beapKeys.sender_mlkem768_public_key_b64,
          }
        : {}),
      ...(capsule.sender_device_id?.trim()
        ? { initiator_coordination_device_id: capsule.sender_device_id.trim() }
        : {}),
      ...(capsule.handshake_type === 'internal'
        ? {
            handshake_type: 'internal',
            initiator_device_name: capsule.sender_computer_name?.trim() || null,
            initiator_device_role: capsule.sender_device_role ?? null,
            // For new pairing-code-routed initiate capsules, receiver_device_id /
            // receiver_device_role / receiver_computer_name are not present on the
            // wire — `internal_peer_pairing_code` is the sole peer identifier and is
            // verified at acceptance time. We persist nulls for the legacy peer
            // metadata so the row is intentionally pairing-code-routed.
            acceptor_coordination_device_id: capsule.receiver_device_id?.trim() || null,
            acceptor_device_name: capsule.receiver_computer_name?.trim() || null,
            acceptor_device_role: capsule.receiver_device_role ?? null,
            internal_peer_device_id: capsule.receiver_device_id?.trim() || null,
            internal_peer_device_role: capsule.receiver_device_role ?? null,
            internal_peer_computer_name: capsule.receiver_computer_name?.trim() || null,
            internal_peer_pairing_code: capsule.receiver_pairing_code?.trim() || null,
          }
        : {}),
    }

    insertHandshakeRecord(db, record)
    insertSeenCapsuleHash(db, capsule.handshake_id, capsule.capsule_hash)
    if (policySelections && ((policySelections as { ai_processing_mode?: AiProcessingMode }).ai_processing_mode !== undefined
      || (policySelections as { cloud_ai?: boolean }).cloud_ai !== undefined
      || (policySelections as { internal_ai?: boolean }).internal_ai !== undefined)) {
      updateHandshakePolicySelections(db, capsule.handshake_id, policySelections)
    }
    console.log('[HANDSHAKE] Initiator persist OK:', capsule.handshake_id, 'state=PENDING_ACCEPT')

    const relationshipId = capsule.relationship_id
    const hasPolicy = policySelections && ((policySelections as { ai_processing_mode?: AiProcessingMode }).ai_processing_mode !== undefined
      || (policySelections as { cloud_ai?: boolean }).cloud_ai !== undefined
      || (policySelections as { internal_ai?: boolean }).internal_ai !== undefined)
    const globalBaseline = hasPolicy
      ? baselineFromPolicySelections(policySelections, record.effective_policy)
      : baselineFromHandshake(record)
    const buildGov = (b: { block_id: string; type: string }): ContextItemGovernance => {
      const isMsg = b.type === 'message' || b.block_id?.startsWith('ctx-msg')
      if (isMsg) {
        return createMessageGovernance({
          publisher_id: session.wrdesk_user_id,
          sender_wrdesk_user_id: session.wrdesk_user_id,
        })
      }
      // Per-item policy: override wins over global (Phase 2). itemPolicy uses ai_processing_mode or legacy.
      const itemPolicy = blockPolicyMap?.get(b.block_id)
      const baseline = itemPolicy
        ? baselineFromPolicySelections(itemPolicy as Parameters<typeof baselineFromPolicySelections>[0], record.effective_policy)
        : globalBaseline
      return createDefaultGovernance({
        origin: 'local',
        usage_policy: { ...baseline },
        provenance: { publisher_id: session.wrdesk_user_id, sender_wrdesk_user_id: session.wrdesk_user_id },
      })
    }

    for (const block of localBlocks) {
      try {
        insertContextStoreEntry(db, {
          block_id: block.block_id,
          block_hash: block.block_hash,
          handshake_id: capsule.handshake_id,
          relationship_id: relationshipId,
          scope_id: block.scope_id ?? null,
          publisher_id: session.wrdesk_user_id,
          type: block.type,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? {}),
          status: 'pending_delivery',
          valid_until: null,
          ingested_at: null,
          superseded: 0,
          governance_json: JSON.stringify(buildGov(block)),
        })
      } catch {
        /* non-fatal — context delivery can be retried */
      }
    }

    return { success: true }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? 'Initiator persist failed',
    }
  }
}
