import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { OidcConfig } from './types.js'
import { fetchDiscovery, getCachedDiscovery } from './discovery.js'

export interface IdTokenClaims {
  sub: string
  preferred_username?: string
  email?: string
}

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function clearJwksCache(): void {
  jwksByUri.clear()
}

export async function verifyIdToken(
  config: OidcConfig,
  idToken: string,
  expectedNonce: string,
): Promise<IdTokenClaims> {
  const cached = getCachedDiscovery(config)
  let jwksUri: string
  if (cached) {
    jwksUri = cached.jwks_uri
  } else {
    const discoveryResult = await fetchDiscovery(config)
    if (!discoveryResult.ok) {
      throw new Error(`OIDC discovery failed: ${discoveryResult.message}`)
    }
    jwksUri = discoveryResult.discovery.jwks_uri
  }

  let jwks = jwksByUri.get(jwksUri)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri))
    jwksByUri.set(jwksUri, jwks)
  }

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: config.issuer.replace(/\/$/, ''),
    audience: config.clientId,
    clockTolerance: 60,
  })

  if (payload.nonce !== expectedNonce) {
    throw new Error('ID token nonce mismatch')
  }

  return {
    sub: String(payload.sub),
    preferred_username:
      typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  }
}
