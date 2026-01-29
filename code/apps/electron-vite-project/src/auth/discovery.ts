import { oidc } from './oidcConfig';

const discoveryUrl = `${oidc.issuer}/.well-known/openid-configuration`;

export interface OidcDiscovery {
  jwks_uri: string;
  issuer: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

/**
 * Fetch OIDC discovery document from Keycloak
 */
export async function getOidcDiscovery(): Promise<OidcDiscovery> {
  const response = await fetch(discoveryUrl);

  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status}`);
  }

  const config = await response.json();

  return {
    jwks_uri: config.jwks_uri,
    issuer: config.issuer,
    end_session_endpoint: config.end_session_endpoint,
    revocation_endpoint: config.revocation_endpoint,
  };
}
