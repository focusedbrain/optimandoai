/**
 * In-memory rate limiter for P2P server.
 * Per-key counters with TTL. No Redis — desktop app.
 */

const WINDOW_MS = 60 * 1000 // 1 minute

/** Default caps (per rolling minute) for untrusted / unknown client IPs. */
export const IP_LIMIT_PUBLIC = 30
/** Elevated caps for RFC1918 / loopback — same-machine or LAN Sandbox→Host BEAP (legitimate bursts). */
export const IP_LIMIT_PRIVATE_LAN = 600

export const HANDSHAKE_LIMIT_PUBLIC = 5
export const HANDSHAKE_LIMIT_PRIVATE_LAN = 300

/** When true (tests only), LAN boost is off so 127.0.0.1 exercises public-tier limits. */
let forcePublicP2pRateLimitsForTests = false

/** @internal Vitest / integration tests for rate limits */
export function setForcePublicP2pRateLimitsForTests(value: boolean): void {
  forcePublicP2pRateLimitsForTests = value
}

/**
 * True when the HTTP client address is loopback, RFC1918, or IPv4 link-local (typical direct LAN P2P).
 * Used only for limiter tiering — not a security boundary (Bearer + handshake still required).
 */
export function isClientIpPrivateLan(ip: string): boolean {
  if (forcePublicP2pRateLimitsForTests) return false
  let s = (ip ?? '').trim()
  if (!s) return false
  if (s === 'localhost') return true
  if (s.startsWith('::ffff:')) {
    s = s.slice('::ffff:'.length)
  }
  if (s === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  const c = Number(m[3])
  const d = Number(m[4])
  if ([a, b, c, d].some((x) => !Number.isFinite(x) || x > 255)) return false
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  return false
}

interface Entry {
  count: number
  windowStart: number
}

const ipCounts = new Map<string, Entry>()
const handshakeCounts = new Map<string, Entry>()

function prune(now: number): void {
  for (const [key, entry] of ipCounts.entries()) {
    if (now - entry.windowStart > WINDOW_MS) ipCounts.delete(key)
  }
  for (const [key, entry] of handshakeCounts.entries()) {
    if (now - entry.windowStart > WINDOW_MS) handshakeCounts.delete(key)
  }
}

export function checkIpLimit(ip: string, limit: number): boolean {
  const now = Date.now()
  prune(now)
  const entry = ipCounts.get(ip)
  if (!entry) {
    ipCounts.set(ip, { count: 1, windowStart: now })
    return true
  }
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 1
    entry.windowStart = now
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

export function checkHandshakeLimit(handshakeId: string, limit: number): boolean {
  const now = Date.now()
  prune(now)
  const entry = handshakeCounts.get(handshakeId)
  if (!entry) {
    handshakeCounts.set(handshakeId, { count: 1, windowStart: now })
    return true
  }
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 1
    entry.windowStart = now
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

/**
 * Auth-failure rate limit — per IP, counts **only** `recordAuthFailure` (bad Bearer / wrong token).
 * Previously `checkAuthFailLimit` incremented on every request, which 429'd legitimate LAN traffic after a handful of probes.
 */
const authFailCounts = new Map<string, Entry>()
const AUTH_FAIL_LIMIT = 5
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000

export function checkAuthFailLimit(ip: string): boolean {
  const now = Date.now()
  for (const [key, entry] of authFailCounts.entries()) {
    if (now - entry.windowStart > AUTH_FAIL_WINDOW_MS) authFailCounts.delete(key)
  }
  const entry = authFailCounts.get(ip)
  if (!entry) return true
  if (now - entry.windowStart > AUTH_FAIL_WINDOW_MS) {
    authFailCounts.delete(ip)
    return true
  }
  return entry.count < AUTH_FAIL_LIMIT
}

export function recordAuthFailure(ip: string): void {
  const now = Date.now()
  const prev = authFailCounts.get(ip)
  if (!prev || now - prev.windowStart > AUTH_FAIL_WINDOW_MS) {
    authFailCounts.set(ip, { count: 1, windowStart: now })
    return
  }
  prev.count++
}

/** Reset all rate limit state. For testing only. */
export function resetRateLimitsForTests(): void {
  ipCounts.clear()
  handshakeCounts.clear()
  authFailCounts.clear()
}
