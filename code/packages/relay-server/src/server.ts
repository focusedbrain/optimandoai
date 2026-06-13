/**
 * Relay server HTTP/HTTPS routes.
 * POST /beap/ingest, GET /beap/pull, POST /beap/ack,
 * POST /beap/register-handshake, POST /beap/device-register, GET /health
 *
 * Native-BEAP host-only routing (relay-side):
 *   - capsule_type === 'message_package' is the only account-addressed native
 *     BEAP type at the relay level.  When at least one device has registered a
 *     role, these capsules are stored with host_only=true.
 *   - All other capsule_types (initiate, accept, refresh, revoke, context_sync)
 *     are handshake / infrastructure traffic and always fan-out to all pullers.
 *   - GET /beap/pull?device_id=<id>: if the device is a registered sandbox,
 *     host_only capsules are excluded.  No device_id → legacy fan-out.
 *   - Conflict rules: 0 hosts or 2+ hosts → fan-out + loud log.
 *   - No device registration → legacy fan-out (backward compat, no flag-day).
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
  registerDevice,
  getDeviceRole,
  getRegisteredHostCount,
  getRegisteredDeviceCount,
  type DeviceRole,
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

/**
 * The single capsule_type that represents an account-addressed native BEAP
 * message at the relay level.  All other types are handshake / infrastructure
 * and must always fan-out to every puller.
 */
const NATIVE_BEAP_CAPSULE_TYPE = 'message_package'

/**
 * Capsule types that are device-targeted (clones, handshake lifecycle,
 * infrastructure).  These fan-out regardless of device role registration.
 *
 * Exhaustive list for the current ingestion-core CapsuleType union:
 *   initiate | accept | refresh | revoke | context_sync | internal_draft
 * (message_package is the only native-BEAP type and is handled separately.)
 */
const FANOUT_CAPSULE_TYPES = new Set([
  'initiate',
  'accept',
  'refresh',
  'revoke',
  'context_sync',
  'internal_draft',
  // Guard-rail: sandbox_clone and critical_job variants that may appear in
  // future schema extensions are also explicitly fan-out.
  'sandbox_clone',
  'sandbox_clone_quarantine',
])

function isNativeBeapCapsule(capsuleJson: string): boolean {
  try {
    const parsed = JSON.parse(capsuleJson) as Record<string, unknown>
    const ct = parsed?.capsule_type
    if (typeof ct !== 'string') return false
    const normalized = ct.trim()
    if (FANOUT_CAPSULE_TYPES.has(normalized)) return false
    // Any unknown type is conservatively treated as native (host-only) —
    // failing open to delivery on the host is safe; failing open to the
    // sandbox would be the bug this routing prevents.
    return normalized === NATIVE_BEAP_CAPSULE_TYPE || !FANOUT_CAPSULE_TYPES.has(normalized)
  } catch {
    return false
  }
}

/**
 * Determine whether this capsule should be stored as host_only.
 *
 * Returns true iff:
 *   - The capsule is a native BEAP type, AND
 *   - At least one device has registered a role (any role), AND
 *   - Exactly one host is registered (conflict = fan-out + log).
 */
function shouldStoreAsHostOnly(capsuleJson: string): { hostOnly: boolean; conflict: boolean } {
  if (!isNativeBeapCapsule(capsuleJson)) return { hostOnly: false, conflict: false }

  const totalRegistered = getRegisteredDeviceCount()
  if (totalRegistered === 0) {
    // No roles registered — legacy orchestrator, fan-out as today.
    return { hostOnly: false, conflict: false }
  }

  const hostCount = getRegisteredHostCount()
  if (hostCount === 1) {
    return { hostOnly: true, conflict: false }
  }

  // Zero hosts or multiple hosts: conflict — fail open (fan-out) and log loudly.
  return { hostOnly: false, conflict: true }
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

function parseQueryParam(url: string, name: string): string | null {
  try {
    const idx = url.indexOf('?')
    if (idx === -1) return null
    const params = new URLSearchParams(url.slice(idx + 1))
    return params.get(name)
  } catch {
    return null
  }
}

export function createRequestHandler(config: RelayConfig): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      const ip = getClientIp(req)
      const url = req.url ?? ''
      const [path] = url.split('?')

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

        // Native-BEAP host-only routing decision.
        const { hostOnly, conflict } = shouldStoreAsHostOnly(body)
        if (conflict) {
          console.error(
            '[Relay] NATIVE_BEAP_ROUTING_CONFLICT: host role ambiguous — fan-out to all devices. ' +
              'Ensure exactly one device is registered as host. ' +
              JSON.stringify({ handshake_id: handshakeId, host_count: getRegisteredHostCount(), ip }),
          )
        }
        if (hostOnly) {
          console.log('[Relay] native_beap_host_only', JSON.stringify({ handshake_id: handshakeId, ip }))
        }

        const id = storeCapsule(handshakeId, body, ip, config.max_capsule_age_days, undefined, hostOnly)
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

        // Device-role-aware filtering.
        // A registered sandbox never receives host_only capsules.
        // An unregistered puller (legacy / no device_id param) gets all capsules.
        const deviceId = parseQueryParam(url, 'device_id')?.trim() || null
        let excludeHostOnly = false
        if (deviceId) {
          const role = getDeviceRole(deviceId)
          if (role === 'sandbox') {
            excludeHostOnly = true
            console.log('[Relay] pull_sandbox_filtered', JSON.stringify({ device_id: deviceId }))
          }
        }

        const rows = getUnacknowledgedCapsules(excludeHostOnly)
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

      if (req.method === 'POST' && path === '/beap/device-register') {
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
        let deviceId: string
        let deviceRole: DeviceRole
        try {
          const parsed = JSON.parse(body) as { device_id?: unknown; device_role?: unknown }
          if (typeof parsed?.device_id !== 'string' || !parsed.device_id.trim()) {
            sendError(res, 400, ip)
            return
          }
          const role = parsed?.device_role
          if (role !== 'host' && role !== 'sandbox') {
            sendError(res, 400, ip)
            return
          }
          deviceId = parsed.device_id.trim()
          deviceRole = role
        } catch {
          sendError(res, 400, ip)
          return
        }
        registerDevice(deviceId, deviceRole)
        console.log('[Relay] device_registered', JSON.stringify({ device_id: deviceId, role: deviceRole, ip }))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ registered: true, device_id: deviceId, role: deviceRole }))
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
