import keytar from 'keytar';

/**
 * Why refresh tokens are stored only in OS secure storage:
 * - Refresh tokens are long-lived credentials that can obtain new access tokens
 * - Storing in plaintext (file, localStorage, env) exposes them to malware/theft
 * - keytar uses OS-level secure storage:
 *   - Windows: Credential Manager (encrypted with user's login)
 *   - macOS: Keychain (encrypted, requires user authentication)
 *   - Linux: libsecret/GNOME Keyring (encrypted)
 * - Access tokens are short-lived and kept only in memory (RAM)
 * - If refresh token is compromised, user can revoke it via Keycloak
 */

const SERVICE_NAME = 'wrdesk-orchestrator';
const ACCOUNT_REFRESH_TOKEN = 'refresh_token';

/**
 * Save refresh token to system credential store
 */
export async function saveRefreshToken(refreshToken: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN, refreshToken);
}

/**
 * Load refresh token from system credential store
 * Returns null if no token is stored
 */
export async function loadRefreshToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN);
}

/**
 * Clear refresh token from system credential store
 */
export async function clearRefreshToken(): Promise<void> {
  await keytar.deletePassword(SERVICE_NAME, ACCOUNT_REFRESH_TOKEN);
}
