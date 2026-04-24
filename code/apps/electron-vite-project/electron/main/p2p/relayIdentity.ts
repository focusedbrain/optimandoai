/**
 * Relay / coordination-service identity helpers.
 * The coordination service maps OIDC tokens to userId = JWT `sub` (see packages/coordination-service/src/auth.ts).
 * Registry rows and WS presence must use the same identifier as the Bearer token.
 */

import type { SessionUserInfo } from '../../../src/auth/session'
import type { SSOSession } from '../handshake/types'

export type RelaySessionLike = SessionUserInfo | SSOSession | null | undefined

/**
 * Canonical user id for relay registry, WebSocket presence, and routing.
 * Always JWT `sub` — never email, never wrdesk_user_id alone (unless product makes them identical).
 */
export function getRelayUserIdForRegistry(session: RelaySessionLike): string | null {
  const sub = session && typeof session.sub === 'string' ? session.sub.trim() : ''
  return sub.length > 0 ? sub : null
}

export function relayIdentitySnapshot(session: RelaySessionLike): {
  relay_user_id: string | null
  sub: string | null
  wrdesk_user_id: string | null
  email: string | null
} {
  const s = session as Record<string, unknown> | null | undefined
  return {
    relay_user_id: getRelayUserIdForRegistry(session),
    sub: typeof s?.sub === 'string' ? s.sub.trim() : null,
    wrdesk_user_id: typeof s?.wrdesk_user_id === 'string' ? (s.wrdesk_user_id as string).trim() : null,
    email: typeof s?.email === 'string' ? (s.email as string).trim() : null,
  }
}

/** Decode JWT `sub` from an access token for logging only (no verification). */
export function decodeJwtSubForLogs(token: string): string {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return '(invalid_jwt)'
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof p.sub === 'string' ? p.sub : '(no_sub)'
  } catch {
    return '(decode_error)'
  }
}
