import { randomBytes, createHash } from 'node:crypto';

/**
 * PKCE (Proof Key for Code Exchange) - RFC 7636
 *
 * Why PKCE protects the authorization code:
 * - Public clients (desktop/mobile apps) cannot securely store a client_secret
 * - Without PKCE, an attacker who intercepts the authorization code can exchange it for tokens
 * - PKCE binds the authorization request to the token request:
 *   1. Client generates a random code_verifier (kept secret)
 *   2. Client sends code_challenge = SHA256(code_verifier) with auth request
 *   3. Authorization server remembers the challenge
 *   4. Client sends code_verifier with token request
 *   5. Server verifies SHA256(code_verifier) matches the original challenge
 * - An attacker with only the auth code cannot complete the exchange without the verifier
 */

/**
 * Encode buffer as URL-safe base64 (no padding)
 */
export function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/**
 * Generate cryptographically secure random string (URL-safe base64)
 */
export function randomString(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/**
 * Compute SHA-256 hash and return as URL-safe base64
 */
export function sha256base64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}
