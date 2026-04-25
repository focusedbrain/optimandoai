/**
 * Coordination Service — WebSocket connection manager
 * Ephemeral connection state only. No authoritative session state in memory.
 */

import type { WebSocket } from 'ws'
import type { ValidatedIdentity } from './auth.js'
import type { StoreAdapter } from './store.js'

export interface ConnectedClient {
  userId: string
  email: string
  deviceId: string
  ws: WebSocket
  connectedAt: Date
  lastPing: Date
}

const PONG_TIMEOUT_MS = 10_000

/** Default device id when the client does not send one (single connection per user, legacy behavior). */
const DEFAULT_DEVICE_ID = '_default'

function compositeKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`
}

function parseCompositeKey(key: string): { userId: string; deviceId: string } {
  const i = key.indexOf(':')
  if (i === -1) return { userId: key, deviceId: DEFAULT_DEVICE_ID }
  return { userId: key.slice(0, i), deviceId: key.slice(i + 1) }
}

function logOrphanedPendingForUser(
  store: StoreAdapter,
  getClientsByUser: (userId: string) => ConnectedClient[],
  userId: string,
  context: { reason: string; client_device_id?: string },
): void {
  let summary: Array<{ recipient_device_id: string | null; count: number }> = []
  try {
    summary = store.getPendingDeviceAggregateForUser(userId)
  } catch {
    return
  }
  if (summary.length === 0) return
  const connectedDeviceIds = new Set(getClientsByUser(userId).map((c) => c.deviceId))
  const hasLegacyDefaultClient = [...connectedDeviceIds].some(
    (id) => id === DEFAULT_DEVICE_ID || id === 'default',
  )
  for (const row of summary) {
    if (row.count <= 0) continue
    const d = row.recipient_device_id
    if (d == null || d === '') continue
    if (connectedDeviceIds.has(d)) continue
    console.log(
      '[RELAY-QUEUE] pending_cannot_drain_device_mismatch',
      JSON.stringify({
        reason: context.reason,
        client_device_id: context.client_device_id ?? null,
        recipient_user_id: userId,
        pending_count: row.count,
        pending_recipient_device_id: d,
        connected_device_ids: [...connectedDeviceIds],
        no_matching_live_client_for_pending_device: true,
        likely_legacy_default_ws: hasLegacyDefaultClient,
      }),
    )
  }
}

/** One WebSocket: send all pending rows matching this (user, email, device) per store.getPendingCapsules. */
function deliverPendingToWs(
  store: StoreAdapter,
  userId: string,
  email: string | null | undefined,
  deviceId: string,
  send: (jsonUtf8: string) => void,
): number {
  const pending = store.getPendingCapsules(userId, email, deviceId)
  let n = 0
  for (const { id, capsule_json } of pending) {
    try {
      const capObj = JSON.parse(capsule_json) as Record<string, unknown>
      const payload = JSON.stringify({ type: 'capsule', id, capsule: capObj })
      send(payload)
      store.markPushed(id)
      n++
      const hid = typeof capObj.handshake_id === 'string' ? capObj.handshake_id : null
      const ct = typeof capObj.capsule_type === 'string' ? capObj.capsule_type : null
      console.log(
        '[RELAY-QUEUE] delivered_queued',
        JSON.stringify({
          capsule_row_id: id,
          handshake_id: hid,
          capsule_type: ct,
          client_user_id: userId,
          client_device_id: deviceId,
        }),
      )
    } catch {
      // malformed or send failed
    }
  }
  return n
}

export interface WsManagerAdapter {
  handleConnection(ws: WebSocket, identity: ValidatedIdentity, deviceId?: string): void
  /**
   * Push any coordination_capsules still pending for this user to **already-connected** WebSocket
   * clients (per device, same as handleConnection). Use after register-handshake or explicit
   * /beap/flush-queued so offline-stored (HTTP 202) capsules reach recipients without reconnecting.
   */
  flushPendingToConnectedClientsForUser(
    userId: string,
    email: string | null | undefined,
    reason: 'register_handshake' | 'http_flush' | 'ws_connect',
  ): { delivered: number }
  pushCapsule(recipientUserId: string, id: string, capsuleJson: string): boolean
  /**
   * Transient P2P signaling (WebRTC) — not stored in coordination_capsules, not a BEAP capsule frame.
   */
  pushP2pSignal(
    recipientUserId: string,
    recipientDeviceId: string | null,
    id: string,
    payload: Record<string, unknown>,
  ): boolean
  pushSystemEvent(recipientUserId: string, event: string, payload?: Record<string, unknown>): boolean
  handleAck(userId: string, ids: string[]): void
  getConnectedCount(): number
  startHeartbeat(intervalMs: number): ReturnType<typeof setInterval>
  onPong(ws: WebSocket): void
  getUserIdForWs(ws: WebSocket): string | undefined
  /** First connected client for this user (any device). Backward compatible with userId-only routing. */
  getClient(userId: string): ConnectedClient | undefined
  getClientByDevice(userId: string, deviceId: string): ConnectedClient | undefined
  getClientsByUser(userId: string): ConnectedClient[]
  listConnectedDeviceIdsForUser(userId: string): string[]
  removeClient(clientKey: string): void
}

export function createWsManager(store: StoreAdapter): WsManagerAdapter {
  const clients = new Map<string, ConnectedClient>()
  const wsToClientKey = new WeakMap<WebSocket, string>()

  function removeClient(clientKey: string): void {
    clients.delete(clientKey)
  }

  function getClientsByUser(userId: string): ConnectedClient[] {
    const prefix = `${userId}:`
    const out: ConnectedClient[] = []
    for (const [key, client] of clients.entries()) {
      if (key === userId || key.startsWith(prefix)) {
        out.push(client)
      }
    }
    return out
  }

  function getClient(userId: string): ConnectedClient | undefined {
    const list = getClientsByUser(userId)
    return list[0]
  }

  function getClientByDevice(userId: string, deviceId: string): ConnectedClient | undefined {
    return clients.get(compositeKey(userId, deviceId))
  }

  function resolveClient(recipientUserId: string): ConnectedClient | undefined {
    if (clients.has(recipientUserId)) {
      return clients.get(recipientUserId)
    }
    const direct = getClient(recipientUserId)
    if (direct) return direct
    if (recipientUserId.includes('@')) {
      for (const client of clients.values()) {
        if (client.email === recipientUserId) return client
      }
    }
    return undefined
  }

  return {
    handleConnection(ws: WebSocket, identity: ValidatedIdentity, deviceId?: string): void {
      const { userId, email } = identity
      const did = deviceId?.trim() || DEFAULT_DEVICE_ID
      const clientKey = compositeKey(userId, did)
      if (clients.has(clientKey)) {
        clients.get(clientKey)!.ws.terminate()
      }
      const client: ConnectedClient = {
        userId,
        email,
        deviceId: did,
        ws,
        connectedAt: new Date(),
        lastPing: new Date(),
      }
      clients.set(clientKey, client)
      wsToClientKey.set(ws, clientKey)

      ws.on('close', () => removeClient(clientKey))
      ws.on('error', () => removeClient(clientKey))

      const deliveredOnConnect = deliverPendingToWs(store, userId, email, did, (payload) => {
        ws.send(payload)
      })
      if (deliveredOnConnect > 0) {
        console.log(
          '[RELAY-QUEUE] drain_attempt',
          JSON.stringify({ reason: 'ws_connect', userId, device_id: did, delivered: deliveredOnConnect }),
        )
      }
      logOrphanedPendingForUser(store, getClientsByUser, userId, { reason: 'ws_connect', client_device_id: did })
    },

    flushPendingToConnectedClientsForUser(
      userId: string,
      email: string | null | undefined,
      reason: 'register_handshake' | 'http_flush' | 'ws_connect',
    ): { delivered: number } {
      const list = getClientsByUser(userId)
      if (list.length === 0) {
        console.log(
          '[RELAY-QUEUE] drain_attempt',
          JSON.stringify({ reason, userId, device_count: 0, delivered: 0, note: 'no_online_recipient' }),
        )
        return { delivered: 0 }
      }
      let delivered = 0
      for (const client of list) {
        delivered += deliverPendingToWs(store, userId, email, client.deviceId, (payload) => {
          try {
            client.ws.send(payload)
          } catch {
            /* */
          }
        })
      }
      console.log(
        '[RELAY-QUEUE] drain_attempt',
        JSON.stringify({ reason, userId, device_count: list.length, delivered }),
      )
      if (delivered > 0) {
        console.log('[RELAY-QUEUE] delivered_queued', JSON.stringify({ userId, delivered, reason }))
      } else {
        console.log(
          '[RELAY-QUEUE] no_queued_for_connected_clients',
          JSON.stringify({ userId, reason, device_count: list.length }),
        )
      }
      logOrphanedPendingForUser(store, getClientsByUser, userId, { reason })
      return { delivered }
    },

    pushCapsule(recipientUserId: string, id: string, capsuleJson: string): boolean {
      const target = resolveClient(recipientUserId)
      if (!target) return false
      try {
        target.ws.send(JSON.stringify({ type: 'capsule', id, capsule: JSON.parse(capsuleJson) }))
        store.markPushed(id)
        return true
      } catch {
        return false
      }
    },

    pushP2pSignal(
      recipientUserId: string,
      recipientDeviceId: string | null,
      id: string,
      payload: Record<string, unknown>,
    ): boolean {
      const d = (recipientDeviceId ?? '').trim()
      const target = d.length > 0 ? getClientByDevice(recipientUserId, d) : getClient(recipientUserId)
      if (!target) return false
      try {
        target.ws.send(JSON.stringify({ type: 'p2p_signal', id, payload }))
        return true
      } catch {
        return false
      }
    },

    pushSystemEvent(
      recipientUserId: string,
      event: string,
      payload: Record<string, unknown> = {},
    ): boolean {
      const target = resolveClient(recipientUserId)
      if (!target) return false

      try {
        target.ws.send(JSON.stringify({
          type: 'system_event',
          event,
          ...payload,
          timestamp: new Date().toISOString(),
        }))
        console.log(`[Coordination] System event '${event}' pushed to user ${recipientUserId}`)
        return true
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[Coordination] Failed to push system event to ${recipientUserId}:`, msg)
        return false
      }
    },

    handleAck(userId: string, ids: string[]): void {
      if (ids.length === 0) return
      const first = getClient(userId)
      store.acknowledgeCapsules(ids, userId, first?.email)
    },

    getConnectedCount(): number {
      return clients.size
    },

    startHeartbeat(intervalMs: number): ReturnType<typeof setInterval> {
      return setInterval(() => {
        const now = Date.now()
        for (const [clientKey, client] of clients.entries()) {
          if (now - client.lastPing.getTime() > intervalMs + PONG_TIMEOUT_MS) {
            client.ws.terminate()
            removeClient(clientKey)
            continue
          }
          client.lastPing = new Date()
          client.ws.ping()
        }
      }, intervalMs)
    },

    onPong(ws: WebSocket): void {
      const clientKey = wsToClientKey.get(ws)
      if (clientKey) {
        const client = clients.get(clientKey)
        if (client) client.lastPing = new Date()
      }
    },

    getUserIdForWs(ws: WebSocket): string | undefined {
      const clientKey = wsToClientKey.get(ws)
      if (!clientKey) return undefined
      return parseCompositeKey(clientKey).userId
    },

    getClient,
    getClientByDevice,
    getClientsByUser,
    listConnectedDeviceIdsForUser(userId: string): string[] {
      return getClientsByUser(userId).map((c) => c.deviceId)
    },
    removeClient,
  }
}
