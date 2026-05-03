/**
 * Coordination Service — Feature entitlements
 *
 * Maps product tiers to gated features. Kept separate from `rateLimiter.ts`
 * by design: rate limits are operational policy; entitlements are product/
 * billing policy. Coupling them means a future budget change silently changes
 * what features are accessible, which is a billing correctness bug.
 *
 * The sandbox entitlement introduced here is the actual paid-feature gate for
 * sandbox orchestration (PR 4). The HTTP 429s that users saw before this
 * refactor were a rate-limiter accident, not a real entitlement check.
 */

/**
 * Tiers that include sandbox orchestration entitlement.
 * `free` is excluded — that is the paid-feature line.
 * `enterprise` is included for forward-compatibility even if not yet in
 * TIER_LIMITS; adding it here is harmless and avoids a two-file edit later.
 */
export const SANDBOX_ENTITLED_TIERS: ReadonlySet<string> = new Set([
  'pro',
  'publisher',
  'enterprise',
])

/**
 * Returns true iff `tier` grants access to sandbox orchestration.
 * Never throws; unknown tiers return false (fail-closed).
 */
export function hasSandboxEntitlement(tier: string): boolean {
  return SANDBOX_ENTITLED_TIERS.has(tier)
}
