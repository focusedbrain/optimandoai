/**
 * In-memory per-handshake rate limit for internal Host inference (sliding 60s window).
 * Not shared across processes; security boundary is still ledger + P2P policy.
 */

const WINDOW_MS = 60_000
const buckets = new Map<string, number[]>()

/**
 * @returns true if the request is allowed, false if over limit for this 60s window.
 */
export function tryConsumePerHandshakeInferenceSlot(handshakeId: string, maxPerWindow: number): boolean {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return false
  const cap = Math.max(1, Math.min(200, Math.floor(maxPerWindow)))
  const t = Date.now()
  const cutoff = t - WINDOW_MS
  let times = buckets.get(hid) ?? []
  times = times.filter((x) => x > cutoff)
  if (times.length >= cap) {
    return false
  }
  times.push(t)
  buckets.set(hid, times)
  return true
}

/** @internal */
export function _resetHandshakeRateLimitForTests(): void {
  buckets.clear()
}
