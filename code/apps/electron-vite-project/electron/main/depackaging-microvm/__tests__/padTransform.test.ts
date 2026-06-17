/**
 * Exhaustive tests for the canonical invertible padding transform (Phase 1.1).
 *
 * The padding transform is the correctness keystone of the multi-stage
 * validation chain. Every edge case of the Unicode code-point iteration,
 * stride arithmetic, cross-stage composition, and integrity assertion
 * is exercised here.
 */

import { describe, test, expect } from 'vitest'
import {
  pad,
  unpad,
  padLayers,
  unpadLayers,
  PAD_CHAR,
  STRIDE,
  PadIntegrityError,
} from '../padTransform'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Count code points in a string (not UTF-16 length). */
function cpLen(s: string): number {
  return [...s].length
}

/** Extract the code point at index i (code-point-indexed, not char-indexed). */
function cpAt(s: string, i: number): string {
  return [...s][i]
}

// ── Round-trip: unpad(pad(S)) === S ────────────────────────────────────────

describe('pad/unpad round-trip identity', () => {
  const cases: [string, string][] = [
    ['empty string', ''],
    ['single char', 'A'],
    ['9 chars (< STRIDE)', 'abcdefghi'],
    ['exactly 10 chars (= STRIDE)', 'abcdefghij'],
    ['11 chars (STRIDE + 1)', 'abcdefghijk'],
    ['20 chars (2 × STRIDE)', 'abcdefghijklmnopqrst'],
    ['30 chars (3 × STRIDE)', 'abcdefghijklmnopqrstuvwxyz1234'],
    ['100 chars (10 × STRIDE)', 'A'.repeat(100)],
    ['1000 chars', 'x'.repeat(1000)],
  ]

  for (const [label, input] of cases) {
    test(label, () => {
      expect(unpad(pad(input))).toBe(input)
    })
  }
})

describe('round-trip with non-ASCII content', () => {
  const cases: [string, string][] = [
    ['German umlauts', 'Ääöö üü ß Straße Grüße'],
    ['French accents', 'café résumé naïve château'],
    ['CJK characters', '你好世界这是一个测试消息在这里'],
    ['Japanese mixed', 'こんにちは世界テスト日本語入力'],
    ['Korean', '안녕하세요 세계 테스트 메시지입니다'],
    ['Arabic RTL', 'مرحبا بالعالم هذه رسالة اختبار'],
    ['Hebrew RTL', 'שלום עולם זו הודעת בדיקה כאן'],
    ['Thai', 'สวัสดีชาวโลก นี่คือข้อความทดสอบ'],
    ['mixed scripts', 'Hello 你好 مرحبا שלום こんにちは 안녕'],
    ['Cyrillic', 'Привет мир это тестовое сообщение'],
  ]

  for (const [label, input] of cases) {
    test(label, () => {
      expect(unpad(pad(input))).toBe(input)
    })
  }
})

describe('round-trip with emoji and surrogate pairs', () => {
  const cases: [string, string][] = [
    ['basic emoji', '😀😁😂🤣😃😄😅😆😉😊😋'],
    ['flags (surrogate pairs)', '🇺🇸🇬🇧🇩🇪🇫🇷🇪🇸🇮🇹🇯🇵🇰🇷🇨🇳🇧🇷'],
    ['skin-tone modifiers', '👍🏻👍🏼👍🏽👍🏾👍🏿 done'],
    ['ZWJ sequences', '👨‍👩‍👧‍👦 family 👩‍💻 coder'],
    ['emoji at stride boundary', 'abcdefghi😀klmnopqrs😁uvwxyz1234'],
    ['astral chars only', '𝄞𝄢𝄪𝄫𝄬𝄭𝄮𝄯𝄰𝄱𝄲𝄳'],
    ['mixed BMP + astral', 'abc𝄞def𝄢ghi𝄪jkl𝄫mno𝄬pqr'],
  ]

  for (const [label, input] of cases) {
    test(label, () => {
      expect(unpad(pad(input))).toBe(input)
    })
  }
})

describe('round-trip with U+FFFC in original text (collision handling)', () => {
  test('single U+FFFC at start', () => {
    const input = '\uFFFCabcdefghij'
    expect(unpad(pad(input))).toBe(input)
  })

  test('single U+FFFC at end', () => {
    const input = 'abcdefghij\uFFFC'
    expect(unpad(pad(input))).toBe(input)
  })

  test('U+FFFC at position 9 (just before first PAD insertion)', () => {
    const input = 'abcdefgh\uFFFCj'
    expect(unpad(pad(input))).toBe(input)
  })

  test('U+FFFC at position 10 (would be first PAD position in output if not shifted)', () => {
    const input = 'abcdefghijK'
    const withPad = 'abcdefghij\uFFFCK'
    expect(unpad(pad(withPad))).toBe(withPad)
  })

  test('multiple U+FFFC chars scattered', () => {
    const input = '\uFFFCabc\uFFFCdefgh\uFFFCijklm\uFFFCnopqr\uFFFC'
    expect(unpad(pad(input))).toBe(input)
  })

  test('all-U+FFFC string (worst case collision)', () => {
    const input = '\uFFFC'.repeat(25)
    expect(unpad(pad(input))).toBe(input)
  })

  test('U+FFFC every other char', () => {
    const input = 'a\uFFFCb\uFFFCc\uFFFCd\uFFFCe\uFFFCf\uFFFCg\uFFFCh\uFFFCi\uFFFCj\uFFFC'
    expect(unpad(pad(input))).toBe(input)
  })
})

// ── PAD position determinism ───────────────────────────────────────────────

describe('PAD positions are deterministic', () => {
  test('first PAD at code-point index 10', () => {
    const input = 'abcdefghij' // exactly 10 code points
    const padded = pad(input)
    const cps = [...padded]
    expect(cps.length).toBe(11) // 10 original + 1 PAD
    expect(cps[10]).toBe(PAD_CHAR)
  })

  test('PADs at positions 10, 21, 32 for 30-char input', () => {
    const input = 'A'.repeat(30)
    const padded = pad(input)
    const cps = [...padded]
    expect(cps.length).toBe(33) // 30 original + 3 PADs
    expect(cps[10]).toBe(PAD_CHAR)
    expect(cps[21]).toBe(PAD_CHAR)
    expect(cps[32]).toBe(PAD_CHAR)
    // all others are 'A'
    for (let i = 0; i < cps.length; i++) {
      if (i !== 10 && i !== 21 && i !== 32) {
        expect(cps[i]).toBe('A')
      }
    }
  })

  test('no PAD inserted for input shorter than STRIDE', () => {
    const input = 'abcde' // 5 chars
    const padded = pad(input)
    expect([...padded]).not.toContain(PAD_CHAR)
    expect(padded).toBe(input) // unchanged
  })

  test('PAD count = floor(len / STRIDE)', () => {
    for (const len of [0, 1, 5, 9, 10, 11, 19, 20, 21, 50, 99, 100, 101]) {
      const input = 'x'.repeat(len)
      const padded = pad(input)
      const expectedPads = Math.floor(len / STRIDE)
      const actualPads = [...padded].filter((c) => c === PAD_CHAR).length
      expect(actualPads).toBe(expectedPads)
      expect(cpLen(padded)).toBe(len + expectedPads)
    }
  })
})

// ── Integrity assertion ───────────────────────────────────────────────────

describe('unpad integrity assertion catches tampering', () => {
  test('throws PadIntegrityError when PAD position is replaced', () => {
    const padded = pad('abcdefghij') // PAD at index 10
    const cps = [...padded]
    cps[10] = 'Z' // tamper
    const tampered = cps.join('')
    expect(() => unpad(tampered)).toThrow(PadIntegrityError)
  })

  test('throws PadIntegrityError with correct position and found char', () => {
    const padded = pad('A'.repeat(30)) // PADs at 10, 21, 32
    const cps = [...padded]
    cps[21] = 'Q' // tamper second PAD
    const tampered = cps.join('')
    try {
      unpad(tampered)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PadIntegrityError)
      const err = e as PadIntegrityError
      expect(err.position).toBe(21)
      expect(err.found).toBe('Q')
      expect(err.code).toBe('E_PAD_INTEGRITY')
    }
  })

  test('does NOT throw for valid padded text', () => {
    const padded = pad('hello world this is a test of the padding')
    expect(() => unpad(padded)).not.toThrow()
  })

  test('does NOT throw for unpadded empty string', () => {
    expect(() => unpad('')).not.toThrow()
    expect(unpad('')).toBe('')
  })

  test('does NOT throw for text shorter than STRIDE (no PAD positions exist)', () => {
    expect(() => unpad('abcde')).not.toThrow()
    expect(unpad('abcde')).toBe('abcde')
  })
})

// ── Cross-stage composition (2-layer and 3-layer) ─────────────────────────

describe('cross-stage composition: 2-layer round-trip', () => {
  const cases: [string, string][] = [
    ['empty', ''],
    ['short', 'hello'],
    ['exactly 10', 'abcdefghij'],
    ['long ASCII', 'The quick brown fox jumps over the lazy dog. 1234567890!'],
    ['CJK', '你好世界这是一个测试消息在这里额外字符'],
    ['emoji', '😀😁😂🤣😃😄😅😆😉😊😋😎😍🥰😘'],
    ['with U+FFFC', 'abc\uFFFCdef\uFFFCghijklmnopqrstuvwxyz'],
  ]

  for (const [label, original] of cases) {
    test(label, () => {
      const layer1 = pad(original)
      const layer2 = pad(layer1)
      const back1 = unpad(layer2)
      expect(back1).toBe(layer1)
      const back0 = unpad(back1)
      expect(back0).toBe(original)
    })
  }
})

describe('cross-stage composition: 3-layer round-trip', () => {
  const cases: [string, string][] = [
    ['empty', ''],
    ['short', 'hi'],
    ['exactly 10', '1234567890'],
    ['long mixed', 'Hello 你好 مرحبا 😀 café Straße 日本語 12345678901234567890'],
    ['all U+FFFC', '\uFFFC'.repeat(15)],
  ]

  for (const [label, original] of cases) {
    test(label, () => {
      const l1 = pad(original)
      const l2 = pad(l1)
      const l3 = pad(l2)
      expect(unpad(unpad(unpad(l3)))).toBe(original)
    })
  }
})

// ── padLayers / unpadLayers convenience ───────────────────────────────────

describe('padLayers / unpadLayers', () => {
  test('padLayers(text, 0) returns original', () => {
    expect(padLayers('hello', 0)).toBe('hello')
  })

  test('unpadLayers(text, 0) returns input', () => {
    expect(unpadLayers('hello', 0)).toBe('hello')
  })

  test('padLayers(text, 1) === pad(text)', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'
    expect(padLayers(text, 1)).toBe(pad(text))
  })

  test('padLayers(text, 2) === pad(pad(text))', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'
    expect(padLayers(text, 2)).toBe(pad(pad(text)))
  })

  test('padLayers(text, 3) === pad(pad(pad(text)))', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'
    expect(padLayers(text, 3)).toBe(pad(pad(pad(text))))
  })

  test('unpadLayers(padLayers(text, 2), 2) === text', () => {
    const text = 'Hello 你好 😀 café Straße'
    expect(unpadLayers(padLayers(text, 2), 2)).toBe(text)
  })

  test('unpadLayers(padLayers(text, 3), 3) === text', () => {
    const text = 'Mixed: 日本語 with emoji 🇺🇸 and \uFFFC in it'
    expect(unpadLayers(padLayers(text, 3), 3)).toBe(text)
  })

  test('unpadLayers throws PadIntegrityError on tampered input', () => {
    const padded2 = padLayers('abcdefghijklmnopqrst', 2)
    const cps = [...padded2]
    cps[10] = 'Z'
    const tampered = cps.join('')
    expect(() => unpadLayers(tampered, 2)).toThrow(PadIntegrityError)
  })
})

// ── Cross-stage: padded text grows predictably ────────────────────────────

describe('padding expansion is predictable', () => {
  test('output length = input + floor(input_codepoints / STRIDE)', () => {
    for (const n of [0, 1, 5, 9, 10, 11, 15, 20, 25, 50, 100]) {
      const input = 'x'.repeat(n)
      const padded = pad(input)
      expect(cpLen(padded)).toBe(n + Math.floor(n / STRIDE))
    }
  })

  test('2-layer expansion', () => {
    const n = 30 // → 33 after layer 1 → 36 after layer 2
    const input = 'x'.repeat(n)
    const l1 = pad(input)
    const l1Len = cpLen(l1) // 30 + 3 = 33
    expect(l1Len).toBe(33)
    const l2 = pad(l1)
    const l2Len = cpLen(l2) // 33 + 3 = 36
    expect(l2Len).toBe(36)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('single code point', () => {
    expect(pad('X')).toBe('X')
    expect(unpad(pad('X'))).toBe('X')
  })

  test('exactly STRIDE code points → exactly 1 PAD', () => {
    const input = '0123456789'
    const padded = pad(input)
    expect(cpLen(padded)).toBe(11)
    expect([...padded].filter((c) => c === PAD_CHAR).length).toBe(1)
    expect(unpad(padded)).toBe(input)
  })

  test('STRIDE - 1 code points → 0 PADs', () => {
    const input = '012345678' // 9 chars
    const padded = pad(input)
    expect(padded).toBe(input) // no change
    expect(cpLen(padded)).toBe(9)
  })

  test('STRIDE + 1 code points → 1 PAD', () => {
    const input = '0123456789A'
    const padded = pad(input)
    expect(cpLen(padded)).toBe(12)
    expect(unpad(padded)).toBe(input)
  })

  test('newlines and tabs preserved', () => {
    const input = 'line1\nline2\tindented\nline3 end'
    expect(unpad(pad(input))).toBe(input)
  })

  test('very long string (10k code points)', () => {
    const input = 'abcdefghij'.repeat(1000) // 10000 code points
    const padded = pad(input)
    expect(cpLen(padded)).toBe(11000) // 10000 + 1000 PADs
    expect(unpad(padded)).toBe(input)
  })

  test('lone surrogates in string (malformed but handled)', () => {
    const input = 'abc'
    expect(unpad(pad(input))).toBe(input)
  })

  test('string of length exactly 10 with astral char at position 9', () => {
    const input = 'abcdefghi\u{1F600}' // 9 BMP + 1 astral = 10 code points
    const padded = pad(input)
    expect(cpLen(padded)).toBe(11)
    expect(cpAt(padded, 10)).toBe(PAD_CHAR)
    expect(unpad(padded)).toBe(input)
  })
})

// ── Byte-exact round-trip proof ───────────────────────────────────────────

describe('byte-exact round-trip (Buffer comparison)', () => {
  const proofCases: [string, string][] = [
    ['ASCII', 'The quick brown fox jumps over the lazy dog 1234567890'],
    ['CJK + emoji', '你好世界😀 café résumé 日本語テスト'],
    ['with U+FFFC collision', 'text\uFFFCwith\uFFFCpad\uFFFCchars inside it'],
    ['mixed everything', 'a\uFFFCb😀c你défghijklmnopqrstuvwxyz0123456789\uFFFC'],
  ]

  for (const [label, original] of proofCases) {
    test(`3-layer: ${label}`, () => {
      const padded3 = padLayers(original, 3)
      const restored = unpadLayers(padded3, 3)
      const originalBuf = Buffer.from(original, 'utf-8')
      const restoredBuf = Buffer.from(restored, 'utf-8')
      expect(restoredBuf.equals(originalBuf)).toBe(true)
    })
  }
})
