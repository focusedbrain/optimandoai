/**
 * Inbound /beap/ingest branch for internal inference service RPC (no inbox, direct-only).
 */

import type http from 'http'
import { getHandshakeRecord } from '../handshake/db'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { InternalInferenceErrorCode } from './errors'
import {
  handleInternalInferenceCancel,
  handleInternalInferenceCapabilitiesRequest,
  handleInternalInferenceRequest,
  isValidInternalServiceBaseEnvelope,
  type CoreInferenceHandoff,
  type HostInferenceCoreContext,
  type HostInferenceCoreFailure,
} from './hostInferenceCore'
import { INTERNAL_INFERENCE_SCHEMA_VERSION } from './types'
import { logHostAiInferRequestReceived, logHostAiInferResponseReceived } from './hostAiInferLog'
import { sendHostInferenceResult } from './transport/internalInferenceTransport'
import { logInternalInferenceEvent, endpointHostOnly } from './logging'
import { resolveInternalInferenceByRequestId, type PendingResult } from './pendingRequests'
import {
  assertRecordForServiceRpc,
  assertSandboxReceivesResultFromHost,
  localCoordinationDeviceId,
} from './policy'
import { type InternalInferenceRequestWire, type InternalInferenceResultWire } from './types'
import { hostDirectP2pAdvertisementHeaders } from './p2pEndpointRepair'
import { shouldRejectHttpInternalInferenceRequest } from './p2pInferenceFlags'

function jsonError(res: http.ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ code, message }))
}

function httpStatusForCoreFailure(f: HostInferenceCoreFailure): number {
  if (f.code === InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE) {
    return 400
  }
  if (f.code === InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED) {
    return 400
  }
  if (f.code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE) {
    return 503
  }
  if (f.code === InternalInferenceErrorCode.P2P_INFERENCE_REQUIRED) {
    return 503
  }
  if (f.messageKey === 'host_send_path') {
    return 500
  }
  return 403
}

function isServiceType(
  t: unknown,
): t is
  | InternalInferenceRequestWire['type']
  | InternalInferenceResultWire['type']
  | 'internal_inference_error'
  | 'internal_inference_capabilities_request'
  | 'internal_inference_cancel' {
  return (
    t === 'internal_inference_request' ||
    t === 'internal_inference_result' ||
    t === 'internal_inference_error' ||
    t === 'internal_inference_capabilities_request' ||
    t === 'internal_inference_cancel'
  )
}

function toHttpContext(
  db: any,
  parsed: Record<string, unknown>,
  handshakeId: string,
): HostInferenceCoreContext {
  return {
    transport: 'http_direct',
    handshakeId: handshakeId.trim(),
    senderDeviceId: (parsed as { sender_device_id: string }).sender_device_id.trim(),
    targetDeviceId: (parsed as { target_device_id: string }).target_device_id.trim(),
    authenticated: true,
    requestId: (parsed as { request_id: string }).request_id.trim(),
    now: Date.now(),
    db,
  }
}

export type InternalServiceP2PIngestMeta = {
  /** Sandbox `HOST_AI_STAGE` / probe correlation id (HTTP header `X-BEAP-Host-AI-Chain`). */
  hostAiChain?: string | null
}

/**
 * @returns true if the response was fully handled (service RPC)
 */
export async function tryHandleInternalServiceP2P(
  db: any,
  parsed: Record<string, unknown>,
  res: http.ServerResponse,
  ingestMeta?: InternalServiceP2PIngestMeta,
): Promise<boolean> {
  const t = parsed.type
  if (!isServiceType(t)) {
    return false
  }
  if (!isValidInternalServiceBaseEnvelope(parsed as Record<string, unknown>)) {
    jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing required service fields')
    return true
  }
  if (parsed.schema_version !== INTERNAL_INFERENCE_SCHEMA_VERSION) {
    jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'unsupported schema_version')
    return true
  }

  const handshakeId = (parsed.handshake_id as string).trim()
  const ctx = toHttpContext(db, parsed, handshakeId)

  if (t === 'internal_inference_cancel') {
    const out = handleInternalInferenceCancel(parsed, ctx)
    if (!out.ok) {
      jsonError(res, httpStatusForCoreFailure(out), out.code, out.messageKey)
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          internal_inference: 'cancel_ack',
          request_id: out.responseEnvelope.request_id,
          cancelled: out.responseEnvelope.cancelled,
        }),
      )
    }
    return true
  }

  if (t === 'internal_inference_capabilities_request') {
    const ch = (ingestMeta?.hostAiChain ?? '').trim() || 'none'
    console.log(`[HOST_INFERENCE_CAPS] request_received handshake=${handshakeId} chain=${ch}`)
    const cap = await handleInternalInferenceCapabilitiesRequest(parsed, ctx)
    if (!cap.ok) {
      jsonError(res, httpStatusForCoreFailure(cap), cap.code, cap.messageKey)
      return true
    }
    console.log(`[HOST_INFERENCE_CAPS] response ok handshake=${handshakeId}`)
    const wireModel =
      cap.responseEnvelope.active_local_llm?.model?.trim() || cap.responseEnvelope.active_chat_model?.trim() || null
    const toLog = (m: string | null | undefined) => (m != null && m.length > 0 ? m : 'null')
    const capLocalLlm = cap.responseEnvelope.active_local_llm?.model?.trim() || null
    console.log(`[HOST_INFERENCE_CAPS] active_local_llm model=${toLog(capLocalLlm)}`)
    console.log(`[HOST_INFERENCE_CAPS] response_send active_model=${toLog(wireModel)}`)
    res.writeHead(200, { 'Content-Type': 'application/json', ...hostDirectP2pAdvertisementHeaders(db) })
    res.end(JSON.stringify(cap.responseEnvelope))
    return true
  }

  if (t === 'internal_inference_request') {
    if (shouldRejectHttpInternalInferenceRequest()) {
      jsonError(
        res,
        503,
        InternalInferenceErrorCode.P2P_INFERENCE_REQUIRED,
        'Internal inference on HTTP is disabled; use P2P DataChannel, or set WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1 for legacy clients.',
      )
      return true
    }
    const rid = (parsed as { request_id: string }).request_id?.trim() ?? ''
    if (rid) {
      logHostAiInferRequestReceived({ handshakeId, requestId: rid, transport: 'http' })
    }
    const inf = await handleInternalInferenceRequest(parsed, ctx)
    if (!inf.ok) {
      jsonError(res, httpStatusForCoreFailure(inf), inf.code, inf.messageKey)
      return true
    }
    return finishHostInferencePost(db, res, inf.responseEnvelope)
  }

  if (t === 'internal_inference_result' || t === 'internal_inference_error') {
    if (!isSandboxMode()) {
      jsonError(res, 400, InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED, 'not sandbox')
      return true
    }
    const rec = getHandshakeRecord(db, handshakeId)
    const ar = assertRecordForServiceRpc(rec)
    if (!ar.ok) {
      jsonError(res, 403, ar.code, 'policy')
      return true
    }
    const r = ar.record
    const s = assertSandboxReceivesResultFromHost(r, (parsed as { sender_device_id: string }).sender_device_id)
    if (!s.ok) {
      jsonError(res, 403, s.code, 'policy')
      return true
    }
    const localSandboxId = localCoordinationDeviceId(r) ?? ''
    if (!localSandboxId || localSandboxId !== (parsed as { target_device_id: string }).target_device_id.trim()) {
      jsonError(res, 403, InternalInferenceErrorCode.POLICY_FORBIDDEN, 'policy')
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
      if (resolveInternalInferenceByRequestId(requestId, pr)) {
        logHostAiInferResponseReceived({ handshakeId: r.handshake_id, requestId, transport: 'http' })
      }
    } else {
      const code = (parsed as { code?: string }).code
      const message = (parsed as { message?: string }).message
      if (typeof code !== 'string' || typeof message !== 'string') {
        jsonError(res, 400, InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing error fields')
        return true
      }
      if (resolveInternalInferenceByRequestId(requestId, { kind: 'error', code, message })) {
        logHostAiInferResponseReceived({ handshakeId: r.handshake_id, requestId, transport: 'http' })
      }
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
  db: any,
  res: http.ServerResponse,
  handoff: CoreInferenceHandoff,
): Promise<boolean> {
  const { record: r, targetEndpoint: epCheck, messageType, wire, log: meta } = handoff
  const post = await sendHostInferenceResult(
    r.handshake_id,
    wire,
    { record: r, targetEndpoint: epCheck },
    messageType,
  )
  if (!post.ok) {
    jsonError(res, 503, post.code, 'failed to deliver to sandbox')
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
  res.writeHead(200, { 'Content-Type': 'application/json', ...hostDirectP2pAdvertisementHeaders(db) })
  res.end(JSON.stringify({ internal_inference: 'ack', request_id: wire.request_id }))
  return true
}

export function isInternalServiceRpcShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const t = (parsed as Record<string, unknown>).type
  return isServiceType(t)
}
