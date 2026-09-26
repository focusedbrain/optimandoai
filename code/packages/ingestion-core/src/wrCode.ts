/**
 * WR Code® Baseline Code — check profile v1.4 [XVI.5.1–5.5]
 *
 * The Baseline Code is a self-delimiting, case-insensitive identifier over
 * Crockford Base32 with a Damm check character computed over a totally
 * anti-symmetric quasigroup of order 32. Capture-side validation is purely
 * local: normalize, verify the check, only then resolve. A failed check is a
 * CAPTURE ERROR and MUST NOT trigger resolution [XVI.5.4].
 *
 * Everything below is pure and offline-capable [XVI.15.1] — no I/O, no clock,
 * no network, no DB. Resolution, registry lookup, and publisher validation
 * live elsewhere; this module never learns whether a code refers to anything.
 *
 * IDENTIFIER-CLASS BOUNDARY: the 6-digit device-pairing code is a DIFFERENT
 * identifier class with its own normalizer, lifetime, and reassignment rules.
 * Do not consolidate `pairingCodeRegistry` normalization into this module and
 * do not use this module's helpers for pairing codes.
 *
 * The region between the BEGIN/END markers is transcribed VERBATIM from
 * `docs/spec/WR-Code_Check-Profile_Registry-Material_v1.4.md` §5, which is the
 * authoritative check profile: an identifier generated or validated with a
 * different table, mapping, or algorithm is non-conformant [XVI.5.4].
 * `wrCode.profileTranscription.guard.test.ts` fails if the two ever diverge,
 * so edit the registry material first and re-transcribe — never patch here.
 *
 * SUPERSESSION (Annex XVI v1.95, `docs/spec/Annex_XVI_WR_Code_v1.95.pdf`).
 * The ratified upstream is now Annex XVI Appendix A, and v1.4 above is
 * superseded IN PART.
 *
 * The check survives untouched, and A.1 now agrees with this module exactly:
 * the published operation is `(α · x) ⊕ y`, the diagonal is `(α ⊕ 1) · x`
 * rather than zero, the check is `α · interim`, and all 1024 published table
 * cells match. `wrCode.annexXVI.appendixA.conformance.test.ts` asserts that
 * cell for cell, along with every A.2 vector.
 *
 * (v1.93 briefly printed A.1 as `α · (x ⊕ y)` with a zero diagonal, which is
 * commutative and therefore not totally anti-symmetric. v1.95 withdrew it. The
 * two forms yield identical checks, so nothing deployed was ever affected, and
 * the suite keeps a regression guard so the withdrawn form cannot return.)
 *
 * What does NOT survive is the framing. The v1.95 reference grammar (class
 * prefixes P/I/C/SP/SI/SC/SE, per-class block structure, prefix-before-alias
 * normalization) lives in `wrCodeGrammar.ts`, which builds on the arithmetic
 * exports below. `parseStructure` remains in this file ONLY because it is part
 * of the verbatim v1.4 transcription — it mis-slices every v1.95 reference,
 * is not exported from the package, and MUST NOT gain callers. The old
 * prefix-less capture wrapper (`captureBaselineCode` and friends) is deleted:
 * old-format codes are invalid under grammar version 2, with no dual
 * acceptance.
 */

/* eslint-disable */
// ─── BEGIN check profile v1.4 §5 — transcribed verbatim, do not edit ─────────
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
// ─── END check profile v1.4 §5 ───────────────────────────────────────────────
/* eslint-enable */
