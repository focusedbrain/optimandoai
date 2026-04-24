/**
 * Single source of truth for the coordination WebSocket client instance.
 * main.ts must not keep a parallel closure variable — use getCoordinationWsClient() only.
 */

import type { createCoordinationWsClient } from './coordinationWs'
import { setP2PHealthCoordinationDisconnected } from './p2pHealth'

type CoordinationClient = ReturnType<typeof createCoordinationWsClient> | null

let _client: CoordinationClient = null
let _lastUserKey: string | null = null

export function getCoordinationWsClient(): NonNullable<CoordinationClient> | null {
  return _client
}

export function setCoordinationWsClient(
  client: NonNullable<CoordinationClient>,
  userKey: string,
): void {
  _client = client
  _lastUserKey = userKey
}

export function clearCoordinationWsClientRef(): void {
  _client = null
  _lastUserKey = null
  setP2PHealthCoordinationDisconnected()
}

/**
 * Disconnect relay WS, clear refs, and mark coordination health disconnected.
 * Safe to call multiple times.
 */
export function disconnectCoordinationWsForAccountSwitch(reason: 'logout' | 'account_switch' | 'config_disabled'): void {
  const old = _lastUserKey
  console.log('[RELAY_WS_LIFECYCLE] disconnect_begin', JSON.stringify({ reason, had_client: !!_client }))
  if (_client) {
    try {
      _client.disconnect()
    } catch {
      /* */
    }
    _client = null
  }
  _lastUserKey = null
  setP2PHealthCoordinationDisconnected()
  console.log(
    '[RELAY_WS_LIFECYCLE] disconnect_done',
    JSON.stringify({ local_ref_cleared: true, holder_ref_cleared: true, health_connected: false }),
  )
  console.log(
    '[RELAY_WS_ACCOUNT_SWITCH]',
    JSON.stringify({
      oldUserId: old,
      disconnected: true,
      reason,
    }),
  )
}

export function getCoordinationWsUserKey(): string | null {
  return _lastUserKey
}
