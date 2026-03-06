/**
 * Coordination Service — HTTP + WebSocket server
 */

import http from 'http'
import https from 'https'
import { readFileSync } from 'fs'
import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validateInput } from '@repo/ingestion-core'
import type { CoordinationConfig } from './config.js'
import {
  storeCapsule,
  countPendingForRecipient,
} from './store.js'
import { extractBearerToken, validateOidcToken } from './auth.js'
import { checkRateLimit, recordCapsuleSent } from './rateLimiter.js'
import { registerHandshake, getRecipientForSender, isSenderAuthorized } from './handshakeRegistry.js'
import {
  handleConnection,
  pushCapsule,
  pushPendingCapsules,
  handleAck,
  getConnectedCount,
  startHeartbeat,
  onPong,
  getUserIdForWs,
} from './wsManager.js'
import { getHealthPayload } from './health.js'

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

function createRequestHandler(config: CoordinationConfig): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      const url = req.url ?? ''
      const [path] = url.split('?')

      if (req.method === 'GET' && path === '/health') {
        const payload = getHealthPayload(getConnectedCount())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
        return
      }

      const token = extractBearerToken(req.headers.authorization)
      const identity = token
        ? await validateOidcToken(token, config.oidc_issuer, config.oidc_jwks_url)
        : null

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
        registerHandshake(handshakeId, initiatorUserId, acceptorUserId, initiatorEmail, acceptorEmail)
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
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>
          handshakeId = typeof parsed?.handshake_id === 'string' ? parsed.handshake_id : ''
        } catch {
          sendError(res, 400)
          return
        }
        if (!handshakeId?.trim()) {
          sendError(res, 400)
          return
        }
        handshakeId = handshakeId.trim()

        if (!isSenderAuthorized(handshakeId, identity.userId)) {
          sendError(res, 403)
          return
        }

        const recipientUserId = getRecipientForSender(handshakeId, identity.userId)
        if (!recipientUserId) {
          sendError(res, 403)
          return
        }

        const recipientPending = countPendingForRecipient(recipientUserId)
        const rateCheck = checkRateLimit(identity.userId, identity, recipientPending)
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
        storeCapsule(
          id,
          handshakeId,
          identity.userId,
          recipientUserId,
          body,
          config.capsule_retention_days,
        )
        recordCapsuleSent(identity.userId)

        const pushed = pushCapsule(recipientUserId, id, body)
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

export function createServer(config: CoordinationConfig): http.Server | https.Server {
  const handler = createRequestHandler(config)

  let server: http.Server | https.Server
  if (config.tls_cert_path && config.tls_key_path) {
    server = https.createServer(
      {
        cert: readFileSync(config.tls_cert_path),
        key: readFileSync(config.tls_key_path),
      },
      handler,
    )
  } else {
    server = http.createServer(handler)
  }

  const wss = new WebSocketServer({ server, path: '/beap/ws' })

  wss.on('connection', async (ws: import('ws').WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const tokenFromUrl = url.searchParams.get('token') ?? url.searchParams.get('access_token')
    const authHeader = req.headers.authorization
    const token = tokenFromUrl ?? extractBearerToken(authHeader)

    if (!token) {
      ws.close(4001, 'Unauthorized')
      return
    }

    const identity = await validateOidcToken(token, config.oidc_issuer, config.oidc_jwks_url)
    if (!identity) {
      ws.close(4001, 'Unauthorized')
      return
    }

    ws.on('pong', () => onPong(ws))

    handleConnection(ws, identity)

    ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8')
        const msg = JSON.parse(text) as { type?: string; ids?: unknown }
        if (msg?.type === 'ack' && Array.isArray(msg.ids)) {
          const ids = msg.ids.filter((x): x is string => typeof x === 'string')
          const userId = getUserIdForWs(ws)
          if (userId) handleAck(userId, ids)
        }
      } catch {
        // ignore malformed
      }
    })
  })

  startHeartbeat(config.ws_heartbeat_interval)

  return server
}
