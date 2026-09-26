/**
 * 4A — entry status model, composed from THREE orthogonal fields (delta A6).
 *
 * The apparent collision that A6 resolves: `suspended` appears both as a
 * publisher-signed `entry.status` (§XVII.3.2) and as a platform-side
 * `envelope.suspension` (§XVII.3.3), while D4 carries a publisher-PART status.
 * They are three different statements by three different parties about three
 * different objects, and merging them would lose exactly the information an
 * operator needs.
 *
 * So, per A6:
 *
 *  1. DATA — the two `suspended`s cannot collide by construction. `entry.status`
 *     is publisher-SIGNED; platform suspension lives only in the envelope, and
 *     the WRC rejects rather than modifies (§1.6).
 *  2. ADMISSION — conjunctive and fail-closed:
 *       admissible ⇔ publisher_part == active
 *                  AND entry.status == published
 *                  AND envelope.suspension == null
 *     Any failing leg yields a typed reason.
 *  3. DISPLAY — never conflated. Headline is the failing leg CLOSEST TO THE
 *     OBJECT (platform > entry > publisher-part); every failing leg stays
 *     visible in detail, because never-fails-silently means an operator is told
 *     all of what is wrong, not merely the first thing.
 *
 * No enum is merged or extended anywhere in this module.
 */

import type { WrcEntryStatus, WrcPublisherStatus, WrcSuspension } from './wrcContract'

// ── Layers ────────────────────────────────────────────────────────────────────

/** Which party's statement a surface line comes from. */
export type WrcStatusLayer = 'platform' | 'entry' | 'publisher_part'

/**
 * Closeness to the object, per A6.3. Platform suspension is the most immediate
 * statement about THIS object; the publisher-part status is the most distant.
 */
const LAYER_PRECEDENCE: Record<WrcStatusLayer, number> = {
  platform: 3,
  entry: 2,
  publisher_part: 1,
}

export type WrcStatusReason =
  // platform layer
  | 'platform_suspended'
  // entry layer (publisher-signed)
  | 'entry_suspended'
  | 'entry_retired'
  // publisher-part layer (D4)
  | 'publisher_inactive'
  | 'publisher_revoked'
  | 'publisher_superseded'
  | 'publisher_compromised'

export interface WrcStatusLine {
  layer: WrcStatusLayer
  reason: WrcStatusReason
  /** Distinct copy per layer — a platform suspension never reads like a publisher withdrawal. */
  copy: string
  /** A5 / A4: the per-item audit link belongs on the surface that shows this. */
  audit_link: boolean
  /** Platform suspension only. */
  suspension?: WrcSuspension
  /** Superseded only — surfaced explicitly, never redirected to silently. */
  successor_publisher_part?: string
}

export interface WrcStatusComposition {
  /** Conjunctive fail-closed admission (A6.2). */
  admissible: boolean
  /** The failing leg closest to the object; null when admissible. */
  headline: WrcStatusLine | null
  /** EVERY failing leg, ordered by closeness. Never truncated to the headline. */
  failing: WrcStatusLine[]
  /**
   * Compromised is treated as revoked PLUS the unsuppressible Phase-2 alert
   * class. The alert is not a status line — it is a separate, non-dismissible
   * surface — so it is reported as its own flag.
   */
  unsuppressible_warning: boolean
  /** Superseded: the successor exists but is offered only after its own chain. */
  successor_publisher_part: string | null
}

export interface ComposeEntryStatusInput {
  /** D4 publisher-part status from the resolve claim. */
  publisherStatus: WrcPublisherStatus
  /** Publisher-signed entry status. Absent when no entry was requested. */
  entryStatus?: WrcEntryStatus | null
  /** Platform suspension from the DualAssuranceEnvelope. */
  suspension?: WrcSuspension | null
  /** Successor for a superseded publisher part, when the registry named one. */
  successorPublisherPart?: string | null
}

// ── Copy, distinct per layer ──────────────────────────────────────────────────

const COPY: Record<WrcStatusReason, string> = {
  // Platform speaks about the object, in the platform's own voice.
  platform_suspended: 'Suspended by the platform.',
  // The publisher speaks about its own entry.
  entry_suspended: 'Withdrawn by the publisher.',
  entry_retired: 'Retired by the publisher.',
  // D4 speaks about the publisher part, one level out from the entry.
  publisher_inactive: 'This publisher is currently not offering connections.',
  publisher_revoked: 'This publisher identifier has been revoked.',
  publisher_superseded: 'This publisher identifier has been superseded.',
  publisher_compromised: 'This publisher identifier is marked compromised.',
}

/**
 * Compose the three layers into one surface description.
 *
 * Returns a composition rather than a single verdict because the caller needs
 * both: `admissible` gates the offer, `failing` renders the detail, and
 * `headline` chooses what to lead with.
 */
export function composeEntryStatus(input: ComposeEntryStatusInput): WrcStatusComposition {
  const failing: WrcStatusLine[] = []

  // Layer 1 — platform (closest to the object).
  if (input.suspension) {
    failing.push({
      layer: 'platform',
      reason: 'platform_suspended',
      copy: `${COPY.platform_suspended} Reason: ${input.suspension.reason_code}.`,
      audit_link: true,
      suspension: input.suspension,
    })
  }

  // Layer 2 — publisher-signed entry status.
  if (input.entryStatus === 'suspended') {
    failing.push({
      layer: 'entry',
      reason: 'entry_suspended',
      copy: COPY.entry_suspended,
      audit_link: true,
    })
  } else if (input.entryStatus === 'retired') {
    failing.push({
      layer: 'entry',
      reason: 'entry_retired',
      copy: COPY.entry_retired,
      audit_link: true,
    })
  }

  // Layer 3 — D4 publisher-part status.
  const successor = input.successorPublisherPart ?? null
  switch (input.publisherStatus) {
    case 'active':
      break
    case 'inactive':
      failing.push({
        layer: 'publisher_part',
        reason: 'publisher_inactive',
        copy: COPY.publisher_inactive,
        audit_link: true,
      })
      break
    case 'revoked':
      failing.push({
        layer: 'publisher_part',
        reason: 'publisher_revoked',
        copy: COPY.publisher_revoked,
        audit_link: true,
      })
      break
    case 'superseded':
      failing.push({
        layer: 'publisher_part',
        reason: 'publisher_superseded',
        copy: successor
          ? `${COPY.publisher_superseded} Successor: ${successor}.`
          : COPY.publisher_superseded,
        audit_link: true,
        ...(successor ? { successor_publisher_part: successor } : {}),
      })
      break
    case 'compromised':
      failing.push({
        layer: 'publisher_part',
        reason: 'publisher_compromised',
        copy: COPY.publisher_compromised,
        audit_link: true,
      })
      break
  }

  failing.sort((a, b) => LAYER_PRECEDENCE[b.layer] - LAYER_PRECEDENCE[a.layer])

  // A6.2 — conjunctive, fail-closed. An entry that was never fetched cannot
  // satisfy the entry leg, so admission requires it to be explicitly published.
  const admissible =
    input.publisherStatus === 'active' &&
    input.entryStatus === 'published' &&
    !input.suspension

  return {
    admissible,
    headline: failing[0] ?? null,
    failing,
    unsuppressible_warning: input.publisherStatus === 'compromised',
    successor_publisher_part: input.publisherStatus === 'superseded' ? successor : null,
  }
}

/**
 * `expires_at` auto-transition. Default is → revoked; a publisher may configure
 * → inactive instead. Never silently drops a status: an expired identifier
 * still resolves to a status surface.
 */
export function applyExpiryTransition(
  status: WrcPublisherStatus,
  expiresAtS: number | null | undefined,
  nowS: number,
  configured: 'revoked' | 'inactive' = 'revoked',
): WrcPublisherStatus {
  if (status !== 'active') return status
  if (typeof expiresAtS !== 'number' || !Number.isFinite(expiresAtS)) return status
  if (nowS < expiresAtS) return status
  return configured
}
