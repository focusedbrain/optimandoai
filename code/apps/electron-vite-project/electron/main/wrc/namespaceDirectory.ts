/**
 * §XVI.6.4/6.5 Namespace Directory — the Gate-2 trust path (Run 4).
 *
 * This replaces the Run-2 interim anchor. Trust layering, exactly as the
 * annex states it:
 *
 *   - The directory operator's public key is THE trust anchor of the
 *     reference layer: pinned, distributed with the runtime. Key rollover
 *     only via a rollover record signed by BOTH the outgoing and incoming
 *     operator keys, verified before any record signed by the new key is
 *     accepted (§XVI.6.4).
 *   - Every Namespace Directory Record is signed by the operator and
 *     COUNTERSIGNED by the publisher, so neither party alone can alter an
 *     active record. Initial registration is an out-of-band, operator-vetted
 *     act; the record carries the vetting attestation.
 *   - Every change increments the record generation; a cached record whose
 *     generation no longer matches is invalid immediately, regardless of
 *     remaining expiry. Expiry is an upper bound on cache life, never a
 *     promise of validity. This client keeps a monotonic generation floor
 *     per part (the epoch-floor discipline) and refuses regressions.
 *   - Account holder + domain control (§XVI.6.5): verified only when BOTH
 *     hold — the operator-signed vetting attestation AND a valid DNS entry
 *     under the publisher's own domain NAMING that Publisher Identifier.
 *     Either alone is insufficient. DNS is re-checked on every resolution.
 *
 * Signature layering (versioned with the record `type`):
 *   operator_sig          over canonical(record − operator_sig − publisher_countersig)
 *   publisher_countersig  over canonical(record − publisher_countersig)
 * so the countersignature endorses the operator-signed content, and neither
 * signature can be transplanted onto altered fields.
 *
 * Fail-closed everywhere: any leg that cannot be POSITIVELY verified is a
 * refusal with a precise, machine-readable leg code.
 */

import { createHash } from 'node:crypto'
import { wrcCanonicalBytes, wrcVerifyEd25519 } from './wrcCrypto'
import type { WrcPublisherStatus } from './wrcContract'
import type { WrcTransport } from './wrcTransport'

// ── Wire shapes ───────────────────────────────────────────────────────────────

export interface WrcDirectoryKey {
  kid: string
  /** Raw 32-byte Ed25519 public key, base64url unpadded. */
  pub: string
  /** Key generation (§XVI.6.4 "verification key(s) and key generation"). */
  generation: number
}

export interface WrcDirectoryRecord {
  type: 'wrc/directory-record'
  publisher_part: string
  /** Current publisher verification key(s). */
  keys: WrcDirectoryKey[]
  /**
   * Raw 32-byte X25519 public key for recipient-bound sealing (§XVI.7.5.2:
   * "nonce_I encrypted to the responder publisher's directory-registered
   * encryption key"). Null when the publisher registered none.
   */
  encryption_pub: string | null
  resolver_endpoints: string[]
  /** Relay endpoints for capsule and acceptance delivery (§XVI.6.4). */
  relay_endpoints: string[]
  grammar_version: string
  /** Bound origin(s)/domain(s); index 0 is the primary DNS-proved domain. */
  domains: string[]
  display_origin: string | null
  /** §XVI.6.4 operator-vetted account holder attestation. */
  account_holder_vetted: boolean
  status: WrcPublisherStatus
  successor_publisher_part: string | null
  generation: number
  /** Unix seconds. Upper bound on cache life (§XVI.6.4). */
  expires_at: number
  operator_kid: string
  operator_sig: string
  publisher_kid: string
  publisher_countersig: string
}

/** §XVI.6.4 operator key rollover: dual-signed by outgoing AND incoming keys. */
export interface WrcOperatorRollover {
  type: 'wrc/operator-rollover'
  outgoing_kid: string
  incoming_kid: string
  incoming_pub: string
  sig_outgoing: string
  sig_incoming: string
}

/** The pinned trust anchor distributed with the runtime. */
export interface WrcOperatorAnchor {
  kid: string
  pub: string
}

// ── Decoders (fail-closed) ────────────────────────────────────────────────────

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

const PUBLISHER_STATUSES: readonly WrcPublisherStatus[] = [
  'active',
  'inactive',
  'revoked',
  'superseded',
  'compromised',
]

export function decodeDirectoryRecord(value: unknown): WrcDirectoryRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  if (o.type !== 'wrc/directory-record') return null
  if (!isStr(o.publisher_part)) return null
  if (!Array.isArray(o.keys) || o.keys.length === 0) return null
  const keys: WrcDirectoryKey[] = []
  for (const k of o.keys) {
    if (typeof k !== 'object' || k === null) return null
    const kk = k as Record<string, unknown>
    if (!isStr(kk.kid) || !isStr(kk.pub) || !isInt(kk.generation)) return null
    keys.push({ kid: kk.kid, pub: kk.pub, generation: kk.generation })
  }
  if (o.encryption_pub !== null && !isStr(o.encryption_pub)) return null
  for (const arr of [o.resolver_endpoints, o.relay_endpoints, o.domains]) {
    if (!Array.isArray(arr) || arr.some((d) => !isStr(d))) return null
  }
  if ((o.domains as unknown[]).length === 0) return null
  if (!isStr(o.grammar_version)) return null
  if (o.display_origin !== null && !isStr(o.display_origin)) return null
  if (typeof o.account_holder_vetted !== 'boolean') return null
  if (!PUBLISHER_STATUSES.includes(o.status as WrcPublisherStatus)) return null
  if (o.successor_publisher_part !== null && !isStr(o.successor_publisher_part)) return null
  if (!isInt(o.generation) || o.generation < 1) return null
  if (!isInt(o.expires_at)) return null
  if (!isStr(o.operator_kid) || !isStr(o.operator_sig)) return null
  if (!isStr(o.publisher_kid) || !isStr(o.publisher_countersig)) return null
  return {
    type: 'wrc/directory-record',
    publisher_part: o.publisher_part,
    keys,
    encryption_pub: (o.encryption_pub as string | null) ?? null,
    resolver_endpoints: o.resolver_endpoints as string[],
    relay_endpoints: o.relay_endpoints as string[],
    grammar_version: o.grammar_version,
    domains: o.domains as string[],
    display_origin: (o.display_origin as string | null) ?? null,
    account_holder_vetted: o.account_holder_vetted,
    status: o.status as WrcPublisherStatus,
    successor_publisher_part: (o.successor_publisher_part as string | null) ?? null,
    generation: o.generation,
    expires_at: o.expires_at,
    operator_kid: o.operator_kid,
    operator_sig: o.operator_sig,
    publisher_kid: o.publisher_kid,
    publisher_countersig: o.publisher_countersig,
  }
}

export function decodeOperatorRollover(value: unknown): WrcOperatorRollover | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  if (o.type !== 'wrc/operator-rollover') return null
  if (!isStr(o.outgoing_kid) || !isStr(o.incoming_kid) || !isStr(o.incoming_pub)) return null
  if (!isStr(o.sig_outgoing) || !isStr(o.sig_incoming)) return null
  return {
    type: 'wrc/operator-rollover',
    outgoing_kid: o.outgoing_kid,
    incoming_kid: o.incoming_kid,
    incoming_pub: o.incoming_pub,
    sig_outgoing: o.sig_outgoing,
    sig_incoming: o.sig_incoming,
  }
}

// ── Operator key resolution (pinned anchor + verified rollovers) ──────────────

/**
 * Fold the rollover chain onto the pinned anchor. Each rollover must be
 * signed by BOTH the currently trusted (outgoing) key and the incoming key;
 * anything else terminates the fold — later rollovers are NOT considered,
 * because they would chain through an unverified link.
 */
export function resolveOperatorKeys(
  pinned: WrcOperatorAnchor,
  rollovers: readonly WrcOperatorRollover[] = [],
): Map<string, string> {
  const trusted = new Map<string, string>([[pinned.kid, pinned.pub]])
  let currentKid = pinned.kid
  let currentPub = pinned.pub
  for (const r of rollovers) {
    if (r.outgoing_kid !== currentKid) break
    const { sig_outgoing: _o, sig_incoming: _i, ...unsigned } = r as unknown as Record<
      string,
      unknown
    >
    let bytes: Buffer
    try {
      bytes = wrcCanonicalBytes(unsigned)
    } catch {
      break
    }
    if (!wrcVerifyEd25519(bytes, r.sig_outgoing, currentPub)) break
    if (!wrcVerifyEd25519(bytes, r.sig_incoming, r.incoming_pub)) break
    trusted.set(r.incoming_kid, r.incoming_pub)
    currentKid = r.incoming_kid
    currentPub = r.incoming_pub
  }
  return trusted
}

// ── Record verification ───────────────────────────────────────────────────────

/** Enumerated failure legs — deterministic, machine-readable (Run-4 rule). */
export type WrcDirectoryLeg =
  | 'record_malformed'
  | 'operator_key_unknown'
  | 'operator_sig_invalid'
  | 'publisher_countersig_invalid'
  | 'part_mismatch'
  | 'record_expired'
  | 'generation_stale'
  | 'account_not_vetted'
  | 'dns_unavailable'
  | 'dns_part_mismatch'

export type WrcDirectoryVerification =
  | { ok: true; record: WrcDirectoryRecord }
  | { ok: false; leg: WrcDirectoryLeg; detail?: string }

export interface VerifyDirectoryRecordInput {
  value: unknown
  /** The Publisher Identifier the caller asked about — anti-substitution. */
  expectedPart: string
  /** kid → pub, from {@link resolveOperatorKeys}. */
  operatorKeys: ReadonlyMap<string, string>
  nowS: number
  /** Highest generation already seen for this part; regression = stale. */
  generationFloor?: number | null
}

/**
 * Verify one Namespace Directory Record — signatures, binding, expiry,
 * generation, vetting. DNS is a SEPARATE leg (§XVI.6.5 requires both), run by
 * the client below so this function stays pure.
 */
export function verifyDirectoryRecord(
  input: VerifyDirectoryRecordInput,
): WrcDirectoryVerification {
  const record = decodeDirectoryRecord(input.value)
  if (!record) return { ok: false, leg: 'record_malformed' }

  // Substitution of a valid record belonging to another publisher — and
  // cross-namespace replay — die here, before any signature says "valid".
  if (record.publisher_part !== input.expectedPart) {
    return {
      ok: false,
      leg: 'part_mismatch',
      detail: `record names ${record.publisher_part}, asked for ${input.expectedPart}`,
    }
  }

  const operatorPub = input.operatorKeys.get(record.operator_kid)
  if (!operatorPub) {
    return { ok: false, leg: 'operator_key_unknown', detail: record.operator_kid }
  }

  const asObject = record as unknown as Record<string, unknown>
  const {
    operator_sig: _os,
    publisher_countersig: _ps,
    ...operatorSigned
  } = asObject
  const { publisher_countersig: _ps2, ...publisherSigned } = asObject
  let operatorBytes: Buffer
  let publisherBytes: Buffer
  try {
    operatorBytes = wrcCanonicalBytes(operatorSigned)
    publisherBytes = wrcCanonicalBytes(publisherSigned)
  } catch {
    return { ok: false, leg: 'record_malformed' }
  }

  if (!wrcVerifyEd25519(operatorBytes, record.operator_sig, operatorPub)) {
    return { ok: false, leg: 'operator_sig_invalid' }
  }

  const publisherKey = record.keys.find((k) => k.kid === record.publisher_kid)
  if (
    !publisherKey ||
    !wrcVerifyEd25519(publisherBytes, record.publisher_countersig, publisherKey.pub)
  ) {
    return { ok: false, leg: 'publisher_countersig_invalid' }
  }

  if (input.nowS >= record.expires_at) {
    return { ok: false, leg: 'record_expired', detail: `expired at ${record.expires_at}` }
  }

  if (
    input.generationFloor !== null &&
    input.generationFloor !== undefined &&
    record.generation < input.generationFloor
  ) {
    return {
      ok: false,
      leg: 'generation_stale',
      detail: `generation ${record.generation} < seen ${input.generationFloor}`,
    }
  }

  if (!record.account_holder_vetted) {
    return { ok: false, leg: 'account_not_vetted' }
  }

  return { ok: true, record }
}

/**
 * §XVI.6.5 DNS proof: a `v=wr1` TXT record under the publisher's own domain
 * carrying `part=<PUBLISHER_PART>`. Only the FIRST well-formed `wr1` record
 * carrying a `part` token is considered (merging attacker-influenced records
 * is how a second identity sneaks in).
 */
export function dnsRecordsNamePart(records: readonly string[], part: string): boolean {
  for (const raw of records) {
    const text = raw.trim()
    if (!/(^|;|\s)v=wr1(;|\s|$)/i.test(text)) continue
    const m = text.match(/(?:^|;|\s)part=([A-Z0-9]+)(?:;|\s|$)/i)
    if (m?.[1]) return m[1].toUpperCase() === part.toUpperCase()
  }
  return false
}

// ── Directory client ──────────────────────────────────────────────────────────

export type WrcDirectoryLookup =
  | { ok: true; record: WrcDirectoryRecord }
  | {
      ok: false
      reason: 'unknown_identifier' | 'unverified'
      leg?: WrcDirectoryLeg | 'directory_unavailable'
      detail?: string
    }

/**
 * §XVI.6.4 generation floor state — read / raise, never lower. The DB-backed
 * production implementation lives in `wrcSecurityDb.ts`
 * (`createDbDirectoryGenerationFloorStore`); the memory default below serves
 * tests and stays semantically identical.
 */
export interface WrcGenerationFloorStore {
  /** Highest generation ever accepted for this part, or null if never seen. */
  get(publisherPart: string): number | null
  /** Raise the floor. Lower or equal is a no-op — monotonic by statement. */
  raise(publisherPart: string, generation: number): void
}

function createMemoryGenerationFloorStore(): WrcGenerationFloorStore {
  const m = new Map<string, number>()
  return {
    get: (p) => m.get(p) ?? null,
    raise: (p, g) => {
      if (!Number.isSafeInteger(g) || g < 0) return
      const cur = m.get(p)
      if (cur === undefined || g > cur) m.set(p, g)
    },
  }
}

export interface WrcDirectoryClientOptions {
  transport: WrcTransport
  operator: WrcOperatorAnchor
  rollovers?: readonly WrcOperatorRollover[]
  now?: () => number
  /**
   * Run 5: the durable generation floor. Absent = process-local memory floor
   * (tests). Production passes the security-DB store so a restart can never
   * lower the effective floor.
   */
  generationFloors?: WrcGenerationFloorStore
}

/**
 * The Gate-2 verification client. Every lookup is live (a use-limited entry
 * FORCES live resolution per §XVI.8.4, and Gate 2 re-runs per submission);
 * the only state kept is the monotonic generation floor per part, so a
 * rolled-back record can never be served as current — within this process
 * always, and across restarts when the durable floor store is injected
 * (Run 5 production composition).
 */
export class WrcDirectoryClient {
  private readonly transport: WrcTransport
  private readonly operatorKeys: Map<string, string>
  private readonly now: () => number
  private readonly generationFloors: WrcGenerationFloorStore

  constructor(options: WrcDirectoryClientOptions) {
    this.transport = options.transport
    this.operatorKeys = resolveOperatorKeys(options.operator, options.rollovers ?? [])
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    this.generationFloors = options.generationFloors ?? createMemoryGenerationFloorStore()
  }

  async getVerifiedRecord(publisherPart: string): Promise<WrcDirectoryLookup> {
    const res = await this.transport.directoryRecord(publisherPart)
    if (!res.ok) {
      // §XVI.4.2 uniform 404 — a capture error, not a status.
      if (res.code === 'http_status' && res.status === 404) {
        return { ok: false, reason: 'unknown_identifier' }
      }
      return {
        ok: false,
        reason: 'unverified',
        leg: 'directory_unavailable',
        detail: res.message,
      }
    }

    // The floor is REQUIRED to make the trust decision: a store that cannot
    // answer (unavailable, transaction failure, malformed persisted row)
    // refuses the lookup — fail closed, never "no floor, proceed".
    let floor: number | null
    try {
      floor = this.generationFloors.get(publisherPart)
    } catch (e) {
      return {
        ok: false,
        reason: 'unverified',
        leg: 'directory_unavailable',
        detail: `generation floor unavailable: ${e instanceof Error ? e.message : e}`,
      }
    }

    const verdict = verifyDirectoryRecord({
      value: res.value,
      expectedPart: publisherPart,
      operatorKeys: this.operatorKeys,
      nowS: this.now(),
      generationFloor: floor,
    })
    if (!verdict.ok) {
      return { ok: false, reason: 'unverified', leg: verdict.leg, detail: verdict.detail }
    }
    const record = verdict.record
    // Accept-only-at-or-above-floor, atomically: `raise` is a monotonic
    // conditional upsert (never lowers), and the re-read closes the
    // read-verify race — if a concurrent resolution advanced the floor past
    // this record between our read and now, this record is already stale and
    // must not be served as current.
    try {
      this.generationFloors.raise(publisherPart, record.generation)
      const settled = this.generationFloors.get(publisherPart)
      if (settled !== null && record.generation < settled) {
        return {
          ok: false,
          reason: 'unverified',
          leg: 'generation_stale',
          detail: `generation ${record.generation} < seen ${settled}`,
        }
      }
    } catch (e) {
      return {
        ok: false,
        reason: 'unverified',
        leg: 'directory_unavailable',
        detail: `generation floor unavailable: ${e instanceof Error ? e.message : e}`,
      }
    }

    // §XVI.6.5 — DNS proof is required for an ACTIVE namespace to be treated
    // as verified. A non-active record is still surfaced (status handling —
    // successor, warnings — is the pipeline's), but only once the record
    // itself verified above.
    if (record.status === 'active') {
      const txt = await this.transport.wrTxtRecords(record.domains[0]!)
      if (!txt.ok) {
        return { ok: false, reason: 'unverified', leg: 'dns_unavailable', detail: txt.message }
      }
      if (!dnsRecordsNamePart(txt.records, publisherPart)) {
        return {
          ok: false,
          reason: 'unverified',
          leg: 'dns_part_mismatch',
          detail: `no v=wr1 part proof for ${publisherPart} under ${record.domains[0]}`,
        }
      }
    }

    return { ok: true, record }
  }

  /**
   * §XVI.6.5 email-domain agreement: the registered domains of `record` whose
   * own `_wr` record names the Publisher Identifier, lowercased. A domain the
   * record lists without its own DNS proof does not chain to the publisher.
   * Proven live on every call; a failed or throwing lookup excludes the domain.
   */
  async dnsVerifiedDomains(record: WrcDirectoryRecord): Promise<string[]> {
    const domains = [...new Set(record.domains.map((d) => d.toLowerCase()))]
    const proven = await Promise.all(
      domains.map(async (domain) => {
        try {
          const txt = await this.transport.wrTxtRecords(domain)
          return txt.ok && dnsRecordsNamePart(txt.records, record.publisher_part) ? domain : null
        } catch {
          return null
        }
      }),
    )
    return proven.filter((d): d is string => d !== null)
  }

  /**
   * §XVI.6.5 publisher key binding: is this fingerprint (hex sha256 of the
   * raw public key) one of the publisher's directory-registered keys?
   */
  static keyFingerprints(record: WrcDirectoryRecord): Set<string> {
    const out = new Set<string>()
    for (const k of record.keys) {
      const raw = Buffer.from(k.pub.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      out.add(createHash('sha256').update(raw).digest('hex'))
    }
    return out
  }
}
