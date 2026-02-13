import { oidc } from './oidcConfig';
import { fetchDiscovery, getCachedDiscovery } from './discovery';

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;  // OIDC refresh may return updated id_token
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Refresh tokens using Keycloak token endpoint
 * 
 * Uses OIDC discovery to get the token endpoint.
 * Falls back to cached discovery if available.
 */
export async function refreshWithKeycloak(refreshToken: string): Promise<RefreshTokenResponse> {
  // Try to get token endpoint from cache first (fast path)
  let tokenEndpoint: string;
  const cached = getCachedDiscovery();
  
  if (cached) {
    tokenEndpoint = cached.token_endpoint;
  } else {
    // Fetch discovery if not cached
    const discoveryResult = await fetchDiscovery();
    if (!discoveryResult.ok) {
      throw new Error(`OIDC discovery failed: ${discoveryResult.message}`);
    }
    tokenEndpoint = discoveryResult.discovery.token_endpoint;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: oidc.clientId,
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const tokens = await response.json();

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    token_type: tokens.token_type,
    scope: tokens.scope,
  };
}
