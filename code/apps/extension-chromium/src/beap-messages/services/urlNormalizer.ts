/**
 * URL Normalizer — A.3.054.6 (Normative)
 *
 * All URLs in BEAP message content MUST be normalized to plain text form before
 * capsule assembly, and MUST NOT be directly executable or clickable during
 * validation or depackaging. Link activation requires explicit user intent and
 * occurs exclusively outside the WRGuard™-protected validation environment.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single URL extracted from message text, with its position and metadata. */
export interface ExtractedUrl {
  /** The normalized, plain-text form of the URL. */
  normalizedUrl: string
  /** The original URL as found in the source text. */
  originalUrl: string
  /** Character offset in the *normalized* output text where the URL appears. */
  position: number
  /** Length of the normalized URL string in the output text. */
  length: number
  /** URL scheme (lowercase), e.g. "https", "mailto", "ftp". */
  scheme: string
  /** Tracking parameters that were stripped, keyed by parameter name. */
  strippedTrackingParams: Record<string, string>
}

/** Result of normalizing a text string. */
export interface UrlNormalizationResult {
  /** The text after all URL normalization has been applied. */
  normalizedText: string
  /** All URLs found in the source, in order of appearance. */
  extractedUrls: ExtractedUrl[]
  /** True if any transformation was applied to the input text. */
  wasTransformed: boolean
}

/** Verification result for receiver-side URL normalization check. */
export interface UrlNormalizationVerification {
  /** True if all URLs in the text are in normalized form. */
  compliant: boolean
  /** URLs that are NOT in normalized form (should be empty on compliant input). */
  nonCompliantUrls: string[]
  /** All normalized URL references present in the text. */
  extractedUrls: ExtractedUrl[]
}

// ---------------------------------------------------------------------------
// Constants — tracking/analytics query parameters to strip
// ---------------------------------------------------------------------------

/**
 * Known tracking and analytics query parameters.  All are matched
 * case-insensitively.  Extend this list as new vendors emerge.
 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // UTM (Google Analytics / generic)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_reader', 'utm_name', 'utm_nooverride',
  // Mailchimp
  'mc_cid', 'mc_eid',
  // HubSpot
  'hsa_acc', 'hsa_cam', 'hsa_grp', 'hsa_ad', 'hsa_src', 'hsa_tgt',
  'hsa_kw', 'hsa_mt', 'hsa_net', 'hsa_ver', 'hsa_la',
  // Facebook / Meta
  'fbclid', 'fb_source', 'fb_ref',
  // Google Ads
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  // Microsoft / Bing
  'msclkid',
  // Twitter / X
  'twclid',
  // LinkedIn
  'li_fat_id', 'trk', 'trkInfo',
  // Adobe / Omniture
  's_cid', 'icid',
  // General click/session tracking
  'ref', 'referrer', 'source', 'campaign', 'cid', 'sid', 'clickid',
  'click_id', 'tracking_id', 'track', 'tracking', 'mkwid', 'pmt', 'pcrid',
  // Salesforce Pardot
  'pi_ad_id', 'pi_campaign_id',
  // Drip
  '__s',
  // Intercom
  'intercom-campaign',
  // ActiveCampaign
  'vgo_ee',
])

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Detects raw URLs in plain text.  Captures http/https/ftp/ftps/mailto schemes
 * plus bare domain forms (www.).  We intentionally do NOT match bare hostnames
 * without a scheme or www prefix to avoid false positives.
 *
 * Groups:
 *   1 — the full URL match
 */
const URL_PATTERN = /\b((?:https?|ftp|ftps|mailto):\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+)/gi

/** Matches HTML anchor tags with href attributes (any quotes or none). */
const ANCHOR_TAG_PATTERN = /<a\s[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi

/** Matches any remaining HTML-ish tags that might contain link-like markup. */
const RESIDUAL_HTML_LINK_PATTERN = /<\/?(a|link|area)\b[^>]*>/gi

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Percent-decode a URL string conservatively: decode only %XX sequences that
 * represent printable ASCII characters (0x20–0x7E).  Leave the rest encoded
 * to preserve safety.
 */
function safeDecodeUrl(raw: string): string {
  return raw.replace(/%([0-9A-Fa-f]{2})/g, (match, hex: string) => {
    const code = parseInt(hex, 16)
    if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code)
    return match
  })
}

/**
 * Normalize a single URL string:
 *  1. Trim trailing punctuation commonly attached by prose (.,;:!?) but not
 *     meaningful in a URL.
 *  2. Safely decode percent-encoded printable ASCII.
 *  3. For http/https/ftp URLs: parse fully, strip tracking params, then
 *     reconstruct with sorted remaining params for determinism.
 *  4. Lowercase scheme and host.
 *  5. For mailto: strip query string tracking params.
 *  6. Return the scheme, normalized form, and stripped params.
 */
function normalizeSingleUrl(raw: string): {
  normalized: string
  scheme: string
  strippedTrackingParams: Record<string, string>
} {
  // Trim trailing prose punctuation
  let url = raw.replace(/[.,;:!?)]+$/, '')
  url = safeDecodeUrl(url)

  const strippedTrackingParams: Record<string, string> = {}

  // Prepend https:// for bare www. references so URL() can parse them.
  const hadNakedWww = /^www\./i.test(url)
  const urlToParse = hadNakedWww ? `https://${url}` : url

  let scheme = hadNakedWww ? 'https' : url.split(':')[0].toLowerCase()

  if (scheme === 'mailto') {
    // For mailto: strip tracking query params from the query portion
    const qIdx = url.indexOf('?')
    if (qIdx !== -1) {
      const base = url.slice(0, qIdx)
      const qs = url.slice(qIdx + 1)
      const kept: string[] = []
      for (const part of qs.split('&')) {
        const [key, ...rest] = part.split('=')
        if (TRACKING_PARAMS.has(key.toLowerCase())) {
          strippedTrackingParams[key] = rest.join('=')
        } else {
          kept.push(part)
        }
      }
      const normalized = kept.length ? `${base}?${kept.join('&')}` : base
      return { normalized, scheme, strippedTrackingParams }
    }
    return { normalized: url, scheme, strippedTrackingParams }
  }

  // http/https/ftp — use URL API for robust parsing
  try {
    const parsed = new URL(urlToParse)

    // Lowercase scheme and host (hostname already lowercase in URL API)
    parsed.protocol = parsed.protocol.toLowerCase()

    // Strip tracking params
    const toDelete: string[] = []
    for (const [key, value] of parsed.searchParams.entries()) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        strippedTrackingParams[key] = value
        toDelete.push(key)
      }
    }
    for (const key of toDelete) {
      parsed.searchParams.delete(key)
    }

    // Sort remaining params for determinism
    parsed.searchParams.sort()

    let normalized = parsed.toString()
    // Remove the https:// prefix we added for bare www. links
    if (hadNakedWww) normalized = normalized.replace(/^https:\/\//, '')

    return { normalized, scheme, strippedTrackingParams }
  } catch {
    // URL() parse failure — return the trimmed, decoded form unchanged.
    return { normalized: url, scheme, strippedTrackingParams }
  }
}

// ---------------------------------------------------------------------------
// Primary export — normalizeUrls
// ---------------------------------------------------------------------------

/**
 * Normalize all URLs in `text` per A.3.054.6.
 *
 * Steps performed:
 *  1. Strip HTML anchor tags, replacing them with the link text only
 *     (no href preserved as a clickable element).
 *  2. Detect remaining raw URL strings (http/https/ftp/mailto/www.).
 *  3. For each URL: strip tracking parameters, normalize encoding, lowercase
 *     scheme+host, sort query params.
 *  4. Replace the original URL in the text with the normalized form.
 *  5. Return the normalized text and the list of extracted URLs.
 */
export function normalizeUrls(text: string): UrlNormalizationResult {
  if (!text) {
    return { normalizedText: text, extractedUrls: [], wasTransformed: false }
  }

  const extractedUrls: ExtractedUrl[] = []
  let normalized = text
  let wasTransformed = false

  // Step 1: Strip HTML anchor tags — replace <a href="...">label</a> with just "label"
  // (The href URL is NOT preserved in the output; it is silently discarded.)
  let afterAnchorStrip = normalized.replace(ANCHOR_TAG_PATTERN, (_match, _href, label) => {
    wasTransformed = true
    return label.trim()
  })
  // Remove any residual link-type HTML tags
  afterAnchorStrip = afterAnchorStrip.replace(RESIDUAL_HTML_LINK_PATTERN, () => {
    wasTransformed = true
    return ''
  })
  normalized = afterAnchorStrip

  // Step 2–4: Detect and normalize raw URL strings.
  // We iterate through matches, build the replacement string, and track positions
  // in the *output* text (accounting for length differences as we substitute).
  let outputOffset = 0
  let result = ''
  let lastIndex = 0
  const pattern = new RegExp(URL_PATTERN.source, URL_PATTERN.flags)

  for (const match of normalized.matchAll(pattern)) {
    const raw = match[1] ?? match[0]
    const matchStart = match.index ?? 0

    const { normalized: normUrl, scheme, strippedTrackingParams } = normalizeSingleUrl(raw)

    // Append text before this URL match
    result += normalized.slice(lastIndex, matchStart)
    outputOffset += matchStart - lastIndex

    const urlPositionInOutput = outputOffset
    result += normUrl
    outputOffset += normUrl.length
    lastIndex = matchStart + raw.length

    if (normUrl !== raw) wasTransformed = true

    extractedUrls.push({
      normalizedUrl: normUrl,
      originalUrl: raw,
      position: urlPositionInOutput,
      length: normUrl.length,
      scheme,
      strippedTrackingParams,
    })
  }

  // Append remaining text
  result += normalized.slice(lastIndex)

  return {
    normalizedText: result,
    extractedUrls,
    wasTransformed,
  }
}

// ---------------------------------------------------------------------------
// Receiver-side verification — verifyUrlNormalization
// ---------------------------------------------------------------------------

/**
 * Verify that all URLs in `text` are already in normalized form per A.3.054.6.
 *
 * This is the receiver-side check: after capsule decryption, BEAP content MUST
 * have already been normalized by the sender.  Any URL not in normalized form
 * (e.g., retaining tracking params or HTML anchor markup) is flagged as
 * non-compliant.
 *
 * Non-compliance is advisory on the receiver side (the depackaging pipeline
 * does not fail-close on this, per the specification's presentation-layer
 * classification), but the result is surfaced in `DecryptedCapsulePayload` for
 * UI rendering decisions.
 */
export function verifyUrlNormalization(text: string): UrlNormalizationVerification {
  if (!text) {
    return { compliant: true, nonCompliantUrls: [], extractedUrls: [] }
  }

  const { normalizedText, extractedUrls, wasTransformed } = normalizeUrls(text)
  void normalizedText // used only for the transform check

  const nonCompliantUrls: string[] = []

  for (const entry of extractedUrls) {
    if (entry.originalUrl !== entry.normalizedUrl) {
      nonCompliantUrls.push(entry.originalUrl)
    }
    // Flag any URL that still has tracking params (shouldn't be present if sender normalized)
    if (Object.keys(entry.strippedTrackingParams).length > 0) {
      if (!nonCompliantUrls.includes(entry.originalUrl)) {
        nonCompliantUrls.push(entry.originalUrl)
      }
    }
  }

  // HTML anchor tags in the text are also non-compliant
  if (ANCHOR_TAG_PATTERN.test(text) || RESIDUAL_HTML_LINK_PATTERN.test(text)) {
    // Reset regex lastIndex (stateful with `g` flag)
    ANCHOR_TAG_PATTERN.lastIndex = 0
    RESIDUAL_HTML_LINK_PATTERN.lastIndex = 0
    nonCompliantUrls.push('[html-anchor-tags-present]')
  }

  return {
    compliant: nonCompliantUrls.length === 0 && !wasTransformed,
    nonCompliantUrls,
    extractedUrls,
  }
}
