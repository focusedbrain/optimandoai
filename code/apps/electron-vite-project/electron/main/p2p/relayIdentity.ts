/**
 * Relay / coordination-service identity helpers.
 * The coordination service maps OIDC tokens to userId = JWT `sub` (see packages/coordination-service/src/auth.ts).
 * Registry rows and WS presence must use the same identifier as the Bearer token.
 */

import type { SessionUserInfo } from '../../../src/auth/session'
import type { PartyIdentity, SSOSession } from '../handshake/types'

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

/**
 * `/beap/register-handshake` user ids for internal (same-principal) rows **must** be the JWT `sub` for
 * both initiator and acceptor, or the relay stores `initiator_user_id !== acceptor_user_id`, the row is
 * not treated as same-principal, and `getRecipientForSender` device routing (Host ↔ Sandbox) breaks
 * (HTTP 202 with live recipient but wrong device map).
 */
export function coordinationRegistryUserIdsForSession(
  session: SSOSession,
  record: {
    handshake_type?: 'internal' | 'standard' | null
    initiator?: PartyIdentity | null
    acceptor?: PartyIdentity | null
  },
): { initiator_user_id: string; acceptor_user_id: string } {
  if (record.handshake_type === 'internal') {
    const sub = getRelayUserIdForRegistry(session)
    if (sub) return { initiator_user_id: sub, acceptor_user_id: sub }
  }
  const iu =
    (record.initiator?.sub || record.initiator?.wrdesk_user_id || '').trim() || (session.sub || '').trim()
  const au = (record.acceptor?.sub || record.acceptor?.wrdesk_user_id || '').trim() || (session.sub || '').trim()
  return { initiator_user_id: iu, acceptor_user_id: au }
}
