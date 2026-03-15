/**
 * Stage 0 — Recipient Eligibility Determination (A.3.054.3 + A.3.055 Stage 0 — Normative)
 *
 * Per A.3.055 Stage 0 (Normative):
 *   - Eligibility MUST be evaluated PRIOR to any structural parsing, metadata
 *     disclosure, policy evaluation, or Capsule access.
 *   - Evaluated solely via opaque handshake-derived receiver binding.
 *   - MUST be non-disclosing and constant-behavior (no timing side channels).
 *   - Failure → "not-for-me" outcome without additional disclosure.
 *
 * Per A.3.054.3 (Normative) — Builder-side obligations already satisfied in BeapPackageBuilder:
 *   - Eligibility material derived exclusively from selected handshake.
 *   - Cryptographically bound to (a) sender endpoint identity, (b) receiver
 *     endpoint identity, (c) Capsule context hash.
 *   - Strictly size-bounded (32 bytes), format-fixed, opaque.
 *   - No plaintext or globally inspectable identifiers in output.
 *
 * Eligibility material construction (canonical):
 *   HMAC-SHA256(
 *     key  = hybridSharedSecret (64-byte PQ hybrid),
 *     data = "BEAP v2 eligibility" || sender_fp || ":" || receiver_fp || ":" || content_hash
 *   )
 *
 * Receiver-side verification:
 *   Recompute the expected HMAC using all candidate local handshake shared secrets.
 *   Compare against `pkg.header.receiver_eligibility` with constant-time equality.
 *   Return eligible (with matched handshake reference) or "not-for-me" — NO error details.
 */

import { hmacSha256, fromBase64, constantTimeEqual } from './beapCrypto'

// =============================================================================
// Types
// =============================================================================

/**
 * A local handshake record that the receiver can present for eligibility evaluation.
 *
 * The receiver holds one `LocalHandshake` per established handshake with a remote sender.
 * Only `hybridSharedSecret` is cryptographically sensitive; all other fields are
 * governance metadata for binding verification.
 */
export interface LocalHandshake {
  /** Handshake ID — used as the secondary legacy fallback identifier. */
  handshakeId: string

  /**
   * Hybrid shared secret bytes (ML-KEM-768 SS || X25519 SS = 64 bytes).
   *
   * Derived during handshake key agreement. The raw secret — MUST be stored
   * in a secure, hardware-backed store where available.
   *
   * For the eligibility HMAC derivation this is used directly as the HMAC key.
   */
  hybridSharedSecret: Uint8Array

  /**
   * Sender fingerprint associated with this handshake.
   * Used to reconstruct the eligibility HMAC input.
   */
  senderFingerprint: string

  /**
   * Receiver fingerprint associated with this handshake.
   * Must match the receiver's own endpoint identity.
   */
  receiverFingerprint: string
}

/**
 * Result of recipient eligibility evaluation.
 *
 * Per A.3.055 Stage 0 (Normative):
 *   - Eligible → proceed to Stage 1
 *   - NotForMe → discard silently; constant-behavior regardless of path taken
 *
 * Fields beyond `outcome` are only populated on a successful `eligible` outcome.
 */
export type EligibilityOutcome = 'eligible' | 'not-for-me'

export interface EligibilityCheckResult {
  /** Canonical outcome: eligible or not-for-me. */
  outcome: EligibilityOutcome

  /**
   * Matched handshake ID (eligible only).
   * Used to look up the sender's X25519 public key and other session material.
   */
  matchedHandshakeId?: string

  /**
   * Index into the `handshakes` array that matched (eligible only).
   * Useful for efficient session material retrieval.
   */
  matchedHandshakeIndex?: number
}

// =============================================================================
// Eligibility Material Derivation
// =============================================================================

/** Canonical HMAC input prefix per A.3.054.3. */
const ELIGIBILITY_DOMAIN_SEPARATOR = 'BEAP v2 eligibility'

/**
 * Derive the expected eligibility material for a given handshake and capsule.
 *
 * This is the receiver-side recomputation that mirrors the builder-side generation.
 * Both sides MUST use identical input construction for the token to match.
 *
 * @param hybridSharedSecret - 64-byte PQ hybrid shared secret (ML-KEM SS || X25519 SS)
 * @param senderFingerprint  - Sender endpoint fingerprint (from pkg.header.sender_fingerprint)
 * @param receiverFingerprint - Receiver endpoint fingerprint (local identity)
 * @param contentHash        - Capsule content hash (from pkg.header.content_hash)
 * @returns 32-byte HMAC-SHA256 tag
 */
export async function deriveEligibilityMaterial(
  hybridSharedSecret: Uint8Array,
  senderFingerprint: string,
  receiverFingerprint: string,
  contentHash: string
): Promise<Uint8Array> {
  const data = new TextEncoder().encode(
    ELIGIBILITY_DOMAIN_SEPARATOR +
    senderFingerprint + ':' +
    receiverFingerprint + ':' +
    contentHash
  )
  return hmacSha256(hybridSharedSecret, data)
}

// =============================================================================
// Constant-Time Eligibility Check
// =============================================================================

/**
 * Evaluate recipient eligibility for a v2.0 qBEAP package.
 *
 * Iterates all local handshakes, recomputes the expected eligibility material,
 * and compares against the package's `receiver_eligibility` token using
 * constant-time equality. Returns on first match; iterates ALL remaining
 * handshakes regardless to prevent timing-based enumeration of handshake count.
 *
 * Per A.3.055 Stage 0 (Normative):
 *   - MUST be non-disclosing: all execution paths take equivalent time
 *   - MUST NOT reveal which (if any) handshake matched
 *   - MUST NOT disclose structure of local handshake store
 *
 * @param receiverEligibilityToken - Base64-encoded token from `pkg.header.receiver_eligibility`
 * @param senderFingerprint        - From `pkg.header.sender_fingerprint`
 * @param contentHash              - From `pkg.header.content_hash`
 * @param handshakes               - All local handshake records to check against
 * @returns EligibilityCheckResult
 */
export async function evaluateRecipientEligibility(
  receiverEligibilityToken: string,
  senderFingerprint: string,
  contentHash: string,
  handshakes: LocalHandshake[]
): Promise<EligibilityCheckResult> {
  // Decode the expected token from the package header
  let expectedTokenBytes: Uint8Array
  try {
    expectedTokenBytes = fromBase64(receiverEligibilityToken)
  } catch {
    // Malformed token — treat as not-for-me without disclosure
    return { outcome: 'not-for-me' }
  }

  // Guard: expected token must be exactly 32 bytes (HMAC-SHA256 output)
  if (expectedTokenBytes.length !== 32) {
    return { outcome: 'not-for-me' }
  }

  let matchedIdx = -1
  let matchedHandshakeId: string | undefined

  // Iterate ALL handshakes regardless of match to prevent timing side channels.
  // Constant-time comparison ensures no early exit on match.
  // Use an async approach: compute all HMACs then compare.
  const computedTags = await Promise.all(
    handshakes.map(hs =>
      deriveEligibilityMaterial(
        hs.hybridSharedSecret,
        senderFingerprint,
        hs.receiverFingerprint,
        contentHash
      ).catch(() => new Uint8Array(32)) // Absorb errors — mismatches are "not-for-me"
    )
  )

  // Compare all computed tags in constant time
  for (let i = 0; i < computedTags.length; i++) {
    const isMatch = constantTimeEqual(computedTags[i], expectedTokenBytes)
    // Record first match but continue iterating ALL handshakes
    if (isMatch && matchedIdx === -1) {
      matchedIdx = i
      matchedHandshakeId = handshakes[i].handshakeId
    }
  }

  if (matchedIdx !== -1) {
    return {
      outcome: 'eligible',
      matchedHandshakeId,
      matchedHandshakeIndex: matchedIdx,
    }
  }

  return { outcome: 'not-for-me' }
}

// =============================================================================
// Legacy v1.0 Fallback
// =============================================================================

/**
 * Legacy Stage 0 fallback for v1.0 packages (pre-eligibility-material).
 *
 * v1.0 packages lack `receiver_eligibility`; eligibility is determined by
 * matching `pkg.header.receiver_binding.handshake_id` against the caller's
 * known handshake ID.
 *
 * Per A.3.055 (backward compat): v1.0 packages are accepted on this path
 * until all senders have migrated to v2.0.
 *
 * NOTE: This path does NOT provide the canonical constant-time or non-disclosing
 * guarantees of the v2.0 path. It is a transitional measure only.
 *
 * @param packageHandshakeId - `pkg.header.receiver_binding?.handshake_id`
 * @param localHandshakeId   - Caller's known handshake ID
 * @returns true if eligible
 */
export function evaluateLegacyEligibility(
  packageHandshakeId: string | undefined,
  localHandshakeId: string
): boolean {
  if (!packageHandshakeId) return false
  return packageHandshakeId === localHandshakeId
}
