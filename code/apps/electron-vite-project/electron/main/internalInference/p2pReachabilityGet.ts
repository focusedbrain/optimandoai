/**
 * GET /beap/p2p-reachability — direct P2P only; same auth as ingest (Bearer + X-BEAP-Handshake).
 * No request body. Returns JSON { ok: true } when the peer is allowed to use this endpoint for reachability.
 */

import type http from 'http'
import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId, isHostMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import {
  checkAuthFailLimit,
  checkIpLimit,
  recordAuthFailure,
  isClientIpPrivateLan,
  IP_LIMIT_PUBLIC,
  IP_LIMIT_PRIVATE_LAN,
} from '../p2p/rateLimiter'
import { logHostAiPairingRoleGate } from './hostAiPairingRoleGateLog'
import {
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  assertHostSendsResultToSandbox,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
} from './policy'
import {
  logBeapIngressReceived,
  logP2pBeapRejection,
  readBeapCorrelationIdFromIncoming,
  readBeapHandshakeHintFromIncoming,
} from '../p2p/beapIngressLog'

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim()
  return req.socket?.remoteAddress ?? '0.0.0.0'
}

export async function handleGetP2PReachability(req: http.IncomingMessage, res: http.ServerResponse, getDb: () => any): Promise<void> {
  const ip = getClientIp(req)
  const beapCorr = readBeapCorrelationIdFromIncoming(req)
  const handshakeHint = readBeapHandshakeHintFromIncoming(req)
  logBeapIngressReceived({ ip, corr: beapCorr, handshakeHint })
  const ipLimit = isClientIpPrivateLan(ip) ? IP_LIMIT_PRIVATE_LAN : IP_LIMIT_PUBLIC

  if (!checkIpLimit(ip, ipLimit)) {
    logP2pBeapRejection({ ip, status: 429, reason: 'ip_rate_limit', handshakeId: null, correlationId: beapCorr })
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Too many requests' }))
    return
  }
  if (!checkAuthFailLimit(ip)) {
    logP2pBeapRejection({ ip, status: 429, reason: 'auth_rate_limit', handshakeId: null, correlationId: beapCorr })
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Too many requests' }))
    return
  }

  const hRaw = req.headers['x-beap-handshake']
  const handshakeId = typeof hRaw === 'string' ? hRaw.trim() : ''
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null

  if (!handshakeId || !token) {
    logP2pBeapRejection({ ip, status: 401, reason: 'missing_auth_headers', handshakeId: handshakeId || null, correlationId: beapCorr })
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (!isHostMode() && !isSandboxMode()) {
    logP2pBeapRejection({ ip, status: 503, reason: 'orchestrator_unavailable', handshakeId, correlationId: beapCorr })
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Service unavailable' }))
    return
  }

  const db = getDb()
  if (!db) {
    logP2pBeapRejection({ ip, status: 503, reason: 'vault_locked', handshakeId, correlationId: beapCorr })
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Service unavailable' }))
    return
  }

  const record = getHandshakeRecord(db, handshakeId)
  const expected = record?.counterparty_p2p_token ?? null
  if (!expected || token !== expected) {
    recordAuthFailure(ip)
    logP2pBeapRejection({ ip, status: 401, reason: 'auth_failure', handshakeId, correlationId: beapCorr })
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    logP2pBeapRejection({ ip, status: 403, reason: 'forbidden_record', handshakeId, correlationId: beapCorr })
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }

  const id0 = getInstanceId().trim()
  const drR = deriveInternalHostAiPeerRoles(ar.record, id0)
  if (drR.ok && drR.localRole === 'host' && drR.peerRole === 'sandbox') {
    const h = assertHostSendsResultToSandbox(ar.record)
    if (!h.ok) {
      const dr = deriveInternalHostAiPeerRoles(ar.record, id0)
      logHostAiPairingRoleGate({
        gate: 'inference_rpc',
        handshake_id: handshakeId,
        request_type: 'get_p2p_reachability',
        current_device_id: id0,
        sender_device_id: '',
        receiver_device_id: dr.ok ? dr.localCoordinationDeviceId : coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') || id0,
        local_derived_role: dr.ok ? dr.localRole : 'unknown',
        peer_derived_role: dr.ok ? dr.peerRole : 'unknown',
        receiver_role: dr.ok ? dr.localRole : 'unknown',
        requester_role: dr.ok ? dr.peerRole : 'unknown',
        orchestrator_mode_hint: '',
        decision: 'deny',
        reason: 'forbidden_host_role',
      })
      logP2pBeapRejection({ ip, status: 403, reason: 'forbidden_host_role', handshakeId, correlationId: beapCorr })
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Forbidden' }))
      return
    }
  } else if (drR.ok && drR.localRole === 'sandbox' && drR.peerRole === 'host') {
    const s = assertSandboxRequestToHost(ar.record)
    if (!s.ok) {
      logP2pBeapRejection({ ip, status: 403, reason: 'forbidden_sandbox_role', handshakeId, correlationId: beapCorr })
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Forbidden' }))
      return
    }
  } else {
    logP2pBeapRejection({ ip, status: 403, reason: 'forbidden_internal_role', handshakeId, correlationId: beapCorr })
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, p2p_reachability: true }))
}
