/**
 * Coordination Service — Health endpoint
 * Returns 200 only when: storage reachable, JWKS cache valid, event loop responsive.
 * Otherwise returns 503. Does not depend on client traffic.
 */

import type { StoreAdapter } from './store.js'
import type { AuthAdapter } from './auth.js'
import type { WsManagerAdapter } from './wsManager.js'
import { P2P_SIGNAL_SCHEMA_VERSION } from './p2pSignal.js'

const startTime = Date.now()

/** Additive capability advertisement for Host AI WebRTC signaling (POST /beap/p2p-signal + WS). */
export type HostAiP2pSignalingCapability = {
  supported: true
  schema_version: number
  ws_path: string
  signal_path: string
}

export interface HealthResult {
  status: 'ok' | 'degraded'
  statusCode: number
  payload: {
    status: string
    connected_clients: number
    pending_capsules: number
    uptime: number
    storage_ok?: boolean
    jwks_ok?: boolean
    event_loop_ok?: boolean
    host_ai_p2p_signaling?: HostAiP2pSignalingCapability
  }
}

export interface HealthAdapter {
  check(): Promise<HealthResult>
}

export function createHealth(
  store: StoreAdapter,
  auth: AuthAdapter,
  wsManager: WsManagerAdapter,
): HealthAdapter {
  return {
    async check(): Promise<HealthResult> {
      const [storageOk, jwksOk] = await Promise.all([
        store.checkHealth(),
        auth.checkJwksHealth(),
      ])

      const eventLoopOk = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 2000)
        setImmediate(() => {
          clearTimeout(t)
          resolve(true)
        })
      })

      const healthy = storageOk && jwksOk && eventLoopOk
      const statusCode = healthy ? 200 : 503
      const status = healthy ? 'ok' : 'degraded'

      let pendingCapsules = 0
      try {
        pendingCapsules = store.countPending()
      } catch {
        // storage failed
      }

      return {
        status,
        statusCode,
        payload: {
          status,
          connected_clients: wsManager.getConnectedCount(),
          pending_capsules: pendingCapsules,
          uptime: Math.round((Date.now() - startTime) / 1000),
          storage_ok: storageOk,
          jwks_ok: jwksOk,
          event_loop_ok: eventLoopOk,
          host_ai_p2p_signaling: {
            supported: true,
            schema_version: P2P_SIGNAL_SCHEMA_VERSION,
            ws_path: '/beap/ws',
            signal_path: '/beap/p2p-signal',
          },
        },
      }
    },
  }
}
