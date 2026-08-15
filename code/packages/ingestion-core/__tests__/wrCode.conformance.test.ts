/**
 * WR Code Baseline Code — conformance suite per check profile v1.4 §6.
 *
 * The seven classes below are the published checklist, in order:
 *  1. table / closed-form regression (quasigroup + both TA conditions, 32³)
 *  2. §4.1 + §4.2 vectors, and the D3 no-prefix-semantics assertion
 *  3. exhaustive substitution + adjacent-transposition negatives
 *  4. §4.3 mapping / case / separator equivalence
 *  5. rejection-before-resolution (spy resolver)
 *  6. structure-from-length
 *  7. length-error bounds, asserted BY KIND (exact vs. sampled)
 *
 * The algebra is never re-implemented here. `star` is recovered from the
 * module's own public API so the suite cannot pass by agreeing with a second
 * copy of the same mistake.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALPHABET,
  normalize,
  computeCheck,
  verifyCheck,
  parseStructure,
  captureBaselineCode,
  formatBaselineCodeForDisplay,
} from '../src/wrCode.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const PROFILE_DOC = join(
  repoRoot,
  'docs',
  'spec',
  'WR-Code_Check-Profile_Registry-Material_v1.4.md',
)

const VALUE = new Map([...ALPHABET].map((c, i) => [c, i] as const))
const sym = (v: number): string => ALPHABET[v]

/**
 * Recover the quasigroup from the public API alone.
 *
 * The fold of a single symbol is its own value, so `computeCheck(sym(v))` is
 * the symbol for A(v); the fold of a symbol pair is `star(x, y)`, so
 * `computeCheck(sym(x) + sym(y))` is the symbol for A(star(x, y)). A is a
 * bijection, hence invertible by table.
 */
const A: readonly number[] = Array.from({ length: 32 }, (_, v) => VALUE.get(computeCheck(sym(v)))!)
const A_INVERSE: number[] = []
A.forEach((image, v) => {
  A_INVERSE[image] = v
})
const star = (x: number, y: number): number =>
  A_INVERSE[VALUE.get(computeCheck(sym(x) + sym(y)))!]!

// ── Published vectors ─────────────────────────────────────────────────────────

/** §4.1 canonical positives: stem → check → full code. */
const CANONICAL_VECTORS = [
  { stem: 'WR7X4K9B2M3', check: 'P', code: 'WR7X4K9B2M3P' },
  { stem: 'ABC123DEF45', check: '4', code: 'ABC123DEF454' },
  { stem: '00000000000', check: '0', code: '000000000000' },
  { stem: '0123456789A', check: 'M', code: '0123456789AM' },
  { stem: 'ZZZZZZZZZZZ', check: 'K', code: 'ZZZZZZZZZZZK' },
] as const

/** §4.2 extended-local-part positives; the check covers the full extended form. */
const EXTENDED_VECTORS = [
  { stem: 'WR7X4K9B2M3Z', check: 'J', code: 'WR7X4K9B2M3ZJ', local: 6 },
  { stem: 'WR7X4K9B2M3Z7', check: 'F', code: 'WR7X4K9B2M3Z7F', local: 7 },
] as const

const ALL_VECTORS = [...CANONICAL_VECTORS, ...EXTENDED_VECTORS]
const BASE_CODES = ALL_VECTORS.map((v) => v.code)

// ── 1. Table / closed-form regression ─────────────────────────────────────────

describe('1. published table and algebraic properties [v1.4 §2.2, §2.4]', () => {
  test('every cell of the published 32×32 table matches the implementation', () => {
    const doc = readFileSync(PROFILE_DOC, 'utf8').replace(/\r\n/g, '\n')
    const fence = [...doc.matchAll(/```\n([\s\S]*?)```/g)]
      .map((m) => m[1])
      .find((body) => /^\s+0 1 2 3 4/m.test(body) && body.includes('|'))
    expect(fence, 'the §2.4 table fence was not found in the registry material').toBeDefined()

    const lines = fence!.split('\n').filter((l) => l.trim() !== '')
    const columns = lines[0].trim().split(/\s+/)
    expect(columns).toEqual([...ALPHABET])

    const rows = lines.slice(1)
    expect(rows).toHaveLength(32)

    let cells = 0
    for (const line of rows) {
      const [rowLabel, body] = line.split('|')
      const x = VALUE.get(rowLabel.trim())!
      const values = body.trim().split(/\s+/)
      expect(values).toHaveLength(32)
      values.forEach((cell, y) => {
        expect(cell, `table[${sym(x)}][${sym(y)}]`).toBe(sym(star(x, y)))
        cells += 1
      })
    }
    expect(cells).toBe(1024)
  })

  test('every row and every column is a permutation (quasigroup)', () => {
    for (let x = 0; x < 32; x++) {
      const row = new Set(Array.from({ length: 32 }, (_, y) => star(x, y)))
      expect(row.size, `row ${sym(x)}`).toBe(32)
    }
    for (let y = 0; y < 32; y++) {
      const column = new Set(Array.from({ length: 32 }, (_, x) => star(x, y)))
      expect(column.size, `column ${sym(y)}`).toBe(32)
    }
  })

  test('weak total anti-symmetry: x∗y = y∗x ⟹ x = y', () => {
    const violations: string[] = []
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        if (star(x, y) === star(y, x) && x !== y) violations.push(`${sym(x)},${sym(y)}`)
      }
    }
    expect(violations).toEqual([])
  })

  test('strong total anti-symmetry: (c∗x)∗y = (c∗y)∗x ⟹ x = y over all 32³ triples', () => {
    const violations: string[] = []
    let triples = 0
    for (let c = 0; c < 32; c++) {
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          triples += 1
          if (star(star(c, x), y) === star(star(c, y), x) && x !== y) {
            violations.push(`${sym(c)},${sym(x)},${sym(y)}`)
          }
        }
      }
    }
    expect(triples).toBe(32 ** 3)
    expect(violations).toEqual([])
  })

  test('the quasigroup is deliberately NOT diagonal-normalized [v1.4 §2.3]', () => {
    // A validator assuming check = interim is correct for only 1 of 32 states.
    const selfZero = Array.from({ length: 32 }, (_, x) => x).filter((x) => star(x, x) === 0)
    expect(selfZero).toEqual([0])
  })
})

// ── 2. Published positive vectors ─────────────────────────────────────────────

describe('2. published vectors [v1.4 §4.1, §4.2]', () => {
  test.each(CANONICAL_VECTORS)('§4.1 $stem → $check', ({ stem, check, code }) => {
    expect(computeCheck(stem)).toBe(check)
    expect(stem + check).toBe(code)
    expect(verifyCheck(code)).toBe(true)
  })

  test.each(EXTENDED_VECTORS)('§4.2 $stem → $check', ({ stem, check, code, local }) => {
    expect(computeCheck(stem)).toBe(check)
    expect(stem + check).toBe(code)
    expect(verifyCheck(code)).toBe(true)
    expect(parseStructure(code)!.local).toHaveLength(local)
  })

  test('D3: a longer local part is a DISTINCT identifier, prefixes carry no semantics', () => {
    expect(verifyCheck('WR7X4K9B2M3P')).toBe(true)
    expect(verifyCheck('WR7X4K9B2M3ZJ')).toBe(true)
    expect('WR7X4K9B2M3ZJ').not.toBe('WR7X4K9B2M3P')
    // Same publisher part, different entries — neither resolves via the other.
    expect(parseStructure('WR7X4K9B2M3P')!.publisher).toBe('WR7X4K')
    expect(parseStructure('WR7X4K9B2M3ZJ')!.publisher).toBe('WR7X4K')
    expect(parseStructure('WR7X4K9B2M3P')!.local).not.toBe(
      parseStructure('WR7X4K9B2M3ZJ')!.local,
    )
    // The shorter code is not a prefix-truncation of the longer one: the check
    // is recomputed over the full extended form, so the characters differ.
    expect('WR7X4K9B2M3ZJ'.startsWith('WR7X4K9B2M3P')).toBe(false)
  })
})

// ── 3. Exhaustive negatives ───────────────────────────────────────────────────

function substitutionsOf(code: string): string[] {
  const out: string[] = []
  for (let i = 0; i < code.length; i++) {
    for (const s of ALPHABET) {
      if (s === code[i]) continue
      out.push(code.slice(0, i) + s + code.slice(i + 1))
    }
  }
  return out
}

function adjacentTranspositionsOf(code: string): string[] {
  const out: string[] = []
  for (let i = 0; i + 1 < code.length; i++) {
    if (code[i] === code[i + 1]) continue
    out.push(code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2))
  }
  return out
}

describe('3. exhaustive negative classes [v1.4 §4.4]', () => {
  test('every single-symbol substitution from every base code fails', () => {
    const all = BASE_CODES.flatMap(substitutionsOf)
    expect(all).toHaveLength(2697)
    expect(all.filter(verifyCheck)).toEqual([])
  })

  test('every adjacent transposition of unequal neighbours from every base code fails', () => {
    const all = BASE_CODES.flatMap(adjacentTranspositionsOf)
    expect(all).toHaveLength(59)
    expect(all.filter(verifyCheck)).toEqual([])
  })

  test('worked examples from §4.4', () => {
    expect(verifyCheck('WR7X4K9B2M3Q')).toBe(false)
    expect(verifyCheck('WR7X4K9B2MP3')).toBe(false)
  })

  test('the degenerate vectors behave as documented', () => {
    // `000000000000` has no unequal neighbours: its transposition class is empty.
    expect(adjacentTranspositionsOf('000000000000')).toEqual([])
    // `ZZZZZZZZZZZK` has exactly one unequal-neighbour pair.
    expect(adjacentTranspositionsOf('ZZZZZZZZZZZK')).toHaveLength(1)
  })
})

// ── 4. Normalization ──────────────────────────────────────────────────────────

describe('4. capture-side normalization [v1.4 §1, §4.3]', () => {
  const EQUIVALENT_TO_0123456789AM = [
    'Oi23-4567-89am',
    '0I23456789AM',
    '0L23456789AM',
    'O123456789AM',
    '0i23456789am',
    '0l23456789am',
    'o123456789am',
    '0123456789am',
    ' 0123 4567 89AM ',
    '0123.4567.89AM',
  ]

  test.each(EQUIVALENT_TO_0123456789AM)('%s normalizes to 0123456789AM and validates', (raw) => {
    expect(normalize(raw)).toBe('0123456789AM')
    expect(captureBaselineCode(raw)).toMatchObject({ ok: true, canonical: '0123456789AM' })
  })

  test.each(['wr7x4k-9b2m3-p', 'WR7X4K-9B2M3P', 'WR 7X4K 9B2M 3P'])(
    '%s normalizes to WR7X4K9B2M3P and validates',
    (raw) => {
      expect(normalize(raw)).toBe('WR7X4K9B2M3P')
      expect(verifyCheck(normalize(raw)!)).toBe(true)
    },
  )

  test('mapping and check are independent stages: oIl3456789am maps cleanly, then fails', () => {
    expect(normalize('oIl3456789am')).toBe('0113456789AM')
    expect(verifyCheck('0113456789AM')).toBe(false)
    expect(captureBaselineCode('oIl3456789am')).toEqual({ ok: false, reason: 'check_failed' })
  })

  test('U is not in the alphabet and is rejected at normalization', () => {
    expect(normalize('WR7X4U-9B2M3P')).toBeNull()
    expect(captureBaselineCode('WR7X4U-9B2M3P')).toEqual({ ok: false, reason: 'out_of_alphabet' })
  })

  test('every grouping of a canonical sequence validates identically', () => {
    const code = 'WR7X4K9B2M3P'
    for (let cut = 1; cut < code.length; cut++) {
      const grouped = `${code.slice(0, cut)}-${code.slice(cut)}`
      expect(normalize(grouped)).toBe(code)
      expect(captureBaselineCode(grouped)).toEqual(captureBaselineCode(code))
    }
  })
})

// ── 5. Rejection before resolution ────────────────────────────────────────────

describe('5. a failed check is a capture error; the resolver is never invoked [v1.4 §6.4]', () => {
  /** Stand-in for the Phase-3 resolution chain: only reachable via `ok: true`. */
  function captureThenResolve(raw: string, resolver: (canonical: string) => void): boolean {
    const capture = captureBaselineCode(raw)
    if (!capture.ok) return false
    resolver(capture.canonical)
    return true
  }

  test('0 resolver invocations across every invalid capture', () => {
    const invalid = [
      ...BASE_CODES.flatMap(substitutionsOf),
      ...BASE_CODES.flatMap(adjacentTranspositionsOf),
      'WR7X4U-9B2M3P',
      'oIl3456789am',
      'WR7X4K9B2M3',
      '',
      '-----',
      'WR7X4K9B2M3Q',
    ]
    expect(invalid.length).toBeGreaterThan(2700)

    let calls = 0
    const resolver = (): void => {
      calls += 1
    }
    for (const raw of invalid) {
      expect(captureThenResolve(raw, resolver), `resolved an invalid capture: ${raw}`).toBe(false)
    }
    expect(calls).toBe(0)
  })

  test('exactly 1 resolver invocation on a valid capture', () => {
    const seen: string[] = []
    expect(captureThenResolve('wr7x4k-9b2m3-p', (c) => seen.push(c))).toBe(true)
    expect(seen).toEqual(['WR7X4K9B2M3P'])
  })
})

// ── 6. Structure from length ──────────────────────────────────────────────────

describe('6. structure from length [v1.4 §5, XVI.5.1–5.2]', () => {
  test('12 characters → 6 publisher + 5 local + 1 check', () => {
    expect(parseStructure('WR7X4K9B2M3P')).toEqual({
      publisher: 'WR7X4K',
      local: '9B2M3',
      check: 'P',
    })
  })

  test('13 characters → 6 publisher + 6 local + 1 check', () => {
    expect(parseStructure('WR7X4K9B2M3ZJ')).toEqual({
      publisher: 'WR7X4K',
      local: '9B2M3Z',
      check: 'J',
    })
  })

  test('14 characters → 6 publisher + 7 local + 1 check', () => {
    expect(parseStructure('WR7X4K9B2M3Z7F')).toEqual({
      publisher: 'WR7X4K',
      local: '9B2M3Z7',
      check: 'F',
    })
  })

  test('11 characters is rejected by the length guard, in both entry points', () => {
    expect(parseStructure('WR7X4K9B2M3')).toBeNull()
    expect(verifyCheck('WR7X4K9B2M3')).toBe(false)
    expect(captureBaselineCode('WR7X4K9B2M3')).toEqual({ ok: false, reason: 'too_short' })
  })

  test('display grouping is presentational only [XVI.5.5, P12]', () => {
    expect(formatBaselineCodeForDisplay('WR7X4K9B2M3P')).toBe('WR7X4K-9B2M3-P')
    expect(formatBaselineCodeForDisplay('WR7X4K9B2M3ZJ')).toBe('WR7X4K-9B2M3Z-J')
    expect(formatBaselineCodeForDisplay('WR7X4K9B2M3')).toBeNull()
    // Round-trips through capture: grouping never changes the verdict.
    expect(captureBaselineCode(formatBaselineCodeForDisplay('WR7X4K9B2M3P')!)).toMatchObject({
      ok: true,
      canonical: 'WR7X4K9B2M3P',
    })
  })
})

// ── 7. Length-error bounds, by kind ───────────────────────────────────────────

describe('7. length-error bounds [v1.4 §4.5] — asserted by kind, never as point values', () => {
  test('insertions: EXACTLY one surviving symbol per position, by construction', () => {
    for (const code of BASE_CODES) {
      for (let pos = 0; pos <= code.length; pos++) {
        const survivors = [...ALPHABET]
          .map((s) => code.slice(0, pos) + s + code.slice(pos))
          .filter(verifyCheck)
        expect(survivors, `${code} @ ${pos}`).toHaveLength(1)
        // A survivor is a structurally valid DIFFERENT identifier, never the original.
        expect(survivors[0]).not.toBe(code)
        expect(parseStructure(survivors[0])).not.toBeNull()
      }
    }
  })

  test('insertions: the §4.5 aggregate anchor for WR7X4K9B2M3P is 13 of 416', () => {
    const code = 'WR7X4K9B2M3P'
    const candidates: string[] = []
    for (let pos = 0; pos <= code.length; pos++) {
      for (const s of ALPHABET) candidates.push(code.slice(0, pos) + s + code.slice(pos))
    }
    expect(candidates).toHaveLength(416)
    expect(candidates.filter(verifyCheck)).toHaveLength(13)
  })

  test('deletions from a minimum-length code: EXACTLY 0 survive (length guard)', () => {
    for (const { code } of CANONICAL_VECTORS) {
      const candidates = Array.from({ length: code.length }, (_, i) =>
        code.slice(0, i) + code.slice(i + 1),
      )
      expect(candidates.every((c) => c.length === 11)).toBe(true)
      expect(candidates.filter(verifyCheck)).toEqual([])
    }
  })

  test('deletions from extended codes: the exact per-code anchors', () => {
    const anchors = [
      { code: 'WR7X4K9B2M3ZJ', positions: 13, survivor: 'WR7X4KB2M3ZJ' },
      { code: 'WR7X4K9B2M3Z7F', positions: 14, survivor: 'WR7X4KB2M3Z7F' },
    ]
    for (const { code, positions, survivor } of anchors) {
      const candidates = Array.from({ length: code.length }, (_, i) =>
        code.slice(0, i) + code.slice(i + 1),
      )
      expect(candidates).toHaveLength(positions)
      const survivors = candidates.filter(verifyCheck)
      expect(survivors).toEqual([survivor])
      expect(survivors[0]).not.toBe(code)
      expect(parseStructure(survivors[0])).not.toBeNull()
    }
  })

  test(
    'deletions from extended codes: sampled population rate within ±4σ of N/32',
    () => {
      // Seeded so the run is reproducible; the assertion itself is scale-free.
      let state = 0x9e3779b9
      const next = (): number => {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        return state
      }
      const pick = (n: number): number => next() % n

      const N = 200_000
      let survivors = 0
      let survivorsParsed = 0
      let survivorsDifferent = 0

      for (let i = 0; i < N; i++) {
        const stemLength = 12 + pick(2) // extended codes only: 13- and 14-symbol
        let stem = ''
        for (let j = 0; j < stemLength; j++) stem += ALPHABET[pick(32)]
        const code = stem + computeCheck(stem)
        const candidate = (() => {
          const at = pick(code.length)
          return code.slice(0, at) + code.slice(at + 1)
        })()
        if (!verifyCheck(candidate)) continue
        survivors += 1
        if (parseStructure(candidate) !== null) survivorsParsed += 1
        if (candidate !== code) survivorsDifferent += 1
      }

      const expected = N / 32
      const sigma = Math.sqrt(N * (1 / 32) * (31 / 32))
      expect(N).toBeGreaterThanOrEqual(200_000)
      expect(Math.abs(survivors - expected)).toBeLessThanOrEqual(4 * sigma)
      // Every survivor is a structurally valid DIFFERENT identifier.
      expect(survivorsParsed).toBe(survivors)
      expect(survivorsDifferent).toBe(survivors)
    },
    30_000,
  )
})
