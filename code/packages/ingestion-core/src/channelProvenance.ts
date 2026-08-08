/**
 * Channel Provenance Record (CPR) — build item 2 [IX.3.1, IX.11]
 *
 * A typed, bounded verdict record produced at depackaging for EVERY processed
 * message. It answers one question — was this message's transport channel
 * authenticated, and to which domain — and it answers it in typed fields only.
 *
 * Boundary (non-negotiable): raw `Authentication-Results`, raw headers, and
 * signatures NEVER cross the depackaging boundary. They are consumed by
 * `evaluateChannelAuthentication` and discarded; only verdicts survive. The
 * original artifact keeps the evidence. This is why the record has no
 * verbatim-preservation slot, unlike the Art. 50 `aiProvenance` record it is
 * otherwise modelled on: preserving an attacker-supplied header would create
 * exactly the re-parsing surface the boundary exists to remove.
 *
 * Ratchet discipline: a CPR verdict may only ever INCREASE friction. Nothing
 * downstream may use a CPR to upgrade trust, skip a gate, or pre-satisfy
 * consent — `channel_pass` is a precondition for offering, never a substitute
 * for consenting.
 */

// ── Scheme ────────────────────────────────────────────────────────────────────

export const CHANNEL_PROVENANCE_SCHEME = 'optirando-cpr/1' as const

/**
 * Producer version, bumped whenever evaluation FIDELITY changes, so a record
 * in the evidence log can be read against the rules that produced it.
 * Phase 1 consumes gateway-supplied `Authentication-Results` only.
 */
export const CHANNEL_PROVENANCE_PRODUCER_VERSION = 'phase1-gateway-results/1' as const

// ── Verdicts ──────────────────────────────────────────────────────────────────

/**
 * `none` = the channel evaluated the mechanism and found nothing to check.
 * `unverifiable` = we could not establish a verdict at all (no evaluation
 * material, transient error, unrecognised result). Both fail closed; they are
 * distinguished because only the second is a gap in OUR pipeline.
 */
export type ChannelAuthVerdict = 'pass' | 'fail' | 'none' | 'unverifiable'

export type DiscoveryRecordState =
  | 'present_and_consistent'
  | 'present_and_inconsistent'
  /** No Discovery Record evaluation ran. Never fabricated as consistent. */
  | 'not_evaluated'

export interface ChannelMechanismResult {
  verdict: ChannelAuthVerdict
  /**
   * Identifier alignment with the RFC5322.From domain. Meaningful only
   * alongside `verdict: 'pass'`; false in every other state.
   */
  aligned: boolean
}

export interface ChannelProvenanceRecord {
  marking_scheme: typeof CHANNEL_PROVENANCE_SCHEME
  producer_version: string
  /** ISO-8601 UTC, when the verdicts below were established. */
  evaluated_at: string
  /** Content binding: hex SHA-256 of the message this verdict describes. */
  content_sha256: string
  spf: ChannelMechanismResult
  dkim: ChannelMechanismResult
  dmarc: ChannelMechanismResult
  /** D5 aggregate: DKIM aligned-pass OR SPF aligned-pass. */
  channel_pass: boolean
  /**
   * The domain the channel actually authenticated, derived from the
   * evaluation — NOT copied from a display header. Null whenever nothing was
   * authenticated.
   */
  authenticated_sender_domain: string | null
  discovery_record: DiscoveryRecordState
}

// ── Evaluation input ──────────────────────────────────────────────────────────

/**
 * Everything the producer is allowed to look at. Callers pass the values here
 * and keep nothing: no field of this object is copied into the record.
 */
export interface ChannelAuthenticationMaterial {
  /**
   * Values of every `Authentication-Results` header the receiving gateway
   * added, in header order. Absent/empty means we have no evaluation material
   * and every mechanism is `unverifiable`.
   */
  authenticationResults?: readonly string[]
  /** RFC5322.From domain, for alignment. */
  fromDomain?: string | null
}

// ── Header evaluation (raw material in, verdicts out) ─────────────────────────

const HEX64 = /^[0-9a-f]{64}$/

function normalizeDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim().toLowerCase()
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1)
  const at = value.lastIndexOf('@')
  if (at >= 0) value = value.slice(at + 1)
  while (value.endsWith('.')) value = value.slice(0, -1)
  if (value === '' || value.includes(' ')) return null
  return value
}

/**
 * Phase 1 alignment is STRICT (exact domain equality). Relaxed/organizational
 * alignment needs a public-suffix list and lands with the resolver in Phase 3;
 * until then strict is the fail-closed reading — it can only route more
 * messages to the manual-entry path, never fewer.
 */
function domainsAlignStrict(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b
}

/** RFC 8601 result keywords → the four-state verdict. Unknown → unverifiable. */
function verdictFromResult(result: string): ChannelAuthVerdict {
  switch (result.trim().toLowerCase()) {
    case 'pass':
      return 'pass'
    case 'fail':
    case 'softfail':
    case 'policy':
      return 'fail'
    case 'none':
    case 'neutral':
      return 'none'
    case 'temperror':
    case 'permerror':
      return 'unverifiable'
    default:
      return 'unverifiable'
  }
}

/** Strip `(comments)` so a comment cannot smuggle a `method=result` pair. */
function stripComments(value: string): string {
  let out = ''
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  return out
}

interface MethodReading {
  verdict: ChannelAuthVerdict
  domain: string | null
}

function readMethod(
  segments: readonly string[],
  method: string,
  domainProperties: readonly string[],
): MethodReading | null {
  const methodPattern = new RegExp(`^${method}\\s*=\\s*([A-Za-z]+)`)
  for (const segment of segments) {
    const match = methodPattern.exec(segment.trim())
    if (!match) continue
    let domain: string | null = null
    for (const property of domainProperties) {
      const propertyMatch = new RegExp(`(?:^|\\s)${property}\\s*=\\s*([^\\s;]+)`, 'i').exec(segment)
      if (propertyMatch) {
        domain = normalizeDomain(propertyMatch[1])
        if (domain) break
      }
    }
    return { verdict: verdictFromResult(match[1]), domain }
  }
  return null
}

export interface ChannelAuthenticationEvaluation {
  spf: ChannelMechanismResult
  dkim: ChannelMechanismResult
  dmarc: ChannelMechanismResult
  authenticated_sender_domain: string | null
}

const UNVERIFIABLE: ChannelMechanismResult = Object.freeze({
  verdict: 'unverifiable',
  aligned: false,
})

/**
 * Consume the gateway's authentication material and emit verdicts. The input
 * strings are read here and nowhere else; nothing from them is retained.
 *
 * With no material at all every mechanism is `unverifiable` — the absence of a
 * verdict is never reported as `none`, because "the gateway checked and found
 * nothing" and "we never checked" are different facts and only the second is
 * our gap.
 */
export function evaluateChannelAuthentication(
  material: ChannelAuthenticationMaterial,
): ChannelAuthenticationEvaluation {
  const headers = (material.authenticationResults ?? []).filter(
    (h): h is string => typeof h === 'string' && h.trim() !== '',
  )
  const fromDomain = normalizeDomain(material.fromDomain)

  if (headers.length === 0) {
    return {
      spf: { ...UNVERIFIABLE },
      dkim: { ...UNVERIFIABLE },
      dmarc: { ...UNVERIFIABLE },
      authenticated_sender_domain: null,
    }
  }

  const segments = headers.flatMap((header) => stripComments(header).split(';'))

  const spfReading = readMethod(segments, 'spf', ['smtp.mailfrom', 'smtp.helo'])
  const dkimReading = readMethod(segments, 'dkim', ['header.d', 'header.i'])
  const dmarcReading = readMethod(segments, 'dmarc', ['header.from'])

  // A DMARC pass is the gateway's authoritative statement that an aligned
  // authenticated identifier exists (RFC 7489 §4.2 is exactly "aligned SPF
  // pass or aligned DKIM pass"), so it satisfies alignment for whichever
  // mechanism independently passed. The D5 aggregate below stays literal —
  // DMARC is an alignment source, not a third disjunct.
  const dmarcPass = dmarcReading?.verdict === 'pass'

  const mechanism = (reading: MethodReading | null): ChannelMechanismResult => {
    if (!reading) return { verdict: 'none', aligned: false }
    if (reading.verdict !== 'pass') return { verdict: reading.verdict, aligned: false }
    return {
      verdict: 'pass',
      aligned: domainsAlignStrict(reading.domain, fromDomain) || dmarcPass,
    }
  }

  const spf = mechanism(spfReading)
  const dkim = mechanism(dkimReading)
  const dmarc: ChannelMechanismResult = dmarcReading
    ? { verdict: dmarcReading.verdict, aligned: dmarcReading.verdict === 'pass' }
    : { verdict: 'none', aligned: false }

  // The authenticated domain comes from the mechanism that actually passed
  // aligned, DKIM first (it survives forwarding); never from a display header.
  let authenticated: string | null = null
  if (dkim.verdict === 'pass' && dkim.aligned) authenticated = dkimReading?.domain ?? fromDomain
  else if (spf.verdict === 'pass' && spf.aligned) authenticated = spfReading?.domain ?? fromDomain

  return { spf, dkim, dmarc, authenticated_sender_domain: authenticated }
}

// ── D5 aggregate and the §IX.3.1 r8 alert trigger ────────────────────────────

/** D5: pass = DKIM aligned-pass OR SPF aligned-pass. DKIM-only suffices. */
export function computeChannelPass(evaluation: {
  spf: ChannelMechanismResult
  dkim: ChannelMechanismResult
}): boolean {
  const aligned = (m: ChannelMechanismResult): boolean => m.verdict === 'pass' && m.aligned
  return aligned(evaluation.dkim) || aligned(evaluation.spf)
}

/**
 * §IX.3.1 rule 8 trigger: DKIM AND DMARC absent or unverifiable. Derived on
 * read rather than stored, so every surface renders the same verdict from the
 * same rule and a stored `false` can never outlive a rule change.
 */
export function channelAlertRequired(record: ChannelProvenanceRecord): boolean {
  const absent = (m: ChannelMechanismResult): boolean =>
    m.verdict === 'none' || m.verdict === 'unverifiable'
  return absent(record.dkim) && absent(record.dmarc)
}

// ── Producer ──────────────────────────────────────────────────────────────────

export interface CreateChannelProvenanceInput {
  /** Hex SHA-256 of the message bytes this record is bound to. */
  contentSha256: string
  material: ChannelAuthenticationMaterial
  /**
   * Discovery Record evaluation needs DNS and lands in Phase 3. Callers
   * without it MUST leave this unset; `not_evaluated` is never upgraded by
   * default.
   */
  discoveryRecord?: DiscoveryRecordState
  /** ISO-8601 UTC override for deterministic tests. */
  evaluatedAt?: string
  producerVersion?: string
}

export function createChannelProvenanceRecord(
  input: CreateChannelProvenanceInput,
): ChannelProvenanceRecord {
  const evaluation = evaluateChannelAuthentication(input.material)
  const contentSha256 = String(input.contentSha256 ?? '').toLowerCase()
  return {
    marking_scheme: CHANNEL_PROVENANCE_SCHEME,
    producer_version: input.producerVersion ?? CHANNEL_PROVENANCE_PRODUCER_VERSION,
    evaluated_at: input.evaluatedAt ?? new Date().toISOString(),
    content_sha256: HEX64.test(contentSha256) ? contentSha256 : '',
    spf: evaluation.spf,
    dkim: evaluation.dkim,
    dmarc: evaluation.dmarc,
    channel_pass: computeChannelPass(evaluation),
    authenticated_sender_domain: evaluation.authenticated_sender_domain,
    discovery_record: input.discoveryRecord ?? 'not_evaluated',
  }
}

/**
 * The record every path emits when it has NOTHING to evaluate. It is a real
 * verdict ("unverifiable"), not a missing record: a message without a CPR
 * would be indistinguishable from a message that skipped the producer.
 */
export function unverifiableChannelProvenanceRecord(
  contentSha256: string,
  evaluatedAt?: string,
): ChannelProvenanceRecord {
  return createChannelProvenanceRecord({ contentSha256, material: {}, evaluatedAt })
}

// ── Fail-closed decode ────────────────────────────────────────────────────────

const VERDICTS: readonly ChannelAuthVerdict[] = ['pass', 'fail', 'none', 'unverifiable']
const DISCOVERY_STATES: readonly DiscoveryRecordState[] = [
  'present_and_consistent',
  'present_and_inconsistent',
  'not_evaluated',
]

function decodeMechanism(value: unknown): ChannelMechanismResult | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (!VERDICTS.includes(raw.verdict as ChannelAuthVerdict)) return null
  if (typeof raw.aligned !== 'boolean') return null
  return { verdict: raw.verdict as ChannelAuthVerdict, aligned: raw.aligned }
}

/**
 * FAIL-CLOSED: an unknown scheme, a missing field, or a malformed verdict
 * yields null. A caller that gets null has no channel verdict and MUST treat
 * the message as unauthenticated — never as "probably fine".
 */
export function decodeChannelProvenanceRecord(value: unknown): ChannelProvenanceRecord | null {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.marking_scheme !== CHANNEL_PROVENANCE_SCHEME) return null
  if (typeof candidate.producer_version !== 'string' || candidate.producer_version === '') return null
  if (typeof candidate.evaluated_at !== 'string' || candidate.evaluated_at === '') return null
  if (typeof candidate.content_sha256 !== 'string') return null
  if (typeof candidate.channel_pass !== 'boolean') return null
  if (!DISCOVERY_STATES.includes(candidate.discovery_record as DiscoveryRecordState)) return null
  if (
    candidate.authenticated_sender_domain !== null &&
    typeof candidate.authenticated_sender_domain !== 'string'
  ) {
    return null
  }

  const spf = decodeMechanism(candidate.spf)
  const dkim = decodeMechanism(candidate.dkim)
  const dmarc = decodeMechanism(candidate.dmarc)
  if (!spf || !dkim || !dmarc) return null

  // A record whose stored aggregate disagrees with its own verdicts has been
  // tampered with or written by a non-conformant producer: refuse it rather
  // than let a forged `channel_pass: true` through.
  if (candidate.channel_pass !== computeChannelPass({ spf, dkim })) return null

  return {
    marking_scheme: CHANNEL_PROVENANCE_SCHEME,
    producer_version: candidate.producer_version,
    evaluated_at: candidate.evaluated_at,
    content_sha256: candidate.content_sha256,
    spf,
    dkim,
    dmarc,
    channel_pass: candidate.channel_pass,
    authenticated_sender_domain: (candidate.authenticated_sender_domain as string | null) ?? null,
    discovery_record: candidate.discovery_record as DiscoveryRecordState,
  }
}

// ── Ratchet ───────────────────────────────────────────────────────────────────

/** Higher = more friction. A ratchet may move up this ordering, never down. */
const FRICTION: Record<ChannelAuthVerdict, number> = {
  pass: 0,
  none: 1,
  unverifiable: 2,
  fail: 3,
}

function ratchetMechanism(
  current: ChannelMechanismResult,
  incoming: ChannelMechanismResult,
): ChannelMechanismResult {
  const worst = FRICTION[incoming.verdict] > FRICTION[current.verdict] ? incoming : current
  return { verdict: worst.verdict, aligned: current.aligned && incoming.aligned }
}

function ratchetDiscovery(
  current: DiscoveryRecordState,
  incoming: DiscoveryRecordState,
): DiscoveryRecordState {
  // An inconsistency, once observed, is never argued away by a later run.
  if (current === 'present_and_inconsistent' || incoming === 'present_and_inconsistent') {
    return 'present_and_inconsistent'
  }
  // `not_evaluated` → evaluated is a first evaluation, not an upgrade.
  return current === 'not_evaluated' ? incoming : current
}

/**
 * Merge a later evaluation into an existing record so that friction only ever
 * increases. Used when a second stage (Phase 3 alignment, Discovery Record)
 * learns more about a message that already has a CPR: it can tighten the
 * verdict, and it structurally cannot loosen one.
 */
export function ratchetChannelProvenance(
  current: ChannelProvenanceRecord,
  incoming: ChannelProvenanceRecord,
): ChannelProvenanceRecord {
  const spf = ratchetMechanism(current.spf, incoming.spf)
  const dkim = ratchetMechanism(current.dkim, incoming.dkim)
  const dmarc = ratchetMechanism(current.dmarc, incoming.dmarc)
  return {
    marking_scheme: CHANNEL_PROVENANCE_SCHEME,
    producer_version: incoming.producer_version,
    evaluated_at: incoming.evaluated_at,
    content_sha256: current.content_sha256,
    spf,
    dkim,
    dmarc,
    channel_pass: current.channel_pass && incoming.channel_pass && computeChannelPass({ spf, dkim }),
    authenticated_sender_domain:
      current.authenticated_sender_domain === incoming.authenticated_sender_domain
        ? current.authenticated_sender_domain
        : null,
    discovery_record: ratchetDiscovery(current.discovery_record, incoming.discovery_record),
  }
}

// ── Persistence shape ─────────────────────────────────────────────────────────

/**
 * The `depackaged_metadata` slot, shaped like `pbeapTrustMetadata` so both
 * verdicts sit side by side in the same sealed JSON blob.
 */
export function channelProvenanceMetadata(record: ChannelProvenanceRecord): {
  channel_provenance: ChannelProvenanceRecord
} {
  return { channel_provenance: record }
}

/** Read the CPR back out of a `depackaged_metadata` blob, fail-closed. */
export function readChannelProvenanceMetadata(metadata: unknown): ChannelProvenanceRecord | null {
  let raw: unknown = metadata
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof raw !== 'object' || raw === null) return null
  return decodeChannelProvenanceRecord((raw as Record<string, unknown>).channel_provenance)
}
