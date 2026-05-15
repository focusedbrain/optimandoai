/**
 * Global Vitest setup — runs before every test file in the workspace root run.
 *
 * B-8.4d-iii-5b changes:
 *   - CSS.escape polyfill: JSDOM does not implement CSS.escape; multiple
 *     autofill modules (fieldScanner, dvNlpBooster, dvSiteLearning) call
 *     CSS.escape(element.id) which crashes in the JSDOM environment.
 *   - window.innerHeight / innerWidth defaults: ensures the viewport
 *     dimensions are non-zero so guardElement's ELEMENT_OFFSCREEN check
 *     functions correctly in JSDOM.
 */

// ---------------------------------------------------------------------------
// CSS.escape polyfill
// See: https://drafts.csswg.org/cssom/#serialize-an-identifier
// ---------------------------------------------------------------------------
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  // @ts-ignore – CSS is not defined in the Node/JSDOM environment
  globalThis.CSS = {
    ...(typeof CSS !== 'undefined' ? CSS : {}),
    escape(value: string): string {
      const str = String(value)
      if (str.length === 0) return ''
      let result = ''
      const firstCodeUnit = str.charCodeAt(0)

      for (let i = 0; i < str.length; i++) {
        const codeUnit = str.charCodeAt(i)
        // Control chars (0x0000–0x001F and DEL 0x007F) → escape as \HHHHHH
        if (codeUnit === 0x0000) {
          result += '\uFFFD'
          continue
        }
        if ((codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F) {
          result += '\\' + codeUnit.toString(16) + ' '
          continue
        }
        // ASCII digits at start of string → escape numerically
        if (i === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) {
          result += '\\' + codeUnit.toString(16) + ' '
          continue
        }
        // Hyphen-minus at start if only char, OR followed by digit at pos 1
        if (i === 1 && firstCodeUnit === 0x002D &&
            (codeUnit >= 0x0030 && codeUnit <= 0x0039)) {
          result += '\\' + codeUnit.toString(16) + ' '
          continue
        }
        // Non-ASCII, alphanumeric, hyphen-minus, low-line → output as-is
        if (codeUnit >= 0x0080 ||
            codeUnit === 0x002D ||
            codeUnit === 0x005F ||
            (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
            (codeUnit >= 0x0041 && codeUnit <= 0x005A) ||
            (codeUnit >= 0x0061 && codeUnit <= 0x007A)) {
          result += str[i]
          continue
        }
        // Everything else → backslash-escape the character itself
        result += '\\' + str[i]
      }
      return result
    },
  }
}

// ---------------------------------------------------------------------------
// window.innerHeight / innerWidth defaults
// JSDOM defaults these to 0, which breaks guardElement's ELEMENT_OFFSCREEN
// check (any element with rect.bottom < 0 would still be "inside" a 0-height
// viewport). Set sensible defaults here; tests that need specific values can
// override locally.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  if (window.innerHeight === 0) {
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true })
  }
  if (window.innerWidth === 0) {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true })
  }
}
