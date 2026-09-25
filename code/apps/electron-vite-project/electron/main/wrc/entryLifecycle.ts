/**
 * Entry lifecycle state model — Annex XVI v1.95 §XVI.8.1 (entry status),
 * §XVI.8.3 (invitation lifecycle), §XVI.8.4 (use-limited states).
 *
 * This module is the Entry gate's substrate: one status vocabulary, one
 * transition table, one request-admission evaluator. The §XVI.7.6 Gate 3
 * question — "is the entry in a state that admits a request (PENDING for an
 * invitation; ACTIVE for an offering)?" — is answered HERE, and the one-time-
 * use claim store enforces its CLAIMED/CONSUMED/EXHAUSTED moves against the
 * same transition table, so the two can never disagree about what a state
 * permits.
 *
 * Two invariants of §XVI.8.1/8.2 shape everything below:
 *
 *  - A known durable identifier resolves to its CURRENT state rather than
 *    silently becoming an unrelated referent; terminal states stay resolvable
 *    (P11 — "a code found later still tells the truth about itself"), which is
 *    why terminal states simply have no outgoing transitions.
 *  - SUPERSEDED names its successor explicitly; silent reinterpretation is
 *    prohibited. The evaluator therefore carries the successor OUT as data —
 *    surfacing it is not offering it, and the caller never redirects.
 *
 * Publisher-side transitions (a publisher revoking or superseding its entry)
 * happen at the publisher's repository, off this machine; the table still
 * models them so local stores reject impossible moves and fixtures can pin
 * the whole model.
 */

// ── Status vocabulary ─────────────────────────────────────────────────────────

/**
 * §XVI.8.1 base set + §XVI.8.4 use-limited states + §XVI.8.3 invitation
 * states. One flat vocabulary: the annex is explicit that the invitation
 * states are "states of one identifier", not a parallel machine.
 */
export type WrEntryLifecycleStatus =
  // §XVI.8.1
  | 'active'
  | 'inactive'
  | 'revoked'
  | 'superseded'
  | 'compromised'
  // §XVI.8.4 (use-limited entries / automations)
  | 'claimed'
  | 'consumed'
  | 'exhausted'
  // §XVI.8.3 (C-class invitation lifecycle)
  | 'pending'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'established'

/**
 * Terminal states: no outgoing transitions, identifier never reassigned, the
 * state itself remains resolvable (§XVI.8.2, §XVI.8.4 Permanence).
 * COMPROMISED is "treated as terminal/revoked with an explicit warning".
 */
export const WR_ENTRY_TERMINAL_STATES: ReadonlySet<WrEntryLifecycleStatus> = new Set([
  'revoked',
  'superseded',
  'compromised',
  'consumed',
  'exhausted',
  'declined',
  'withdrawn',
  'expired',
])

// ── Transition table ──────────────────────────────────────────────────────────

/**
 * Every transition the annex names or requires:
 *
 *  - active ⇄ inactive — temporary withdrawal and reinstatement (§XVI.8.1);
 *  - active/inactive → revoked | superseded | compromised — publisher acts;
 *  - active → claimed — Gate-5 compare-and-set by an identified party
 *    (§XVI.8.4); claimed → active is the timeout / decline / post-claim gate
 *    failure revert AND the n>1 decrement-and-return;
 *  - claimed → consumed — the party's explicit acceptance takes the use;
 *  - active → consumed — consume_at = resolution only (bearer entries);
 *  - active → exhausted — the finalizer spending an automation's allowance;
 *  - claimed → revoked | compromised — the publisher can still kill a
 *    reserved entry; reservation is not immunity;
 *  - pending → claimed | withdrawn | expired — invitation lifecycle
 *    (§XVI.8.3); claimed → established | declined | pending (revert);
 *  - established → revoked | superseded | compromised — "equivalent to ACTIVE
 *    for a relationship entry".
 */
const to = (...states: WrEntryLifecycleStatus[]): readonly WrEntryLifecycleStatus[] => Object.freeze(states)

export const WR_ENTRY_LIFECYCLE_TRANSITIONS: Readonly<
  Record<WrEntryLifecycleStatus, readonly WrEntryLifecycleStatus[]>
> = Object.freeze({
  active: to('inactive', 'revoked', 'superseded', 'compromised', 'claimed', 'consumed', 'exhausted'),
  inactive: to('active', 'revoked', 'superseded', 'compromised'),
  claimed: to('active', 'consumed', 'established', 'declined', 'pending', 'revoked', 'compromised'),
  pending: to('claimed', 'withdrawn', 'expired', 'compromised'),
  established: to('revoked', 'superseded', 'compromised'),
  revoked: to(),
  superseded: to(),
  compromised: to(),
  consumed: to(),
  exhausted: to(),
  declined: to(),
  withdrawn: to(),
  expired: to(),
})

/** True when `from → to` is a move the model permits. Same-state is a no-op, not a transition. */
export function canTransitionEntryLifecycle(
  from: WrEntryLifecycleStatus,
  to: WrEntryLifecycleStatus,
): boolean {
  return WR_ENTRY_LIFECYCLE_TRANSITIONS[from].includes(to)
}

// ── Catalog-status correspondence ─────────────────────────────────────────────

/**
 * The Phase-3 catalog carries the publisher-signed entry status in the
 * §XVII.3.2 vocabulary. Its correspondence into the §XVI.8.1 model:
 *
 *   published → active     (offer may be presented)
 *   suspended → inactive   (temporarily withdrawn by the publisher)
 *   retired   → revoked    (permanently withdrawn; identifier not reassigned)
 *
 * Gate 3 still REPORTS the catalog-precise reason (`entry_suspended`,
 * `entry_retired`) because the status surface renders the publisher's own
 * statement; this mapping exists so lifecycle consumers (the claim store, the
 * transition table) reason in one vocabulary.
 */
export function entryLifecycleFromCatalogStatus(
  status: 'published' | 'suspended' | 'retired',
): WrEntryLifecycleStatus {
  return status === 'published' ? 'active' : status === 'suspended' ? 'inactive' : 'revoked'
}

// ── Request admission (the Gate-3 substrate) ──────────────────────────────────

export interface EvaluateLifecycleInput {
  lifecycle: WrEntryLifecycleStatus
  /** What the entry is: an offering admits ACTIVE, an invitation admits PENDING (§XVI.7.6 Gate 3). */
  kind: 'offering' | 'invitation'
  /** Who holds a CLAIMED reservation, when known. */
  claimedBy?: string | null
  /** The evaluating party's own claimant identity (see `claimantIdOf`). */
  selfClaimant?: string | null
  /** Successor named by a SUPERSEDED entry — surfaced, never followed. */
  successorEntryId?: string | null
}

export type LifecycleAdmissionReason =
  | 'entry_inactive'
  | 'entry_revoked'
  | 'entry_superseded'
  | 'entry_compromised'
  | 'entry_declined'
  | 'entry_withdrawn'
  | 'entry_expired'
  | 'entry_not_admitting'
  | 'CONSUMED'
  | 'CLAIMED_BY_OTHER'
  | 'CONTEXT_EXHAUSTED'

export type LifecycleAdmission =
  | { admits: true }
  | {
      admits: false
      reason: LifecycleAdmissionReason
      detail?: string
      /** SUPERSEDED: the successor rides out as data (§XVI.8.1). */
      successorEntryId?: string | null
      /** COMPROMISED / CONSUMED warn unsuppressibly (§XVI.8.1, §XVI.8.4 trusted UI). */
      unsuppressibleWarning?: boolean
    }

/**
 * §XVI.7.6 Gate 3 / §XVI.8.1 / §XVI.8.4 — does this state admit a request?
 *
 * Everything that does not admit rejects WITH THE STATUS AS THE REASON, so a
 * status surface never has to guess; CLAIMED admits only the claim holder's
 * own retry (idempotency, §XVI.8.4); CONSUMED and COMPROMISED carry the
 * unsuppressible warning class.
 */
export function evaluateEntryLifecycleForRequest(input: EvaluateLifecycleInput): LifecycleAdmission {
  const { lifecycle, kind } = input
  switch (lifecycle) {
    case 'active':
      return kind === 'offering'
        ? { admits: true }
        : { admits: false, reason: 'entry_not_admitting', detail: 'invitation is not PENDING (already active)' }
    case 'pending':
      return kind === 'invitation'
        ? { admits: true }
        : { admits: false, reason: 'entry_not_admitting', detail: 'offering is PENDING, not ACTIVE' }
    case 'inactive':
      return { admits: false, reason: 'entry_inactive' }
    case 'revoked':
      return { admits: false, reason: 'entry_revoked' }
    case 'superseded':
      return {
        admits: false,
        reason: 'entry_superseded',
        successorEntryId: input.successorEntryId ?? null,
      }
    case 'compromised':
      return { admits: false, reason: 'entry_compromised', unsuppressibleWarning: true }
    case 'claimed': {
      const self = input.selfClaimant ?? null
      if (self && input.claimedBy === self) return { admits: true }
      return {
        admits: false,
        reason: 'CLAIMED_BY_OTHER',
        detail: input.claimedBy ?? undefined,
      }
    }
    case 'consumed':
      // "The code has already been used, and if the user did not use it,
      // someone else did" (§XVI.8.4) — a warning, never an offer.
      return { admits: false, reason: 'CONSUMED', unsuppressibleWarning: true }
    case 'exhausted':
      return { admits: false, reason: 'CONTEXT_EXHAUSTED' }
    case 'declined':
      return { admits: false, reason: 'entry_declined' }
    case 'withdrawn':
      return { admits: false, reason: 'entry_withdrawn' }
    case 'expired':
      return { admits: false, reason: 'entry_expired' }
    case 'established':
      return {
        admits: false,
        reason: 'entry_not_admitting',
        detail: 'relationship already established for this identifier',
      }
  }
}
