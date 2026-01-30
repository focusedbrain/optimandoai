// ============================================================================
// MVP Tier System - Single Source of Truth
// ============================================================================
// Tiers represent subscription levels. No feature flags or capabilities.
// UI gating is based on `isLoggedIn` (session valid) and `tier`.
// ============================================================================

/**
 * Available subscription tiers (aligned with pricing)
 * - 'free': Baseline tier, always active after login if no other tier detected
 * - 'pro': Paid tier
 * - 'enterprise': Full enterprise tier
 */
export type Tier = 'free' | 'pro' | 'enterprise';

/**
 * Default tier for new logins
 */
export const DEFAULT_TIER: Tier = 'free';

/**
 * Map Keycloak roles to tier
 * Only maps roles that EXACTLY match tier names.
 * If no tier role is found, returns DEFAULT_TIER.
 * 
 * This is intentionally simple - no invented role mappings.
 * If Keycloak roles include 'pro' or 'enterprise', use that tier.
 * Otherwise, default to 'free'.
 */
export function mapRolesToTier(keycloakRoles: string[]): Tier {
  // Check for exact tier name matches only (case-insensitive)
  const normalizedRoles = keycloakRoles.map(r => r.toLowerCase());
  
  // Enterprise has highest priority
  if (normalizedRoles.includes('enterprise')) {
    return 'enterprise';
  }
  
  // Pro is next
  if (normalizedRoles.includes('pro')) {
    return 'pro';
  }
  
  // Default to free
  return DEFAULT_TIER;
}
