/**
 * Coordination Service — HTTP + WebSocket server
 * Stateless relay: authoritative state in storage. Fail-close on auth/storage failure.
 */

import http from 'http'
import https from 'https'
import { readFile } from 'fs/promises'
import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validateInput, isCoordinationRelayNativeBeap } from '@repo/ingestion-core'
import type { CoordinationConfig } from './config.js'
import { createStore } from './store.js'
import { createAuth } from './auth.js'
import { createRateLimiter } from './rateLimiter.js'
import { createHandshakeRegistry } from './handshakeRegistry.js'
import { createPairingCodeRegistry } from './pairingCodeRegistry.js'
import { createWsManager } from './wsManager.js'
import { createHealth } from './health.js'

const log = {
  info(message: string, meta?: Record<string, unknown>): void {
    if (meta !== undefined) console.log(`[Coordination] ${message}`, meta)
    else console.log(`[Coordination] ${message}`)
  },
}

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
  pairingCodeRegistry: ReturnType<typeof createPairingCodeRegistry>
  rateLimiter: ReturnType<typeof createRateLimiter>
  wsManager: ReturnType<typeof createWsManager>
  health: ReturnType<typeof createHealth>
}

function createRequestHandler(
  config: CoordinationConfig,
  relay: RelayInstance,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { store, auth, handshakeRegistry, pairingCodeRegistry, rateLimiter, wsManager, health } = relay

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
        let initiatorDeviceId: string | undefined
        let acceptorDeviceId: string | undefined
        let initiatorDeviceRole: string | undefined
        let acceptorDeviceRole: string | undefined
        let initiatorDeviceName: string | undefined
        let acceptorDeviceName: string | undefined
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
          const idInit = parsed.initiator_device_id
          initiatorDeviceId =
            typeof idInit === 'string' && idInit.trim().length > 0 ? idInit.trim() : undefined
          const idAcc = parsed.acceptor_device_id
          acceptorDeviceId =
            typeof idAcc === 'string' && idAcc.trim().length > 0 ? idAcc.trim() : undefined
          const trimOpt = (k: string): string | undefined => {
            const v = parsed[k]
            return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
          }
          initiatorDeviceRole = trimOpt('initiator_device_role')
          acceptorDeviceRole = trimOpt('acceptor_device_role')
          initiatorDeviceName = trimOpt('initiator_device_name')
          acceptorDeviceName = trimOpt('acceptor_device_name')
        } catch {
          sendError(res, 400)
          return
        }
        const samePrincipalReg = initiatorUserId === acceptorUserId
        if (samePrincipalReg) {
          if (!initiatorDeviceId) {
            sendError(res, 400, {
              error: 'internal_routing',
              code: 'INTERNAL_RELAY_REGISTRATION_MISSING_INITIATOR_DEVICE_ID',
              detail: 'Same-principal handshakes require non-empty initiator_device_id',
              field: 'initiator_device_id',
            })
            return
          }
          if (!acceptorDeviceId) {
            sendError(res, 400, {
              error: 'internal_routing',
              code: 'INTERNAL_RELAY_REGISTRATION_MISSING_ACCEPTOR_DEVICE_ID',
              detail: 'Same-principal handshakes require non-empty acceptor_device_id',
              field: 'acceptor_device_id',
            })
            return
          }
          if (initiatorDeviceId === acceptorDeviceId) {
            sendError(res, 400, {
              error: 'internal_routing',
              code: 'INTERNAL_RELAY_REGISTRATION_DEVICE_IDS_NOT_DISTINCT',
              detail: 'initiator_device_id and acceptor_device_id must differ for same-principal routing',
              field: 'initiator_device_id',
            })
            return
          }
        }
        try {
          if (samePrincipalReg) {
            log.info('register-handshake same-principal', {
              handshake_id: handshakeId,
              initiator_device_id: initiatorDeviceId,
              acceptor_device_id: acceptorDeviceId,
              initiator_device_role: initiatorDeviceRole ?? null,
              acceptor_device_role: acceptorDeviceRole ?? null,
              has_initiator_device_name: Boolean(initiatorDeviceName),
              has_acceptor_device_name: Boolean(acceptorDeviceName),
            })
          }
          handshakeRegistry.registerHandshake(
            handshakeId,
            initiatorUserId,
            acceptorUserId,
            initiatorEmail,
            acceptorEmail,
            initiatorDeviceId,
            acceptorDeviceId,
            initiatorDeviceRole,
            acceptorDeviceRole,
            initiatorDeviceName,
            acceptorDeviceName,
          )
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        try {
          const dInit = wsManager.flushPendingToConnectedClientsForUser(
            initiatorUserId,
            initiatorEmail ?? null,
            'register_handshake',
          )
          const dAcc = wsManager.flushPendingToConnectedClientsForUser(
            acceptorUserId,
            acceptorEmail ?? null,
            'register_handshake',
          )
          log.info('register-handshake post-flush', {
            handshake_id: handshakeId,
            initiator_user_id: initiatorUserId,
            acceptor_user_id: acceptorUserId,
            flush_initiator_delivered: dInit.delivered,
            flush_acceptor_delivered: dAcc.delivered,
          })
        } catch (flushErr: unknown) {
          const msg = flushErr instanceof Error ? flushErr.message : String(flushErr)
          log.info('register-handshake post-flush failed (non-fatal)', { error: msg })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ registered: true }))
        return
      }

      if (req.method === 'POST' && path === '/beap/flush-queued') {
        if (!identity) {
          sendError(res, 401)
          return
        }
        const out = wsManager.flushPendingToConnectedClientsForUser(identity.userId, identity.email, 'http_flush')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, delivered: out.delivered, user_id: identity.userId }))
        return
      }

      /* ── POST /api/coordination/register-pairing-code ───────────
       * Register or refresh a (user, pairing_code) → instance_id mapping.
       *
       * Body: { user_id, instance_id, pairing_code, device_name? }
       *   - JWT required; token.sub MUST equal user_id (cross-user writes
       *     are rejected with 403 even if the body would otherwise be valid).
       *   - 201 if newly inserted (and any prior code for this device removed).
       *   - 200 if (user_id, pairing_code) already maps to the same device.
       *   - 409 if (user_id, pairing_code) maps to a different device.
       */
      if (req.method === 'POST' && path === '/api/coordination/register-pairing-code') {
        if (!identity) { sendError(res, 401); return }
        const { body, ok } = await readBody(req, 64 * 1024)
        if (!ok) { sendError(res, 413); return }
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(body) as Record<string, unknown> }
        catch { sendError(res, 400, { error: 'Invalid JSON' }); return }
        const userId = typeof parsed.user_id === 'string' ? parsed.user_id.trim() : ''
        const instanceId = typeof parsed.instance_id === 'string' ? parsed.instance_id.trim() : ''
        const pairingCode = typeof parsed.pairing_code === 'string' ? parsed.pairing_code.trim() : ''
        const deviceName = typeof parsed.device_name === 'string' ? parsed.device_name.trim() : ''
        if (!userId || !instanceId || !/^[0-9]{6}$/.test(pairingCode)) {
          sendError(res, 400, {
            error: 'Missing or invalid fields: user_id, instance_id, pairing_code (6 digits)',
          })
          return
        }
        if (userId !== identity.userId) {
          sendError(res, 403, { error: 'user_id must equal token.sub' })
          return
        }
        let result
        try {
          result = pairingCodeRegistry.registerPairingCode(userId, instanceId, pairingCode, deviceName || instanceId)
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        if (result.status === 'collision') {
          sendError(res, 409, { error: 'pairing_code already registered to a different device' })
          return
        }
        const status = result.status === 'inserted' ? 201 : 200
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: result.status }))
        return
      }

      /* ── GET /api/coordination/resolve-pairing-code?code=XXXXXX ──
       * Resolve a pairing code within the caller's account scope only.
       * Returns 404 for unknown codes AND for codes registered by other
       * users — never leaks instance_ids across accounts.
       */
      if (req.method === 'GET' && path === '/api/coordination/resolve-pairing-code') {
        if (!identity) { sendError(res, 401); return }
        const codeParam = new URL(url, 'http://x').searchParams.get('code') ?? ''
        const pairingCode = codeParam.trim()
        if (!/^[0-9]{6}$/.test(pairingCode)) {
          sendError(res, 400, { error: 'code must be 6 digits' })
          return
        }
        let entry
        try {
          entry = pairingCodeRegistry.resolvePairingCode(identity.userId, pairingCode)
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        if (!entry) {
          sendError(res, 404, { error: 'pairing_code not found in this account' })
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          instance_id: entry.instance_id,
          device_name: entry.device_name,
        }))
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

        /** Native BEAP / qBEAP–pBEAP wire — structural + optional string header/metadata normalization (ingestion-core). */
        const isMessagePackage = isCoordinationRelayNativeBeap(parsed)

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
          sendError(res, 403, { error: 'RELAY_SENDER_UNAUTHORIZED' })
          return
        }

        // Capsule-type whitelist for non-message-package envelopes.
        // Source of truth: this constant. Mirrored on the client at
        // apps/electron-vite-project/electron/main/handshake/p2pTransport.ts —
        // both `RELAY_HANDSHAKE_CAPSULE_TYPES` and
        // `COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES` must stay in sync with
        // this list. Message packages (qBEAP/pBEAP) bypass this check
        // entirely (`isMessagePackage` above).
        //
        // `initiate` is conditionally allowed: only for internal (same-principal)
        // handshakes, and only when both device ids are present and resolve to
        // a registered same-principal route. The initiate-specific guard
        // immediately below this whitelist enforces those preconditions and
        // produces dedicated error codes (`initiate_external_not_allowed`,
        // `initiate_missing_routing_fields`, `no_route_for_internal_initiate`)
        // so the client can distinguish them from generic post-route failures.
        // External (cross-user) initiates must still be delivered out-of-band
        // (file/email/USB) — they are rejected here with 400.
        if (!isMessagePackage) {
          const RELAY_ALLOWED_TYPES = ['accept', 'context_sync', 'refresh', 'revoke', 'inference:chat', 'inference:response', 'initiate']
          const capsuleType = typeof parsed?.capsule_type === 'string' ? parsed.capsule_type : ''
          if (!RELAY_ALLOWED_TYPES.includes(capsuleType)) {
            sendError(res, 400, {
              error: 'capsule_type_not_allowed',
              detail: `Type '${capsuleType || 'unknown'}' must be delivered out-of-band (file, email, USB). Relay accepts: ${RELAY_ALLOWED_TYPES.join(', ')}`,
            })
            return
          }

          // ── Initiate-specific guard: only internal handshakes may relay ──
          if (capsuleType === 'initiate') {
            const handshakeType =
              typeof parsed?.handshake_type === 'string' ? parsed.handshake_type.trim() : ''
            if (handshakeType !== 'internal') {
              sendError(res, 400, {
                error: 'initiate_external_not_allowed',
                code: 'initiate_external_not_allowed',
                detail:
                  'External initiates must be delivered out-of-band (file, email, USB). Only internal handshakes may traverse the relay.',
              })
              return
            }

            // Require both routing ids non-empty and distinct. The client-side
            // resolver (resolvePairingCodeViaCoordination, ipc.ts) populates
            // sender_device_id and receiver_device_id on the wire before
            // enqueue; this catches any pre-resolver client path that slips
            // through. Reported field names match the wire keys verbatim so
            // the renderer can surface them directly.
            const initSenderIdRaw = parsed?.sender_device_id
            const initReceiverIdRaw = parsed?.receiver_device_id
            const initSenderId =
              typeof initSenderIdRaw === 'string' && initSenderIdRaw.trim().length > 0
                ? initSenderIdRaw.trim()
                : ''
            const initReceiverId =
              typeof initReceiverIdRaw === 'string' && initReceiverIdRaw.trim().length > 0
                ? initReceiverIdRaw.trim()
                : ''
            const initiateMissing: string[] = []
            if (!initSenderId) initiateMissing.push('sender_device_id')
            if (!initReceiverId) initiateMissing.push('receiver_device_id')
            if (initSenderId && initReceiverId && initSenderId === initReceiverId) {
              initiateMissing.push('sender_device_id_distinct_from_receiver_device_id')
            }
            if (initiateMissing.length > 0) {
              sendError(res, 400, {
                error: 'initiate_missing_routing_fields',
                code: 'initiate_missing_routing_fields',
                detail: initiateMissing,
              })
              return
            }

            // Resolve same-principal route here so we can emit the
            // initiate-specific 404 instead of the generic 403 the existing
            // post-whitelist path uses for accept/context_sync/etc. The
            // detail string deliberately does NOT identify which side of the
            // pair is missing from the registry — that distinction would
            // leak whether the peer device exists in the account, which is
            // pairing-code information the relay must not expose.
            const initRoute = handshakeRegistry.getRecipientForSender(
              handshakeId,
              identity.userId,
              initSenderId,
            )
            if (!initRoute) {
              sendError(res, 404, {
                error: 'no_route_for_internal_initiate',
                code: 'no_route_for_internal_initiate',
                detail:
                  'Neither device is registered in the coordination service for this account, or the pairing code was never resolved.',
              })
              return
            }
            // Fall through to the existing post-whitelist routing block, which
            // re-resolves the route (cheap SQLite lookup) and applies the
            // same-principal device-id-match guard at lines 429-460. That
            // belt-and-suspenders re-check is intentional — every relay POST
            // converges on a single routing path regardless of capsule_type.
          }
        }

        const senderDeviceIdRaw = parsed.sender_device_id
        const senderDeviceId =
          typeof senderDeviceIdRaw === 'string' && senderDeviceIdRaw.trim().length > 0
            ? senderDeviceIdRaw.trim()
            : undefined
        const regEntryPreRoute = handshakeRegistry.getHandshake(handshakeId)
        const samePrincipalRelay =
          regEntryPreRoute != null &&
          regEntryPreRoute.initiator_user_id === regEntryPreRoute.acceptor_user_id

        const recipientRoute = handshakeRegistry.getRecipientForSender(
          handshakeId,
          identity.userId,
          senderDeviceId,
        )
        if (!recipientRoute) {
          if (samePrincipalRelay && !isMessagePackage) {
            sendError(res, 403, {
              error: 'INTERNAL_RELAY_ROUTING_AMBIGUOUS',
              code: 'INTERNAL_RELAY_ROUTING_AMBIGUOUS',
              detail:
                'Same-principal relay requires both devices registered with distinct ids; sender_device_id must match the registered initiator or acceptor device for this handshake',
            })
          } else {
            sendError(res, 403, {
              error: 'RELAY_RECIPIENT_RESOLUTION_FAILED',
              code: 'RELAY_RECIPIENT_RESOLUTION_FAILED',
              detail: 'Could not resolve recipient for this handshake and authenticated sender',
            })
          }
          return
        }
        const recipientUserId = recipientRoute.userId

        const regEntry = regEntryPreRoute
        if (samePrincipalRelay && !isMessagePackage) {
          if (!senderDeviceId) {
            sendError(res, 400, {
              error: 'internal_capsule',
              code: 'INTERNAL_CAPSULE_MISSING_DEVICE_ID',
              detail: 'sender_device_id is required for same-principal relay capsules',
            })
            return
          }
          const receiverDeviceIdRaw = parsed.receiver_device_id
          const receiverDeviceId =
            typeof receiverDeviceIdRaw === 'string' && receiverDeviceIdRaw.trim().length > 0
              ? receiverDeviceIdRaw.trim()
              : undefined
          if (!receiverDeviceId) {
            sendError(res, 400, {
              error: 'internal_capsule',
              code: 'INTERNAL_CAPSULE_MISSING_DEVICE_ID',
              detail: 'receiver_device_id is required for same-principal relay capsules',
            })
            return
          }
          const expectedPeerDeviceId = recipientRoute.deviceId?.trim() ?? ''
          if (!expectedPeerDeviceId || receiverDeviceId !== expectedPeerDeviceId) {
            sendError(res, 403, {
              error: 'RELAY_RECEIVER_DEVICE_MISMATCH',
              code: 'RELAY_RECEIVER_DEVICE_MISMATCH',
              detail: 'receiver_device_id does not match registry route for this sender (device-scoped routing)',
            })
            return
          }
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
            recipientRoute.deviceId ?? null,
            body,
            config.capsule_retention_days,
          )
        } catch {
          sendError(res, 503, { error: 'Storage unavailable' })
          return
        }
        rateLimiter.recordCapsuleSent(identity.userId)

        const recipientClient =
          recipientRoute.deviceId != null && recipientRoute.deviceId.length > 0
            ? wsManager.getClientByDevice(recipientRoute.userId, recipientRoute.deviceId)
            : wsManager.getClient(recipientRoute.userId)
        let pushed = false
        if (recipientClient) {
          try {
            recipientClient.ws.send(
              JSON.stringify({ type: 'capsule', id, capsule: JSON.parse(body) }),
            )
            store.markPushed(id)
            pushed = true
          } catch {
            pushed = false
          }
        }
        const capType = typeof parsed?.capsule_type === 'string' ? parsed.capsule_type : null
        if (pushed) {
          console.log(
            '[RELAY-QUEUE] push_live',
            JSON.stringify({
              handshake_id: handshakeId,
              capsule_type: capType,
              sender_user_id: identity.userId,
              receiver_user_id: recipientUserId,
              receiver_device_id: recipientRoute.deviceId ?? null,
              coordinationRelayDelivery: 'pushed_live',
            }),
          )
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'Capsule delivered' }))
        } else {
          console.log(
            '[RELAY-QUEUE] stored_offline',
            JSON.stringify({
              handshake_id: handshakeId,
              capsule_type: capType,
              sender_user_id: identity.userId,
              receiver_user_id: recipientUserId,
              receiver_device_id: recipientRoute.deviceId ?? null,
              coordinationRelayDelivery: 'queued_recipient_offline',
              note: 'Recipient had no matching live WebSocket (offline or user+device mismatch); will drain on WS connect / register-handshake flush',
            }),
          )
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
  const pairingCodeRegistry = createPairingCodeRegistry(store)
  const rateLimiter = createRateLimiter()
  const wsManager = createWsManager(store)
  const health = createHealth(store, auth, wsManager)

  const relay: RelayInstance = {
    store,
    auth,
    handshakeRegistry,
    pairingCodeRegistry,
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
    const url = new URL(req.url ?? '/', `wss://${req.headers.host ?? 'localhost'}`)
    const tokenFromUrl = url.searchParams.get('token') ?? url.searchParams.get('access_token')
    const deviceId = url.searchParams.get('device_id') || 'default'
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

    log.info('WS connected', { userId: identity.userId, deviceId })

    ws.on('pong', () => wsManager.onPong(ws))

    wsManager.handleConnection(ws, identity, deviceId)

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
