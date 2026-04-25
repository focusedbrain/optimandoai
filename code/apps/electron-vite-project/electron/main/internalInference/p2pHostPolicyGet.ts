/**
 * GET /beap/internal-inference-policy — Host only; same auth as ingest (Bearer + X-BEAP-Handshake).
 * Returns policy + **live** Ollama model metadata for the paired Sandbox (direct P2P only — not relayed).
 */

import os from 'os'
import type http from 'http'
import { getHandshakeRecord } from '../handshake/db'
import { isHostMode, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { checkAuthFailLimit, checkIpLimit, recordAuthFailure } from '../p2p/rateLimiter'
import { assertHostSendsResultToSandbox, assertRecordForServiceRpc } from './policy'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { InternalInferenceErrorCode } from './errors'
import { ollamaManager } from '../llm/ollama-manager'

const IP_LIMIT = 30

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

  if (!checkIpLimit(ip, IP_LIMIT)) {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Too many requests' }))
    return
  }
  if (!checkAuthFailLimit(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Too many requests' }))
    return
  }

  const hRaw = req.headers['x-beap-handshake']
  const handshakeId = typeof hRaw === 'string' ? hRaw.trim() : ''
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null

  if (!handshakeId || !token) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (!isHostMode()) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  const db = getDb()
  if (!db) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Service unavailable' }))
    return
  }

  const record = getHandshakeRecord(db, handshakeId)
  const expected = record?.counterparty_p2p_token ?? null
  if (!expected || token !== expected) {
    recordAuthFailure(ip)
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }

  const h = assertHostSendsResultToSandbox(ar.record)
  if (!h.ok) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden' }))
    return
  }

  const hostPolicy = getHostInternalInferencePolicy()
  const { allowSandboxInference } = hostPolicy
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

  res.writeHead(200, { 'Content-Type': 'application/json' })
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
