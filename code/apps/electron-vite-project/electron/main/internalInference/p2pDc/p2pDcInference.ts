/**
 * Phase 7: Host↔Sandbox inference over WebRTC DataChannel (non-streaming, one request / one result).
 * Wire: inference_{request,result,error,cancel} — Ollama stays in main; transport pod only moves bytes.
 */
import { getHandshakeRecord } from '../../handshake/db'
import type { HandshakeRecord } from '../../handshake/types'
import { getInstanceId, isHostMode, isSandboxMode } from '../../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { InternalInferenceErrorCode } from '../errors'
import { buildHostInferenceErrorWire } from '../hostInferenceExecute'
import { handleInternalInferenceCancel, handleInternalInferenceRequest, type HostInferenceCoreContext } from '../hostInferenceCore'
import { logHostAiInferComplete, logHostAiInferError, logHostAiInferRequestReceived, logHostAiInferResponseReceived } from '../hostAiInferLog'
import { getSessionState } from '../p2pSession/p2pInferenceSessionManager'
import { resolveInternalInferenceByRequestId, type PendingResult } from '../pendingRequests'
import {
  assertHostSendsResultToSandbox,
  assertRecordForServiceRpc,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from '../policy'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceErrorWire, type InternalInferenceRequestWire, type InternalInferenceResultWire } from '../types'

const DC_TYPES = {
  request: 'inference_request',
  result: 'inference_result',
  err: 'inference_error',
  cancel: 'inference_cancel',
} as const

const MAX_DC_FRAME_BYTES = 2_000_000

export async function sendHostInferenceRequestOverP2pDataChannel(
  p2pSessionId: string,
  handshakeId: string,
  request: InternalInferenceRequestWire,
): Promise<boolean> {
  const body = {
    schema_version: 1,
    type: DC_TYPES.request,
    request_id: request.request_id,
    handshake_id: request.handshake_id,
    session_id: p2pSessionId,
    sender_device_id: request.sender_device_id,
    target_device_id: request.target_device_id,
    model: request.model,
    stream: false as const,
    messages: request.messages,
    options: request.options,
    created_at: request.created_at,
    expires_at: request.expires_at,
  }
  const te = new TextEncoder().encode(JSON.stringify(body))
  if (te.length > MAX_DC_FRAME_BYTES) {
    return false
  }
  const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
  await webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
  return true
}

export async function sendInternalInferenceWireOverP2pDataChannel(
  p2pSessionId: string,
  handshakeId: string,
  wire: InternalInferenceResultWire | InternalInferenceErrorWire,
): Promise<boolean> {
  let out: Record<string, unknown>
  if (wire.type === 'internal_inference_result') {
    out = {
      schema_version: 1,
      type: DC_TYPES.result,
      request_id: wire.request_id,
      handshake_id: wire.handshake_id,
      model: wire.model,
      output: wire.output,
      duration_ms: wire.duration_ms,
      finish_reason: 'stop' as const,
    }
  } else {
    out = {
      schema_version: 1,
      type: DC_TYPES.err,
      request_id: wire.request_id,
      handshake_id: wire.handshake_id,
      code: wire.code,
    }
  }
  const te = new TextEncoder().encode(JSON.stringify(out))
  if (te.length > MAX_DC_FRAME_BYTES) {
    return false
  }
  const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
  await webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
  return true
}

async function validateHostInboundInferenceDc(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): Promise<
  { ok: true; record: HandshakeRecord; db: NonNullable<Awaited<ReturnType<typeof getHandshakeDbForInternalInference>>> } | { ok: false }
> {
  if (!isHostMode()) {
    return { ok: false }
  }
  const s = getSessionState(handshakeId.trim())
  if (!s?.sessionId || s.sessionId !== p2pSessionId) {
    return { ok: false }
  }
  if (typeof raw.session_id !== 'string' || raw.session_id.trim() !== p2pSessionId) {
    return { ok: false }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false }
  }
  const rec = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(rec)
  if (!ar.ok) {
    return { ok: false }
  }
  const r = ar.record
  if (assertHostSendsResultToSandbox(r).ok !== true) {
    return { ok: false }
  }
  const localHost = (localCoordinationDeviceId(r) ?? '').trim()
  const peerSb = (peerCoordinationDeviceId(r) ?? '').trim()
  if (!localHost || !peerSb) {
    return { ok: false }
  }
  const reqSid = typeof raw.sender_device_id === 'string' ? raw.sender_device_id.trim() : ''
  const reqTgt = typeof raw.target_device_id === 'string' ? raw.target_device_id.trim() : ''
  if (reqSid && reqSid !== peerSb) {
    return { ok: false }
  }
  if (reqTgt && reqTgt !== localHost) {
    return { ok: false }
  }
  return { ok: true, record: r, db }
}

function validateInferenceDcSandboxSession(p2pSessionId: string, handshakeId: string): boolean {
  if (!isSandboxMode()) {
    return false
  }
  return getSessionState(handshakeId.trim())?.sessionId === p2pSessionId
}

function dcRequestToInternalEnvelope(raw: Record<string, unknown>, handshakeId: string): Record<string, unknown> | null {
  const requestId = typeof raw.request_id === 'string' ? raw.request_id.trim() : ''
  if (!requestId) {
    return null
  }
  const en: Record<string, unknown> = {
    type: 'internal_inference_request',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : handshakeId.trim(),
    sender_device_id: raw.sender_device_id,
    target_device_id: raw.target_device_id,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    transport_policy: 'direct_only',
    stream: false,
    messages: raw.messages,
    expires_at: raw.expires_at,
  }
  if (raw.model != null) {
    en.model = raw.model
  }
  if (raw.options != null) {
    en.options = raw.options
  }
  return en
}

export async function handleP2pDcInferenceRequestAsHost(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (raw.type !== DC_TYPES.request) {
    return
  }
  if (raw.stream === true) {
    const rid = typeof raw.request_id === 'string' ? raw.request_id : ''
    logHostAiInferError({ handshakeId: handshakeId.trim(), requestId: rid, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE })
    return
  }
  const t0 = Date.now()
  const v = await validateHostInboundInferenceDc(p2pSessionId, handshakeId, raw)
  if (!v.ok) {
    return
  }
  const envelope = dcRequestToInternalEnvelope(raw, handshakeId.trim())
  if (!envelope) {
    return
  }
  const requestId = String(envelope.request_id ?? '')
  const peer = (peerCoordinationDeviceId(v.record) ?? '').trim()
  const host = getInstanceId()
  logHostAiInferRequestReceived({ handshakeId: handshakeId.trim(), requestId, transport: 'p2p' })
  const ctx: HostInferenceCoreContext = {
    transport: 'webrtc_p2p',
    handshakeId: handshakeId.trim(),
    senderDeviceId: String(envelope.sender_device_id).trim(),
    targetDeviceId: String(envelope.target_device_id).trim(),
    authenticated: true,
    requestId,
    now: t0,
    db: v.db,
  }
  const inf = await handleInternalInferenceRequest(envelope, ctx)
  if (!inf.ok) {
    const errW = buildHostInferenceErrorWire(
      { requestId, handshakeId: handshakeId.trim(), hostDeviceId: host, peerDeviceId: peer },
      inf.code,
      inf.messageKey,
      t0,
    )
    const sent = await sendInternalInferenceWireOverP2pDataChannel(p2pSessionId, handshakeId.trim(), errW)
    if (sent) {
      logHostAiInferError({ handshakeId: handshakeId.trim(), requestId, code: inf.code })
    } else {
      logHostAiInferError({ handshakeId: handshakeId.trim(), requestId, code: 'DC_SEND_FAILED' })
    }
    return
  }
  const w = inf.responseEnvelope.wire
  if (w.type === 'internal_inference_error') {
    const ok = await sendInternalInferenceWireOverP2pDataChannel(p2pSessionId, handshakeId.trim(), w)
    if (ok) {
      logHostAiInferError({ handshakeId: handshakeId.trim(), requestId, code: w.code })
    } else {
      logHostAiInferError({ handshakeId: handshakeId.trim(), requestId, code: 'DC_SEND_FAILED' })
    }
    return
  }
  const outBytes = Buffer.byteLength(w.output, 'utf8')
  const ok = await sendInternalInferenceWireOverP2pDataChannel(p2pSessionId, handshakeId.trim(), w)
  if (ok) {
    logHostAiInferComplete({
      handshakeId: handshakeId.trim(),
      requestId,
      durationMs: w.duration_ms,
      outputBytes: outBytes,
    })
  } else {
    logHostAiInferError({ handshakeId: handshakeId.trim(), requestId, code: 'DC_SEND_FAILED' })
  }
}

export function handleP2pDcInferenceResultAsSandbox(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): boolean {
  if (raw.type !== DC_TYPES.result) {
    return false
  }
  if (!validateInferenceDcSandboxSession(p2pSessionId, handshakeId)) {
    return false
  }
  const rid = typeof raw.request_id === 'string' ? raw.request_id.trim() : ''
  if (!rid) {
    return false
  }
  const out = raw.output
  if (typeof out !== 'string') {
    return false
  }
  const model = typeof raw.model === 'string' ? raw.model : ''
  const duration_ms = typeof raw.duration_ms === 'number' && Number.isFinite(raw.duration_ms) ? raw.duration_ms : undefined
  const pr: PendingResult = {
    kind: 'result',
    output: out,
    ...(model.trim() ? { model: model.trim() } : {}),
    ...(duration_ms !== undefined ? { duration_ms } : {}),
  }
  if (!resolveInternalInferenceByRequestId(rid, pr)) {
    return false
  }
  logHostAiInferResponseReceived({ handshakeId: handshakeId.trim(), requestId: rid, transport: 'p2p' })
  return true
}

export function handleP2pDcInferenceErrorAsSandbox(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): boolean {
  if (raw.type !== DC_TYPES.err) {
    return false
  }
  if (!validateInferenceDcSandboxSession(p2pSessionId, handshakeId)) {
    return false
  }
  const rid = typeof raw.request_id === 'string' ? raw.request_id.trim() : ''
  if (!rid) {
    return false
  }
  const code = typeof raw.code === 'string' ? raw.code : InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED
  const message = typeof raw.message === 'string' && raw.message.length > 0 ? raw.message : code
  if (!resolveInternalInferenceByRequestId(rid, { kind: 'error', code, message })) {
    return false
  }
  logHostAiInferResponseReceived({ handshakeId: handshakeId.trim(), requestId: rid, transport: 'p2p' })
  return true
}

export async function handleP2pDcInferenceCancelAsHost(p2pSessionId: string, handshakeId: string, raw: Record<string, unknown>): Promise<void> {
  if (raw.type !== DC_TYPES.cancel) {
    return
  }
  const v = await validateHostInboundInferenceDc(p2pSessionId, handshakeId, raw)
  if (!v.ok) {
    return
  }
  const rid = typeof raw.request_id === 'string' ? raw.request_id.trim() : ''
  if (!rid) {
    return
  }
  const en: Record<string, unknown> = {
    type: 'internal_inference_cancel',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: rid,
    handshake_id: handshakeId.trim(),
    sender_device_id: raw.sender_device_id,
    target_device_id: raw.target_device_id,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    transport_policy: 'direct_only',
  }
  const ctx: HostInferenceCoreContext = {
    transport: 'webrtc_p2p',
    handshakeId: handshakeId.trim(),
    senderDeviceId: String(en.sender_device_id ?? '').trim(),
    targetDeviceId: String(en.target_device_id ?? '').trim(),
    authenticated: true,
    requestId: rid,
    now: Date.now(),
    db: v.db,
  }
  handleInternalInferenceCancel(en, ctx)
}

/**
 * @returns true if this JSON was a Phase-7 DC inference message type.
 */
export function tryRouteP2pInferenceDataChannelMessage(
  p2pSessionId: string,
  handshakeId: string,
  o: Record<string, unknown>,
): boolean {
  const t = o.type
  if (t === DC_TYPES.request) {
    if (typeof o.session_id === 'string' && o.session_id.trim() === p2pSessionId) {
      void handleP2pDcInferenceRequestAsHost(p2pSessionId, handshakeId, o)
    }
    return true
  }
  if (t === DC_TYPES.cancel) {
    if (typeof o.session_id === 'string' && o.session_id.trim() === p2pSessionId) {
      void handleP2pDcInferenceCancelAsHost(p2pSessionId, handshakeId, o)
    }
    return true
  }
  if (t === DC_TYPES.result) {
    void handleP2pDcInferenceResultAsSandbox(p2pSessionId, handshakeId, o)
    return true
  }
  if (t === DC_TYPES.err) {
    void handleP2pDcInferenceErrorAsSandbox(p2pSessionId, handshakeId, o)
    return true
  }
  return false
}
