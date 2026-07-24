/**
 * Receiver-side ingress admission filter — [VII.2.7] (Phase 1, E2 groundwork).
 *
 * The FIRST ingress stage for inbound deliveries from a remote peer, run as
 * soon as the target handshake_id is known and BEFORE anything is persisted
 * or surfaced. It enforces what is representable today:
 *
 *   1. the relationship exists (except formation capsules, which create it),
 *   2. it is live — not REVOKED / EXPIRED, and for message-class deliveries
 *      in its operational window (ACCEPTED | ACTIVE; ACCEPTED is the
 *      post-accept, pre-context-roundtrip window treated as active
 *      throughout the codebase),
 *   3. the presented sender identity passes the shared full-claim guard
 *      [VII.3.8–3.10] when the transport authenticated one,
 *   4. the delivery is within the flattened sharing_mode scope when the
 *      caller declares a context-bearing delivery.
 *
 * Blocked transmissions die pre-visibility: no inbox row, no placeholder,
 * no notification — only an audit_log record (existing table, no schema
 * change) and a metadata-only console line.
 *
 * Phase 5 slot: `grantRef` on the input reserves the place where
 * grant-object scoping will be evaluated without restructuring callers.
 *
 * NOTE on service-RPC / DataChannel / p2p_signal ingress: those paths are
 * admitted by `assertRecordForServiceRpc` (internal + ACTIVE + same-principal
 * + identity-complete), which is a strict superset of this filter's checks.
 * See internal-inference invariants; do not weaken that gate.
 */

import { fullClaimIdentityMatch, type IdentityClaimSet } from '@repo/ingestion-core'
import { HandshakeState, type HandshakeRecord } from './types'
import { getHandshakeRecord, insertAuditLogEntry } from './db'

/** Delivery class, decides which state window is admissible. */
export type IngressDeliveryKind =
  /** BEAP message/package for the inbox (direct_beap, email_beap, qBEAP). */
  | 'beap_message'
  /** Handshake control-plane capsule (initiate/accept/refresh/revoke/context-sync). */
  | 'handshake_capsule'

export type IngressBlockReason =
  | 'unknown_relationship'
  | 'relationship_revoked'
  | 'relationship_expired'
  | 'relationship_not_operational'
  | 'sender_identity_mismatch'
  | 'sharing_mode_scope_violation'

export interface IngressAdmissionInput {
  handshakeId: string
  kind: IngressDeliveryKind
  /** Transport tag for the log record ('coordination_ws' | 'relay_pull' | 'email' | 'file' | …). */
  source: string
  /**
   * Sender identity claims when (and only when) the transport authenticated
   * them. Unauthenticated transport strings (e.g. an email From header) must
   * NOT be passed here; identity is then enforced downstream where claims
   * exist (ownership pipeline step).
   */
  senderClaims?: IdentityClaimSet | null
  /** Set when the delivery is known to carry shared-context payload. */
  carriesContext?: boolean
  /** Phase 5: grant-object reference — reserved, not evaluated yet. */
  grantRef?: string | null
}

export type IngressAdmissionResult =
  | { admitted: true; record: HandshakeRecord | null }
  | { admitted: false; reason: IngressBlockReason }

/** Operational window for message-class deliveries. */
const OPERATIONAL_STATES: ReadonlySet<HandshakeState> = new Set([
  HandshakeState.ACCEPTED,
  HandshakeState.ACTIVE,
])

function isExpired(record: HandshakeRecord, now: Date): boolean {
  if (record.expires_at == null) return false
  const t = Date.parse(record.expires_at)
  return !isNaN(t) && t < now.getTime()
}

/** Remote party of the record as seen from the local role. */
function counterpartyOf(record: HandshakeRecord): IdentityClaimSet | null {
  const party = record.local_role === 'initiator' ? record.acceptor : record.initiator
  if (!party) return null
  return {
    iss: party.iss ?? null,
    sub: party.sub ?? null,
    email: party.email ?? null,
    wrdesk_user_id: party.wrdesk_user_id ?? null,
  }
}

function block(
  db: any,
  input: IngressAdmissionInput,
  reason: IngressBlockReason,
): IngressAdmissionResult {
  // Pre-visibility death still leaves a record: audit_log + metadata-only log line.
  try {
    insertAuditLogEntry(db, {
      timestamp: new Date().toISOString(),
      action: 'INGRESS_ADMISSION_BLOCKED',
      handshake_id: input.handshakeId,
      reason_code: reason,
      failed_step: 'ingress_admission',
      metadata: { kind: input.kind, source: input.source },
    })
  } catch {
    /* audit failure must not mask the block */
  }
  console.log(
    `[INGRESS_ADMISSION] blocked handshake=${input.handshakeId} kind=${input.kind} source=${input.source} reason=${reason}`,
  )
  return { admitted: false, reason }
}

/**
 * Run the admission filter. Callers MUST invoke this before persisting or
 * surfacing anything for an inbound delivery, and on `admitted: false` must
 * drop the delivery without any user-visible artifact.
 */
export function admitInboundDelivery(
  db: any,
  input: IngressAdmissionInput,
  now: Date = new Date(),
): IngressAdmissionResult {
  let record: HandshakeRecord | null = null
  try {
    record = getHandshakeRecord(db, input.handshakeId) ?? null
  } catch {
    record = null
  }

  if (!record) {
    // Formation capsules legitimately arrive before a record exists; the
    // handshake pipeline (receiver-email check, state machine) owns them.
    if (input.kind === 'handshake_capsule') {
      return { admitted: true, record: null }
    }
    return block(db, input, 'unknown_relationship')
  }

  if (record.state === HandshakeState.REVOKED) {
    return block(db, input, 'relationship_revoked')
  }
  if (record.state === HandshakeState.EXPIRED || isExpired(record, now)) {
    return block(db, input, 'relationship_expired')
  }

  if (input.kind === 'beap_message' && !OPERATIONAL_STATES.has(record.state)) {
    return block(db, input, 'relationship_not_operational')
  }

  // Full-claim identity guard [VII.3.8–3.10] — only when the transport
  // authenticated sender claims. Exact-match against the bound counterparty;
  // no OR-logic, no sub-only shortcut (shared guard semantics).
  if (input.senderClaims) {
    const bound = counterpartyOf(record)
    if (bound && !fullClaimIdentityMatch(input.senderClaims, bound).ok) {
      return block(db, input, 'sender_identity_mismatch')
    }
  }

  // Flattened sharing_mode scope: a receive-only relationship must not accept
  // context-bearing deliveries originating from the acceptor side.
  if (
    input.carriesContext === true &&
    record.sharing_mode === 'receive-only' &&
    record.local_role === 'initiator'
  ) {
    return block(db, input, 'sharing_mode_scope_violation')
  }

  return { admitted: true, record }
}
