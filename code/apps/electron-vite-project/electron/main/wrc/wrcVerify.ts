/**
 * WRC verification — 3D (CatalogHead), 3E (DualAssuranceEnvelope), 3F (EVP).
 *
 * Every function here is pure over its inputs and returns a typed verdict.
 * There is no "warn and continue" anywhere: a missing leg means the object does
 * not exist for the runtime (contract §5.3, delta 3E), and the reason is typed
 * so the Phase-4 status surface can render it without re-deriving anything.
 *
 * Reason codes are the vocabulary the rest of the client and the report speak.
 * They are deliberately fine-grained: "it failed" is not an acceptable answer
 * when the four channels (registry, DNS, manifest, declared part) can diverge
 * in ways that mean very different things.
 */

import {
  WRC_EVP_MAX_CANONICAL_BYTES,
  decodeEvp,
  type WrcCatalogHead,
  type WrcDelegationRecord,
  type WrcEnvelope,
  type WrcEvp,
} from './wrcContract'
import {
  wrcCanonicalBytes,
  wrcCountersignatureMessage,
  wrcFoldInclusionProof,
  wrcHashEquals,
  wrcHashObject,
  wrcVerifyEd25519,
  wrcVerifyObjectSignature,
} from './wrcCrypto'

export type WrcVerifyReason =
  // Catalog head (3D, amended by contract delta v1.1 §A)
  | 'head_signature_invalid'
  | 'head_unknown_kid'
  | 'head_delegation_invalid'
  | 'head_delegation_revoked'
  | 'head_delegation_not_yet_valid'
  /** Delegated `kid` with no embedded delegation record. No fallback fetch. */
  | 'head_delegation_missing'
  /** Embedded record delegates a key other than the head's `kid`. */
  | 'head_delegation_kid_mismatch'
  /** `root_kid` is not the DNS-pinned root — a sub-delegation attempt. */
  | 'head_delegation_not_rooted'
  | 'head_epoch_rollback'
  | 'head_part_mismatch'
  | 'head_domain_mismatch'
  // Envelope (3E)
  | 'envelope_object_hash_mismatch'
  | 'envelope_epoch_mismatch'
  | 'envelope_publisher_signature_invalid'
  | 'envelope_countersignature_invalid'
  | 'envelope_inclusion_proof_invalid'
  | 'envelope_suspended'
  // EVP (3F)
  | 'evp_over_budget'
  | 'evp_malformed'
  | 'evp_part_mismatch'
  | 'evp_entry_mismatch'

export type WrcVerdict<T> = { ok: true; value: T } | { ok: false; reason: WrcVerifyReason; detail?: string }

/** Freshness is a separate axis from validity: a stale head is still authentic. */
export type WrcFreshness = 'fresh' | 'stale'

// ── Key material the client holds about a publisher ───────────────────────────

export interface WrcPublisherKeys {
  /** Raw base64url Ed25519 root public key, anchored via DNS `_wr` + manifest. */
  rootKid: string
  rootPub: string
  /**
   * The delegation carried BY THE HEAD (delta v1.1 §A), or null for a
   * root-signed head. There is deliberately no list and no store lookup here:
   * the contract requires head verification to complete from the DNS-pinned
   * root plus this record alone, and a collection-shaped field would be an
   * invitation to satisfy a delegated head from somewhere else.
   */
  headDelegation: WrcDelegationRecord | null
}

/**
 * Resolve the signing key for a `kid` at a given epoch: the root key, or the
 * head-embedded delegation when it is in force at that epoch.
 *
 * Every rejection is its own reason. An expired rotation, a record for a
 * different key, and an attempted sub-delegation are three different events,
 * and a status surface that collapses them into "bad signature" cannot tell an
 * operator what actually happened.
 *
 * Sub-delegation is unrepresentable rather than merely refused: `authority` is
 * `catalog-signing-only`, so a record whose `root_kid` is anything other than
 * the DNS-pinned root is rejected before its signature is even considered.
 */
export function resolveSigningKey(
  keys: WrcPublisherKeys,
  kid: string,
  epoch: number,
): { ok: true; pub: string } | { ok: false; reason: WrcVerifyReason } {
  if (kid === keys.rootKid) return { ok: true, pub: keys.rootPub }

  const d = keys.headDelegation
  // Delegated kid with nothing embedded: verification failure, no fallback fetch.
  if (!d) return { ok: false, reason: 'head_delegation_missing' }
  if (d.delegate_kid !== kid) return { ok: false, reason: 'head_delegation_kid_mismatch' }
  if (d.authority !== 'catalog-signing-only') {
    return { ok: false, reason: 'head_delegation_invalid' }
  }
  if (d.root_kid !== keys.rootKid) return { ok: false, reason: 'head_delegation_not_rooted' }
  if (!wrcVerifyObjectSignature(d as unknown as Record<string, unknown>, keys.rootPub)) {
    return { ok: false, reason: 'head_delegation_invalid' }
  }
  // v1.1 §A.3: valid_from_epoch <= epoch AND (revoked null OR revoked > epoch).
  if (epoch < d.valid_from_epoch) return { ok: false, reason: 'head_delegation_not_yet_valid' }
  if (d.revoked_from_epoch !== null && d.revoked_from_epoch <= epoch) {
    return { ok: false, reason: 'head_delegation_revoked' }
  }
  return { ok: true, pub: d.delegate_pub }
}

// ── 3D — CatalogHead ──────────────────────────────────────────────────────────

export interface WrcHeadVerification {
  head: WrcCatalogHead
  freshness: WrcFreshness
  /** Seconds past the freshness window; 0 when fresh. */
  stale_by_s: number
}

export interface VerifyCatalogHeadInput {
  head: WrcCatalogHead
  keys: WrcPublisherKeys
  expectedPublisherPart: string
  /** Domain established by the dual channel, not by the registry answer. */
  expectedDomain: string
  /** Highest epoch ever accepted for this publisher; null when first seen. */
  lastSeenEpoch: number | null
  /** Unix seconds. Injected so freshness is testable. */
  nowS: number
}

/**
 * Verify a CatalogHead: signature by root or a live delegation, binding to the
 * expected publisher and domain, strict per-publisher epoch monotonicity, and
 * the freshness window.
 *
 * Anti-rollback is `epoch < lastSeenEpoch` ⇒ reject. Equality is allowed: a
 * re-fetch of the same epoch is normal and is not a rollback.
 */
export function verifyCatalogHead(input: VerifyCatalogHeadInput): WrcVerdict<WrcHeadVerification> {
  const { head, keys, expectedPublisherPart, expectedDomain, lastSeenEpoch, nowS } = input

  if (head.publisher_part !== expectedPublisherPart) {
    return { ok: false, reason: 'head_part_mismatch', detail: head.publisher_part }
  }
  if (head.domain !== expectedDomain.toLowerCase()) {
    return { ok: false, reason: 'head_domain_mismatch', detail: head.domain }
  }

  const key = resolveSigningKey(keys, head.kid, head.epoch)
  if (!key.ok) return { ok: false, reason: key.reason, detail: head.kid }

  if (!wrcVerifyObjectSignature(head as unknown as Record<string, unknown>, key.pub)) {
    return { ok: false, reason: 'head_signature_invalid' }
  }

  if (lastSeenEpoch !== null && head.epoch < lastSeenEpoch) {
    return {
      ok: false,
      reason: 'head_epoch_rollback',
      detail: `saw epoch ${head.epoch}, already accepted ${lastSeenEpoch}`,
    }
  }

  const expiresAt = head.issued_at + head.freshness_window_s
  const staleBy = nowS > expiresAt ? nowS - expiresAt : 0
  return {
    ok: true,
    value: { head, freshness: staleBy > 0 ? 'stale' : 'fresh', stale_by_s: staleBy },
  }
}

// ── 3E — DualAssuranceEnvelope ────────────────────────────────────────────────

export interface WrcEnvelopeVerification {
  envelope: WrcEnvelope
  /** True when a suspension record is present (A5). */
  suspended: boolean
}

export interface VerifyEnvelopeInput {
  envelope: WrcEnvelope
  keys: WrcPublisherKeys
  /** The head this envelope must prove inclusion against. */
  verifiedHead: WrcCatalogHead
  /** Raw base64url Ed25519 public key of the WRC ingest countersigner. */
  ingestPub: string
  /**
   * When false, a suspended object still verifies and is returned with
   * `suspended: true` — the audit view needs it (§3.4). Admission paths leave
   * this at its default so suspension is a typed refusal.
   */
  allowSuspended?: boolean
}

/**
 * Verify all four legs: object hash binding, publisher signature, ingest
 * countersignature, and Merkle inclusion against the already-verified head.
 * Any missing leg ⇒ the object does not exist for the runtime.
 */
export function verifyEnvelope(input: VerifyEnvelopeInput): WrcVerdict<WrcEnvelopeVerification> {
  const { envelope, keys, verifiedHead, ingestPub, allowSuspended = false } = input

  // 1. The envelope's hash must actually be the hash of the object it carries.
  let computed: string
  try {
    computed = wrcHashObject(envelope.object)
  } catch {
    return { ok: false, reason: 'envelope_object_hash_mismatch', detail: 'not canonicalizable' }
  }
  if (!wrcHashEquals(computed, envelope.hash)) {
    return { ok: false, reason: 'envelope_object_hash_mismatch', detail: computed }
  }

  // 2. The envelope must belong to the epoch the verified head describes.
  if (envelope.epoch !== verifiedHead.epoch) {
    return {
      ok: false,
      reason: 'envelope_epoch_mismatch',
      detail: `envelope ${envelope.epoch} vs head ${verifiedHead.epoch}`,
    }
  }

  // 3. Publisher authorization.
  const key = resolveSigningKey(keys, envelope.publisher_sig_valid_kid, envelope.epoch)
  if (!key.ok) return { ok: false, reason: 'envelope_publisher_signature_invalid', detail: key.reason }
  if (!wrcVerifyObjectSignature(envelope.object, key.pub)) {
    return { ok: false, reason: 'envelope_publisher_signature_invalid' }
  }

  // 4. WRC ingest hygiene countersignature over `hash || epoch`.
  const csMessage = wrcCountersignatureMessage(envelope.hash, envelope.epoch)
  if (!wrcVerifyEd25519(csMessage, envelope.ingest_countersig.sig, ingestPub)) {
    return { ok: false, reason: 'envelope_countersignature_invalid' }
  }

  // 5. Inclusion in the verified catalog root.
  const folded = wrcFoldInclusionProof(envelope.hash, envelope.inclusion_proof)
  if (!folded || !wrcHashEquals(folded, verifiedHead.catalog_root)) {
    return { ok: false, reason: 'envelope_inclusion_proof_invalid', detail: folded ?? 'unfoldable' }
  }

  // 6. Suspension (A5): visible, typed, never a silent absence.
  if (envelope.suspension && !allowSuspended) {
    return { ok: false, reason: 'envelope_suspended', detail: envelope.suspension.reason_code }
  }

  return { ok: true, value: { envelope, suspended: envelope.suspension !== null } }
}

// ── 3F — EVP ──────────────────────────────────────────────────────────────────

export interface VerifyEvpInput {
  /** The object carried by an already-verified envelope. */
  object: Record<string, unknown>
  expectedPublisherPart: string
  expectedEntryId: string
}

/**
 * Decode and budget-check an EVP.
 *
 * The 64 KiB budget is a VERIFICATION failure, never a truncation (§3.3): a
 * client that trimmed an over-budget EVP would render a value statement the
 * publisher never signed in that form.
 */
export function verifyEvp(input: VerifyEvpInput): WrcVerdict<WrcEvp> {
  let canonicalBytes: number
  try {
    canonicalBytes = wrcCanonicalBytes(input.object).length
  } catch {
    return { ok: false, reason: 'evp_malformed', detail: 'not canonicalizable' }
  }
  if (canonicalBytes > WRC_EVP_MAX_CANONICAL_BYTES) {
    return {
      ok: false,
      reason: 'evp_over_budget',
      detail: `${canonicalBytes} > ${WRC_EVP_MAX_CANONICAL_BYTES}`,
    }
  }

  const evp = decodeEvp(input.object)
  if (!evp) return { ok: false, reason: 'evp_malformed' }
  if (evp.publisher_part !== input.expectedPublisherPart) {
    return { ok: false, reason: 'evp_part_mismatch', detail: evp.publisher_part }
  }
  if (evp.entry_id !== input.expectedEntryId) {
    return { ok: false, reason: 'evp_entry_mismatch', detail: evp.entry_id }
  }
  return { ok: true, value: evp }
}
