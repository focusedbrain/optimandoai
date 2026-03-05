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

/**
 * Map ValidatedCapsule's capsule_type to the handshake layer's CapsuleType.
 * internal_draft is not a handshake capsule type — it should not reach here.
 */
function mapCapsuleTypeToHandshake(type: string): 'handshake-initiate' | 'handshake-accept' | 'handshake-refresh' | 'handshake-revoke' {
  switch (type) {
    case 'initiate': return 'handshake-initiate'
    case 'accept': return 'handshake-accept'
    case 'refresh': return 'handshake-refresh'
    case 'revoke': return 'handshake-revoke'
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

  // 1. Determine mode: create or update
  const handshakeRecord = getHandshakeRecord(db, input.handshake_id)

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
  const tx = db.transaction(() => {
    if (input.capsuleType === 'handshake-initiate') {
      record = buildInitiateRecord(input, ssoSession, tierDecision, effectivePolicy)
      insertHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-accept') {
      record = buildAcceptRecord(handshakeRecord!, input, ssoSession, tierDecision, effectivePolicy)
      updateHandshakeRecord(db, record)
    } else if (input.capsuleType === 'handshake-refresh') {
      record = buildRefreshRecord(handshakeRecord!, input, tierDecision)
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
    const capsuleObj = validated.capsule as Record<string, any>
    const rawContextBlocks = capsuleObj?.context_blocks
    if (Array.isArray(rawContextBlocks) && rawContextBlocks.length > 0) {
      const ingestionResult = ingestContextBlocks(db, {
        handshake_id: input.handshake_id,
        relationship_id: input.relationship_id,
        context_commitment: capsuleObj?.context_commitment ?? null,
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

    const isIngestionFailure = errMsg.includes('Context commitment') ||
      errMsg.includes('context_commitment')

    try {
      insertAuditLogEntry(db, buildDenialAuditEntry(
        input,
        isIngestionFailure ? ReasonCode.CONTEXT_HASH_MISMATCH : ReasonCode.INTERNAL_ERROR,
        isIngestionFailure ? 'context_ingestion' : 'atomic_transaction',
        durationMs,
      ))
    } catch { /* audit must not mask */ }

    return {
      success: false,
      reason: isIngestionFailure ? ReasonCode.CONTEXT_HASH_MISMATCH : ReasonCode.INTERNAL_ERROR,
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

function buildInitiateRecord(
  input: VerifiedCapsuleInput,
  _ssoSession: SSOSession,
  tierDecision: TierDecision,
  effectivePolicy: EffectivePolicy,
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
    expires_at: input.expires_at ?? new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString(),
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: input.wrdesk_policy_hash,
    initiator_wrdesk_policy_version: input.wrdesk_policy_version,
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: input.context_commitment ?? null,
    acceptor_context_commitment: null,
  }
}

function buildAcceptRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
  _ssoSession: SSOSession,
  _tierDecision: TierDecision,
  effectivePolicy: EffectivePolicy,
): HandshakeRecord {
  return {
    ...existing,
    state: HS.ACTIVE,
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
    expires_at: input.expires_at ?? existing.expires_at,
    acceptor_wrdesk_policy_hash: input.wrdesk_policy_hash,
    acceptor_wrdesk_policy_version: input.wrdesk_policy_version,
    acceptor_context_commitment: input.context_commitment ?? null,
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
