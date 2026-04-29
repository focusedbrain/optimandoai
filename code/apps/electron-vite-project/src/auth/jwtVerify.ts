import { createRemoteJWKSet, jwtVerify } from 'jose';
import { oidc } from './oidcConfig';
import { fetchDiscovery, getCachedDiscovery } from './discovery';

export interface IdTokenClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
}

// Cache the JWKS to avoid fetching on every verification
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksUri: string | null = null;

/**
 * Clear JWKS cache (useful when discovery changes or for testing)
 */
export function clearJwksCache(): void {
  jwksCache = null;
  cachedJwksUri = null;
}

/**
 * Verify ID token signature and claims
 *
 * - Fetches JWKS from discovery endpoint (cached)
 * - Validates signature using jose
 * - Validates iss, aud, exp, nonce
 * - Returns subset of claims
 */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string
): Promise<IdTokenClaims> {
  // Get JWKS URI from discovery (prefer cache for performance)
  let jwksUri: string;
  const cached = getCachedDiscovery();
  
  if (cached) {
    jwksUri = cached.jwks_uri;
  } else {
    const discoveryResult = await fetchDiscovery();
    if (!discoveryResult.ok) {
      throw new Error(`OIDC discovery failed: ${discoveryResult.message}`);
    }
    jwksUri = discoveryResult.discovery.jwks_uri;
  }

  // Recreate JWKS if URI changed or not cached
  if (!jwksCache || cachedJwksUri !== jwksUri) {
    jwksCache = createRemoteJWKSet(new URL(jwksUri));
    cachedJwksUri = jwksUri;
  }

  // Verify JWT signature and standard claims
  const { payload } = await jwtVerify(idToken, jwksCache, {
    issuer: oidc.issuer,
    audience: oidc.clientId,
    clockTolerance: 60, // 60 seconds clock skew tolerance
  });

  // Validate nonce
  if (payload.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch: possible replay attack');
  }

  return {
    sub: payload.sub as string,
    preferred_username: payload.preferred_username as string | undefined,
    email: payload.email as string | undefined,
  };
}
