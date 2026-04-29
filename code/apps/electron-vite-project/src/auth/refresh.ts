import { oidc } from './oidcConfig';
import { fetchDiscovery, getCachedDiscovery, formatDiscoveryFailure } from './discovery';

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;  // OIDC refresh may return updated id_token
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Refresh or discovery failed in a way that should NOT wipe the OS-stored refresh token
 * (transient network, discovery outage, 5xx from IdP, etc.).
 */
export class OidcRefreshError extends Error {
  readonly recoverable: boolean;

  constructor(message: string, recoverable: boolean) {
    super(message);
    this.name = 'OidcRefreshError';
    this.recoverable = recoverable;
  }
}

function tokenEndpointInvalidGrant(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  try {
    const j = JSON.parse(body) as { error?: string };
    return j.error === 'invalid_grant';
  } catch {
    return body.toLowerCase().includes('invalid_grant');
  }
}

/**
 * Refresh tokens using Keycloak token endpoint
 *
 * Uses OIDC discovery to get the token endpoint.
 * Falls back to cached discovery if available.
 */
export async function refreshWithKeycloak(refreshToken: string): Promise<RefreshTokenResponse> {
  let tokenEndpoint: string;
  const cached = getCachedDiscovery();

  if (cached) {
    tokenEndpoint = cached.token_endpoint;
  } else {
    const discoveryResult = await fetchDiscovery();
    if (!discoveryResult.ok) {
      throw new OidcRefreshError(
        `OIDC discovery failed: ${formatDiscoveryFailure(discoveryResult)}`,
        true,
      );
    }
    tokenEndpoint = discoveryResult.discovery.token_endpoint;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: oidc.clientId,
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause =
      e instanceof Error && 'cause' in e && e.cause != null
        ? e.cause instanceof Error
          ? e.cause.message
          : String(e.cause)
        : undefined;
    throw new OidcRefreshError(
      `Token endpoint unreachable (POST ${tokenEndpoint}): ${msg}${cause ? ` | cause=${cause}` : ''}`,
      true,
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    const fatal = tokenEndpointInvalidGrant(response.status, errorText);
    throw new OidcRefreshError(
      `Token refresh failed: HTTP ${response.status} ${errorText.slice(0, 800)}`,
      !fatal,
    );
  }

  const tokens = await response.json();

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    expires_in: tokens.expires_in,
    token_type: tokens.token_type,
    scope: tokens.scope,
  };
}
