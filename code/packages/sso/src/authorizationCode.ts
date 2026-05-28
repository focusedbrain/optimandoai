import type { OidcConfig, OidcTokens } from './types.js'
import { fetchDiscovery, getCachedDiscovery } from './discovery.js'
import { randomString, sha256base64url } from './pkce.js'
import { verifyIdToken } from './jwtVerify.js'

export interface AuthorizationRequest {
  readonly authorizationUrl: string
  readonly codeVerifier: string
  readonly state: string
  readonly nonce: string
}

export async function prepareAuthorizationRequest(
  config: OidcConfig,
  redirectUri: string,
): Promise<AuthorizationRequest> {
  const discoveryResult = await fetchDiscovery(config)
  if (!discoveryResult.ok) {
    throw new Error(`OIDC discovery failed: ${discoveryResult.message}`)
  }
  const { authorization_endpoint } = discoveryResult.discovery

  const codeVerifier = randomString(32)
  const codeChallenge = sha256base64url(codeVerifier)
  const state = randomString(16)
  const nonce = randomString(16)

  const authUrl = new URL(authorization_endpoint)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', config.scopes)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)

  return {
    authorizationUrl: authUrl.toString(),
    codeVerifier,
    state,
    nonce,
  }
}

export async function exchangeAuthorizationCode(
  config: OidcConfig,
  redirectUri: string,
  code: string,
  codeVerifier: string,
  expectedNonce: string,
): Promise<OidcTokens> {
  const cached = getCachedDiscovery(config)
  let tokenEndpoint: string
  if (cached) {
    tokenEndpoint = cached.token_endpoint
  } else {
    const discoveryResult = await fetchDiscovery(config)
    if (!discoveryResult.ok) {
      throw new Error(`OIDC discovery failed: ${discoveryResult.message}`)
    }
    tokenEndpoint = discoveryResult.discovery.token_endpoint
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
  }

  const tokens = (await response.json()) as Record<string, unknown>
  const idToken = String(tokens.id_token)
  await verifyIdToken(config, idToken, expectedNonce)

  return {
    access_token: String(tokens.access_token),
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
    id_token: idToken,
    expires_in: Number(tokens.expires_in),
    token_type: String(tokens.token_type),
    scope: typeof tokens.scope === 'string' ? tokens.scope : undefined,
  }
}
