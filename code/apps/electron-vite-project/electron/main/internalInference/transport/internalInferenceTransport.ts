/**
 * Outbound Host AI transport: `decideInternalInferenceTransport` (policy) then `decideHostAiIntentRoute` (P2P vs HTTP).
 * Legacy **direct HTTP** to the Host BEAP ingest URL is **fallback only** — allowed only when
 * `WRDESK_P2P_INFERENCE_HTTP_FALLBACK` is set and direct ingest is valid; it does not define Host discovery.
 */

import { randomUUID } from 'crypto'
import { getHandshakeDbForInternalInference } from '../dbAccess'
import { postServiceEnvelopeDirect, type DirectServiceSendResult } from '../directSend'
import { InternalInferenceErrorCode } from '../errors'
import { getHostAiBuildStamp, logHostAiStage, newHostAiCorrelationChain } from '../hostAiStageLog'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { requestHostInferenceCapabilitiesOverDataChannel } from '../p2pDc/p2pDcCapabilities'
import { sendHostInferenceRequestOverP2pDataChannel, sendInternalInferenceWireOverP2pDataChannel } from '../p2pDc/p2pDcInference'
import { getSessionState, P2pSessionPhase } from '../p2pSession/p2pInferenceSessionManager'
import { isP2pDataChannelUpForHandshake } from '../p2pSession/p2pSessionWait'
import { tryRepairP2pEndpointFromHostAdvertisement } from '../p2pEndpointRepair'
import {
  canPostInternalInferenceHttpToP2pEndpointIngest,
  localCoordinationDeviceId,
  outboundP2pBearerToCounterpartyIngest,
  peerCoordinationDeviceId,
} from '../policy'
import type { HandshakeRecord } from '../../handshake/types'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceCapabilitiesResultWire, type InternalInferenceErrorWire, type InternalInferenceRequestWire, type InternalInferenceResultWire, type InternalServiceMessageType } from '../types'
import { logHostAiInferComplete, logHostAiInferError, logHostAiInferRequestSend } from '../hostAiInferLog'
import { logHostAiTransportChoose, logHostAiTransportFallback, logHostAiTransportUnavailable } from './hostAiTransportLog'
import type { HostAiTransport, HostAiTransportIntent, HostAiTransportLogReason } from './hostAiTransportTypes'
import { decideHostAiIntentRoute } from './transportDecide'
import {
  buildHostAiTransportDeciderInput,
  buildHostAiTransportDeciderInputAsync,
  decideInternalInferenceTransport,
  deriveHostAiHandshakeRoles,
} from './decideInternalInferenceTransport'

export type { HostAiTransport, HostAiTransportIntent, HostAiTransportLogReason, HostAiTransportPreference } from './hostAiTransportTypes'
export { decideHostAiIntentRoute, isWebrtcP2pDataPlaneAvailable, type HostAiTransportChoice } from './transportDecide'
export {
  decideInternalInferenceTransport,
  buildHostAiTransportDeciderInput,
  buildHostAiTransportDeciderInputAsync,
  buildSessionStateForHostAiDecider,
} from './decideInternalInferenceTransport'

function emitTransportDiagnostics(
  handshakeId: string,
  _intent: HostAiTransportIntent,
  _p2pTransportEndpointOpen: boolean,
  d: ReturnType<typeof decideHostAiIntentRoute>,
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
  /** Correlates all [HOST_AI_STAGE] lines for this attempt; defaults to a new UUID. */
  correlationChain?: string
  /** `X-Correlation-Id` on POST /beap/ingest; defaults to a new UUID. */
  beapCorrelationId?: string
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
  const { record, ingestUrl, token, timeoutMs, correlationChain: chainOpt, beapCorrelationId: corrOpt } = opts
  const chain = (chainOpt && chainOpt.trim() ? chainOpt.trim() : null) || newHostAiCorrelationChain()
  const beapCorr = (corrOpt && corrOpt.trim() ? corrOpt.trim() : null) || randomUUID()
  const buildStamp = getHostAiBuildStamp()
  const f = getP2pInferenceFlags()
  const roles = deriveHostAiHandshakeRoles(record)
  const roleOk =
    roles.ledgerSandboxToHost &&
    roles.samePrincipal &&
    roles.internalIdentityComplete &&
    roles.peerHostDeviceIdPresent
  logHostAiStage({
    chain,
    stage: 'handshake_role',
    reached: true,
    success: roleOk,
    handshakeId: hid,
    buildStamp,
    flags: f,
    failureCode: roleOk ? null : 'TARGET_NOT_TRUSTED',
  })

  logHostAiStage({
    chain,
    stage: 'feature_flags',
    reached: true,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: f,
  })

  const db = await getHandshakeDbForInternalInference()
  const dec = db
    ? decideInternalInferenceTransport(
        await buildHostAiTransportDeciderInputAsync({
          operationContext: 'capabilities',
          db,
          handshakeRecord: record,
          featureFlags: f,
        }),
      )
    : null
  const endpointGateOk = dec?.p2pTransportEndpointOpen ?? false
  const decision = decideHostAiIntentRoute(hid, 'capabilities', endpointGateOk)
  const selOk = decision.choice.selected !== 'unavailable'
  if (db) {
    logHostAiStage({
      chain,
      stage: 'selector_target',
      reached: true,
      success: selOk,
      handshakeId: hid,
      buildStamp,
      flags: f,
      phase: dec!.selectorPhase,
      failureCode: selOk ? null : (decision.choice.reason as string) || (dec!.failureCode as string | null),
    })
  } else {
    logHostAiStage({
      chain,
      stage: 'selector_target',
      reached: true,
      success: true,
      handshakeId: hid,
      buildStamp,
      flags: f,
      phase: 'no_db',
    })
  }
  if (!selOk) {
    emitTransportDiagnostics(hid, 'capabilities', endpointGateOk, decision)
    touchState(hid, 'capabilities', 'unavailable', decision.choice.reason)
    return { ok: false, reason: decision.choice.reason }
  }
  const webrtcPath = decision.choice.selected === 'webrtc_p2p'
  const p2pS0 = webrtcPath ? getSessionState(hid) : null
  const p2pSid0 = p2pS0?.sessionId?.trim() || null
  const sigPh = p2pS0?.phase
  const sigSuccess =
    !webrtcPath ||
    (Boolean(p2pSid0) && sigPh !== P2pSessionPhase.failed && sigPh !== P2pSessionPhase.closed)
  logHostAiStage({
    chain,
    stage: 'signaling',
    reached: webrtcPath,
    success: webrtcPath ? Boolean(sigSuccess) : true,
    handshakeId: hid,
    buildStamp,
    flags: f,
    p2pSessionId: webrtcPath ? p2pSid0 : null,
    /** Host AI WebRTC: signaling/ICE in progress is not a logged selector failure. */
    failureCode: webrtcPath ? null : webrtcPath && !sigSuccess ? 'P2P_SIGNALING_INCOMPLETE' : null,
  })
  const dcUp = isP2pDataChannelUpForHandshake(hid)
  const dcSuccess = !webrtcPath || dcUp
  logHostAiStage({
    chain,
    stage: 'datachannel',
    reached: webrtcPath,
    success: webrtcPath ? Boolean(dcSuccess) : true,
    handshakeId: hid,
    buildStamp,
    flags: f,
    p2pSessionId: webrtcPath ? p2pSid0 : null,
    failureCode: webrtcPath ? null : webrtcPath && !dcSuccess ? 'DATACHANNEL_NOT_UP' : null,
  })
  emitTransportDiagnostics(hid, 'capabilities', endpointGateOk, decision)
  touchState(
    hid,
    'capabilities',
    decision.choice.selected,
    decision.choice.reason as HostAiTransportLogReason,
  )

  const localSandbox = (localCoordinationDeviceId(record) ?? '').trim()
  const peerHost = (peerCoordinationDeviceId(record) ?? '').trim()
  if (!localSandbox || !peerHost) {
    logHostAiStage({
      chain,
      stage: 'capabilities_request',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: f,
      p2pSessionId: p2pSid0,
      failureCode: 'MISSING_COORDINATION_IDS',
    })
    logHostAiTransportUnavailable({ handshakeId: hid, reason: 'missing_coordination_ids' })
    touchState(hid, 'capabilities', 'unavailable', 'missing_coordination_ids')
    const m = 'missing coordination ids'
    console.log(
      `[HOST_INFERENCE_P2P] request_failed code=missing_coordination_ids message=${redactP2pLogLine(m)} handshake=${hid}`,
    )
    console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=missing_coordination_ids`)
    return { ok: false, reason: 'missing_coordination_ids' }
  }

  const httpIngestOk = canPostInternalInferenceHttpToP2pEndpointIngest(db, record.p2p_endpoint)

  if (decision.choice.selected === 'webrtc_p2p') {
    const p2pS = getSessionState(hid)
    const p2pSid = p2pS?.sessionId
    if (!p2pSid) {
      logHostAiStage({
        chain,
        stage: 'capabilities_request',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        p2pSessionId: null,
        failureCode: 'P2P_NO_SESSION',
      })
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        p2pSessionId: null,
        failureCode: 'P2P_NO_SESSION',
      })
      touchState(hid, 'capabilities', 'unavailable', 'p2p_not_wired')
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=p2p_no_session_id`)
      return { ok: false, reason: 'P2P_UNAVAILABLE' }
    }
    const capReqId = randomUUID()
    logHostAiStage({
      chain,
      stage: 'capabilities_request',
      reached: true,
      success: true,
      handshakeId: hid,
      buildStamp,
      flags: f,
      p2pSessionId: p2pSid,
      requestId: capReqId,
    })
    console.log(`[HOST_INFERENCE_CAPS] request_send_dc handshake=${hid} session=${p2pSid} corr=${beapCorr}`)
    const dcr = await requestHostInferenceCapabilitiesOverDataChannel(hid, p2pSid, timeoutMs, { requestId: capReqId })
    if (dcr.ok) {
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: true,
        handshakeId: hid,
        buildStamp,
        flags: f,
        p2pSessionId: p2pSid,
        requestId: capReqId,
      })
      const w = dcr.wire
      const m2 = w.active_local_llm?.model?.trim() || w.active_chat_model?.trim() || null
      console.log(`[HOST_INFERENCE_CAPS] response_received via=dc active_model=${m2 ?? 'null'}`)
      {
        const ie = w.inference_error_code
        const mpOk = ie == null || String(ie).trim() === ''
        logHostAiStage({
          chain,
          stage: 'model_projection',
          reached: true,
          success: mpOk,
          handshakeId: hid,
          buildStamp,
          flags: f,
          p2pSessionId: p2pSid,
          requestId: capReqId,
          phase: mpOk ? 'capabilities_wire_ok' : String(ie).trim(),
          failureCode: mpOk ? null : String(ie).trim(),
        })
      }
      return { ok: true, wire: w }
    }
    if (!dcr.ok) {
      const errReason = dcr.reason
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        p2pSessionId: p2pSid,
        requestId: capReqId,
        failureCode: errReason,
      })
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

  if (!httpIngestOk) {
    logHostAiStage({
      chain,
      stage: 'capabilities_request',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: f,
      failureCode: 'HTTP_INGEST_DIRECT_BEAP_REQUIRED',
    })
    logHostAiStage({
      chain,
      stage: 'capabilities_response',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: f,
      failureCode: 'HTTP_INGEST_DIRECT_BEAP_REQUIRED',
    })
    touchState(hid, 'capabilities', 'unavailable', 'p2p_not_wired')
    console.log(
      `[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=http_ingest_requires_direct_beap`,
    )
    return { ok: false, reason: 'http_ingest_requires_direct_beap' }
  }

  const capHttpReqId = randomUUID()
  logHostAiStage({
    chain,
    stage: 'capabilities_request',
    reached: true,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: f,
    requestId: capHttpReqId,
  })
  const body = {
    type: 'internal_inference_capabilities_request' as const,
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: capHttpReqId,
    handshake_id: hid,
    sender_device_id: localSandbox,
    target_device_id: peerHost,
    created_at: new Date().toISOString(),
    transport_policy: 'direct_only' as const,
  }
  console.log(`[HOST_INFERENCE_CAPS] request_send handshake=${hid} corr=${beapCorr}`)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Math.min(timeoutMs, 15_000))
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
        'X-BEAP-Handshake': hid,
        'X-BEAP-Host-AI-Chain': chain,
        'X-Correlation-Id': beapCorr,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    clearTimeout(timer)
    console.log(`[HOST_INFERENCE_P2P] response_status=${res.status} handshake=${hid}`)
    if (res.status === 401 || res.status === 403) {
      const m = 'forbidden'
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        failureCode: 'HTTP_FORBIDDEN',
      })
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=forbidden message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=forbidden`)
      return { ok: false, reason: 'forbidden', responseStatus: res.status }
    }
    if (!res.ok) {
      const m = `http ${res.status}`
      const code = `http_${res.status}`
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        failureCode: code,
      })
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=http_${res.status} message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=http_${res.status}`)
      return { ok: false, reason: code, responseStatus: res.status }
    }
    const adv = res.headers.get('x-beap-direct-p2p-endpoint')
    {
      if (db) {
        tryRepairP2pEndpointFromHostAdvertisement(db, hid, adv)
      }
    }
    let j: Record<string, unknown>
    try {
      j = (await res.json()) as Record<string, unknown>
    } catch {
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        failureCode: 'INVALID_JSON',
      })
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=invalid_response message=${redactP2pLogLine('JSON parse error')} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=invalid_response`)
      return { ok: false, reason: 'invalid_response', responseStatus: res.status }
    }
    if (j.type !== 'internal_inference_capabilities_result') {
      const m = 'wrong JSON type for capabilities result'
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        failureCode: 'WRONG_RESULT_TYPE',
      })
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=wrong_type message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=wrong_type`)
      return { ok: false, reason: 'wrong_type', responseStatus: 200 }
    }
    const w = j as unknown as InternalInferenceCapabilitiesResultWire
    const m = w.active_local_llm?.model?.trim() || w.active_chat_model?.trim() || null
    logHostAiStage({
      chain,
      stage: 'capabilities_response',
      reached: true,
      success: true,
      handshakeId: hid,
      buildStamp,
      flags: f,
      requestId: capHttpReqId,
    })
    console.log(`[HOST_INFERENCE_CAPS] response_received active_model=${m ?? 'null'}`)
    {
      const ie = w.inference_error_code
      const mpOk = ie == null || String(ie).trim() === ''
      logHostAiStage({
        chain,
        stage: 'model_projection',
        reached: true,
        success: mpOk,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        phase: mpOk ? 'capabilities_wire_ok' : String(ie).trim(),
        failureCode: mpOk ? null : String(ie).trim(),
      })
    }
    return { ok: true, wire: w }
  } catch (e) {
    clearTimeout(timer)
    if ((e as Error)?.name === 'AbortError') {
      const m = 'request aborted (timeout)'
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        failureCode: 'TIMEOUT',
      })
      console.log(
        `[HOST_INFERENCE_P2P] request_failed code=timeout message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=timeout`)
      return { ok: false, reason: 'timeout' }
    }
    const netMsg = (e as Error)?.message
    const m = netMsg && netMsg.length > 0 ? netMsg : 'network'
    logHostAiStage({
      chain,
      stage: 'capabilities_response',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: f,
      requestId: capHttpReqId,
      failureCode: 'NETWORK',
    })
    console.log(
      `[HOST_INFERENCE_P2P] request_failed code=network message=${redactP2pLogLine(m)} handshake=${hid}`,
    )
    console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=network`)
    return { ok: false, reason: 'network', networkErrorMessage: netMsg }
  }
}

export type RequestHostCompletionOpts = {
  record: HandshakeRecord
  correlationChain?: string
  /** `X-Correlation-Id` on direct POST /beap/ingest; defaults to a new UUID. */
  beapCorrelationId?: string
}

/**
 * POST internal_inference_request to the Host (direct HTTP in Phase 1 when selected transport is http_direct).
 */
export async function requestHostCompletion(
  handshakeId: string,
  request: InternalInferenceRequestWire,
  opts: RequestHostCompletionOpts,
): Promise<DirectServiceSendResult> {
  const hid = String(handshakeId ?? '').trim()
  const { record, correlationChain: reqChain, beapCorrelationId: reqBeapCorr } = opts
  const chain = (reqChain && reqChain.trim() ? reqChain.trim() : null) || newHostAiCorrelationChain()
  const httpBeapCorr = (reqBeapCorr && reqBeapCorr.trim() ? reqBeapCorr.trim() : null) || randomUUID()
  const buildStamp = getHostAiBuildStamp()
  const f0 = getP2pInferenceFlags()
  const reqId0 = (request.request_id && String(request.request_id).trim()) || 'null'
  const roles0 = deriveHostAiHandshakeRoles(record)
  const roleOk0 =
    roles0.ledgerSandboxToHost &&
    roles0.samePrincipal &&
    roles0.internalIdentityComplete &&
    roles0.peerHostDeviceIdPresent
  logHostAiStage({
    chain,
    stage: 'handshake_role',
    reached: true,
    success: roleOk0,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    requestId: reqId0,
    failureCode: roleOk0 ? null : 'TARGET_NOT_TRUSTED',
  })
  logHostAiStage({
    chain,
    stage: 'feature_flags',
    reached: true,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    requestId: reqId0,
  })
  const db0 = await getHandshakeDbForInternalInference()
  const dec0 = db0
    ? decideInternalInferenceTransport(
        await buildHostAiTransportDeciderInputAsync({
          operationContext: 'request',
          db: db0,
          handshakeRecord: record,
          featureFlags: f0,
        }),
      )
    : null
  const endpointGateOk = dec0?.p2pTransportEndpointOpen ?? false
  const decision = decideHostAiIntentRoute(hid, 'request', endpointGateOk)
  const selOk0 = decision.choice.selected !== 'unavailable'
  if (db0) {
    logHostAiStage({
      chain,
      stage: 'selector_target',
      reached: true,
      success: selOk0,
      handshakeId: hid,
      buildStamp,
      flags: f0,
      requestId: reqId0,
      phase: dec0!.selectorPhase,
      failureCode: selOk0 ? null : (decision.choice.reason as string) || (dec0!.failureCode as string | null),
    })
  } else {
    logHostAiStage({
      chain,
      stage: 'selector_target',
      reached: true,
      success: true,
      handshakeId: hid,
      buildStamp,
      flags: f0,
      requestId: reqId0,
      phase: 'no_db',
    })
  }
  logHostAiStage({
    chain,
    stage: 'capabilities_request',
    reached: false,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    requestId: reqId0,
  })
  logHostAiStage({
    chain,
    stage: 'capabilities_response',
    reached: false,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    requestId: reqId0,
  })
  const webrtcReq = decision.choice.selected === 'webrtc_p2p'
  const p2pSr = webrtcReq ? getSessionState(hid) : null
  const p2pSidR = p2pSr?.sessionId?.trim() || null
  const sigPhR = p2pSr?.phase
  const sigOkR =
    !webrtcReq ||
    (Boolean(p2pSidR) && sigPhR !== P2pSessionPhase.failed && sigPhR !== P2pSessionPhase.closed)
  logHostAiStage({
    chain,
    stage: 'signaling',
    reached: webrtcReq,
    success: webrtcReq ? Boolean(sigOkR) : true,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    p2pSessionId: webrtcReq ? p2pSidR : null,
    requestId: reqId0,
    failureCode: webrtcReq ? null : webrtcReq && !sigOkR ? 'P2P_SIGNALING_INCOMPLETE' : null,
  })
  const dcUpR = isP2pDataChannelUpForHandshake(hid)
  const dcOkR = !webrtcReq || dcUpR
  logHostAiStage({
    chain,
    stage: 'datachannel',
    reached: webrtcReq,
    success: webrtcReq ? Boolean(dcOkR) : true,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    p2pSessionId: webrtcReq ? p2pSidR : null,
    requestId: reqId0,
    failureCode: webrtcReq ? null : webrtcReq && !dcOkR ? 'DATACHANNEL_NOT_UP' : null,
  })
  emitTransportDiagnostics(hid, 'request', endpointGateOk, decision)
  if (decision.choice.selected === 'unavailable') {
    const reason = decision.choice.reason
    logHostAiStage({
      chain,
      stage: 'model_projection',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: f0,
      requestId: reqId0,
      phase: 'unavailable',
      failureCode: String(reason),
    })
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
        logHostAiStage({
          chain,
          stage: 'model_projection',
          reached: true,
          success: true,
          handshakeId: hid,
          buildStamp,
          flags: f0,
          requestId: reqId0,
          phase: 'dispatch_p2p',
        })
        touchState(hid, 'request', 'webrtc_p2p', d.reason)
        return { ok: true, status: 200 }
      }
      if (!getP2pInferenceFlags().p2pInferenceHttpFallback) {
        logHostAiStage({
          chain,
          stage: 'model_projection',
          reached: true,
          success: false,
          handshakeId: hid,
          buildStamp,
          flags: f0,
          requestId: reqId0,
          phase: 'p2p_dc_send',
          failureCode: 'DC_SEND_FAILED',
        })
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
        logHostAiStage({
          chain,
          stage: 'model_projection',
          reached: true,
          success: false,
          handshakeId: hid,
          buildStamp,
          flags: f0,
          requestId: reqId0,
          phase: 'p2p_not_wired',
          failureCode: 'P2P_UNAVAILABLE',
        })
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
  const dbHttp = (await getHandshakeDbForInternalInference()) ?? db0
  if (!dbHttp || !canPostInternalInferenceHttpToP2pEndpointIngest(dbHttp, record.p2p_endpoint)) {
    logHostAiStage({
      chain,
      stage: 'model_projection',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: f0,
      requestId: reqId0,
      phase: 'http_ingest',
      failureCode: 'DIRECT_BEAP_INGEST_REQUIRED',
    })
    touchState(hid, 'request', 'unavailable', 'p2p_not_wired')
    return {
      ok: false,
      code: InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED,
      error: 'direct_beap_ingest_required',
    }
  }
  const ep = record.p2p_endpoint?.trim() ?? ''
  logHostAiInferRequestSend({
    handshakeId: hid,
    requestId: request.request_id,
    promptBytes,
    messageCount,
    transport: 'http',
  })
  logHostAiStage({
    chain,
    stage: 'model_projection',
    reached: true,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: f0,
    requestId: reqId0,
    phase: 'dispatch_http',
  })
  return postServiceEnvelopeDirect(
    request,
    ep,
    record.handshake_id,
    outboundP2pBearerToCounterpartyIngest(record) || null,
    {
      request_id: request.request_id,
      sender_device_id: request.sender_device_id,
      target_device_id: request.target_device_id,
      message_type: 'internal_inference_request',
    },
    httpBeapCorr,
  )
}

/**
 * Host → Sandbox: deliver internal_inference_result / internal_inference_error.
 */
export async function sendHostInferenceResult(
  handshakeId: string,
  result: InternalInferenceResultWire | InternalInferenceErrorWire,
  opts: { record: HandshakeRecord; targetEndpoint: string; beapCorrelationId?: string },
  messageType: 'internal_inference_result' | 'internal_inference_error',
): Promise<DirectServiceSendResult> {
  const hid = String(handshakeId ?? '').trim()
  const { record, targetEndpoint, beapCorrelationId: resBeapCorr } = opts
  const resultBeapCorr = (resBeapCorr && resBeapCorr.trim() ? resBeapCorr.trim() : null) || randomUUID()
  const db0 = await getHandshakeDbForInternalInference()
  const f0 = getP2pInferenceFlags()
  let endpointGateOk = false
  if (db0) {
    endpointGateOk = decideInternalInferenceTransport(
      await buildHostAiTransportDeciderInputAsync({
        operationContext: 'result',
        db: db0,
        handshakeRecord: record,
        featureFlags: f0,
      }),
    ).p2pTransportEndpointOpen
  }
  const decision = decideHostAiIntentRoute(hid, 'result', endpointGateOk)
  emitTransportDiagnostics(hid, 'result', endpointGateOk, decision)
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
  const dbRes = (await getHandshakeDbForInternalInference()) ?? db0
  if (!dbRes || !canPostInternalInferenceHttpToP2pEndpointIngest(dbRes, record.p2p_endpoint)) {
    return {
      ok: false,
      code: InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED,
      error: 'direct_beap_ingest_required',
    }
  }
  const post = await postServiceEnvelopeDirect(
    result,
    targetEndpoint,
    record.handshake_id,
    outboundP2pBearerToCounterpartyIngest(record) || null,
    {
      request_id: result.request_id,
      sender_device_id: result.sender_device_id,
      target_device_id: result.target_device_id,
      message_type: messageType as InternalServiceMessageType,
    },
    resultBeapCorr,
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
