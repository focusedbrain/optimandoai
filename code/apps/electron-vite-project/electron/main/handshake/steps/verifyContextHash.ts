/**
 * Verify context_hash integrity (Critical Finding #2).
 *
 * Recomputes SHA-256 over the canonical context payload (identity, temporal,
 * policy fields) and compares against the declared context_hash.
 *
 * WHY: Prior analysis found context_hash was never verified. This step ensures
 * the full capsule context is tamper-evident.
 */

import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'
import { verifyContextHash, type ContextHashInput } from '../contextHash'

function wireTypeToContextType(ct: string): ContextHashInput['capsule_type'] {
  switch (ct) {
    case 'handshake-initiate': return 'initiate'
    case 'handshake-accept': return 'accept'
    case 'handshake-refresh': return 'refresh'
    case 'handshake-revoke': return 'revoke'
    case 'handshake-context-sync': return 'refresh'
    default: return 'initiate'
  }
}

export const verifyContextHashStep: PipelineStep = {
  name: 'verify_context_hash',
  execute(ctx) {
    const { input } = ctx

    const contextHashInput: ContextHashInput = {
      schema_version: input.schema_version,
      capsule_type: wireTypeToContextType(input.capsuleType),
      handshake_id: input.handshake_id,
      relationship_id: input.relationship_id,
      sender_id: input.sender_wrdesk_user_id,
      sender_wrdesk_user_id: input.sender_wrdesk_user_id,
      sender_email: input.sender_email,
      receiver_id: input.receiver_id,
      receiver_email: input.receiver_email,
      timestamp: input.timestamp,
      nonce: input.nonce,
      seq: input.seq,
      wrdesk_policy_hash: input.wrdesk_policy_hash,
      wrdesk_policy_version: input.wrdesk_policy_version,
      sharing_mode: input.sharing_mode,
      prev_hash: input.prev_hash,
    }

    const result = verifyContextHash(contextHashInput, input.context_hash)
    if (!result.valid) {
      console.warn('[HANDSHAKE] CONTEXT_INTEGRITY_FAILURE', { handshake_id: input.handshake_id, capsule_hash: input.capsule_hash })
      return { passed: false, reason: ReasonCode.CONTEXT_INTEGRITY_FAILURE }
    }

    return { passed: true }
  },
}
