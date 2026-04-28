/**
 * Classify sandbox → host Ollama `fetch` failures that indicate transport/network (not HTTP semantics).
 */

export function classifyOllamaDirectFetchTransportFailure(err: unknown): string | null {
  if (err == null) return null
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const n = String((err as Error).name)
    if (n === 'AbortError') return 'timeout_abort'
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  const needles = [
    'econnrefused',
    'etimedout',
    'enotfound',
    'enetunreach',
    'ehostunreach',
    'eai_again',
    'getaddrinfo',
    'network request failed',
    'failed to fetch',
    'networkerror',
    'socket hang up',
    'econnreset',
  ] as const
  for (const s of needles) {
    if (msg.includes(s)) return `net_msg_${s.replace(/\s+/g, '_')}`
  }
  const cause =
    err instanceof Error && 'cause' in err ? (err as Error & { cause?: unknown }).cause : null
  if (cause && typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = String((cause as { code?: string }).code ?? '').toUpperCase()
    if (
      ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(
        code,
      )
    ) {
      return `net_${code.toLowerCase()}`
    }
  }
  return null
}
