/**
 * Handshake enforcement entry points.
 *
 * processHandshakeCapsule: Full pipeline + atomic persistence.
 * isHandshakeActive / getEffectiveTier / authorizeAction: Query helpers.
 * resolveEffectivePolicy: Policy intersection (exported from steps too).
 *
 * IMPORTANT: processHandshakeCapsule accepts ONLY ValidatedCapsule from the
 * ingestion layer. Passing CandidateCapsuleEnvelope produces a compile error.
 */

import type {
  VerifiedCapsuleInput,
  ReceiverPolicy,
  SSOSession,
  HandshakeRecord,
  HandshakeProcessResult,
  TierDecision,
  EffectivePolicy,
  AuthorizationResult,
  ActionType,
} from './types'
import { HandshakeState as HS, INPUT_LIMITS, ReasonCode } from './types'
import type { ValidatedCapsule } from '../ingestion/types'
import { runHandshakeVerification } from './pipeline'
import { HANDSHAKE_PIPELINE } from './steps'
import { resolveEffectivePolicyFn } from './steps/policyResolution'
import { classifyHandshakeTier } from './tierClassification'
import {
  getHandshakeRecord,
  insertHandshakeRecord,
  updateHandshakeRecord,
  getSeenCapsuleHashes,
  insertSeenCapsuleHash,
  getContextBlockVersions,
  getExistingHandshakesForLookup,
  insertAuditLogEntry,
  markContextBlocksInactiveByHandshake,
} from './db'
import { ingestContextBlocks } from './contextIngestion'
import { indexCapsuleBlocks } from './capsuleBlockIndexer'
import { buildSuccessAuditEntry, buildDenialAuditEntry } from './auditLog'
import { verifyCapsuleSignature } from './signatureKeys'
import { verifyCapsuleHashIntegrity } from './steps/verifyCapsuleHash'
import { logHandshakeKeyBinding } from './keyBindingDebug'
import { getNextStateAfterInboundContextSync } from './contextSyncActiveGate'
export { getNextStateAfterInboundContextSync }
import { getP2PConfig } from '../p2p/p2pConfig'
import { registerHandshakeWithRelay } from '../p2p/relaySync'
import { retryDeferredInitialContextSyncForInternalHandshake } from './contextSyncEnqueue'
/**
 * Map ValidatedCapsule's capsule_type to the handshake layer's CapsuleType.
 * internal_draft is not a handshake capsule type — it should not reach here.
 */
function mapCapsuleTypeToHandshake(type: string): 'handshake-initiate' | 'handshake-accept' | 'handshake-refresh' | 'handshake-revoke' | 'handshake-context-sync' {
  switch (type) {
    case 'initiate': return 'handshake-initiate'
    case 'accept': return 'handshake-accept'
    case 'refresh': return 'handshake-refresh'
    case 'revoke': return 'handshake-revoke'
    case 'context_sync': return 'handshake-context-sync'
    default: throw new Error(`Cannot map capsule_type "${type}" to handshake type`)
  }
}

/** Accept capsule may carry key agreement fields at top level or nested (relay / transport). */
function extractAcceptCapsuleSenderKeyMaterial(capsuleObj: Record<string, any>): {
  senderX25519: string | null
  senderMlkem768: string | null
} {
  const pick = (o: any, k: string): string | null => {
    if (!o || typeof o !== 'object') return null
    const v = o[k]
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
  }
  let senderX25519 = pick(capsuleObj, 'sender_x25519_public_key_b64')
  let senderMlkem768 = pick(capsuleObj, 'sender_mlkem768_public_key_b64')
  if (!senderX25519) senderX25519 = pick(capsuleObj?.capsule, 'sender_x25519_public_key_b64')
  if (!senderMlkem768) senderMlkem768 = pick(capsuleObj?.capsule, 'sender_mlkem768_public_key_b64')
  if (!senderX25519) senderX25519 = pick(capsuleObj?.payload, 'sender_x25519_public_key_b64')
  if (!senderMlkem768) senderMlkem768 = pick(capsuleObj?.payload, 'sender_mlkem768_public_key_b64')
  return { senderX25519, senderMlkem768 }
}

/**
 * Direct UPDATE so `peer_*` match the accept capsule (acceptor's public keys on initiator row).
 * Runs inside the same transaction as `updateHandshakeRecord` for accept.
 */
function forcePeerKeysFromAcceptCapsule(
  db: any,
  handshakeId: string,
  peerX25519: string | null,
  peerMlkem: string | null,
): void {
  if (peerX25519 && typeof peerX25519 === 'string' && peerX25519.trim().length > 20) {
    db.prepare(`UPDATE handshakes SET peer_x25519_public_key_b64 = ? WHERE handshake_id = ?`).run(
      peerX25519.trim(),
      handshakeId,
    )
    console.log('[HANDSHAKE-FIX] Forced peer X25519 from accept:', peerX25519.substring(0, 20))
  }
  if (peerMlkem && typeof peerMlkem === 'string' && peerMlkem.trim().length > 100) {
    db.prepare(`UPDATE handshakes SET peer_mlkem768_public_key_b64 = ? WHERE handshake_id = ?`).run(
      peerMlkem.trim(),
      handshakeId,
    )
    console.log('[HANDSHAKE-FIX] Forced peer ML-KEM from accept:', peerMlkem.substring(0, 20))
  }
}

/**
 * Extract a VerifiedCapsuleInput from a ValidatedCapsule.
 * The ValidatedCapsule carries the validated payload as a generic object;
 * we project it into the strongly-typed shape expected by the frozen pipeline.
 */
function extractVerifiedInput(validated: ValidatedCapsule): VerifiedCapsuleInput {
  const c = validated.capsule as Record<string, any>
  return {
    schema_version: c.schema_version ?? 1,
    capsule_hash: c.capsule_hash ?? '',
    context_hash: c.context_hash ?? '',
    context_commitment: c.context_commitment ?? null,
    nonce: c.nonce ?? '',
    senderIdentity: c.senderIdentity ?? {
      email: c.sender_email ?? '',
      iss: c.iss ?? '',
      sub: c.sub ?? c.sender_id ?? '',
      email_verified: true,
      wrdesk_user_id: c.sender_wrdesk_user_id ?? c.sender_id ?? '',
    },
    receiverIdentity: c.receiverIdentity ?? null,
    signatureValid: true,
    containerIntegrityValid: true,
    sender_wrdesk_user_id: c.sender_wrdesk_user_id ?? c.sender_id ?? '',
    sender_email: c.sender_email ?? c.senderIdentity?.email ?? '',
    receiver_id: c.receiver_id ?? '',
    receiver_email: c.receiver_email ?? '',
    capsuleType: mapCapsuleTypeToHandshake(c.capsule_type),
    handshake_id: c.handshake_id ?? '',
    seq: c.seq ?? 0,
    prev_hash: c.prev_hash,
    timestamp: c.timestamp ?? new Date().toISOString(),
    relationship_id: c.relationship_id ?? '',
    scopes: c.scopes,
    context_block_proofs: c.context_block_proofs ?? [],
    capsulePolicy: c.capsulePolicy,
    expires_at: c.expires_at,
    sharing_mode: c.sharing_mode,
    external_processing: c.external_processing ?? 'none',
    cloud_payload_mode: c.cloud_payload_mode,
    cloud_payload_bytes: c.cloud_payload_bytes,
    reciprocal_allowed: c.reciprocal_allowed ?? false,
    tierSignals: c.tierSignals ?? { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
    claimedTier: c.claimedTier,
    preview: c.preview,
    wrdesk_policy_hash: c.wrdesk_policy_hash ?? '',
    wrdesk_policy_version: c.wrdesk_policy_version ?? '',
    handshake_type: c.handshake_type ?? null,
    sender_device_id: typeof c.sender_device_id === 'string' ? c.sender_device_id : null,
    receiver_device_id: typeof c.receiver_device_id === 'string' ? c.receiver_device_id : null,
    sender_device_role: c.sender_device_role === 'host' || c.sender_device_role === 'sandbox' ? c.sender_device_role : null,
    receiver_device_role: c.receiver_device_role === 'host' || c.receiver_device_role === 'sandbox' ? c.receiver_device_role : null,
    sender_computer_name: typeof c.sender_computer_name === 'string' ? c.sender_computer_name : null,
    receiver_computer_name: typeof c.receiver_computer_name === 'string' ? c.receiver_computer_name : null,
    receiver_pairing_code:
      typeof c.receiver_pairing_code === 'string' && /^\d{6}$/.test(c.receiver_pairing_code.trim())
        ? c.receiver_pairing_code.trim()
        : null,
  }
}

export function processHandshakeCapsule(
  db: any,
  validated: ValidatedCapsule,
  receiverPolicy: ReceiverPolicy,
  ssoSession: SSOSession,
): HandshakeProcessResult {
  // Runtime guard: reject any input that did not pass through the Validator.
  // This catches forged objects, `as ValidatedCapsule` casts, and prototype-hacked inputs.
  if (
    !validated ||
    typeof validated !== 'object' ||
    (validated as any).__brand !== 'ValidatedCapsule' ||
    typeof (validated as any).validated_at !== 'string' ||
    typeof (validated as any).validator_version !== 'string' ||
    !(validated as any).provenance ||
    !(validated as any).capsule
  ) {
    try {
      insertAuditLogEntry(db, {
        timestamp: new Date().toISOString(),
        action: 'VALIDATION_BYPASS_ATTEMPT',
        reason_code: 'VALIDATION_BYPASS_ATTEMPT',
        metadata: { brand: (validated as any)?.__brand ?? 'missing' },
      })
    } catch { /* audit failure must not mask guard */ }
    return {
      success: false,
      reason: ReasonCode.INTERNAL_ERROR,
      failedStep: 'runtime_brand_guard',
      pipelineDurationMs: 0,
    }
  }

  const input = extractVerifiedInput(validated)
  const startTime = performance.now()
  const capsuleObj = validated.capsule as Record<string, any>
  const senderPublicKey = typeof capsuleObj?.sender_public_key === 'string' ? capsuleObj.sender_public_key : ''
  const senderSignature = typeof capsuleObj?.sender_signature === 'string' ? capsuleObj.sender_signature : ''
  const countersignedHash = typeof capsuleObj?.countersigned_hash === 'string' ? capsuleObj.countersigned_hash : ''

  // 0a. capsule_hash verification (BEFORE signature — signature is over the hash)
  const hashFailure = verifyCapsuleHashIntegrity(input)
  if (hashFailure) {
    try {
      insertAuditLogEntry(db, buildDenialAuditEntry(input, hashFailure, 'verify_capsule_hash', 0))
    } catch { /* audit must not mask */ }
    return {
      success: false,
      reason: hashFailure,
      failedStep: 'verify_capsule_hash',
      pipelineDurationMs: Math.round(performance.now() - startTime),
    }
  }

  // 0b. Signature verification (before pipeline)
  const handshakeRecord = getHandshakeRecord(db, input.handshake_id)
  if (!verifyCapsuleSignature(input.capsule_hash, senderSignature, senderPublicKey)) {
    try {
      insertAuditLogEntry(db, buildDenialAuditEntry(input, ReasonCode.SIGNATURE_INVALID, 'signature_verification', 0))
    } catch { /* audit must not mask */ }
    return {
      success: false,
      reason: ReasonCode.SIGNATURE_INVALID,
      failedStep: 'signature_verification',
      pipelineDurationMs: Math.round(performance.now() - startTime),
    }
  }

  if (input.capsuleType === 'handshake-accept' && countersignedHash) {
    const initiatorHash = handshakeRecord?.last_capsule_hash_received ?? ''
    if (!initiatorHash || !verifyCapsuleSignature(initiatorHash, countersignedHash, senderPublicKey)) {
      try {
        insertAuditLogEntry(db, buildDenialAuditEntry(input, ReasonCode.COUNTERSIGNATURE_INVALID, 'countersignature_verification', 0))
      } catch { /* audit must not mask */ }
      return {
        success: false,
        reason: ReasonCode.COUNTERSIGNATURE_INVALID,
        failedStep: 'countersignature_verification',
        pipelineDurationMs: Math.round(performance.now() - startTime),
      }
    }
  }

  if (
    (input.capsuleType === 'handshake-refresh' || input.capsuleType === 'handshake-revoke' || input.capsuleType === 'handshake-context-sync') &&
    handshakeRecord?.counterparty_public_key
  ) {
    logHandshakeKeyBinding({
      source_function: 'processHandshakeCapsule:counterparty_ed25519_verify',
      handshake_id: input.handshake_id,
      local_role: handshakeRecord.local_role,
      capsule_type: input.capsuleType,
      old_counterparty: handshakeRecord.counterparty_public_key,
      new_counterparty: handshakeRecord.counterparty_public_key,
      sender_public_key: senderPublicKey,
      record: handshakeRecord,
    })
    if (senderPublicKey !== handshakeRecord.counterparty_public_key) {
      console.error('[HANDSHAKE] SIGNATURE_INVALID key mismatch:', {
        capsuleType: input.capsuleType,
        handshake_id: input.handshake_id,
        senderPublicKey_first16: senderPublicKey?.slice(0, 16),
        storedCounterparty_first16: handshakeRecord.counterparty_public_key?.slice(0, 16),
        match: senderPublicKey === handshakeRecord.counterparty_public_key,
      })
      try {
        insertAuditLogEntry(db, buildDenialAuditEntry(input, ReasonCode.SIGNATURE_INVALID, 'signature_verification', 0))
      } catch { /* audit must not mask */ }
      return {
        success: false,
        reason: ReasonCode.SIGNATURE_INVALID,
        failedStep: 'signature_verification',
        pipelineDurationMs: Math.round(performance.now() - startTime),
      }
    }
  }

  // 1. Determine mode: create or update

  // 2. Pre-load lookups for pipeline
  const seenHashes = getSeenCapsuleHashes(db, input.handshake_id)
  const blockVersions = getContextBlockVersions(db, input.handshake_id)
  const existingHandshakes = getExistingHandshakesForLookup(db)

  // 3. Run pipeline
  const pipelineResult = runHandshakeVerification(
    HANDSHAKE_PIPELINE,
    input,
    receiverPolicy,
    ssoSession,
    handshakeRecord,
    {
      seenCapsuleHashes: seenHashes,
      contextBlockVersions: blockVersions,
      existingHandshakes,
      localUserId: ssoSession.wrdesk_user_id,
    },
  )

  const durationMs = Math.round(performance.now() - startTime)

  if (!pipelineResult.success) {
    // Log the actual error so it appears in the main process console
    console.error('[HANDSHAKE] Pipeline rejected:', {
      capsuleType: input.capsuleType,
      handshake_id: input.handshake_id,
      seq: input.seq,
      failedStep: pipelineResult.failedStep,
      reason: pipelineResult.reason,
      error: (pipelineResult as any).error?.message ?? (pipelineResult as any).error,
    })
    if ((pipelineResult as any).error) {
      console.error('[HANDSHAKE] Pipeline INTERNAL_ERROR at step:', pipelineResult.failedStep, (pipelineResult as any).error)
    }

    // Log denial
    try {
      insertAuditLogEntry(db, buildDenialAuditEntry(
        input, pipelineResult.reason, pipelineResult.failedStep, durationMs,
      ))
    } catch {
      // Audit log failure must not mask pipeline denial
    }

    return {
      success: false,
      reason: pipelineResult.reason,
      failedStep: pipelineResult.failedStep,
      pipelineDurationMs: durationMs,
    }
  }

  // 4. Build effective policy
  const effectivePolicy = resolveEffectivePolicyFn(input.capsulePolicy, receiverPolicy)
  if ('unsatisfiable' in effectivePolicy) {
    return {
      success: false,
      reason: effectivePolicy.reason,
      failedStep: 'resolve_effective_policy',
      pipelineDurationMs: durationMs,
    }
  }

  const tierDecision = pipelineResult.context.tierDecision!

  // 5. Compute record mutations
  let record: HandshakeRecord
  let blocksStored = 0

  // 6. Atomic transaction: all mutations in a single BEGIN IMMEDIATE
  //    Context ingestion is a HARD GATE: if ingestion fails (commitment
  //    mismatch, SQLite error, etc.), the entire transaction rolls back
  //    and the handshake does NOT transition to active.
  const senderP2PEndpoint: string | null =
    (typeof capsuleObj?.p2p_endpoint === 'string' && capsuleObj.p2p_endpoint.trim().length > 0)
      ? capsuleObj.p2p_endpoint.trim()
      : null
  const senderP2PAuthToken: string | null =
    (typeof capsuleObj?.p2p_auth_token === 'string' && capsuleObj.p2p_auth_token.trim().length > 0)
      ? capsuleObj.p2p_auth_token.trim()
      : null

  let senderX25519: string | null
  let senderMlkem768: string | null
  if (input.capsuleType === 'handshake-accept') {
    const ext = extractAcceptCapsuleSenderKeyMaterial(capsuleObj)
    senderX25519 = ext.senderX25519
    senderMlkem768 = ext.senderMlkem768
    console.log('[HANDSHAKE-ACCEPT-RECV] Keys extracted from accept capsule:', {
      x25519: senderX25519?.substring(0, 20) || 'NULL',
      mlkem: senderMlkem768?.substring(0, 20) || 'NULL',
      capsuleKeys: Object.keys(capsuleObj || {}).filter(
        (k) => k.includes('x25519') || k.includes('mlkem') || k.includes('MLKEM'),
      ),
    })
  } else {
    senderX25519 =
      typeof capsuleObj?.sender_x25519_public_key_b64 === 'string' && capsuleObj.sender_x25519_public_key_b64.trim().length > 0
        ? capsuleObj.sender_x25519_public_key_b64.trim()
        : null
    senderMlkem768 =
      typeof capsuleObj?.sender_mlkem768_public_key_b64 === 'string' && capsuleObj.sender_mlkem768_public_key_b64.trim().length > 0
        ? capsuleObj.sender_mlkem768_public_key_b64.trim()
        : null
  }

  const tx = db.transaction(() => {
    if (input.capsuleType === 'handshake-initiate') {
      record = buildInitiateRecord(input, ssoSession, tierDecision, effectivePolicy, senderP2PEndpoint, senderP2PAuthToken, senderPublicKey, senderX25519, senderMlkem768)
      insertHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-accept') {
      record = buildAcceptRecord(handshakeRecord!, input, ssoSession, tierDecision, effectivePolicy, senderP2PEndpoint, senderP2PAuthToken, senderPublicKey, senderX25519, senderMlkem768)
      updateHandshakeRecord(db, record)
      // Only the initiator's DB row should force peer_* from the accept capsule (acceptor's pub keys).
      // On the acceptor, peer_* must remain the initiator's keys — never run the UPDATE with acceptor sender material.
      if (handshakeRecord!.local_role === 'initiator') {
        forcePeerKeysFromAcceptCapsule(db, input.handshake_id, senderX25519, senderMlkem768)
      }
    } else if (input.capsuleType === 'handshake-refresh') {
      record = buildRefreshRecord(handshakeRecord!, input, tierDecision)
      updateHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-context-sync') {
      // context-sync updates seq/hash like refresh; context_blocks ingested below
      console.log('[HANDSHAKE] context_sync processing:', {
        handshake_id: input.handshake_id,
        incoming_seq: input.seq,
        state_before: handshakeRecord?.state,
        context_sync_pending: (handshakeRecord as any)?.context_sync_pending,
        last_seq_sent: handshakeRecord?.last_seq_sent,
        last_seq_received: handshakeRecord?.last_seq_received,
        last_capsule_hash_received: handshakeRecord?.last_capsule_hash_received,
        incoming_prev_hash: (capsuleObj as any)?.prev_hash,
      })
      record = buildContextSyncRecord(handshakeRecord!, input)
      console.log(
        '[HANDSHAKE] context_sync result state:',
        record.state,
        'ownDurableContextSync=',
        (handshakeRecord as any)?.last_seq_sent >= 1,
        'last_seq_sent=',
        (handshakeRecord as any)?.last_seq_sent,
      )
      updateHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-revoke') {
      record = buildRevokeRecord(handshakeRecord!, input)
      updateHandshakeRecord(db, record)
      markContextBlocksInactiveByHandshake(db, input.handshake_id)
    } else {
      throw new Error(`Unknown capsuleType: ${input.capsuleType}`)
    }

    // Context block ingestion — mandatory hard gate.
    // For accept/refresh/initiate: if context_blocks are present, they MUST
    // be ingested successfully. Failure throws, which rolls back the entire
    // transaction (including state transitions).
    const rawContextBlocks = capsuleObj?.context_blocks
    const capsuleContextCommitment = capsuleObj?.context_commitment ?? null

    // Edge case: stored commitment exists but capsule has no context_blocks → REJECT
    // Note: context_sync is excluded — it is the delivery mechanism itself and may send
    // empty blocks if all were filtered by policy or not yet available.
    if (input.capsuleType === 'handshake-refresh') {
      const existing = handshakeRecord!
      const senderId = input.sender_wrdesk_user_id
      const isInitiator = senderId === existing.initiator.wrdesk_user_id
      const storedCommitment = isInitiator ? existing.initiator_context_commitment : existing.acceptor_context_commitment
      const hasBlocks = Array.isArray(rawContextBlocks) && rawContextBlocks.length > 0
      if (storedCommitment !== null && !hasBlocks) {
        console.warn('[HANDSHAKE] CONTEXT_COMMITMENT_MISMATCH', {
          handshake_id: input.handshake_id,
          sender_role: isInitiator ? 'initiator' : 'acceptor',
          failure_type: 'stored_commitment_exists_but_capsule_has_no_blocks',
        })
        throw new Error('CONTEXT_COMMITMENT_MISMATCH: stored commitment exists but capsule has no context_blocks')
      }
    }

    if (Array.isArray(rawContextBlocks) && rawContextBlocks.length > 0) {
      // DB comparison: verify capsule's context_commitment matches what the sender
      // originally promised during handshake (initiate/accept). Prevents attacker
      // from sending different context_blocks with a freshly computed valid
      // context_commitment — both internally consistent but not what was promised.
      // Skip for initiate/accept (creating the stored value) and context_sync
      // (context_sync is the delivery vehicle; blocks may differ from the initiate
      // commitment due to policy filtering — commitment is verified block-by-block).
      if (input.capsuleType === 'handshake-refresh') {
        const existing = handshakeRecord!
        const senderId = input.sender_wrdesk_user_id
        const isInitiator = senderId === existing.initiator.wrdesk_user_id
        const senderRole = isInitiator ? 'initiator' : 'acceptor'
        const storedCommitment = isInitiator
          ? existing.initiator_context_commitment
          : existing.acceptor_context_commitment

        if (storedCommitment === null) {
          console.warn('[HANDSHAKE] CONTEXT_COMMITMENT_MISMATCH', {
            handshake_id: input.handshake_id,
            sender_role: senderRole,
            failure_type: 'stored_commitment_null_but_capsule_has_blocks',
          })
          throw new Error('CONTEXT_COMMITMENT_MISMATCH: stored commitment is null but capsule carries context_blocks')
        }
        if (capsuleContextCommitment !== storedCommitment) {
          console.warn('[HANDSHAKE] CONTEXT_COMMITMENT_MISMATCH', {
            handshake_id: input.handshake_id,
            sender_role: senderRole,
            failure_type: 'commitment_mismatch',
          })
          throw new Error('CONTEXT_COMMITMENT_MISMATCH: capsule context_commitment does not match stored handshake commitment')
        }
      }

      const ingestionResult = ingestContextBlocks(db, {
        handshake_id: input.handshake_id,
        relationship_id: input.relationship_id,
        context_commitment: capsuleContextCommitment,
        context_blocks: rawContextBlocks,
        publisher_id: input.sender_wrdesk_user_id,
      })
      blocksStored = ingestionResult.inserted
    } else {
      const proofs = input.context_block_proofs ?? []
      blocksStored = proofs.length
    }

    // Dedup hash
    insertSeenCapsuleHash(db, input.handshake_id, input.capsule_hash)

    // Audit log
    insertAuditLogEntry(db, buildSuccessAuditEntry(input, record!, durationMs, blocksStored))
  })

  try {
    tx()
    if (input.capsuleType === 'handshake-accept') {
      const r = getHandshakeRecord(db, input.handshake_id)
      if (r?.handshake_type === 'internal' && r.local_role === 'initiator' && r.state === HS.ACCEPTED) {
        scheduleInternalInitiatorPostAcceptCoordinationRepair(db, input.handshake_id, ssoSession)
      }
    }
    // Index blocks into capsule_blocks for query-time search (no parsing at query).
    // Fire-and-forget: indexing runs after commit; failures are logged, not surfaced.
    if (blocksStored > 0) {
      const vs = (globalThis as any).__og_vault_service_ref as { getEmbeddingService?: () => any } | undefined
      const embeddingService = vs?.getEmbeddingService?.()
      if (embeddingService) {
        indexCapsuleBlocks(db, input.handshake_id, input.relationship_id, embeddingService)
          .then((r) => {
            if (r.indexed > 0) console.log('[HANDSHAKE] capsule_blocks indexed:', r.indexed, 'handshake=', input.handshake_id)
          })
          .catch((err) => console.warn('[HANDSHAKE] capsule_blocks indexing failed:', err?.message ?? err))
      }
    }
  } catch (txErr: any) {
    const errMsg: string = txErr?.message ?? String(txErr)
    console.error('[HANDSHAKE] atomic_transaction error:', errMsg, txErr)

    const isCommitmentMismatch = errMsg.includes('CONTEXT_COMMITMENT_MISMATCH')
    const isIngestionFailure = errMsg.includes('Context commitment') ||
      errMsg.includes('context_commitment') || isCommitmentMismatch

    try {
      insertAuditLogEntry(db, buildDenialAuditEntry(
        input,
        isCommitmentMismatch ? ReasonCode.CONTEXT_COMMITMENT_MISMATCH : (isIngestionFailure ? ReasonCode.CONTEXT_HASH_MISMATCH : ReasonCode.INTERNAL_ERROR),
        isIngestionFailure ? 'context_ingestion' : 'atomic_transaction',
        durationMs,
      ))
    } catch { /* audit must not mask */ }

    return {
      success: false,
      reason: isCommitmentMismatch ? ReasonCode.CONTEXT_COMMITMENT_MISMATCH : (isIngestionFailure ? ReasonCode.CONTEXT_HASH_MISMATCH : ReasonCode.INTERNAL_ERROR),
      failedStep: isIngestionFailure ? 'context_ingestion' : 'atomic_transaction',
      detail: errMsg,
      pipelineDurationMs: durationMs,
    }
  }

  return {
    success: true,
    handshakeRecord: record!,
    blocksStored,
    tierDecision,
    pipelineDurationMs: durationMs,
  }
}

// ── Query Helpers ──

export function isHandshakeActive(db: any, handshakeId: string, now: Date): boolean {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return false
  if (record.state !== HS.ACTIVE) return false
  return true
}

/**
 * Explains why a handshake is not eligible for operations that require isHandshakeActive.
 * Does not change isHandshakeActive semantics — use for user-facing diagnostics only.
 */
export function diagnoseHandshakeInactive(
  db: any,
  handshakeId: string,
  now: Date,
): { active: true } | { active: false; reason: string } {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return { active: false, reason: 'Handshake not found' }
  if (record.state !== HS.ACTIVE) {
    return { active: false, reason: `Handshake is in state '${record.state}', expected 'ACTIVE'` }
  }
  return { active: true }
}

export function getEffectiveTier(
  db: any,
  handshakeId: string,
  currentSSOSession: SSOSession,
): TierDecision | null {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return null

  return classifyHandshakeTier({
    plan: currentSSOSession.plan,
    hardwareAttestation: currentSSOSession.currentHardwareAttestation,
    dnsVerification: currentSSOSession.currentDnsVerification,
    wrStampStatus: currentSSOSession.currentWrStampStatus,
  })
}

export function authorizeAction(
  db: any,
  handshakeId: string,
  actionType: ActionType,
  requestedScopes: string[],
  now: Date,
): AuthorizationResult {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return { allowed: false, reason: ReasonCode.HANDSHAKE_NOT_FOUND }
  if (record.state !== HS.ACTIVE) return { allowed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }

  // Sharing mode enforcement for write-context
  if (actionType === 'write-context') {
    if (record.sharing_mode === 'receive-only' && record.local_role === 'acceptor') {
      return { allowed: false, reason: ReasonCode.SHARING_MODE_VIOLATION }
    }
  }

  // Scope check
  const policy = record.effective_policy
  if (!policy.allowedScopes.includes('*')) {
    for (const scope of requestedScopes) {
      if (!policy.allowedScopes.includes(scope)) {
        return { allowed: false, reason: ReasonCode.SCOPE_ESCALATION }
      }
    }
  }

  // Cloud escalation check
  if (actionType === 'cloud-escalation' && !policy.allowsCloudEscalation) {
    return { allowed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
  }

  // Export check
  if (actionType === 'export-context' && !policy.allowsExport) {
    return { allowed: false, reason: ReasonCode.POLICY_VIOLATION }
  }

  return { allowed: true, reason: ReasonCode.OK }
}

export { resolveEffectivePolicyFn as resolveEffectivePolicy }

// ── Record Builders (internal) ──

/** Use capsule expires_at only if it is in the future; otherwise default to PENDING_TIMEOUT. Prevents "expired" on import when capsule has stale expires_at. */
function resolveExpiresAt(capsuleExpiresAt: string | undefined): string {
  if (!capsuleExpiresAt) return new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString()
  const parsed = Date.parse(capsuleExpiresAt)
  if (isNaN(parsed) || parsed <= Date.now()) return new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString()
  return capsuleExpiresAt
}

function buildInitiateRecord(
  input: VerifiedCapsuleInput,
  _ssoSession: SSOSession,
  tierDecision: TierDecision,
  effectivePolicy: EffectivePolicy,
  p2pEndpoint: string | null,
  counterpartyP2PToken: string | null,
  senderPublicKey: string,
  senderX25519: string | null,
  senderMlkem768: string | null,
): HandshakeRecord {
  const newCounterparty = senderPublicKey || null
  logHandshakeKeyBinding({
    source_function: 'buildInitiateRecord',
    handshake_id: input.handshake_id,
    local_role: 'acceptor',
    capsule_type: 'initiate',
    old_counterparty: null,
    new_counterparty: newCounterparty,
    sender_public_key: senderPublicKey,
    record: null,
  })
  return {
    handshake_id: input.handshake_id,
    relationship_id: input.relationship_id,
    state: HS.PENDING_REVIEW,
    initiator: {
      email: input.senderIdentity.email,
      wrdesk_user_id: input.sender_wrdesk_user_id,
      iss: input.senderIdentity.iss,
      sub: input.senderIdentity.sub,
    },
    acceptor: null,
    local_role: 'acceptor',
    sharing_mode: null,
    reciprocal_allowed: input.reciprocal_allowed,
    tier_snapshot: tierDecision,
    current_tier_signals: input.tierSignals,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: input.capsule_hash,
    effective_policy: effectivePolicy,
    external_processing: input.external_processing,
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: resolveExpiresAt(input.expires_at),
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: input.wrdesk_policy_hash,
    initiator_wrdesk_policy_version: input.wrdesk_policy_version,
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: input.context_commitment ?? null,
    acceptor_context_commitment: null,
    p2p_endpoint: p2pEndpoint,
    counterparty_p2p_token: counterpartyP2PToken,
    counterparty_public_key: newCounterparty,
    peer_x25519_public_key_b64: senderX25519,
    peer_mlkem768_public_key_b64: senderMlkem768,
    receiver_email: input.receiver_email || null,
    ...(input.handshake_type === 'internal'
      ? {
          handshake_type: 'internal' as const,
          initiator_coordination_device_id: input.sender_device_id?.trim() || null,
          acceptor_coordination_device_id: input.receiver_device_id?.trim() || null,
          initiator_device_name: input.sender_computer_name?.trim() || null,
          acceptor_device_name: input.receiver_computer_name?.trim() || null,
          initiator_device_role: input.sender_device_role ?? null,
          acceptor_device_role: input.receiver_device_role ?? null,
          internal_peer_device_id: input.receiver_device_id?.trim() || null,
          internal_peer_device_role: input.receiver_device_role ?? null,
          internal_peer_computer_name: input.receiver_computer_name?.trim() || null,
          // Pairing-code initiate carries `receiver_pairing_code` on the wire as the
          // sole peer identifier. Persist it here so the AcceptHandshakeModal /
          // handshake.accept comparison works regardless of which ingestion path
          // (file-import vs coordination-relay) created the record.
          internal_peer_pairing_code:
            typeof input.receiver_pairing_code === 'string' && /^\d{6}$/.test(input.receiver_pairing_code.trim())
              ? input.receiver_pairing_code.trim()
              : null,
        }
      : {}),
  }
}

function buildAcceptRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
  _ssoSession: SSOSession,
  _tierDecision: TierDecision,
  effectivePolicy: EffectivePolicy,
  p2pEndpoint: string | null,
  counterpartyP2PToken: string | null,
  senderPublicKey: string,
  senderX25519: string | null,
  senderMlkem768: string | null,
): HandshakeRecord {
  // Accept capsule `sender_*` wire keys are the ACCEPTOR's handshake public keys.
  // - Initiator row: peer_* MUST become those keys (counterparty is the acceptor).
  // - Acceptor row: peer_* MUST stay the INITIATOR's keys from the initiate capsule.
  //   Self-processing the accept capsule would wrongly set peer_* to our own public keys
  //   (same as local_*), so qBEAP encrypt-to-peer uses the wrong recipient keys.
  // Internal (same-principal, device-routed) handshakes use the same rule: role distinguishes
  // devices, not wrdesk_user_id — initiator device ingesting accept updates peer to the other device.
  const shouldUpdatePeerFromAcceptCapsule = existing.local_role === 'initiator'

  console.log('[HANDSHAKE-ACCEPT-PROCESS] Accept capsule peer key update:', {
    handshakeId: existing.handshake_id,
    localRole: existing.local_role,
    shouldUpdatePeerFromAcceptCapsule,
    senderX25519: senderX25519?.substring(0, 20) || 'NULL',
    senderMlkem768: senderMlkem768?.substring(0, 20) || 'NULL',
    existingPeerX25519: existing.peer_x25519_public_key_b64?.substring(0, 20) || 'NULL',
    existingPeerMlkem: existing.peer_mlkem768_public_key_b64?.substring(0, 20) || 'NULL',
  })

  // counterparty_public_key = remote party's Ed25519 signing key (inbound verify expects this).
  // Accept capsule `sender_public_key` is the ACCEPTOR's key — use it only on the initiator row
  // to store the acceptor. On the acceptor row, `senderPublicKey` is our own; never use it here.
  const existingCp = existing.counterparty_public_key?.trim() ?? ''
  const newCounterpartyAccept: string | null =
    existing.local_role === 'initiator'
      ? (existingCp.length > 0 ? existing.counterparty_public_key!.trim() : senderPublicKey)
      : (existingCp.length > 0 ? existing.counterparty_public_key!.trim() : null)
  logHandshakeKeyBinding({
    source_function: 'buildAcceptRecord',
    handshake_id: existing.handshake_id,
    local_role: existing.local_role,
    capsule_type: 'accept',
    old_counterparty: existing.counterparty_public_key,
    new_counterparty: newCounterpartyAccept,
    sender_public_key: senderPublicKey,
    record: existing,
  })

  const next: HandshakeRecord = {
    ...existing,
    state: HS.ACCEPTED,  // ACTIVE only after context roundtrip (see buildContextSyncRecord)
    acceptor: {
      email: input.senderIdentity.email,
      wrdesk_user_id: input.sender_wrdesk_user_id,
      iss: input.senderIdentity.iss,
      sub: input.senderIdentity.sub,
    },
    sharing_mode: input.sharing_mode!,
    tier_snapshot: existing.tier_snapshot,
    current_tier_signals: input.tierSignals,
    last_seq_received: 0,
    last_capsule_hash_received: input.capsule_hash,
    effective_policy: effectivePolicy,
    external_processing: effectivePolicy.effectiveExternalProcessing,
    activated_at: new Date().toISOString(),
    expires_at: resolveExpiresAt(input.expires_at ?? existing.expires_at),
    acceptor_wrdesk_policy_hash: input.wrdesk_policy_hash,
    acceptor_wrdesk_policy_version: input.wrdesk_policy_version,
    acceptor_context_commitment: input.context_commitment ?? null,
    p2p_endpoint: existing.p2p_endpoint ?? p2pEndpoint,
    counterparty_p2p_token: counterpartyP2PToken ?? existing.counterparty_p2p_token,
    // Acceptor: counterparty stays the initiator's key from initiate; never the local acceptor sender key.
    // Initiator: set to acceptor's key from this capsule when not already stored.
    counterparty_public_key: newCounterpartyAccept,
    peer_x25519_public_key_b64: shouldUpdatePeerFromAcceptCapsule
      ? (senderX25519 ?? existing.peer_x25519_public_key_b64 ?? null)
      : (existing.peer_x25519_public_key_b64 ?? null),
    peer_mlkem768_public_key_b64: shouldUpdatePeerFromAcceptCapsule
      ? (senderMlkem768 ?? existing.peer_mlkem768_public_key_b64 ?? null)
      : (existing.peer_mlkem768_public_key_b64 ?? null),
  }

  if (existing.handshake_type === 'internal' && existing.local_role === 'initiator') {
    // Initiator row: on internal accept, wire `sender_*` is the acceptor’s coordination identity.
    const acceptorDev = input.sender_device_id?.trim() || undefined
    const acceptorRole = input.sender_device_role ?? undefined
    const acceptorName = input.sender_computer_name?.trim() || undefined
    return {
      ...next,
      // Fields: acceptor coordination endpoint + `finalizeInternalHandshakePersistence` → internal_coordination_identity_complete
      acceptor_coordination_device_id: acceptorDev ?? next.acceptor_coordination_device_id ?? null,
      acceptor_device_role: acceptorRole ?? next.acceptor_device_role ?? null,
      acceptor_device_name: acceptorName ?? next.acceptor_device_name ?? null,
      internal_peer_device_id: acceptorDev ?? next.internal_peer_device_id ?? null,
      internal_peer_device_role: acceptorRole ?? next.internal_peer_device_role ?? null,
      internal_peer_computer_name: acceptorName ?? next.internal_peer_computer_name ?? null,
    }
  }
  return next
}

/**
 * After initiator ingests an internal accept, coordination routing may be complete and relay
 * may need a second register-handshake (acceptor device id was unknown at initiate). Fire-and-forget
 * to avoid static import of ipc (ipc imports enforcement for authorize). Then retry deferred
 * initial context_sync.
 */
function scheduleInternalInitiatorPostAcceptCoordinationRepair(
  db: any,
  handshakeId: string,
  ssoSession: SSOSession,
): void {
  setImmediate(() => {
    void (async () => {
      try {
        const ipc = await import('./ipc')
        const getToken = () => ipc.getCoordinationOidcToken()
        const rec = getHandshakeRecord(db, handshakeId)
        if (!rec) return
        if (rec.handshake_type !== 'internal' || rec.local_role !== 'initiator' || rec.state !== HS.ACCEPTED) {
          return
        }
        if (!rec.acceptor) {
          return
        }

        const cfg = getP2PConfig(db)
        if (
          cfg.relay_mode !== 'disabled' &&
          cfg.use_coordination &&
          rec.internal_coordination_identity_complete === true
        ) {
          const iid = rec.initiator_coordination_device_id?.trim() ?? ''
          const aid = rec.acceptor_coordination_device_id?.trim() ?? ''
          if (iid && aid) {
            const reg = await registerHandshakeWithRelay(
              db,
              handshakeId,
              '',
              rec.acceptor.email ?? rec.initiator.email,
              getToken,
              {
                initiator_user_id: ssoSession.sub,
                acceptor_user_id: ssoSession.sub,
                initiator_email: rec.initiator.email,
                acceptor_email: rec.acceptor.email,
                initiator_device_id: iid,
                acceptor_device_id: aid,
                handshake_type: 'internal',
              },
            )
            if (!reg.success) {
              console.warn('[HANDSHAKE] Post-accept relay re-register (initiator, repair):', reg.error, handshakeId)
            }
          }
        }

        const session = ipc.getCurrentSession() ?? ssoSession
        // Exact retry: deferred initial context_sync (e.g. INTERNAL_RELAY_ENDPOINTS_INCOMPLETE) for this id only
        retryDeferredInitialContextSyncForInternalHandshake(db, handshakeId, session, getToken)
      } catch (e: any) {
        console.warn('[HANDSHAKE] scheduleInternalInitiatorPostAcceptCoordinationRepair:', e?.message ?? e)
      }
    })()
  })
}

function buildRefreshRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
  _tierDecision: TierDecision,
): HandshakeRecord {
  return {
    ...existing,
    current_tier_signals: input.tierSignals,
    last_seq_received: input.seq,
    last_capsule_hash_received: input.capsule_hash,
  }
}

/** context-sync: updates seq/hash; ACCEPTED → ACTIVE when roundtrip completes.
 * Only transition to ACTIVE when BOTH: (1) received other's context_sync (seq>=1),
 * (2) own context_sync is durably enqueued (tryEnqueue → `last_seq_sent` + `last_capsule_hash_sent`).
 * `context_sync_pending` alone is not used for this gate.
 */
function buildContextSyncRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
): HandshakeRecord {
  const nextState = getNextStateAfterInboundContextSync(existing, input.seq)
  if (nextState === HS.ACTIVE) {
    if (!existing.peer_x25519_public_key_b64?.trim() || !existing.peer_mlkem768_public_key_b64?.trim()) {
      console.error('[HANDSHAKE] CRITICAL: Handshake ACTIVE but missing peer BEAP keys!', {
        handshakeId: existing.handshake_id,
        localRole: existing.local_role,
        hasPeerX25519: !!existing.peer_x25519_public_key_b64?.trim(),
        hasPeerMlkem: !!existing.peer_mlkem768_public_key_b64?.trim(),
      })
    }
  }
  return {
    ...existing,
    state: nextState,
    last_seq_received: input.seq,
    last_capsule_hash_received: input.capsule_hash,
    ...(nextState === HS.ACTIVE ? { expires_at: null } : {}),
  }
}

function buildRevokeRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
): HandshakeRecord {
  return {
    ...existing,
    state: HS.REVOKED,
    revoked_at: new Date().toISOString(),
    revocation_source: 'remote-capsule',
    last_seq_received: input.seq,
    last_capsule_hash_received: input.capsule_hash,
  }
}
