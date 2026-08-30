/**
 * Interim gate deps — §XVI.7.6 gates 2/3/5/6 anchored on the Phase-3 registry
 * client.
 *
 * THE SEAM (pre-authorized, Run 2): the full Namespace Directory / Directory
 * Record of §XVI.6.4/6.5 is out of scope. Gate 2 verifies against the
 * existing Phase-3 chain — DNS-pinned root, dual-channel domain validation,
 * head-embedded delegation record, ingest countersignature — as the interim
 * trust anchor, fail-closed on ANY verification failure. The pipeline's deps
 * interface is written against the directory model, so replacing this adapter
 * with a real directory client later is internal to this file.
 *
 * TODO(§XVI.6.4/6.5): swap the interim anchor for the Namespace Directory —
 *  - `verifyNamespace` should read the signed Directory Record (operator +
 *    publisher dual signature, account-holder attestation, successor part)
 *    instead of deriving all legs from the resolution chain's success;
 *  - the successor of a superseded namespace is not carried by the Phase-3
 *    claim, so it is surfaced as null until the directory provides it.
 */

import type { WrCodeReference } from '@repo/ingestion-core'
import {
  claimantIdOf,
  type WrCodeEntryMaterial,
  type WrCodeEntryVerdict,
  type WrCodeGateDeps,
  type WrCodeNamespaceVerdict,
} from './gatePipeline'
import type { WrcResolutionClient } from './resolutionClient'
import type { WrcUseLimitStore } from './useLimitStore'

export interface WrcGateAdapterOptions {
  /**
   * §XVI.8.4 one-time-use state. Absent (Phase-3 default) means no entry is
   * known to be use-limited — the unbounded default. When present, Gate 3
   * reads the posture from it and Gate 5 runs the atomic compare-and-set
   * claim against it.
   */
  useLimits?: WrcUseLimitStore
  /** Unix seconds; injected for deterministic claim-timeout tests. */
  now?: () => number
}

/** The third address block designates the entry (P: local; others per class). */
function entryIdOf(reference: WrCodeReference): string | null {
  return reference.local ?? reference.combination ?? reference.counterparty ?? null
}

/**
 * Deps for {@link runWrCodeGatePipeline} over the Phase-3 resolution client.
 *
 * Live resolution by construction: every gate run re-executes the full
 * verification chain rather than trusting a cached verdict, which is also
 * what §XVI.8.4 (`require_live_resolution`, forced for use-limited entries)
 * demands.
 */
export function createWrcGateDeps(
  client: WrcResolutionClient,
  options: WrcGateAdapterOptions = {},
): WrCodeGateDeps {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    async verifyNamespace(publisherPart): Promise<WrCodeNamespaceVerdict> {
      const res = await client.resolvePublisher(publisherPart)
      if (!res.ok) {
        // §XVI.4.2 uniform 404 stays a capture error; every other failure is
        // an unverified namespace with the client's precise leg in `detail`.
        if (res.reason === 'unknown_identifier') {
          return { ok: false, reason: 'namespace_unknown_identifier' }
        }
        return {
          ok: false,
          reason: 'namespace_unverified',
          detail: res.detail ? `${res.reason}: ${res.detail}` : res.reason,
        }
      }
      return {
        ok: true,
        record: {
          publisher_part: res.publisherPart,
          domain: res.domain,
          status: res.status,
          // Interim mapping: the chain that just succeeded IS the dual
          // provenance (DNS-pinned publisher root + ingest countersign) and
          // the DNS proof. Account-holder attestation has no separate interim
          // source — chain success stands in for it, fail-closed overall.
          // TODO(§XVI.6.4/6.5): read these legs from the Directory Record.
          dual_signature_verified: true,
          dns_verified: true,
          account_holder_verified: true,
          successor_publisher_part: null,
        },
      }
    },

    async verifyEntry(reference, _namespaces): Promise<WrCodeEntryVerdict> {
      // Interim resolver reach: P entries only — the local block designates
      // the entry directly. C is designated by the ordered pair and I / sub-
      // handshake classes by combination expansion (§XVI.5.10), neither of
      // which the Phase-3 registry exposes yet. Fail closed, precisely.
      // TODO(§XVI.5.10): ordered-pair and combination-code entry designation.
      if (reference.cls !== 'P' || !reference.local) {
        return {
          ok: false,
          reason: 'entry_verification_unavailable',
          detail: `class ${reference.cls} entry designation is not resolvable by the interim anchor`,
        }
      }

      // `allowSuspended` here is NOT an admission bypass: it makes the client
      // return suspended/retired material as data instead of a flattened
      // refusal, and the pipeline's Gate 3 evaluates that state fail-closed
      // with the precise reason the status surface needs.
      const res = await client.resolvePublisher(reference.publisher, {
        entryId: reference.local,
        allowSuspended: true,
      })
      if (!res.ok) {
        if (res.reason === 'unknown_identifier') {
          return { ok: false, reason: 'entry_unknown' }
        }
        return {
          ok: false,
          reason: 'entry_unverified',
          detail: res.detail ? `${res.reason}: ${res.detail}` : res.reason,
        }
      }
      if (!res.entry) {
        return { ok: false, reason: 'entry_unverified', detail: 'resolution returned no entry object' }
      }

      const material: WrCodeEntryMaterial = {
        entry_id: res.entry.entry_id,
        catalog_status: res.entry.status,
        suspension: res.suspension ?? null,
        // Interim entries are offerings; C-class invitations arrive with the
        // ordered-pair designation above.
        kind: 'offering',
        // The Phase-3 resolver declares no §XVI.8.1 lifecycle of its own; the
        // catalog status and the use-limit posture carry the state.
        lifecycle: null,
        // Phase-3 entries carry no recipient binding: public offerings.
        // TODO(§XVI.7.6 Gate 4): read the issuer-bound recipient granularity.
        recipient_binding: null,
        use_limit: options.useLimits?.posture(reference.publisher, reference.local, now()) ?? null,
        successor_entry_id: null,
        entry: res.entry,
        evp: res.evp ?? null,
      }
      return { ok: true, material }
    },

    async releaseMaterial({ reference, material, receiver, requestInstanceId }) {
      // Interim release: there is no Relay in Phase 3. For a public offering
      // the pre-consent material was verified at Gate 3; "release" hands it
      // over. Recipient-bound capsule release (signed claim, delegation with
      // accept scope, rate/replay limits) attaches here.
      // TODO(§XVI.7.6 Gate 5): relay-backed recipient-bound release.
      if (!material.evp) {
        return {
          ok: false,
          reason: 'release_refused',
          detail: 'no verified pre-consent material to release',
        }
      }

      // §XVI.8.4 — successful passage through Gate 5 by an identified party
      // moves a use-limited entry atomically, by compare-and-set, to CLAIMED
      // for that party; a concurrent claimant receives CLAIMED_BY_OTHER and
      // no material.
      const entryId = entryIdOf(reference)
      if (options.useLimits && entryId && options.useLimits.read(reference.publisher, entryId)) {
        const party = claimantIdOf(receiver)
        if (!party) {
          return {
            ok: false,
            reason: 'claim_failed',
            detail: 'a use-limited entry requires an identified party to claim',
          }
        }
        const claim = options.useLimits.claim(
          reference.publisher,
          entryId,
          party,
          requestInstanceId,
          now(),
        )
        if (!claim.ok) {
          if (claim.reason === 'not_declared') {
            return { ok: false, reason: 'claim_failed', detail: 'claim store lost the declaration' }
          }
          return {
            ok: false,
            reason: claim.reason,
            detail: claim.reason === 'CLAIMED_BY_OTHER' ? (claim.claimedBy ?? undefined) : undefined,
          }
        }
      }
      return { ok: true, released: { evp: material.evp } }
    },

    async admitCapsule() {
      // The pipeline already ran the non-delegable P15 link scan. Capsule-
      // level admission (initiator signature, nonce_I, party bindings,
      // request_instance_id replay) needs the BEAP capsule chain, which does
      // not flow through this path yet.
      // TODO(§XVI.7.6 Gate 6): attach capsule verification when the capsule
      // path lands; wire request_instance_id to the Handshake State Index.
      return { ok: true }
    },

    releaseClaim({ reference, receiver }) {
      // Post-claim gate failure: the reservation reverts to ACTIVE — a failed
      // verification never consumes a use (§XVI.8.4). The claim timeout is
      // the backstop if this process dies before reverting.
      const entryId = entryIdOf(reference)
      const party = claimantIdOf(receiver)
      if (options.useLimits && entryId && party) {
        options.useLimits.release(reference.publisher, entryId, party)
      }
    },
  }
}
