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

// ── Fail-closed capture gate (repo wrapper over the profile above) ────────────

/** Minimum conformant canonical length [XVI.5.1]; extended forms are longer. */
export const BASELINE_CODE_MIN_LENGTH = 12

/** Publisher part is a fixed-width prefix; the local part absorbs extension. */
export const BASELINE_CODE_PUBLISHER_LENGTH = 6

export type BaselineCodeCaptureFailure =
  /** A symbol outside Crockford Base32 survived normalization (U in particular). */
  | 'out_of_alphabet'
  /** Fewer than 12 canonical symbols — cannot carry publisher + local + check. */
  | 'too_short'
  /** Well-formed symbols, wrong check character. */
  | 'check_failed'

export type BaselineCodeCapture =
  | {
      ok: true
      /** Ungrouped, upper-cased, mapped form the check was verified over. */
      canonical: string
      publisher: string
      local: string
      check: string
    }
  | { ok: false; reason: BaselineCodeCaptureFailure }

/**
 * The ONE entry point a capture surface may call [XVI.5.4]. Normalization,
 * length guard, and check verification all run before anything is returned,
 * so a caller holding an `ok: true` result can resolve and a caller holding
 * `ok: false` has nothing to resolve WITH — rejection-before-resolution is
 * structural here, not a convention the caller has to remember.
 *
 * Callers MUST NOT reconstruct this sequence themselves, and MUST NOT treat a
 * check-passed capture as validated: a locally valid code is still unresolved
 * and unverified until the registry + dual-channel chain completes [XVI.15.1].
 */
export function captureBaselineCode(raw: string): BaselineCodeCapture {
  const canonical = normalize(raw)
  if (canonical === null) return { ok: false, reason: 'out_of_alphabet' }
  if (canonical.length < BASELINE_CODE_MIN_LENGTH) return { ok: false, reason: 'too_short' }
  if (!verifyCheck(canonical)) return { ok: false, reason: 'check_failed' }
  const structure = parseStructure(canonical)
  if (structure === null) return { ok: false, reason: 'too_short' }
  return { ok: true, canonical, ...structure }
}

/**
 * Reference grouping for LOCAL rendering only [XVI.5.5]: `PPPPPP-LLLLL-C`,
 * the local part growing with extended forms. Grouping is presentational —
 * the check is computed over the ungrouped canonical form, and a received
 * rendering is never displayed (P12), only a locally generated one.
 */
export function formatBaselineCodeForDisplay(canonical: string): string | null {
  const structure = parseStructure(canonical)
  if (structure === null) return null
  return `${structure.publisher}-${structure.local}-${structure.check}`
}
