/**
 * Account isolation for handshake list / recipient pickers: hide rows that do not
 * belong to the current SSO session, without mutating the DB.
 */
import { isSameAccountHandshakeEmails } from '../../../../../packages/shared/src/handshake/receiverEmailValidation'
import type { HandshakeRecord, PartyIdentity, SSOSession } from './types'

export type HandshakeRowVisibility = { ok: true } | { ok: false; reason: string }

/**
 * True when the authenticated session is the same human/device account as the party
 * (email, wrdesk id, or iss+sub).
 */
export function sessionMatchesParty(session: SSOSession, party: PartyIdentity | null | undefined): boolean {
  if (!party) return false
  const sw = (session.wrdesk_user_id || '').trim()
  const pw = (party.wrdesk_user_id || '').trim()
  if (sw.length > 0 && pw.length > 0 && sw === pw) return true
  const iss = (session.iss || '').trim()
  const piss = (party.iss || '').trim()
  const sub = (session.sub || '').trim()
  const psub = (party.sub || '').trim()
  if (iss.length > 0 && piss.length > 0 && sub.length > 0 && psub.length > 0 && iss === piss && sub === psub) {
    return true
  }
  return isSameAccountHandshakeEmails(session.email, party.email)
}

/** For internal: initiator and acceptor must be the same principal. */
export function samePrincipalForInternal(
  initiator: PartyIdentity,
  acceptor: PartyIdentity,
): boolean {
  if (!isSameAccountHandshakeEmails(initiator.email, acceptor.email)) return false
  const iw = (initiator.wrdesk_user_id || '').trim()
  const aw = (acceptor.wrdesk_user_id || '').trim()
  if (iw.length > 0 && aw.length > 0 && iw !== aw) return false
  const iiss = (initiator.iss || '').trim()
  const aiss = (acceptor.iss || '').trim()
  const isub = (initiator.sub || '').trim()
  const asub = (acceptor.sub || '').trim()
  if (iiss && aiss && isub && asub) {
    if (iiss !== aiss || isub !== asub) return false
  }
  return true
}

/**
 * Returns whether a persisted handshake row may be returned to the current session
 * (list / BEAP recipient picker). Does not read the DB; hide-only semantics.
 */
export function handshakeRowVisibilityForSession(
  r: HandshakeRecord,
  session: SSOSession,
): HandshakeRowVisibility {
  if (r.handshake_type === 'internal') {
    if (r.acceptor) {
      if (!samePrincipalForInternal(r.initiator, r.acceptor)) {
        return { ok: false, reason: 'internal_mismatched_principals' }
      }
    } else {
      if (r.receiver_email && !isSameAccountHandshakeEmails(r.receiver_email, r.initiator.email)) {
        return { ok: false, reason: 'internal_pending_receiver_mismatch' }
      }
    }
    if (sessionMatchesParty(session, r.initiator)) return { ok: true }
    if (r.acceptor && sessionMatchesParty(session, r.acceptor)) return { ok: true }
    return { ok: false, reason: 'internal_session_not_party' }
  }

  if (sessionMatchesParty(session, r.initiator)) return { ok: true }
  if (r.acceptor && sessionMatchesParty(session, r.acceptor)) return { ok: true }
  return { ok: false, reason: 'standard_session_not_party' }
}

const HIDDEN = '[HANDSHAKE_ACCOUNT_ISOLATION] hidden_row'

/**
 * Returns only handshakes visible to the current session; logs each hidden row.
 * When `session` is missing, returns an empty list (fail-closed).
 */
export function filterHandshakeRecordsForCurrentSession(
  records: readonly HandshakeRecord[],
  session: SSOSession | null | undefined,
): HandshakeRecord[] {
  if (!session) {
    if (records.length > 0) {
      console.warn(HIDDEN, { count: records.length, reason: 'no_session' })
    }
    return []
  }
  const out: HandshakeRecord[] = []
  for (const r of records) {
    const v = handshakeRowVisibilityForSession(r, session)
    if (v.ok) {
      out.push(r)
    } else {
      console.warn(HIDDEN, { handshake_id: r.handshake_id, reason: v.reason, handshake_type: r.handshake_type })
    }
  }
  return out
}
