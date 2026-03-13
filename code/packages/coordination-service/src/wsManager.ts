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
  ws: WebSocket
  connectedAt: Date
  lastPing: Date
}

const PONG_TIMEOUT_MS = 10_000

export interface WsManagerAdapter {
  handleConnection(ws: WebSocket, identity: ValidatedIdentity): void
  pushCapsule(recipientUserId: string, id: string, capsuleJson: string): boolean
  pushSystemEvent(recipientUserId: string, event: string, payload?: Record<string, unknown>): boolean
  handleAck(userId: string, ids: string[]): void
  getConnectedCount(): number
  startHeartbeat(intervalMs: number): ReturnType<typeof setInterval>
  onPong(ws: WebSocket): void
  getUserIdForWs(ws: WebSocket): string | undefined
}

export function createWsManager(store: StoreAdapter): WsManagerAdapter {
  const clients = new Map<string, ConnectedClient>()
  const wsToUserId = new WeakMap<WebSocket, string>()

  function removeConnection(userId: string): void {
    clients.delete(userId)
  }

  function resolveClient(recipientUserId: string): ConnectedClient | undefined {
    const byUuid = clients.get(recipientUserId)
    if (byUuid) return byUuid
    if (recipientUserId.includes('@')) {
      for (const client of clients.values()) {
        if (client.email === recipientUserId) return client
      }
    }
    return undefined
  }

  return {
    handleConnection(ws: WebSocket, identity: ValidatedIdentity): void {
      const { userId, email } = identity
      if (clients.has(userId)) {
        clients.get(userId)!.ws.terminate()
      }
      const client: ConnectedClient = {
        userId,
        email,
        ws,
        connectedAt: new Date(),
        lastPing: new Date(),
      }
      clients.set(userId, client)
      wsToUserId.set(ws, userId)

      ws.on('close', () => removeConnection(userId))
      ws.on('error', () => removeConnection(userId))

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
      const client = resolveClient(recipientUserId)
      if (!client) return false
      try {
        client.ws.send(JSON.stringify({ type: 'capsule', id, capsule: JSON.parse(capsuleJson) }))
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
      const client = resolveClient(recipientUserId)
      if (!client) return false

      try {
        client.ws.send(JSON.stringify({
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
      const client = clients.get(userId)
      store.acknowledgeCapsules(ids, userId, client?.email)
    },

    getConnectedCount(): number {
      return clients.size
    },

    startHeartbeat(intervalMs: number): ReturnType<typeof setInterval> {
      return setInterval(() => {
        const now = Date.now()
        for (const [userId, client] of clients.entries()) {
          if (now - client.lastPing.getTime() > intervalMs + PONG_TIMEOUT_MS) {
            client.ws.terminate()
            removeConnection(userId)
            continue
          }
          client.lastPing = new Date()
          client.ws.ping()
        }
      }, intervalMs)
    },

    onPong(ws: WebSocket): void {
      const userId = wsToUserId.get(ws)
      if (userId) {
        const client = clients.get(userId)
        if (client) client.lastPing = new Date()
      }
    },

    getUserIdForWs(ws: WebSocket): string | undefined {
      return wsToUserId.get(ws)
    },
  }
}
