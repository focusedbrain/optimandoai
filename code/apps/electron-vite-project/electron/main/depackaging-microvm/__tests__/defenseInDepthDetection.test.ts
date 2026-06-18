/**
 * Tests for the defense-in-depth detection suite (L3).
 *
 * Verifies that every detection category works on plain text,
 * and that no stripped/reconstituted form leaks from the detection result.
 */

import { describe, test, expect } from 'vitest'
import {
  detectThreats,
  type DetectionResult,
  type DetectionCategory,
} from '../defenseInDepthDetection'

// ── Helpers ────────────────────────────────────────────────────────────────

function hasCategory(result: DetectionResult, cat: DetectionCategory): boolean {
  return result.findings.some((f) => f.category === cat)
}

function hasDetail(result: DetectionResult, detail: string): boolean {
  return result.findings.some((f) => f.detail === detail)
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
    test(`"${input.slice(0, 40)}..."`, () => {
      const result = detectThreats(input)
      expect(result.pass).toBe(true)
      expect(result.findings).toHaveLength(0)
    })
  }
})

// ── Code construct detection ──────────────────────────────────────────────

describe('code construct detection', () => {
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
    test(`detects ${label}`, () => {
      const result = detectThreats(input)
      expect(result.pass).toBe(false)
      expect(hasCategory(result, 'code_construct')).toBe(true)
      expect(hasDetail(result, label)).toBe(true)
    })
  }
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

// ── BEAP carrier marker detection ─────────────────────────────────────────

describe('BEAP carrier marker detection', () => {
  test('detects schema_version', () => {
    const result = detectThreats('{"schema_version":"1.0","capsule_type":"direct"}')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'schema_version')).toBe(true)
  })

  test('detects capsule_type', () => {
    const result = detectThreats('the capsule_type is direct_beap')
    expect(result.pass).toBe(false)
    expect(hasDetail(result, 'capsule_type')).toBe(true)
  })

  test('clean text without BEAP markers → no beap_carrier findings', () => {
    expect(hasCategory(detectThreats('just a normal email body'), 'beap_carrier')).toBe(false)
  })
})

// ── No stripped form leaks from detection result ──────────────────────────

describe('no stripped/reconstituted form in detection result', () => {
  test('DetectionResult contains only pass and findings (no text fields)', () => {
    const input = 'text with eval(x) and \u0000 hidden'
    const result = detectThreats(input)
    expect(Object.keys(result).sort()).toEqual(['findings', 'pass'])
    for (const f of result.findings) {
      expect(Object.keys(f).sort()).toEqual(['category', 'detail'])
      expect(typeof f.category).toBe('string')
      expect(typeof f.detail).toBe('string')
      expect(f.detail).not.toContain('eval(x)')
    }
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
})
