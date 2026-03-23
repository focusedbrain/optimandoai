/**
 * Coordination Service — HTTP + WebSocket server
 * Stateless relay: authoritative state in storage. Fail-close on auth/storage failure.
 */

import http from 'http'
import https from 'https'
import { readFile } from 'fs/promises'
import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validateInput } from '@repo/ingestion-core'
import type { CoordinationConfig } from './config.js'
import { createStore } from './store.js'
import { createAuth } from './auth.js'
import { createRateLimiter } from './rateLimiter.js'
import { createHandshakeRegistry } from './handshakeRegistry.js'
import { createWsManager } from './wsManager.js'
import { createHealth } from './health.js'

const MAX_BODY_BYTES = 15 * 1024 * 1024

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Capsule rejected',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress ?? '0.0.0.0'
}

function sendError(
  res: http.ServerResponse,
  status: number,
  body?: Record<string, unknown>,
): void {
  const msg = STATUS_MESSAGES[status] ?? 'Request rejected'
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body ?? { error: msg }))
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<{ body: string; ok: boolean }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > maxBytes) return { body: '', ok: false }
    chunks.push(chunk as Buffer)
  }
  return { body: Buffer.concat(chunks).toString('utf8'), ok: true }
}

export interface RelayInstance {
  store: ReturnType<typeof createStore>
  auth: ReturnType<typeof createAuth>
  handshakeRegistry: ReturnType<typeof createHandshakeRegistry>
  rateLimiter: ReturnType<typeof createRateLimiter>
  wsManager: ReturnType<typeof createWsManager>
  health: ReturnType<typeof createHealth>
}

function createRequestHandler(
  config: CoordinationConfig,
  relay: RelayInstance,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { store, auth, handshakeRegistry, rateLimiter, wsManager, health } = relay

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      const url = req.url ?? ''
      const [path] = url.split('?')

      if (req.method === 'GET' && path === '/health') {
        const result = await health.check()
        res.writeHead(result.statusCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result.payload))
        return
      }

      /* ── POST /beap/system-event ──────────────────────────────── */
      if (req.method === 'POST' && path === '/beap/system-event') {
        const token = auth.extractBearerToken(req.headers.authorization)
        const identity = token ? await auth.validateOidcToken(token) : null
        if (!identity) {
          sendError(res, 401)
          return
        }
        const { body, ok } = await readBody(req, 64 * 1024)
        if (!ok) { sendError(res, 413); return }
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(body) as Record<string, unknown> }
        catch { sendError(res, 400, { error: 'Invalid JSON' }); return }
        const targetUserId = typeof parsed.target_user_id === 'string' ? parsed.target_user_id.trim() : ''
        const event = typeof parsed.event === 'string' ? parsed.event.trim() : ''
        if (!targetUserId || !event) {
          sendError(res, 400, { error: 'Missing required fields: target_user_id, event' })
          return
        }
        const { target_user_id: _, event: __, ...eventPayload } = parsed
        const pushed = wsManager.pushSystemEvent(targetUserId, event, eventPayload as Record<string, unknown>)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          delivered: pushed,
          target_user_id: targetUserId,
          event,
          message: pushed ? 'Event delivered to connected client' : 'Client offline — event not delivered',
        }))
        return
      }

      const token = auth.extractBearerToken(req.headers.authorization)
      const identity = token ? await auth.validateOidcToken(token) : null

      if (req.method === 'POST' && path === '/beap/register-handshake') {
        if (!identity) {
          sendError(res, 401)
          return
        }
        const { body, ok } = await readBody(req, MAX_BODY_BYTES)
        if (!ok) {
          sendError(res, 413)
          return
        }
        let handshakeId: string
        let initiatorUserId: string
        let acceptorUserId: string
        let initiatorEmail: string | undefined
        let acceptorEmail: string | undefined
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>
          if (
            typeof parsed?.handshake_id !== 'string' ||
            typeof parsed?.initiator_user_id !== 'string' ||
            typeof parsed?.acceptor_user_id !== 'string'
          ) {
            sendError(res, 400)
            return
          }
          handshakeId = parsed.handshake_id
          initiatorUserId = parsed.initiator_user_id
          acceptorUserId = parsed.acceptor_user_id
          initiatorEmail = typeof parsed.initiator_email === 'string' ? parsed.initiator_email : undefined
          acceptorEmail = typeof parsed.acceptor_email === 'string' ? parsed.acceptor_email : undefined
        } catch {
          sendError(res, 400)
          return
        }
        try {
          handshakeRegistry.registerHandshake(handshakeId, initiatorUserId, acceptorUserId, initiatorEmail, acceptorEmail)
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ registered: true }))
        return
      }

      if (req.method === 'POST' && path === '/beap/capsule') {
        if (!identity) {
          sendError(res, 401)
          return
        }
        const contentType = (req.headers['content-type'] ?? '').toLowerCase()
        if (!contentType.includes('application/json')) {
          sendError(res, 415)
          return
        }
        const { body, ok } = await readBody(req, MAX_BODY_BYTES)
        if (!ok) {
          sendError(res, 413)
          return
        }
        let handshakeId: string
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(body) as Record<string, unknown>
          handshakeId = typeof parsed?.handshake_id === 'string' ? parsed.handshake_id : ''
        } catch {
          sendError(res, 400)
          return
        }

        const isMessagePackage =
          parsed != null &&
          typeof parsed === 'object' &&
          'header' in parsed &&
          'metadata' in parsed &&
          ('envelope' in parsed || 'payload' in parsed) &&
          !('capsule_type' in parsed)

        if (isMessagePackage) {
          const header = parsed?.header
          if (header && typeof header === 'object') {
            const rb = (header as Record<string, unknown>)?.receiver_binding
            if (rb && typeof rb === 'object' && 'handshake_id' in rb) {
              const id = (rb as Record<string, unknown>).handshake_id
              if (typeof id === 'string' && id.trim().length > 0) handshakeId = id.trim()
            }
          }
        }

        if (!handshakeId?.trim()) {
          sendError(res, 400)
          return
        }
        handshakeId = handshakeId.trim()

        if (!handshakeRegistry.isSenderAuthorized(handshakeId, identity.userId)) {
          sendError(res, 403)
          return
        }

        // Reject initiate capsules — must be delivered out-of-band (file/email/USB)
        // Message packages (qBEAP/pBEAP) are allowed and bypass capsule_type check
        if (!isMessagePackage) {
          const RELAY_ALLOWED_TYPES = ['accept', 'context_sync', 'refresh', 'revoke']
          const capsuleType = typeof parsed?.capsule_type === 'string' ? parsed.capsule_type : ''
          if (!RELAY_ALLOWED_TYPES.includes(capsuleType)) {
            sendError(res, 400, {
              error: 'capsule_type_not_allowed',
              detail: `Type '${capsuleType || 'unknown'}' must be delivered out-of-band (file, email, USB). Relay accepts: ${RELAY_ALLOWED_TYPES.join(', ')}`,
            })
            return
          }
        }

        const recipientUserId = handshakeRegistry.getRecipientForSender(handshakeId, identity.userId)
        if (!recipientUserId) {
          sendError(res, 403)
          return
        }

        let recipientPending: number
        try {
          recipientPending = store.countPendingForRecipient(recipientUserId)
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        const rateCheck = rateLimiter.checkRateLimit(identity.userId, identity, recipientPending)
        if (!rateCheck.ok) {
          sendError(res, 429, {
            error: 'Rate limit exceeded',
            limit: rateCheck.limit,
            tier: rateCheck.tier,
            upgrade_url: 'https://wrdesk.com/pricing',
          })
          return
        }

        const rawInput = {
          body,
          mime_type: 'application/json' as const,
          headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
        }
        const transportMeta = { source_ip: getClientIp(req) }
        const result = validateInput(rawInput, 'coordination_service', transportMeta)

        if (!result.success) {
          sendError(res, 422)
          return
        }

        const id = randomUUID()
        try {
          store.storeCapsule(
            id,
            handshakeId,
            identity.userId,
            recipientUserId,
            body,
            config.capsule_retention_days,
          )
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        rateLimiter.recordCapsuleSent(identity.userId)

        const pushed = wsManager.pushCapsule(recipientUserId, id, body)
        if (pushed) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'Capsule delivered' }))
        } else {
          res.writeHead(202, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'Capsule stored, recipient offline' }))
        }
        return
      }

      sendError(res, 404)
    })()
  }
}

export async function createServer(config: CoordinationConfig): Promise<{
  server: http.Server | https.Server
  relay: RelayInstance
}> {
  const store = createStore(config)
  store.init()

  const auth = createAuth(store, {
    oidc_issuer: config.oidc_issuer,
    oidc_jwks_url: config.oidc_jwks_url,
    oidc_audience: config.oidc_audience,
  })

  const handshakeRegistry = createHandshakeRegistry(store)
  const rateLimiter = createRateLimiter()
  const wsManager = createWsManager(store)
  const health = createHealth(store, auth, wsManager)

  const relay: RelayInstance = {
    store,
    auth,
    handshakeRegistry,
    rateLimiter,
    wsManager,
    health,
  }

  const handler = createRequestHandler(config, relay)

  let server: http.Server | https.Server
  if (config.tls_cert_path && config.tls_key_path) {
    const [cert, key] = await Promise.all([
      readFile(config.tls_cert_path),
      readFile(config.tls_key_path),
    ])
    server = https.createServer({ cert, key }, handler)
  } else {
    server = http.createServer(handler)
  }

  const wss = new WebSocketServer({ server, path: '/beap/ws' })

  wss.on('connection', async (ws: import('ws').WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const tokenFromUrl = url.searchParams.get('token') ?? url.searchParams.get('access_token')
    const authHeader = req.headers.authorization
    const token = tokenFromUrl ?? auth.extractBearerToken(authHeader)

    if (!token) {
      ws.close(4001, 'Unauthorized')
      return
    }

    const identity = await auth.validateOidcToken(token)
    if (!identity) {
      ws.close(4001, 'Unauthorized')
      return
    }

    if (wsManager.getConnectedCount() >= config.max_connections) {
      console.warn('[Coordination] WS_MAX_CONNECTIONS_REACHED', {
        current: wsManager.getConnectedCount(),
        limit: config.max_connections,
      })
      ws.close(1013, 'Try Again Later')
      return
    }

    ws.on('pong', () => wsManager.onPong(ws))

    wsManager.handleConnection(ws, identity)

    ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8')
        const msg = JSON.parse(text) as { type?: string; ids?: unknown }
        if (msg?.type === 'ack' && Array.isArray(msg.ids)) {
          const ids = msg.ids.filter((x): x is string => typeof x === 'string')
          const userId = wsManager.getUserIdForWs(ws)
          if (userId) wsManager.handleAck(userId, ids)
        }
      } catch {
        // ignore malformed
      }
    })
  })

  wsManager.startHeartbeat(config.ws_heartbeat_interval)

  return { server, relay }
}

// Run when executed directly: node dist/server.js
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const __filename = resolve(fileURLToPath(import.meta.url))
const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === __filename) {
  import('./index.js').then((m) =>
    m.main().catch((err: Error) => {
      console.error(err)
      process.exit(1)
    }),
  )
}
