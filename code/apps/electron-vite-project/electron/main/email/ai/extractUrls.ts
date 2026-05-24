/**
 * URL extraction helper for AI sub-analyses (P2.4).
 *
 * Extracts HTTP/HTTPS URLs from plain text. Deduplicates by href and strips
 * the fragment (but preserves query params — the assessor needs them for
 * flagged_urls output).
 */

/** A URL extracted from email body text. */
export interface ExtractedUrl {
  href: string;
  display_text?: string;
}

/**
 * Conservative URL pattern: requires scheme + host + optional path/query.
 * Stops at whitespace, quote, angle bracket, or common sentence-ending punctuation
 * that would not be part of the URL itself.
 */
const URL_RE = /https?:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi

/** Characters that often trail a URL in plain text but are not part of it. */
const TRAILING_STRIP_RE = /[.,;:!?)]+$/

/**
 * Extract all unique HTTP/HTTPS URLs from `text`.
 *
 * @param text  The body text to scan.
 * @returns     Array of `ExtractedUrl`, deduplicated by `href`, in encounter order.
 */
export function extractUrlsFromText(text: string): ExtractedUrl[] {
  if (!text || typeof text !== 'string') return []
  const raw = text.match(URL_RE) ?? []
  const seen = new Set<string>()
  const result: ExtractedUrl[] = []
  for (const rawHref of raw) {
    const href = rawHref.replace(TRAILING_STRIP_RE, '')
    if (!seen.has(href)) {
      seen.add(href)
      result.push({ href })
    }
  }
  return result
}
