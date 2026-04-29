import { oidc } from './oidcConfig';

// ============================================================================
// OIDC Discovery - Keycloak Well-Known Endpoint
// ============================================================================
// Fetches and caches OIDC configuration from:
// https://auth.wrdesk.com/realms/wrdesk/.well-known/openid-configuration
//
// Caches in memory to avoid repeated network calls.
// Returns clear error objects for UI display on failure.
// ============================================================================

/** Full OIDC discovery document URL (issuer is {@link oidc.issuer}). */
export const OIDC_DISCOVERY_DOCUMENT_URL = `${oidc.issuer}/.well-known/openid-configuration`;

// Cache TTL: 1 hour (discovery endpoints rarely change)
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * OIDC Discovery document fields used by the application
 */
export interface OidcDiscovery {
  /** URL for authorization requests */
  authorization_endpoint: string;
  /** URL for token exchange and refresh */
  token_endpoint: string;
  /** URL for logout (optional, used later) */
  end_session_endpoint?: string;
  /** URL for JWKS (public keys for JWT verification) */
  jwks_uri: string;
  /** Issuer identifier (must match tokens) */
  issuer: string;
  /** URL for token revocation (optional) */
  revocation_endpoint?: string;
  /** URL for userinfo endpoint (optional) */
  userinfo_endpoint?: string;
}

/**
 * Error object returned when discovery fails
 * Provides clear information for UI display
 */
export interface DiscoveryError {
  ok: false;
  code: 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'MISSING_FIELDS' | 'ISSUER_MISMATCH';
  message: string;
  details?: string;
}

/**
 * Success result from discovery
 */
export interface DiscoverySuccess {
  ok: true;
  discovery: OidcDiscovery;
}

export type DiscoveryResult = DiscoverySuccess | DiscoveryError;

/** Single-line diagnostic for logs and Error messages (avoids generic "Failed to fetch" only). */
export function formatDiscoveryFailure(r: DiscoveryError): string {
  const tail = r.details ? ` — ${r.details}` : ''
  return `[${r.code}] ${r.message}${tail} (GET ${OIDC_DISCOVERY_DOCUMENT_URL})`
}

function logDiscoveryFailure(r: DiscoveryError): void {
  console.error('[OIDC_DISCOVERY]', {
    issuer: oidc.issuer,
    url: OIDC_DISCOVERY_DOCUMENT_URL,
    code: r.code,
    message: r.message,
    details: r.details ?? null,
  })
}

// In-memory cache
let cachedDiscovery: OidcDiscovery | null = null;
let cacheTimestamp: number = 0;

/**
 * Check if cache is still valid
 */
function isCacheValid(): boolean {
  return cachedDiscovery !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

/**
 * Clear the discovery cache (useful for testing or forced refresh)
 */
export function clearDiscoveryCache(): void {
  cachedDiscovery = null;
  cacheTimestamp = 0;
}

/**
 * Fetch OIDC discovery document from Keycloak with caching
 * 
 * Returns a result object instead of throwing:
 * - On success: { ok: true, discovery: OidcDiscovery }
 * - On failure: { ok: false, code: string, message: string, details?: string }
 * 
 * @param forceRefresh - If true, bypasses cache and fetches fresh data
 */
export async function fetchDiscovery(forceRefresh = false): Promise<DiscoveryResult> {
  // Return cached discovery if valid and not forcing refresh
  if (!forceRefresh && isCacheValid() && cachedDiscovery) {
    return { ok: true, discovery: cachedDiscovery };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(OIDC_DISCOVERY_DOCUMENT_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err: DiscoveryError = {
        ok: false,
        code: 'NETWORK_ERROR',
        message: 'OIDC discovery HTTP error',
        details: `status=${response.status} statusText=${response.statusText || '(empty)'}`,
      }
      logDiscoveryFailure(err)
      return err
    }

    let config: Record<string, unknown>;
    try {
      config = await response.json();
    } catch {
      const err: DiscoveryError = {
        ok: false,
        code: 'INVALID_RESPONSE',
        message: 'Invalid OIDC discovery response',
        details: 'Response body is not valid JSON',
      }
      logDiscoveryFailure(err)
      return err
    }

    // Validate required fields
    const requiredFields = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer'];
    const missingFields = requiredFields.filter((field) => !config[field]);

    if (missingFields.length > 0) {
      const err: DiscoveryError = {
        ok: false,
        code: 'MISSING_FIELDS',
        message: 'OIDC discovery response missing required fields',
        details: `Missing: ${missingFields.join(', ')}`,
      }
      logDiscoveryFailure(err)
      return err
    }

    // Validate issuer matches expected value
    if (config.issuer !== oidc.issuer) {
      const err: DiscoveryError = {
        ok: false,
        code: 'ISSUER_MISMATCH',
        message: 'OIDC issuer does not match expected value',
        details: `Expected: ${oidc.issuer}, Got: ${config.issuer}`,
      }
      logDiscoveryFailure(err)
      return err
    }

    // Build discovery object
    const discovery: OidcDiscovery = {
      authorization_endpoint: config.authorization_endpoint as string,
      token_endpoint: config.token_endpoint as string,
      jwks_uri: config.jwks_uri as string,
      issuer: config.issuer as string,
      end_session_endpoint: config.end_session_endpoint as string | undefined,
      revocation_endpoint: config.revocation_endpoint as string | undefined,
      userinfo_endpoint: config.userinfo_endpoint as string | undefined,
    };

    // Cache the result
    cachedDiscovery = discovery;
    cacheTimestamp = Date.now();

    return { ok: true, discovery };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const cause =
      error instanceof Error && 'cause' in error && error.cause != null
        ? error.cause instanceof Error
          ? error.cause.message
          : String(error.cause)
        : undefined
    const stackHint =
      error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : undefined

    // Handle abort (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      const err: DiscoveryError = {
        ok: false,
        code: 'NETWORK_ERROR',
        message: 'OIDC discovery request timed out',
        details: 'Request aborted after 10s (check firewall / proxy / captive portal)',
      }
      logDiscoveryFailure(err)
      return err
    }

    const err: DiscoveryError = {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'OIDC discovery network or transport failure',
      details: [
        `error.name=${error instanceof Error ? error.name : 'unknown'}`,
        `message=${errorMessage}`,
        cause ? `cause=${cause}` : null,
        stackHint ? `at=${stackHint}` : null,
        'hint=If message is "Failed to fetch", check DNS, TLS inspection, offline state, and that auth is reachable independently of local Ollama/BEAP.',
      ]
        .filter(Boolean)
        .join(' | '),
    }
    logDiscoveryFailure(err)
    return err
  }
}

/**
 * Get OIDC discovery (throws on failure)
 * 
 * Legacy function for backward compatibility.
 * Prefer fetchDiscovery() for new code.
 * 
 * @throws Error if discovery fails
 */
export async function getOidcDiscovery(): Promise<OidcDiscovery> {
  const result = await fetchDiscovery();
  
  if (!result.ok) {
    throw new Error(formatDiscoveryFailure(result));
  }
  
  return result.discovery;
}

/**
 * Get cached discovery synchronously (if available)
 * Returns null if cache is empty or expired
 */
export function getCachedDiscovery(): OidcDiscovery | null {
  return isCacheValid() ? cachedDiscovery : null;
}
