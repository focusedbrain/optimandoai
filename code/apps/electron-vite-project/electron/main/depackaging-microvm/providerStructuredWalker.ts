/**
 * B2.1 (D4) — provider-structured-json guest walker (the R2 universal fallback).
 *
 * Runs INSIDE the key-less guest. The orchestrator ships the provider's JSON
 * OPAQUE (it never inspects the structure); this walker treats that JSON as
 * UNTRUSTED structure and converges it onto the SAME `ParseOut` the RFC822 parser
 * produces (`depackageModel.ParseOut`), so HTML→SafeText (R1), the verbatim
 * carrier rule list (R3), the typed result union, and the failure taxonomy are
 * shared with `emailDepackage.ts` rather than duplicated (spec 0010 D4.3).
 *
 * Extensible (D4.2): a second provider schema is a new `ProviderStructuredAdapter`
 * registered below, not a rewrite. Outlook Graph is the first adapter.
 *
 * INV-7 (D4.5): unrecognized/contradictory structure fails CLOSED with a typed
 * code (`E_AMBIGUOUS_STRUCTURE`) → quarantine at the consumer. Never a partial
 * best-effort result. All C4 guards apply: input-size, nesting-depth,
 * per-part-size, part-count, decode-ratio.
 *
 * Pure: no electron, no network. Depends only on `depackageModel` (acyclic).
 */

import {
  DepackageFailure,
  DEPACKAGE_DEFAULTS as DEFAULTS,
  resolveMaxInputBytes,
  type DepackageLimits,
  type Leaf,
  type ParseOut,
} from './depackageModel'
import { buildEnvelopeFromFields, type RawProviderAddress, type RawProviderEnvelopeFields } from './displayEnvelope'

// ── C4 structural guards over untrusted JSON ─────────────────────────────────

/** Bound the nesting depth of arbitrary parsed JSON before we walk it (C4). */
function assertJsonDepth(value: unknown, max: number, depth = 0): void {
  if (depth > max) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'provider JSON nesting depth exceeded')
  }
  if (Array.isArray(value)) {
    for (const v of value) assertJsonDepth(v, max, depth + 1)
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) assertJsonDepth(v, max, depth + 1)
  }
}

/** base64 → bytes with the same decode-ratio bomb guard as the RFC822 path. */
function decodeBase64Guarded(b64: string): Buffer {
  const cleaned = b64.replace(/\s+/g, '')
  const decoded = Buffer.from(cleaned, 'base64')
  if (cleaned.length > 0 && decoded.length > cleaned.length * DEFAULTS.MAX_DECODE_RATIO) {
    throw new DepackageFailure('E_DECOMPRESSION_BOMB', 'base64 decode expanded beyond ratio bound')
  }
  return decoded
}

// ── Adapter interface (D4.2) ─────────────────────────────────────────────────

interface WalkBudget {
  /** decoded bytes accumulated so far; must stay ≤ maxInputBytes (C4). */
  decodedTotal: number
  readonly maxInputBytes: number
  /** parts emitted so far; must stay ≤ MAX_PARTS (C4). */
  partCount: number
}

interface ProviderStructuredAdapter {
  readonly provider: string
  /** Walk a parsed-and-depth-checked object into the shared ParseOut. */
  walk(obj: Record<string, unknown>, budget: WalkBudget): ParseOut
}

function chargeBytes(budget: WalkBudget, n: number): void {
  budget.decodedTotal += n
  if (budget.decodedTotal > budget.maxInputBytes) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'provider-structured decoded total exceeds maxInputBytes')
  }
}

function chargePart(budget: WalkBudget): void {
  budget.partCount += 1
  if (budget.partCount > DEFAULTS.MAX_PARTS) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'provider-structured part count exceeded')
  }
}

function pushLeaf(out: ParseOut, budget: WalkBudget, leaf: Leaf): void {
  if (leaf.bytes.length > budget.maxInputBytes) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'provider-structured part size exceeded')
  }
  chargePart(budget)
  chargeBytes(budget, leaf.bytes.length)
  out.leaves.push(leaf)
}

// ── Outlook Graph adapter ────────────────────────────────────────────────────
//
// Graph message resource (the opaque payload the orchestrator ships):
//   { subject?, body?: { contentType: 'html'|'text', content }, attachments?: [
//       { '@odata.type': '#microsoft.graph.fileAttachment', name, contentType,
//         contentBytes /* base64 */ } ] }
// Non-file attachments (item/reference) carry no bytes → not part data → skipped.

/** Graph `{ emailAddress: { name, address } }` → untrusted RawProviderAddress. */
function graphAddr(v: unknown): RawProviderAddress | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const ea = (v as Record<string, unknown>).emailAddress
  if (ea === null || typeof ea !== 'object') return undefined
  const e = ea as Record<string, unknown>
  return {
    email: typeof e.address === 'string' ? e.address : undefined,
    name: typeof e.name === 'string' ? e.name : undefined,
  }
}
function graphList(v: unknown): RawProviderAddress[] {
  if (!Array.isArray(v)) return []
  const out: RawProviderAddress[] = []
  for (const item of v) {
    const a = graphAddr(item)
    if (a) out.push(a)
  }
  return out
}

const outlookAdapter: ProviderStructuredAdapter = {
  provider: 'outlook',
  walk(obj, budget) {
    // B2.2: decode + normalize the display envelope from Graph fields, treated as
    // untrusted strings — capped + normalized identically to the RFC822 path.
    const envelopeFields: RawProviderEnvelopeFields = {
      subject: typeof obj.subject === 'string' ? obj.subject : undefined,
      from: graphAddr(obj.from),
      to: graphList(obj.toRecipients),
      cc: graphList(obj.ccRecipients),
      replyTo: graphList(obj.replyTo)[0],
      date: typeof obj.receivedDateTime === 'string' ? obj.receivedDateTime : undefined,
    }
    const displayEnvelope = buildEnvelopeFromFields(envelopeFields)
    const out: ParseOut = {
      // SafeText subject uses the normalized envelope subject (parity with RFC822).
      subject: displayEnvelope.subject,
      plainTextParts: [],
      htmlParts: [],
      leaves: [],
      displayEnvelope,
    }

    const body = obj.body
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object') {
        throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', 'outlook body is not an object')
      }
      const b = body as Record<string, unknown>
      const content = b.content
      if (content !== undefined && content !== null) {
        if (typeof content !== 'string') {
          throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', 'outlook body.content is not a string')
        }
        const ct = String(b.contentType ?? '').toLowerCase()
        const contentBytesLen = Buffer.byteLength(content, 'utf8')
        if (ct === 'html') {
          chargePart(budget)
          chargeBytes(budget, contentBytesLen)
          out.htmlParts.push(content)
          // Preserve original HTML as a custody-sealed artifact (parity with the
          // RFC822 path, which pushes a text/html leaf).
          out.leaves.push({ contentType: 'text/html', isAttachment: false, bytes: Buffer.from(content, 'utf8') })
        } else if (ct === 'text') {
          chargePart(budget)
          chargeBytes(budget, contentBytesLen)
          out.plainTextParts.push(content)
        } else {
          // Body present but contentType is neither html nor text — contradictory.
          throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', `outlook body.contentType unrecognized: ${ct || '(absent)'}`)
        }
      }
    }

    const attachments = obj.attachments
    if (attachments !== undefined && attachments !== null) {
      if (!Array.isArray(attachments)) {
        throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', 'outlook attachments is not an array')
      }
      for (const raw of attachments) {
        if (raw === null || typeof raw !== 'object') {
          throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', 'outlook attachment entry is not an object')
        }
        const att = raw as Record<string, unknown>
        const contentBytes = att.contentBytes
        // Non-file attachments (item/reference) carry no bytes → not part data.
        if (contentBytes === undefined || contentBytes === null) continue
        if (typeof contentBytes !== 'string') {
          throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', 'outlook attachment.contentBytes is not a string')
        }
        const bytes = decodeBase64Guarded(contentBytes)
        const filename = typeof att.name === 'string' ? att.name : undefined
        const contentType = typeof att.contentType === 'string' ? att.contentType : 'application/octet-stream'
        pushLeaf(out, budget, { contentType, filename, isAttachment: true, bytes })
      }
    }

    return out
  },
}

const ADAPTERS: ReadonlyMap<string, ProviderStructuredAdapter> = new Map([
  [outlookAdapter.provider, outlookAdapter],
])

const DEFAULT_PROVIDER = 'outlook'

/**
 * Walk a provider-structured-json payload into the shared `ParseOut`. Throws a
 * `DepackageFailure` (mapped to a typed quarantine reason at the entry) on any
 * structural anomaly. The orchestrator never calls this — only the guest does.
 */
export function walkProviderStructured(
  input: Buffer | string,
  opts: { provider?: string },
  limits?: DepackageLimits,
): ParseOut {
  const maxInputBytes = resolveMaxInputBytes(limits)

  const rawStr = Buffer.isBuffer(input) ? input.toString('utf8') : input
  // C4: bound the raw payload before parsing it.
  if (Buffer.byteLength(rawStr, 'utf8') > maxInputBytes) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'provider-structured input exceeds maxInputBytes')
  }

  const providerKey = (opts.provider ?? DEFAULT_PROVIDER).toLowerCase()
  const adapter = ADAPTERS.get(providerKey)
  if (!adapter) {
    // Unknown provider schema → we cannot establish a safety contract (INV-7).
    throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', `no structured-json adapter for provider '${providerKey}'`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawStr)
  } catch (err) {
    throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', `provider JSON parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DepackageFailure('E_AMBIGUOUS_STRUCTURE', 'provider JSON is not a message object')
  }

  assertJsonDepth(parsed, DEFAULTS.MAX_DEPTH)

  const budget: WalkBudget = { decodedTotal: 0, maxInputBytes, partCount: 0 }
  return adapter.walk(parsed as Record<string, unknown>, budget)
}
