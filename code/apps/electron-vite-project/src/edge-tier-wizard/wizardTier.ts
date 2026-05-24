/**
 * Wizard tier gate — mirrors `isPaidTier()` in main-process wizard handlers.
 */

import { TIER_LEVEL, type Tier } from '../auth/capabilities.js'

const PAID_TIERS: ReadonlySet<Tier> = new Set([
  'private',
  'private_lifetime',
  'pro',
  'publisher',
  'publisher_lifetime',
  'enterprise',
])

export function isWizardPaidTier(tier: string | null | undefined): boolean {
  if (!tier) return false
  const t = tier as Tier
  return PAID_TIERS.has(t) || (TIER_LEVEL[t] ?? 0) >= TIER_LEVEL.pro
}

export function isEnterpriseExplainerTier(tier: string | null | undefined): boolean {
  return tier === 'enterprise'
}

export function formatWizardTierLabel(tier: string): string {
  if (tier === 'free') return 'Free'
  if (tier === 'enterprise') return 'Enterprise'
  if (tier === 'publisher' || tier === 'publisher_lifetime') return 'Publisher'
  if (tier === 'pro') return 'Pro'
  if (tier === 'private' || tier === 'private_lifetime') return 'Private'
  return tier
}
