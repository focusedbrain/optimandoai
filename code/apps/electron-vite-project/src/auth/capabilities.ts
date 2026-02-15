// ============================================================================
// MVP Tier System - Single Source of Truth
// ============================================================================
// Tiers represent subscription levels. No feature flags or capabilities.
// UI gating is based on `isLoggedIn` (session valid) and `tier`.
// FAIL-CLOSED: Missing plan/roles → 'free' tier (never invent tiers client-side)
//
// PRIMARY: wrdesk_plan claim from Keycloak User Attribute (e.g. 'pro', 'publisher')
// FALLBACK: Keycloak roles (realm_access + resource_access)
// ============================================================================

/**
 * Available subscription tiers (aligned with pricing & Keycloak)
 * - 'free': Baseline tier, always active after login if no other tier detected
 * - 'private': Private annual subscription
 * - 'private_lifetime': Private lifetime license
 * - 'pro': Pro subscription (from wrdesk_plan)
 * - 'publisher': Publisher annual subscription
 * - 'publisher_lifetime': Publisher lifetime license
 * - 'enterprise': Full enterprise tier
 */
export type Tier = 'free' | 'private' | 'private_lifetime' | 'pro' | 'publisher' | 'publisher_lifetime' | 'enterprise';

/**
 * Default tier for new logins (fail-closed)
 */
export const DEFAULT_TIER: Tier = 'free';

/**
 * Valid tier values that can come from the wrdesk_plan claim
 */
const VALID_PLAN_TIERS: readonly string[] = ['free', 'private', 'private_lifetime', 'pro', 'publisher', 'publisher_lifetime', 'enterprise'];

/**
 * Check if roles are present in token (diagnostic helper)
 * Returns true if roles array exists and has at least one role
 * Does NOT log or expose token contents
 */
export function hasRolesInToken(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && roles.length > 0;
}

/**
 * Determine tier from wrdesk_plan claim and/or Keycloak roles.
 * 
 * Priority:
 * 1. wrdesk_plan claim (custom Keycloak User Attribute) - if present and valid
 * 2. Keycloak roles (fallback for backwards compatibility)
 * 3. DEFAULT_TIER ('free') if neither provides a valid tier
 * 
 * SECURITY: Never invents tiers client-side. Fail-closed to 'free'.
 * 
 * @param wrdesk_plan - Value of the wrdesk_plan JWT claim (from Keycloak User Attribute)
 * @param keycloakRoles - Combined realm + client roles from token (fallback)
 * @returns Resolved tier
 */
export function resolveTier(wrdesk_plan: string | undefined, keycloakRoles: string[]): Tier {
  // PRIMARY: Use wrdesk_plan claim if present and valid
  if (wrdesk_plan) {
    const normalized = wrdesk_plan.toLowerCase().trim();
    if (VALID_PLAN_TIERS.includes(normalized)) {
      console.log('[TIER] Resolved from wrdesk_plan claim: ' + normalized);
      return normalized as Tier;
    }
    console.log('[TIER] wrdesk_plan claim has unrecognized value: "' + wrdesk_plan + '", falling back to roles');
  }

  // FALLBACK: Map Keycloak roles to tier
  return mapRolesToTier(keycloakRoles);
}

/**
 * Map Keycloak roles to tier (fallback when wrdesk_plan is not set)
 * Maps roles that match tier names (including lifetime sub-roles).
 * If no tier role is found, returns DEFAULT_TIER (fail-closed).
 * 
 * SECURITY: Never invents roles client-side.
 * Priority order: enterprise > publisher_lifetime > publisher > pro > private_lifetime > private > free
 * 
 * @param keycloakRoles - Combined realm + client roles from token
 * @returns Tier based on role presence
 */
export function mapRolesToTier(keycloakRoles: string[]): Tier {
  // FAIL-CLOSED: If no roles provided, log diagnostic and return default
  if (!hasRolesInToken(keycloakRoles)) {
    console.log('[TIER] No wrdesk_plan and no roles in token; defaulting to free');
    return DEFAULT_TIER;
  }

  // Check for exact tier name matches only (case-insensitive)
  const normalizedRoles = keycloakRoles.map(r => r.toLowerCase());
  
  // Enterprise has highest priority
  if (normalizedRoles.includes('enterprise')) {
    return 'enterprise';
  }
  
  // Publisher lifetime takes priority over publisher annual
  if (normalizedRoles.includes('publisher_lifetime')) {
    return 'publisher_lifetime';
  }
  
  // Publisher annual
  if (normalizedRoles.includes('publisher')) {
    return 'publisher';
  }

  // Pro
  if (normalizedRoles.includes('pro')) {
    return 'pro';
  }
  
  // Private lifetime takes priority over private annual
  if (normalizedRoles.includes('private_lifetime')) {
    return 'private_lifetime';
  }
  
  // Private annual
  if (normalizedRoles.includes('private')) {
    return 'private';
  }
  
  // No tier role found - default to free (not an error, just no premium role)
  return DEFAULT_TIER;
}
