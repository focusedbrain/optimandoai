/**
 * 3B — WRC registry resolution client.
 *
 * The one place a WR code becomes (or fails to become) a resolved publisher.
 * It lives in Electron main because MV3 has no DNS, and it is exposed to the
 * extension over the existing loopback RPC rather than being reachable from a
 * renderer directly.
 *
 * The order of operations is the security property, not an implementation
 * detail. Read it top to bottom:
 *
 *   capture (local check only, already done by `captureBaselineCode`)
 *     → registry resolve            ... a CLAIM, trusted for nothing
 *     → dual-channel domain validation (DNS + manifest) + part cross-check
 *     → catalog head verification    ... signature, epoch floor, freshness
 *     → envelope verification        ... publisher sig, countersig, inclusion
 *     → EVP verification             ... budget, part/entry binding
 *
 * There is no branch that reaches a trusted presentation having skipped a
 * step, and every failure returns a distinct typed reason so the Phase-4 status
 * surface never has to guess which leg failed.
 *
 * What this module deliberately does NOT do: build an offer, decide a tier,
 * touch `TierSignals`, or render anything. Resolution answers "who is this and
 * is the material authentic", nothing further.
 */

import {
  decodeEntry,
  decodeEnvelope,
  decodeResolveClaim,
  type WrcEntry,
  type WrcEvp,
  type WrcPublisherStatus,
} from './wrcContract'
import { validateDomainDualChannel, type DualChannelReason } from './dualChannel'
import {
  verifyCatalogHead,
  verifyEnvelope,
  verifyEvp,
  type WrcFreshness,
  type WrcPublisherKeys,
  type WrcVerifyReason,
} from './wrcVerify'
import type { WrcResolvedRecord, WrcResolvedRecordStore } from './resolvedRecordStore'
import type { WrcTransport, WrcTransportErrorCode } from './wrcTransport'

// ── Failure vocabulary ────────────────────────────────────────────────────────

export type WrcResolutionReason =
  /** §4.2 uniform 404 → the Capture-Error path, never the status path. */
  | 'unknown_identifier'
  /** Registry unreachable / refused / malformed. Still only a claim, but we have none. */
  | 'registry_unavailable'
  | 'registry_response_malformed'
  /** The registry named a different part than the one asked for. */
  | 'registry_part_mismatch'
  /** Dual-channel leg failed; see `detail` for which. */
  | DualChannelReason
  /** Verification leg failed. */
  | WrcVerifyReason
  /** Object fetch failed at transport level. */
  | 'object_unavailable'
  | 'object_malformed'
  /** Entry exists but is not published (publisher-signed status). */
  | 'entry_not_published'

export interface WrcResolutionFailure {
  ok: false
  reason: WrcResolutionReason
  detail?: string
  /** True when the failure is a capture-error, not a publisher-status surface. */
  captureError: boolean
}

export interface WrcResolutionSuccess {
  ok: true
  publisherPart: string
  domain: string
  status: WrcPublisherStatus
  generation: number
  freshness: WrcFreshness
  stale_by_s: number
  epoch: number
  record: WrcResolvedRecord
  /** Present when an entry was requested and verified. */
  entry?: WrcEntry
  /** Present when the entry's EVP was fetched and verified (3F). */
  evp?: WrcEvp
  /** A5 — platform suspension is its own visible state, never silent absence. */
  suspension?: { since: number; reason_code: string; reversible: boolean }
}

export type WrcResolutionResult = WrcResolutionSuccess | WrcResolutionFailure

function fail(
  reason: WrcResolutionReason,
  detail?: string,
  captureError = false,
): WrcResolutionFailure {
  return { ok: false, reason, detail, captureError }
}

export interface WrcResolutionClientDeps {
  transport: WrcTransport
  store: WrcResolvedRecordStore
  /** Raw base64url Ed25519 public key of the WRC ingest countersigner. */
  ingestPublicKey: string
  /** Unix seconds. Injected for deterministic freshness tests. */
  now?: () => number
}

export interface ResolvePublisherOptions {
  /** Also fetch + verify this entry and its EVP. */
  entryId?: string
  /**
   * Return a suspended object as a visible state instead of refusing. Only the
   * audit / status surface sets this; admission paths never do.
   */
  allowSuspended?: boolean
}

export class WrcResolutionClient {
  private readonly now: () => number

  constructor(private readonly deps: WrcResolutionClientDeps) {
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  }

  /**
   * Resolve a publisher part, optionally an entry beneath it, running the full
   * chain. Never throws.
   */
  async resolvePublisher(
    publisherPart: string,
    options: ResolvePublisherOptions = {},
  ): Promise<WrcResolutionResult> {
    const part = publisherPart.trim()

    // ── 1. Registry answer — a CLAIM ─────────────────────────────────────────
    const claimRes = await this.deps.transport.resolve(part)
    if (!claimRes.ok) {
      if (claimRes.status === 404) return fail('unknown_identifier', undefined, true)
      return fail('registry_unavailable', `${claimRes.code}: ${claimRes.message}`)
    }
    const claim = decodeResolveClaim(claimRes.value)
    if (!claim) return fail('registry_response_malformed')
    if (claim.catalog_head.publisher_part !== part) {
      return fail('registry_part_mismatch', claim.catalog_head.publisher_part)
    }

    // ── 2. Dual-channel validation BEFORE anything is trusted ────────────────
    const channels = await validateDomainDualChannel({
      transport: this.deps.transport,
      claimedDomain: claim.domain,
      resolvedPublisherPart: part,
      claimedRootFingerprint: claim.root_fingerprint,
    })
    if (!channels.ok) return fail(channels.reason, channels.detail)

    // ── 3. Catalog head: signature, epoch floor, freshness ───────────────────
    const keys: WrcPublisherKeys = {
      rootKid: channels.rootKid,
      rootPub: channels.rootPub,
      delegations: this.deps.store.get(part)?.delegations ?? [],
    }
    const headVerdict = verifyCatalogHead({
      head: claim.catalog_head,
      keys,
      expectedPublisherPart: part,
      expectedDomain: channels.domain,
      lastSeenEpoch: this.deps.store.lastSeenEpoch(part),
      nowS: this.now(),
    })
    if (!headVerdict.ok) return fail(headVerdict.reason, headVerdict.detail)
    const { head, freshness, stale_by_s } = headVerdict.value

    // The floor rises only once the head is fully verified.
    this.deps.store.noteAcceptedEpoch(part, head.epoch)

    const record: WrcResolvedRecord = {
      publisher_part: part,
      domain: channels.domain,
      status: claim.status,
      generation: claim.generation,
      root_kid: channels.rootKid,
      root_pub: channels.rootPub,
      root_fingerprint: channels.rootFingerprint,
      last_seen_epoch: head.epoch,
      catalog_root: head.catalog_root,
      head_issued_at: head.issued_at,
      freshness_window_s: head.freshness_window_s,
      delegation_kid: head.kid === channels.rootKid ? null : head.kid,
      cache_state:
        claim.status === 'active' ? (freshness === 'stale' ? 'stale' : 'validated') : 'demoted',
      resolved_at: this.now(),
      delegations: this.deps.store.get(part)?.delegations ?? [],
    }
    this.deps.store.upsert(record)

    const base: WrcResolutionSuccess = {
      ok: true,
      publisherPart: part,
      domain: channels.domain,
      status: claim.status,
      generation: claim.generation,
      freshness,
      stale_by_s,
      epoch: head.epoch,
      record,
    }

    if (!options.entryId) return base

    // ── 4. Entry envelope: publisher sig + countersig + inclusion ────────────
    const entryRes = await this.deps.transport.entry(part, options.entryId)
    if (!entryRes.ok) {
      if (entryRes.status === 404) return fail('unknown_identifier', undefined, true)
      return fail('object_unavailable', `${entryRes.code}: ${entryRes.message}`)
    }
    const entryEnvelope = decodeEnvelope(entryRes.value)
    if (!entryEnvelope) return fail('object_malformed', 'entry envelope')

    const entryVerdict = verifyEnvelope({
      envelope: entryEnvelope,
      keys,
      verifiedHead: head,
      ingestPub: this.deps.ingestPublicKey,
      allowSuspended: options.allowSuspended === true,
    })
    if (!entryVerdict.ok) return fail(entryVerdict.reason, entryVerdict.detail)

    const entry = decodeEntry(entryVerdict.value.envelope.object)
    if (!entry) return fail('object_malformed', 'entry')
    if (entry.publisher_part !== part) return fail('evp_part_mismatch', entry.publisher_part)
    if (entry.status !== 'published' && !options.allowSuspended) {
      return fail('entry_not_published', entry.status)
    }

    const suspension = entryVerdict.value.envelope.suspension ?? undefined

    // ── 5. EVP: fetch by ref, verify envelope, then budget + binding ─────────
    const evpRes = await this.deps.transport.object(entry.evp_ref)
    if (!evpRes.ok) {
      if (evpRes.status === 404) return fail('unknown_identifier', undefined, true)
      return fail('object_unavailable', `${evpRes.code}: ${evpRes.message}`)
    }
    const evpEnvelope = decodeEnvelope(evpRes.value)
    if (!evpEnvelope) return fail('object_malformed', 'evp envelope')

    const evpEnvVerdict = verifyEnvelope({
      envelope: evpEnvelope,
      keys,
      verifiedHead: head,
      ingestPub: this.deps.ingestPublicKey,
      allowSuspended: options.allowSuspended === true,
    })
    if (!evpEnvVerdict.ok) return fail(evpEnvVerdict.reason, evpEnvVerdict.detail)

    // The envelope's own hash is what `evp_ref` pointed at — bind them.
    if (evpEnvelope.hash !== entry.evp_ref) {
      return fail('envelope_object_hash_mismatch', `evp_ref=${entry.evp_ref}`)
    }

    const evpVerdict = verifyEvp({
      object: evpEnvVerdict.value.envelope.object,
      expectedPublisherPart: part,
      expectedEntryId: entry.entry_id,
    })
    if (!evpVerdict.ok) return fail(evpVerdict.reason, evpVerdict.detail)

    return { ...base, entry, evp: evpVerdict.value, suspension }
  }
}

/** Transport-level codes that mean "we never got an answer", for callers that log. */
export function isTransportOutage(code: WrcTransportErrorCode): boolean {
  return (
    code === 'network_error' ||
    code === 'timeout' ||
    code === 'dns_error' ||
    code === 'not_configured'
  )
}
