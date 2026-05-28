import type { OidcConfig } from './types.js'
import { fetchDiscovery, getCachedDiscovery } from './discovery.js'

export interface RefreshTokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

export async function refreshWithKeycloak(
  config: OidcConfig,
  refreshToken: string,
): Promise<RefreshTokenResponse> {
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
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  })

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
  }

  const tokens = (await response.json()) as Record<string, unknown>
  return {
    access_token: String(tokens.access_token),
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
    id_token: typeof tokens.id_token === 'string' ? tokens.id_token : undefined,
    expires_in: Number(tokens.expires_in),
    token_type: String(tokens.token_type),
    scope: typeof tokens.scope === 'string' ? tokens.scope : undefined,
  }
}
