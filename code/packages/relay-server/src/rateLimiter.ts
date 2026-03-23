/**
 * In-memory rate limiter for relay server.
 * Per-IP, per-handshake, and auth-failure limits.
 */

const WINDOW_MS = 60 * 1000
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000
const AUTH_FAIL_LIMIT = 5

interface Entry {
  count: number
  windowStart: number
}

const ipCounts = new Map<string, Entry>()
const handshakeCounts = new Map<string, Entry>()
const authFailCounts = new Map<string, Entry>()

function pruneIpHandshake(now: number): void {
  for (const [key, entry] of ipCounts.entries()) {
    if (now - entry.windowStart > WINDOW_MS) ipCounts.delete(key)
  }
  for (const [key, entry] of handshakeCounts.entries()) {
    if (now - entry.windowStart > WINDOW_MS) handshakeCounts.delete(key)
  }
}

function pruneAuthFail(now: number): void {
  for (const [key, entry] of authFailCounts.entries()) {
    if (now - entry.windowStart > AUTH_FAIL_WINDOW_MS) authFailCounts.delete(key)
  }
}

export function checkIpLimit(ip: string, limit: number): boolean {
  const now = Date.now()
  pruneIpHandshake(now)
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
  pruneIpHandshake(now)
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

export function checkAuthFailLimit(ip: string): boolean {
  const now = Date.now()
  pruneAuthFail(now)
  const entry = authFailCounts.get(ip)
  if (!entry) {
    authFailCounts.set(ip, { count: 1, windowStart: now })
    return true
  }
  if (now - entry.windowStart > AUTH_FAIL_WINDOW_MS) {
    entry.count = 1
    entry.windowStart = now
    return true
  }
  if (entry.count >= AUTH_FAIL_LIMIT) return false
  entry.count++
  return true
}

export function recordAuthFailure(ip: string): void {
  const now = Date.now()
  const entry = authFailCounts.get(ip)
  if (!entry) {
    authFailCounts.set(ip, { count: 1, windowStart: now })
  } else {
    entry.count++
  }
}

export function resetRateLimitsForTests(): void {
  ipCounts.clear()
  handshakeCounts.clear()
  authFailCounts.clear()
}
