# WR Code® Check Profile — Registry Material v1.4

Registry-published companion to Annex XVI §XVI.5.3–5.4 (Optirando™ Canon).
This document is the authoritative check profile: the concrete quasigroup,
the check-derivation rule, and the conformance test vectors. An identifier
generated or validated with a different table, mapping, or algorithm is
non-conformant (§XVI.5.4).

**Version history.**
- v1.0 (2026-08-05): initial publication — construction, 32×32 table, test
  vectors, TypeScript reference implementation.
- v1.1 (2026-08-07): adds the explicit check-derivation rule (§3) and the
  diagonal-normalization note (§2.3); vector set deterministically
  regenerated and cross-verified with two independent implementations.
- v1.2 (2026-08-07): corrects the §4.5 deletion measurement, which had
  counted fold-only survivors and contradicted the §5 reference
  implementation's length guard. Under §5 semantics (normative), 0 of 12
  single deletions from a minimum-length code survive validation — the
  length guard catches every one; the probabilistic deletion bound applies
  to extended codes only. Independently verified during third-party
  conformance re-verification (2,697 substitution and 59 transposition
  negatives, 0 missed; strong TA over all 32³ triples). Construction, table,
  mapping, §3, and all §4.1–§4.4 vectors unchanged; every prior positive
  vector remains valid. Supersedes v1.1.
- v1.3 (2026-08-07): reclassifies the §4.5 bounds as exact versus
  statistical, per third-party conformance verification. Insertions are
  exact by construction (the fold is linear in each symbol with a bijective
  coefficient, so every insertion position has exactly one surviving
  symbol: survivors = length+1, rate exactly 1/32 — verified across 7,007
  positions with zero exceptions); minimum-length deletions are exactly 0;
  only extended-code deletions are statistical and are now pinned with a
  tolerance band instead of a point value. No algorithmic change; the exact
  bounds are strictly stronger than the v1.2 approximations. Supersedes
  v1.2.
- v1.4 (2026-08-07): corrects the extended-deletion figures per
  third-party verification at scale: the expectation is exactly 1/32
  (uniform fold of the deleted candidate; 3.9 million-trial measurement
  0.03120 vs. 0.03125), not the small-sample mean 1/33.4 quoted in v1.3;
  the v1.3 tolerance band (1/28 … 1/38 at >= 5,000 trials) flaked at
  ~3.7% per run and is replaced by a scale-free +-4-sigma assertion at
  >= 200,000 trials. No algorithmic change; sample-derived counts are no
  longer cited as constants. Supersedes v1.3.

---

## 1. Alphabet and symbol→element mapping (normative)

The alphabet is Crockford Base32 in canonical order:

```
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

Symbol values are the positions in this string, 0…31. This ordering IS the
symbol→GF(2⁵)-element mapping: symbol value v denotes the field element
whose binary representation is v (5 bits, b₄b₃b₂b₁b₀ = coefficients of
x⁴…x⁰).

Capture-side normalization (per Annex XVI §XVI.5.3, §XVI.5.5), applied
before any validation:
1. discard all non-alphanumeric characters (separators, spaces);
2. fold to upper case;
3. map I → 1, L → 1, O → 0;
4. reject any remaining symbol outside the alphabet (U in particular).

## 2. The quasigroup (normative)

### 2.1 Closed form
Over GF(2⁵) with reduction polynomial x⁵ + x² + 1 (0b100101):

```
x ∗ y = A(x) XOR y        where A(v) = α·v  (multiplication by α = x)
```

Bit-level: `A(v) = (v << 1) XOR (bit₄(v) ? 0b100101 : 0), masked to 5 bits`.

### 2.2 Properties (verified exhaustively; re-verification is a conformance
test)
- Quasigroup: every row and every column of the table is a permutation.
- Totally anti-symmetric, both conditions over all 32³ triples:
  - weak: `x ∗ y = y ∗ x ⟹ x = y`
  - strong: `(c ∗ x) ∗ y = (c ∗ y) ∗ x ⟹ x = y`
- Consequence (Damm): all single-symbol substitutions and all
  adjacent-transposition errors are detected at every conformant length.
- Closed-form proof note (informative): since
  `(c ∗ x) ∗ y = A²(c) ⊕ A(x) ⊕ y`, the strong condition collapses to the
  weak one, which reduces to `(α ⊕ 1)·x = (α ⊕ 1)·y` with `α ⊕ 1 ≠ 0` in
  GF(2⁵), hence `x = y`. The exhaustive run in a conformance suite is a
  regression guard over the published table, not the proof.

### 2.3 Diagonal-normalization note (normative clarification)
This quasigroup is deliberately **not** diagonal-normalized:
`x ∗ x = (α ⊕ 1)·x ≠ 0` for x ≠ 0. Total anti-symmetry is defined solely by
the two implications in §2.2 and does not require a zero diagonal; the zero
diagonal in Damm's original presentation is a normalization convenience
(every TA quasigroup is column-permutable into that form) whose only effect
is to make the check character equal the interim value. This profile instead
states the check derivation explicitly in §3. A validator that assumes
`check = interim` is non-conformant (correct for only 1 of 32 interim
states).

### 2.4 The 32×32 table
Row = left operand x, column = right operand y, cell = x ∗ y, all as
symbols. The table is fully determined by §2.1; it is printed for
independent verification and for table-driven implementations.

```
    0 1 2 3 4 5 6 7 8 9 A B C D E F G H J K M N P Q R S T V W X Y Z
0 | 0 1 2 3 4 5 6 7 8 9 A B C D E F G H J K M N P Q R S T V W X Y Z
1 | 2 3 0 1 6 7 4 5 A B 8 9 E F C D J K G H P Q M N T V R S Y Z W X
2 | 4 5 6 7 0 1 2 3 C D E F 8 9 A B M N P Q G H J K W X Y Z R S T V
3 | 6 7 4 5 2 3 0 1 E F C D A B 8 9 P Q M N J K G H Y Z W X T V R S
4 | 8 9 A B C D E F 0 1 2 3 4 5 6 7 R S T V W X Y Z G H J K M N P Q
5 | A B 8 9 E F C D 2 3 0 1 6 7 4 5 T V R S Y Z W X J K G H P Q M N
6 | C D E F 8 9 A B 4 5 6 7 0 1 2 3 W X Y Z R S T V M N P Q G H J K
7 | E F C D A B 8 9 6 7 4 5 2 3 0 1 Y Z W X T V R S P Q M N J K G H
8 | G H J K M N P Q R S T V W X Y Z 0 1 2 3 4 5 6 7 8 9 A B C D E F
9 | J K G H P Q M N T V R S Y Z W X 2 3 0 1 6 7 4 5 A B 8 9 E F C D
A | M N P Q G H J K W X Y Z R S T V 4 5 6 7 0 1 2 3 C D E F 8 9 A B
B | P Q M N J K G H Y Z W X T V R S 6 7 4 5 2 3 0 1 E F C D A B 8 9
C | R S T V W X Y Z G H J K M N P Q 8 9 A B C D E F 0 1 2 3 4 5 6 7
D | T V R S Y Z W X J K G H P Q M N A B 8 9 E F C D 2 3 0 1 6 7 4 5
E | W X Y Z R S T V M N P Q G H J K C D E F 8 9 A B 4 5 6 7 0 1 2 3
F | Y Z W X T V R S P Q M N J K G H E F C D A B 8 9 6 7 4 5 2 3 0 1
G | 5 4 7 6 1 0 3 2 D C F E 9 8 B A N M Q P H G K J X W Z Y S R V T
H | 7 6 5 4 3 2 1 0 F E D C B A 9 8 Q P N M K J H G Z Y X W V T S R
J | 1 0 3 2 5 4 7 6 9 8 B A D C F E H G K J N M Q P S R V T X W Z Y
K | 3 2 1 0 7 6 5 4 B A 9 8 F E D C K J H G Q P N M V T S R Z Y X W
M | D C F E 9 8 B A 5 4 7 6 1 0 3 2 X W Z Y S R V T N M Q P H G K J
N | F E D C B A 9 8 7 6 5 4 3 2 1 0 Z Y X W V T S R Q P N M K J H G
P | 9 8 B A D C F E 1 0 3 2 5 4 7 6 S R V T X W Z Y H G K J N M Q P
Q | B A 9 8 F E D C 3 2 1 0 7 6 5 4 V T S R Z Y X W K J H G Q P N M
R | N M Q P H G K J X W Z Y S R V T 5 4 7 6 1 0 3 2 D C F E 9 8 B A
S | Q P N M K J H G Z Y X W V T S R 7 6 5 4 3 2 1 0 F E D C B A 9 8
T | H G K J N M Q P S R V T X W Z Y 1 0 3 2 5 4 7 6 9 8 B A D C F E
V | K J H G Q P N M V T S R Z Y X W 3 2 1 0 7 6 5 4 B A 9 8 F E D C
W | X W Z Y S R V T N M Q P H G K J D C F E 9 8 B A 5 4 7 6 1 0 3 2
X | Z Y X W V T S R Q P N M K J H G F E D C B A 9 8 7 6 5 4 3 2 1 0
Y | S R V T X W Z Y H G K J N M Q P 9 8 B A D C F E 1 0 3 2 5 4 7 6
Z | V T S R Z Y X W K J H G Q P N M B A 9 8 F E D C 3 2 1 0 7 6 5 4
```

## 3. Check derivation and validation (normative)

- **Fold.** Accumulator seed 0; left-to-right over the canonical ungrouped
  stem (publisher part + local part, check excluded):
  `c ← c ∗ dᵢ`.
- **Check character.** The unique symbol k solving `interim ∗ k = 0`. For
  this construction that is `k = A(interim)` (since
  `A(interim) XOR k = 0 ⟺ k = A(interim)`).
- **Validation.** Fold the full canonical string, check character included;
  accept iff the accumulator is 0 **and** the canonical length is at least
  12. The minimum-length guard is part of the profile (§5), not an
  implementation addition. A failed check is a capture error and MUST NOT
  trigger resolution (§XVI.5.4).
- The check is computed over the canonical ungrouped form only (§XVI.5.5),
  at every conformant length (12 characters and extended).

## 4. Test vectors (all cross-verified with two independent implementations
and reproduced by third-party conformance re-verification)

### 4.1 Canonical positive vectors (stem → check → full code)
| Stem | Len | Check | Full code |
|---|---|---|---|
| `WR7X4K9B2M3` | 11 | `P` | `WR7X4K9B2M3P` |
| `ABC123DEF45` | 11 | `4` | `ABC123DEF454` |
| `00000000000` | 11 | `0` | `000000000000` |
| `0123456789A` | 11 | `M` | `0123456789AM` |
| `ZZZZZZZZZZZ` | 11 | `K` | `ZZZZZZZZZZZK` |

The degenerate vectors are deliberate: `000000000000` exercises the
accumulator at its fixed point (and has no unequal neighbours, so its
transposition class is empty); `ZZZZZZZZZZZK` exercises the extreme with a
single unequal-neighbour pair.

### 4.2 Extended-local-part vectors (per Annex XVI §XVI.5.2; check
recomputed over the full extended canonical form)
| Stem | Len | Structure | Check | Full code |
|---|---|---|---|---|
| `WR7X4K9B2M3Z` | 12 | 6 + 6 + 1 | `J` | `WR7X4K9B2M3ZJ` |
| `WR7X4K9B2M3Z7` | 13 | 6 + 7 + 1 | `F` | `WR7X4K9B2M3Z7F` |

Note: `WR7X4K9B2M3P` (12) and `WR7X4K9B2M3ZJ` (13) are distinct identifiers
with distinct referents; prefix relationships carry no resolution semantics
(adopted decision D3).

### 4.3 Normalization vectors (raw input → canonical → verdict)
| Raw input | Canonical | Valid |
|---|---|---|
| `wr7x4k-9b2m3-p` | `WR7X4K9B2M3P` | yes |
| `WR7X4K-9B2M3P` (single separator) | `WR7X4K9B2M3P` | yes |
| `Oi23-4567-89am` (O→0, i→1, case, grouping) | `0123456789AM` | yes |
| `0I23456789AM`, `0L23456789AM`, `O123456789AM` (and lowercase forms) | `0123456789AM` | yes |
| `oIl3456789am` | `0113456789AM` | no — maps cleanly, then fails the check |
| `WR7X4U-9B2M3P` | — (U not in alphabet) | reject at normalization |

The `oIl3…` row is deliberate: it proves the mapping and the check are
independent stages — a well-formed mapping result is still subject to check
rejection.

### 4.4 Negative vectors (worked examples of the exhaustive classes)
| Input | Error class | Valid |
|---|---|---|
| `WR7X4K9B2M3Q` | single substitution (last position) | no |
| `WR7X4K9B2MP3` | adjacent transposition (positions 10/11) | no |

Exhaustive requirement: from each canonical vector in §4.1 and §4.2,
generate all single-symbol substitutions (len × 31) and all adjacent
transpositions of unequal neighbours; every one MUST fail validation.
Reference totals across all seven base codes: 2,697 substitutions and 59
transpositions, 0 missed in each class.

### 4.5 Length-error bounds (per §XVI.5.4) — reclassified in v1.3, rates corrected in v1.4
Omissions and insertions produce a candidate of a different length that
parses under a different structure. The three bounds are of different
kinds and MUST be asserted accordingly:

- **Insertions — exact, by construction.** The fold is linear (over GF(2))
  in each symbol, and the inserted symbol's coefficient is a power of A,
  which is a bijection; therefore every insertion position has exactly one
  surviving symbol among 32. Survivors = length + 1 out of
  32 × (length + 1) — a rate of exactly 1/32, an identity rather than a
  measurement. Reference: exactly 13 of 416 on `WR7X4K9B2M3P`. Suites
  assert this exactly, per position.
- **Deletions from a minimum-length (12-character) code — exactly 0
  survive.** The result is 11 characters and fails the §3/§5 length guard
  unconditionally. (Fold-only counting — the v1.1 error — yields nonzero
  counts; such figures MUST NOT be encoded in a conformance suite.)
- **Deletions from extended codes — expectation exactly 1/32, assessed by
  sampling.** The deleted candidate's fold is an affine function of the
  code's symbols, so over random codes it is uniform on GF(2⁵): the
  survival probability is exactly 1/32 in expectation, the same rate as
  insertions — the difference is only that deletions are sampled rather
  than exhaustive per position (reference: 121,694 of 3.9 million trials,
  0.03120 vs. the exact 0.03125; no positional structure). Per-code
  anchors are deterministic and are asserted exactly: 1 of 13 for
  `WR7X4K9B2M3ZJ` (survivor `WR7X4KB2M3ZJ`) and 1 of 14 for
  `WR7X4K9B2M3Z7F` (survivor `WR7X4KB2M3Z7F`). The sampled population
  rate is asserted scale-free: survivors within ±4σ of N/32, with
  σ = √(N · (1/32) · (31/32)), at N ≥ 200,000 trials (at that N this is
  ≈ 1/30.5 … 1/33.7; a literal band of 1/30 … 1/34.5 over ≥ 200,000
  trials is an acceptable equivalent). Point values and small-sample
  means (1/32.83, 1/33.4 from earlier revisions) MUST NOT be encoded;
  bands at trial counts below 200,000 are unreliable and MUST NOT be
  used.

In all classes, every survivor MUST parse as a structurally valid
**different** identifier, never as the original. The residual risk is
bounded architecturally by the mandatory validated presentation of layer 6
(Annex XVI §XVI.5.4).

## 5. TypeScript reference implementation (normative behaviour; logic
verified against every vector above)

```typescript
/** WR Code check profile v1.4 — Crockford Base32 + Damm over GF(2^5). */

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VAL = new Map([...ALPHABET].map((c, i) => [c, i] as const));

/** Multiply by alpha in GF(2^5), reduction polynomial x^5 + x^2 + 1. */
function mulAlpha(v: number): number {
  v <<= 1;
  if (v & 0b100000) v ^= 0b100101;
  return v & 0b11111;
}

/** Quasigroup operation: x * y = A(x) XOR y. Totally anti-symmetric. */
const star = (x: number, y: number): number => mulAlpha(x) ^ y;

/**
 * Capture-side normalization (Annex XVI §XVI.5.3/§XVI.5.5): strip
 * separators, fold case, map I/L -> 1 and O -> 0. Returns null when a
 * symbol outside the alphabet remains (e.g., U).
 */
export function normalize(raw: string): string | null {
  let out = "";
  for (const chRaw of raw) {
    if (!/[0-9A-Za-z]/.test(chRaw)) continue;
    let ch = chRaw.toUpperCase();
    if (ch === "I" || ch === "L") ch = "1";
    if (ch === "O") ch = "0";
    if (!VAL.has(ch)) return null;
    out += ch;
  }
  return out;
}

const fold = (s: string): number =>
  [...s].reduce((c, ch) => star(c, VAL.get(ch)!), 0);

/** Check character: the unique k with interim * k = 0, i.e. A(interim). */
export const computeCheck = (stem: string): string =>
  ALPHABET[mulAlpha(fold(stem))];

/**
 * Validation: fold the full canonical code (check included) to 0. The
 * minimum-length guard is part of the profile (see §3).
 */
export const verifyCheck = (canonical: string): boolean =>
  canonical.length >= 12 && fold(canonical) === 0;

/**
 * Structure from length (Annex XVI §XVI.5.1–5.2): publisher = first 6,
 * check = last 1, local = remainder. Callers verify the check first.
 */
export function parseStructure(
  canonical: string,
): { publisher: string; local: string; check: string } | null {
  if (canonical.length < 12) return null;
  return {
    publisher: canonical.slice(0, 6),
    local: canonical.slice(6, -1),
    check: canonical[canonical.length - 1],
  };
}
```

## 6. Conformance checklist for validators

1. Reproduce §2.2 exhaustively (quasigroup + both TA conditions, 32³
   triples) as a regression guard over the published table.
2. Reproduce every vector in §4.1–§4.4; run the exhaustive negative classes
   from all base codes.
3. Assert the §4.5 bounds by kind: insertions exactly one survivor per
   position (rate exactly 1/32); minimum-length deletions exactly 0;
   extended-code deletions via the two exact per-code anchors plus the
   ±4σ sampled assertion at ≥ 200,000 trials; all survivors are
   structurally valid different identifiers.
4. Verify that a failed check yields a capture error and that the resolver
   is never invoked on it (spy assertion).
5. Verify normalization equivalence: all groupings and mapped inputs of one
   canonical sequence validate identically.
