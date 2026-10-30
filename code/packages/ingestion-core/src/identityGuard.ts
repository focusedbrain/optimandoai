/**
 * Full-claim identity guard — the single identity-comparison implementation
 * for handshake ingest/ack/return paths (WR Handshake [VII.3.8–3.10]).
 *
 * Rules:
 * - A presented identity matches a bound identity only when EVERY claim the
 *   relationship was bound with (non-empty on the bound side) is present and
 *   exactly equal on the presented side. No OR-logic, no sub-only shortcuts.
 * - Legacy bindings that lack claims are reported via `identityComplete: false`
 *   so callers can flag them for repair UX (adopted decision Q12) — they are
 *   never treated as full-assurance matches, and enforcement call sites decide
 *   whether incomplete bindings are acceptable for their path.
 * - Fail-closed: an identity with no bound claims never matches anything.
 *
 * Portable: no Electron, DB, or app-state dependencies (lives in
 * @repo/ingestion-core so the Electron main process and the coordination
 * service share the exact same comparison logic).
 */

export type IdentityClaimName = 'iss' | 'sub' | 'email' | 'wrdesk_user_id'

export const ALL_IDENTITY_CLAIMS: readonly IdentityClaimName[] = [
  'iss',
  'sub',
  'email',
  'wrdesk_user_id',
] as const

/**
 * Claims that identify a principal on their own. `iss` is a realm, not an
 * identity — it only ever qualifies a subject, so a binding or overlap that
 * consists of `iss` alone can never establish an identity match.
 */
const IDENTIFYING_CLAIMS: readonly IdentityClaimName[] = ['sub', 'email', 'wrdesk_user_id'] as const

/**
 * A (partial) identity claim set. Empty strings, null, and undefined all mean
 * "claim not bound / not presented".
 */
export interface IdentityClaimSet {
  iss?: string | null
  sub?: string | null
  email?: string | null
  wrdesk_user_id?: string | null
}

export interface FullClaimGuardOk {
  ok: true
  /**
   * True only when all four claims were bound AND matched. False means the
   * binding is legacy/incomplete — callers must surface repair UX (Q12) and
   * must not upgrade the relationship's assurance based on this match.
   */
  identityComplete: boolean
  matchedClaims: IdentityClaimName[]
}

export type FullClaimGuardFailReason =
  /** The bound identity carries no claims at all — nothing can ever match it. */
  | 'no_bound_claims'
  /** At least one bound claim is present on both sides but differs. */
  | 'claim_mismatch'
  /** A bound claim is missing entirely from the presented identity. */
  | 'presented_claim_missing'

export interface FullClaimGuardFail {
  ok: false
  reason: FullClaimGuardFailReason
  /** Bound claims that matched (identity collision indicator when non-empty). */
  matchedClaims: IdentityClaimName[]
  /** Bound claims that were present on both sides but differed. */
  mismatchedClaims: IdentityClaimName[]
  /** Bound claims absent from the presented identity. */
  missingClaims: IdentityClaimName[]
}

export type FullClaimGuardResult = FullClaimGuardOk | FullClaimGuardFail

function normalizeClaim(name: IdentityClaimName, value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (name === 'email') return trimmed.toLowerCase()
  return trimmed
}

/**
 * Full-claim exact match of a presented identity against a bound identity.
 *
 * The bound claim set is authoritative: every claim the relationship was bound
 * with must be present and equal on the presented side. Extra claims on the
 * presented side are ignored (they were never part of the binding).
 */
export function fullClaimIdentityMatch(
  presented: IdentityClaimSet | null | undefined,
  bound: IdentityClaimSet | null | undefined,
): FullClaimGuardResult {
  if (!bound || !presented) {
    return {
      ok: false,
      reason: 'no_bound_claims',
      matchedClaims: [],
      mismatchedClaims: [],
      missingClaims: [],
    }
  }

  const matchedClaims: IdentityClaimName[] = []
  const mismatchedClaims: IdentityClaimName[] = []
  const missingClaims: IdentityClaimName[] = []
  let boundCount = 0
  let boundIdentifyingCount = 0

  for (const claim of ALL_IDENTITY_CLAIMS) {
    const boundValue = normalizeClaim(claim, bound[claim])
    if (boundValue.length === 0) continue
    boundCount++
    if (IDENTIFYING_CLAIMS.includes(claim)) boundIdentifyingCount++
    const presentedValue = normalizeClaim(claim, presented[claim])
    if (presentedValue.length === 0) {
      missingClaims.push(claim)
    } else if (presentedValue === boundValue) {
      matchedClaims.push(claim)
    } else {
      mismatchedClaims.push(claim)
    }
  }

  // An iss-only binding identifies a realm, not a principal — fail-closed.
  if (boundCount === 0 || boundIdentifyingCount === 0) {
    return {
      ok: false,
      reason: 'no_bound_claims',
      matchedClaims: [],
      mismatchedClaims: [],
      missingClaims: [],
    }
  }

  if (mismatchedClaims.length > 0) {
    return { ok: false, reason: 'claim_mismatch', matchedClaims, mismatchedClaims, missingClaims }
  }
  if (missingClaims.length > 0) {
    return {
      ok: false,
      reason: 'presented_claim_missing',
      matchedClaims,
      mismatchedClaims,
      missingClaims,
    }
  }

  return {
    ok: true,
    identityComplete: boundCount === ALL_IDENTITY_CLAIMS.length,
    matchedClaims,
  }
}

/**
 * True when the guard failed but an IDENTIFYING claim still collided — i.e. a
 * partially overlapping identity (same subject, email, or wrdesk id under a
 * different issuer/other claims). Callers on ingest/ack paths must treat this
 * as an ownership violation / spoof indicator, never as "different principal,
 * carry on". A matching issuer alone is not a collision — it only means the
 * two identities live in the same realm.
 */
export function isPartialIdentityCollision(result: FullClaimGuardResult): boolean {
  return !result.ok && result.matchedClaims.some((c) => IDENTIFYING_CLAIMS.includes(c))
}

export interface SamePrincipalOk {
  ok: true
  /** All four claims present on both sides and equal. */
  identityComplete: boolean
}

export interface SamePrincipalFail {
  ok: false
  reason: 'claim_mismatch' | 'insufficient_overlap'
  mismatchedClaims: IdentityClaimName[]
}

export type SamePrincipalResult = SamePrincipalOk | SamePrincipalFail

/**
 * Symmetric full-claim same-principal check (internal handshakes: initiator
 * and acceptor must be the same human/account).
 *
 * Every claim present on BOTH sides must be exactly equal — a mismatch on any
 * shared claim fails, regardless of how many other claims agree. At least one
 * IDENTIFYING claim (sub, email, wrdesk_user_id) must overlap and match;
 * identities whose only shared claim is the issuer (a realm, not an identity)
 * or that share no claims at all are never the same principal (fail-closed).
 */
export function samePrincipalFullClaim(
  a: IdentityClaimSet | null | undefined,
  b: IdentityClaimSet | null | undefined,
): SamePrincipalResult {
  if (!a || !b) {
    return { ok: false, reason: 'insufficient_overlap', mismatchedClaims: [] }
  }

  const mismatchedClaims: IdentityClaimName[] = []
  let matched = 0
  let matchedIdentifying = 0

  for (const claim of ALL_IDENTITY_CLAIMS) {
    const va = normalizeClaim(claim, a[claim])
    const vb = normalizeClaim(claim, b[claim])
    if (va.length === 0 || vb.length === 0) continue
    if (va === vb) {
      matched++
      if (IDENTIFYING_CLAIMS.includes(claim)) matchedIdentifying++
    } else {
      mismatchedClaims.push(claim)
    }
  }

  if (mismatchedClaims.length > 0) {
    return { ok: false, reason: 'claim_mismatch', mismatchedClaims }
  }
  if (matchedIdentifying === 0) {
    return { ok: false, reason: 'insufficient_overlap', mismatchedClaims: [] }
  }
  return { ok: true, identityComplete: matched === ALL_IDENTITY_CLAIMS.length }
}
