/**
 * Independent dual-channel domain validation (3B.2 / 3B.3).
 *
 * P3, restated so it cannot be diluted by a later refactor: the registry answer
 * is a CLAIM. Nothing the registry says about a publisher becomes trusted until
 * two channels the registry does not control agree with it:
 *
 *   1. DNS  — a TXT record at `_wr.<domain>` carrying the root key fingerprint.
 *   2. HTTPS — `https://<domain>/.well-known/wr/manifest`, Ed25519 self-signed
 *              by the root key the DNS record pins.
 *
 * And then a third check that is a CROSS-CHECK, not a source: the manifest's
 * declared `publisher_part` must equal the part we resolved. A mismatch is an
 * alarm (§XVI.11.3 pattern), never a quiet fallback to whichever value looks
 * more plausible.
 *
 * The registry's `root_fingerprint` is compared too, but it is never allowed to
 * *establish* anything: if DNS and the manifest agree with each other and the
 * registry disagrees, that is a registry divergence and it fails closed. The
 * ordering below is deliberate — DNS first, manifest second, registry last —
 * so no code path can reach a trust conclusion having consulted only the
 * registry.
 */

import { createHash } from 'node:crypto'
import { decodePublisherManifest, type WrcPublisherManifest } from './wrcContract'
import { wrcVerifyObjectSignature } from './wrcCrypto'
import type { WrcTransport } from './wrcTransport'

export type DualChannelReason =
  /** No `_wr` TXT record, or DNS itself failed. Cannot anchor anything. */
  | 'dns_unavailable'
  /** TXT present but no parsable `v=wr1; root=<fingerprint>` pair. */
  | 'dns_record_malformed'
  /** The manifest could not be fetched over the hardened client. */
  | 'manifest_unavailable'
  /** Manifest body was not a well-formed `wr/manifest`. */
  | 'manifest_malformed'
  /** Manifest is not self-signed by the key it declares. */
  | 'manifest_signature_invalid'
  /** The manifest's root key does not match the fingerprint pinned in DNS. */
  | 'dns_manifest_key_mismatch'
  /** The manifest names a different domain than the one we validated. */
  | 'manifest_domain_mismatch'
  /** CROSS-CHECK failure: manifest's publisher part ≠ resolved part. ALARM. */
  | 'manifest_part_mismatch'
  /** Registry's root fingerprint disagrees with the two independent channels. */
  | 'registry_key_divergence'

export interface DualChannelSuccess {
  ok: true
  domain: string
  publisherPart: string
  /** Root key established by DNS + manifest, NOT by the registry. */
  rootKid: string
  rootPub: string
  rootFingerprint: string
  manifest: WrcPublisherManifest
}

export interface DualChannelFailure {
  ok: false
  reason: DualChannelReason
  detail?: string
}

export type DualChannelResult = DualChannelSuccess | DualChannelFailure

/** Hex SHA-256 of the raw public key bytes — the form pinned in DNS. */
export function rootKeyFingerprint(rootPubB64Url: string): string {
  const raw = Buffer.from(rootPubB64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Parse `v=wr1; root=<hex64>` out of the TXT records at `_wr.<domain>`.
 * Multiple records are tolerated (providers split them); the first well-formed
 * `wr1` record wins and any additional ones are ignored rather than merged,
 * because merging attacker-influenced records is how a second key sneaks in.
 */
export function parseWrTxtRecords(records: readonly string[]): { rootFingerprint: string } | null {
  for (const raw of records) {
    const text = raw.trim()
    if (!/(^|;|\s)v=wr1(;|\s|$)/i.test(text)) continue
    const m = text.match(/(?:^|;|\s)root=([0-9a-f]{64})(?:;|\s|$)/i)
    if (m?.[1]) return { rootFingerprint: m[1].toLowerCase() }
  }
  return null
}

export interface ValidateDomainInput {
  transport: WrcTransport
  /** Domain the registry claimed for this part. Treated as a candidate only. */
  claimedDomain: string
  /** The publisher part we resolved. The manifest must agree with it. */
  resolvedPublisherPart: string
  /** The registry's claimed root fingerprint, checked last and never trusted first. */
  claimedRootFingerprint?: string
}

/**
 * Run both channels and the cross-check. Returns the root key material only
 * when every leg agrees.
 */
export async function validateDomainDualChannel(
  input: ValidateDomainInput,
): Promise<DualChannelResult> {
  const domain = input.claimedDomain.trim().toLowerCase()

  // ── Channel 1: DNS ──────────────────────────────────────────────────────────
  const txt = await input.transport.wrTxtRecords(domain)
  if (!txt.ok) return { ok: false, reason: 'dns_unavailable', detail: txt.message }
  const pinned = parseWrTxtRecords(txt.records)
  if (!pinned) return { ok: false, reason: 'dns_record_malformed' }

  // ── Channel 2: publisher-served manifest ────────────────────────────────────
  const manifestRes = await input.transport.publisherManifest(domain)
  if (!manifestRes.ok) {
    return { ok: false, reason: 'manifest_unavailable', detail: manifestRes.message }
  }
  const manifest = decodePublisherManifest(manifestRes.value)
  if (!manifest) return { ok: false, reason: 'manifest_malformed' }

  if (!wrcVerifyObjectSignature(manifest as unknown as Record<string, unknown>, manifest.root_pub)) {
    return { ok: false, reason: 'manifest_signature_invalid' }
  }

  // The two independent channels must agree on the key before anything else.
  const fingerprint = rootKeyFingerprint(manifest.root_pub)
  if (fingerprint !== pinned.rootFingerprint) {
    return {
      ok: false,
      reason: 'dns_manifest_key_mismatch',
      detail: `dns=${pinned.rootFingerprint} manifest=${fingerprint}`,
    }
  }

  if (manifest.domain !== domain) {
    return { ok: false, reason: 'manifest_domain_mismatch', detail: manifest.domain }
  }

  // ── Cross-check (§1.1): declared part vs resolved part. ALARM on mismatch. ──
  if (manifest.publisher_part !== input.resolvedPublisherPart) {
    return {
      ok: false,
      reason: 'manifest_part_mismatch',
      detail: `manifest=${manifest.publisher_part} resolved=${input.resolvedPublisherPart}`,
    }
  }

  // ── Registry consulted LAST, and only to detect divergence ──────────────────
  if (
    input.claimedRootFingerprint &&
    input.claimedRootFingerprint.toLowerCase() !== fingerprint
  ) {
    return {
      ok: false,
      reason: 'registry_key_divergence',
      detail: `registry=${input.claimedRootFingerprint.toLowerCase()} channels=${fingerprint}`,
    }
  }

  return {
    ok: true,
    domain,
    publisherPart: manifest.publisher_part,
    rootKid: manifest.root_kid,
    rootPub: manifest.root_pub,
    rootFingerprint: fingerprint,
    manifest,
  }
}
