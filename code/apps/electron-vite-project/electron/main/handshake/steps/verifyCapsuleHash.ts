/**
 * Verify capsule_hash integrity (Critical Finding #1).
 *
 * Recomputes SHA-256 over canonical capsule fields and compares against
 * the declared capsule_hash. Rejects tampered capsules.
 *
 * WHY: Prior analysis found capsule_hash was never recomputed — a forged
 * but correctly formatted hash would be accepted. This step closes that gap.
 */

import type { PipelineStep } from '../types'
import type { VerifiedCapsuleInput } from '../types'
import { ReasonCode } from '../types'
import { computeCapsuleHash, type CapsuleHashInput } from '../capsuleHash'

function wireTypeToHashType(ct: string): CapsuleHashInput['capsule_type'] {
  switch (ct) {
    case 'handshake-initiate': return 'initiate'
    case 'handshake-accept': return 'accept'
    case 'handshake-refresh': return 'refresh'
    case 'handshake-revoke': return 'revoke'
    case 'handshake-context-sync': return 'refresh' // context_sync uses same hash algo as refresh
    default: return 'initiate'
  }
}

/**
 * Verify capsule_hash matches recomputed canonical fields.
 * Called BEFORE signature verification — the signature is over the hash;
 * if the hash is wrong, there's no point checking the signature.
 *
 * @returns null if verified, or ReasonCode if rejected
 */
export function verifyCapsuleHashIntegrity(input: VerifiedCapsuleInput): ReasonCode | null {
  if (!input.capsule_hash || input.capsule_hash.length !== 64 || !/^[a-f0-9]+$/i.test(input.capsule_hash)) {
    return ReasonCode.HASH_INTEGRITY_FAILURE
  }
  if (input.schema_version < 2) {
    console.warn('[HANDSHAKE] capsule_hash verification skipped for schema_version 1 (legacy)')
    return null
  }
  const hashType = wireTypeToHashType(input.capsuleType)
  const capsuleHashInput: CapsuleHashInput = {
    capsule_type: hashType,
    handshake_id: input.handshake_id,
    relationship_id: input.relationship_id,
    schema_version: input.schema_version,
    sender_wrdesk_user_id: input.sender_wrdesk_user_id,
    receiver_email: input.schema_version >= 2 ? input.receiver_email : undefined,
    seq: input.seq,
    timestamp: input.timestamp,
    sharing_mode: input.sharing_mode,
    prev_hash: input.prev_hash,
    wrdesk_policy_hash: input.wrdesk_policy_hash,
    wrdesk_policy_version: input.wrdesk_policy_version,
    context_commitment: input.schema_version >= 2 ? input.context_commitment : undefined,
    senderIdentity_sub: hashType === 'accept' && input.schema_version >= 2 ? input.senderIdentity?.sub : undefined,
    receiverIdentity_sub: hashType === 'accept' && input.schema_version >= 2 ? input.receiverIdentity?.sub : undefined,
  }
  const expected = computeCapsuleHash(capsuleHashInput)
  if (input.capsule_hash !== expected) {
    return ReasonCode.HASH_INTEGRITY_FAILURE
  }
  return null
}

export const verifyCapsuleHash: PipelineStep = {
  name: 'verify_capsule_hash',
  execute(ctx) {
    const { input } = ctx

    const hashType = wireTypeToHashType(input.capsuleType)

    const capsuleHashInput: CapsuleHashInput = {
      capsule_type: hashType,
      handshake_id: input.handshake_id,
      relationship_id: input.relationship_id,
      schema_version: input.schema_version,
      sender_wrdesk_user_id: input.sender_wrdesk_user_id,
      receiver_email: input.schema_version >= 2 ? input.receiver_email : undefined,
      seq: input.seq,
      timestamp: input.timestamp,
      sharing_mode: input.sharing_mode,
      prev_hash: input.prev_hash,
      wrdesk_policy_hash: input.wrdesk_policy_hash,
      wrdesk_policy_version: input.wrdesk_policy_version,
      context_commitment: input.schema_version >= 2 ? input.context_commitment : undefined,
      senderIdentity_sub: hashType === 'accept' && input.schema_version >= 2 ? input.senderIdentity?.sub : undefined,
      receiverIdentity_sub: hashType === 'accept' && input.schema_version >= 2 ? input.receiverIdentity?.sub : undefined,
    }

    const expected = computeCapsuleHash(capsuleHashInput)
    if (input.capsule_hash !== expected) {
      console.warn('[HANDSHAKE] HASH_INTEGRITY_FAILURE', { handshake_id: input.handshake_id, capsule_hash: input.capsule_hash })
      return { passed: false, reason: ReasonCode.HASH_INTEGRITY_FAILURE }
    }

    return { passed: true }
  },
}
