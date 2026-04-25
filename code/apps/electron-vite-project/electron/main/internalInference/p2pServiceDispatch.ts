/**
 * Inbound /beap/ingest branch for internal inference service RPC (no inbox, direct-only).
 */

import type http from 'http'
import { getHandshakeRecord } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import type { InternalHostInferenceMessage } from '../llm/internalHostInferenceOllama'
import { getInstanceId, isHostMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { InternalInferenceErrorCode } from './errors'
import { buildInternalInferenceCapabilitiesResult } from './hostInferenceCapabilities'
import * as hostInference from './hostInferenceExecute'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { postServiceEnvelopeDirect } from './directSend'
import { logInternalInferenceEvent, endpointHostOnly } from './logging'
import { resolveInternalInferenceByRequestId, type PendingResult } from './pendingRequests'
import {
  assertHostReceivesRequestFromSandbox,
  assertHostSendsResultToSandbox,
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertSandboxReceivesResultFromHost,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from './policy'
import {
  INTERNAL_INFERENCE_SCHEMA_VERSION,
  type InternalInferenceErrorWire,
  type InternalInferenceRequestWire,
  type InternalInferenceResultWire,
} from './types'

function jsonError(res: http.ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ code, message }))
}

function isServiceType(
  t: unknown,
): t is
  | InternalInferenceRequestWire['type']
  | InternalInferenceResultWire['type']
  | 'internal_inference_error'
  | 'internal_inference_capabilities_request' {
  return (
    t === 'internal_inference_request' ||
    t === 'internal_inference_result' ||
    t === 'internal_inference_error' ||
    t === 'internal_inference_capabilities_request'
  )
}

function validBaseFields(
  p: Record<string, unknown>,
): p is { request_id: string; handshake_id: string; sender_device_id: string; target_device_id: string; schema_version: number; created_at: string } {
  return (
    typeof p.request_id === 'string' &&
    p.request_id.trim().length > 0 &&
    typeof p.handshake_id === 'string' &&
    p.handshake_id.trim().length > 0 &&
    typeof p.sender_device_id === 'string' &&
    p.sender_device_id.trim().length > 0 &&
    typeof p.target_device_id === 'string' &&
    p.target_device_id.trim().length > 0 &&
    typeof p.schema_version === 'number' &&
    Number.isFinite(p.schema_version) &&
    typeof p.created_at === 'string' &&
    p.created_at.trim().length > 0
  )
}

function tryParseInternalInferenceRequest(
  parsed: Record<string, unknown>,
):
  | { ok: true; value: { messages: InternalHostInferenceMessage[]; model?: string; options?: { temperature?: number; max_tokens?: number }; expiresAt: number } }
  | { ok: false } {
  if (typeof parsed.expires_at !== 'string' || !parsed.expires_at.trim()) {
    return { ok: false }
  }
  const exp = Date.parse(parsed.expires_at)
  if (Number.isNaN(exp)) {
    return { ok: false }
  }
  const messages = parsed.messages
  if (!Array.isArray(messages) || messages.length < 1) {
    return { ok: false }
  }
  const out: InternalHostInferenceMessage[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      return { ok: false }
    }
    const o = m as Record<string, unknown>
    if (o.role !== 'system' && o.role !== 'user' && o.role !== 'assistant') {
      return { ok: false }
    }
    if (typeof o.content !== 'string') {
      return { ok: false }
    }
    out.push({ role: o.role, content: o.content })
  }
  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : undefined
  let options: { temperature?: number; max_tokens?: number } | undefined
  if (parsed.options && typeof parsed.options === 'object' && !Array.isArray(parsed.options)) {
    const op = parsed.options as Record<string, unknown>
    const next: { temperature?: number; max_tokens?: number } = {}
    if (typeof op.temperature === 'number' && Number.isFinite(op.temperature)) {
      next.temperature = op.temperature
    }
    if (typeof op.max_tokens === 'number' && Number.isFinite(op.max_tokens) && op.max_tokens > 0) {
      next.max_tokens = Math.floor(op.max_tokens)
    }
    if (Object.keys(next).length > 0) {
      options = next
    }
  }
  return { ok: true, value: { messages: out, model, options, expiresAt: exp } }
}

/**
 * @returns true if the response was fully handled (service RPC)
 */
export async function tryHandleInternalServiceP2P(
  db: any,
  parsed: Record<string, unknown>,
  res: http.ServerResponse,
): Promise<boolean> {
  const t = parsed.type
  if (!isServiceType(t)) {
    return false
  }
  if (!validBaseFields(parsed)) {
    jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing required service fields')
    return true
  }
  if (parsed.schema_version !== INTERNAL_INFERENCE_SCHEMA_VERSION) {
    jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'unsupported schema_version')
    return true
  }

  const handshakeId = (parsed.handshake_id as string).trim()
  const record = getHandshakeRecord(db, handshakeId)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    jsonError(res, 403, ar.code, 'policy')
    return true
  }
  const r: HandshakeRecord = ar.record

  if (t === 'internal_inference_capabilities_request') {
    if (!isHostMode()) {
      jsonError(res, 400, InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED, 'capabilities on non-host')
      return true
    }
    const h = assertHostReceivesRequestFromSandbox(r, (parsed as { sender_device_id: string }).sender_device_id)
    if (!h.ok) {
      jsonError(res, 403, h.code, 'policy')
      return true
    }
    const localId = localCoordinationDeviceId(r) ?? ''
    const capTarget = (parsed as { target_device_id: string }).target_device_id.trim()
    if (!localId || localId !== capTarget) {
      jsonError(res, 403, InternalInferenceErrorCode.POLICY_FORBIDDEN, 'target_device_id mismatch')
      return true
    }
    const directCap = assertP2pEndpointDirect(db, r.p2p_endpoint)
    if (!directCap.ok) {
      jsonError(res, 503, directCap.code, 'direct peer URL required')
      return true
    }
    const hsCap = assertHostSendsResultToSandbox(r)
    if (!hsCap.ok) {
      jsonError(res, 500, hsCap.code, 'internal')
      return true
    }
    const capReq = parsed as { request_id: string; created_at: string }
    console.log(
      `[INTERNAL_INFERENCE_CAPABILITIES] request handshake_id=${r.handshake_id} request_id=${capReq.request_id}`,
    )
    const capWire = await buildInternalInferenceCapabilitiesResult(r, {
      request_id: capReq.request_id,
      created_at: capReq.created_at,
    })
    console.log(
      `[INTERNAL_INFERENCE_CAPABILITIES] result handshake_id=${r.handshake_id} models=${capWire.models.length} policy_enabled=${capWire.policy_enabled}`,
    )
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(capWire))
    return true
  }

  if (t === 'internal_inference_request') {
    if (!isHostMode()) {
      jsonError(res, 400, InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED, 'request on non-host')
      return true
    }
    const h = assertHostReceivesRequestFromSandbox(r, (parsed as InternalInferenceRequestWire).sender_device_id)
    if (!h.ok) {
      jsonError(res, 403, h.code, 'policy')
      return true
    }
    const localId = localCoordinationDeviceId(r) ?? ''
    const targetId = (parsed as InternalInferenceRequestWire).target_device_id.trim()
    if (!localId || localId !== targetId) {
      jsonError(res, 403, InternalInferenceErrorCode.POLICY_FORBIDDEN, 'target_device_id mismatch')
      return true
    }

    const direct = assertP2pEndpointDirect(db, r.p2p_endpoint)
    if (!direct.ok) {
      jsonError(
        res,
        503,
        direct.code,
        'direct peer URL required',
      )
      return true
    }
    const epCheck = r.p2p_endpoint?.trim() ?? ''
    const wireReq = tryParseInternalInferenceRequest(parsed)
    if (!wireReq.ok) {
      jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'invalid request body')
      return true
    }

    const tStart = Date.now()
    const peerId = peerCoordinationDeviceId(r) ?? ''
    const hostId = getInstanceId()
    const requestId = (parsed as InternalInferenceRequestWire).request_id

    const ctxBase = {
      requestId,
      handshakeId: r.handshake_id,
      hostDeviceId: hostId,
      peerDeviceId: peerId,
    }

    const policy = getHostInternalInferencePolicy()
    const promptBytes = Buffer.byteLength(JSON.stringify(wireReq.value.messages), 'utf8')
    if (Date.now() > wireReq.value.expiresAt) {
      const errWire: InternalInferenceErrorWire = hostInference.buildHostInferenceErrorWire(
        ctxBase,
        InternalInferenceErrorCode.REQUEST_EXPIRED,
        'expired',
        tStart,
      )
      return finishHostInferencePost(
        res,
        errWire,
        'internal_inference_error',
        r,
        epCheck,
        {
          request_id: requestId,
          handshake_id: r.handshake_id,
          model: undefined,
          prompt_bytes: promptBytes,
          message_count: wireReq.value.messages.length,
          error_code: InternalInferenceErrorCode.REQUEST_EXPIRED,
          duration_ms: errWire.duration_ms,
        },
      )
    }
    if (promptBytes > policy.maxPromptBytes) {
      const errWire: InternalInferenceErrorWire = hostInference.buildHostInferenceErrorWire(
        ctxBase,
        InternalInferenceErrorCode.PAYLOAD_TOO_LARGE,
        'too large',
        tStart,
      )
      return finishHostInferencePost(
        res,
        errWire,
        'internal_inference_error',
        r,
        epCheck,
        {
          request_id: requestId,
          handshake_id: r.handshake_id,
          model: undefined,
          prompt_bytes: promptBytes,
          message_count: wireReq.value.messages.length,
          error_code: InternalInferenceErrorCode.PAYLOAD_TOO_LARGE,
          duration_ms: errWire.duration_ms,
        },
      )
    }

    const hs = assertHostSendsResultToSandbox(r)
    if (!hs.ok) {
      jsonError(res, 500, hs.code, 'internal')
      return true
    }

    const { wire, log: infLog } = await hostInference.runHostInternalInference({
      handshakeId: r.handshake_id,
      requestId,
      modelRequested: wireReq.value.model,
      messages: wireReq.value.messages,
      options: wireReq.value.options,
      peerDeviceId: peerId,
      hostDeviceId: hostId,
    })
    if (wire.type === 'internal_inference_error') {
      return finishHostInferencePost(
        res,
        wire,
        'internal_inference_error',
        r,
        epCheck,
        {
          request_id: requestId,
          handshake_id: r.handshake_id,
          model: infLog.model,
          prompt_bytes: infLog.prompt_bytes,
          message_count: infLog.message_count,
          error_code: infLog.error_code,
          duration_ms: wire.duration_ms,
        },
      )
    }
    return finishHostInferencePost(
      res,
      wire,
      'internal_inference_result',
      r,
      epCheck,
      {
        request_id: requestId,
        handshake_id: r.handshake_id,
        model: infLog.model,
        prompt_bytes: infLog.prompt_bytes,
        message_count: infLog.message_count,
        duration_ms: wire.duration_ms,
      },
    )
  }

  if (t === 'internal_inference_result' || t === 'internal_inference_error') {
    if (!isSandboxMode()) {
      jsonError(res, 400, InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED, 'not sandbox')
      return true
    }
    const s = assertSandboxReceivesResultFromHost(r, (parsed as { sender_device_id: string }).sender_device_id)
    if (!s.ok) {
      jsonError(res, 403, s.code, 'policy')
      return true
    }
    const localSandboxId = localCoordinationDeviceId(r) ?? ''
    if (!localSandboxId || localSandboxId !== (parsed as { target_device_id: string }).target_device_id.trim()) {
      jsonError(res, 403, InternalInferenceErrorCode.POLICY_FORBIDDEN, 'target_device_id mismatch')
      return true
    }
    const requestId = (parsed as { request_id: string }).request_id
    if (t === 'internal_inference_result') {
      const out = (parsed as { output?: string }).output
      if (typeof out !== 'string') {
        jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing output')
        return true
      }
      const model = (parsed as { model?: string }).model
      const duration_ms = (parsed as { duration_ms?: number }).duration_ms
      const pr: PendingResult = {
        kind: 'result',
        output: out,
        ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
        ...(typeof duration_ms === 'number' && Number.isFinite(duration_ms) ? { duration_ms } : {}),
      }
      resolveInternalInferenceByRequestId(requestId, pr)
    } else {
      const code = (parsed as { code?: string }).code
      const message = (parsed as { message?: string }).message
      if (typeof code !== 'string' || typeof message !== 'string') {
        jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing error fields')
        return true
      }
      resolveInternalInferenceByRequestId(requestId, { kind: 'error', code, message })
    }
    const meta: Parameters<typeof logInternalInferenceEvent>[1] = {
      request_id: requestId,
      handshake_id: r.handshake_id,
      sender_device_id: (parsed as { sender_device_id: string }).sender_device_id,
      target_device_id: (parsed as { target_device_id: string }).target_device_id,
      message_type: t,
      direct_endpoint_host: '(inbound)',
    }
    if (t === 'internal_inference_error') {
      meta.error_code = (parsed as { code?: string }).code
    }
    logInternalInferenceEvent('recv', meta)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ accepted: true }))
    return true
  }

  return false
}

async function finishHostInferencePost(
  res: http.ServerResponse,
  wire: InternalInferenceResultWire | InternalInferenceErrorWire,
  messageType: 'internal_inference_result' | 'internal_inference_error',
  r: HandshakeRecord,
  epCheck: string,
  meta: {
    request_id: string
    handshake_id: string
    model?: string
    prompt_bytes: number
    message_count: number
    error_code?: string
    duration_ms: number
  },
): Promise<boolean> {
  const post = await postServiceEnvelopeDirect(
    wire,
    epCheck,
    r.handshake_id,
    r.counterparty_p2p_token,
    {
      request_id: wire.request_id,
      sender_device_id: wire.sender_device_id,
      target_device_id: wire.target_device_id,
      message_type: messageType,
    },
  )
  if (!post.ok) {
    jsonError(
      res,
      503,
      post.code,
      'failed to deliver to sandbox',
    )
    return true
  }
  logInternalInferenceEvent(
    'complete',
    {
      request_id: meta.request_id,
      handshake_id: meta.handshake_id,
      sender_device_id: wire.sender_device_id,
      target_device_id: wire.target_device_id,
      message_type: messageType,
      direct_endpoint_host: endpointHostOnly(epCheck),
      duration_ms: meta.duration_ms,
      model: meta.model,
      prompt_bytes: meta.prompt_bytes,
      message_count: meta.message_count,
      error_code: meta.error_code,
    },
    epCheck,
  )
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ internal_inference: 'ack', request_id: wire.request_id }))
  return true
}

export function isInternalServiceRpcShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const t = (parsed as Record<string, unknown>).type
  return isServiceType(t)
}
