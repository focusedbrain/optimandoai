import { loadRefreshToken, clearRefreshToken, saveRefreshToken } from './tokenStore';
import { getCachedUserInfo, setCachedUserInfo } from './sessionCache';
export { getCachedUserInfo } from './sessionCache';
import { refreshWithKeycloak, OidcRefreshError, type RefreshTokenResponse } from './refresh';
import { extractSsoTierFromRoles, mapRolesToTier, resolveTier, type Tier } from './capabilities';

// ============================================================================
// Session Management - Enterprise-Grade Auth Session
// ============================================================================
// SECURITY NOTES:
// - Access token kept in RAM only, never persisted
// - Refresh token stored in OS credential store (keytar)
// - User info decoded from JWT, not stored separately
// - Fail-closed: any error results in null session
// ============================================================================

// User information extracted from JWT claims
export interface SessionUserInfo {
  displayName?: string;
  email?: string;
  initials?: string;
  picture?: string;  // Avatar URL from Keycloak profile (if available)
  sub?: string;
  iss?: string;      // Token issuer (iss claim)
  wrdesk_user_id?: string;  // Canonical wrdesk user ID (custom Keycloak claim)
  roles?: string[];  // Keycloak roles (realm + client roles)
  wrdesk_plan?: string;  // wrdesk_plan claim from Keycloak (e.g. 'pro', 'publisher', 'enterprise')
  sso_tier?: Tier;  // SSO-derived tier from roles (fallback when plan claim missing)
  canonical_tier?: Tier;  // Authoritative tier — computed once during session creation
}

// Module-level variables (RAM only, not persisted)
let accessToken: string | null = null;
let expiresAt: number | null = null;

// Buffer before expiry to trigger refresh (60 seconds)
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Decode JWT payload without verification (used after token refresh)
 * Note: Token is already verified by Keycloak during refresh
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// Plan claim keys — supports underscore, hyphen, and camelCase (Keycloak mapper variations)
const PLAN_CLAIM_KEYS = [
  'wrdesk_plan',
  'wrdesk_plans',
  'wrdesk-plan',
  'wrdeskPlan',
  'wrdeskTier',
  'user_plan',
  'user_plans',
  'plan',
  'plans',
  'subscription',
  'subscription_plan',
  'subscriptionTier',
  'subscription-tier',
  'tier',
  'user_tier',
] as const;

const NESTED_ATTRIBUTE_KEYS = [
  'user_attributes',
  'attributes',
  'custom_attributes',
  'user_metadata',
] as const;

/**
 * Extract plan from a single JWT payload.
 * Searches direct claims and nested attribute objects.
 */
function extractPlanFromPayload(payload: Record<string, unknown>): string | undefined {
  for (const key of PLAN_CLAIM_KEYS) {
    const val = payload[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
      return val[0].trim();
    }
  }
  for (const attrKey of NESTED_ATTRIBUTE_KEYS) {
    const attrs = payload[attrKey] as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object') {
      for (const key of PLAN_CLAIM_KEYS) {
        const val = (attrs as Record<string, unknown>)[key];
        if (typeof val === 'string' && val.trim()) {
          return val.trim();
        }
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
          return val[0].trim();
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract roles from JWT payload (Keycloak format)
 * 
 * Keycloak includes roles in two locations:
 * - realm_access.roles: Realm-level roles
 * - resource_access.<client_id>.roles: Client-specific roles
 * 
 * SECURITY: Does NOT invent roles. If token lacks role claims, returns empty array.
 * Caller should use mapRolesToTier() which will fail-closed to 'free' tier.
 */
function extractRoles(payload: Record<string, unknown>): string[] {
  const roles: string[] = [];
  
  // Check for realm_access claim presence
  const hasRealmAccess = 'realm_access' in payload;
  // Check for resource_access claim presence
  const hasResourceAccess = 'resource_access' in payload;
  
  // Extract realm roles: realm_access.roles
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  if (realmAccess?.roles && Array.isArray(realmAccess.roles)) {
    roles.push(...realmAccess.roles);
  }
  
  // Extract client roles: resource_access.wrdesk-orchestrator.roles
  const resourceAccess = payload.resource_access as Record<string, { roles?: string[] }> | undefined;
  if (resourceAccess) {
    const clientRoles = resourceAccess['wrdesk-orchestrator']?.roles;
    if (clientRoles && Array.isArray(clientRoles)) {
      roles.push(...clientRoles);
    }
  }
  
  // Diagnostic: Log roles presence check (no token content)
  console.log('[SESSION] Roles extraction: hasRealmAccess=' + hasRealmAccess + ', hasResourceAccess=' + hasResourceAccess + ', totalRoles=' + roles.length);
  
  return roles;
}

/**
 * Extract profile fields (name, email, sub, etc.) from a JWT payload.
 * Used for identity display; does not include plan or roles.
 */
function extractProfileFromPayload(payload: Record<string, unknown>): Pick<
  SessionUserInfo,
  'displayName' | 'email' | 'initials' | 'picture' | 'sub' | 'iss' | 'wrdesk_user_id'
> {
  const name = payload.name as string | undefined;
  const preferredUsername = payload.preferred_username as string | undefined;
  const email = payload.email as string | undefined;
  const givenName = payload.given_name as string | undefined;
  const familyName = payload.family_name as string | undefined;
  const sub = payload.sub as string | undefined;
  const iss = payload.iss as string | undefined;
  const picture = payload.picture as string | undefined;
  const wrdesk_user_id = (payload.wrdesk_user_id ?? payload.wrdesk_uid ?? sub) as string | undefined;

  let displayName = name;
  if (!displayName && givenName && familyName) {
    displayName = `${givenName} ${familyName}`;
  }
  if (!displayName) {
    displayName = preferredUsername || email;
  }

  let initials: string | undefined;
  if (givenName && familyName) {
    initials = (givenName.charAt(0) + familyName.charAt(0)).toUpperCase();
  } else if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    initials = parts.length >= 2
      ? (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
      : displayName.charAt(0).toUpperCase();
  } else if (email) {
    initials = email.charAt(0).toUpperCase();
  }

  return { displayName, email, initials, picture, sub, iss, wrdesk_user_id };
}

/**
 * Extract user info from BOTH id_token and access_token.
 *
 * Plan extraction priority: access_token first (entitlements often only in access_token),
 * then id_token. Plan always overrides role fallback in resolveTier().
 *
 * Roles: merged from both tokens and deduplicated.
 * Profile: prefer id_token (identity claims), fallback to access_token.
 */
function extractUserInfoFromTokens(tokens: {
  access_token: string;
  id_token?: string;
}): SessionUserInfo | null {
  const idPayload = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
  const accessPayload = tokens.access_token ? decodeJwtPayload(tokens.access_token) : null;

  if (!idPayload && !accessPayload) {
    return null;
  }

  // Plan: access_token first (Keycloak often puts entitlement claims only in access_token)
  const planFromAccess = accessPayload ? extractPlanFromPayload(accessPayload) : undefined;
  const planFromId = idPayload ? extractPlanFromPayload(idPayload) : undefined;
  const plan = planFromAccess || planFromId;

  // Roles: merge from both tokens, deduplicate
  const rolesFromId = idPayload ? extractRoles(idPayload) : [];
  const rolesFromAccess = accessPayload ? extractRoles(accessPayload) : [];
  const roles = [...new Set([...rolesFromId, ...rolesFromAccess])];

  // Profile: prefer id_token (identity claims), fallback to access_token
  const profilePayload = idPayload ?? accessPayload
  if (!profilePayload) return null
  const profile = extractProfileFromPayload(profilePayload)

  // Debug logging for plan extraction
  if (plan) {
    const source = planFromAccess ? 'access_token' : 'id_token';
    console.log('[SESSION] Plan found in ' + source + ': ' + plan);
  } else {
    const standardClaims = new Set([
      'iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti', 'typ', 'azp', 'nonce',
      'auth_time', 'session_state', 'acr', 'sid', 'at_hash', 'c_hash',
      'name', 'given_name', 'family_name', 'preferred_username', 'email',
      'email_verified', 'picture', 'locale', 'updated_at', 'scope',
      'realm_access', 'resource_access', 'allowed-origins',
    ]);
    const customClaims: Record<string, string> = {};
    for (const p of [idPayload, accessPayload]) {
      if (p) {
        for (const [k, v] of Object.entries(p)) {
          if (!standardClaims.has(k)) {
            customClaims[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
          }
        }
      }
    }
    console.log('[SESSION] ⚠️ No plan claim found in either token. Custom JWT claims:', JSON.stringify(customClaims));
    console.log('[SESSION] ⚠️ Roles extracted:', JSON.stringify(roles));
  }

  console.debug('[SESSION]', { planFromAccess, planFromId, resolvedPlan: plan, roles });

  // SSO-derived tier from roles (fallback when plan claim missing)
  const ssoTier = extractSsoTierFromRoles(roles);

  // Canonical tier — single authority, computed once during session creation
  const canonicalTier = resolveTier(plan, roles, ssoTier);
  console.debug('[TIER_RESOLUTION]', { plan, roles, ssoTier, canonicalTier });

  return {
    ...profile,
    roles,
    wrdesk_plan: plan,
    sso_tier: ssoTier,
    canonical_tier: canonicalTier,
  };
}

/** Exported for testing plan extraction from both tokens */
export { extractUserInfoFromTokens };

/**
 * Ensure a valid session exists
 *
 * - If accessToken exists and not expiring soon, return it
 * - Otherwise, tries to load refresh token from credential store
 * - If present, attempts to refresh tokens
 * - On success: keeps access token and expiresAt in memory, returns it
 * - On failure: clears refresh token, returns null
 *
 * Does NOT trigger browser login
 * Does NOT store access token persistently
 */
export async function ensureSession(forceRefresh = false): Promise<{ accessToken: string | null; userInfo?: SessionUserInfo }> {
  // Return cached token if still valid (with 60s buffer)
  if (!forceRefresh && accessToken && expiresAt && expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    // [CHECKPOINT F] Log unlock decision: cached valid
    console.log('[SESSION][F] ensureSession: UNLOCKED (cached token valid, expiresAt=' + new Date(expiresAt).toISOString() + ')');
    return { accessToken, userInfo: getCachedUserInfo() || undefined };
  }

  const refreshToken = await loadRefreshToken();

  if (!refreshToken) {
    accessToken = null;
    expiresAt = null;
    setCachedUserInfo(null);
    // [CHECKPOINT F] Log unlock decision: no refresh token
    console.log('[SESSION][F] ensureSession: LOCKED (reason=no_refresh_token)');
    return { accessToken: null };
  }

  const applyRefreshedTokens = async (tokens: RefreshTokenResponse) => {
    accessToken = tokens.access_token;
    expiresAt = Date.now() + tokens.expires_in * 1000;

    setCachedUserInfo(extractUserInfoFromTokens(tokens));
    const u = getCachedUserInfo();
    console.log('[SESSION] Token refresh: hasIdToken=' + !!tokens.id_token + ', wrdesk_plan=' + (u?.wrdesk_plan || '(none)') + ', roleCount=' + (u?.roles?.length ?? 0));

    const debugPayload = decodeJwtPayload(tokens.access_token);
    if (debugPayload) {
      console.log('[DEBUG] Access Token realm_access:', JSON.stringify(debugPayload.realm_access));
      console.log('[DEBUG] Access Token resource_access:', JSON.stringify(debugPayload.resource_access));
      console.log('[DEBUG] Access Token wrdesk_plan:', debugPayload.wrdesk_plan ?? debugPayload['wrdesk-plan'] ?? 'NOT FOUND');
      console.log('[DEBUG] Extracted roles:', JSON.stringify(extractRoles(debugPayload)));
      console.log('[DEBUG] Resolved tier:', mapRolesToTier(extractRoles(debugPayload)));
    }

    if (tokens.refresh_token) {
      await saveRefreshToken(tokens.refresh_token);
    }

    console.log('[SESSION][F] ensureSession: UNLOCKED (refresh succeeded, expiresAt=' + new Date(expiresAt!).toISOString() + ')');
    return { accessToken, userInfo: getCachedUserInfo() || undefined };
  };

  try {
    let tokens: RefreshTokenResponse;
    try {
      tokens = await refreshWithKeycloak(refreshToken);
    } catch (e) {
      if (e instanceof OidcRefreshError && e.recoverable) {
        console.warn('[SESSION] Token refresh failed (recoverable), retrying once:', e.message);
        await new Promise((r) => setTimeout(r, 800));
        tokens = await refreshWithKeycloak(refreshToken);
      } else {
        throw e;
      }
    }
    return await applyRefreshedTokens(tokens);
  } catch (err) {
    if (err instanceof OidcRefreshError && err.recoverable) {
      console.warn(
        '[SESSION][F] ensureSession: transient refresh failure — keeping refresh token and cached user profile:',
        err.message,
      );
      accessToken = null;
      expiresAt = null;
      return { accessToken: null, userInfo: getCachedUserInfo() || undefined };
    }
    await clearRefreshToken();
    accessToken = null;
    expiresAt = null;
    setCachedUserInfo(null);
    console.log('[SESSION][F] ensureSession: LOCKED (reason=refresh_failed)');
    return { accessToken: null };
  }
}

/**
 * Update session with tokens from login flow
 * Called after successful loginWithKeycloak()
 */
export function updateSessionFromTokens(tokens: {
  access_token: string;
  id_token?: string;
  expires_in: number;
}): SessionUserInfo | undefined {
  accessToken = tokens.access_token;
  expiresAt = Date.now() + tokens.expires_in * 1000;

  // Extract user info from BOTH tokens (plan from access_token first, then id_token)
  setCachedUserInfo(extractUserInfoFromTokens(tokens));

  // === DEBUG: Token-Rollen prüfen ===
  const debugPayload = decodeJwtPayload(tokens.access_token);
  if (debugPayload) {
    console.log('[DEBUG] Access Token realm_access:', JSON.stringify(debugPayload.realm_access));
    console.log('[DEBUG] Access Token resource_access:', JSON.stringify(debugPayload.resource_access));
    console.log('[DEBUG] Access Token wrdesk_plan:', debugPayload.wrdesk_plan ?? debugPayload['wrdesk-plan'] ?? 'NOT FOUND');
    console.log('[DEBUG] Extracted roles:', JSON.stringify(extractRoles(debugPayload)));
    console.log('[DEBUG] Resolved tier:', mapRolesToTier(extractRoles(debugPayload)));
  }
  // === END DEBUG ===

  // [CHECKPOINT E] Log session persisted (no tokens)
  const expiresAtISO = expiresAt ? new Date(expiresAt).toISOString() : 'null';
  const roleCount = getCachedUserInfo()?.roles?.length ?? 0;
  console.log('[SESSION][E] Session updated: expiresAt=' + expiresAtISO + ', roleCount=' + roleCount + ', hasUserInfo=' + !!getCachedUserInfo());

  return getCachedUserInfo() || undefined;
}

/**
 * Get current access token from memory
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Clear session from memory
 */
export function clearSession(): void {
  accessToken = null;
  expiresAt = null;
  setCachedUserInfo(null);
}
