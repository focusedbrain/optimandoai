import { oidc } from './oidcConfig';

const tokenEndpoint = `${oidc.issuer}/protocol/openid-connect/token`;

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Refresh tokens using Keycloak token endpoint
 */
export async function refreshWithKeycloak(refreshToken: string): Promise<RefreshTokenResponse> {
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
