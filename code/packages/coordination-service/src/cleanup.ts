/**
 * Coordination Service — Expired and acknowledged capsule cleanup
 */

import { cleanupExpired, cleanupAcknowledged } from './store.js'

export function runCleanup(): { expired: number; acknowledged: number } {
  const expired = cleanupExpired()
  const acknowledged = cleanupAcknowledged()
  return { expired, acknowledged }
}

export function startCleanupInterval(intervalMs: number = 60 * 60 * 1000): ReturnType<typeof setInterval> {
  runCleanup()
  return setInterval(runCleanup, intervalMs)
}
