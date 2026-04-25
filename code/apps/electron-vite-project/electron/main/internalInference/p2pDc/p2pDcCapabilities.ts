/**
 * Host AI capability exchange over a WebRTC DataChannel (Phase 6).
 * Wire: inference_capabilities_{request,result} + inference_error (JSON UTF-8; main validates, no Ollama in transport page).
 */
import { randomUUID } from 'crypto'
import { getHandshakeRecord } from '../../handshake/db'
import { isHostMode, isSandboxMode } from '../../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { buildInternalInferenceCapabilitiesResult } from '../hostInferenceCapabilities'
import { getSessionState } from '../p2pSession/p2pInferenceSessionManager'
import { assertRecordForServiceRpc, assertHostSendsResultToSandbox, assertSandboxRequestToHost, localCoordinationDeviceId, peerCoordinationDeviceId } from '../policy'
import type { InternalInferenceCapabilitiesResultWire } from '../types'
import { tryRouteP2pInferenceDataChannelMessage } from './p2pDcInference'

type CapResolve = (r: { ok: true; wire: InternalInferenceCapabilitiesResultWire } | { ok: false; reason: string; code?: string }) => void
const pending = new Map<string, { resolve: CapResolve; timeoutId: ReturnType<typeof setTimeout> }>()

const CAPS_TYPE_RESULT = 'inference_capabilities_result'
const CAPS_TYPE_ERR = 'inference_error'
const CAPS_TYPE_REQ = 'inference_capabilities_request'

export function clearPendingP2pCapabilitiesForTests(): void {
  for (const [, v] of pending) {
    clearTimeout(v.timeoutId)
  }
  pending.clear()
}

function mapDcToInternalWire(o: Record<string, unknown>, hid: string): InternalInferenceCapabilitiesResultWire | null {
  if (o.type !== CAPS_TYPE_RESULT) {
    return null
  }
  const requestId = typeof o.request_id === 'string' ? o.request_id : ''
  if (!requestId) {
    return null
  }
  const policy = o.policy_enabled === true
  const al = o.active_local_llm
  const ep = o.inference_error_code
  return {
    type: 'internal_inference_capabilities_result',
    schema_version: typeof o.schema_version === 'number' ? o.schema_version : 1,
    request_id: requestId,
    handshake_id: typeof o.handshake_id === 'string' ? o.handshake_id : hid,
    sender_device_id: typeof o.sender_device_id === 'string' ? o.sender_device_id : '',
    target_device_id: typeof o.target_device_id === 'string' ? o.target_device_id : '',
    created_at: typeof o.created_at === 'string' ? o.created_at : new Date().toISOString(),
    transport_policy: 'direct_only',
    host_computer_name: typeof o.host_computer_name === 'string' ? o.host_computer_name : '',
    host_pairing_code: typeof o.host_pairing_code === 'string' ? o.host_pairing_code : '',
    models: Array.isArray(o.models) ? (o.models as InternalInferenceCapabilitiesResultWire['models']) : [],
    policy_enabled: policy,
    active_local_llm: al && typeof al === 'object' && al !== null ? (al as InternalInferenceCapabilitiesResultWire['active_local_llm']) : undefined,
    active_chat_model: typeof o.active_chat_model === 'string' ? o.active_chat_model : undefined,
    inference_error_code: typeof ep === 'string' ? ep : undefined,
  }
}

/**
 * Host: inbound `inference_capabilities_request` on the local pod — respond on the same DC.
 */
export async function handleP2pDcInferenceCapabilitiesAsHost(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (!isHostMode()) {
    return
  }
  if (raw.type !== CAPS_TYPE_REQ) {
    return
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return
  }
  const record = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    return
  }
  const r = ar.record
  if (assertHostSendsResultToSandbox(r).ok !== true) {
    return
  }
  const s = getSessionState(handshakeId.trim())
  if (!s?.sessionId || s.sessionId !== p2pSessionId) {
    return
  }
  const localHost = (localCoordinationDeviceId(r) ?? '').trim()
  const peerSb = (peerCoordinationDeviceId(r) ?? '').trim()
  if (!localHost || !peerSb) {
    return
  }
  const reqSid = typeof raw.sender_device_id === 'string' ? raw.sender_device_id.trim() : ''
  const reqTgt = typeof raw.target_device_id === 'string' ? raw.target_device_id.trim() : ''
  if (reqSid && reqSid !== peerSb) {
    return
  }
  if (reqTgt && reqTgt !== localHost) {
    return
  }
  const requestId = typeof raw.request_id === 'string' ? raw.request_id : ''
  if (!requestId) {
    return
  }
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString()
  let built: InternalInferenceCapabilitiesResultWire
  try {
    built = await buildInternalInferenceCapabilitiesResult(r, { request_id: requestId, created_at: createdAt })
  } catch {
    const err = {
      schema_version: 1,
      type: CAPS_TYPE_ERR,
      request_id: requestId,
      handshake_id: handshakeId.trim(),
      code: 'INTERNAL',
      message: 'capabilities build failed',
    }
    const te = new TextEncoder().encode(JSON.stringify(err))
    const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
    void webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
    return
  }
  const capsEpoch = Date.now()
  const out = {
    type: CAPS_TYPE_RESULT,
    schema_version: 1,
    request_id: built.request_id,
    handshake_id: built.handshake_id,
    policy_enabled: built.policy_enabled,
    active_local_llm: built.active_local_llm,
    caps_epoch: capsEpoch,
    host_computer_name: built.host_computer_name,
    host_pairing_code: built.host_pairing_code,
    models: built.models,
    created_at: built.created_at,
    sender_device_id: built.sender_device_id,
    target_device_id: built.target_device_id,
    active_chat_model: built.active_chat_model,
    inference_error_code: built.inference_error_code,
  }
  const te = new TextEncoder().encode(JSON.stringify(out))
  const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
  void webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
}

/**
 * Sandbox: inbound result / error for a pending capabilities request.
 * @returns true if this message was consumed as a capabilities RPC (including unknown id for result).
 */
export function handleP2pDcInferenceCapabilitiesAsSandbox(
  p2pSessionId: string,
  handshakeId: string,
  raw: Record<string, unknown>,
): boolean {
  if (!isSandboxMode()) {
    return false
  }
  if (raw.type === CAPS_TYPE_ERR) {
    const rid = typeof raw.request_id === 'string' ? raw.request_id : ''
    if (!rid || !pending.has(rid)) {
      return false
    }
    const p = pending.get(rid)
    if (!p) {
      return false
    }
    clearTimeout(p.timeoutId)
    pending.delete(rid)
    const code = typeof raw.code === 'string' ? raw.code : 'error'
    p.resolve({ ok: false, reason: 'inference_error', code })
    return true
  }
  if (raw.type === CAPS_TYPE_RESULT) {
    const rid = typeof raw.request_id === 'string' ? raw.request_id : ''
    if (!rid || !pending.has(rid)) {
      return false
    }
    const p = pending.get(rid)
    if (!p) {
      return false
    }
    clearTimeout(p.timeoutId)
    pending.delete(rid)
    const w = mapDcToInternalWire(raw, handshakeId.trim())
    if (!w) {
      p.resolve({ ok: false, reason: 'parse' })
    } else {
      p.resolve({ ok: true, wire: w })
    }
    return true
  }
  return false
}

export function tryRouteP2pDataChannelJsonMessage(
  p2pSessionId: string,
  handshakeId: string,
  str: string,
): boolean {
  let raw: unknown
  try {
    raw = JSON.parse(str) as unknown
  } catch {
    return false
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false
  }
  const o = raw as Record<string, unknown>
  const t = o.type
  if (t === CAPS_TYPE_REQ) {
    if (typeof o.session_id !== 'string' || o.session_id.trim() !== p2pSessionId) {
      return true
    }
    void handleP2pDcInferenceCapabilitiesAsHost(p2pSessionId, handshakeId, o)
    return true
  }
  if (t === CAPS_TYPE_ERR) {
    if (handleP2pDcInferenceCapabilitiesAsSandbox(p2pSessionId, handshakeId, o)) {
      return true
    }
    return tryRouteP2pInferenceDataChannelMessage(p2pSessionId, handshakeId, o)
  }
  if (t === CAPS_TYPE_RESULT) {
    if (handleP2pDcInferenceCapabilitiesAsSandbox(p2pSessionId, handshakeId, o)) {
      return true
    }
    return false
  }
  return tryRouteP2pInferenceDataChannelMessage(p2pSessionId, handshakeId, o)
}

/**
 * Sandbox → Host: send capabilities request over DC and await response (or error).
 */
export async function requestHostInferenceCapabilitiesOverDataChannel(
  handshakeId: string,
  p2pSessionId: string,
  timeoutMs: number,
  options?: { requestId?: string },
): Promise<
  { ok: true; wire: InternalInferenceCapabilitiesResultWire } | { ok: false; reason: string; code?: string }
> {
  if (!isSandboxMode()) {
    return { ok: false, reason: 'not_sandbox' }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, reason: 'no_db' }
  }
  const r = getHandshakeRecord(db, handshakeId.trim())
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) {
    return { ok: false, reason: 'handshake' }
  }
  if (assertSandboxRequestToHost(ar.record).ok !== true) {
    return { ok: false, reason: 'role' }
  }
  const rec = ar.record
  const localSandbox = (localCoordinationDeviceId(rec) ?? '').trim()
  const peerHost = (peerCoordinationDeviceId(rec) ?? '').trim()
  if (!localSandbox || !peerHost) {
    return { ok: false, reason: 'missing_coordination_ids' }
  }
  const requestId = (options?.requestId?.trim() ? options.requestId.trim() : null) || randomUUID()
  const body = {
    schema_version: 1,
    type: CAPS_TYPE_REQ,
    request_id: requestId,
    handshake_id: handshakeId.trim(),
    session_id: p2pSessionId,
    sender_device_id: localSandbox,
    target_device_id: peerHost,
    created_at: new Date().toISOString(),
    transport_policy: 'p2p_only' as const,
  }
  return new Promise((resolve) => {
    const to = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId)
        resolve({ ok: false, reason: 'timeout' })
      }
    }, Math.min(timeoutMs, 15_000))
    const finish: CapResolve = (x) => {
      clearTimeout(to)
      resolve(x)
    }
    pending.set(requestId, { resolve: finish, timeoutId: to })
    const te = new TextEncoder().encode(JSON.stringify(body))
    void (async () => {
      const { webrtcSendData } = await import('../webrtc/webrtcTransportIpc')
      await webrtcSendData(p2pSessionId, handshakeId.trim(), te.buffer)
    })()
  })
}
