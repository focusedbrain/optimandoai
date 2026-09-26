/**
 * WR Code check core — conformance against Annex XVI v1.95 Appendix A.
 *
 * Authority: `docs/spec/Annex_XVI_WR_Code_v1.95.pdf`, sha256
 * 064AAD6D…829F, "Version 1.95 — Consolidated Technical Disclosure —
 * 30 August 2026". (The per-page running header still reads "Version 1.3";
 * that is a stale artifact, not the document's identity.)
 *
 * NOTE ON IDENTITY: two byte-different documents have carried the string
 * "Version 1.95" — `D0BDA9E7…6A00` and this one, which corrects A.2's SE
 * interim. The version string alone does not identify the input, so the hash
 * above is the authority for what this suite was written against.
 *
 * This suite asserts nothing about the v1.95 *grammar*: the module still
 * implements the v1.4 prefix-less framing, and every structural contradiction
 * is tracked in the analysis report (CR-1…CR-4). What is pinned here is the one
 * thing v1.95 did not change — the check character — now that A.1 and the
 * module agree exactly.
 *
 * HISTORY, because it explains the shape of section 5. Annex v1.93 A.1 printed
 * the operation as `α · (x ⊕ y)` with a zero diagonal, claiming total
 * anti-symmetry. That operation is commutative, so it is NOT totally
 * anti-symmetric, and its table differed from this module's in 992 of 1024
 * cells while still yielding an identical check. v1.95 corrected A.1 to
 * `(α · x) ⊕ y` — this module's operation — and its changelog records the same
 * cause independently: a sweep "over 32³ triples exercises only the first
 * condition, which is why the error passed verification". Section 5 therefore
 * asserts the corrected form and guards against the old one returning.
 *
 * The module's algebra is never re-implemented: it is reached only through the
 * public API, so this suite cannot pass by agreeing with a second copy of the
 * same mistake.
 */
import { describe, test, expect } from 'vitest'
import { ALPHABET, normalize, computeCheck, verifyCheck } from '../src/wrCode.js'

const VALUE = new Map([...ALPHABET].map((c, i) => [c, i] as const))
const sym = (v: number): string => ALPHABET[v]

/** Alias-normalized values of a reference, per A.3. */
const valuesOf = (reference: string): number[] => {
  const canonical = normalize(reference)
  expect(canonical, `${reference} failed normalization`).not.toBeNull()
  return [...canonical!].map((c) => VALUE.get(c)!)
}

// ── The module's operation, RECOVERED from its public API ─────────────────────

/**
 * `fold` of a single symbol is its own value, so `computeCheck(sym(v))` is the
 * symbol for `A(v)`; `fold` of a pair is `star(x, y)`, so `computeCheck(sym(x)
 * + sym(y))` is the symbol for `A(star(x, y))`. `A` is a bijection, hence
 * invertible by table.
 */
const A: readonly number[] = Array.from({ length: 32 }, (_, v) => VALUE.get(computeCheck(sym(v)))!)
const A_INVERSE: number[] = []
A.forEach((image, v) => {
  A_INVERSE[image] = v
})
const star = (x: number, y: number): number =>
  A_INVERSE[VALUE.get(computeCheck(sym(x) + sym(y)))!]!
const interim = (values: readonly number[]): number => values.reduce((s, d) => star(s, d), 0)

// ── Appendix A.1, transcribed verbatim ────────────────────────────────────────

/**
 * The published 32×32 table. Row = left operand (current interim), column =
 * right operand (next value), both in reference-alphabet order.
 */
const A1_TABLE = [
  '0 1 2 3 4 5 6 7 8 9 A B C D E F G H J K M N P Q R S T V W X Y Z',
  '2 3 0 1 6 7 4 5 A B 8 9 E F C D J K G H P Q M N T V R S Y Z W X',
  '4 5 6 7 0 1 2 3 C D E F 8 9 A B M N P Q G H J K W X Y Z R S T V',
  '6 7 4 5 2 3 0 1 E F C D A B 8 9 P Q M N J K G H Y Z W X T V R S',
  '8 9 A B C D E F 0 1 2 3 4 5 6 7 R S T V W X Y Z G H J K M N P Q',
  'A B 8 9 E F C D 2 3 0 1 6 7 4 5 T V R S Y Z W X J K G H P Q M N',
  'C D E F 8 9 A B 4 5 6 7 0 1 2 3 W X Y Z R S T V M N P Q G H J K',
  'E F C D A B 8 9 6 7 4 5 2 3 0 1 Y Z W X T V R S P Q M N J K G H',
  'G H J K M N P Q R S T V W X Y Z 0 1 2 3 4 5 6 7 8 9 A B C D E F',
  'J K G H P Q M N T V R S Y Z W X 2 3 0 1 6 7 4 5 A B 8 9 E F C D',
  'M N P Q G H J K W X Y Z R S T V 4 5 6 7 0 1 2 3 C D E F 8 9 A B',
  'P Q M N J K G H Y Z W X T V R S 6 7 4 5 2 3 0 1 E F C D A B 8 9',
  'R S T V W X Y Z G H J K M N P Q 8 9 A B C D E F 0 1 2 3 4 5 6 7',
  'T V R S Y Z W X J K G H P Q M N A B 8 9 E F C D 2 3 0 1 6 7 4 5',
  'W X Y Z R S T V M N P Q G H J K C D E F 8 9 A B 4 5 6 7 0 1 2 3',
  'Y Z W X T V R S P Q M N J K G H E F C D A B 8 9 6 7 4 5 2 3 0 1',
  '5 4 7 6 1 0 3 2 D C F E 9 8 B A N M Q P H G K J X W Z Y S R V T',
  '7 6 5 4 3 2 1 0 F E D C B A 9 8 Q P N M K J H G Z Y X W V T S R',
  '1 0 3 2 5 4 7 6 9 8 B A D C F E H G K J N M Q P S R V T X W Z Y',
  '3 2 1 0 7 6 5 4 B A 9 8 F E D C K J H G Q P N M V T S R Z Y X W',
  'D C F E 9 8 B A 5 4 7 6 1 0 3 2 X W Z Y S R V T N M Q P H G K J',
  'F E D C B A 9 8 7 6 5 4 3 2 1 0 Z Y X W V T S R Q P N M K J H G',
  '9 8 B A D C F E 1 0 3 2 5 4 7 6 S R V T X W Z Y H G K J N M Q P',
  'B A 9 8 F E D C 3 2 1 0 7 6 5 4 V T S R Z Y X W K J H G Q P N M',
  'N M Q P H G K J X W Z Y S R V T 5 4 7 6 1 0 3 2 D C F E 9 8 B A',
  'Q P N M K J H G Z Y X W V T S R 7 6 5 4 3 2 1 0 F E D C B A 9 8',
  'H G K J N M Q P S R V T X W Z Y 1 0 3 2 5 4 7 6 9 8 B A D C F E',
  'K J H G Q P N M V T S R Z Y X W 3 2 1 0 7 6 5 4 B A 9 8 F E D C',
  'X W Z Y S R V T N M Q P H G K J D C F E 9 8 B A 5 4 7 6 1 0 3 2',
  'Z Y X W V T S R Q P N M K J H G F E D C B A 9 8 7 6 5 4 3 2 1 0',
  'S R V T X W Z Y H G K J N M Q P 9 8 B A D C F E 1 0 3 2 5 4 7 6',
  'V T S R Z Y X W K J H G Q P N M B A 9 8 F E D C 3 2 1 0 7 6 5 4',
].map((row) => row.split(' ').map((c) => VALUE.get(c)!))

// ── Appendix A.2, verbatim ────────────────────────────────────────────────────

/**
 * The seven published positives, one per class, with A.2's own "Check input v"
 * and "Interim after v" columns.
 *
 * All seven interims are now correct. The SE row briefly carried the stale
 * pre-correction value 22 (see the report's Q11); it was corrected to 11 on
 * 2026-08-30, and this suite asserts the corrected column with no exceptions.
 */
const A2_POSITIVES = [
  { cls: 'P',  reference: 'P-WR7X4K-9B2M3C',    v: [22, 28, 24, 7, 29, 4, 19, 9, 11, 2, 20, 3],           publishedInterim: 6,  check: 'C' },
  { cls: 'I',  reference: 'I-K4T9M2-7QFA3X-S',  v: [1, 19, 4, 26, 9, 20, 2, 7, 23, 15, 10, 3, 29],        publishedInterim: 30, check: 'S' },
  { cls: 'C',  reference: 'C-ABC123-XYZ789-H',  v: [12, 10, 11, 12, 1, 2, 3, 29, 30, 31, 7, 8, 9],        publishedInterim: 26, check: 'H' },
  { cls: 'SP', reference: 'SP-WR7X4K-H2N5V8-7', v: [25, 22, 28, 24, 7, 29, 4, 19, 17, 2, 21, 5, 27, 8],   publishedInterim: 17, check: '7' },
  { cls: 'SI', reference: 'SI-K4T9M2-3ZDQ7E-H', v: [25, 1, 19, 4, 26, 9, 20, 2, 3, 31, 13, 23, 7, 14],    publishedInterim: 26, check: 'H' },
  { cls: 'SC', reference: 'SC-ABC123-M8W2R4-0', v: [25, 12, 10, 11, 12, 1, 2, 3, 20, 8, 28, 2, 24, 4],    publishedInterim: 0,  check: '0' },
  { cls: 'SE', reference: 'SE-WR7X4K-6TCJ9F-P', v: [25, 14, 28, 24, 7, 29, 4, 19, 6, 26, 12, 18, 9, 15],  publishedInterim: 11, check: 'P' },
] as const

/** A.2 negatives, verbatim. Each must fail local verification. */
const A2_NEGATIVES = [
  { reference: 'P-WR7Z4K-9B2M3C', why: 'single substitution (X->Z at body position 4)' },
  { reference: 'P-WR7X4K-B92M3C', why: 'adjacent transposition (9B -> B9)' },
  { reference: 'P-WR7X4K-H2N5V8-7', why: 'prefix substitution (SP body presented as P)' },
  { reference: 'C-XYZ789-ABC123-H', why: 'transposed Publisher Identifiers in a C reference' },
  { reference: 'C-ABC123-XYZ789-J', why: 'check symbol altered' },
] as const

/** A.2 alias row: case folding, separator stripping, and body alias l for 1. */
const A2_ALIASES = [
  { input: 'p-wr7x4k-9b2m3c', of: 'P-WR7X4K-9B2M3C' },
  { input: 'PWR7X4K9B2M3C', of: 'P-WR7X4K-9B2M3C' },
  { input: 'C-ABCl23-XYZ789-H', of: 'C-ABC123-XYZ789-H' },
] as const

// ── 1. Appendix A.3 ───────────────────────────────────────────────────────────

describe('1. Class Value Table [A.3]', () => {
  test.each([
    ['P', 22],
    ['I', 1],
    ['C', 12],
    ['S', 25],
    ['E', 14],
  ])('class symbol %s has value %i', (symbol, expected) => {
    expect(valuesOf(symbol)).toEqual([expected])
  })

  test.each([
    ['P', [22]],
    ['I', [1]],
    ['C', [12]],
    ['SP', [25, 22]],
    ['SI', [25, 1]],
    ['SC', [25, 12]],
    ['SE', [25, 14]],
  ])('class value sequence for %s is %j', (prefix, expected) => {
    expect(valuesOf(prefix)).toEqual(expected)
  })

  test('the I prefix aliases to 1, so class detection cannot rely on the check', () => {
    // A.3: "the prefix is parsed before alias normalization (§XVI.5.2)". After
    // alias mapping an I-class prefix is indistinguishable from a body symbol
    // 1; the check is blind to the difference, only the grammar can make it.
    expect(normalize('I')).toBe('1')
    expect(normalize('I-K4T9M2-7QFA3X-S')).toBe('1K4T9M27QFA3XS')
  })
})

// ── 2. Appendix A.1 — the published table, cell for cell ──────────────────────

describe('2. published quasigroup table [A.1]', () => {
  test('the fixture is the full 32x32 table', () => {
    expect(A1_TABLE).toHaveLength(32)
    for (const row of A1_TABLE) expect(row).toHaveLength(32)
  })

  test('every one of the 1024 published cells matches the module', () => {
    let compared = 0
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        compared++
        expect(A1_TABLE[x][y], `row ${sym(x)} column ${sym(y)}`).toBe(star(x, y))
      }
    }
    expect(compared).toBe(1024)
  })

  test('A.1 reference implementation: check = alpha * interim', () => {
    // A.1: `check = ALPHABET[mul2(interim(v))]`. `computeCheck` is exactly the
    // composition of the module's fold with one more alpha step.
    for (let v = 0; v < 32; v++) {
      expect(computeCheck(sym(v))).toBe(sym(A[v]))
    }
  })
})

// ── 3. Appendix A.2 positives ─────────────────────────────────────────────────

describe('3. published positives reproduce under the module [A.2]', () => {
  test.each(A2_POSITIVES)('$cls check input v matches the alias-normalized $reference', ({ reference, v, check }) => {
    const values = valuesOf(reference)
    expect(values.slice(0, -1)).toEqual([...v])
    expect(values.at(-1)).toBe(VALUE.get(check))
  })

  test.each(A2_POSITIVES)('$cls derives check $check', ({ v, check }) => {
    expect(sym(A[interim(v)])).toBe(check)
    expect(computeCheck(v.map(sym).join(''))).toBe(check)
  })

  test.each(A2_POSITIVES)('$cls $reference verifies whole', ({ reference }) => {
    expect(verifyCheck(normalize(reference)!)).toBe(true)
  })

  /**
   * A.2's "Interim after v" column. Asserted separately from the check because
   * the two can disagree independently: the interim is one alpha step short of
   * the check, so a wrong interim can still print a right check symbol. That is
   * exactly how the Q11 error hid in the SE row.
   */
  test.each(A2_POSITIVES)('$cls interim after v is $publishedInterim', ({ publishedInterim, v }) => {
    expect(interim(v)).toBe(publishedInterim)
  })

  test('an interim is one alpha step short of its check, so the columns are independent', () => {
    // Guards the assertion above against being weakened back into a check test.
    for (const { v, publishedInterim, check } of A2_POSITIVES) {
      expect(sym(A[publishedInterim])).toBe(check)
      expect(interim(v)).toBe(publishedInterim)
    }
    // The SE row is the witness: its old stale interim 22 is the value of its
    // own check symbol P, which is why the row looked self-consistent.
    expect(VALUE.get('P')).toBe(22)
    expect(A[11]).toBe(22)
  })
})

// ── 4. Appendix A.2 negatives and aliases ─────────────────────────────────────

describe('4. published negatives are rejected, aliases accepted [A.2]', () => {
  test.each(A2_NEGATIVES)('rejects $reference — $why', ({ reference }) => {
    expect(verifyCheck(normalize(reference)!)).toBe(false)
  })

  test.each(A2_ALIASES)('alias $input verifies identically to $of', ({ input, of }) => {
    expect(normalize(input)).toBe(normalize(of))
    expect(verifyCheck(normalize(input)!)).toBe(true)
  })

  /**
   * §XVI.5.4 claims detection of "every single-symbol substitution and every
   * transposition of two adjacent symbols anywhere in v, including across the
   * class/body boundary and between the final body symbol and the check
   * symbol". A.2 evidences that with one instance each; the claim is asserted
   * here in full over all seven positives.
   */
  test('no single substitution survives, in any position, on any positive', () => {
    let checked = 0
    for (const { reference } of A2_POSITIVES) {
      const canonical = normalize(reference)!
      for (let i = 0; i < canonical.length; i++) {
        for (let v = 0; v < 32; v++) {
          if (sym(v) === canonical[i]) continue
          checked++
          expect(
            verifyCheck(canonical.slice(0, i) + sym(v) + canonical.slice(i + 1)),
            `${reference} -> position ${i} := ${sym(v)} survived`,
          ).toBe(false)
        }
      }
    }
    // Guards the loop: a normalization regression that emptied the references
    // would otherwise make this vacuously green.
    expect(checked).toBeGreaterThan(2000)
  })

  test('no adjacent transposition of unequal symbols survives', () => {
    let checked = 0
    for (const { reference } of A2_POSITIVES) {
      const canonical = normalize(reference)!
      for (let i = 0; i + 1 < canonical.length; i++) {
        if (canonical[i] === canonical[i + 1]) continue
        checked++
        expect(
          verifyCheck(
            canonical.slice(0, i) + canonical[i + 1] + canonical[i] + canonical.slice(i + 2),
          ),
          `${reference} -> swap at ${i} survived`,
        ).toBe(false)
      }
    }
    expect(checked).toBeGreaterThan(80)
  })

  test('every altered check character is rejected', () => {
    for (const { reference, check } of A2_POSITIVES) {
      const canonical = normalize(reference)!
      for (let v = 0; v < 32; v++) {
        if (sym(v) === check) continue
        expect(verifyCheck(canonical.slice(0, -1) + sym(v))).toBe(false)
      }
    }
  })
})

// ── 5. Appendix A.1 properties, and the v1.93 operation as a regression ───────

describe('5. algebraic properties A.1 claims [A.1]', () => {
  const pairViolations = (op: (x: number, y: number) => number): number => {
    let n = 0
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) if (x !== y && op(x, y) === op(y, x)) n++
    return n
  }
  const tripleViolations = (op: (x: number, y: number) => number): number => {
    let n = 0
    for (let c = 0; c < 32; c++)
      for (let x = 0; x < 32; x++)
        for (let y = 0; y < 32; y++)
          if (x !== y && op(op(c, x), y) === op(op(c, y), x)) n++
    return n
  }

  test('quasigroup: every row and every column is a permutation (all 32^2 pairs)', () => {
    for (let i = 0; i < 32; i++) {
      expect(new Set(Array.from({ length: 32 }, (_, y) => star(i, y))).size).toBe(32)
      expect(new Set(Array.from({ length: 32 }, (_, x) => star(x, i))).size).toBe(32)
    }
  })

  test('total anti-symmetry in BOTH conditions, as v1.95 A.1 claims', () => {
    expect(pairViolations(star)).toBe(0)
    expect(tripleViolations(star)).toBe(0)
  })

  test('the diagonal is (alpha ^ 1) * x, not zero', () => {
    // v1.95 removed the zero-diagonal claim. A(x) XOR x is (alpha ^ 1)*x.
    for (let x = 0; x < 32; x++) expect(star(x, x)).toBe(A[x] ^ x)
    expect(Array.from({ length: 32 }, (_, x) => star(x, x)).every((v) => v === 0)).toBe(false)
  })

  /**
   * Regression guard against the withdrawn v1.93 operation `α · (x ⊕ y)`.
   * It is commutative, so it fails the pair condition for every unequal pair
   * while still passing a 32³ triple sweep — the exact trap v1.95's changelog
   * describes. If anyone reintroduces it here, this test names the reason.
   */
  test('the withdrawn v1.93 operation is not what the module implements', () => {
    const withdrawn = (x: number, y: number): number => A[x ^ y]

    expect(withdrawn(0, 1)).toBe(2)
    expect(star(0, 1)).toBe(1)

    expect(pairViolations(withdrawn)).toBe(32 * 32 - 32)
    expect(tripleViolations(withdrawn)).toBe(0)
    expect(Array.from({ length: 32 }, (_, x) => withdrawn(x, x)).every((v) => v === 0)).toBe(true)

    // Why the error was invisible for so long: both operations yield the same
    // check symbol on every input. The withdrawn fold reads its interim off
    // directly; the corrected one applies one more alpha step.
    const withdrawnFold = (vals: readonly number[]): number =>
      vals.reduce((s, d) => withdrawn(s, d), 0)
    for (const { v, check } of A2_POSITIVES) {
      expect(sym(withdrawnFold(v))).toBe(check)
      expect(sym(A[interim(v)])).toBe(check)
    }
  })
})
