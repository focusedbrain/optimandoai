import { loadRefreshToken, clearRefreshToken, saveRefreshToken } from './tokenStore';
import { refreshWithKeycloak } from './refresh';

// Module-level variables (RAM only, not persisted)
let accessToken: string | null = null;
let expiresAt: number | null = null;

// Buffer before expiry to trigger refresh (60 seconds)
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Ensure a valid session exists
 *
 * - If accessToken exists and not expiring soon, return it
 * - Otherwise, tries to load refresh token from credential store
 * - If present, attempts to refresh tokens
 * - On success: keeps access token and expiresAt in memory, returns it
 * - On failure: clears refresh token, returns null
 *
 * Does NOT trigger browser login
 * Does NOT store access token persistently
 */
export async function ensureSession(): Promise<{ accessToken: string | null }> {
  // Return cached token if still valid (with 60s buffer)
  if (accessToken && expiresAt && expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return { accessToken };
  }

  const refreshToken = await loadRefreshToken();

  if (!refreshToken) {
    accessToken = null;
    expiresAt = null;
    return { accessToken: null };
  }

  try {
    const tokens = await refreshWithKeycloak(refreshToken);

    // Keep access token and expiry in memory
    accessToken = tokens.access_token;
    expiresAt = Date.now() + tokens.expires_in * 1000;

    // Save new refresh token if provided (token rotation)
    if (tokens.refresh_token) {
      await saveRefreshToken(tokens.refresh_token);
    }

    return { accessToken };
  } catch {
    // Refresh failed - clear stored token
    await clearRefreshToken();
    accessToken = null;
    expiresAt = null;
    return { accessToken: null };
  }
}

/**
 * Get current access token from memory
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Clear session from memory
 */
export function clearSession(): void {
  accessToken = null;
  expiresAt = null;
}
