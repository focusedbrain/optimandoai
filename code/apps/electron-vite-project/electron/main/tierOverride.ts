/**
 * Pending tier override — short-lived bridge when tier_changed event arrives
 * before Keycloak token refresh has propagated. Used by coordinationWs and main.ts.
 * TTL: 60 seconds. Higher tier wins when combining with canonical_tier.
 */

export interface PendingTierOverride {
  tier: string
  expiresAt: number
}

let pendingOverride: PendingTierOverride | null = null

const OVERRIDE_TTL_MS = 60_000

export function setPendingTierOverride(tier: string, userId?: string): void {
  pendingOverride = {
    tier: tier.toLowerCase().trim(),
    expiresAt: Date.now() + OVERRIDE_TTL_MS,
  }
  console.log('[TIER_CHANGED_EVENT] incoming tier=', tier, ', user id=', userId ?? '(current)', ', override stored until=', new Date(pendingOverride.expiresAt).toISOString())
}

export function getPendingTierOverride(): PendingTierOverride | null {
  if (!pendingOverride) return null
  if (Date.now() > pendingOverride.expiresAt) {
    pendingOverride = null
    return null
  }
  return pendingOverride
}

export function clearPendingTierOverride(): void {
  pendingOverride = null
}
