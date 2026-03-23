/**
 * HS Context Link Validation
 *
 * Strict validation and normalization for links in profile fields and block payloads.
 * Only http: and https: are allowed. Rejects dangerous protocols.
 */

const UNSAFE_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'file:',
  'blob:',
  'vbscript:',
  'jar:',
  'wyciwyg:',
  'ms-its:',
  'mhtml:',
  'x-javascript:',
])

const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Validate and optionally normalize a URL for HS Context display/open.
 * Returns null if invalid or unsafe.
 */
export function validateHsContextLink(input: string | null | undefined): { ok: true; url: string } | { ok: false; reason: string } {
  if (input == null || typeof input !== 'string') {
    return { ok: false, reason: 'Link is missing or not a string' }
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, reason: 'Link is empty' }
  }
  if (trimmed.length > 2048) {
    return { ok: false, reason: 'Link exceeds maximum length' }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'Invalid URL format' }
  }

  const protocol = url.protocol.toLowerCase()
  if (UNSAFE_PROTOCOLS.has(protocol)) {
    return { ok: false, reason: `Unsafe protocol: ${protocol}` }
  }
  if (!SAFE_PROTOCOLS.has(protocol)) {
    return { ok: false, reason: `Unsupported protocol: ${protocol}. Only http and https are allowed.` }
  }

  return { ok: true, url: url.href }
}

/**
 * Create a stable entity ID for link approval/audit.
 * Uses normalized URL truncated for DB storage (max 500 chars).
 */
export function linkEntityId(url: string): string {
  return url.slice(0, 500)
}
