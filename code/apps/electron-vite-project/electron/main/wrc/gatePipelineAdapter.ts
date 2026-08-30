/**
 * Gate deps — §XVI.7.6 gates 2/3/5/6 over the Namespace Directory (Run 4)
 * and the Phase-3 resolution client.
 *
 * Run 4 (§XVI.6.4/6.5): Gate 2 verifies against the NAMESPACE DIRECTORY —
 * the operator-signed, publisher-countersigned Directory Record under the
 * pinned operator trust anchor, with the DNS proof naming the Publisher
 * Identifier, the vetted-account-holder attestation, generation and expiry
 * checks — via {@link WrcDirectoryClient}. The Run-2 interim anchor (deriving
 * Gate-2 legs from the Phase-3 chain's success) is GONE; without a directory
 * the gate refuses. There is no silent fallback to the registry trust path.
 *
 * The Phase-3 chain remains what it always was normatively: the PUBLISHER
 * RESOLVER leg behind Gate 3 (§XVI.6.5 "entry context, assignment, and
 * version"). Its signing root must itself be a directory-registered key
 * (§XVI.6.5 publisher key binding) — cross-checked here, so an entry chain
 * anchored on a key the directory does not register refuses.
 *
 * Run 3 — entry designation (§XVI.5.10): the class determines the resolver
 * lookup key (local block for P, responder identifier for the C ordered pair,
 * the combination block for I and every sub-handshake class), and the
 * resolver's answer carries a publisher-signed `designation` claim — the
 * registered pair, or the EXPANSION of the combination code into its entry
 * and receiving-party constituents plus the parent binding. This adapter
 * verifies the network legs (the entry chain itself, the governing parent's
 * existence and state, the responder namespace of an SC pair); the CANONICAL
 * designator is derived inside the pipeline from the same claim, so no deps
 * implementation and no caller can substitute identity.
 */

import type { WrCodeReference } from '@repo/ingestion-core'
import {
  claimantIdOf,
  type WrCodeEntryMaterial,
  type WrCodeEntryVerdict,
  type WrCodeGateDeps,
  type WrCodeNamespaceVerdict,
  type WrCodeReceiverIdentity,
} from './gatePipeline'
import {
  deriveEntryDesignator,
  useLimitEntryKey,
  type WrCodeDesignationClaim,
} from './entryDesignator'
import { WrcDirectoryClient, type WrcDirectoryRecord } from './namespaceDirectory'
import type { WrcResolutionClient } from './resolutionClient'
import type { WrcEntryDesignation } from './wrcContract'
import type { WrcUseLimitStore } from './useLimitStore'

export interface WrcGateAdapterOptions {
  /**
   * §XVI.8.4 one-time-use state. Absent (Phase-3 default) means no entry is
   * known to be use-limited — the unbounded default. When present, Gate 3
   * reads the posture from it and Gate 5 runs the atomic compare-and-set
   * claim against it — both keyed by the canonical designator.
   */
  useLimits?: WrcUseLimitStore
  /** Unix seconds; injected for deterministic claim-timeout tests. */
  now?: () => number
  /**
   * §XVI.6.4/6.5 Namespace Directory (Run 4) — REQUIRED for Gate 2 to pass.
   * Absent means this deployment has no directory trust anchor, and namespace
   * verification fails closed with `directory_not_configured`. No fallback.
   */
  directory?: WrcDirectoryClient
}

/**
 * §XVI.5.10 — the resolver lookup key per class: the local block designates a
 * P entry directly; a C umbrella is looked up by its ordered pair (initiator
 * namespace + responder id); I and sub-handshake classes are looked up by the
 * combination block, which the resolver alone expands.
 */
function lookupKeyOf(reference: WrCodeReference): string | null {
  if (reference.cls === 'P') return reference.local
  if (reference.cls === 'C') return reference.counterparty
  return reference.combination
}

/** Wire designation → derivation claim (shapes align; typed hand-off only). */
function claimOf(designation: WrcEntryDesignation | null): WrCodeDesignationClaim | null {
  return designation
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
  const directory = options.directory ?? null

  /** Verified Directory Record lookup, shared by gates 2/3/6 legs. */
  const verifiedDirectoryRecord = async (
    part: string,
  ): Promise<
    | { ok: true; record: WrcDirectoryRecord }
    | { ok: false; reason: 'namespace_unknown_identifier' | 'namespace_unverified'; detail?: string }
  > => {
    if (!directory) {
      return {
        ok: false,
        reason: 'namespace_unverified',
        detail: 'directory_not_configured: no namespace directory trust anchor',
      }
    }
    const res = await directory.getVerifiedRecord(part)
    if (!res.ok) {
      if (res.reason === 'unknown_identifier') {
        return { ok: false, reason: 'namespace_unknown_identifier' }
      }
      return {
        ok: false,
        reason: 'namespace_unverified',
        detail: res.detail ? `${res.leg}: ${res.detail}` : res.leg,
      }
    }
    return { ok: true, record: res.record }
  }

  return {
    async verifyNamespace(publisherPart): Promise<WrCodeNamespaceVerdict> {
      // Run 4 (§XVI.6.4/6.5): the Namespace Directory is the ONLY Gate-2
      // trust path — dual signature, vetting, generation, expiry, DNS part
      // proof all verified by the directory client, fail-closed.
      const res = await verifiedDirectoryRecord(publisherPart)
      if (!res.ok) return res
      const record = res.record
      return {
        ok: true,
        record: {
          publisher_part: record.publisher_part,
          domain: record.domains[0]!,
          status: record.status,
          // These legs were POSITIVELY verified by the directory client; a
          // record that failed any of them never reaches this mapping.
          dual_signature_verified: true,
          dns_verified: true,
          account_holder_verified: record.account_holder_vetted,
          successor_publisher_part: record.successor_publisher_part,
        },
      }
    },

    async verifyActingPrincipal(
      receiver: WrCodeReceiverIdentity,
    ): Promise<{ ok: true } | { ok: false; detail?: string }> {
      // §XVI.7.6 Gate 2 / §XVI.6.5 email-domain agreement: the receiver's own
      // acting principal's SSO-verified email must lie in its own publisher's
      // DNS-verified domain — otherwise it cannot claim on the publisher's
      // behalf. Domains beyond the primary are operator-signed registrations
      // in the record, each carrying its own DNS proof upstream.
      if (!receiver.publisher_part || !receiver.sso_email) {
        return { ok: false, detail: 'acting principal without publisher part or SSO email' }
      }
      const at = receiver.sso_email.lastIndexOf('@')
      const emailDomain = at > 0 ? receiver.sso_email.slice(at + 1).toLowerCase() : ''
      if (!emailDomain) return { ok: false, detail: 'SSO email carries no domain' }
      const res = await verifiedDirectoryRecord(receiver.publisher_part)
      if (!res.ok) {
        return { ok: false, detail: `own publisher namespace unverified: ${res.detail ?? res.reason}` }
      }
      const registered = res.record.domains.map((d) => d.toLowerCase())
      return registered.includes(emailDomain)
        ? { ok: true }
        : {
            ok: false,
            detail: `SSO email domain ${emailDomain} is not among the publisher's DNS-verified domains`,
          }
    },

    async verifyEntry(reference, _namespaces): Promise<WrCodeEntryVerdict> {
      const lookupKey = lookupKeyOf(reference)
      if (!lookupKey) {
        return {
          ok: false,
          reason: 'entry_unverified',
          detail: `class ${reference.cls} reference carries no entry-designating block`,
        }
      }

      // `allowSuspended` here is NOT an admission bypass: it makes the client
      // return suspended/retired material as data instead of a flattened
      // refusal, and the pipeline's Gate 3 evaluates that state fail-closed
      // with the precise reason the status surface needs.
      const res = await client.resolvePublisher(reference.publisher, {
        entryId: lookupKey,
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

      // §XVI.6.5 publisher key binding (Run 4): the resolver chain's signing
      // root must itself be a directory-registered key. An entry chain that
      // verifies against a key the directory does not register is an invalid
      // signature by definition, not an alternative trust path.
      const dir = await verifiedDirectoryRecord(reference.publisher)
      if (!dir.ok) {
        return {
          ok: false,
          reason: 'entry_unverified',
          detail: `directory re-check failed: ${dir.detail ?? dir.reason}`,
        }
      }
      const registered = WrcDirectoryClient.keyFingerprints(dir.record)
      if (!registered.has(res.record.root_fingerprint.toLowerCase())) {
        return {
          ok: false,
          reason: 'entry_unverified',
          detail: 'resolver signing root is not a directory-registered publisher key',
        }
      }

      const designation = claimOf(res.entry.designation)

      // §XVI.5.10 network legs — only when the claim already derives cleanly;
      // a malformed claim refuses in the PIPELINE with the precise derivation
      // reason, so no fetch races a structural refusal.
      const derived = deriveEntryDesignator(reference, designation, res.entry.entry_id)
      if (derived.ok && derived.designator.parent) {
        const parent = derived.designator.parent

        if (parent.cls === 'C' && parent.counterparty_part) {
          // "an ESTABLISHED C relationship whose two namespaces have
          // themselves passed account-holder and DNS verification" — the
          // responder is not in the reference, so Gate 2 could not have seen
          // it; verify its namespace here, at the expanded form.
          const responder = await client.resolvePublisher(parent.counterparty_part)
          if (!responder.ok || responder.status !== 'active') {
            return {
              ok: false,
              reason: 'unresolved_parent',
              detail: `responder namespace ${parent.counterparty_part}: ${responder.ok ? responder.status : responder.reason}`,
            }
          }
        }

        // The entry constituent must bind "under a currently governing
        // parent". The parent entry's lookup key: the responder id for a C
        // umbrella, else the repository id the resolver named.
        const parentLookup =
          parent.cls === 'C'
            ? parent.counterparty_part
            : (res.entry.designation?.parent?.entry_id ?? null)
        if (parent.cls === 'C' || parentLookup) {
          const parentRes = await client.resolvePublisher(parent.publisher_part, {
            entryId: parentLookup!,
            allowSuspended: true,
          })
          if (!parentRes.ok || !parentRes.entry) {
            return {
              ok: false,
              reason: 'unresolved_parent',
              detail: `parent ${parent.cls} entry: ${parentRes.ok ? 'no entry object' : parentRes.reason}`,
            }
          }
          if (parentRes.entry.status !== 'published' || parentRes.suspension) {
            return {
              ok: false,
              reason: 'unresolved_parent',
              detail: `parent ${parent.cls} entry is not in a governing state (${
                parentRes.suspension ? 'platform_suspended' : parentRes.entry.status
              })`,
            }
          }
        }
        // A parent without a named entry (SP/SI/SE structural binding to the
        // namespace itself) was verified at Gate 2: the namespace IS block 2.
      }

      const material: WrCodeEntryMaterial = {
        entry_id: res.entry.entry_id,
        catalog_status: res.entry.status,
        suspension: res.suspension ?? null,
        // A C umbrella in PENDING is an invitation; everything else the
        // interim registry serves is an offering.
        kind: 'offering',
        // The Phase-3 resolver declares no §XVI.8.1 lifecycle of its own; the
        // catalog status and the use-limit posture carry the state.
        lifecycle: null,
        // Phase-3 entries carry no recipient binding: public offerings.
        // I/S* receiving-party binding rides on the designation and is
        // matched at Gate 4 from the canonical designator.
        recipient_binding: null,
        // Posture is read by the PIPELINE via `useLimitPosture`, keyed by the
        // canonical designator — never precomputed here.
        use_limit: null,
        successor_entry_id: null,
        designation,
        entry: res.entry,
        evp: res.evp ?? null,
      }
      return { ok: true, material }
    },

    useLimitPosture(designator) {
      if (!options.useLimits) return null
      return options.useLimits.posture(
        designator.publisher_part,
        useLimitEntryKey(designator),
        now(),
      )
    },

    async releaseMaterial({ material, designator, receiver, requestInstanceId }) {
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
      // no material. Keyed by the canonical designator the PIPELINE derived.
      const entryKey = useLimitEntryKey(designator)
      if (options.useLimits && options.useLimits.read(designator.publisher_part, entryKey)) {
        const party = claimantIdOf(receiver)
        if (!party) {
          return {
            ok: false,
            reason: 'claim_failed',
            detail: 'a use-limited entry requires an identified party to claim',
          }
        }
        const claim = options.useLimits.claim(
          designator.publisher_part,
          entryKey,
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

    releaseClaim({ designator, receiver }) {
      // Post-claim gate failure: the reservation reverts to ACTIVE — a failed
      // verification never consumes a use (§XVI.8.4). The claim timeout is
      // the backstop if this process dies before reverting.
      const party = claimantIdOf(receiver)
      if (options.useLimits && party) {
        options.useLimits.release(designator.publisher_part, useLimitEntryKey(designator), party)
      }
    },
  }
}
