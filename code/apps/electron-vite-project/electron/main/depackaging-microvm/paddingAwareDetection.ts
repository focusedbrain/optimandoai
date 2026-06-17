/**
 * Padding-aware detection suite (Phase 1.2).
 *
 * Detects threats in text that may carry PAD characters (U+FFFC) from one
 * or more padding layers, WITHOUT reconstituting executable text in any
 * runnable context.
 *
 * DESIGN DECISION (from analysis — padding-aware matching, not strip-to-detect):
 *   Every detection category uses patterns that treat U+FFFC as transparent
 *   (stride-tolerant regex for multi-char tokens, single-char class for
 *   hidden/control chars). No stripped/reconstituted form is stored, returned,
 *   or passed onward. A local throwaway buffer is never needed because all
 *   categories work directly on the padded form:
 *     - code_construct:      stride-tolerant regex (U+FFFC* between each char)
 *     - hidden_control_char: single-char class — U+FFFC is outside all ranges
 *     - beap_carrier:        stride-tolerant regex
 *     - canonical_scheme:    structural object checks, length caps inflated
 *
 * ALIGNMENT WITH safeText.ts:
 *   The hidden/control char ranges match FORBIDDEN_PLAINTEXT_RE exactly:
 *     C0 (0x00–0x08, 0x0B–0x1F), DEL (0x7F), C1 (0x80–0x9F),
 *     bidi/format (U+200B–200F, U+202A–202E, U+2060–2064, U+2066–2069),
 *     BOM (U+FEFF).
 *   U+FFFC is NOT in any of these ranges — padding characters are never
 *   mis-flagged as hidden chars.
 *
 * FAIL-CLOSED: any finding → caller halts the validation chain. This lib
 * reports; the caller enforces.
 */

import { PAD_CHAR, STRIDE } from './padTransform'
import { SAFE_TEXT_SCHEMA, SAFE_TEXT_LIMITS } from './safeText'

// ── Types ──────────────────────────────────────────────────────────────────

export type DetectionCategory =
  | 'code_construct'
  | 'hidden_control_char'
  | 'canonical_scheme'
  | 'beap_carrier'

export interface DetectionFinding {
  readonly category: DetectionCategory
  readonly detail: string
}

export interface DetectionResult {
  readonly pass: boolean
  readonly findings: readonly DetectionFinding[]
}

// ── Stride-tolerant regex builder ─────────────────────────────────────────

/**
 * Build a regex that matches `literal` with zero or more U+FFFC (PAD) chars
 * allowed between each consecutive original code point. Handles multi-layer
 * padding (multiple consecutive PADs) and no padding (zero PADs).
 *
 * The result never reconstitutes executable text — the regex engine inspects
 * the padded form directly.
 */
function padTolerant(literal: string, flags = 'i'): RegExp {
  const cps = [...literal]
  const parts = cps.map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const padOpt = `${PAD_CHAR}*`
  return new RegExp(parts.join(padOpt), flags)
}

// ── Code/eval/function construct patterns ────────────────────────────────
// Each is case-insensitive and stride-tolerant (U+FFFC* between each char).
// These are the exact tokens from the architecture analysis spec.

const CODE_CONSTRUCT_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: padTolerant('eval('), label: 'eval(' },
  { re: padTolerant('Function('), label: 'Function(' },
  { re: padTolerant('setTimeout('), label: 'setTimeout(' },
  { re: padTolerant('setInterval('), label: 'setInterval(' },
  { re: padTolerant('import('), label: 'import(' },
  { re: padTolerant('require('), label: 'require(' },
  { re: padTolerant('<script'), label: '<script' },
  { re: padTolerant('javascript:'), label: 'javascript:' },
  { re: padTolerant('vbscript:'), label: 'vbscript:' },
  { re: padTolerant('data:text/html'), label: 'data:text/html' },
  { re: padTolerant('expression('), label: 'expression(' },
  { re: padTolerant('url('), label: 'url(' },
  { re: padTolerant('.constructor'), label: '.constructor' },
]

// ── Hidden/zero-width/control char detection ─────────────────────────────
// Ranges identical to FORBIDDEN_PLAINTEXT_RE in safeText.ts.
// U+FFFC (PAD_CHAR) is NOT in any of these ranges.

// eslint-disable-next-line no-control-regex
const HIDDEN_CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

// ── BEAP carrier marker patterns ────────────────────────────────────────
// Detects BEAP-package-like JSON markers embedded in what should be plain
// text — a carrier-smuggling signal.

const BEAP_CARRIER_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: padTolerant('schema_version'), label: 'schema_version' },
  { re: padTolerant('capsule_type'), label: 'capsule_type' },
]

// ── Main text-level detection ────────────────────────────────────────────

/**
 * Run all text-level threat detection categories on the given text.
 *
 * Works on padded text (any number of layers) and unpadded text alike.
 * No stripped/reconstituted form is created, stored, or returned.
 */
export function detectThreats(text: string): DetectionResult {
  const findings: DetectionFinding[] = []

  for (const { re, label } of CODE_CONSTRUCT_PATTERNS) {
    if (re.test(text)) {
      findings.push({ category: 'code_construct', detail: label })
    }
  }

  HIDDEN_CONTROL_RE.lastIndex = 0
  const hiddenMatches = text.match(HIDDEN_CONTROL_RE)
  if (hiddenMatches) {
    const seen = new Set<string>()
    for (const ch of hiddenMatches) {
      const cp = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
      if (!seen.has(cp)) {
        seen.add(cp)
        findings.push({ category: 'hidden_control_char', detail: cp })
      }
    }
  }

  for (const { re, label } of BEAP_CARRIER_PATTERNS) {
    if (re.test(text)) {
      findings.push({ category: 'beap_carrier', detail: label })
    }
  }

  return { pass: findings.length === 0, findings }
}

// ── Canonical-scheme conformance hooks ───────────────────────────────────

/**
 * Compute the maximum length a text field can reach after `layers` padding
 * layers, given the original (unpadded) cap.
 *
 * Each layer: output_len = input_len + floor(input_len / STRIDE).
 */
export function paddedLengthCap(baseCap: number, layers: number): number {
  let cap = baseCap
  for (let i = 0; i < layers; i++) {
    cap = cap + Math.floor(cap / STRIDE)
  }
  return cap
}

/** Permitted top-level keys — mirrors the closed-world allowlist in safeText.ts. */
const SCHEME_ALLOWED_KEYS = new Set(['schema', 'subject', 'body_text', 'attachment_refs'])

/**
 * Structural SafeTextV1 conformance check with padding-expansion-aware length
 * caps. Intended for intermediate validation stages where text fields are padded.
 *
 * `paddingLayers`: how many padding layers have been applied so far (inflates
 * the length caps accordingly).
 */
export function detectSafeTextSchemeViolations(
  obj: unknown,
  paddingLayers: number,
): DetectionResult {
  const findings: DetectionFinding[] = []

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    findings.push({ category: 'canonical_scheme', detail: 'not_an_object' })
    return { pass: false, findings }
  }

  const rec = obj as Record<string, unknown>

  for (const key of Object.keys(rec)) {
    if (!SCHEME_ALLOWED_KEYS.has(key)) {
      findings.push({ category: 'canonical_scheme', detail: `unexpected_key:${key}` })
    }
  }

  if (rec.schema !== SAFE_TEXT_SCHEMA) {
    findings.push({ category: 'canonical_scheme', detail: 'bad_schema_tag' })
  }

  if (typeof rec.subject !== 'string') {
    findings.push({ category: 'canonical_scheme', detail: 'subject_not_string' })
  }
  if (typeof rec.body_text !== 'string') {
    findings.push({ category: 'canonical_scheme', detail: 'body_text_not_string' })
  }
  if (!Array.isArray(rec.attachment_refs)) {
    findings.push({ category: 'canonical_scheme', detail: 'attachment_refs_not_array' })
  }

  const maxSubject = paddedLengthCap(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS, paddingLayers)
  const maxBody = paddedLengthCap(SAFE_TEXT_LIMITS.MAX_BODY_CHARS, paddingLayers)

  if (typeof rec.subject === 'string' && rec.subject.length > maxSubject) {
    findings.push({
      category: 'canonical_scheme',
      detail: `subject_too_long:${rec.subject.length}>${maxSubject}`,
    })
  }
  if (typeof rec.body_text === 'string' && rec.body_text.length > maxBody) {
    findings.push({
      category: 'canonical_scheme',
      detail: `body_text_too_long:${rec.body_text.length}>${maxBody}`,
    })
  }

  if (Array.isArray(rec.attachment_refs)) {
    if (rec.attachment_refs.length > SAFE_TEXT_LIMITS.MAX_ATTACHMENT_REFS) {
      findings.push({ category: 'canonical_scheme', detail: 'too_many_attachment_refs' })
    }
    for (const ref of rec.attachment_refs) {
      if (typeof ref !== 'string' || !SAFE_TEXT_LIMITS.BLOB_ID_RE.test(ref)) {
        findings.push({ category: 'canonical_scheme', detail: 'bad_attachment_ref' })
        break
      }
    }
  }

  return { pass: findings.length === 0, findings }
}
