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
 * Numeric tier hierarchy for "higher tier wins" resolution.
 * Used when both plan and roles provide a tier — prevents downgrades from stale plan.
 */
export const TIER_LEVEL: Record<Tier, number> = {
  free: 0,
  private: 1,
  private_lifetime: 2,
  pro: 3,
  publisher: 4,
  publisher_lifetime: 5,
  enterprise: 6,
} as const;

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
 * Extract SSO-derived tier from Keycloak roles.
 * Used as an additional fallback when plan claim is missing.
 *
 * Maps only: enterprise → enterprise, publisher → publisher, pro → pro.
 * Returns undefined for other roles (e.g. publisher_lifetime, private).
 *
 * @param roles - Combined realm + client roles from token
 * @returns Tier if a tier role is present, otherwise undefined
 */
export function extractSsoTierFromRoles(roles: string[]): Tier | undefined {
  if (!Array.isArray(roles) || roles.length === 0) return undefined;
  const normalized = roles.map(r => r.toLowerCase());
  if (normalized.includes('enterprise')) return 'enterprise';
  if (normalized.includes('publisher')) return 'publisher';
  if (normalized.includes('pro')) return 'pro';
  return undefined;
}

/**
 * Resolve tier from plan claim only (no roles).
 * Returns undefined if plan is missing or unrecognized.
 */
function tierFromPlanClaim(wrdesk_plan?: string): Tier | undefined {
  if (!wrdesk_plan?.trim()) return undefined;
  const normalized = wrdesk_plan.toLowerCase().trim();

  const WC_PLAN_ALIASES: Record<string, Tier> = {
    'private': 'pro',
    'private_lifetime': 'pro',
  };
  if (WC_PLAN_ALIASES[normalized]) return WC_PLAN_ALIASES[normalized];
  if (VALID_PLAN_TIERS.includes(normalized)) return normalized as Tier;

  const FUZZY_MAP: Array<{ pattern: RegExp; tier: Tier }> = [
    { pattern: /enterprise/i, tier: 'enterprise' },
    { pattern: /publisher.*life/i, tier: 'publisher_lifetime' },
    { pattern: /publisher/i, tier: 'publisher' },
    { pattern: /\bpro\b/i, tier: 'pro' },
    { pattern: /private.*life/i, tier: 'pro' },
    { pattern: /\bprivate\b/i, tier: 'pro' },
  ];
  for (const { pattern, tier } of FUZZY_MAP) {
    if (pattern.test(normalized)) return tier;
  }
  return undefined;
}

/**
 * Determine tier from wrdesk_plan claim and/or Keycloak roles.
 *
 * When both plan and roles provide a tier, returns the higher tier (prevents
 * downgrades from stale plan claims). Otherwise uses plan or roles fallback.
 *
 * Priority:
 * 1. tierFromPlan = plan claim logic
 * 2. tierFromRoles = ssoTier ?? mapRolesToTier(roles)
 * 3. Return max(tierFromPlan, tierFromRoles) by TIER_LEVEL
 * 4. DEFAULT_TIER ('free') if neither provides a valid tier
 *
 * SECURITY: Never invents tiers client-side. Fail-closed to 'free'.
 *
 * @param wrdesk_plan - Value of the wrdesk_plan JWT claim
 * @param keycloakRoles - Combined realm + client roles from token
 * @param ssoTier - Optional SSO-derived tier from roles
 * @returns Resolved tier
 */
export function resolveTier(
  wrdesk_plan?: string,
  keycloakRoles: string[] = [],
  ssoTier?: Tier,
): Tier {
  const tierFromPlan = tierFromPlanClaim(wrdesk_plan);
  const tierFromRoles = ssoTier ?? mapRolesToTier(keycloakRoles);

  const levelFromPlan = tierFromPlan ? TIER_LEVEL[tierFromPlan] ?? 0 : 0;
  const levelFromRoles = tierFromRoles ? TIER_LEVEL[tierFromRoles] ?? 0 : 0;

  const canonicalTier = levelFromPlan >= levelFromRoles
    ? (tierFromPlan ?? tierFromRoles)
    : tierFromRoles;

  const result = canonicalTier ?? DEFAULT_TIER;

  if (tierFromPlan && tierFromRoles && tierFromPlan !== tierFromRoles) {
    console.log('[TIER] Plan/roles mismatch — higher tier wins: plan=' + tierFromPlan + ', roles=' + tierFromRoles + ' → ' + result);
  } else if (tierFromPlan) {
    console.log('[TIER] Resolved from plan claim: ' + result);
  } else if (ssoTier) {
    console.log('[TIER] Resolved from SSO roles (plan missing): ' + result);
  } else if (tierFromRoles !== DEFAULT_TIER) {
    console.log('[TIER] Resolved from roles fallback: ' + result);
  } else {
    console.log('[TIER] No plan or roles; defaulting to free');
  }

  return result;
}

/**
 * Map Keycloak roles to tier (fallback when wrdesk_plan is not set)
 * Maps roles that match tier names (including lifetime sub-roles).
 * If no tier role is found, returns DEFAULT_TIER (fail-closed).
 * 
 * SECURITY: Never invents roles client-side.
 * Priority order: enterprise > publisher_lifetime > publisher > pro > private_lifetime > private > free
 * Note: WooCommerce 'private' → 'pro' alias is handled only in resolveTier() for wrdesk_plan claims.
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
  
  // Private lifetime
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
