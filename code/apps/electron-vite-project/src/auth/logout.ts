import { clearRefreshToken } from './tokenStore';
import { clearSession } from './session';

/**
 * Logout locally only (no Keycloak endpoint call)
 *
 * - Clears refresh token from OS credential store
 * - Clears in-memory session state (access token, expiresAt)
 */
export async function logoutLocalOnly(): Promise<void> {
  await clearRefreshToken();
  clearSession();
}
