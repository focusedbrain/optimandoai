/**
 * Coordination Service — Health endpoint
 */

import { countPending } from './store.js'

const startTime = Date.now()

export function getHealthPayload(connectedClients: number): { status: string; connected_clients: number; pending_capsules: number; uptime: number } {
  return {
    status: 'ok',
    connected_clients: connectedClients,
    pending_capsules: countPending(),
    uptime: Math.round((Date.now() - startTime) / 1000),
  }
}
