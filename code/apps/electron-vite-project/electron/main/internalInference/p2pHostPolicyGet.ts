/**
 * GET /beap/internal-inference-policy — Host only; same auth as ingest (Bearer + X-BEAP-Handshake).
 * Returns policy + **live** Ollama model metadata for the paired Sandbox (direct P2P only — not relayed).
 */

import os from 'os'
import type http from 'http'
import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import {
  checkAuthFailLimit,
  checkIpLimit,
  recordAuthFailure,
  isClientIpPrivateLan,
  IP_LIMIT_PUBLIC,
  IP_LIMIT_PRIVATE_LAN,
} from '../p2p/rateLimiter'
import { logHostAiRoleGate } from './hostAiRoleGateLog'
import {
  assertHostSendsResultToSandbox,
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
} from './policy'
import { getCanonHandshakeDbForHostAiPolicy } from './dbAccess'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { resolveHostAiRemoteInferencePolicy } from './hostAiRemoteInferencePolicyResolve'
import { InternalInferenceErrorCode } from './errors'
import { ollamaManager } from '../llm/ollama-manager'
import { hostDirectP2pAdvertisementHeaders } from './p2pEndpointRepair'
import {
  logBeapIngressReceived,
  logP2pBeapRejection,
  readBeapCorrelationIdFromIncoming,
  readBeapHandshakeHintFromIncoming,
} from '../p2p/beapIngressLog'

/** 6-digit internal pairing id for this Host↔Sandbox internal handshake (display + raw digits). */
function formatInternalIdentifier6(raw: string | null | undefined): { digits6: string; display: string } {
  const s = (raw ?? '').replace(/\D/g, '')
  if (s.length === 6) {
    return { digits6: s, display: `${s.slice(0, 3)}-${s.slice(3)}` }
  }
  return { digits6: '', display: s ? s : '—' }
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim()
  return req.socket?.remoteAddress ?? '0.0.0.0'
}

/**
 * Serves allowSandboxInference for authenticated internal Host↔Sandbox handshakes.
 */
export async function handleGetInternalInferencePolicy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  getDb: () => any,
): Promise<void> {
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

  const h = assertHostSendsResultToSandbox(ar.record)
  if (!h.ok) {
    const id0 = getInstanceId().trim()
    const dr = deriveInternalHostAiPeerRoles(ar.record, id0)
    logHostAiRoleGate({
      handshake_id: handshakeId,
      request_type: 'get_internal_inference_policy',
      current_device_id: id0,
      endpoint_owner_device_id: dr.ok ? dr.localCoordinationDeviceId : coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') || id0,
      requester_device_id: '',
      local_derived_role: dr.ok ? dr.localRole : 'unknown',
      peer_derived_role: dr.ok ? dr.peerRole : 'unknown',
      receiver_role: dr.ok ? dr.localRole : 'unknown',
      requester_role: dr.ok ? dr.peerRole : 'unknown',
      configured_mode: '',
      decision: 'deny',
      reason: 'forbidden_host_role',
    })
    logP2pBeapRejection({ ip, status: 403, reason: 'forbidden_host_role', handshakeId, correlationId: beapCorr })
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }

  const hostPolicy = getHostInternalInferencePolicy()
  const policyDb = (await getCanonHandshakeDbForHostAiPolicy(db)) as typeof db
  const policyRes = resolveHostAiRemoteInferencePolicy(policyDb)
  const allowSandboxInference = policyRes.allowRemoteInference
  const hostRec = ar.record
  const { digits6: internalIdentifier6, display: internalIdentifierDisplay } = formatInternalIdentifier6(
    hostRec.internal_peer_pairing_code,
  )
  const { deviceName: orchName } = getOrchestratorMode()
  const hostComputerName = (orchName || '').trim() || os.hostname()

  let defaultChatModel: string | undefined
  if (allowSandboxInference) {
    try {
      const { resolveModelForInternalInference } = await import('../llm/internalHostInferenceOllama')
      const allow = hostPolicy.modelAllowlist ?? []
      let resolved = await resolveModelForInternalInference(undefined, allow)
      if (!('model' in resolved)) {
        const st = await ollamaManager.getStatus()
        const active = st.activeModel?.trim()
        const nameSet = new Set((await ollamaManager.listModels()).map((x) => x.name))
        if (active && nameSet.has(active) && (allow.length === 0 || allow.includes(active))) {
          resolved = { model: active }
        }
      }
      if ('model' in resolved) {
        defaultChatModel = resolved.model
      }
    } catch {
      /* Ollama stopped or no models */
    }
  }

  const modelId = defaultChatModel?.trim() ? defaultChatModel.trim() : null
  const inferenceErrorCode =
    allowSandboxInference && !modelId ? InternalInferenceErrorCode.MODEL_UNAVAILABLE : undefined
  const displayLabel = !allowSandboxInference
    ? 'Host AI'
    : modelId
      ? `Host AI · ${modelId}`
      : 'Host AI · —'

  res.writeHead(200, { 'Content-Type': 'application/json', ...hostDirectP2pAdvertisementHeaders(policyDb) })
  res.end(
    JSON.stringify({
      allowSandboxInference,
      defaultChatModel,
      // ── STEP 6: model + Host metadata (MVP: live active / allowlist-resolved Ollama model per GET) ──
      provider: 'ollama' as const,
      modelId,
      displayLabel,
      hostComputerName,
      hostOrchestratorRole: 'host' as const,
      hostOrchestratorRoleLabel: 'Host orchestrator' as const,
      internalIdentifier6,
      internalIdentifierDisplay,
      /** Caller reached Host over direct P2P (this endpoint is not exposed on relay-only routes). */
      directReachable: true,
      policyEnabled: allowSandboxInference,
      inferenceErrorCode,
    }),
  )
}
