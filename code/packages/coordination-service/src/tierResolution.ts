/**
 * Coordination Service — JWT tier resolution
 *
 * Pure function: reads known tier-carrying claims from a decoded JWT payload
 * and returns the highest-ranked known tier. No logging, no side effects,
 * never throws.
 *
 * Priority order:
 *   1. wrdesk_plan  — Keycloak user attribute; exact tier name (highest priority)
 *   2. realm_access.roles — Keycloak realm roles; highest-ranked known tier wins
 *   3. tier         — legacy flat claim (backward compat)
 *   4. wrdesk_tier  — legacy flat claim (backward compat)
 *   5. 'free'       — fail-safe default
 *
 * "Known tier names" are the keys of TIER_LIMITS in rateLimiter.ts.
 *
 * import type guard: rateLimiter.ts uses `import type` from auth.ts, so
 * importing TIER_LIMITS here creates no runtime circular dependency.
 */

import { TIER_LIMITS } from './rateLimiter.js'

/**
 * Canonical tier precedence: highest product tier first.
 *
 * This is intentionally hardcoded rather than derived from
 * TIER_LIMITS.capsulesPerMonth. Tier ranking is a product/billing concept;
 * rate-limit budgets are operational policy. They happened to align, but PR 3
 * decoupled them: same-principal BEAP traffic is now unmetered regardless of
 * tier, so capsulesPerMonth is no longer an authoritative signal for ordering.
 * Hardcoding the rank here makes the precedence explicit and immune to future
 * budget changes that should not affect claim resolution.
 *
 * Filtered against TIER_LIMITS keys at module load so the array stays in sync
 * with any tiers that are subsequently removed from the rate-limiter config.
 */
const CANONICAL_TIER_ORDER: ReadonlyArray<string> = ['enterprise', 'publisher', 'pro', 'free']
const TIER_RANK: ReadonlyArray<string> = CANONICAL_TIER_ORDER.filter((t) => t in TIER_LIMITS)

function isKnownTier(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIER_LIMITS, value)
}

/**
 * Given a roles value from realm_access, return the highest-ranked known tier
 * present, or null if none found. Non-string array elements are ignored.
 */
function highestTierFromRoles(roles: unknown): string | null {
  if (!Array.isArray(roles)) return null
  for (const tier of TIER_RANK) {
    if (roles.some((r) => r === tier)) return tier
  }
  return null
}

/**
 * Resolve the effective tier from a decoded JWT payload.
 * Never throws; all malformed or missing input returns 'free'.
 */
export function resolveRelayTier(payload: Record<string, unknown>): string {
  // 1. wrdesk_plan — Keycloak user attribute; authoritative tier name.
  const plan = payload.wrdesk_plan
  if (typeof plan === 'string' && isKnownTier(plan)) return plan

  // 2. realm_access.roles — highest-ranked known tier in the roles array wins.
  //    Guards against non-object realm_access and non-array roles.
  const ra = payload.realm_access
  if (ra != null && typeof ra === 'object' && !Array.isArray(ra)) {
    const roles = (ra as Record<string, unknown>).roles
    const fromRoles = highestTierFromRoles(roles)
    if (fromRoles !== null) return fromRoles
  }

  // 3. Legacy 'tier' flat claim.
  const legacyTier = payload.tier
  if (typeof legacyTier === 'string' && legacyTier) return legacyTier

  // 4. Legacy 'wrdesk_tier' flat claim.
  const legacyWrdesk = payload.wrdesk_tier
  if (typeof legacyWrdesk === 'string' && legacyWrdesk) return legacyWrdesk

  // 5. Fail-safe default.
  return 'free'
}
