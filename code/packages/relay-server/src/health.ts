/**
 * Health check for relay server.
 */

import { countUnacknowledged } from './store.js'

const startTime = Date.now()

export function getHealthPayload(): { status: string; uptime: number; capsules_pending: number } {
  return {
    status: 'ok',
    uptime: Math.round((Date.now() - startTime) / 1000),
    capsules_pending: countUnacknowledged(),
  }
}
