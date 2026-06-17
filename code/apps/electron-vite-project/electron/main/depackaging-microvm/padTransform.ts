/**
 * Canonical invertible padding transform (Phase 1.1).
 *
 * Inserts a fixed PAD character at a known stride so untrusted text is
 * non-executable during multi-stage inspection, then is provably restored
 * exactly. Pure functions, no dependencies.
 *
 * SPEC (from the ephemeral-ingestion architecture analysis):
 *   - Insertion unit: Unicode CODE POINTS via [...str] (full code points incl.
 *     surrogate pairs). NOT bytes — byte insertion corrupts multibyte UTF-8.
 *   - PAD character: U+FFFC (OBJECT REPLACEMENT CHARACTER).
 *   - STRIDE: 10 code points → one PAD inserted after every 10 original code points.
 *   - Collision handling: positional removal by stride arithmetic, NOT search-and-
 *     delete. If the original text contained U+FFFC, it occupies a shifted non-PAD
 *     position and is preserved.
 *   - Invertibility: unpad(pad(S)) === S for ALL S.
 *   - Cross-stage: each stage pads the already-padded string. De-padding N layers
 *     = unpad applied N times, each stripping the outermost layer.
 */

/** The padding character. Never appears in legitimate email/PDF/BEAP text. */
export const PAD_CHAR = '\uFFFC'

/** Code points between consecutive PAD insertions. */
export const STRIDE = 10

/**
 * Thrown when `unpad` encounters a position that should hold PAD but does not.
 * This is a tamper/corruption signal — the padded form was modified between stages.
 */
export class PadIntegrityError extends Error {
  readonly code = 'E_PAD_INTEGRITY' as const
  constructor(
    readonly position: number,
    readonly found: string,
  ) {
    super(
      `pad integrity violation at output position ${position}: ` +
        `expected U+FFFC, found U+${found.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
    )
    this.name = 'PadIntegrityError'
  }
}

/**
 * Insert PAD after every STRIDE original code points.
 *
 * Given input code points [c₀, c₁, ..., cₙ₋₁]:
 *   - Output[0..9]  = S[0..9]
 *   - Output[10]    = PAD
 *   - Output[11..20]= S[10..19]
 *   - Output[21]    = PAD
 *   - etc.
 *
 * PAD positions in output: 10, 21, 32, ... i.e. 10 + 11*k for k = 0, 1, 2, ...
 */
export function pad(text: string): string {
  const codePoints = [...text]
  const len = codePoints.length
  if (len === 0) return ''

  const padCount = Math.floor(len / STRIDE)
  const result = new Array<string>(len + padCount)

  let ri = 0
  for (let i = 0; i < len; i++) {
    result[ri++] = codePoints[i]
    if ((i + 1) % STRIDE === 0) {
      result[ri++] = PAD_CHAR
    }
  }
  return result.join('')
}

/**
 * Remove the outermost padding layer by positional stride arithmetic.
 *
 * PAD positions in the padded string are at indices 10 + 11*k (0-indexed in
 * code points). Each such position MUST hold PAD_CHAR; if not, a
 * `PadIntegrityError` is thrown (tamper/corruption signal).
 *
 * Characters at all other positions are original content — including any U+FFFC
 * that was in the original text (it occupies a shifted, non-PAD position).
 */
export function unpad(padded: string): string {
  const codePoints = [...padded]
  const len = codePoints.length
  if (len === 0) return ''

  const result: string[] = []

  for (let i = 0; i < len; i++) {
    if (isPadPosition(i)) {
      if (codePoints[i] !== PAD_CHAR) {
        throw new PadIntegrityError(i, codePoints[i])
      }
      // skip — this is an inserted PAD
    } else {
      result.push(codePoints[i])
    }
  }
  return result.join('')
}

/**
 * True if code-point index `i` in a padded string is a PAD-insertion position.
 *
 * The first PAD is at index 10 (after 10 original code points). Subsequent PADs
 * are spaced by (STRIDE + 1) = 11 code points (10 original + 1 PAD).
 * Positions: 10, 21, 32, 43, ... i.e. i >= STRIDE && (i - STRIDE) % (STRIDE + 1) === 0.
 */
function isPadPosition(i: number): boolean {
  if (i < STRIDE) return false
  return (i - STRIDE) % (STRIDE + 1) === 0
}

/**
 * Apply `n` padding layers (each pads the already-padded output of the prior).
 * `padLayers(text, 0)` returns the original text.
 */
export function padLayers(text: string, n: number): string {
  let result = text
  for (let i = 0; i < n; i++) {
    result = pad(result)
  }
  return result
}

/**
 * Remove `n` padding layers (each strips the outermost layer).
 * `unpadLayers(text, 0)` returns the input unchanged.
 * Throws `PadIntegrityError` if any layer's PAD positions are corrupted.
 */
export function unpadLayers(text: string, n: number): string {
  let result = text
  for (let i = 0; i < n; i++) {
    result = unpad(result)
  }
  return result
}
