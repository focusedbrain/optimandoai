/**
 * Authentication for relay server.
 * - Incoming ingest: Bearer token must match expected_token for handshake_id
 * - Host pull/ack/register: Bearer token must match relay_auth_secret
 */

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}

export function verifyHostAuth(token: string | null, relayAuthSecret: string): boolean {
  if (!relayAuthSecret || !token) return false
  return token === relayAuthSecret
}

export function verifyIngestAuth(
  token: string | null,
  expectedToken: string | null,
): boolean {
  if (!expectedToken || !token) return false
  return token === expectedToken
}
