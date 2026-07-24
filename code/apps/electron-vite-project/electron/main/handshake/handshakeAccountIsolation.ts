/**
 * Account isolation for handshake list / recipient pickers: hide rows that do not
 * belong to the current SSO session, without mutating the DB.
 *
 * Identity comparison is the shared full-claim guard [VII.3.8–3.10]
 * (`@repo/ingestion-core` — issuer + subject + full bound claim set, exact
 * match, no OR-logic). Per adopted decision Q12, existing rows that only
 * matched under the old OR-logic (mixed-realm rows: e.g. same email under a
 * different issuer) stay visible but are flagged `repair_needed` — enforcement
 * paths (ingest/ack/return, ingress filter, service RPC) reject them strictly;
 * this module only governs list visibility.
 */
import {
  fullClaimIdentityMatch,
  samePrincipalFullClaim,
  type IdentityClaimSet,
} from '@repo/ingestion-core'
import { isSameAccountHandshakeEmails, validateReceiverEmail } from '../../../../../packages/shared/src/handshake/receiverEmailValidation'
import type { HandshakeRecord, PartyIdentity, SSOSession } from './types'
import { HandshakeState } from './types'

export type HandshakeRowVisibility =
  | { ok: true; repair_needed?: boolean; repair_reason?: string }
  | { ok: false; reason: string }

function sessionClaims(session: SSOSession): IdentityClaimSet {
  return {
    iss: session.iss,
    sub: session.sub,
    email: session.email,
    wrdesk_user_id: session.wrdesk_user_id,
  }
}

/**
 * Session-vs-party visibility classification.
 *
 * - `match`: full-claim guard passed (all bound claims match exactly).
 * - `mixed_realm_repair`: guard failed, but the row still resolves to this
 *   session under the retired OR-logic (wrdesk id, iss+sub pair, or email).
 *   Q12: keep visible, flag for repair UX — never treat as an enforcement match.
 * - `foreign`: no basis to show this row to the session.
 */
export function classifyPartyForSessionVisibility(
  session: SSOSession,
  party: PartyIdentity | null | undefined,
): 'match' | 'mixed_realm_repair' | 'foreign' {
  if (!party) return 'foreign'
  const guard = fullClaimIdentityMatch(sessionClaims(session), party)
  if (guard.ok) return 'match'

  // Q12 legacy-admit predicate — visibility only, mirrors the retired OR-logic.
  const sw = (session.wrdesk_user_id || '').trim()
  const pw = (party.wrdesk_user_id || '').trim()
  const wrdeskMatched = sw.length > 0 && pw.length > 0 && sw === pw
  const iss = (session.iss || '').trim()
  const piss = (party.iss || '').trim()
  const sub = (session.sub || '').trim()
  const psub = (party.sub || '').trim()
  const issSubMatched =
    iss.length > 0 && piss.length > 0 && sub.length > 0 && psub.length > 0 && iss === piss && sub === psub
  const emailMatched = isSameAccountHandshakeEmails(session.email, party.email)
  if (wrdeskMatched || issSubMatched || emailMatched) {
    return 'mixed_realm_repair'
  }
  return 'foreign'
}

/** Acceptor-side file import: party identity is not bound until accept (Connect-offer consent gate). */
function isPendingAcceptorPartyForSession(r: HandshakeRecord, session: SSOSession): boolean {
  if (r.local_role !== 'acceptor') return false
  if (r.state !== HandshakeState.PENDING_REVIEW) return false
  return validateReceiverEmail(r.receiver_email, session.email).valid
}

const REPAIR_LOG = '[IDENTITY_GUARD] mixed_realm_row_repair_needed'

/**
 * Returns whether a persisted handshake row may be returned to the current session
 * (list / BEAP recipient picker). Does not read the DB; hide-only semantics.
 */
export function handshakeRowVisibilityForSession(
  r: HandshakeRecord,
  session: SSOSession,
): HandshakeRowVisibility {
  if (r.same_principal === true) {
    if (r.acceptor) {
      if (!samePrincipalFullClaim(r.initiator, r.acceptor).ok) {
        return { ok: false, reason: 'internal_mismatched_principals' }
      }
    } else {
      if (r.receiver_email && !isSameAccountHandshakeEmails(r.receiver_email, r.initiator.email)) {
        return { ok: false, reason: 'internal_pending_receiver_mismatch' }
      }
    }
  }

  const vsInitiator = classifyPartyForSessionVisibility(session, r.initiator)
  const vsAcceptor = r.acceptor ? classifyPartyForSessionVisibility(session, r.acceptor) : 'foreign'

  if (vsInitiator === 'match' || vsAcceptor === 'match') {
    return { ok: true }
  }
  if (vsInitiator === 'mixed_realm_repair' || vsAcceptor === 'mixed_realm_repair') {
    console.warn(REPAIR_LOG, {
      handshake_id: r.handshake_id,
      same_principal: r.same_principal === true,
      reason: 'full_claim_guard_failed_legacy_or_logic_matched',
    })
    return { ok: true, repair_needed: true, repair_reason: 'mixed_realm_claims' }
  }
  if (isPendingAcceptorPartyForSession(r, session)) {
    return { ok: true }
  }
  return {
    ok: false,
    reason: r.same_principal === true ? 'internal_session_not_party' : 'standard_session_not_party',
  }
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
      console.warn(HIDDEN, { handshake_id: r.handshake_id, reason: v.reason, same_principal: r.same_principal === true })
    }
  }
  return out
}
