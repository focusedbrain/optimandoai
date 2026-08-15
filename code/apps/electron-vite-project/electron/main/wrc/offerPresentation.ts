/**
 * 5B — what a Connect offer is allowed to SHOW, and 5C's manual-entry gate.
 *
 * This module builds the presentation projection; it renders nothing. Keeping
 * the rule here rather than in the surface is the same reasoning as the rule-8
 * alert: a per-surface predicate is how "never show carrier text" drifts into
 * "usually does not show carrier text".
 *
 * A2 / EVP-first-render is the load-bearing constraint. After capture and
 * verification the first render shows ONLY the signed `value_statement` and
 * `self_description` from the verified EVP. Whatever the carrying email said
 * about itself never enters the offer — and there is no degraded offer: no
 * verified EVP means no offer, not an offer built from carrier bytes.
 */

import { formatBaselineCodeForDisplay } from '@repo/ingestion-core'
import type { WrcEvp, WrcSuspension } from './wrcContract'
import type { WrcStatusComposition } from './entryStatusSurface'

export type OfferPresentationRefusal =
  /** No verified EVP. A2: never fall back to carrier text. */
  | 'no_verified_evp'
  /** The three-layer composition says not admissible. */
  | 'not_admissible'
  /** Resolution never completed (capture-error path, not a status surface). */
  | 'unresolved'

export interface OfferPresentation {
  /** Publisher identity as established by the dual channel, not by the carrier. */
  publisher_part: string
  verified_domain: string
  /** True only when DNS + manifest + cross-check all passed. */
  publisher_domain_verified: boolean
  entry_local_part: string
  /** Locally rendered from the validated identifier only (O3). */
  code_display: string | null
  /** From the VERIFIED EVP. Never from the carrier. */
  value_statement: string
  self_description: string
  scope_directory: Array<{ name: string; desc: string; size_hint_b: number }>
  next_steps: string[]
  /** A4 — per-item "verify in repository" link on offer and consent preview. */
  audit_url: string | null
  catalog_epoch: number
  resolution_mode: 'public' | 'session_bound'
  session_bound: boolean
  /** Visible staleness (A3) — a stale head still displays, it just cannot admit. */
  stale: boolean
  /** A5 — platform suspension is its own visible state. */
  suspension: WrcSuspension | null
}

export interface BuildOfferPresentationInput {
  publisherPart: string
  domain: string
  publisherDomainVerified: boolean
  entryLocalPart: string
  /** Canonical WR code, for the LOCAL renderer. Null when unknown. */
  wrCodeCanonical: string | null
  evp: WrcEvp | null
  status: WrcStatusComposition
  auditUrlBase?: string | null
  evpRef?: string | null
  catalogEpoch: number
  resolutionMode: 'public' | 'session_bound'
  stale: boolean
  suspension?: WrcSuspension | null
}

export type BuildOfferPresentationResult =
  | { ok: true; presentation: OfferPresentation }
  | { ok: false; refusal: OfferPresentationRefusal }

/**
 * Build the offer projection, or refuse.
 *
 * Refusal is not an error path bolted on — it is the majority case the design
 * exists for. An unresolved code, an inadmissible status, or a missing EVP each
 * produce a typed refusal, and the caller shows a status surface instead of an
 * offer. There is no branch that assembles a partial offer.
 */
export function buildOfferPresentation(
  input: BuildOfferPresentationInput,
): BuildOfferPresentationResult {
  if (!input.publisherPart || !input.domain) return { ok: false, refusal: 'unresolved' }
  if (!input.status.admissible) return { ok: false, refusal: 'not_admissible' }
  // A2: no verified EVP ⇒ no offer. Deliberately checked AFTER admissibility so
  // a suspended entry reports its status rather than a missing-EVP technicality.
  if (!input.evp) return { ok: false, refusal: 'no_verified_evp' }

  return {
    ok: true,
    presentation: {
      publisher_part: input.publisherPart,
      verified_domain: input.domain,
      publisher_domain_verified: input.publisherDomainVerified,
      entry_local_part: input.entryLocalPart,
      code_display: renderCodeForDisplay(input.wrCodeCanonical),
      value_statement: input.evp.value_statement,
      self_description: input.evp.self_description,
      scope_directory: input.evp.scope_directory.map((s) => ({
        name: s.name,
        desc: s.desc,
        size_hint_b: s.size_hint_b,
      })),
      next_steps: [...input.evp.next_steps],
      audit_url: buildAuditUrl(input.auditUrlBase, input.evpRef),
      catalog_epoch: input.catalogEpoch,
      resolution_mode: input.resolutionMode,
      session_bound: input.resolutionMode === 'session_bound',
      stale: input.stale,
      suspension: input.suspension ?? null,
    },
  }
}

/**
 * O3 local renderer. Renders from a VALIDATED canonical identifier only, and
 * only on request. A received rendering is never displayed (P12) — this
 * regenerates the grouping locally from the identifier the check profile
 * accepted, so there is no path from carrier bytes to a rendered code.
 */
export function renderCodeForDisplay(canonical: string | null | undefined): string | null {
  if (!canonical) return null
  return formatBaselineCodeForDisplay(canonical)
}

/** A4 — the per-item audit link. Null when either half is unknown. */
export function buildAuditUrl(base: string | null | undefined, hash: string | null | undefined): string | null {
  if (!base || !hash) return null
  return `${String(base).replace(/\/+$/, '')}/v1/audit/${encodeURIComponent(hash)}`
}
