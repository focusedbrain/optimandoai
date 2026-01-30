import open from 'open';
import { oidc } from './oidcConfig';
import { randomString, sha256base64url } from './pkce';
import { startLoopbackServer } from './loopback';
import { verifyIdToken } from './jwtVerify';
import { fetchDiscovery } from './discovery';

export interface OidcTokens {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

// Timeout for waiting on user login (120 seconds)
const LOGIN_TIMEOUT_MS = 120_000;

// Known OIDC error codes
const OIDC_USER_ERRORS: Record<string, string> = {
  access_denied: 'User denied access or cancelled login',
  login_required: 'Login is required',
  consent_required: 'User consent is required',
  interaction_required: 'User interaction is required',
  invalid_request: 'Invalid authorization request',
};

/**
 * Perform Keycloak OIDC login via system browser with PKCE
 * 
 * Uses OIDC discovery to get authorization and token endpoints.
 * Implements Authorization Code Flow with PKCE (S256).
 */
export async function loginWithKeycloak(): Promise<OidcTokens> {
  // Fetch OIDC discovery (cached after first call)
  const discoveryResult = await fetchDiscovery();
  if (!discoveryResult.ok) {
    throw new Error(`OIDC discovery failed: ${discoveryResult.message}`);
  }
  const { authorization_endpoint, token_endpoint } = discoveryResult.discovery;

  // Generate PKCE verifier and challenge (S256)
  const codeVerifier = randomString(32);
  const codeChallenge = sha256base64url(codeVerifier);

  // Generate random state and nonce
  const state = randomString(16);
  const nonce = randomString(16);

  // Start loopback server
  const loopback = await startLoopbackServer();

  // Timeout promise
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000} seconds`));
    }, LOGIN_TIMEOUT_MS);
  });

  try {
    // Build authorization URL using discovered endpoint
    const authUrl = new URL(authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', oidc.clientId);
    authUrl.searchParams.set('redirect_uri', loopback.redirectUri);
    authUrl.searchParams.set('scope', oidc.scopes);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);

    // Open system browser
    await open(authUrl.toString());

    // Wait for callback or timeout
    const result = await Promise.race([loopback.waitForCode, timeoutPromise]);

    // Clear timeout on success
    if (timeoutId) clearTimeout(timeoutId);

    // Handle OIDC errors explicitly
    if (result.error) {
      const friendlyMessage = OIDC_USER_ERRORS[result.error] ?? result.error;
      throw new Error(`Authorization failed: ${friendlyMessage}`);
    }

    // Validate state
    if (result.state !== state) {
      throw new Error('State mismatch: possible CSRF attack');
    }

    // Validate code presence
    if (!result.code) {
      throw new Error('No authorization code received');
    }

    // Exchange code for tokens using discovered endpoint
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: oidc.clientId,
      code: result.code,
      redirect_uri: loopback.redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokens = await response.json();

    // Verify id_token signature and nonce before returning
    await verifyIdToken(tokens.id_token, nonce);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      scope: tokens.scope,
    };
  } finally {
    // Clear timeout if still pending
    if (timeoutId) clearTimeout(timeoutId);
    // Close loopback server in all cases
    loopback.close();
  }
}
