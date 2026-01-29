import { createRemoteJWKSet, jwtVerify } from 'jose';
import { oidc } from './oidcConfig';
import { getOidcDiscovery } from './discovery';

export interface IdTokenClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
}

// Cache the JWKS to avoid fetching on every verification
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

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
  // Get JWKS URI from discovery (or use cache)
  if (!jwksCache) {
    const discovery = await getOidcDiscovery();
    jwksCache = createRemoteJWKSet(new URL(discovery.jwks_uri));
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
