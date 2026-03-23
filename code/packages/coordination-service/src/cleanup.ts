/**
 * Coordination Service — Self-healing session cleanup
 * Purges: expired capsules, acknowledged capsules, stale handshake state.
 */

import type { StoreAdapter } from './store.js'
import type { CoordinationConfig } from './config.js'

export interface CleanupAdapter {
  run(): { expired: number; acknowledged: number; staleHandshakes: number }
  startInterval(): ReturnType<typeof setInterval>
}

export function createCleanup(store: StoreAdapter, config: CoordinationConfig): CleanupAdapter {
  const intervalMs = 60 * 60 * 1000 // 1 hour

  return {
    run(): { expired: number; acknowledged: number; staleHandshakes: number } {
      const expired = store.cleanupExpired()
      const acknowledged = store.cleanupAcknowledged()
      const staleHandshakes = store.cleanupStaleHandshakes(config.handshake_ttl_seconds)
      return { expired, acknowledged, staleHandshakes }
    },

    startInterval(): ReturnType<typeof setInterval> {
      this.run()
      return setInterval(() => this.run(), intervalMs)
    },
  }
}
