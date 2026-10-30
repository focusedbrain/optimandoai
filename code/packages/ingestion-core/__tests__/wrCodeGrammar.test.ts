/**
 * WR Code reference grammar v2 — capture/build/detect suite.
 *
 * Authority: Annex XVI v1.95 (`docs/spec/Annex_XVI_WR_Code_v1.95.pdf`,
 * SHA256 064AAD6D…829F), §XVI.5.1–5.5, §XVI.5.8, §XVI.5.11, Appendix A.2.
 * The Damm arithmetic itself is pinned cell-for-cell by
 * `wrCode.annexXVI.appendixA.conformance.test.ts`; this suite owns the
 * GRAMMAR: prefix registry, per-class framing, normalization order, reason
 * codes, rendering, detection, and the hard rejection of the old prefix-less
 * Baseline Code.
 */
import { describe, expect, test } from 'vitest'
import {
  ALPHABET,
  computeCheck,
  WR_CODE_CLASSES,
  WR_CODE_CLASS_SPECS,
  WR_CODE_CLASS_VALUES,
  WR_CODE_GRAMMAR_VERSION,
  buildWrCodeReference,
  captureWrCodeReference,
  classifyStoredWrCodeValue,
  classifyWrCodePrefix,
  computeWrCodeCheckSymbol,
  detectWrCodeReferences,
  formatWrCodeReferenceForDisplay,
  wrCodeBodyLength,
  type WrCodeClass,
  type WrCodeReference,
} from '../src/index.js'

// ── Appendix A.2 rows, verbatim ───────────────────────────────────────────────

const A2 = [
  { cls: 'P' as const,  display: 'P-WR7X4K-9B2M3C',    body: 'WR7X4K9B2M3',  check: 'C', publisher: 'WR7X4K', local: '9B2M3', counterparty: null, combination: null },
  { cls: 'I' as const,  display: 'I-K4T9M2-7QFA3X-S',  body: 'K4T9M27QFA3X', check: 'S', publisher: 'K4T9M2', local: null, counterparty: null, combination: '7QFA3X' },
  { cls: 'C' as const,  display: 'C-ABC123-XYZ789-H',  body: 'ABC123XYZ789', check: 'H', publisher: 'ABC123', local: null, counterparty: 'XYZ789', combination: null },
  { cls: 'SP' as const, display: 'SP-WR7X4K-H2N5V8-7', body: 'WR7X4KH2N5V8', check: '7', publisher: 'WR7X4K', local: null, counterparty: null, combination: 'H2N5V8' },
  { cls: 'SI' as const, display: 'SI-K4T9M2-3ZDQ7E-H', body: 'K4T9M23ZDQ7E', check: 'H', publisher: 'K4T9M2', local: null, counterparty: null, combination: '3ZDQ7E' },
  { cls: 'SC' as const, display: 'SC-ABC123-M8W2R4-0', body: 'ABC123M8W2R4', check: '0', publisher: 'ABC123', local: null, counterparty: null, combination: 'M8W2R4' },
  { cls: 'SE' as const, display: 'SE-WR7X4K-6TCJ9F-P', body: 'WR7X4K6TCJ9F', check: 'P', publisher: 'WR7X4K', local: null, counterparty: null, combination: '6TCJ9F' },
]

/** A.2 negatives, verbatim, with the reason grammar v2 rejects each. */
const A2_NEGATIVES = [
  { reference: 'P-WR7Z4K-9B2M3C', reason: 'check_failed', why: 'single substitution (X→Z)' },
  { reference: 'P-WR7X4K-B92M3C', reason: 'check_failed', why: 'adjacent transposition (9B→B9)' },
  { reference: 'P-WR7X4K-H2N5V8-7', reason: 'wrong_length', why: 'SP body presented as P — 13 symbols after a P prefix' },
  { reference: 'C-XYZ789-ABC123-H', reason: 'check_failed', why: 'transposed Publisher Identifiers in a C reference' },
  { reference: 'C-ABC123-XYZ789-J', reason: 'check_failed', why: 'check symbol altered' },
] as const

function captured(input: string): WrCodeReference {
  const r = captureWrCodeReference(input)
  expect(r.ok, `expected capture of ${JSON.stringify(input)} to succeed, got ${JSON.stringify(r)}`).toBe(true)
  return r as WrCodeReference
}

// ── 1. Registry tables ────────────────────────────────────────────────────────

describe('1. class registry matches §XVI.5.1/§XVI.5.4/§XVI.5.8', () => {
  test('grammar version is 2 and all seven classes are registered', () => {
    expect(WR_CODE_GRAMMAR_VERSION).toBe(2)
    expect([...WR_CODE_CLASSES].sort()).toEqual(['C', 'I', 'P', 'SC', 'SE', 'SI', 'SP'])
  })

  test('Class Value Table: P=22, I=1, C=12, S=25, E=14, and each coincides with the Crockford mapping (A.3)', () => {
    expect(WR_CODE_CLASS_VALUES).toEqual({ P: 22, I: 1, C: 12, S: 25, E: 14 })
    expect(ALPHABET[22]).toBe('P')
    expect(ALPHABET[12]).toBe('C')
    expect(ALPHABET[25]).toBe('S')
    expect(ALPHABET[14]).toBe('E')
    // I is not in the alphabet; its class value is its Crockford input alias 1.
    expect(ALPHABET.includes('I')).toBe(false)
    expect(ALPHABET[1]).toBe('1')
  })

  test('per-class class-value sequences: [22], [1], [12], [25,22], [25,1], [25,12], [25,14]', () => {
    expect(WR_CODE_CLASS_SPECS.P.classValues).toEqual([22])
    expect(WR_CODE_CLASS_SPECS.I.classValues).toEqual([1])
    expect(WR_CODE_CLASS_SPECS.C.classValues).toEqual([12])
    expect(WR_CODE_CLASS_SPECS.SP.classValues).toEqual([25, 22])
    expect(WR_CODE_CLASS_SPECS.SI.classValues).toEqual([25, 1])
    expect(WR_CODE_CLASS_SPECS.SC.classValues).toEqual([25, 12])
    expect(WR_CODE_CLASS_SPECS.SE.classValues).toEqual([25, 14])
  })

  test('block structure: P = 6+5 attached check; I/C/S* = 6+6 separate check [XVI.5.8]', () => {
    expect(WR_CODE_CLASS_SPECS.P.fields.map((f) => f.length)).toEqual([6, 5])
    expect(WR_CODE_CLASS_SPECS.P.checkPlacement).toBe('attached')
    for (const cls of ['I', 'C', 'SP', 'SI', 'SC', 'SE'] as const) {
      expect(WR_CODE_CLASS_SPECS[cls].fields.map((f) => f.length), cls).toEqual([6, 6])
      expect(WR_CODE_CLASS_SPECS[cls].checkPlacement, cls).toBe('separate')
    }
    expect(wrCodeBodyLength('P')).toBe(11)
    expect(wrCodeBodyLength('SE')).toBe(12)
  })

  test('prefix grammar registry: P/I/C terminal, S non-terminal, SP/SI/SC/SE terminal, rest INVALID [XVI.5.2]', () => {
    for (const p of ['P', 'I', 'C'] as const) expect(classifyWrCodePrefix(p)).toEqual({ state: 'TERMINAL', cls: p })
    expect(classifyWrCodePrefix('S')).toEqual({ state: 'NON_TERMINAL' })
    for (const p of ['SP', 'SI', 'SC', 'SE'] as const) expect(classifyWrCodePrefix(p)).toEqual({ state: 'TERMINAL', cls: p })
    for (const bad of ['X', 'W', '7', 'E', 'ST', 'SA', 'S7', 'SS', 'PP', '']) {
      expect(classifyWrCodePrefix(bad).state, bad).toBe('INVALID')
    }
  })
})

// ── 2. Appendix A.2 positives ─────────────────────────────────────────────────

describe('2. every A.2 reference captures with correct framing [A.2, XVI.5.1]', () => {
  test.each(A2)('$display', ({ cls, display, body, check, publisher, local, counterparty, combination }) => {
    const r = captured(display)
    expect(r.cls).toBe(cls)
    expect(r.canonical).toBe(cls + body + check)
    expect(r.display).toBe(display)
    expect(r.publisher).toBe(publisher)
    expect(r.local).toBe(local)
    expect(r.counterparty).toBe(counterparty)
    expect(r.combination).toBe(combination)
    expect(r.check).toBe(check)
    expect(r.classValues).toEqual(WR_CODE_CLASS_SPECS[cls].classValues)
  })

  test.each(A2)('$display — ungrouped, lowercase, and space-grouped normalize identically [XVI.5.3, XVI.5.5]', ({ cls, display, body, check }) => {
    const canonical = cls + body + check
    for (const variant of [
      canonical,
      canonical.toLowerCase(),
      display.toLowerCase(),
      display.replace(/-/g, ' '),
      ` ${display} `,
    ]) {
      expect(captured(variant).canonical, variant).toBe(canonical)
      expect(captured(variant).display, variant).toBe(display)
    }
  })

  test.each(A2)('$display — generalized field view is declaration-ordered [XVI.5.11]', ({ display, cls }) => {
    const r = captured(display)
    expect(r.fields.map((f) => f.role)).toEqual(WR_CODE_CLASS_SPECS[cls].fields.map((f) => f.role))
    expect(r.fields.map((f) => f.symbols.length)).toEqual(WR_CODE_CLASS_SPECS[cls].fields.map((f) => f.length))
    expect(r.fields.map((f) => f.symbols).join('')).toBe(r.canonical.slice(cls.length, -1))
  })
})

// ── 3. Appendix A.2 negatives + systematic per-class negatives ───────────────

describe('3. negatives reject with precise reasons [A.2, XVI.5.4, XVI.5.8]', () => {
  test.each(A2_NEGATIVES)('$reference → $reason ($why)', ({ reference, reason }) => {
    const r = captureWrCodeReference(reference)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  })

  test.each(A2)('$display — every single body-symbol substitution fails the check', ({ cls, body, check }) => {
    for (let i = 0; i < body.length; i++) {
      for (const alt of ALPHABET) {
        if (alt === body[i]) continue
        const mutated = cls + body.slice(0, i) + alt + body.slice(i + 1) + check
        const r = captureWrCodeReference(mutated)
        expect(r.ok, mutated).toBe(false)
        if (!r.ok) expect(r.reason, mutated).toBe('check_failed')
      }
    }
  })

  test.each(A2)('$display — every adjacent body transposition fails the check', ({ cls, body, check }) => {
    for (let i = 0; i + 1 < body.length; i++) {
      if (body[i] === body[i + 1]) continue
      const swapped = cls + body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2) + check
      const r = captureWrCodeReference(swapped)
      expect(r.ok, swapped).toBe(false)
      if (!r.ok) expect(r.reason, swapped).toBe('check_failed')
    }
  })

  test.each(A2)('$display — every wrong check symbol fails', ({ cls, body, check }) => {
    for (const alt of ALPHABET) {
      if (alt === check) continue
      const r = captureWrCodeReference(cls + body + alt)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('check_failed')
    }
  })

  /**
   * §XVI.5.4 claims local detection for the named substitutions (SP for P,
   * C for I, transposed C pair) — all covered below. It does NOT claim every
   * cross-class substitution: the SP class-value sequence [25, 22] folds to
   * interim 1, which is exactly I's class value, so SP↔I keeps the same check
   * symbol and equal body length. That pair captures as the OTHER class and is
   * caught at resolution (block-3 semantics differ), not locally. This test
   * pins the exact collision set so any table change that widens it fails loud.
   */
  test.each(A2)('$display — prefix substitution: detected locally except the SP↔I fold collision', ({ cls, body, check }) => {
    for (const other of WR_CODE_CLASSES) {
      if (other === cls) continue
      const r = captureWrCodeReference(other + body + check)
      const foldCollision = (cls === 'SP' && other === 'I') || (cls === 'I' && other === 'SP')
      if (foldCollision) {
        expect(r.ok, `${cls}→${other} is the known check-preserving pair`).toBe(true)
        if (r.ok) expect(r.cls).toBe(other)
        continue
      }
      expect(r.ok, `${cls}→${other}`).toBe(false)
      if (!r.ok) {
        // Same body length ⇒ the class values change the check; different
        // length ⇒ the fixed form itself rejects. Both are local detection.
        expect(['check_failed', 'wrong_length']).toContain(r.reason)
      }
    }
  })

  test.each(A2)('$display — omission and insertion are wrong_length [XVI.5.8]', ({ cls, body, check }) => {
    for (const mutated of [cls + body.slice(0, -1) + check, cls + body + '0' + check]) {
      const r = captureWrCodeReference(mutated)
      expect(r.ok, mutated).toBe(false)
      if (!r.ok) expect(r.reason, mutated).toBe('wrong_length')
    }
  })

  test('unknown prefixes reject as unknown_prefix, including S + unregistered symbol', () => {
    for (const input of ['X-WR7X4K-9B2M3C', 'W-R7X4K9-B2M3C', '7WR7X4K9B2M3C', 'ST-ABC123-XYZ789-H', 'SA-WR7X4K-9B2M3C']) {
      const r = captureWrCodeReference(input)
      expect(r.ok, input).toBe(false)
      if (!r.ok) expect(r.reason, input).toBe('unknown_prefix')
    }
  })

  test('a bare S is an incomplete prefix, not a class', () => {
    const r = captureWrCodeReference('S')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('wrong_length')
  })

  test('empty and separator-only input reject as empty', () => {
    for (const input of ['', '   ', '---', ' - - ']) {
      const r = captureWrCodeReference(input)
      expect(r.ok, JSON.stringify(input)).toBe(false)
      if (!r.ok) expect(r.reason).toBe('empty')
    }
  })

  test('U survives no alias and rejects as out_of_alphabet', () => {
    const r = captureWrCodeReference('P-WR7X4K-9B2MU' + 'C')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('out_of_alphabet')
  })
})

// ── 4. The old prefix-less Baseline Code is dead ─────────────────────────────

describe('4. old-format 12-symbol codes are invalid — no dual acceptance', () => {
  test('a valid v1.4 Baseline Code rejects at the prefix', () => {
    // Old grammar: 6 publisher + 5 local + attached check, no prefix.
    const oldCanonical = 'WR7X4K9B2M3' + computeCheck('WR7X4K9B2M3')
    expect(oldCanonical).toHaveLength(12)
    const r = captureWrCodeReference(oldCanonical)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_prefix')
  })

  test('an old code that happens to start with a class symbol still rejects (wrong fixed length)', () => {
    const oldCanonical = 'PK4T9M27QFA' + computeCheck('PK4T9M27QFA') // 12 symbols, leading P
    const r = captureWrCodeReference(oldCanonical)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('wrong_length')
  })
})

// ── 5. Normalization order: prefix before payload aliases [XVI.5.3] ──────────

describe('5. prefix is parsed before payload aliases', () => {
  test('a class symbol I is never rewritten to the digit 1', () => {
    const r = captured('I-K4T9M2-7QFA3X-S')
    expect(r.cls).toBe('I')
    expect(r.canonical.startsWith('I')).toBe(true)
    expect(captured('i-k4t9m2-7qfa3x-s').canonical).toBe(r.canonical)
  })

  test('body aliases i/l→1 and o→0 apply after the prefix', () => {
    // Build a P reference whose local block contains 1 and 0, then re-enter it
    // with I/L/O lookalikes: same canonical, same check.
    const built = buildWrCodeReference('P', ['K4T9M2', '10A2B'])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const lookalike = built.display.replace('-10A2B', '-lOA2B')
    expect(captured(lookalike).canonical).toBe(built.canonical)
  })

  test('a leading L is NOT aliased into a prefix — it is an unknown prefix', () => {
    const r = captureWrCodeReference('L-K4T9M2-7QFA3X-S')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_prefix')
  })
})

// ── 6. Generation and rendering ───────────────────────────────────────────────

describe('6. build → capture round trip [XVI.5.1, XVI.5.4]', () => {
  test.each(A2)('$display rebuilds from its blocks with the same check', ({ cls, display, body, check, publisher }) => {
    const blocks = WR_CODE_CLASS_SPECS[cls].fields.map((f, i, all) => {
      const start = all.slice(0, i).reduce((n, g) => n + g.length, 0)
      return body.slice(start, start + f.length)
    })
    expect(blocks[0]).toBe(publisher)
    expect(computeWrCodeCheckSymbol(cls, body)).toBe(check)
    const built = buildWrCodeReference(cls, blocks)
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.display).toBe(display)
      expect(built.canonical).toBe(cls + body + check)
    }
  })

  test('every class round-trips arbitrary in-alphabet blocks', () => {
    for (const cls of WR_CODE_CLASSES) {
      const blocks = WR_CODE_CLASS_SPECS[cls].fields.map((f, i) =>
        ALPHABET.slice(i + 3, i + 3 + f.length),
      )
      const built = buildWrCodeReference(cls, blocks)
      expect(built.ok, cls).toBe(true)
      if (!built.ok) continue
      expect(captured(built.display).canonical).toBe(built.canonical)
      expect(captured(built.canonical).display).toBe(built.display)
      expect(formatWrCodeReferenceForDisplay(built.canonical)).toBe(built.display)
    }
  })

  test('build rejects wrong block counts and lengths, and out-of-alphabet material', () => {
    expect(buildWrCodeReference('P', ['WR7X4K']).ok).toBe(false)
    expect(buildWrCodeReference('P', ['WR7X4K', '9B2M3C']).ok).toBe(false)
    expect(buildWrCodeReference('C', ['ABC123', 'XYZ78']).ok).toBe(false)
    expect(buildWrCodeReference('SE', ['WR7X4K', '6TCJ9U']).ok).toBe(false)
    expect(computeWrCodeCheckSymbol('P', 'TOOSHORT')).toBeNull()
  })

  test('display of stored garbage is refused, never guessed [P12]', () => {
    expect(formatWrCodeReferenceForDisplay('WR7X4K9B2M3C')).toBeNull()
    expect(formatWrCodeReferenceForDisplay('')).toBeNull()
    expect(formatWrCodeReferenceForDisplay('P-WR7X4K-9B2M3' + 'D')).toBeNull()
  })
})

// ── 7. Detection in free text ─────────────────────────────────────────────────

describe('7. prefix-aware detection emits only check-verified references', () => {
  const EMAIL = [
    'Hello,',
    'your offering is live at P-WR7X4K-9B2M3C — or use the sub-handshake',
    'sp-wr7x4k-h2n5v8-7 (case does not matter). Ungrouped works too:',
    'CABC123XYZ789H. A corrupted code like P-WR7Z4K-9B2M3C must stay silent.',
    'Regards',
  ].join('\n')

  test('finds grouped, lowercase, and ungrouped references with their positions', () => {
    const hits = detectWrCodeReferences(EMAIL)
    expect(hits.map((h) => h.reference.canonical)).toEqual([
      'PWR7X4K9B2M3C',
      'SPWR7X4KH2N5V87',
      'CABC123XYZ789H',
    ])
    for (const h of hits) {
      expect(EMAIL.slice(h.index, h.index + h.raw.length)).toBe(h.raw)
    }
  })

  test('a failed check is silence, not a candidate [XVI.5.9]', () => {
    expect(detectWrCodeReferences('code: P-WR7Z4K-9B2M3C')).toEqual([])
  })

  test('duplicates collapse to one detection per canonical reference', () => {
    const hits = detectWrCodeReferences('P-WR7X4K-9B2M3C and again PWR7X4K9B2M3C')
    expect(hits).toHaveLength(1)
  })

  test('prose and old-format codes produce no detections', () => {
    const old = 'WR7X4K9B2M3' + computeCheck('WR7X4K9B2M3')
    expect(detectWrCodeReferences(`Please CONSIDER the Instructions carefully. Old code ${old} is dead.`)).toEqual([])
  })

  test('embedded in a longer identifier is not a candidate (word boundaries)', () => {
    expect(detectWrCodeReferences('XP-WR7X4K-9B2M3C4')).toEqual([])
  })

  test('respects the limit and the text-length cap', () => {
    const codes = A2.map((r) => r.display).join(' ')
    expect(detectWrCodeReferences(codes, 3)).toHaveLength(3)
    const far = ' '.repeat(70000) + 'P-WR7X4K-9B2M3C'
    expect(detectWrCodeReferences(far)).toEqual([])
  })
})

// ── 8. Stored-value classifier (persistence sweep support) ───────────────────

describe('8. classifyStoredWrCodeValue — recognize, never accept, legacy rows', () => {
  test('grammar-v2 canonicals classify as reference_v2', () => {
    for (const { cls, body, check } of A2) {
      expect(classifyStoredWrCodeValue(cls + body + check)).toBe('reference_v2')
    }
  })

  test('a stored v1.4 Baseline Code classifies as legacy_baseline', () => {
    const oldCanonical = 'WR7X4K9B2M3' + computeCheck('WR7X4K9B2M3')
    expect(classifyStoredWrCodeValue(oldCanonical)).toBe('legacy_baseline')
    const oldExtended = 'WR7X4K9B2M3P' + computeCheck('WR7X4K9B2M3P')
    expect(classifyStoredWrCodeValue(oldExtended)).toBe('legacy_baseline')
  })

  test('legacy classification is recognition only — capture still rejects it', () => {
    const oldCanonical = 'WR7X4K9B2M3' + computeCheck('WR7X4K9B2M3')
    expect(captureWrCodeReference(oldCanonical).ok).toBe(false)
  })

  test('garbage, empty, and near-miss values classify as invalid', () => {
    for (const v of [null, undefined, '', 'hello', 'WR7X4K', 'WR7X4K9B2M3X', 'P-WR7Z4K-9B2M3C']) {
      expect(classifyStoredWrCodeValue(v as string | null | undefined), String(v)).toBe('invalid')
    }
  })
})
