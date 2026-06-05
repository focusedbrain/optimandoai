/**
 * B2 email depackaging — the uplifted guest payload (runs INSIDE the key-less
 * guest). Generalizes Build-1's `depackage()` into the typed-result world the
 * email cutover needs, WITHOUT mutating the B1 `depackage`/`extractMime`/
 * `runDepackagingJob` functions (those remain as the rig-proven slice).
 *
 * What this adds over B1 (build spec 0007, Phase 1):
 *   - R1: HTML→SafeText derivation INSIDE the guest (via `htmlToText.ts`),
 *     preferring `text/plain` when present (parity with `gateway.ts:2485`).
 *     Original HTML is still custody-sealed as an artifact (preserve-only).
 *   - R3: carrier BEAP detection ported VERBATIM from `messageRouter.ts:319–377`
 *     (the predicates are copied below as an explicit rule list). Extracted
 *     packages travel in a DEDICATED OPAQUE channel — NOT custody-sealed —
 *     integrity covered by the job-result signature.
 *   - Typed result union: `plain | beap-carrier | mixed`, multi-package.
 *   - INV-7: failure taxonomy. Every anomaly (malformed MIME, limits exceeded,
 *     decode bomb, safe-text rejection, ambiguous/partial carrier match) FAILS
 *     CLOSED with a typed reason code → the consumer quarantines. There is never
 *     a best-effort inline parse or partial-trust text.
 *   - C4 hardening: `limits.maxInputBytes` is honored here (spec value wins),
 *     plus nesting-depth, per-part-size, and decode-ratio guards.
 *
 * Pure: node `crypto` + `@noble/curves` + the reused `encryptForQuarantine`
 * primitive. No electron, no network. Bundles into the golden image.
 */

import { randomUUID } from 'crypto'
import { encryptForQuarantine } from '../quarantine-encrypt/index'
import type { QuarantineBlobFile } from '../quarantine-blob-storage/index'
import { constructSafeText, type SafeTextV1 } from './safeText'
import { htmlToSafeText } from './htmlToText'

// ── Typed failure taxonomy (INV-7) ──────────────────────────────────────────

export type DepackageFailureCode =
  | 'E_MALFORMED_MIME'
  | 'E_LIMITS_EXCEEDED'
  | 'E_DECOMPRESSION_BOMB'
  | 'E_AMBIGUOUS_CLASSIFICATION'
  | 'E_ARTIFACT_CUSTODY_FAILED'

/** Thrown inside the guest; mapped to a typed failure result at the entry. */
export class DepackageFailure extends Error {
  constructor(public readonly code: DepackageFailureCode, message?: string) {
    super(message ?? code)
    this.name = 'DepackageFailure'
  }
}

// ── Custody + opaque channels ────────────────────────────────────────────────

/** A custody-sealed original artifact (HTML, attachments). Opaque ciphertext. */
export interface SealedArtifact {
  readonly blob_id: string
  readonly content_type: string
  readonly filename?: string
  readonly blob: QuarantineBlobFile
}

/**
 * An extracted carrier BEAP package. Travels in a DEDICATED OPAQUE channel,
 * NOT custody-sealed (R3): qBEAP is already ciphertext, pBEAP is public JSON,
 * and the consumer must hand these to the B1-routed pipeline-2 path. Integrity
 * is covered by the job-result signature, not by sealing.
 */
export interface OpaquePackage {
  /** Hint only, from `header.encoding`; never trusted for routing decisions. */
  readonly encodingHint: 'qBEAP' | 'pBEAP' | 'unknown'
  /** Exact carrier package bytes (UTF-8 of the package JSON), unparsed. */
  readonly bytesB64: string
  /** Provenance: where in the carrier this came from. */
  readonly source: 'attachment' | 'body' | 'json-attachment'
}

// ── Typed result union ───────────────────────────────────────────────────────

export type DepackageEmailResult =
  | { readonly ok: true; readonly type: 'plain'; readonly safeText: SafeTextV1; readonly artifacts: readonly SealedArtifact[] }
  | { readonly ok: true; readonly type: 'beap-carrier'; readonly packages: readonly OpaquePackage[]; readonly carrierSafeText?: SafeTextV1; readonly artifacts: readonly SealedArtifact[] }
  | { readonly ok: true; readonly type: 'mixed'; readonly packages: readonly OpaquePackage[]; readonly safeText: SafeTextV1; readonly artifacts: readonly SealedArtifact[] }
  | { readonly ok: false; readonly code: DepackageFailureCode; readonly message: string }

// ── Hardened limits (C4) ─────────────────────────────────────────────────────

export interface DepackageLimits {
  /** Spec value wins over the hardcoded default (C4). */
  readonly maxInputBytes?: number
}

const DEFAULTS = {
  MAX_INPUT_BYTES: 8 * 1024 * 1024,
  MAX_PARTS: 256,
  MAX_DEPTH: 8,
  MAX_HEADERS_BYTES: 64 * 1024,
  /** decoded/raw ratio ceiling — base64 shrinks, QP ~1x; >this ⇒ bomb. */
  MAX_DECODE_RATIO: 8,
} as const

// ── Bounded MIME parse (recursive, fail-closed) ──────────────────────────────

interface Leaf {
  contentType: string
  filename?: string
  isAttachment: boolean
  /** decoded bytes of the leaf */
  bytes: Buffer
}

interface ParseOut {
  subject: string
  plainTextParts: string[]
  htmlParts: string[]
  /** every leaf (for carrier detection + sealing) */
  leaves: Leaf[]
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>()
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (name && !headers.has(name)) headers.set(name, value)
  }
  return headers
}

function decodeTransfer(rawBytes: Buffer, encoding: string): Buffer {
  const enc = encoding.trim().toLowerCase()
  let decoded: Buffer
  if (enc === 'base64') {
    decoded = Buffer.from(rawBytes.toString('ascii').replace(/\s+/g, ''), 'base64')
  } else if (enc === 'quoted-printable') {
    const s = rawBytes.toString('latin1')
    const d = s
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    decoded = Buffer.from(d, 'latin1')
  } else {
    decoded = rawBytes
  }
  // Decode-ratio guard (forward-looking bomb guard).
  if (rawBytes.length > 0 && decoded.length > rawBytes.length * DEFAULTS.MAX_DECODE_RATIO) {
    throw new DepackageFailure('E_DECOMPRESSION_BOMB', 'transfer decode expanded beyond ratio bound')
  }
  return decoded
}

function contentTypeOf(headers: Map<string, string>): { type: string; boundary?: string; filename?: string } {
  const ct = headers.get('content-type') ?? 'text/plain'
  const type = ct.split(';')[0]!.trim().toLowerCase()
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(ct)
  const cd = headers.get('content-disposition') ?? ''
  const nameMatch = /filename="?([^";]+)"?/i.exec(cd) ?? /name="?([^";]+)"?/i.exec(ct)
  return { type, boundary: boundaryMatch?.[1], filename: nameMatch?.[1] }
}

function splitHeaderBody(raw: string): { headerBlock: string; body: string } {
  const sep = raw.indexOf('\r\n\r\n')
  const sep2 = sep === -1 ? raw.indexOf('\n\n') : sep
  if (sep2 === -1) return { headerBlock: raw.slice(0, DEFAULTS.MAX_HEADERS_BYTES), body: '' }
  const headerEnd = sep === -1 ? sep2 : sep
  const bodyStart = sep === -1 ? sep2 + 2 : sep2 + 4
  return { headerBlock: raw.slice(0, headerEnd), body: raw.slice(bodyStart) }
}

function parseEntity(
  rawText: string,
  headers: Map<string, string>,
  out: ParseOut,
  depth: number,
  maxPartBytes: number,
): void {
  if (depth > DEFAULTS.MAX_DEPTH) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'MIME nesting depth exceeded')
  }
  if (out.leaves.length + out.plainTextParts.length + out.htmlParts.length >= DEFAULTS.MAX_PARTS) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'MIME part count exceeded')
  }
  const info = contentTypeOf(headers)

  if (info.type.startsWith('multipart/') && info.boundary) {
    const boundary = info.boundary
    const segments = rawText.split(
      new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\r?\\n?`),
    )
    for (const seg of segments) {
      if (!seg.trim()) continue
      const { headerBlock: ph, body: pb } = splitHeaderBody(seg)
      if (!ph && !pb) continue
      parseEntity(pb, parseHeaders(ph), out, depth + 1, maxPartBytes)
      if (out.leaves.length + out.plainTextParts.length + out.htmlParts.length >= DEFAULTS.MAX_PARTS) break
    }
    return
  }

  // Leaf entity.
  const cte = headers.get('content-transfer-encoding') ?? '7bit'
  const decoded = decodeTransfer(Buffer.from(rawText, 'latin1'), cte)
  if (decoded.length > maxPartBytes) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', 'MIME part size exceeded')
  }
  const isAttachment = /attachment|inline/i.test(headers.get('content-disposition') ?? '') && !!info.filename

  if (info.type === 'text/plain' && !isAttachment) {
    out.plainTextParts.push(decoded.toString('utf8'))
  } else if (info.type === 'text/html' && !isAttachment) {
    // HTML feeds the text-derivation fallback AND is preserved as a sealed artifact.
    out.htmlParts.push(decoded.toString('utf8'))
    out.leaves.push({ contentType: info.type, filename: info.filename, isAttachment, bytes: decoded })
  } else {
    out.leaves.push({ contentType: info.type, filename: info.filename, isAttachment, bytes: decoded })
  }
}

function hardenedParse(input: Buffer, limits?: DepackageLimits): ParseOut {
  const maxInput = limits?.maxInputBytes != null && limits.maxInputBytes > 0
    ? Math.min(limits.maxInputBytes, DEFAULTS.MAX_INPUT_BYTES)
    : DEFAULTS.MAX_INPUT_BYTES
  // INV-7 / C4: oversized input FAILS CLOSED — never silently truncated.
  if (input.length > maxInput) {
    throw new DepackageFailure('E_LIMITS_EXCEEDED', `input exceeds maxInputBytes (${input.length} > ${maxInput})`)
  }
  const raw = input.toString('latin1')
  const { headerBlock, body } = splitHeaderBody(raw)
  const headers = parseHeaders(headerBlock)
  const out: ParseOut = {
    subject: headers.get('subject') ?? '',
    plainTextParts: [],
    htmlParts: [],
    leaves: [],
  }
  parseEntity(body, headers, out, 0, maxInput)
  return out
}

// ── Carrier BEAP detection — VERBATIM from messageRouter.ts:88–149 (R3) ───────
// These predicates are copied byte-for-byte (the documented rule list). Tightening
// is a separate later change (R3); parity with the live detector is the goal.

function detectBeapCapsule(text: string): { detected: boolean; capsuleJson?: string } {
  if (!text || typeof text !== 'string') return { detected: false }
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { detected: false }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.schema_version === 'number' &&
      typeof parsed.capsule_type === 'string' &&
      ['initiate', 'accept', 'refresh', 'revoke'].includes(parsed.capsule_type)
    ) {
      return { detected: true, capsuleJson: trimmed }
    }
  } catch { /* not valid JSON */ }
  return { detected: false }
}

function detectBeapMessagePackage(text: string): { detected: boolean; packageJson?: string; encoding?: string; ambiguous?: boolean } {
  if (!text || typeof text !== 'string') return { detected: false }
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { detected: false }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'header' in parsed && parsed.header != null && typeof parsed.header === 'object' &&
      'metadata' in parsed && parsed.metadata != null && typeof parsed.metadata === 'object' &&
      ('envelope' in parsed || 'payload' in parsed)
    ) {
      const enc = (parsed.header as Record<string, unknown>)?.encoding
      // INV-7: a package-shaped object with an UNKNOWN encoding is a
      // partially-matching carrier — ambiguous, not "plain". The live detector
      // returned {detected:false} here (fell through to plain); B2 routes it to
      // quarantine instead (documented divergence, ruling INV-7 over parity for
      // the ambiguous subset only).
      if (enc != null && !['qBEAP', 'pBEAP'].includes(enc as string)) {
        return { detected: false, ambiguous: true }
      }
      return { detected: true, packageJson: trimmed, encoding: typeof enc === 'string' ? enc : 'unknown' }
    }
  } catch { /* not valid JSON */ }
  return { detected: false }
}

function detectBeapInJson(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as Record<string, unknown>
  if (p.capsule_type && typeof p.schema_version === 'number') return true
  if (p.header && typeof p.header === 'object' && (p.envelope != null || p.payload != null)) return true
  return false
}

function isBeapAttachment(filename: string | undefined, contentType: string | undefined): boolean {
  const fn = (filename || '').toLowerCase()
  const ct = (contentType || '').toLowerCase()
  if (fn.endsWith('.beap')) return true
  if (ct === 'application/vnd.beap+json' || ct === 'application/x-beap') return true
  return false
}

function isJsonAttachment(filename: string | undefined, contentType: string | undefined): boolean {
  const fn = (filename || '').toLowerCase()
  const ct = (contentType || '').toLowerCase()
  if (fn.endsWith('.json')) return true
  if (ct === 'application/json') return true
  return false
}

function encodingHintOf(packageJson: string): OpaquePackage['encodingHint'] {
  try {
    const enc = (JSON.parse(packageJson)?.header as Record<string, unknown> | undefined)?.encoding
    if (enc === 'qBEAP' || enc === 'pBEAP') return enc
  } catch { /* ignore */ }
  return 'unknown'
}

// ── Detection over the parsed entity (mirrors messageRouter order) ───────────

const MAX_DETECT_CHARS = 65536 // matches messageRouter's per-candidate cap

function detectCarrierPackages(parsed: ParseOut): { packages: OpaquePackage[]; ambiguous: boolean; consumedLeaves: Set<Leaf>; bodyConsumed: boolean } {
  const packages: OpaquePackage[] = []
  const consumedLeaves = new Set<Leaf>()
  let ambiguous = false
  let bodyConsumed = false

  // (1) BEAP-named / BEAP-MIME attachments.
  for (const leaf of parsed.leaves) {
    if (!isBeapAttachment(leaf.filename, leaf.contentType)) continue
    if (leaf.bytes.length === 0) continue
    const text = leaf.bytes.toString('utf-8')
    if (text.length > MAX_DETECT_CHARS) continue
    const cap = detectBeapCapsule(text)
    if (cap.detected && cap.capsuleJson) {
      packages.push({ encodingHint: encodingHintOf(cap.capsuleJson), bytesB64: Buffer.from(cap.capsuleJson, 'utf8').toString('base64'), source: 'attachment' })
      consumedLeaves.add(leaf)
      continue
    }
    const pkg = detectBeapMessagePackage(text)
    if (pkg.detected && pkg.packageJson) {
      packages.push({ encodingHint: (pkg.encoding === 'qBEAP' || pkg.encoding === 'pBEAP') ? pkg.encoding : 'unknown', bytesB64: Buffer.from(pkg.packageJson, 'utf8').toString('base64'), source: 'attachment' })
      consumedLeaves.add(leaf)
      continue
    }
    // A .beap-named attachment that matched neither predicate is a partial
    // carrier match — INV-7 ⇒ ambiguous (the live detector fell through to plain).
    ambiguous = true
  }

  // (2) Body-text JSON.
  const bodyText = parsed.plainTextParts.join('\n\n')
  if (bodyText.trim().startsWith('{')) {
    const cap = detectBeapCapsule(bodyText)
    if (cap.detected && cap.capsuleJson) {
      packages.push({ encodingHint: encodingHintOf(cap.capsuleJson), bytesB64: Buffer.from(cap.capsuleJson, 'utf8').toString('base64'), source: 'body' })
      bodyConsumed = true
    } else {
      const pkg = detectBeapMessagePackage(bodyText)
      if (pkg.detected && pkg.packageJson) {
        packages.push({ encodingHint: (pkg.encoding === 'qBEAP' || pkg.encoding === 'pBEAP') ? pkg.encoding : 'unknown', bytesB64: Buffer.from(pkg.packageJson, 'utf8').toString('base64'), source: 'body' })
        bodyConsumed = true
      } else if (pkg.ambiguous) {
        ambiguous = true
      }
    }
  }

  // (3) .json / application/json attachments.
  for (const leaf of parsed.leaves) {
    if (!isJsonAttachment(leaf.filename, leaf.contentType)) continue
    if (leaf.bytes.length === 0) continue
    const text = leaf.bytes.toString('utf-8')
    if (text.length > MAX_DETECT_CHARS) continue
    try {
      const obj = JSON.parse(text)
      if (detectBeapInJson(obj)) {
        packages.push({ encodingHint: encodingHintOf(text), bytesB64: Buffer.from(text, 'utf8').toString('base64'), source: 'json-attachment' })
        consumedLeaves.add(leaf)
      }
    } catch { /* not valid JSON → not a package */ }
  }

  return { packages, ambiguous, consumedLeaves, bodyConsumed }
}

// ── Sealing + safe-text construction ─────────────────────────────────────────

function sealArtifacts(leaves: Leaf[], sandboxPubB64: string): SealedArtifact[] {
  const artifacts: SealedArtifact[] = []
  for (const leaf of leaves) {
    const enc = encryptForQuarantine(leaf.bytes, sandboxPubB64)
    try { leaf.bytes.fill(0) } catch { /* best effort */ }
    if (!enc.ok) {
      throw new DepackageFailure('E_ARTIFACT_CUSTODY_FAILED', `artifact custody failed: ${enc.error}`)
    }
    artifacts.push({ blob_id: randomUUID(), content_type: leaf.contentType, filename: leaf.filename, blob: enc.blob })
  }
  return artifacts
}

function deriveBodyText(parsed: ParseOut, bodyConsumed: boolean): string {
  // Parity with gateway.ts:2485 — prefer text/plain; else derive from HTML.
  // When the plain body WAS the carrier package (bodyConsumed), it is not human
  // text: skip it (parity with messageRouter classifying a body-package as a pure
  // carrier, not plain). HTML, if any, may still derive a body.
  if (!bodyConsumed && parsed.plainTextParts.length > 0) return parsed.plainTextParts.join('\n\n')
  if (parsed.htmlParts.length > 0) return htmlToSafeText(parsed.htmlParts.join('\n\n'))
  return ''
}

/**
 * B2 email depackage entry. Pure; returns the typed union or a typed failure.
 * `sandboxPubB64` is the PUBLIC X25519 key artifacts are sealed to (INV-2).
 */
export function depackageEmail(
  inputBytes: Buffer,
  sandboxPubB64: string,
  limits?: DepackageLimits,
): DepackageEmailResult {
  try {
    const parsed = hardenedParse(inputBytes, limits)
    const { packages, ambiguous, consumedLeaves, bodyConsumed } = detectCarrierPackages(parsed)

    if (ambiguous) {
      // INV-7: ambiguous/partial carrier match → fail closed (quarantine).
      throw new DepackageFailure('E_AMBIGUOUS_CLASSIFICATION', 'ambiguous or partially-matching carrier classification')
    }

    // Carrier packages travel in the opaque channel and must NOT be sealed;
    // everything else (HTML, attachments) is custody-sealed. Leaves consumed as
    // packages are excluded from sealing to avoid double custody.
    const sealLeaves = parsed.leaves.filter((leaf) => !consumedLeaves.has(leaf))

    const bodyText = deriveBodyText(parsed, bodyConsumed)
    const hasText = bodyText.trim().length > 0

    if (packages.length === 0) {
      const artifacts = sealArtifacts(sealLeaves, sandboxPubB64)
      const safeText = constructSafeText({
        subjectRaw: parsed.subject,
        plainTextBodyRaw: bodyText,
        attachmentBlobIds: artifacts.map((a) => a.blob_id),
      })
      return { ok: true, type: 'plain', safeText, artifacts }
    }

    const artifacts = sealArtifacts(sealLeaves, sandboxPubB64)
    if (hasText) {
      const safeText = constructSafeText({
        subjectRaw: parsed.subject,
        plainTextBodyRaw: bodyText,
        attachmentBlobIds: artifacts.map((a) => a.blob_id),
      })
      return { ok: true, type: 'mixed', packages, safeText, artifacts }
    }
    const carrierSafeText = constructSafeText({
      subjectRaw: parsed.subject,
      plainTextBodyRaw: '',
      attachmentBlobIds: artifacts.map((a) => a.blob_id),
    })
    return { ok: true, type: 'beap-carrier', packages, carrierSafeText, artifacts }
  } catch (err: unknown) {
    if (err instanceof DepackageFailure) {
      return { ok: false, code: err.code, message: err.message }
    }
    // Any other parse error is malformed MIME → fail closed (INV-7).
    return { ok: false, code: 'E_MALFORMED_MIME', message: err instanceof Error ? err.message : String(err) }
  }
}
