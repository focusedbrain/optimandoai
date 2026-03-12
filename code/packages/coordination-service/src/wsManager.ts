/**
 * Coordination Service — WebSocket connection manager
 */

import type { WebSocket } from 'ws'
import type { ValidatedIdentity } from './auth.js'
import { getPendingCapsules, markPushed, acknowledgeCapsules } from './store.js'

export interface ConnectedClient {
  userId: string
  email: string
  ws: WebSocket
  connectedAt: Date
  lastPing: Date
}

const clients = new Map<string, ConnectedClient>()
const wsToUserId = new WeakMap<WebSocket, string>()
const PONG_TIMEOUT_MS = 10_000

export function handleConnection(ws: WebSocket, identity: ValidatedIdentity): void {
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

  pushPendingCapsules(userId)
}

export function removeConnection(userId: string): void {
  clients.delete(userId)
}

export function isOnline(userId: string): boolean {
  return clients.has(userId)
}

/**
 * Resolve recipient identifier (UUID or email) to connected client.
 * Handles initiator-registered capsules where recipient_user_id=email but
 * WebSocket clients register with UUID.
 */
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

export function pushCapsule(recipientUserId: string, id: string, capsuleJson: string): boolean {
  const client = resolveClient(recipientUserId)
  if (!client) return false
  try {
    client.ws.send(JSON.stringify({ type: 'capsule', id, capsule: JSON.parse(capsuleJson) }))
    markPushed(id)
    return true
  } catch {
    return false
  }
}

export function pushSystemEvent(
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
  } catch (err: any) {
    console.warn(`[Coordination] Failed to push system event to ${recipientUserId}:`, err?.message)
    return false
  }
}

export function pushPendingCapsules(userId: string): void {
  const client = clients.get(userId)
  if (!client) return
  const pending = getPendingCapsules(userId, client.email)
  for (const { id, capsule_json } of pending) {
    try {
      client.ws.send(JSON.stringify({ type: 'capsule', id, capsule: JSON.parse(capsule_json) }))
      markPushed(id)
    } catch {
      // skip malformed
    }
  }
}

export function handleAck(userId: string, ids: string[]): void {
  if (ids.length === 0) return
  const client = clients.get(userId)
  acknowledgeCapsules(ids, userId, client?.email)
}

export function getConnectedCount(): number {
  return clients.size
}

export function getClient(userId: string): ConnectedClient | undefined {
  return clients.get(userId)
}

export function startHeartbeat(intervalMs: number): ReturnType<typeof setInterval> {
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
}

export function onPong(ws: WebSocket): void {
  const userId = wsToUserId.get(ws)
  if (userId) {
    const client = clients.get(userId)
    if (client) client.lastPing = new Date()
  }
}

export function getUserIdForWs(ws: WebSocket): string | undefined {
  return wsToUserId.get(ws)
}
