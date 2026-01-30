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

// Known OIDC error codes (authorization endpoint)
const OIDC_USER_ERRORS: Record<string, string> = {
  access_denied: 'User denied access or cancelled login',
  login_required: 'Login is required',
  consent_required: 'User consent is required',
  interaction_required: 'User interaction is required',
  invalid_request: 'Invalid authorization request',
};

// Known token exchange errors with user-friendly hints (no secrets exposed)
const TOKEN_EXCHANGE_ERRORS: Record<string, string> = {
  invalid_grant: 'Authorization code expired or already used. Please try logging in again.',
  redirect_uri_mismatch: 'Redirect URI mismatch. Keycloak client needs: http://127.0.0.1:62151/* through http://127.0.0.1:62155/*',
  invalid_client: 'Client authentication failed. Check Keycloak client configuration.',
  unauthorized_client: 'Client not authorized for this grant type. Enable "Standard flow" in Keycloak.',
  invalid_request: 'Missing required parameter in token request.',
  unsupported_grant_type: 'Grant type not supported. Enable "Authorization Code" flow in Keycloak.',
};

/**
 * Parse Keycloak token error response and return user-friendly message
 * Does NOT expose tokens, secrets, or full error details
 */
function parseTokenError(statusCode: number, responseText: string): string {
  // Try to parse as JSON (Keycloak error format)
  try {
    const errorObj = JSON.parse(responseText);
    const errorCode = errorObj.error as string | undefined;
    const errorDesc = errorObj.error_description as string | undefined;
    
    // Check for known error codes
    if (errorCode && TOKEN_EXCHANGE_ERRORS[errorCode]) {
      console.log('[AUTH] Token exchange error: code=' + errorCode);
      return TOKEN_EXCHANGE_ERRORS[errorCode];
    }
    
    // Check for redirect_uri_mismatch in description (some Keycloak versions)
    if (errorDesc?.toLowerCase().includes('redirect')) {
      console.log('[AUTH] Token exchange error: redirect_uri issue detected');
      return TOKEN_EXCHANGE_ERRORS['redirect_uri_mismatch'];
    }
    
    // Generic error with code only (no description to avoid leaking info)
    if (errorCode) {
      console.log('[AUTH] Token exchange error: code=' + errorCode);
      return `Token exchange failed: ${errorCode}. Check Keycloak client configuration.`;
    }
  } catch {
    // Not JSON - check for common substrings in plain text
    const lowerText = responseText.toLowerCase();
    if (lowerText.includes('redirect')) {
      console.log('[AUTH] Token exchange error: redirect_uri issue detected in response');
      return TOKEN_EXCHANGE_ERRORS['redirect_uri_mismatch'];
    }
    if (lowerText.includes('invalid_grant') || lowerText.includes('expired')) {
      console.log('[AUTH] Token exchange error: invalid_grant detected in response');
      return TOKEN_EXCHANGE_ERRORS['invalid_grant'];
    }
  }
  
  // Fallback - generic message with status code only
  console.log('[AUTH] Token exchange error: status=' + statusCode);
  return `Token exchange failed (HTTP ${statusCode}). Check Keycloak client configuration.`;
}

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

    // [CHECKPOINT C] Log redirect origin only (no secrets)
    console.log('[AUTH][C] Login start: redirectOrigin=' + authUrl.origin + ', loopbackPort=' + new URL(loopback.redirectUri).port);

    // Open system browser
    await open(authUrl.toString());

    // Wait for callback or timeout
    const result = await Promise.race([loopback.waitForCode, timeoutPromise]);

    // Clear timeout on success
    if (timeoutId) clearTimeout(timeoutId);

    // [CHECKPOINT D] Log callback received (no secrets)
    const stateMatched = result.state === state;
    console.log('[AUTH][D] Callback received: port=' + new URL(loopback.redirectUri).port + ', stateMatched=' + stateMatched + ', hasCode=' + !!result.code + ', hasError=' + !!result.error);

    // Handle OIDC errors explicitly
    if (result.error) {
      const friendlyMessage = OIDC_USER_ERRORS[result.error] ?? result.error;
      const description = result.error_description ? ` - ${result.error_description}` : '';
      throw new Error(`Authorization failed: ${friendlyMessage}${description}`);
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
      // Parse error and provide user-friendly message (no secrets)
      const userMessage = parseTokenError(response.status, errorText);
      throw new Error(userMessage);
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
