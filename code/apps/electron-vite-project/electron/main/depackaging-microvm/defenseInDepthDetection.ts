/**
 * Defense-in-depth threat detection (L3).
 *
 * Detects code constructs, hidden/control characters, and BEAP carrier markers
 * in plain text fields. This is a NON-LOAD-BEARING layer: the primary no-code
 * guarantee comes from inert-sink discipline (L1) and the character blocklist
 * (L2). Detection serves as defense-in-depth — findings fail closed but the
 * gate is provenance (VM-identity signature) + schema re-validation.
 *
 * ALIGNMENT WITH safeText.ts:
 *   The hidden/control char ranges match FORBIDDEN_PLAINTEXT_RE exactly:
 *     C0 (0x00–0x08, 0x0B–0x1F), DEL (0x7F), C1 (0x80–0x9F),
 *     bidi/format (U+200B–200F, U+202A–202E, U+2060–2064, U+2066–2069),
 *     BOM (U+FEFF).
 */

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

// ── Code/eval/function construct patterns ────────────────────────────────

function escapeForRegex(literal: string): RegExp {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'i')
}

const CODE_CONSTRUCT_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: escapeForRegex('eval('), label: 'eval(' },
  { re: escapeForRegex('Function('), label: 'Function(' },
  { re: escapeForRegex('setTimeout('), label: 'setTimeout(' },
  { re: escapeForRegex('setInterval('), label: 'setInterval(' },
  { re: escapeForRegex('import('), label: 'import(' },
  { re: escapeForRegex('require('), label: 'require(' },
  { re: escapeForRegex('<script'), label: '<script' },
  { re: escapeForRegex('javascript:'), label: 'javascript:' },
  { re: escapeForRegex('vbscript:'), label: 'vbscript:' },
  { re: escapeForRegex('data:text/html'), label: 'data:text/html' },
  { re: escapeForRegex('expression('), label: 'expression(' },
  { re: escapeForRegex('url('), label: 'url(' },
  { re: escapeForRegex('.constructor'), label: '.constructor' },
]

// ── Hidden/zero-width/control char detection ─────────────────────────────
// Ranges identical to FORBIDDEN_PLAINTEXT_RE in safeText.ts.

// eslint-disable-next-line no-control-regex
const HIDDEN_CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

// ── BEAP carrier marker patterns ────────────────────────────────────────

const BEAP_CARRIER_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: escapeForRegex('schema_version'), label: 'schema_version' },
  { re: escapeForRegex('capsule_type'), label: 'capsule_type' },
]

// ── Main text-level detection ────────────────────────────────────────────

/**
 * Run all text-level threat detection categories on the given text.
 * Works on plain (unpadded) text — padding has been removed from the system.
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
