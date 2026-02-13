import { loadRefreshToken, clearRefreshToken, saveRefreshToken } from './tokenStore';
import { refreshWithKeycloak } from './refresh';

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
  roles?: string[];  // Keycloak roles (realm + client roles)
}

// Module-level variables (RAM only, not persisted)
let accessToken: string | null = null;
let expiresAt: number | null = null;
let cachedUserInfo: SessionUserInfo | null = null;

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
 * Extract user info from JWT claims
 */
function extractUserInfo(payload: Record<string, unknown>): SessionUserInfo {
  const name = payload.name as string | undefined;
  const preferredUsername = payload.preferred_username as string | undefined;
  const email = payload.email as string | undefined;
  const givenName = payload.given_name as string | undefined;
  const familyName = payload.family_name as string | undefined;
  const sub = payload.sub as string | undefined;
  const picture = payload.picture as string | undefined;

  // Determine display name (prefer full name, then username, then email)
  let displayName = name;
  if (!displayName && givenName && familyName) {
    displayName = `${givenName} ${familyName}`;
  }
  if (!displayName) {
    displayName = preferredUsername || email;
  }

  // Generate initials
  let initials: string | undefined;
  if (givenName && familyName) {
    initials = (givenName.charAt(0) + familyName.charAt(0)).toUpperCase();
  } else if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      initials = (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    } else {
      initials = displayName.charAt(0).toUpperCase();
    }
  } else if (email) {
    initials = email.charAt(0).toUpperCase();
  }

  // Extract Keycloak roles
  const roles = extractRoles(payload);

  return {
    displayName,
    email,
    initials,
    picture,
    sub,
    roles,
  };
}

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
export async function ensureSession(): Promise<{ accessToken: string | null; userInfo?: SessionUserInfo }> {
  // Return cached token if still valid (with 60s buffer)
  if (accessToken && expiresAt && expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    // [CHECKPOINT F] Log unlock decision: cached valid
    console.log('[SESSION][F] ensureSession: UNLOCKED (cached token valid, expiresAt=' + new Date(expiresAt).toISOString() + ')');
    return { accessToken, userInfo: cachedUserInfo || undefined };
  }

  const refreshToken = await loadRefreshToken();

  if (!refreshToken) {
    accessToken = null;
    expiresAt = null;
    cachedUserInfo = null;
    // [CHECKPOINT F] Log unlock decision: no refresh token
    console.log('[SESSION][F] ensureSession: LOCKED (reason=no_refresh_token)');
    return { accessToken: null };
  }

  try {
    const tokens = await refreshWithKeycloak(refreshToken);

    // Keep access token and expiry in memory
    accessToken = tokens.access_token;
    expiresAt = Date.now() + tokens.expires_in * 1000;

    // Extract user info from access token (or id_token if available)
    const tokenToDecode = tokens.id_token || tokens.access_token;
    const payload = decodeJwtPayload(tokenToDecode);
    cachedUserInfo = payload ? extractUserInfo(payload) : null;

    // Save new refresh token if provided (token rotation)
    if (tokens.refresh_token) {
      await saveRefreshToken(tokens.refresh_token);
    }

    // [CHECKPOINT F] Log unlock decision: refresh succeeded
    console.log('[SESSION][F] ensureSession: UNLOCKED (refresh succeeded, expiresAt=' + new Date(expiresAt!).toISOString() + ')');
    return { accessToken, userInfo: cachedUserInfo || undefined };
  } catch (err) {
    // Refresh failed - clear stored token
    await clearRefreshToken();
    accessToken = null;
    expiresAt = null;
    cachedUserInfo = null;
    // [CHECKPOINT F] Log unlock decision: refresh failed
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

  // Extract user info from id_token (preferred) or access_token
  const tokenToDecode = tokens.id_token || tokens.access_token;
  const payload = decodeJwtPayload(tokenToDecode);
  cachedUserInfo = payload ? extractUserInfo(payload) : null;

  // [CHECKPOINT E] Log session persisted (no tokens)
  const expiresAtISO = expiresAt ? new Date(expiresAt).toISOString() : 'null';
  const roleCount = cachedUserInfo?.roles?.length ?? 0;
  console.log('[SESSION][E] Session updated: expiresAt=' + expiresAtISO + ', roleCount=' + roleCount + ', hasUserInfo=' + !!cachedUserInfo);

  return cachedUserInfo || undefined;
}

/**
 * Get cached user info (if session is active)
 */
export function getCachedUserInfo(): SessionUserInfo | null {
  return cachedUserInfo;
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
}
