/**
 * Capsule Hash Computation
 *
 * Computes the `capsule_hash` field that every handshake capsule must carry.
 * The hash uniquely identifies the capsule's content for deduplication and
 * chain integrity (refresh/revoke capsules reference it via `prev_hash`).
 *
 * Algorithm:
 *   SHA-256 over a deterministic JSON serialization of the canonical capsule
 *   fields, with keys sorted alphabetically and no whitespace.
 *
 * Canonical fields (included regardless of capsule type):
 *   - capsule_type
 *   - handshake_id
 *   - relationship_id
 *   - schema_version
 *   - sender_wrdesk_user_id
 *   - seq
 *   - timestamp
 *
 * Type-specific additional fields:
 *   - initiate:  wrdesk_policy_hash, wrdesk_policy_version
 *   - accept:    sharing_mode, wrdesk_policy_hash, wrdesk_policy_version
 *   - refresh:   prev_hash, wrdesk_policy_hash, wrdesk_policy_version
 *   - revoke:    (none beyond canonical)
 *   - internal_draft: (none beyond canonical)
 *
 * Fields NOT included in the hash:
 *   - capsule_hash itself (obviously)
 *   - context_blocks (content hashes tracked separately per block)
 *   - senderIdentity (derived from sender_wrdesk_user_id + external claims)
 *   - tierSignals (advisory, not binding for chain integrity)
 *   - external_processing, reciprocal_allowed, capsulePolicy (policy fields
 *     are anchored via wrdesk_policy_hash, not re-hashed here)
 *
 * Returns a 64-character lowercase hex string (SHA-256).
 */

import { createHash } from 'crypto'

export interface CapsuleHashInput {
  capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke' | 'internal_draft';
  handshake_id: string;
  relationship_id: string;
  schema_version: number;
  sender_wrdesk_user_id: string;
  receiver_email?: string;
  seq: number;
  timestamp: string;
  // Type-specific
  sharing_mode?: string;
  prev_hash?: string;
  wrdesk_policy_hash?: string;
  wrdesk_policy_version?: string;
  context_commitment?: string | null;
  senderIdentity_sub?: string;
  receiverIdentity_sub?: string;
}

/**
 * Compute the canonical hash for a BEAP handshake capsule.
 * Returns a 64-character lowercase hex string.
 */
export function computeCapsuleHash(input: CapsuleHashInput): string {
  const canonical: Record<string, unknown> = {
    capsule_type: input.capsule_type,
    handshake_id: input.handshake_id,
    relationship_id: input.relationship_id,
    schema_version: input.schema_version,
    sender_wrdesk_user_id: input.sender_wrdesk_user_id,
    seq: input.seq,
    timestamp: input.timestamp,
  }

  if (input.receiver_email !== undefined) {
    canonical.receiver_email = input.receiver_email
  }

  // Type-specific fields
  if (input.capsule_type === 'initiate' || input.capsule_type === 'accept' || input.capsule_type === 'refresh') {
    if (input.wrdesk_policy_hash !== undefined) canonical.wrdesk_policy_hash = input.wrdesk_policy_hash
    if (input.wrdesk_policy_version !== undefined) canonical.wrdesk_policy_version = input.wrdesk_policy_version
  }
  if (input.capsule_type === 'accept' && input.sharing_mode !== undefined) {
    canonical.sharing_mode = input.sharing_mode
  }
  if (input.capsule_type === 'refresh' && input.prev_hash !== undefined) {
    canonical.prev_hash = input.prev_hash
  }

  if (input.context_commitment != null) {
    canonical.context_commitment = input.context_commitment
  }

  if (input.capsule_type === 'accept') {
    if (input.senderIdentity_sub !== undefined) canonical.senderIdentity_sub = input.senderIdentity_sub
    if (input.receiverIdentity_sub !== undefined) canonical.receiverIdentity_sub = input.receiverIdentity_sub
  }

  // Sort keys for determinism
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(canonical).sort()) {
    sorted[key] = canonical[key]
  }

  const json = JSON.stringify(sorted)
  return createHash('sha256').update(json, 'utf8').digest('hex')
}
