/**
 * Step 2 — Inert-sink audit tests.
 *
 * Proves the layered security model:
 *   L1: inert sinks (no executable context) — tested by source-level invariants
 *   L2: character blocklist (toPlainTextField/FORBIDDEN_PLAINTEXT_RE) — unchanged
 *   L5: structural positive construction (closed-key, type-safe, blob-UUID-gated)
 *
 * Hard constraint: legitimate email content with code-like punctuation (<, >, {,
 * }, =, ;) must pass through INTACT — the blocklist is hygiene, not an allowlist.
 */

import { describe, test, expect } from 'vitest'
import {
  toPlainTextField,
  constructSafeText,
  validateSafeText,
  SAFE_TEXT_SCHEMA,
  SAFE_TEXT_LIMITS,
} from '../safeText'

// ═══════════════════════════════════════════════════════════════════════════════
// L2 — Blocklist unchanged: still strips control/bidi/zero-width/BOM
// ═══════════════════════════════════════════════════════════════════════════════

describe('L2 blocklist — toPlainTextField strips control/bidi/zero-width/BOM', () => {
  test('C0 controls (NUL through US, except tab/LF/CR) are stripped; CR normalizes to LF', () => {
    const c0NoLfCr = '\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000B\u000C\u000E\u000F\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F'
    const result = toPlainTextField(`before${c0NoLfCr}after`, 10_000)
    expect(result).toBe('beforeafter')
    // CR alone normalizes to LF (not stripped)
    expect(toPlainTextField('a\rb', 10_000)).toBe('a\nb')
  })

  test('tab and newline are preserved (not stripped)', () => {
    const result = toPlainTextField('line1\tindented\nline2', 10_000)
    expect(result).toBe('line1\tindented\nline2')
  })

  test('CRLF and CR are normalized to LF', () => {
    const result = toPlainTextField('a\r\nb\rc', 10_000)
    expect(result).toBe('a\nb\nc')
  })

  test('DEL (0x7F) and C1 controls (0x80-0x9F) are stripped', () => {
    const result = toPlainTextField('A\u007FB\u0080C\u009FD', 10_000)
    expect(result).toBe('ABCD')
  })

  test('Unicode bidi overrides (U+202A-202E) are stripped', () => {
    const result = toPlainTextField('ok\u202Ahidden\u202Emore\u202Cend', 10_000)
    expect(result).toBe('okhiddenmoreend')
  })

  test('zero-width chars (U+200B-200F) are stripped', () => {
    const result = toPlainTextField('vis\u200Bible\u200C\u200D\u200E\u200F', 10_000)
    expect(result).toBe('visible')
  })

  test('BOM (U+FEFF) is stripped', () => {
    const result = toPlainTextField('\uFEFFHello', 10_000)
    expect(result).toBe('Hello')
  })

  test('word joiners and invisible separators (U+2060-2064) are stripped', () => {
    const result = toPlainTextField('a\u2060b\u2061c\u2064d', 10_000)
    expect(result).toBe('abcd')
  })

  test('isolate marks (U+2066-2069) are stripped', () => {
    const result = toPlainTextField('x\u2066y\u2067z\u2068w\u2069v', 10_000)
    expect(result).toBe('xyzwv')
  })
})

describe('L2 blocklist — validateSafeText rejects forbidden chars', () => {
  test('NUL in subject → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'has\u0000null',
      body_text: 'ok',
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('subject_control_chars')
  })

  test('bidi override in body_text → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: 'has\u202Ebidi',
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('body_text_control_chars')
  })

  test('BOM in body_text → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: '\uFEFFbom',
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('body_text_control_chars')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Legitimate code-like punctuation passes intact (no character allowlist)
// ═══════════════════════════════════════════════════════════════════════════════

describe('legitimate email content with code-like punctuation passes through', () => {
  const codeLikeBody = [
    'Hi, please see the config below:',
    '',
    'if (x < 10 && y > 5) {',
    '  result = compute(a, b);',
    '}',
    '',
    'The formula is: price = base * (1 + tax_rate);',
    'Use <strong> tags in HTML (but this is plain text).',
    'JSON example: {"key": "value", "count": 42}',
    'Template: ${variable} and `backticks`',
    'Comparison: a >= b, c <= d, e != f',
    'Email footer: Copyright © 2025 <company@example.com>',
  ].join('\n')

  test('toPlainTextField preserves all code-like characters', () => {
    const result = toPlainTextField(codeLikeBody, 1_000_000)
    expect(result).toBe(codeLikeBody)
  })

  test('constructSafeText preserves code-like body intact', () => {
    const safe = constructSafeText({
      subjectRaw: 'Re: Config update (v2.1) — action required!',
      plainTextBodyRaw: codeLikeBody,
      attachmentBlobIds: [],
    })
    expect(safe.body_text).toBe(codeLikeBody)
    expect(safe.subject).toBe('Re: Config update (v2.1) — action required!')
  })

  test('validateSafeText accepts code-like content', () => {
    const safe = constructSafeText({
      subjectRaw: 'Re: <script>alert(1)</script>',
      plainTextBodyRaw: codeLikeBody,
      attachmentBlobIds: [],
    })
    const validation = validateSafeText(safe)
    expect(validation.ok).toBe(true)
  })

  test('angle brackets, braces, semicolons, equals survive round-trip', () => {
    const chars = '<>{}();=|&!@#$%^*+-/\\~`"\'[]'
    const result = toPlainTextField(chars, 10_000)
    expect(result).toBe(chars)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// L5 — Structural positive construction: closed-key, type checks, blob-UUID
// ═══════════════════════════════════════════════════════════════════════════════

describe('L5 structural positive construction — validateSafeText rejects violations', () => {
  test('extra top-level key → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: 'ok',
      attachment_refs: [],
      html_body: '<script>evil</script>',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unexpected_key:html_body')
  })

  test('wrong schema tag → rejected', () => {
    const result = validateSafeText({
      schema: 'safe-text/v2',
      subject: 'ok',
      body_text: 'ok',
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_schema_tag')
  })

  test('subject as number (type confusion) → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 42,
      body_text: 'ok',
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('subject_not_string')
  })

  test('body_text as object (type confusion) → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: { toString: () => '<script>evil</script>' },
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('body_text_not_string')
  })

  test('attachment_refs as string (not array) → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: 'ok',
      attachment_refs: 'not-an-array',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('attachment_refs_not_array')
  })

  test('malformed blob ID in attachment_refs → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: 'ok',
      attachment_refs: ['../../etc/passwd'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_attachment_ref')
  })

  test('well-formed blob UUID in attachment_refs → accepted', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: 'ok',
      attachment_refs: ['a1b2c3d4-e5f6-7890-abcd-ef0123456789'],
    })
    expect(result.ok).toBe(true)
  })

  test('subject exceeding MAX_SUBJECT_CHARS → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'A'.repeat(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS + 1),
      body_text: 'ok',
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('subject_too_long')
  })

  test('body_text exceeding MAX_BODY_CHARS → rejected', () => {
    const result = validateSafeText({
      schema: SAFE_TEXT_SCHEMA,
      subject: 'ok',
      body_text: 'B'.repeat(SAFE_TEXT_LIMITS.MAX_BODY_CHARS + 1),
      attachment_refs: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('body_text_too_long')
  })

  test('null input → rejected', () => {
    expect(validateSafeText(null).ok).toBe(false)
  })

  test('array input → rejected', () => {
    expect(validateSafeText([]).ok).toBe(false)
  })

  test('primitive input → rejected', () => {
    expect(validateSafeText('not-an-object').ok).toBe(false)
  })
})

describe('L5 structural positive construction — constructSafeText enforces limits', () => {
  test('constructSafeText truncates oversized subject', () => {
    const safe = constructSafeText({
      subjectRaw: 'X'.repeat(5000),
      plainTextBodyRaw: 'body',
      attachmentBlobIds: [],
    })
    expect(safe.subject.length).toBeLessThanOrEqual(SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS)
  })

  test('constructSafeText filters invalid blob IDs', () => {
    const safe = constructSafeText({
      subjectRaw: 'test',
      plainTextBodyRaw: 'body',
      attachmentBlobIds: [
        'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
        'not-a-uuid',
        '11111111-2222-3333-4444-555555555555',
        '../../../etc/passwd',
      ],
    })
    expect(safe.attachment_refs).toEqual([
      'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      '11111111-2222-3333-4444-555555555555',
    ])
  })

  test('constructSafeText always produces the correct schema tag', () => {
    const safe = constructSafeText({
      subjectRaw: '',
      plainTextBodyRaw: '',
      attachmentBlobIds: [],
    })
    expect(safe.schema).toBe(SAFE_TEXT_SCHEMA)
    expect(Object.keys(safe).sort()).toEqual(
      ['attachment_refs', 'body_text', 'schema', 'subject'].sort(),
    )
  })
})
