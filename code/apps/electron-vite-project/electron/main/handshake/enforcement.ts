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
import { ReasonCode, HandshakeState as HS, INPUT_LIMITS } from './types'
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
import { buildSuccessAuditEntry, buildDenialAuditEntry } from './auditLog'
import { verifyCapsuleSignature } from './signatureKeys'
import { verifyCapsuleHashIntegrity } from './steps/verifyCapsuleHash'

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
    if (senderPublicKey !== handshakeRecord.counterparty_public_key) {
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

  const tx = db.transaction(() => {
    if (input.capsuleType === 'handshake-initiate') {
      record = buildInitiateRecord(input, ssoSession, tierDecision, effectivePolicy, senderP2PEndpoint, senderP2PAuthToken, senderPublicKey)
      insertHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-accept') {
      record = buildAcceptRecord(handshakeRecord!, input, ssoSession, tierDecision, effectivePolicy, senderP2PEndpoint, senderP2PAuthToken, senderPublicKey)
      updateHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-refresh') {
      record = buildRefreshRecord(handshakeRecord!, input, tierDecision)
      updateHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-context-sync') {
      // context-sync updates seq/hash like refresh; context_blocks ingested below
      record = buildContextSyncRecord(handshakeRecord!, input)
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
    if (input.capsuleType === 'handshake-refresh' || input.capsuleType === 'handshake-context-sync') {
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
      // Skip for initiate/accept: we are creating the stored value.
      if (input.capsuleType === 'handshake-refresh' || input.capsuleType === 'handshake-context-sync') {
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
  if (record.expires_at) {
    const expiresAt = Date.parse(record.expires_at)
    if (!isNaN(expiresAt) && now.getTime() > expiresAt) return false
  }
  return true
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

  if (record.expires_at) {
    const expiresAt = Date.parse(record.expires_at)
    if (!isNaN(expiresAt) && now.getTime() > expiresAt) {
      return { allowed: false, reason: ReasonCode.HANDSHAKE_EXPIRED }
    }
  }

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
): HandshakeRecord {
  return {
    handshake_id: input.handshake_id,
    relationship_id: input.relationship_id,
    state: HS.PENDING_ACCEPT,
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
    counterparty_public_key: senderPublicKey || null,
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
): HandshakeRecord {
  return {
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
    counterparty_public_key: senderPublicKey || existing.counterparty_public_key,
  }
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
 * (2) own context_sync was sent (context_sync_pending=false).
 * If own is still pending (vault was locked), stay ACCEPTED until we send ours.
 */
function buildContextSyncRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
): HandshakeRecord {
  const receivedContextSync = existing.state === HS.ACCEPTED && input.seq >= 1
  const ownSent = !existing.context_sync_pending
  const nextState = receivedContextSync && ownSent ? HS.ACTIVE : existing.state
  return {
    ...existing,
    state: nextState,
    last_seq_received: input.seq,
    last_capsule_hash_received: input.capsule_hash,
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
