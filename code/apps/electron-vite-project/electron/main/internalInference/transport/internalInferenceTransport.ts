/**
 * Single decision point for internal Host AI outbound transport (direct HTTP vs future WebRTC DataChannel).
 * Phase 1: WebRTC data plane is not wired; flags default to existing HTTP direct path.
 */

import { randomUUID } from 'crypto'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { postServiceEnvelopeDirect, type DirectServiceSendResult } from '../directSend'
import { InternalInferenceErrorCode } from '../errors'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { requestHostInferenceCapabilitiesOverDataChannel } from '../p2pDc/p2pDcCapabilities'
import { sendHostInferenceRequestOverP2pDataChannel, sendInternalInferenceWireOverP2pDataChannel } from '../p2pDc/p2pDcInference'
import { getSessionState } from '../p2pSession/p2pInferenceSessionManager'
import { tryRepairP2pEndpointFromHostAdvertisement } from '../p2pEndpointRepair'
import {
  assertP2pEndpointDirect,
  localCoordinationDeviceId,
  peerCoordinationDeviceId,
} from '../policy'
import type { HandshakeRecord } from '../../handshake/types'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceCapabilitiesResultWire, type InternalInferenceErrorWire, type InternalInferenceRequestWire, type InternalInferenceResultWire, type InternalServiceMessageType } from '../types'
import { logHostAiInferComplete, logHostAiInferError, logHostAiInferRequestSend } from '../hostAiInferLog'
import { logHostAiTransportChoose, logHostAiTransportFallback, logHostAiTransportUnavailable } from './hostAiTransportLog'
import type { HostAiTransport, HostAiTransportIntent, HostAiTransportLogReason } from './hostAiTransportTypes'
import { decideInternalInferenceTransport } from './transportDecide'

export type { HostAiTransport, HostAiTransportIntent, HostAiTransportLogReason, HostAiTransportPreference } from './hostAiTransportTypes'
export { decideInternalInferenceTransport, isWebrtcP2pDataPlaneAvailable, type HostAiTransportChoice } from './transportDecide'

function emitTransportDiagnostics(
  handshakeId: string,
  _intent: HostAiTransportIntent,
  directEndpointOk: boolean,
  d: ReturnType<typeof decideInternalInferenceTransport>,
): void {
  const { choice, shouldEmitFallbackLog } = d
  if (choice.selected === 'unavailable') {
    if (choice.reason === 'non_direct_endpoint') {
      logHostAiTransportUnavailable({ handshakeId, reason: 'non_direct_endpoint' })
    } else {
      logHostAiTransportUnavailable({ handshakeId, reason: choice.reason })
    }
    return
  }
  if (shouldEmitFallbackLog) {
    logHostAiTransportChoose({
      handshakeId,
      preferred: choice.preferred,
      selected: choice.selected,
      reason: choice.reason,
    })
    logHostAiTransportFallback({
      handshakeId,
      from: 'webrtc_p2p',
      to: 'http_direct',
      reason: choice.reason,
    })
    return
  }
  logHostAiTransportChoose({
    handshakeId,
    preferred: choice.preferred,
    selected: choice.selected,
    reason: choice.reason,
  })
}

// --- In-memory readout (diagnostics, single-process) ---

export type HostAiTransportState = {
  handshakeId: string
  lastIntent: HostAiTransportIntent | null
  activeTransport: HostAiTransport
  lastDecisionReason: HostAiTransportLogReason
  lastUpdatedMs: number
  lastExternalRefreshReason: string | null
}

const _state = new Map<string, HostAiTransportState>()

function touchState(
  handshakeId: string,
  intent: HostAiTransportIntent,
  activeTransport: HostAiTransport,
  lastDecisionReason: HostAiTransportLogReason,
): void {
  const hid = handshakeId.trim()
  _state.set(hid, {
    handshakeId: hid,
    lastIntent: intent,
    activeTransport,
    lastDecisionReason,
    lastUpdatedMs: Date.now(),
    lastExternalRefreshReason: _state.get(hid)?.lastExternalRefreshReason ?? null,
  })
}

export function getTransportState(handshakeId: string): HostAiTransportState | null {
  return _state.get(handshakeId.trim()) ?? null
}

export function refreshTransportState(handshakeId: string, reason: string): void {
  const hid = handshakeId.trim()
  const cur = _state.get(hid)
  _state.set(hid, {
    handshakeId: hid,
    lastIntent: cur?.lastIntent ?? null,
    activeTransport: cur?.activeTransport ?? 'unavailable',
    lastDecisionReason: cur?.lastDecisionReason ?? 'http_default',
    lastUpdatedMs: Date.now(),
    lastExternalRefreshReason: String(reason).slice(0, 500),
  })
}

export type ListHostCapabilitiesOpts = {
  record: HandshakeRecord
  ingestUrl: string
  token: string
  timeoutMs: number
}

function redactP2pLogLine(m: string | undefined | null): string {
  const s = (m ?? '')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return s.length > 200 ? `${s.slice(0, 197)}...` : s
}

/**
 * List Host capabilities (POST internal_inference_capabilities_request, response body on same connection).
 */
export async function listHostCapabilities(
  handshakeId: string,
  opts: ListHostCapabilitiesOpts,
): Promise<
  | { ok: true; wire: InternalInferenceCapabilitiesResultWire }
  | { ok: false; reason: string; responseStatus?: number; networkErrorMessage?: string }
> {
  const hid = handshakeId.trim()
  const { record, ingestUrl, token, timeoutMs } = opts
  const db = await getHandshakeDbForInternalInference()
  const directEndpointOk = Boolean(db) && assertP2pEndpointDirect(db!, record.p2p_endpoint).ok
  const decision = decideInternalInferenceTransport(hid, 'capabilities', directEndpointOk)
  emitTransportDiagnostics(hid, 'capabilities', directEndpointOk, decision)
  if (decision.choice.selected === 'unavailable') {
    touchState(hid, 'capabilities', 'unavailable', decision.choice.reason)
    return { ok: false, reason: decision.choice.reason }
  }
  touchState(
    hid,
    'capabilities',
    decision.choice.selected,
    decision.choice.reason as HostAiTransportLogReason,
  )

  const localSandbox = (localCoordinationDeviceId(record) ?? '').trim()
  const peerHost = (peerCoordinationDeviceId(record) ?? '').trim()
  if (!localSandbox || !peerHost) {
    logHostAiTransportUnavailable({ handshakeId: hid, reason: 'missing_coordination_ids' })
    touchState(hid, 'capabilities', 'unavailable', 'missing_coordination_ids')
    const m = 'missing coordination ids'
    console.log(
      `[HOST_INFERENCE_P2P] request_failed code=missing_coordination_ids message=${redactP2pLogLine(m)} handshake=${hid}`,
    )
    console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=missing_coordination_ids`)
    return { ok: false, reason: 'missing_coordination_ids' }
  }

  if (decision.choice.selected === 'webrtc_p2p') {
    const p2pS = getSessionState(hid)
    const p2pSid = p2pS?.sessionId
    if (!p2pSid) {
      touchState(hid, 'capabilities', 'unavailable', 'p2p_not_wired')
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=p2p_no_session_id`)
      return { ok: false, reason: 'P2P_UNAVAILABLE' }
    }
    console.log(`[HOST_INFERENCE_CAPS] request_send_dc handshake=${hid} session=${p2pSid}`)
    const dcr = await requestHostInferenceCapabilitiesOverDataChannel(hid, p2pSid, timeoutMs)
    if (dcr.ok) {
      const w = dcr.wire
      const m2 = w.active_local_llm?.model?.trim() || w.active_chat_model?.trim() || null
      console.log(`[HOST_INFERENCE_CAPS] response_received via=dc active_model=${m2 ?? 'null'}`)
      return { ok: true, wire: w }
    }
    if (!dcr.ok) {
      const errReason = dcr.reason
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=${errReason}`)
      if (getP2pInferenceFlags().p2pInferenceHttpFallback) {
        logHostAiTransportFallback({
          handshakeId: hid,
          from: 'webrtc_p2p',
          to: 'http_direct',
          reason: 'p2p_dc_error_fallback_http',
        })
        touchState(hid, 'capabilities', 'http_direct', 'p2p_dc_error_fallback_http')
        console.log(`[HOST_INFERENCE_CAPS] falling_back_to_http reason=${errReason} handshake=${hid}`)
      } else {
        touchState(hid, 'capabilities', 'unavailable', 'p2p_not_ready_no_fallback')
        return { ok: false, reason: errReason }
      }
    }
  }

  const body = {
    type: 'internal_inference_capabilities_request' as const,
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: randomUUID(),
    handshake_id: hid,
    sender_device_id: localSandbox,
    target_device_id: peerHost,
    created_at: new Date().toISOString(),
    transport_policy: 'direct_only' as const,
  }
  console.log(`[HOST_INFERENCE_CAPS] request_send handshake=${hid}`)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Math.min(timeoutMs, 15_000))
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
        'X-BEAP-Handshake': hid,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    clearTimeout(timer)
    console.log(`[HOST_INFERENCE_P2P] response_status=${res.status} handshake=${hid}`)
    if (res.status === 401 || res.status === 403) {
      const m = 'forbidden'
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=forbidden message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=forbidden`)
      return { ok: false, reason: 'forbidden', responseStatus: res.status }
    }
    if (!res.ok) {
      const m = `http ${res.status}`
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=http_${res.status} message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=http_${res.status}`)
      return { ok: false, reason: `http_${res.status}`, responseStatus: res.status }
    }
    const adv = res.headers.get('x-beap-direct-p2p-endpoint')
    {
      if (db) {
        tryRepairP2pEndpointFromHostAdvertisement(db, hid, adv)
      }
    }
    const j = (await res.json()) as Record<string, unknown>
    if (j.type !== 'internal_inference_capabilities_result') {
      const m = 'wrong JSON type for capabilities result'
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=wrong_type message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=wrong_type`)
      return { ok: false, reason: 'wrong_type', responseStatus: 200 }
    }
    const w = j as unknown as InternalInferenceCapabilitiesResultWire
    const m = w.active_local_llm?.model?.trim() || w.active_chat_model?.trim() || null
    console.log(`[HOST_INFERENCE_CAPS] response_received active_model=${m ?? 'null'}`)
    return { ok: true, wire: w }
  } catch (e) {
    clearTimeout(timer)
    if ((e as Error)?.name === 'AbortError') {
      const m = 'request aborted (timeout)'
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=timeout message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=timeout`)
      return { ok: false, reason: 'timeout' }
    }
    const netMsg = (e as Error)?.message
    const m = netMsg && netMsg.length > 0 ? netMsg : 'network'
    console.log(
      `[HOST_INFERENCE_P2P] request_failed code=network message=${redactP2pLogLine(m)} handshake=${hid}`,
    )
    console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=network`)
    return { ok: false, reason: 'network', networkErrorMessage: netMsg }
  }
}

export type RequestHostCompletionOpts = { record: HandshakeRecord; directEndpointOk: boolean }

/**
 * POST internal_inference_request to the Host (direct HTTP in Phase 1 when selected transport is http_direct).
 */
export async function requestHostCompletion(
  handshakeId: string,
  request: InternalInferenceRequestWire,
  opts: RequestHostCompletionOpts,
): Promise<DirectServiceSendResult> {
  const hid = String(handshakeId ?? '').trim()
  const { record, directEndpointOk } = opts
  const decision = decideInternalInferenceTransport(hid, 'request', directEndpointOk)
  emitTransportDiagnostics(hid, 'request', directEndpointOk, decision)
  if (decision.choice.selected === 'unavailable') {
    const reason = decision.choice.reason
    touchState(hid, 'request', 'unavailable', reason)
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      error: reason,
    }
  }
  const d = decision.choice
  const promptBytes = Buffer.byteLength(JSON.stringify(request.messages), 'utf8')
  const messageCount = request.messages.length
  if (d.selected === 'webrtc_p2p') {
    const p2pSid = getSessionState(hid)?.sessionId
    if (p2pSid) {
      logHostAiInferRequestSend({
        handshakeId: hid,
        requestId: request.request_id,
        promptBytes,
        messageCount,
        transport: 'p2p',
      })
      const sent = await sendHostInferenceRequestOverP2pDataChannel(p2pSid, hid, request)
      if (sent) {
        touchState(hid, 'request', 'webrtc_p2p', d.reason)
        return { ok: true, status: 200 }
      }
      if (!getP2pInferenceFlags().p2pInferenceHttpFallback) {
        touchState(hid, 'request', 'unavailable', 'p2p_not_ready_no_fallback')
        return {
          ok: false,
          code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
          error: 'dc send failed',
        }
      }
      logHostAiTransportFallback({
        handshakeId: hid,
        from: 'webrtc_p2p',
        to: 'http_direct',
        reason: 'p2p_dc_error_fallback_http',
      })
      touchState(hid, 'request', 'http_direct', 'p2p_dc_error_fallback_http')
    } else {
      if (!getP2pInferenceFlags().p2pInferenceHttpFallback) {
        touchState(hid, 'request', 'unavailable', 'p2p_not_wired')
        return {
          ok: false,
          code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
          error: 'P2P_UNAVAILABLE',
        }
      }
      logHostAiTransportFallback({
        handshakeId: hid,
        from: 'webrtc_p2p',
        to: 'http_direct',
        reason: 'p2p_not_wired',
      })
      touchState(hid, 'request', 'http_direct', 'p2p_not_wired')
    }
  } else {
    touchState(hid, 'request', d.selected, d.reason)
  }
  const ep = record.p2p_endpoint?.trim() ?? ''
  logHostAiInferRequestSend({
    handshakeId: hid,
    requestId: request.request_id,
    promptBytes,
    messageCount,
    transport: 'http',
  })
  return postServiceEnvelopeDirect(
    request,
    ep,
    record.handshake_id,
    record.counterparty_p2p_token,
    {
      request_id: request.request_id,
      sender_device_id: request.sender_device_id,
      target_device_id: request.target_device_id,
      message_type: 'internal_inference_request',
    },
  )
}

/**
 * Host → Sandbox: deliver internal_inference_result / internal_inference_error.
 */
export async function sendHostInferenceResult(
  handshakeId: string,
  result: InternalInferenceResultWire | InternalInferenceErrorWire,
  opts: { record: HandshakeRecord; targetEndpoint: string; directEndpointOk: boolean },
  messageType: 'internal_inference_result' | 'internal_inference_error',
): Promise<DirectServiceSendResult> {
  const hid = String(handshakeId ?? '').trim()
  const { record, targetEndpoint, directEndpointOk } = opts
  const decision = decideInternalInferenceTransport(hid, 'result', directEndpointOk)
  emitTransportDiagnostics(hid, 'result', directEndpointOk, decision)
  if (decision.choice.selected === 'unavailable') {
    touchState(hid, 'result', 'unavailable', decision.choice.reason)
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      error: decision.choice.reason,
    }
  }
  const d = decision.choice
  if (d.selected === 'webrtc_p2p') {
    const p2pSid = getSessionState(hid)?.sessionId
    if (p2pSid) {
      const sent = await sendInternalInferenceWireOverP2pDataChannel(p2pSid, hid, result)
      if (sent) {
        if (messageType === 'internal_inference_result' && result.type === 'internal_inference_result') {
          logHostAiInferComplete({
            handshakeId: hid,
            requestId: result.request_id,
            durationMs: result.duration_ms,
            outputBytes: Buffer.byteLength(result.output, 'utf8'),
          })
        } else if (messageType === 'internal_inference_error' && result.type === 'internal_inference_error') {
          logHostAiInferError({ handshakeId: hid, requestId: result.request_id, code: result.code })
        }
        touchState(hid, 'result', 'webrtc_p2p', d.reason)
        return { ok: true, status: 200 }
      }
      if (!getP2pInferenceFlags().p2pInferenceHttpFallback) {
        touchState(hid, 'result', 'unavailable', 'p2p_not_ready_no_fallback')
        return {
          ok: false,
          code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
          error: 'dc send failed',
        }
      }
      logHostAiTransportFallback({
        handshakeId: hid,
        from: 'webrtc_p2p',
        to: 'http_direct',
        reason: 'p2p_dc_error_fallback_http',
      })
      touchState(hid, 'result', 'http_direct', 'p2p_dc_error_fallback_http')
    } else {
      if (!getP2pInferenceFlags().p2pInferenceHttpFallback) {
        touchState(hid, 'result', 'unavailable', 'p2p_not_wired')
        return {
          ok: false,
          code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
          error: 'P2P_UNAVAILABLE',
        }
      }
      logHostAiTransportFallback({
        handshakeId: hid,
        from: 'webrtc_p2p',
        to: 'http_direct',
        reason: 'p2p_not_wired',
      })
      touchState(hid, 'result', 'http_direct', 'p2p_not_wired')
    }
  } else {
    touchState(hid, 'result', d.selected, d.reason)
  }
  const post = await postServiceEnvelopeDirect(
    result,
    targetEndpoint,
    record.handshake_id,
    record.counterparty_p2p_token,
    {
      request_id: result.request_id,
      sender_device_id: result.sender_device_id,
      target_device_id: result.target_device_id,
      message_type: messageType as InternalServiceMessageType,
    },
  )
  if (post.ok) {
    if (messageType === 'internal_inference_result' && result.type === 'internal_inference_result') {
      logHostAiInferComplete({
        handshakeId: hid,
        requestId: result.request_id,
        durationMs: result.duration_ms,
        outputBytes: Buffer.byteLength(result.output, 'utf8'),
      })
    } else if (messageType === 'internal_inference_error' && result.type === 'internal_inference_error') {
      logHostAiInferError({ handshakeId: hid, requestId: result.request_id, code: result.code })
    }
  }
  return post
}
