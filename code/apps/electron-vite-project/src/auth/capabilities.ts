// ============================================================================
// MVP Tier System - Single Source of Truth
// ============================================================================
// Tiers represent subscription levels. No feature flags or capabilities.
// UI gating is based on `isLoggedIn` (session valid) and `tier`.
// FAIL-CLOSED: Missing roles → 'free' tier (never invent roles client-side)
// ============================================================================

/**
 * Available subscription tiers (aligned with pricing)
 * - 'free': Baseline tier, always active after login if no other tier detected
 * - 'pro': Paid tier
 * - 'enterprise': Full enterprise tier
 */
export type Tier = 'free' | 'pro' | 'enterprise';

/**
 * Default tier for new logins (fail-closed)
 */
export const DEFAULT_TIER: Tier = 'free';

/**
 * Check if roles are present in token (diagnostic helper)
 * Returns true if roles array exists and has at least one role
 * Does NOT log or expose token contents
 */
export function hasRolesInToken(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && roles.length > 0;
}

/**
 * Map Keycloak roles to tier
 * Only maps roles that EXACTLY match tier names.
 * If no tier role is found, returns DEFAULT_TIER (fail-closed).
 * 
 * SECURITY: Never invents roles client-side.
 * If Keycloak roles include 'pro' or 'enterprise', use that tier.
 * Otherwise, default to 'free'.
 * 
 * @param keycloakRoles - Combined realm + client roles from token
 * @returns Tier based on role presence
 */
export function mapRolesToTier(keycloakRoles: string[]): Tier {
  // FAIL-CLOSED: If no roles provided, log diagnostic and return default
  if (!hasRolesInToken(keycloakRoles)) {
    console.log('[TIER] roles missing in token; check Keycloak mappers');
    return DEFAULT_TIER;
  }

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
  
  // No tier role found - default to free (not an error, just no premium role)
  return DEFAULT_TIER;
}
