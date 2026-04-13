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

export interface WsManagerAdapter {
  handleConnection(ws: WebSocket, identity: ValidatedIdentity, deviceId?: string): void
  pushCapsule(recipientUserId: string, id: string, capsuleJson: string): boolean
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

      const pending = store.getPendingCapsules(userId, email)
      for (const { id, capsule_json } of pending) {
        try {
          ws.send(JSON.stringify({ type: 'capsule', id, capsule: JSON.parse(capsule_json) }))
          store.markPushed(id)
        } catch {
          // skip malformed
        }
      }
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
    removeClient,
  }
}
