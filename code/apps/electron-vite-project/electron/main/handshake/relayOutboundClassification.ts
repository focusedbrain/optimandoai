/**
 * Coordination relay HTTP error classification for outbound queue retry policy.
 * Parses JSON error bodies from `/beap/capsule` and related endpoints.
 */

export type ParsedCoordinationRelayError = {
  code: string | null
  error: string | null
  detail: string | null
}

export function parseCoordinationRelayErrorSnippet(snippet: string): ParsedCoordinationRelayError {
  const t = snippet.trim()
  if (!t.startsWith('{')) {
    return { code: null, error: null, detail: null }
  }
  try {
    const raw = JSON.parse(t) as Record<string, unknown>
    const code = typeof raw.code === 'string' ? raw.code.trim() : null
    const error = typeof raw.error === 'string' ? raw.error.trim() : null
    const detail = typeof raw.detail === 'string' ? raw.detail.trim() : null
    return { code, error, detail }
  } catch {
    return { code: null, error: null, detail: null }
  }
}

/** Relay codes that indicate missing/mismatched device identity or non-recoverable internal routing — never backoff/re-register. */
export const TERMINAL_RELAY_IDENTITY_CODES: ReadonlySet<string> = new Set([
  'RELAY_RECIPIENT_RESOLUTION_FAILED',
  'RELAY_RECEIVER_DEVICE_MISMATCH',
  'INTERNAL_CAPSULE_MISSING_DEVICE_ID',
  'INTERNAL_ENDPOINT_INCOMPLETE',
  'INTERNAL_RELAY_ROUTING_AMBIGUOUS',
])

/**
 * Returns the canonical invariant code if this response must not be retried automatically.
 */
export function terminalRelayIdentityInvariant(
  snippet: string,
  parsed?: ParsedCoordinationRelayError,
): string | null {
  const p = parsed ?? parseCoordinationRelayErrorSnippet(snippet)
  for (const cand of [p.code, p.error]) {
    if (cand && TERMINAL_RELAY_IDENTITY_CODES.has(cand)) return cand
  }
  const upper = snippet.toUpperCase()
  for (const code of TERMINAL_RELAY_IDENTITY_CODES) {
    if (upper.includes(code)) return code
  }
  if (/internal_routing/i.test(snippet)) {
    return 'INTERNAL_RELAY_ROUTING_AMBIGUOUS'
  }
  return null
}

const STALE_REGISTRY_CODE = 'RELAY_SENDER_UNAUTHORIZED'

/**
 * True when the relay indicates the handshake is missing from registry / sender not mapped — one-shot re-register may help.
 */
export function isCoordinationStaleRegistry403(
  snippet: string,
  parsed?: ParsedCoordinationRelayError,
): boolean {
  const p = parsed ?? parseCoordinationRelayErrorSnippet(snippet)
  if (p.code === STALE_REGISTRY_CODE || p.error === STALE_REGISTRY_CODE) return true
  return snippet.includes(STALE_REGISTRY_CODE)
}
