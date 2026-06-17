/**
 * Exhaustive tests for the padding-aware detection suite (Phase 1.2).
 *
 * Verifies that every detection category works on BOTH padded and unpadded
 * forms, that U+FFFC is NOT mis-flagged as a hidden char, and that no
 * stripped/reconstituted form leaks from the detection result.
 */

import { describe, test, expect } from 'vitest'
import { pad, padLayers, PAD_CHAR } from '../padTransform'
import {
  detectThreats,
  detectSafeTextSchemeViolations,
  paddedLengthCap,
  type DetectionResult,
  type DetectionCategory,
} from '../paddingAwareDetection'
import { SAFE_TEXT_LIMITS, SAFE_TEXT_SCHEMA } from '../safeText'

// ── Helpers ────────────────────────────────────────────────────────────────

function hasCategory(result: DetectionResult, cat: DetectionCategory): boolean {
  return result.findings.some((f) => f.category === cat)
}

function hasDetail(result: DetectionResult, detail: string): boolean {
  return result.findings.some((f) => f.detail === detail)
}

function validSafeText(overrides: Record<string, unknown> = {}) {
  return {
    schema: SAFE_TEXT_SCHEMA,
    subject: 'Hello',
    body_text: 'A clean message with no threats.',
    attachment_refs: [],
    ...overrides,
  }
}

// ── Clean text passes ─────────────────────────────────────────────────────

describe('clean text passes (no findings)', () => {
  const cleanInputs = [
    'Hello, this is a normal email.',
    'Meeting tomorrow at 10am. Please confirm.',
    '你好，明天会议请确认。',
    'Résumé für die Bewerbung anbei.',
    'مرحبا بكم في الاجتماع',
    '😀 Great job on the project! 🎉',
    '',
    'A'.repeat(500),
  ]

  for (const input of cleanInputs) {
    test(`unpadded: "${input.slice(0, 40)}..."`, () => {
      const result = detectThreats(input)
      expect(result.pass).toBe(true)
      expect(result.findings).toHaveLength(0)
    })

    test(`padded (1 layer): "${input.slice(0, 30)}..."`, () => {
      const result = detectThreats(pad(input))
      expect(result.pass).toBe(true)
      expect(result.findings).toHaveLength(0)
    })

    test(`padded (3 layers): "${input.slice(0, 30)}..."`, () => {
      const result = detectThreats(padLayers(input, 3))
      expect(result.pass).toBe(true)
      expect(result.findings).toHaveLength(0)
    })
  }
})

// ── Code construct detection ──────────────────────────────────────────────

describe('code construct detection — unpadded', () => {
  const threats: [string, string][] = [
    ['eval(', 'some text eval(something)'],
    ['Function(', 'new Function(code)'],
    ['setTimeout(', 'setTimeout(fn, 100)'],
    ['setInterval(', 'setInterval(fn, 50)'],
    ['import(', 'import(module)'],
    ['require(', 'require(path)'],
    ['<script', '<script>alert(1)</script>'],
    ['javascript:', 'javascript:void(0)'],
    ['vbscript:', 'vbscript:msgbox'],
    ['data:text/html', 'data:text/html,<h1>hi</h1>'],
    ['expression(', 'expression(document.cookie)'],
    ['url(', 'background: url(evil.png)'],
    ['.constructor', 'obj.constructor.prototype'],
  ]

  for (const [label, input] of threats) {
    test(`detects ${label} unpadded`, () => {
      const result = detectThreats(input)
      expect(result.pass).toBe(false)
      expect(hasCategory(result, 'code_construct')).toBe(true)
      expect(hasDetail(result, label)).toBe(true)
    })
  }
})

describe('code construct detection — padded (1 layer)', () => {
  const threats: [string, string][] = [
    ['eval(', 'some text eval(something) end'],
    ['Function(', 'x new Function(code) y end here'],
    ['<script', 'text before <script>alert(1)</script> text after'],
    ['javascript:', 'click javascript:void(0) here'],
    ['.constructor', 'obj.constructor.prototype.hack'],
  ]

  for (const [label, input] of threats) {
    test(`detects ${label} in padded text`, () => {
      const padded = pad(input)
      const result = detectThreats(padded)
      expect(result.pass).toBe(false)
      expect(hasCategory(result, 'code_construct')).toBe(true)
      expect(hasDetail(result, label)).toBe(true)
    })
  }
})

describe('code construct detection — padded (3 layers)', () => {
  test('detects eval( through 3 padding layers', () => {
    const input = 'preamble text eval(dangerous) postamble'
    const padded3 = padLayers(input, 3)
    const result = detectThreats(padded3)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'eval(')).toBe(true)
  })

  test('detects <script through 3 padding layers', () => {
    const input = 'before <script>alert(1)</script> after'
    const padded3 = padLayers(input, 3)
    const result = detectThreats(padded3)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, '<script')).toBe(true)
  })
})

describe('code construct detection — case insensitive', () => {
  test('EVAL( detected', () => {
    expect(hasDetail(detectThreats('EVAL(x)'), 'eval(')).toBe(true)
  })
  test('JavaScript: detected', () => {
    expect(hasDetail(detectThreats('JavaScript:void(0)'), 'javascript:')).toBe(true)
  })
  test('<SCRIPT detected', () => {
    expect(hasDetail(detectThreats('<SCRIPT SRC=x>'), '<script')).toBe(true)
  })
  test('FUNCTION( detected', () => {
    expect(hasDetail(detectThreats('new FUNCTION(x)'), 'Function(')).toBe(true)
  })
})

describe('code constructs — no false positives on partial matches', () => {
  test('"evaluation" does not trigger eval(', () => {
    expect(detectThreats('The evaluation was positive.').pass).toBe(true)
  })
  test('"functional" does not trigger Function(', () => {
    expect(detectThreats('A functional approach.').pass).toBe(true)
  })
  test('"description" does not trigger <script', () => {
    expect(detectThreats('This is a description of the task.').pass).toBe(true)
  })
  test('"constructor" without dot prefix does not trigger .constructor', () => {
    expect(detectThreats('The constructor was called.').pass).toBe(true)
  })
  test('"import" without paren does not trigger import(', () => {
    expect(detectThreats('Please import the data.').pass).toBe(true)
  })
})

// ── Hidden/control char detection ─────────────────────────────────────────

describe('hidden/control char detection', () => {
  test('detects NUL (U+0000)', () => {
    const result = detectThreats('hello\u0000world')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+0000')).toBe(true)
  })

  test('detects BEL (U+0007)', () => {
    const result = detectThreats('text\u0007here')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+0007')).toBe(true)
  })

  test('detects ESC (U+001B)', () => {
    const result = detectThreats('escape\u001B[0m')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+001B')).toBe(true)
  })

  test('detects zero-width space (U+200B)', () => {
    const result = detectThreats('zero\u200Bwidth')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+200B')).toBe(true)
  })

  test('detects RTL override (U+202E)', () => {
    const result = detectThreats('rtl\u202Eoverride')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+202E')).toBe(true)
  })

  test('detects BOM (U+FEFF)', () => {
    const result = detectThreats('\uFEFFtext with bom')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+FEFF')).toBe(true)
  })

  test('detects DEL (U+007F)', () => {
    const result = detectThreats('del\u007Fchar')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+007F')).toBe(true)
  })

  test('detects C1 control (U+0085 NEL)', () => {
    const result = detectThreats('c1\u0085control')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+0085')).toBe(true)
  })

  test('detects word joiner (U+2060)', () => {
    const result = detectThreats('word\u2060joiner')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'U+2060')).toBe(true)
  })

  test('reports multiple distinct hidden chars', () => {
    const result = detectThreats('a\u0000b\u200Bc\uFEFFd')
    expect(result.pass).toBe(false)
    expect(result.findings.filter((f) => f.category === 'hidden_control_char').length).toBe(3)
  })

  test('does NOT flag tab (U+0009)', () => {
    const result = detectThreats('line1\tindented')
    expect(hasCategory(result, 'hidden_control_char')).toBe(false)
  })

  test('does NOT flag newline (U+000A)', () => {
    const result = detectThreats('line1\nline2')
    expect(hasCategory(result, 'hidden_control_char')).toBe(false)
  })
})

describe('U+FFFC (PAD_CHAR) is NOT mis-flagged as a hidden char', () => {
  test('string of PAD chars only → pass (no hidden_control_char)', () => {
    const result = detectThreats(PAD_CHAR.repeat(50))
    expect(hasCategory(result, 'hidden_control_char')).toBe(false)
  })

  test('padded text has no hidden_control_char findings from PAD', () => {
    const clean = 'A normal email message here.'
    const padded = pad(clean)
    expect(padded).toContain(PAD_CHAR) // sanity: PAD was inserted
    const result = detectThreats(padded)
    expect(hasCategory(result, 'hidden_control_char')).toBe(false)
  })

  test('3-layer padded clean text → no hidden_control_char', () => {
    const padded3 = padLayers('Hello, this is a clean message with enough text.', 3)
    const result = detectThreats(padded3)
    expect(hasCategory(result, 'hidden_control_char')).toBe(false)
  })

  test('hidden char detected even in padded text (NUL + PADs)', () => {
    const withNul = 'abcdefghij\u0000klmnopqrst'
    const padded = pad(withNul)
    const result = detectThreats(padded)
    expect(hasCategory(result, 'hidden_control_char')).toBe(true)
    expect(hasDetail(result, 'U+0000')).toBe(true)
  })
})

// ── BEAP carrier marker detection ─────────────────────────────────────────

describe('BEAP carrier marker detection', () => {
  test('detects schema_version unpadded', () => {
    const result = detectThreats('{"schema_version":"1.0","capsule_type":"direct"}')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'schema_version')).toBe(true)
  })

  test('detects capsule_type unpadded', () => {
    const result = detectThreats('the capsule_type is direct_beap')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'capsule_type')).toBe(true)
  })

  test('detects schema_version in padded text', () => {
    const input = 'preamble {"schema_version":"2"} postamble text'
    const padded = pad(input)
    const result = detectThreats(padded)
    expect(hasDetail(result, 'schema_version')).toBe(true)
  })

  test('detects capsule_type through 3 padding layers', () => {
    const input = 'hidden capsule_type marker inside plain text here'
    const padded3 = padLayers(input, 3)
    const result = detectThreats(padded3)
    expect(hasDetail(result, 'capsule_type')).toBe(true)
  })

  test('clean text without BEAP markers → no beap_carrier findings', () => {
    expect(hasCategory(detectThreats('just a normal email body'), 'beap_carrier')).toBe(false)
  })
})

// ── Canonical-scheme conformance hooks ───────────────────────────────────

describe('paddedLengthCap', () => {
  test('0 layers → base cap unchanged', () => {
    expect(paddedLengthCap(1000, 0)).toBe(1000)
  })

  test('1 layer: cap + floor(cap / 10)', () => {
    expect(paddedLengthCap(1000, 1)).toBe(1100)
  })

  test('2 layers', () => {
    expect(paddedLengthCap(1000, 2)).toBe(1210)
  })

  test('3 layers', () => {
    expect(paddedLengthCap(1000, 3)).toBe(1331)
  })

  test('MAX_BODY_CHARS, 3 layers', () => {
    const cap = paddedLengthCap(SAFE_TEXT_LIMITS.MAX_BODY_CHARS, 3)
    expect(cap).toBe(1_331_000)
  })

  test('MAX_SUBJECT_CHARS, 3 layers', () => {
    const cap = paddedLengthCap(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS, 3)
    expect(cap).toBe(2662)
  })
})

describe('detectSafeTextSchemeViolations — valid objects', () => {
  test('valid SafeTextV1 with 0 padding layers → pass', () => {
    const result = detectSafeTextSchemeViolations(validSafeText(), 0)
    expect(result.pass).toBe(true)
    expect(result.findings).toHaveLength(0)
  })

  test('valid SafeTextV1 with padded subject/body, 1 layer → pass', () => {
    const obj = validSafeText({
      subject: pad('Short subject'),
      body_text: pad('A longer body message with enough text to pad.'),
    })
    const result = detectSafeTextSchemeViolations(obj, 1)
    expect(result.pass).toBe(true)
  })

  test('valid SafeTextV1 with 3 padded layers → pass', () => {
    const obj = validSafeText({
      subject: padLayers('My Subject', 3),
      body_text: padLayers('Body content here with enough text.', 3),
    })
    const result = detectSafeTextSchemeViolations(obj, 3)
    expect(result.pass).toBe(true)
  })
})

describe('detectSafeTextSchemeViolations — structural violations', () => {
  test('null → not_an_object', () => {
    const result = detectSafeTextSchemeViolations(null, 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'not_an_object')).toBe(true)
  })

  test('array → not_an_object', () => {
    const result = detectSafeTextSchemeViolations([], 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'not_an_object')).toBe(true)
  })

  test('unexpected key', () => {
    const result = detectSafeTextSchemeViolations(validSafeText({ extra: 'bad' }), 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'unexpected_key:extra')).toBe(true)
  })

  test('bad schema tag', () => {
    const result = detectSafeTextSchemeViolations(validSafeText({ schema: 'wrong' }), 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'bad_schema_tag')).toBe(true)
  })

  test('subject not string', () => {
    const result = detectSafeTextSchemeViolations(validSafeText({ subject: 42 }), 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'subject_not_string')).toBe(true)
  })

  test('body_text not string', () => {
    const result = detectSafeTextSchemeViolations(validSafeText({ body_text: null }), 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'body_text_not_string')).toBe(true)
  })

  test('attachment_refs not array', () => {
    const result = detectSafeTextSchemeViolations(validSafeText({ attachment_refs: 'bad' }), 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'attachment_refs_not_array')).toBe(true)
  })

  test('too many attachment_refs', () => {
    const refs = Array.from({ length: 257 }, (_, i) =>
      `${i.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`,
    )
    const result = detectSafeTextSchemeViolations(validSafeText({ attachment_refs: refs }), 0)
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'too_many_attachment_refs')).toBe(true)
  })

  test('bad attachment_ref format', () => {
    const result = detectSafeTextSchemeViolations(
      validSafeText({ attachment_refs: ['not-a-uuid'] }),
      0,
    )
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'bad_attachment_ref')).toBe(true)
  })
})

describe('detectSafeTextSchemeViolations — padding-aware length caps', () => {
  test('subject at base limit with 0 layers → pass', () => {
    const result = detectSafeTextSchemeViolations(
      validSafeText({ subject: 'x'.repeat(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS) }),
      0,
    )
    expect(result.pass).toBe(true)
  })

  test('subject exceeding base limit with 0 layers → fail', () => {
    const result = detectSafeTextSchemeViolations(
      validSafeText({ subject: 'x'.repeat(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS + 1) }),
      0,
    )
    expect(result.pass).toBe(false)
    expect(result.findings.some((f) => f.detail.startsWith('subject_too_long'))).toBe(true)
  })

  test('padded subject within expanded cap for 1 layer → pass', () => {
    const subject = 'x'.repeat(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS)
    const paddedSubject = pad(subject)
    const result = detectSafeTextSchemeViolations(
      validSafeText({ subject: paddedSubject }),
      1,
    )
    expect(result.pass).toBe(true)
  })

  test('padded subject within expanded cap for 3 layers → pass', () => {
    const subject = 'x'.repeat(100)
    const paddedSubject = padLayers(subject, 3)
    const result = detectSafeTextSchemeViolations(
      validSafeText({ subject: paddedSubject }),
      3,
    )
    expect(result.pass).toBe(true)
  })

  test('artificially inflated subject beyond padded cap → fail', () => {
    const maxPadded = paddedLengthCap(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS, 1)
    const result = detectSafeTextSchemeViolations(
      validSafeText({ subject: 'x'.repeat(maxPadded + 1) }),
      1,
    )
    expect(result.pass).toBe(false)
    expect(result.findings.some((f) => f.detail.startsWith('subject_too_long'))).toBe(true)
  })
})

// ── No stripped form leaks from detection result ──────────────────────────

describe('no stripped/reconstituted form in detection result', () => {
  test('DetectionResult contains only pass and findings (no text fields)', () => {
    const input = 'text with eval(x) and \u0000 hidden'
    const result = detectThreats(pad(input))
    expect(Object.keys(result).sort()).toEqual(['findings', 'pass'])
    for (const f of result.findings) {
      expect(Object.keys(f).sort()).toEqual(['category', 'detail'])
      expect(typeof f.category).toBe('string')
      expect(typeof f.detail).toBe('string')
      expect(f.detail).not.toContain('eval(x)')
    }
  })

  test('scheme result contains only pass and findings', () => {
    const result = detectSafeTextSchemeViolations(validSafeText({ extra: 'bad' }), 0)
    expect(Object.keys(result).sort()).toEqual(['findings', 'pass'])
  })
})

// ── Combined: multiple categories in one pass ─────────────────────────────

describe('combined: multiple threat categories in a single text', () => {
  test('code construct + hidden char + BEAP carrier', () => {
    const input = 'eval(x) \u0000 schema_version found'
    const result = detectThreats(input)
    expect(result.pass).toBe(false)
    expect(hasCategory(result, 'code_construct')).toBe(true)
    expect(hasCategory(result, 'hidden_control_char')).toBe(true)
    expect(hasCategory(result, 'beap_carrier')).toBe(true)
  })

  test('same combined threats detected on padded form', () => {
    const input = 'eval(x) \u0000 capsule_type here text pad'
    const padded = pad(input)
    const result = detectThreats(padded)
    expect(result.pass).toBe(false)
    expect(hasCategory(result, 'code_construct')).toBe(true)
    expect(hasCategory(result, 'hidden_control_char')).toBe(true)
    expect(hasCategory(result, 'beap_carrier')).toBe(true)
  })
})
