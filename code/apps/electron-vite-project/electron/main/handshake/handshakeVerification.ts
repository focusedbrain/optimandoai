/**
 * Handshake Verification — Full Cryptographic Verification Pipeline
 *
 * When a capsule arrives at the receiving orchestrator, this module
 * performs the complete verification sequence:
 *
 *   1. Required field presence check
 *   2. Nonce format validation
 *   3. Timestamp freshness validation (clock skew window)
 *   4. Nonce replay check (against seen-nonce store)
 *   5. Receiver email binding verification
 *   6. Canonical payload reconstruction
 *   7. SHA-256 context_hash recalculation and comparison
 *   8. capsule_hash verification (existing chain integrity hash)
 *
 * This module is called AFTER Gate 2 (canonicalRebuild) has validated
 * field formats and BEFORE the handshake pipeline processes the capsule.
 *
 * Failure at any step produces a typed reason code for audit logging.
 */

import {
  type ContextHashInput,
  verifyContextHash,
  validateTimestamp,
  validateNonce,
} from './contextHash'
import { computeCapsuleHash, type CapsuleHashInput } from './capsuleHash'
import { verifyContextCommitment, type ContextBlockForCommitment } from './contextCommitment'
import { INPUT_LIMITS } from './types'

// ── Result types ──

export type HandshakeVerifyResult =
  | { verified: true }
  | { verified: false; step: string; reason: string }

export interface HandshakeCapsuleFields {
  schema_version: number
  capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke'
  handshake_id: string
  relationship_id: string
  sender_id: string
  sender_wrdesk_user_id: string
  sender_email: string
  receiver_id: string
  receiver_email: string
  timestamp: string
  nonce: string
  seq: number
  capsule_hash: string
  context_hash: string
  context_commitment?: string | null
  wrdesk_policy_hash: string
  wrdesk_policy_version: string
  sharing_mode?: string
  prev_hash?: string
  senderIdentity?: { sub: string }
  receiverIdentity?: { sub: string } | null
  context_blocks?: ReadonlyArray<ContextBlockForCommitment>
}

// ── Main verification function ──

/**
 * Full cryptographic verification of a received handshake capsule.
 *
 * @param capsule   Capsule fields (post-canonical-rebuild)
 * @param expectedReceiverEmail  The local orchestrator's email
 * @param seenNonces  Set of previously seen nonces for this handshake
 * @param now  Current time for timestamp validation
 * @param clockSkewToleranceMs  Acceptable clock drift (default: 5 minutes)
 */
export function verifyHandshakeCapsule(
  capsule: HandshakeCapsuleFields,
  expectedReceiverEmail: string,
  seenNonces: ReadonlySet<string>,
  now: Date = new Date(),
  clockSkewToleranceMs: number = INPUT_LIMITS.CLOCK_SKEW_TOLERANCE_MS,
): HandshakeVerifyResult {

  // Step 1: Required field presence
  const requiredFields: Array<keyof HandshakeCapsuleFields> = [
    'schema_version', 'capsule_type', 'handshake_id', 'relationship_id',
    'sender_id', 'sender_wrdesk_user_id', 'sender_email', 'receiver_id',
    'receiver_email', 'timestamp', 'nonce', 'seq', 'capsule_hash',
    'context_hash', 'wrdesk_policy_hash', 'wrdesk_policy_version',
  ]

  for (const field of requiredFields) {
    if (capsule[field] === undefined || capsule[field] === null || capsule[field] === '') {
      return { verified: false, step: 'required_fields', reason: `Missing required field: ${field}` }
    }
  }

  // Step 2: Nonce format validation
  const nonceCheck = validateNonce(capsule.nonce)
  if (!nonceCheck.valid) {
    return { verified: false, step: 'nonce_format', reason: nonceCheck.reason }
  }

  // Step 3: Timestamp freshness
  const tsCheck = validateTimestamp(capsule.timestamp, now, clockSkewToleranceMs)
  if (!tsCheck.valid) {
    return { verified: false, step: 'timestamp_freshness', reason: tsCheck.reason }
  }

  // Step 4: Nonce replay check
  if (seenNonces.has(capsule.nonce)) {
    return { verified: false, step: 'nonce_replay', reason: 'Nonce has been seen before — possible replay attack' }
  }

  // Step 5: Receiver email binding
  if (capsule.receiver_email !== expectedReceiverEmail) {
    return {
      verified: false,
      step: 'receiver_binding',
      reason: `receiver_email "${capsule.receiver_email}" does not match expected "${expectedReceiverEmail}"`,
    }
  }

  // Step 6–7: Context hash verification (reconstructs canonical payload internally)
  const contextHashInput: ContextHashInput = {
    schema_version: capsule.schema_version,
    capsule_type: capsule.capsule_type,
    handshake_id: capsule.handshake_id,
    relationship_id: capsule.relationship_id,
    sender_id: capsule.sender_id,
    sender_wrdesk_user_id: capsule.sender_wrdesk_user_id,
    sender_email: capsule.sender_email,
    receiver_id: capsule.receiver_id,
    receiver_email: capsule.receiver_email,
    timestamp: capsule.timestamp,
    nonce: capsule.nonce,
    seq: capsule.seq,
    wrdesk_policy_hash: capsule.wrdesk_policy_hash,
    wrdesk_policy_version: capsule.wrdesk_policy_version,
    sharing_mode: capsule.sharing_mode,
    prev_hash: capsule.prev_hash,
  }

  const contextCheck = verifyContextHash(contextHashInput, capsule.context_hash)
  if (!contextCheck.valid) {
    return { verified: false, step: 'context_hash', reason: contextCheck.reason }
  }

  // Step 8: Context commitment verification (schema v2+)
  if (capsule.schema_version >= 2 && capsule.context_commitment != null) {
    const commitCheck = verifyContextCommitment(capsule.context_commitment, capsule.context_blocks)
    if (!commitCheck.valid) {
      return { verified: false, step: 'context_commitment', reason: commitCheck.reason }
    }
  }

  // Step 9: capsule_hash verification (chain integrity hash)
  const capsuleHashInput: CapsuleHashInput = {
    capsule_type: capsule.capsule_type,
    handshake_id: capsule.handshake_id,
    relationship_id: capsule.relationship_id,
    schema_version: capsule.schema_version,
    sender_wrdesk_user_id: capsule.sender_wrdesk_user_id,
    receiver_email: capsule.schema_version >= 2 ? capsule.receiver_email : undefined,
    seq: capsule.seq,
    timestamp: capsule.timestamp,
    sharing_mode: capsule.sharing_mode,
    prev_hash: capsule.prev_hash,
    wrdesk_policy_hash: capsule.wrdesk_policy_hash,
    wrdesk_policy_version: capsule.wrdesk_policy_version,
    context_commitment: capsule.schema_version >= 2 ? capsule.context_commitment : undefined,
    senderIdentity_sub: capsule.capsule_type === 'accept' && capsule.schema_version >= 2 ? capsule.senderIdentity?.sub : undefined,
    receiverIdentity_sub: capsule.capsule_type === 'accept' && capsule.schema_version >= 2 ? capsule.receiverIdentity?.sub ?? undefined : undefined,
  }

  const expectedCapsuleHash = computeCapsuleHash(capsuleHashInput)
  if (capsule.capsule_hash !== expectedCapsuleHash) {
    return { verified: false, step: 'capsule_hash', reason: 'capsule_hash does not match recomputed value' }
  }

  return { verified: true }
}
