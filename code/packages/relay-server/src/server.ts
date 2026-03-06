/**
 * Relay server HTTP/HTTPS routes.
 * POST /beap/ingest, GET /beap/pull, POST /beap/ack, POST /beap/register-handshake, GET /health
 */

import http from 'http'
import https from 'https'
import { readFileSync } from 'fs'
import { validateInput } from '@repo/ingestion-core'
import type { RelayConfig } from './config.js'
import {
  storeCapsule,
  getUnacknowledgedCapsules,
  acknowledgeCapsules,
  registerHandshake,
  lookupHandshakeToken,
  cleanupExpired,
} from './store.js'
import { extractBearerToken, verifyHostAuth, verifyIngestAuth } from './auth.js'
import { getHealthPayload } from './health.js'
import {
  checkIpLimit,
  checkHandshakeLimit,
  checkAuthFailLimit,
  recordAuthFailure,
} from './rateLimiter.js'

const IP_LIMIT = 30
const HANDSHAKE_LIMIT = 5

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
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
  ip: string,
  handshakeId?: string | null,
): void {
  const msg = STATUS_MESSAGES[status] ?? 'Request rejected'
  const ts = new Date().toISOString()
  console.warn('[Relay] Rejection', { ip, status, handshake_id: handshakeId ?? 'n/a', timestamp: ts })
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: msg }))
}

function parseHandshakeId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const id = parsed?.handshake_id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
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

export function createRequestHandler(config: RelayConfig): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      const ip = getClientIp(req)
      const url = req.url ?? ''
      const [path, _query] = url.split('?')

      if (req.method === 'GET' && path === '/health') {
        const payload = getHealthPayload()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
        return
      }

      if (req.method === 'POST' && path === '/beap/ingest') {
        if (!checkAuthFailLimit(ip)) {
          sendError(res, 429, ip)
          return
        }
        if (!checkIpLimit(ip, IP_LIMIT)) {
          sendError(res, 429, ip)
          return
        }
        const contentType = req.headers['content-type'] ?? ''
        if (!contentType.includes('application/json') && !contentType.includes('application/vnd.beap+json')) {
          sendError(res, 415, ip)
          return
        }
        const { body, ok } = await readBody(req, config.max_body_size)
        if (!ok) {
          sendError(res, 413, ip)
          return
        }
        let handshakeId = parseHandshakeId(body)
        if (!handshakeId?.trim()) {
          sendError(res, 400, ip)
          return
        }
        handshakeId = handshakeId.trim()
        if (!checkHandshakeLimit(handshakeId, HANDSHAKE_LIMIT)) {
          sendError(res, 429, ip, handshakeId)
          return
        }
        const token = extractBearerToken(req.headers.authorization)
        const expectedToken = lookupHandshakeToken(handshakeId)
        if (!verifyIngestAuth(token, expectedToken)) {
          recordAuthFailure(ip)
          sendError(res, 401, ip, handshakeId)
          return
        }
        const rawInput = {
          body,
          mime_type: 'application/vnd.beap+json' as const,
          headers: { 'content-type': contentType },
        }
        const result = validateInput(rawInput, 'p2p_relay', { source_ip: ip })
        if (!result.success) {
          res.writeHead(422, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Capsule rejected' }))
          return
        }
        const id = storeCapsule(handshakeId, body, ip, config.max_capsule_age_days)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'stored', id }))
        return
      }

      if (req.method === 'GET' && path === '/beap/pull') {
        const token = extractBearerToken(req.headers.authorization)
        if (!verifyHostAuth(token, config.relay_auth_secret)) {
          sendError(res, 401, ip)
          return
        }
        const rows = getUnacknowledgedCapsules()
        const capsules = rows.map((r) => ({
          id: r.id,
          handshake_id: r.handshake_id,
          capsule_json: r.capsule_json,
          received_at: r.received_at,
        }))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ capsules }))
        return
      }

      if (req.method === 'POST' && path === '/beap/ack') {
        const token = extractBearerToken(req.headers.authorization)
        if (!verifyHostAuth(token, config.relay_auth_secret)) {
          sendError(res, 401, ip)
          return
        }
        const { body, ok } = await readBody(req, config.max_body_size)
        if (!ok) {
          sendError(res, 413, ip)
          return
        }
        let ids: string[]
        try {
          const parsed = JSON.parse(body) as { ids?: unknown }
          if (!Array.isArray(parsed?.ids)) {
            sendError(res, 400, ip)
            return
          }
          ids = parsed.ids.filter((x): x is string => typeof x === 'string')
        } catch {
          sendError(res, 400, ip)
          return
        }
        const count = acknowledgeCapsules(ids)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ acknowledged: count }))
        return
      }

      if (req.method === 'POST' && path === '/beap/register-handshake') {
        const token = extractBearerToken(req.headers.authorization)
        if (!verifyHostAuth(token, config.relay_auth_secret)) {
          sendError(res, 401, ip)
          return
        }
        const { body, ok } = await readBody(req, config.max_body_size)
        if (!ok) {
          sendError(res, 413, ip)
          return
        }
        let handshakeId: string
        let expectedToken: string
        let counterpartyEmail: string | undefined
        try {
          const parsed = JSON.parse(body) as {
            handshake_id?: unknown
            expected_token?: unknown
            counterparty_email?: unknown
          }
          if (typeof parsed?.handshake_id !== 'string' || typeof parsed?.expected_token !== 'string') {
            sendError(res, 400, ip)
            return
          }
          handshakeId = parsed.handshake_id
          expectedToken = parsed.expected_token
          counterpartyEmail = typeof parsed.counterparty_email === 'string' ? parsed.counterparty_email : undefined
        } catch {
          sendError(res, 400, ip)
          return
        }
        registerHandshake(handshakeId, expectedToken, counterpartyEmail)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ registered: true }))
        return
      }

      sendError(res, 404, ip)
    })()
  }
}

export function createServer(config: RelayConfig): http.Server | https.Server {
  const handler = createRequestHandler(config)

  if (config.tls_enabled && config.tls_cert_path && config.tls_key_path) {
    const options = {
      cert: readFileSync(config.tls_cert_path),
      key: readFileSync(config.tls_key_path),
    }
    return https.createServer(options, handler)
  }

  if (!config.tls_enabled) {
    console.warn('[Relay] Running without TLS — not recommended for production')
  }

  return http.createServer(handler)
}

export function startCleanupInterval(config: RelayConfig): NodeJS.Timeout {
  cleanupExpired()
  return setInterval(() => cleanupExpired(), 60 * 60 * 1000)
}
