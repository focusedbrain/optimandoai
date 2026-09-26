/**
 * What a WR Code surface shows for one submission — built in main, rendered as is.
 *
 * The rules live here, not in the surface, for the reason `offerPresentation.ts`
 * gives: a per-surface rule is how "never show carrier text" drifts. An offer
 * is built only from the verified EVP and the Gate-2 namespace record (A2,
 * EVP-first render); a status refusal reuses the three-layer copy of
 * `entryStatusSurface.ts`; every other refusal carries human copy and a tone.
 * The reason code travels along for the secondary line, never as the headline.
 */

import type { WrCodeGateOutcome, WrCodeGateRefusal } from './gatePipeline'
import { buildOfferPresentation, type OfferPresentation } from './offerPresentation'
import { composeEntryStatus, type ComposeEntryStatusInput } from './entryStatusSurface'

/**
 * `input`   — the code itself is wrong (capture-error path); fix and retry.
 * `status`  — a real object in a state that admits nothing.
 * `warning` — do not act on it (compromised).
 * `neutral` — nothing wrong with the code, but it cannot be used here or now.
 */
export type WrcSubmissionTone = 'input' | 'status' | 'warning' | 'neutral'

export interface WrcSubmissionRefusalView {
  kind: 'refusal'
  tone: WrcSubmissionTone
  headline: string
  details: string[]
  successor_publisher_part: string | null
  unsuppressible_warning: boolean
  gate: number
  reason: string
}

export interface WrcSubmissionOfferView {
  kind: 'offer'
  class_label: string
  offer: OfferPresentation
}

export type WrcSubmissionView = WrcSubmissionOfferView | WrcSubmissionRefusalView

const CLASS_LABEL: Record<string, string> = {
  P: 'Publisher offering',
  I: 'Internal handshake',
  C: 'Cross-organization handshake',
  SP: 'Sub-handshake of an offering',
  SI: 'Sub-handshake of an internal handshake',
  SC: 'Sub-handshake of a cross-organization handshake',
  SE: 'Session sub-handshake',
}

export function wrcClassLabel(cls: string): string {
  return CLASS_LABEL[cls] ?? 'WR Code'
}

/** Gate-1 capture reasons — the grammar module's own vocabulary. */
const CAPTURE_COPY: Record<string, string> = {
  empty: 'Enter a WR Code.',
  unknown_prefix: 'This is not a WR Code: it does not start with a known class.',
  wrong_length: 'This code has the wrong number of characters.',
  out_of_alphabet: 'This code contains a character WR Codes never use.',
  check_failed: 'Typing error: the check character does not match. Compare each character.',
}

/** Gate-2 and Gate-3 reasons that describe the state of a real object. */
const STATUS_INPUT: Record<string, ComposeEntryStatusInput> = {
  namespace_inactive: { publisherStatus: 'inactive' },
  namespace_revoked: { publisherStatus: 'revoked' },
  namespace_superseded: { publisherStatus: 'superseded' },
  namespace_compromised: { publisherStatus: 'compromised' },
  entry_suspended: { publisherStatus: 'active', entryStatus: 'suspended' },
  entry_retired: { publisherStatus: 'active', entryStatus: 'retired' },
}

/** Lifecycle and use states that are not three-layer statuses. */
const STATE_COPY: Record<string, { tone: WrcSubmissionTone; headline: string }> = {
  entry_expired: { tone: 'status', headline: 'This code has expired. Ask the publisher for a new one.' },
  session_not_yet_valid: { tone: 'neutral', headline: 'This code is not valid yet. Try again later.' },
  entry_inactive: { tone: 'status', headline: 'This offer is currently not active.' },
  entry_revoked: { tone: 'status', headline: 'The publisher has revoked this offer.' },
  entry_superseded: { tone: 'status', headline: 'This offer has been replaced by a newer one.' },
  entry_compromised: { tone: 'warning', headline: 'Do not act on this offer: it is marked compromised.' },
  entry_declined: { tone: 'status', headline: 'This invitation was declined.' },
  entry_withdrawn: { tone: 'status', headline: 'The publisher has withdrawn this invitation.' },
  entry_not_admitting: { tone: 'status', headline: 'This offer is not accepting requests right now.' },
  CONSUMED: { tone: 'status', headline: 'This one-time offer has already been used.' },
  CONTEXT_EXHAUSTED: { tone: 'status', headline: 'This offer has no uses left.' },
  CLAIMED_BY_OTHER: {
    tone: 'neutral',
    headline: 'Someone else is accepting this offer right now. Try again in a few minutes.',
  },
  entry_account_required: {
    tone: 'neutral',
    headline: 'The registry needs your WR Desk sign-in to show this code. Sign in again, then check it.',
  },
  NOT_FOR_YOU: { tone: 'neutral', headline: 'This code is addressed to someone else.' },
  NOT_FOR_THIS_DEVICE: { tone: 'neutral', headline: 'This code is addressed to another of your devices.' },
  sso_principal_mismatch: {
    tone: 'neutral',
    headline: 'Your signed-in account cannot act for the organization this code needs.',
  },
}

function refusal(
  outcome: WrCodeGateRefusal,
  tone: WrcSubmissionTone,
  headline: string,
  details: string[] = [],
): WrcSubmissionRefusalView {
  return {
    kind: 'refusal',
    tone,
    headline,
    details,
    successor_publisher_part: outcome.successorPublisherPart ?? null,
    unsuppressible_warning: outcome.unsuppressibleWarning === true,
    gate: outcome.gate,
    reason: outcome.reason,
  }
}

function refusalView(outcome: WrCodeGateRefusal): WrcSubmissionRefusalView {
  const reason = outcome.reason

  if (outcome.gate === 1) {
    return refusal(outcome, 'input', CAPTURE_COPY[reason] ?? 'This is not a valid WR Code.')
  }
  if (reason === 'namespace_unknown_identifier' || reason === 'entry_unknown') {
    return refusal(outcome, 'input', 'This code is not registered. Check it for typing errors.')
  }
  if (/\b(?:directory_)?not_configured\b/.test(outcome.detail ?? '')) {
    return refusal(outcome, 'neutral', 'WR Code verification is not set up in this build.')
  }

  const status = STATUS_INPUT[reason]
  if (status) {
    const composition = composeEntryStatus({
      ...status,
      successorPublisherPart: outcome.successorPublisherPart ?? null,
    })
    const tone: WrcSubmissionTone = composition.unsuppressible_warning ? 'warning' : 'status'
    const headline = composition.unsuppressible_warning
      ? 'Do not act on this code.'
      : composition.headline?.copy ?? 'This code cannot be used.'
    const details = composition.failing.map((l) => l.copy).filter((c) => c !== headline)
    return refusal(outcome, tone, headline, details)
  }
  if (reason === 'entry_platform_suspended') {
    const composition = composeEntryStatus({
      publisherStatus: 'active',
      entryStatus: 'published',
      suspension: { since: 0, reason_code: outcome.detail ?? 'unspecified', reversible: true },
    })
    return refusal(outcome, 'status', composition.headline!.copy)
  }

  const state = STATE_COPY[reason]
  if (state) return refusal(outcome, state.tone, state.headline)

  return refusal(outcome, 'neutral', 'This code could not be verified.')
}

/** Build the view for one pipeline outcome. Never throws, never assembles a partial offer. */
export function buildWrcSubmissionView(outcome: WrCodeGateOutcome): WrcSubmissionView {
  if (!outcome.ok) return refusalView(outcome)

  const ns = outcome.namespaces[0]
  const material = outcome.material
  const status = composeEntryStatus({
    publisherStatus: ns?.status ?? 'inactive',
    entryStatus: material.catalog_status,
    suspension: material.suspension,
  })
  const built = buildOfferPresentation({
    publisherPart: ns?.publisher_part ?? '',
    domain: ns?.domain ?? '',
    publisherDomainVerified: Boolean(ns?.dual_signature_verified && ns.dns_verified && ns.account_holder_verified),
    responsibleDomain: ns?.display_origin ?? null,
    entryLocalPart: material.entry_id,
    wrCodeCanonical: outcome.reference.canonical,
    evp: outcome.released.evp ?? material.evp,
    status,
    catalogEpoch: material.entry?.epoch ?? 0,
    resolutionMode: material.session ? 'session_bound' : 'public',
    stale: false,
    suspension: material.suspension,
  })
  if (!built.ok) {
    return {
      kind: 'refusal',
      tone: 'neutral',
      headline: 'This code could not be verified.',
      details: [],
      successor_publisher_part: null,
      unsuppressible_warning: false,
      gate: 6,
      reason: `offer_${built.refusal}`,
    }
  }
  return { kind: 'offer', class_label: wrcClassLabel(outcome.reference.cls), offer: built.presentation }
}
