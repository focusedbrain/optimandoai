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

// Optional URL opener override (e.g. Electron's shell.openExternal)
// When set, this is used INSTEAD of the 'open' npm package for browser opening.
let _urlOpener: ((url: string) => Promise<void>) | null = null;

/**
 * Set an alternative URL opener (call once at startup from main process).
 * Pass Electron's shell.openExternal for more reliable browser opening.
 */
export function setUrlOpener(opener: (url: string) => Promise<void>): void {
  _urlOpener = opener;
}

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
 * Find and launch a browser on Windows by probing known paths.
 * Falls back through: Chrome → Edge → cmd /c start → shell.openExternal → open package
 */
async function openUrlOnWindows(url: string): Promise<void> {
  const { execFile, exec } = await import('node:child_process');
  const fs = await import('node:fs');

  // Known browser paths to try in order (Chrome first since user has it)
  const browserCandidates = [
    process.env.ProgramFiles + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.ProgramFiles + '\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['ProgramFiles(x86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  // Try to find an installed browser
  for (const browserPath of browserCandidates) {
    if (!browserPath) continue;
    try {
      if (fs.default.existsSync(browserPath)) {
        console.log('[AUTH] Opening browser directly: ' + browserPath);
        await new Promise<void>((resolve, reject) => {
          const child = execFile(browserPath, [url], (err) => {
            // execFile callback fires when the process starts (not when the tab closes)
            if (err) reject(err);
          });
          // Don't wait for the browser to close - resolve immediately after spawn
          child.unref();
          // Give a moment for the process to start
          setTimeout(resolve, 500);
        });
        return;
      }
    } catch (e: any) {
      console.warn('[AUTH] Browser probe failed for ' + browserPath + ':', e.message);
    }
  }

  // Fallback 1: cmd /c start (may show "App auswählen" on broken Windows configs)
  console.log('[AUTH] No browser found at known paths, trying cmd /c start');
  try {
    await new Promise<void>((resolve, reject) => {
      exec(`cmd /c start "" "${url}"`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return;
  } catch (e: any) {
    console.warn('[AUTH] cmd /c start failed:', e.message);
  }

  // Fallback 2: shell.openExternal (injected from main.ts)
  if (_urlOpener) {
    console.log('[AUTH] Trying shell.openExternal as final fallback');
    await _urlOpener(url);
    return;
  }

  // Fallback 3: open npm package
  console.log('[AUTH] Trying open() package as last resort');
  await open(url);
}

/**
 * Prepare Keycloak OIDC login URL and start loopback server.
 * Returns the auth URL for the caller to open (e.g. extension opens it in a Chrome tab).
 * The caller must then call waitForLoginCallback() to complete the flow.
 */
export async function prepareLoginUrl(): Promise<{
  authUrl: string;
  waitForCallback: () => Promise<OidcTokens>;
  cancel: () => void;
}> {
  const discoveryResult = await fetchDiscovery();
  if (!discoveryResult.ok) {
    throw new Error(`OIDC discovery failed: ${discoveryResult.message}`);
  }
  const { authorization_endpoint, token_endpoint } = discoveryResult.discovery;

  const codeVerifier = randomString(32);
  const codeChallenge = sha256base64url(codeVerifier);
  const state = randomString(16);
  const nonce = randomString(16);
  const loopback = await startLoopbackServer();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000} seconds`));
    }, LOGIN_TIMEOUT_MS);
  });

  const authUrl = new URL(authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', oidc.clientId);
  authUrl.searchParams.set('redirect_uri', loopback.redirectUri);
  authUrl.searchParams.set('scope', oidc.scopes);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);

  console.log('[AUTH][PREPARE] Login URL prepared: redirectOrigin=' + authUrl.origin + ', loopbackPort=' + new URL(loopback.redirectUri).port);

  const waitForCallback = async (): Promise<OidcTokens> => {
    try {
      const result = await Promise.race([loopback.waitForCode, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      const stateMatched = result.state === state;
      console.log('[AUTH][D] Callback received: stateMatched=' + stateMatched + ', hasCode=' + !!result.code + ', hasError=' + !!result.error);

      if (result.error) {
        const friendlyMessage = OIDC_USER_ERRORS[result.error] ?? result.error;
        const description = result.error_description ? ` - ${result.error_description}` : '';
        throw new Error(`Authorization failed: ${friendlyMessage}${description}`);
      }
      if (result.state !== state) throw new Error('State mismatch: possible CSRF attack');
      if (!result.code) throw new Error('No authorization code received');

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
        const userMessage = parseTokenError(response.status, errorText);
        throw new Error(userMessage);
      }

      const tokens = await response.json();
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
      if (timeoutId) clearTimeout(timeoutId);
      loopback.close();
    }
  };

  const cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
    loopback.close();
  };

  return { authUrl: authUrl.toString(), waitForCallback, cancel };
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

    // Open system browser using platform-specific strategy
    // On Windows, directly launch Chrome or Edge to avoid "App auswählen" (Choose app) dialogs
    // that occur when Windows default browser association is broken
    const urlStr = authUrl.toString();
    if (process.platform === 'win32') {
      await openUrlOnWindows(urlStr);
    } else if (_urlOpener) {
      console.log('[AUTH] Opening browser via shell.openExternal');
      await _urlOpener(urlStr);
    } else {
      console.log('[AUTH] Opening browser via open() package');
      await open(urlStr);
    }

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
