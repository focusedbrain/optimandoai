/**
 * Context Hash — Handshake Integrity Proof
 *
 * Produces a SHA-256 digest over a **canonical representation** of the full
 * handshake context.  Unlike `capsuleHash.ts` (which covers chain-critical
 * fields for deduplication), the context hash is a **cryptographic binding**
 * over every identity, temporal, and policy field in the capsule — making
 * the entire handshake state tamper-evident.
 *
 * Security guarantees provided:
 *   1. **Integrity**       — any field mutation invalidates the hash
 *   2. **Identity binding** — sender_email / receiver_email are hashed
 *   3. **Replay resistance** — timestamp + nonce + seq form a unique triple
 *   4. **Determinism**     — canonical JSON (sorted keys, no whitespace)
 *                            ensures both parties compute the same hash
 *
 * Canonical fields included in the hash (alphabetically sorted):
 *   capsule_type, handshake_id, nonce, receiver_email, receiver_id,
 *   relationship_id, schema_version, sender_email, sender_id,
 *   sender_wrdesk_user_id, seq, timestamp, wrdesk_policy_hash,
 *   wrdesk_policy_version
 *
 * Type-specific additions:
 *   accept  → sharing_mode
 *   refresh → prev_hash
 *
 * The output `context_hash` is a 64-character lowercase hex SHA-256 string.
 */

import { createHash, randomBytes } from 'crypto'

// ── Input type ──

export interface ContextHashInput {
  schema_version: number
  capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke' | 'internal_draft'
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
  wrdesk_policy_hash?: string
  wrdesk_policy_version?: string
  sharing_mode?: string
  prev_hash?: string
}

// ── Canonical payload builder ──

/**
 * Build the deterministic canonical payload object for context hashing.
 *
 * Rules:
 *   - Only explicitly listed fields are included.
 *   - Keys are sorted alphabetically.
 *   - Values are used as-is (strings, numbers).
 *   - `undefined` fields are omitted entirely (not serialized as `null`).
 *   - The output is a plain object ready for `JSON.stringify`.
 */
export function buildCanonicalContextPayload(
  input: ContextHashInput,
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
    capsule_type: input.capsule_type,
    handshake_id: input.handshake_id,
    nonce: input.nonce,
    receiver_email: input.receiver_email,
    receiver_id: input.receiver_id,
    relationship_id: input.relationship_id,
    schema_version: input.schema_version,
    sender_email: input.sender_email,
    sender_id: input.sender_id,
    sender_wrdesk_user_id: input.sender_wrdesk_user_id,
    seq: input.seq,
    timestamp: input.timestamp,
  }

  if (input.wrdesk_policy_hash !== undefined) {
    canonical.wrdesk_policy_hash = input.wrdesk_policy_hash
  }
  if (input.wrdesk_policy_version !== undefined) {
    canonical.wrdesk_policy_version = input.wrdesk_policy_version
  }

  if (input.capsule_type === 'accept' && input.sharing_mode !== undefined) {
    canonical.sharing_mode = input.sharing_mode
  }
  if (input.capsule_type === 'refresh' && input.prev_hash !== undefined) {
    canonical.prev_hash = input.prev_hash
  }

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(canonical).sort()) {
    sorted[key] = canonical[key]
  }

  return sorted
}

// ── Hash computation ──

/**
 * Compute the context hash (SHA-256) over the canonical context payload.
 * Returns a 64-character lowercase hex string.
 */
export function computeContextHash(input: ContextHashInput): string {
  const canonical = buildCanonicalContextPayload(input)
  const json = JSON.stringify(canonical)
  return createHash('sha256').update(json, 'utf8').digest('hex')
}

// ── Nonce generation ──

/**
 * Generate a cryptographically secure nonce for replay protection.
 * Returns a 32-byte random value encoded as 64 lowercase hex characters.
 */
export function generateNonce(): string {
  return randomBytes(32).toString('hex')
}

// ── Verification ──

export type ContextHashVerificationResult =
  | { valid: true }
  | { valid: false; reason: string }

/**
 * Verify a received context_hash against the reconstructed canonical payload.
 *
 * Steps:
 *   1. Rebuild canonical payload from the capsule fields.
 *   2. Compute SHA-256 over deterministic JSON.
 *   3. Constant-time comparison with the provided hash.
 */
export function verifyContextHash(
  input: ContextHashInput,
  providedHash: string,
): ContextHashVerificationResult {
  if (typeof providedHash !== 'string' || !/^[a-f0-9]{64}$/.test(providedHash)) {
    return { valid: false, reason: 'context_hash is not a valid 64-char hex SHA-256 string' }
  }

  const computed = computeContextHash(input)

  if (!timingSafeEqual(computed, providedHash)) {
    return { valid: false, reason: 'context_hash mismatch — capsule has been tampered with' }
  }

  return { valid: true }
}

// ── Timestamp validation ──

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Validate that a capsule timestamp falls within an acceptable window.
 * Rejects capsules that are too old (replay) or too far in the future (clock skew).
 */
export function validateTimestamp(
  capsuleTimestamp: string,
  now: Date = new Date(),
  toleranceMs: number = DEFAULT_CLOCK_SKEW_MS,
): ContextHashVerificationResult {
  const ts = Date.parse(capsuleTimestamp)
  if (isNaN(ts)) {
    return { valid: false, reason: 'timestamp is not a valid ISO 8601 date' }
  }

  const diff = Math.abs(now.getTime() - ts)
  if (diff > toleranceMs) {
    return {
      valid: false,
      reason: `timestamp is ${diff}ms from current time (tolerance: ${toleranceMs}ms)`,
    }
  }

  return { valid: true }
}

// ── Nonce validation ──

/**
 * Validate nonce format: must be a 64-character lowercase hex string (32 bytes).
 */
export function validateNonce(nonce: string): ContextHashVerificationResult {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) {
    return { valid: false, reason: 'nonce must be a 64-char lowercase hex string' }
  }
  return { valid: true }
}

// ── Constant-time comparison ──

/**
 * Constant-time string comparison to prevent timing side-channel attacks
 * on hash verification.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  try {
    const { timingSafeEqual: tse } = require('crypto')
    return tse(bufA, bufB)
  } catch {
    let result = 0
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i]! ^ bufB[i]!
    }
    return result === 0
  }
}
