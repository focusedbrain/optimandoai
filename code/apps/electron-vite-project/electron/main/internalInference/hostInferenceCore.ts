/**
 * Reusable Host-side internal inference logic (direct HTTP or future P2P DataChannel).
 * No `http` types — normalized outcomes only. Does not return raw stack traces or provider bodies to peers.
 */

import { getHandshakeRecord } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import type { InternalHostInferenceMessage } from '../llm/internalHostInferenceOllama'
import { getInstanceId, isHostMode } from '../orchestrator/orchestratorModeStore'
import { InternalInferenceErrorCode } from './errors'
import { buildInternalInferenceCapabilitiesResult } from './hostInferenceCapabilities'
import * as hostInference from './hostInferenceExecute'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { tryConsumePerHandshakeInferenceSlot } from './hostInferenceRequestRateLimit'
import { rejectInternalInferenceByRequestId } from './pendingRequests'
import {
  assertHostReceivesRequestFromSandbox,
  assertHostSendsResultToSandbox,
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from './policy'
import {
  INTERNAL_INFERENCE_SCHEMA_VERSION,
  type InternalInferenceErrorWire,
  type InternalInferenceRequestWire,
  type InternalInferenceResultWire,
  type InternalInferenceCapabilitiesResultWire,
} from './types'

export type HostInferenceTransport = 'http_direct' | 'webrtc_p2p'

/** Caller supplies identity / timing; `db` is used for handshake and P2P endpoint policy. */
export type HostInferenceCoreContext = {
  transport: HostInferenceTransport
  handshakeId: string
  senderDeviceId: string
  targetDeviceId: string
  /** True when the transport layer has authenticated the peer (e.g. BEAP + bearer on ingest). */
  authenticated: boolean
  requestId: string
  now: number
  db: any
}

export type HostInferenceCoreFailure = {
  ok: false
  code: string
  retryable: boolean
  messageKey: string
}

function retryableForCode(code: string): boolean {
  return (
    code === InternalInferenceErrorCode.PROVIDER_BUSY ||
    code === InternalInferenceErrorCode.PROVIDER_TIMEOUT ||
    code === InternalInferenceErrorCode.OLLAMA_UNAVAILABLE ||
    code === InternalInferenceErrorCode.RATE_LIMITED
  )
}

function fail(code: string, messageKey: string): HostInferenceCoreFailure {
  return { ok: false, code, retryable: retryableForCode(code), messageKey }
}

export function isValidInternalServiceBaseEnvelope(
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

export function tryParseInternalInferenceRequest(
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

type InferenceDeliveryMeta = {
  request_id: string
  handshake_id: string
  model?: string
  prompt_bytes: number
  message_count: number
  error_code?: string
  duration_ms: number
}

export type CoreInferenceHandoff = {
  kind: 'inference'
  messageType: 'internal_inference_result' | 'internal_inference_error'
  wire: InternalInferenceResultWire | InternalInferenceErrorWire
  record: HandshakeRecord
  targetEndpoint: string
  log: InferenceDeliveryMeta
  db: any
}

export type HostInferenceCoreCapabilitiesSuccess = { ok: true; responseEnvelope: InternalInferenceCapabilitiesResultWire }
export type HostInferenceCoreInferenceSuccess = { ok: true; responseEnvelope: CoreInferenceHandoff }
export type HostInferenceCoreCancelSuccess = {
  ok: true
  responseEnvelope: { kind: 'cancel_ack'; cancelled: boolean; request_id: string }
}

function assertNotAuthenticated(ctx: HostInferenceCoreContext): HostInferenceCoreFailure | null {
  if (!ctx.authenticated) {
    return fail(InternalInferenceErrorCode.POLICY_FORBIDDEN, 'not_authenticated')
  }
  return null
}

/**
 * assertRecordForServiceRpc: internal, ACTIVE, same principal, identity complete, not repair.
 */
function loadServiceRecord(
  db: any,
  handshakeId: string,
): { ok: true; record: HandshakeRecord } | { ok: false; err: HostInferenceCoreFailure } {
  const rec = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(rec)
  if (!ar.ok) {
    return { ok: false, err: fail(ar.code, 'handshake_unavailable') }
  }
  return { ok: true, record: ar.record }
}

function assertHostInbound(
  r: HandshakeRecord,
  senderDeviceId: string,
  targetDeviceId: string,
): HostInferenceCoreFailure | null {
  if (!isHostMode()) {
    return fail(InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED, 'not_host')
  }
  const h = assertHostReceivesRequestFromSandbox(r, senderDeviceId)
  if (!h.ok) {
    return fail(h.code, 'role_or_peer_mismatch')
  }
  const localId = (localCoordinationDeviceId(r) ?? '').trim()
  if (!localId || localId !== targetDeviceId.trim()) {
    return fail(InternalInferenceErrorCode.POLICY_FORBIDDEN, 'target_mismatch')
  }
  return null
}

/**
 * `internal_inference_capabilities_request` on Host: metadata only, reflects policy in wire (policy_enabled may be false).
 */
export async function handleInternalInferenceCapabilitiesRequest(
  envelope: Record<string, unknown>,
  ctx: HostInferenceCoreContext,
): Promise<HostInferenceCoreCapabilitiesSuccess | HostInferenceCoreFailure> {
  if (!isValidInternalServiceBaseEnvelope(envelope)) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing_fields')
  }
  if (envelope.schema_version !== INTERNAL_INFERENCE_SCHEMA_VERSION) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'unsupported_schema')
  }
  if ((envelope as { type: string }).type !== 'internal_inference_capabilities_request') {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'wrong_type')
  }
  const a = assertNotAuthenticated(ctx)
  if (a) return a

  const recResult = loadServiceRecord(ctx.db, envelope.handshake_id as string)
  if (!recResult.ok) return recResult.err

  const hErr = assertHostInbound(
    recResult.record,
    ctx.senderDeviceId,
    (envelope as { target_device_id: string }).target_device_id.trim(),
  )
  if (hErr) return hErr

  const direct = assertP2pEndpointDirect(ctx.db, recResult.record.p2p_endpoint)
  if (!direct.ok) {
    return fail(direct.code, 'no_direct_p2p')
  }
  const hs = assertHostSendsResultToSandbox(recResult.record)
  if (!hs.ok) {
    return fail(hs.code, 'host_send_path')
  }

  const capReq = envelope as { request_id: string; created_at: string }
  const capWire = await buildInternalInferenceCapabilitiesResult(recResult.record, {
    request_id: capReq.request_id,
    created_at: capReq.created_at,
  })
  return { ok: true, responseEnvelope: capWire }
}

/**
 * `internal_inference_request` on Host: run local inference and hand off result wire for delivery to Sandbox.
 */
export async function handleInternalInferenceRequest(
  envelope: Record<string, unknown>,
  ctx: HostInferenceCoreContext,
): Promise<HostInferenceCoreInferenceSuccess | HostInferenceCoreFailure> {
  if (!isValidInternalServiceBaseEnvelope(envelope)) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing_fields')
  }
  if (envelope.schema_version !== INTERNAL_INFERENCE_SCHEMA_VERSION) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'unsupported_schema')
  }
  if ((envelope as { type: string }).type !== 'internal_inference_request') {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'wrong_type')
  }
  const a = assertNotAuthenticated(ctx)
  if (a) return a

  const recResult = loadServiceRecord(ctx.db, envelope.handshake_id as string)
  if (!recResult.ok) return recResult.err

  const hErr = assertHostInbound(
    recResult.record,
    (envelope as InternalInferenceRequestWire).sender_device_id,
    (envelope as InternalInferenceRequestWire).target_device_id.trim(),
  )
  if (hErr) return hErr

  const direct = assertP2pEndpointDirect(ctx.db, recResult.record.p2p_endpoint)
  if (!direct.ok) {
    return fail(direct.code, 'no_direct_p2p')
  }
  // Policy allow/disabled is applied inside `runHostInternalInference` (error wire to Sandbox), not a core reject.

  const epCheck = recResult.record.p2p_endpoint?.trim() ?? ''
  const wireReq = tryParseInternalInferenceRequest(envelope)
  if (!wireReq.ok) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'invalid_request_body')
  }

  const tStart = ctx.now
  const r = recResult.record
  const requestId = (envelope as InternalInferenceRequestWire).request_id
  const peerId = peerCoordinationDeviceId(r) ?? ''
  const hostId = getInstanceId()
  const ctxBase = { requestId, handshakeId: r.handshake_id, hostDeviceId: hostId, peerDeviceId: peerId }
  const policy = getHostInternalInferencePolicy()
  if (!tryConsumePerHandshakeInferenceSlot(r.handshake_id, policy.maxRequestsPerHandshakePerMinute)) {
    const errWire: InternalInferenceErrorWire = hostInference.buildHostInferenceErrorWire(
      ctxBase,
      InternalInferenceErrorCode.RATE_LIMITED,
      'rate limited',
      tStart,
    )
    const promptBytes = Buffer.byteLength(JSON.stringify(wireReq.value.messages), 'utf8')
    return {
      ok: true,
      responseEnvelope: {
        kind: 'inference',
        messageType: 'internal_inference_error',
        wire: errWire,
        record: r,
        targetEndpoint: epCheck,
        log: {
          request_id: requestId,
          handshake_id: r.handshake_id,
          model: undefined,
          prompt_bytes: promptBytes,
          message_count: wireReq.value.messages.length,
          error_code: InternalInferenceErrorCode.RATE_LIMITED,
          duration_ms: errWire.duration_ms,
        },
        db: ctx.db,
      },
    }
  }
  const promptBytes = Buffer.byteLength(JSON.stringify(wireReq.value.messages), 'utf8')
  if (ctx.now > wireReq.value.expiresAt) {
    const errWire: InternalInferenceErrorWire = hostInference.buildHostInferenceErrorWire(
      ctxBase,
      InternalInferenceErrorCode.REQUEST_EXPIRED,
      'expired',
      tStart,
    )
    return {
      ok: true,
      responseEnvelope: {
        kind: 'inference',
        messageType: 'internal_inference_error',
        wire: errWire,
        record: r,
        targetEndpoint: epCheck,
        log: {
          request_id: requestId,
          handshake_id: r.handshake_id,
          model: undefined,
          prompt_bytes: promptBytes,
          message_count: wireReq.value.messages.length,
          error_code: InternalInferenceErrorCode.REQUEST_EXPIRED,
          duration_ms: errWire.duration_ms,
        },
        db: ctx.db,
      },
    }
  }
  if (promptBytes > policy.maxPromptBytes) {
    const errWire: InternalInferenceErrorWire = hostInference.buildHostInferenceErrorWire(
      ctxBase,
      InternalInferenceErrorCode.PAYLOAD_TOO_LARGE,
      'too large',
      tStart,
    )
    return {
      ok: true,
      responseEnvelope: {
        kind: 'inference',
        messageType: 'internal_inference_error',
        wire: errWire,
        record: r,
        targetEndpoint: epCheck,
        log: {
          request_id: requestId,
          handshake_id: r.handshake_id,
          model: undefined,
          prompt_bytes: promptBytes,
          message_count: wireReq.value.messages.length,
          error_code: InternalInferenceErrorCode.PAYLOAD_TOO_LARGE,
          duration_ms: errWire.duration_ms,
        },
        db: ctx.db,
      },
    }
  }

  const hs = assertHostSendsResultToSandbox(r)
  if (!hs.ok) {
    return fail(hs.code, 'host_send_path')
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
  return {
    ok: true,
    responseEnvelope: {
      kind: 'inference',
      messageType: wire.type === 'internal_inference_error' ? 'internal_inference_error' : 'internal_inference_result',
      wire,
      record: r,
      targetEndpoint: epCheck,
      log: {
        request_id: requestId,
        handshake_id: r.handshake_id,
        model: infLog.model,
        prompt_bytes: infLog.prompt_bytes,
        message_count: infLog.message_count,
        error_code: wire.type === 'internal_inference_error' ? infLog.error_code : undefined,
        duration_ms: wire.duration_ms,
      },
      db: ctx.db,
    },
  }
}

/**
 * Best-effort cancel: reject Sandbox pending wait if the request_id is still registered.
 * Does not require host inference to be "enabled" in policy (safety for hung requests).
 */
export function handleInternalInferenceCancel(
  envelope: Record<string, unknown>,
  ctx: HostInferenceCoreContext,
): HostInferenceCoreCancelSuccess | HostInferenceCoreFailure {
  if (!isValidInternalServiceBaseEnvelope(envelope)) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'missing_fields')
  }
  if (envelope.schema_version !== INTERNAL_INFERENCE_SCHEMA_VERSION) {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'unsupported_schema')
  }
  if ((envelope as { type?: string }).type !== 'internal_inference_cancel') {
    return fail(InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, 'wrong_type')
  }
  const a = assertNotAuthenticated(ctx)
  if (a) return a

  const recResult = loadServiceRecord(ctx.db, envelope.handshake_id as string)
  if (!recResult.ok) return recResult.err

  const hErr = assertHostInbound(
    recResult.record,
    (envelope as { sender_device_id: string }).sender_device_id,
    (envelope as { target_device_id: string }).target_device_id.trim(),
  )
  if (hErr) return hErr

  const direct = assertP2pEndpointDirect(ctx.db, recResult.record.p2p_endpoint)
  if (!direct.ok) {
    return fail(direct.code, 'no_direct_p2p')
  }

  const rid = (envelope as { request_id: string }).request_id.trim()
  const err = Object.assign(new Error(InternalInferenceErrorCode.REQUEST_CANCELLED), {
    code: InternalInferenceErrorCode.REQUEST_CANCELLED,
  })
  const cancelled = rejectInternalInferenceByRequestId(rid, err)
  return { ok: true, responseEnvelope: { kind: 'cancel_ack', cancelled, request_id: rid } }
}
