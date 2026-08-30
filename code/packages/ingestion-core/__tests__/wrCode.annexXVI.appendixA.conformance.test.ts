/**
 * WR Code check core — conformance against Annex XVI v1.93 Appendix A.
 *
 * PHASE 0 ARTIFACT. This suite asserts nothing about the v1.93 *grammar*: the
 * module still implements the v1.4 prefix-less framing, and every structural
 * contradiction is tracked in the analysis report (CR-1…CR-4). What is pinned
 * here is the one thing v1.93 did NOT change — the check character — plus the
 * two subtleties discovered while proving that:
 *
 *  - F1a: A.1's quasigroup and the module's differ in 992 of 1024 cells yet
 *    induce an identical check. The identity is proven, not observed, so it is
 *    asserted as a theorem and the component-wise mixing hazard is pinned.
 *  - F1b: A.1's own claim of total anti-symmetry is FALSE for the operation
 *    A.1 defines (it is commutative). The module's presentation satisfies it.
 *    Both audits are asserted so neither can be silently "corrected".
 *
 * See `docs/analysis/annex-xvi-v193/implementation-state-analysis-v1.md`.
 *
 * The module's algebra is never re-implemented: it is reached only through the
 * public API, so this suite cannot pass by agreeing with a second copy of the
 * same mistake. A.1's algebra IS transcribed, because it is the other party to
 * the equivalence claim and must be independent to be worth asserting.
 */
import { describe, test, expect } from 'vitest'
import { ALPHABET, normalize, computeCheck, verifyCheck } from '../src/wrCode.js'

const VALUE = new Map([...ALPHABET].map((c, i) => [c, i] as const))

/** Alias-normalized values of a reference, per A.3. */
const valuesOf = (reference: string): number[] => {
  const canonical = normalize(reference)
  expect(canonical, `${reference} failed normalization`).not.toBeNull()
  return [...canonical!].map((c) => VALUE.get(c)!)
}

// ── Appendix A.1, transcribed — the annex's own presentation ──────────────────

/** GF(2^5), reduction polynomial x^5 + x^2 + 1. Shared by both presentations. */
const mulAlpha = (v: number): number => {
  const shifted = v << 1
  return (shifted & 0b100000 ? shifted ^ 0b100101 : shifted) & 0b11111
}

/** A.1: `x * y = alpha * (x XOR y)`. NOT the module's operation — see F1a. */
const starAnnex = (x: number, y: number): number => mulAlpha(x ^ y)

/** A.1: interim state folded left from 0. */
const interimAnnex = (values: readonly number[]): number =>
  values.reduce((state, d) => starAnnex(state, d), 0)

/** A.1: zero diagonal makes the check equal the interim value outright. */
const checkAnnex = (values: readonly number[]): string => ALPHABET[interimAnnex(values)]

// ── The module's operation, RECOVERED from its public API ─────────────────────

/**
 * The property audit in section 5 needs the module's operation itself, but the
 * module exports only the check. It is recovered rather than re-declared, so
 * the audit cannot pass by agreeing with a private copy of the same mistake.
 *
 * `fold` of a single symbol is its own value, so `computeCheck(sym(v))` is the
 * symbol for `A(v)`; `fold` of a pair is `star(x, y)`, so `computeCheck(sym(x)
 * + sym(y))` is the symbol for `A(star(x, y))`. `A` is a bijection, hence
 * invertible by table.
 */
const sym = (v: number): string => ALPHABET[v]
const A: readonly number[] = Array.from({ length: 32 }, (_, v) => VALUE.get(computeCheck(sym(v)))!)
const A_INVERSE: number[] = []
A.forEach((image, v) => {
  A_INVERSE[image] = v
})
const starModule = (x: number, y: number): number =>
  A_INVERSE[VALUE.get(computeCheck(sym(x) + sym(y)))!]!
const interimModule = (values: readonly number[]): number =>
  values.reduce((state, d) => starModule(state, d), 0)

// ── Appendix A.2, verbatim ────────────────────────────────────────────────────

/**
 * The seven published positives, one per class. `interim` is A.2's own
 * "interim after v" column, which is stated in A.1's convention — a value the
 * module never computes (F1a), recorded here to keep the two folds distinct.
 */
const A2_POSITIVES = [
  { cls: 'P', reference: 'P-WR7X4K-9B2M3C', check: 'C', interim: 12 },
  { cls: 'I', reference: 'I-K4T9M2-7QFA3X-S', check: 'S' },
  { cls: 'C', reference: 'C-ABC123-XYZ789-H', check: 'H', interim: 17 },
  { cls: 'SP', reference: 'SP-WR7X4K-H2N5V8-7', check: '7' },
  { cls: 'SI', reference: 'SI-K4T9M2-3ZDQ7E-H', check: 'H' },
  { cls: 'SC', reference: 'SC-ABC123-M8W2R4-0', check: '0' },
  { cls: 'SE', reference: 'SE-WR7X4K-6TCJ9F-P', check: 'P', interim: 22 },
] as const

/** A.2 alias rows: case folding, separator stripping, and L -> 1. */
const A2_ALIASES = [
  { input: 'p-wr7x4k-9b2m3c', of: 'P-WR7X4K-9B2M3C' },
  { input: 'PWR7X4K9B2M3C', of: 'P-WR7X4K-9B2M3C' },
  { input: 'C-ABCl23-XYZ789-H', of: 'C-ABC123-XYZ789-H' },
] as const

/**
 * A.2 negatives that are not instances of a generic error class.
 *
 * The prefix substitution is the load-bearing one: it is the SP positive with
 * its class prefix replaced, body and check untouched, so it can only fail if
 * the class prefix genuinely enters the check stem. It is the single strongest
 * published evidence that A.3's "coincide with the Crockford input values"
 * claim is real rather than decorative.
 */
const A2_STRUCTURAL_NEGATIVES = [
  { reference: 'P-WR7X4K-H2N5V8-7', why: 'prefix substitution (SP body under a P prefix)' },
  { reference: 'C-XYZ789-ABC123-H', why: 'transposed Publisher Identifiers in a C reference' },
] as const

// ── 1. Appendix A.3 — the class value coincidence ─────────────────────────────

describe('1. class values coincide with alias-normalized Crockford values [A.3]', () => {
  /**
   * A.3 permits computing the check over the whole alias-normalized string
   * instead of prepending parsed class values. That shortcut is the only
   * reason the v1.4 module reproduces v1.93 at all, so the coincidence it
   * rests on is asserted rather than trusted.
   */
  test.each([
    ['P', 22],
    ['I', 1],
    ['C', 12],
    ['S', 25],
    ['E', 14],
  ])('class symbol %s has value %i under the module alphabet', (symbol, expected) => {
    expect(valuesOf(symbol)).toEqual([expected])
  })

  test('the I prefix aliases to 1, so class detection cannot rely on the check', () => {
    // Consequence, not a curiosity: after alias mapping an I-class prefix is
    // indistinguishable from a body symbol 1, which is exactly why §XVI.5.3
    // orders prefix parsing BEFORE alias mapping (CR-4). The check is blind to
    // the distinction; only the grammar can make it.
    expect(normalize('I')).toBe('1')
    expect(normalize('I-K4T9M2-7QFA3X-S')).toBe('1K4T9M27QFA3XS')
  })
})

// ── 2. Appendix A.2 positives, under the module's unmodified functions ────────

describe('2. published positives reproduce under the module [A.2]', () => {
  test.each(A2_POSITIVES)('$cls $reference derives check $check', ({ reference, check }) => {
    const values = valuesOf(reference)
    const stem = [...normalize(reference)!].slice(0, -1).join('')
    expect(values.at(-1)).toBe(VALUE.get(check))
    expect(computeCheck(stem)).toBe(check)
  })

  test.each(A2_POSITIVES)('$cls $reference verifies whole [A.2]', ({ reference }) => {
    expect(verifyCheck(normalize(reference)!)).toBe(true)
  })

  test.each(A2_ALIASES)('alias $input verifies identically to $of [A.2]', ({ input, of }) => {
    expect(normalize(input)).toBe(normalize(of))
    expect(verifyCheck(normalize(input)!)).toBe(true)
  })
})

// ── 3. Appendix A.2 negatives ─────────────────────────────────────────────────

describe('3. published and exhaustive negatives are rejected [A.2]', () => {
  test.each(A2_STRUCTURAL_NEGATIVES)('rejects $reference — $why', ({ reference }) => {
    expect(verifyCheck(normalize(reference)!)).toBe(false)
  })

  /**
   * A.2 lists one instance each of substitution, transposition, and altered
   * check. Asserting the whole class over all seven positives strictly
   * dominates three hand-picked strings, and needs no vector I cannot cite.
   */
  test('no single substitution survives, in any position, on any positive', () => {
    let checked = 0
    for (const { reference } of A2_POSITIVES) {
      const canonical = normalize(reference)!
      for (let i = 0; i < canonical.length; i++) {
        for (let v = 0; v < 32; v++) {
          if (ALPHABET[v] === canonical[i]) continue
          const mutated = canonical.slice(0, i) + ALPHABET[v] + canonical.slice(i + 1)
          checked++
          expect(verifyCheck(mutated), `${reference} -> ${mutated} survived`).toBe(false)
        }
      }
    }
    // Guards the loop itself: a normalization regression that emptied the
    // references would otherwise make this test vacuously green.
    expect(checked).toBeGreaterThan(2000)
  })

  test('no adjacent transposition of unequal symbols survives', () => {
    let checked = 0
    for (const { reference } of A2_POSITIVES) {
      const canonical = normalize(reference)!
      for (let i = 0; i + 1 < canonical.length; i++) {
        if (canonical[i] === canonical[i + 1]) continue
        const mutated =
          canonical.slice(0, i) + canonical[i + 1] + canonical[i] + canonical.slice(i + 2)
        checked++
        expect(verifyCheck(mutated), `${reference} -> ${mutated} survived`).toBe(false)
      }
    }
    expect(checked).toBeGreaterThan(80)
  })

  test('every altered check character is rejected', () => {
    for (const { reference, check } of A2_POSITIVES) {
      const canonical = normalize(reference)!
      for (let v = 0; v < 32; v++) {
        if (ALPHABET[v] === check) continue
        expect(verifyCheck(canonical.slice(0, -1) + ALPHABET[v])).toBe(false)
      }
    }
  })
})

// ── 4. F1a — the equivalence theorem, and the hazard it creates ───────────────

describe('4. A.1 and the module induce the same check [F1a]', () => {
  /**
   * `module_check = alpha * I_n` and `annex_check = J_n`, where
   * `I_n = alpha*I_(n-1) XOR d_n` and `J_n = alpha*(J_(n-1) XOR d_n)`. Both
   * expand to `SUM alpha^(n-k+1) * d_k`, so they are equal identically. The
   * assertions below witness that expansion rather than restating it.
   */
  const moduleCheckOf = (values: readonly number[]): string =>
    computeCheck(values.map((v) => ALPHABET[v]).join(''))

  test('the two conventions agree on every sequence of length <= 3', () => {
    let compared = 0
    const walk = (prefix: number[], depth: number): void => {
      if (depth === 0) {
        compared++
        expect(moduleCheckOf(prefix), `diverged on [${prefix}]`).toBe(checkAnnex(prefix))
        return
      }
      for (let v = 0; v < 32; v++) walk([...prefix, v], depth - 1)
    }
    for (let length = 1; length <= 3; length++) walk([], length)
    expect(compared).toBe(32 + 32 ** 2 + 32 ** 3)
  })

  test('the two conventions agree across a deterministic long-sequence sweep', () => {
    // Deterministic by construction: a seeded LCG, so a failure is always
    // reproducible and this suite never flakes.
    let seed = 0x9e3779b9
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    for (let trial = 0; trial < 20000; trial++) {
      const length = 2 + (next() % 15)
      const values = Array.from({ length }, () => next() % 32)
      expect(moduleCheckOf(values), `diverged on [${values}]`).toBe(checkAnnex(values))
    }
  })

  test('A.2 interim values belong to A.1, not to the module [F1a]', () => {
    // The published "interim after v" column is A.1's J_n. Asserting that the
    // module does NOT produce it is what keeps the mixing hazard visible: the
    // two folds are only interchangeable end to end.
    for (const positive of A2_POSITIVES) {
      if (!('interim' in positive)) continue
      const stem = valuesOf(positive.reference).slice(0, -1)
      expect(interimAnnex(stem)).toBe(positive.interim)
      expect(ALPHABET[interimAnnex(stem)]).toBe(positive.check)
    }
  })

  test('the conventions are NOT interchangeable component-wise [F1a hazard]', () => {
    // Pinning the failure mode. Each convention is correct end to end, but
    // pairing one's interim with the other's final step yields a wrong check.
    // Anyone who "simplifies" by lifting A.1's interim next to the module's
    // derivation gets a red test here instead of silently wrong identifiers.
    const stem = valuesOf('P-WR7X4K-9B2M3C').slice(0, -1)

    // Both intact paths: correct.
    expect(checkAnnex(stem)).toBe('C')
    expect(computeCheck(stem.map(sym).join(''))).toBe('C')

    // The two interims are genuinely different numbers on the same input.
    expect(interimAnnex(stem)).toBe(12)
    expect(interimModule(stem)).toBe(6)

    // Mix 1 — the module's interim read off directly, as A.1's zero diagonal
    // would license. Yields '6'.
    expect(sym(interimModule(stem))).not.toBe('C')

    // Mix 2 — A.1's interim pushed through the module's final alpha step, as
    // v1.4 SS3 would license. Yields 'R'.
    expect(sym(mulAlpha(interimAnnex(stem)))).not.toBe('C')
  })
})

// ── 5. F1b — the property audit of both presentations ────────────────────────

describe('5. algebraic properties of both presentations [F1b]', () => {
  const cells = (op: (x: number, y: number) => number): number[][] =>
    Array.from({ length: 32 }, (_, x) => Array.from({ length: 32 }, (_, y) => op(x, y)))

  const isQuasigroup = (op: (x: number, y: number) => number): boolean => {
    const table = cells(op)
    for (let i = 0; i < 32; i++) {
      if (new Set(table[i]).size !== 32) return false
      if (new Set(table.map((row) => row[i])).size !== 32) return false
    }
    return true
  }

  /** `x*y = y*x  =>  x = y`. The two-variable condition; a 32^2 check. */
  const taPairViolations = (op: (x: number, y: number) => number): number => {
    let violations = 0
    for (let x = 0; x < 32; x++)
      for (let y = 0; y < 32; y++) if (x !== y && op(x, y) === op(y, x)) violations++
    return violations
  }

  /** `(c*x)*y = (c*y)*x  =>  x = y`. The three-variable condition; 32^3. */
  const taTripleViolations = (op: (x: number, y: number) => number): number => {
    let violations = 0
    for (let c = 0; c < 32; c++)
      for (let x = 0; x < 32; x++)
        for (let y = 0; y < 32; y++)
          if (x !== y && op(op(c, x), y) === op(op(c, y), x)) violations++
    return violations
  }

  test('both presentations are quasigroups', () => {
    expect(isQuasigroup(starModule)).toBe(true)
    expect(isQuasigroup(starAnnex)).toBe(true)
  })

  test('the module presentation is totally anti-symmetric, with a non-zero diagonal', () => {
    expect(taPairViolations(starModule)).toBe(0)
    expect(taTripleViolations(starModule)).toBe(0)
    // Registry Material v1.4 SS2.3 declines diagonal normalization on purpose.
    expect(Array.from({ length: 32 }, (_, x) => starModule(x, x)).every((v) => v === 0)).toBe(false)
  })

  test("A.1's operation has a zero diagonal but is commutative, so it is NOT TA", () => {
    expect(Array.from({ length: 32 }, (_, x) => starAnnex(x, x)).every((v) => v === 0)).toBe(true)

    // The defect, pinned exactly. A.1 claims total anti-symmetry "verified
    // exhaustively over all 32^3 triples"; the triple condition does hold, and
    // an exhaustive sweep over triples is precisely what would miss the pair
    // condition that fails for every off-diagonal pair.
    expect(taTripleViolations(starAnnex)).toBe(0)
    expect(taPairViolations(starAnnex)).toBe(32 * 32 - 32)
  })

  test('the two published tables differ in 992 of 1024 cells [G-9b]', () => {
    const moduleTable = cells(starModule)
    const annexTable = cells(starAnnex)
    let differing = 0
    for (let x = 0; x < 32; x++)
      for (let y = 0; y < 32; y++) if (moduleTable[x][y] !== annexTable[x][y]) differing++
    expect(differing).toBe(992)
  })

  test("A.1's fold still detects the error classes A.2 requires", () => {
    // Why F1b is a defect in the justification and not in the result: the
    // per-round alpha multiplication supplies the positional asymmetry the
    // commutative operation lacks.
    const canonical = normalize('P-WR7X4K-9B2M3C')!
    const foldOf = (s: string): number => interimAnnex([...s].map((c) => VALUE.get(c)!))
    expect(foldOf(canonical)).toBe(0)

    for (let i = 0; i < canonical.length; i++) {
      for (let v = 0; v < 32; v++) {
        if (ALPHABET[v] === canonical[i]) continue
        expect(foldOf(canonical.slice(0, i) + ALPHABET[v] + canonical.slice(i + 1))).not.toBe(0)
      }
    }
    for (let i = 0; i + 1 < canonical.length; i++) {
      if (canonical[i] === canonical[i + 1]) continue
      const mutated =
        canonical.slice(0, i) + canonical[i + 1] + canonical[i] + canonical.slice(i + 2)
      expect(foldOf(mutated)).not.toBe(0)
    }
  })
})
