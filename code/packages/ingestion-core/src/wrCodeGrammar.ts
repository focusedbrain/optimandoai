/**
 * WR Code® reference grammar, grammar version 2 — Annex XVI v1.95
 * (`docs/spec/Annex_XVI_WR_Code_v1.95.pdf`, SHA256 064AAD6D…829F).
 *
 * This module is the ONE place the v1.95 reference grammar exists:
 *
 *  - §XVI.5.2  variable-length prefix grammar (P/I/C terminal, S non-terminal,
 *              SP/SI/SC/SE terminal, everything else INVALID),
 *  - §XVI.5.1  per-class block structure (P attached check; I, C and every
 *              sub-handshake class with a separate check block),
 *  - §XVI.5.3  normalization ORDER — case fold, then prefix parse, and only
 *              then the Crockford payload aliases on the address body, so a
 *              class symbol I is never rewritten to the digit 1,
 *  - §XVI.5.4  the class-aware terminal check (Class Value Table P=22, I=1,
 *              C=12, S=25, E=14) on the verified Damm core of `wrCode.ts`,
 *  - §XVI.5.8  completeness by grammar alone (per-class body length; an
 *              over-long candidate is INVALID, never truncated),
 *  - §XVI.5.11 the generalized reference structure: every class DECLARES its
 *              field list in {@link WR_CODE_CLASS_SPECS}; the parser is
 *              table-driven and hard-codes no single shape.
 *
 * Like `wrCode.ts` it is pure and offline-capable: no I/O, no clock, no
 * network, no DB. A captured reference is capture-consistent ONLY — never
 * resolved, verified, or authorized (§XVI.5.4: a valid check is never
 * authentication).
 *
 * The old prefix-less 12-symbol Baseline Code (check profile v1.2/v1.4) is
 * INVALID under grammar version 2. There is no dual-acceptance mode: every
 * reject is fail-closed with a precise reason code.
 *
 * IDENTIFIER-CLASS BOUNDARY: the 6-digit device-pairing code remains a
 * DIFFERENT identifier class with its own normalizer and rules. Do not use
 * this module for pairing codes.
 */

import { ALPHABET, computeCheck, verifyCheck } from './wrCode.js'

// ── Class registry (grammar version 2) ───────────────────────────────────────

export const WR_CODE_GRAMMAR_VERSION = 2

export type WrCodeClass = 'P' | 'I' | 'C' | 'SP' | 'SI' | 'SC' | 'SE'

/** Field roles of the generalized structure [XVI.5.11]. */
export type WrCodeFieldRole = 'publisher' | 'local' | 'counterparty' | 'combination'

export interface WrCodeFieldSpec {
  readonly role: WrCodeFieldRole
  readonly length: number
}

export interface WrCodeClassSpec {
  readonly cls: WrCodeClass
  /** Class Value Table entries of the consumed terminal prefix [XVI.5.4]. */
  readonly classValues: readonly number[]
  /** Ordered address fields after the prefix [XVI.5.1, XVI.5.11]. */
  readonly fields: readonly WrCodeFieldSpec[]
  /** P attaches the check to the last address block; all others render it separately. */
  readonly checkPlacement: 'attached' | 'separate'
}

/**
 * Class Value Table of the reference profile [XVI.5.4]. Each value coincides
 * with the Crockford input-mapping value of the class symbol (A.3), which is
 * what lets the check run on the unmodified Damm core.
 */
export const WR_CODE_CLASS_VALUES = Object.freeze({ P: 22, I: 1, C: 12, S: 25, E: 14 })

const F = (role: WrCodeFieldRole, length: number): WrCodeFieldSpec => Object.freeze({ role, length })

/**
 * Per-class declarations [XVI.5.1, XVI.5.8]. The parser below reads the class
 * first and then frames the address fields from this table — adding a class is
 * a registry entry, not a parser change [XVI.5.11].
 */
export const WR_CODE_CLASS_SPECS: Readonly<Record<WrCodeClass, WrCodeClassSpec>> = Object.freeze({
  P: Object.freeze({ cls: 'P' as const, classValues: Object.freeze([22]), fields: Object.freeze([F('publisher', 6), F('local', 5)]), checkPlacement: 'attached' as const }),
  I: Object.freeze({ cls: 'I' as const, classValues: Object.freeze([1]), fields: Object.freeze([F('publisher', 6), F('combination', 6)]), checkPlacement: 'separate' as const }),
  C: Object.freeze({ cls: 'C' as const, classValues: Object.freeze([12]), fields: Object.freeze([F('publisher', 6), F('counterparty', 6)]), checkPlacement: 'separate' as const }),
  SP: Object.freeze({ cls: 'SP' as const, classValues: Object.freeze([25, 22]), fields: Object.freeze([F('publisher', 6), F('combination', 6)]), checkPlacement: 'separate' as const }),
  SI: Object.freeze({ cls: 'SI' as const, classValues: Object.freeze([25, 1]), fields: Object.freeze([F('publisher', 6), F('combination', 6)]), checkPlacement: 'separate' as const }),
  SC: Object.freeze({ cls: 'SC' as const, classValues: Object.freeze([25, 12]), fields: Object.freeze([F('publisher', 6), F('combination', 6)]), checkPlacement: 'separate' as const }),
  SE: Object.freeze({ cls: 'SE' as const, classValues: Object.freeze([25, 14]), fields: Object.freeze([F('publisher', 6), F('combination', 6)]), checkPlacement: 'separate' as const }),
})

export const WR_CODE_CLASSES = Object.freeze(
  Object.keys(WR_CODE_CLASS_SPECS) as readonly WrCodeClass[],
)

/** Address-body length (check excluded) a class expects after its prefix. */
export function wrCodeBodyLength(cls: WrCodeClass): number {
  return WR_CODE_CLASS_SPECS[cls].fields.reduce((n, f) => n + f.length, 0)
}

// ── Prefix grammar [XVI.5.2] ──────────────────────────────────────────────────

export type WrCodePrefixState = 'TERMINAL' | 'NON_TERMINAL' | 'INVALID'

/**
 * Classify a partial prefix sequence exactly as the Prefix Grammar Registry
 * does: P/I/C → TERMINAL, S → NON_TERMINAL, SP/SI/SC/SE → TERMINAL, any other
 * first symbol — and S followed by any unregistered symbol — INVALID.
 */
export function classifyWrCodePrefix(symbols: string): { state: WrCodePrefixState; cls?: WrCodeClass } {
  if (symbols === 'P' || symbols === 'I' || symbols === 'C') return { state: 'TERMINAL', cls: symbols }
  if (symbols === 'S') return { state: 'NON_TERMINAL' }
  if (symbols === 'SP' || symbols === 'SI' || symbols === 'SC' || symbols === 'SE') {
    return { state: 'TERMINAL', cls: symbols }
  }
  return { state: 'INVALID' }
}

// ── Normalization [XVI.5.3] ───────────────────────────────────────────────────

const ALPHABET_SET = new Set(ALPHABET)

/** Crockford payload alias for ONE address-body symbol; null when out of alphabet. */
function aliasBodySymbol(chRaw: string): string | null {
  let ch = chRaw.toUpperCase()
  if (ch === 'I' || ch === 'L') ch = '1'
  if (ch === 'O') ch = '0'
  return ALPHABET_SET.has(ch) ? ch : null
}

/** Strip presentation separators and fold case. Everything non-alphanumeric is a separator. */
function foldedSymbols(raw: string): string {
  let out = ''
  for (const ch of raw) {
    if (/[0-9A-Za-z]/.test(ch)) out += ch.toUpperCase()
  }
  return out
}

// ── Capture [XVI.5.4, XVI.5.8] ───────────────────────────────────────────────

export type WrCodeCaptureFailureReason =
  /** Nothing left after separator stripping. */
  | 'empty'
  /** First symbol(s) not a registered terminal prefix (includes every old prefix-less code). */
  | 'unknown_prefix'
  /** Body shorter or longer than the class's fixed form — omission/insertion detection [XVI.5.4]. */
  | 'wrong_length'
  /** An address-body symbol survives aliasing outside Crockford Base32 (U in particular). */
  | 'out_of_alphabet'
  /** Well-formed symbols, wrong terminal check character. A CAPTURE ERROR — never resolve. */
  | 'check_failed'

export interface WrCodeCaptureFailure {
  ok: false
  reason: WrCodeCaptureFailureReason
  detail?: string
}

export interface WrCodeReference {
  ok: true
  cls: WrCodeClass
  classValues: readonly number[]
  /** Prefix symbols + alias-normalized body + check, ungrouped. Class symbols verbatim (I stays I). */
  canonical: string
  /** Locally generated grouping per §XVI.5.1 — never a received rendering (P12). */
  display: string
  /** Generalized field view [XVI.5.11], in declaration order. */
  fields: ReadonlyArray<{ role: WrCodeFieldRole; symbols: string }>
  /** Block 2 — always a Publisher Identifier (for C: the initiator). */
  publisher: string
  /** P only: the unaddressed local entry block. */
  local: string | null
  /** C only: the responder Publisher Identifier. */
  counterparty: string | null
  /** I and sub-handshake classes: the six-symbol combination code. */
  combination: string | null
  check: string
}

export type WrCodeCaptureResult = WrCodeReference | WrCodeCaptureFailure

const failCapture = (reason: WrCodeCaptureFailureReason, detail?: string): WrCodeCaptureFailure =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail }

/**
 * The check input as a reference-alphabet string: the class-value symbols
 * followed by the normalized body. Because the Class Value Table coincides
 * with the Crockford mapping (A.3), folding this string through the v1.4 Damm
 * core computes exactly the §XVI.5.4 class-aware check.
 */
function checkStem(spec: WrCodeClassSpec, body: string): string {
  return spec.classValues.map((v) => ALPHABET[v]).join('') + body
}

/**
 * The ONE capture gate for grammar-version-2 references [XVI.5.4, XVI.5.8].
 *
 * Order of operations is normative: separators out and case folded, prefix
 * parsed against the registry, payload aliases applied to the address body
 * only, fixed per-class length enforced, check verified. Every path that does
 * not end in a fully verified reference returns a typed failure — there is
 * nothing to resolve WITH on failure, and an `ok: true` result is still only
 * capture-consistent, never validated.
 */
export function captureWrCodeReference(raw: string): WrCodeCaptureResult {
  const symbols = foldedSymbols(raw ?? '')
  if (symbols.length === 0) return failCapture('empty')

  // Prefix before aliases [XVI.5.3]: consume one symbol, then a second while
  // the registry reports NON_TERMINAL.
  let prefixLen = 1
  let prefix = classifyWrCodePrefix(symbols.slice(0, 1))
  if (prefix.state === 'NON_TERMINAL') {
    if (symbols.length < 2) return failCapture('wrong_length', 'prefix incomplete')
    prefixLen = 2
    prefix = classifyWrCodePrefix(symbols.slice(0, 2))
  }
  if (prefix.state !== 'TERMINAL' || !prefix.cls) {
    return failCapture('unknown_prefix', symbols.slice(0, prefixLen))
  }
  const spec = WR_CODE_CLASS_SPECS[prefix.cls]

  // Fixed form: body + exactly one check symbol [XVI.5.8]. Over-long is
  // INVALID, under-long is incomplete — both reject here.
  const expected = wrCodeBodyLength(spec.cls) + 1
  const rest = symbols.slice(prefixLen)
  if (rest.length !== expected) {
    return failCapture('wrong_length', `${spec.cls} expects ${expected} symbols after the prefix, got ${rest.length}`)
  }

  // Payload aliases on the address body and the check symbol only [XVI.5.3].
  let body = ''
  for (const ch of rest) {
    const mapped = aliasBodySymbol(ch)
    if (mapped === null) return failCapture('out_of_alphabet', ch)
    body += mapped
  }
  const check = body[body.length - 1]
  body = body.slice(0, -1)

  if (!verifyCheck(checkStem(spec, body) + check)) return failCapture('check_failed')

  // Frame the address fields from the class declaration [XVI.5.11].
  const fields: Array<{ role: WrCodeFieldRole; symbols: string }> = []
  let at = 0
  for (const f of spec.fields) {
    fields.push({ role: f.role, symbols: body.slice(at, at + f.length) })
    at += f.length
  }
  const byRole = (role: WrCodeFieldRole): string | null =>
    fields.find((f) => f.role === role)?.symbols ?? null

  const canonical = spec.cls + body + check
  return {
    ok: true,
    cls: spec.cls,
    classValues: spec.classValues,
    canonical,
    display: renderReference(spec, fields, check),
    fields,
    publisher: byRole('publisher') ?? '',
    local: byRole('local'),
    counterparty: byRole('counterparty'),
    combination: byRole('combination'),
    check,
  }
}

// ── Rendering [XVI.5.1] ───────────────────────────────────────────────────────

function renderReference(
  spec: WrCodeClassSpec,
  fields: ReadonlyArray<{ role: WrCodeFieldRole; symbols: string }>,
  check: string,
): string {
  const blocks = fields.map((f) => f.symbols)
  if (spec.checkPlacement === 'attached') {
    blocks[blocks.length - 1] += check
    return [spec.cls, ...blocks].join('-')
  }
  return [spec.cls, ...blocks, check].join('-')
}

/**
 * Re-derive the grouped rendering from a stored grammar-v2 canonical string.
 * Returns null for anything that does not capture — a stored value that fails
 * its own grammar is never rendered [P12].
 */
export function formatWrCodeReferenceForDisplay(canonical: string): string | null {
  const captured = captureWrCodeReference(canonical)
  return captured.ok ? captured.display : null
}

// ── Generation ────────────────────────────────────────────────────────────────

/**
 * Compute the §XVI.5.4 check symbol for a class and its address body (blocks
 * concatenated, canonical symbols). Emission-time counterpart of capture.
 */
export function computeWrCodeCheckSymbol(cls: WrCodeClass, body: string): string | null {
  const spec = WR_CODE_CLASS_SPECS[cls]
  if (body.length !== wrCodeBodyLength(cls)) return null
  let normalized = ''
  for (const ch of body) {
    const mapped = aliasBodySymbol(ch)
    if (mapped === null) return null
    normalized += mapped
  }
  return computeCheck(checkStem(spec, normalized))
}

/**
 * Assemble a complete reference from its address blocks (declaration order),
 * computing the check. Returns the same fully framed result as capture, so
 * fixtures and emitters cannot construct a reference that would not re-capture.
 */
export function buildWrCodeReference(cls: WrCodeClass, blocks: readonly string[]): WrCodeCaptureResult {
  const spec = WR_CODE_CLASS_SPECS[cls]
  if (blocks.length !== spec.fields.length) {
    return failCapture('wrong_length', `${cls} declares ${spec.fields.length} address fields, got ${blocks.length}`)
  }
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].length !== spec.fields[i].length) {
      return failCapture('wrong_length', `${cls} field ${spec.fields[i].role} expects ${spec.fields[i].length} symbols`)
    }
  }
  const body = blocks.join('')
  const check = computeWrCodeCheckSymbol(cls, body)
  if (check === null) return failCapture('out_of_alphabet')
  return captureWrCodeReference(cls + body + check)
}

// ── Detection [XVI.5.4, XVI.7.5 email slice] ─────────────────────────────────

/**
 * Candidate scanner for free text (email bodies, clipboard, selection). The
 * regex is prefix-aware and length-bounded per §XVI.5.8; every hit is then
 * pushed through the capture gate, so only check-verified references are ever
 * emitted — a near-miss is silence, not a guess [XVI.5.9].
 *
 * Scans the hyphen-grouped renderings and the ungrouped form. Space-grouped
 * entry (§XVI.5.5) is a MANUAL-ENTRY affordance handled by the capture gate;
 * in free text a space is indistinguishable from the boundary between two
 * adjacent references, so detection treats it as a boundary (fail-closed:
 * a missed convenience, never a merged or truncated candidate).
 */
const DETECTION_PATTERN =
  /(?<![0-9A-Za-z])(?:SP|SI|SC|SE|P|I|C)(?:-?[0-9A-Za-z]){12,13}(?!-?[0-9A-Za-z])/gi

/** Longest text detection will scan; matches the email slice's own cap. */
export const WR_CODE_DETECTION_MAX_TEXT_LENGTH = 65536

export interface WrCodeDetection {
  reference: WrCodeReference
  /** The matched slice exactly as it appeared in the text. */
  raw: string
  index: number
}

export function detectWrCodeReferences(text: string, limit = 16): WrCodeDetection[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const scan = text.length > WR_CODE_DETECTION_MAX_TEXT_LENGTH ? text.slice(0, WR_CODE_DETECTION_MAX_TEXT_LENGTH) : text
  const out: WrCodeDetection[] = []
  const seen = new Set<string>()
  DETECTION_PATTERN.lastIndex = 0
  for (const match of scan.matchAll(DETECTION_PATTERN)) {
    const captured = captureWrCodeReference(match[0])
    if (!captured.ok) continue
    if (seen.has(captured.canonical)) continue
    seen.add(captured.canonical)
    out.push({ reference: captured, raw: match[0], index: match.index ?? 0 })
    if (out.length >= limit) break
  }
  return out
}

// ── Stored-value classification (persistence sweep) ─────────────────────────

export type StoredWrCodeShape = 'reference_v2' | 'legacy_baseline' | 'invalid'

/**
 * Classify a STORED canonical value without accepting it: a grammar-v2
 * canonical re-captures; an old prefix-less Baseline Code (12+ symbols whose
 * plain Damm fold closes) is recognizably legacy so migration/read paths can
 * mark it terminal instead of deleting it; everything else is invalid. Legacy
 * values are NEVER valid references — this is a classifier, not an acceptor.
 */
export function classifyStoredWrCodeValue(value: string | null | undefined): StoredWrCodeShape {
  if (typeof value !== 'string' || value.length === 0) return 'invalid'
  if (captureWrCodeReference(value).ok) return 'reference_v2'
  const symbols = foldedSymbols(value)
  if (symbols.length >= 12) {
    let normalized = ''
    for (const ch of symbols) {
      const mapped = aliasBodySymbol(ch)
      if (mapped === null) return 'invalid'
      normalized += mapped
    }
    if (verifyCheck(normalized)) return 'legacy_baseline'
  }
  return 'invalid'
}
