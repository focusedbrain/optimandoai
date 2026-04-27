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
import { getP2pInferenceFlags, isWebRtcHostAiArchitectureEnabled } from '../p2pInferenceFlags'
import { requestHostInferenceCapabilitiesOverDataChannel } from '../p2pDc/p2pDcCapabilities'
import { sendHostInferenceRequestOverP2pDataChannel, sendInternalInferenceWireOverP2pDataChannel } from '../p2pDc/p2pDcInference'
import { getSessionState, P2pSessionPhase } from '../p2pSession/p2pInferenceSessionManager'
import { isP2pDataChannelUpForHandshake } from '../p2pSession/p2pSessionWait'
import {
  getHostPublishedMvpDirectP2pIngestUrl,
  peekHostAdvertisedMvpDirectP2pEndpoint,
  tryRepairP2pEndpointFromHostAdvertisement,
  type SandboxToHostHttpDirectIngestResult,
} from '../p2pEndpointRepair'
import type { HostAiSelectedEndpointProvenance } from '../hostAiEndpointCandidate'
import type { HostAiEndpointDiagnostics } from '../../../../src/lib/hostAiUiDiagnostics'
import { logHostAiProbeRoute } from '../hostAiProbeRouteLog'
import { logHostAiRouteSelect } from '../hostAiRouteSelectLog'
import { logHostAiEndpointSelect } from '../hostAiEndpointSelectLog'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import {
  assertP2pEndpointDirect,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
  hostAiSandboxToHostRequestDeviceIds,
  outboundP2pBearerToCounterpartyIngest,
  p2pEndpointKind,
  p2pEndpointMvpClass,
} from '../policy'
import type { HandshakeRecord } from '../../handshake/types'
import { summarizeCapsModelsBriefForLog } from '../hostInferenceCapabilities'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceCapabilitiesResultWire, type InternalInferenceErrorWire, type InternalInferenceRequestWire, type InternalInferenceResultWire, type InternalServiceMessageType } from '../types'
import { logHostAiInferComplete, logHostAiInferError, logHostAiInferRequestSend } from '../hostAiInferLog'
import { logHostAiTransportChoose, logHostAiTransportFallback, logHostAiTransportUnavailable } from './hostAiTransportLog'
import type { HostAiTransport, HostAiTransportIntent, HostAiTransportLogReason } from './hostAiTransportTypes'
import { decideHostAiIntentRoute } from './transportDecide'
import {
  buildHostAiCanonicalRouteResolveInputForDecider,
  buildHostAiTransportDeciderInput,
  buildHostAiTransportDeciderInputAsync,
  decideInternalInferenceTransport,
  deriveHostAiHandshakeRoles,
  type HostAiTransportDeciderResult,
} from './decideInternalInferenceTransport'
import { resolveHostAiRoute } from './hostAiRouteResolve'
import { hostAiDcCapabilityResultBlocksHttpFallback, type HostAiRouteResolveResult } from './hostAiRouteCandidate'

/**
 * Host → Sandbox HTTP delivery after `handleInternalInferenceRequest`: resolver `hostAiVerifiedDirectHttp`
 * is sandbox→Host–centric (localRole=sandbox) and is always false on the Host process. Allow primary
 * legacy HTTP only when it matches the same MVP-direct row gate as inbound core — never after a
 * WebRTC→HTTP fallback (that path requires a verified direct candidate; not ledger-only).
 */
function hostAiVerifiedHttpForHostSendResult(args: {
  dec: HostAiTransportDeciderResult | null
  db: unknown
  record: HandshakeRecord
  webrtcFailureHttpFallback: boolean
}): boolean {
  if (args.dec?.hostAiVerifiedDirectHttp) return true
  if (args.webrtcFailureHttpFallback) return false
  const dr = deriveInternalHostAiPeerRoles(args.record, getInstanceId().trim())
  if (!dr.ok || dr.localRole !== 'host' || dr.peerRole !== 'sandbox') return false
  if (args.record.handshake_type !== 'internal') return false
  return assertP2pEndpointDirect(args.db as any, args.record.p2p_endpoint).ok
}

function logHostAiRouteSelectFromDecider(
  base: {
    handshake_id: string
    local_device_id: string
    peer_device_id: string
    local_role: 'sandbox' | 'host' | 'unknown'
    peer_role: 'sandbox' | 'host' | 'unknown'
    webrtc_available: boolean
    relay_available: boolean
    selected_route_kind: 'webrtc' | 'relay' | 'direct_http' | 'none'
    failure_reason: string | null
  },
  dec: HostAiTransportDeciderResult | null,
): void {
  const direct = Boolean(dec?.hostAiVerifiedDirectHttp)
  logHostAiRouteSelect({
    ...base,
    direct_http_available: direct,
    route_resolve_code: direct ? null : dec?.hostAiRouteResolveFailureCode ?? null,
    route_resolve_reason: direct ? null : dec?.hostAiRouteResolveFailureReason ?? null,
  })
}

/**
 * /beap/ingest `jsonError` body is `{ code, message }` (see p2pServiceDispatch).
 * Used to map Host “no such handshake in local DB” to sandbox-side ledger-asymmetry handling,
 * and to preserve `POLICY_FORBIDDEN` when the body only repeats `message: forbidden_host_role`.
 */
export function parseBeapIngestErrorJsonCode(text: string): string | null {
  try {
    const j = JSON.parse(text) as { code?: unknown; message?: unknown }
    if (typeof j.code === 'string' && j.code.trim()) {
      return j.code.trim()
    }
    if (typeof j.message === 'string' && j.message.trim() === 'forbidden_host_role') {
      return InternalInferenceErrorCode.POLICY_FORBIDDEN
    }
  } catch {
    return null
  }
  return null
}

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
  /** @deprecated Ignored for dial — HTTP uses `resolveHostAiRoute` direct_http endpoint only. */
  ingestUrl?: string
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
function hostAiDiagnosticsFromFailedProv(
  prov: Extract<SandboxToHostHttpDirectIngestResult, { ok: false }>,
  ingestUrl: string,
  currentDevice: string,
  peerHostCoordinationId: string,
): HostAiEndpointDiagnostics {
  const code = prov.code
  const detail = String(prov.host_ai_endpoint_deny_detail ?? '')
  const isPeerMissing = code === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING
  const isLocalProvenance =
    prov.selected_endpoint_provenance === 'local_beap' || detail === 'self_local_beap_selected'

  const selected: string | null = isPeerMissing
    ? null
    : (ingestUrl && ingestUrl.trim()) || prov.ledger_p2p_endpoint || null
  const peerHost = (peerHostCoordinationId && peerHostCoordinationId.trim()) || prov.hostDeviceId
  const selectedOwner: string | null = isPeerMissing
    ? null
    : isLocalProvenance
      ? currentDevice
      : prov.hostDeviceId || null

  return {
    local_device_id: currentDevice,
    peer_host_device_id: peerHost,
    selected_endpoint: selected,
    selected_endpoint_owner: selectedOwner,
    local_beap_endpoint: prov.local_beap_endpoint,
    peer_advertised_beap_endpoint: prov.peer_advertised_beap_endpoint,
    rejection_reason: `${String(prov.code)} (${String(prov.host_ai_endpoint_deny_detail)})`,
  }
}

function hostAiDiagnosticsFromDirectRowDeny(input: {
  currentDevice: string
  peerHost: string
  selectedEndpoint: string
  localBeap: string | null
  peerAdvertised: string | null
  code: string
  detail: string
}): HostAiEndpointDiagnostics {
  return {
    local_device_id: input.currentDevice,
    peer_host_device_id: input.peerHost,
    selected_endpoint: input.selectedEndpoint,
    selected_endpoint_owner: input.peerHost,
    local_beap_endpoint: input.localBeap,
    peer_advertised_beap_endpoint: input.peerAdvertised,
    rejection_reason: `${input.code} (${input.detail})`,
  }
}

export type ListHostCapabilitiesFailure = {
  ok: false
  reason: string
  responseStatus?: number
  networkErrorMessage?: string
  /**
   * When `reason` is a terminal endpoint-trust / provenance `InternalInferenceErrorCode`, mirrors
   * `resolveSandboxToHostHttpDirectIngest` (`self_endpoint_selected` vs `host_owner_mismatch`, etc.) for UI.
   */
  hostAiEndpointDenyDetail?: string
  hostAiEndpointDiagnostics?: HostAiEndpointDiagnostics
}

export async function listHostCapabilities(
  handshakeId: string,
  opts: ListHostCapabilitiesOpts,
): Promise<{ ok: true; wire: InternalInferenceCapabilitiesResultWire } | ListHostCapabilitiesFailure> {
  const hid = handshakeId.trim()
  const { record, token, timeoutMs, correlationChain: chainOpt, beapCorrelationId: corrOpt } = opts
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
  const decInput = db
    ? await buildHostAiTransportDeciderInputAsync({
        operationContext: 'capabilities',
        db,
        handshakeRecord: record,
        featureFlags: f,
      })
    : null
  const dec = decInput ? decideInternalInferenceTransport(decInput) : null
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

  const cids = hostAiSandboxToHostRequestDeviceIds(record, getInstanceId().trim())
  if (!cids.ok) {
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
    const m = 'missing coordination ids (sandbox_to_host roles)'
    console.log(
      `[HOST_INFERENCE_P2P] request_failed code=missing_coordination_ids message=${redactP2pLogLine(m)} handshake=${hid}`,
    )
    console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=missing_coordination_ids`)
    return { ok: false, reason: 'missing_coordination_ids' }
  }
  const localSandbox = cids.requester
  const peerHost = cids.targetHost

  let routeRes: HostAiRouteResolveResult | null = null
  if (db && decInput) {
    const canonical = buildHostAiCanonicalRouteResolveInputForDecider(
      db,
      record,
      decInput.sessionState,
      decInput.relayHostAiP2pSignaling ?? 'na',
      decInput.legacyEndpointInfo,
    )
    routeRes = resolveHostAiRoute(canonical, { emitLog: false })
    if (routeRes.ok) {
      logHostAiProbeRoute({
        handshake_id: hid,
        selected_route_kind: routeRes.route.transport,
        selected_endpoint_source: routeRes.route.source,
        endpoint_owner_device_id: routeRes.route.ownerDeviceId,
        local_device_id: localSandbox,
        peer_host_device_id: peerHost,
        decision: 'allow',
        reason: `ok:${routeRes.route.transport}`,
      })
    } else {
      logHostAiProbeRoute({
        handshake_id: hid,
        selected_route_kind: 'none',
        selected_endpoint_source: 'none',
        endpoint_owner_device_id: null,
        local_device_id: localSandbox,
        peer_host_device_id: peerHost,
        decision: 'deny',
        reason: `${routeRes.code}:${routeRes.reason}`,
      })
    }
  }

  let resolvedHttpIngestUrl: string | null = null

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
      logHostAiRouteSelectFromDecider(
        {
          handshake_id: hid,
          local_device_id: localSandbox,
          peer_device_id: peerHost,
          local_role: cids.localRole,
          peer_role: cids.peerRole,
          webrtc_available: false,
          relay_available: p2pEndpointKind(db, record.p2p_endpoint) === 'relay',
          selected_route_kind: 'none',
          failure_reason: 'p2p_session_not_allocated_yet',
        },
        dec,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=probe_transport_not_ready (no p2p session yet)`)
      return { ok: false, reason: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY }
    }
    if (!routeRes?.ok || routeRes.route.transport !== 'webrtc_dc') {
      logHostAiProbeRoute({
        handshake_id: hid,
        selected_route_kind: routeRes?.ok ? routeRes.route.transport : 'none',
        selected_endpoint_source: routeRes?.ok ? routeRes.route.source : 'none',
        endpoint_owner_device_id: routeRes?.ok ? routeRes.route.ownerDeviceId : null,
        local_device_id: localSandbox,
        peer_host_device_id: peerHost,
        decision: 'deny',
        reason: 'webrtc_requires_verified_dc_route',
      })
      touchState(hid, 'capabilities', 'unavailable', 'webrtc_route_not_verified_dc')
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=probe_transport_not_ready (no verified webrtc_dc route)`)
      return { ok: false, reason: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY }
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
      logHostAiRouteSelectFromDecider(
        {
          handshake_id: hid,
          local_device_id: localSandbox,
          peer_device_id: peerHost,
          local_role: cids.localRole,
          peer_role: cids.peerRole,
          webrtc_available: true,
          relay_available: p2pEndpointKind(db, record.p2p_endpoint) === 'relay',
          selected_route_kind: 'webrtc',
          failure_reason: null,
        },
        dec,
      )
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
      const errCode = dcr.code
      if (hostAiDcCapabilityResultBlocksHttpFallback(errReason, errCode)) {
        const terminalReason =
          typeof errCode === 'string' && errCode.trim()
            ? errCode.trim()
            : errReason === 'not_sandbox_requester' || errReason === 'role'
              ? InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED
              : errReason
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
          failureCode: terminalReason,
        })
        console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=${terminalReason} (no_http_fallback)`)
        touchState(hid, 'capabilities', 'unavailable', terminalReason)
        const roleDiag =
          terminalReason === InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED ||
          terminalReason === InternalInferenceErrorCode.POLICY_FORBIDDEN ||
          errReason === 'role' ||
          errReason === 'not_sandbox_requester'
            ? {
                local_device_id: localSandbox,
                peer_host_device_id: peerHost,
                selected_endpoint: null as string | null,
                selected_endpoint_owner: null as string | null,
                local_beap_endpoint: null as string | null,
                peer_advertised_beap_endpoint: null as string | null,
                rejection_reason: `${terminalReason} (${errReason})`,
                local_role: String(cids.localRole ?? 'unknown'),
                peer_role: String(cids.peerRole ?? 'unknown'),
                requester_role: 'sandbox',
                receiver_role: 'host',
              }
            : undefined
        return { ok: false, reason: terminalReason, hostAiEndpointDiagnostics: roleDiag }
      }
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
        const u = decInput?.hostAiVerifiedDirectIngestUrl?.trim()
        if (!u) {
          touchState(hid, 'capabilities', 'unavailable', 'p2p_not_ready_no_fallback')
          return { ok: false, reason: errReason }
        }
        logHostAiTransportFallback({
          handshakeId: hid,
          from: 'webrtc_p2p',
          to: 'http_direct',
          reason: 'p2p_dc_error_fallback_http',
        })
        touchState(hid, 'capabilities', 'http_direct', 'p2p_dc_error_fallback_http')
        console.log(`[HOST_INFERENCE_CAPS] falling_back_to_http reason=${errReason} handshake=${hid}`)
        logHostAiProbeRoute({
          handshake_id: hid,
          selected_route_kind: 'direct_http',
          selected_endpoint_source: 'verified_peer_fallback',
          endpoint_owner_device_id: peerHost,
          local_device_id: localSandbox,
          peer_host_device_id: peerHost,
          decision: 'allow',
          reason: 'dc_error_fallback_verified_direct',
        })
        resolvedHttpIngestUrl = u
      } else {
        touchState(hid, 'capabilities', 'unavailable', 'p2p_not_ready_no_fallback')
        return { ok: false, reason: errReason }
      }
    }
  }

  // Host AI caps HTTP POST uses only `resolvedHttpIngestUrl` (resolver-verified). Do not treat `canPost(ledger)`
  // as dial viability — ledger `p2p_endpoint` is untrusted for peer-Host ownership.
  const ledgerRowNotSyntacticDirectIngest = db ? p2pEndpointKind(db, record.p2p_endpoint) !== 'direct' : true

  if (!resolvedHttpIngestUrl && decision.choice.selected === 'http_direct') {
    if (!db || !routeRes) {
      touchState(hid, 'capabilities', 'unavailable', 'p2p_not_wired')
      return { ok: false, reason: 'http_ingest_requires_direct_beap' }
    }
    if (!routeRes.ok || routeRes.route.transport !== 'direct_http' || !routeRes.route.endpoint?.trim()) {
      logHostAiProbeRoute({
        handshake_id: hid,
        selected_route_kind: routeRes.ok ? routeRes.route.transport : 'none',
        selected_endpoint_source: routeRes.ok ? routeRes.route.source : 'none',
        endpoint_owner_device_id: routeRes.ok ? routeRes.route.ownerDeviceId : null,
        local_device_id: localSandbox,
        peer_host_device_id: peerHost,
        decision: 'deny',
        reason: 'http_direct_requires_resolver_direct_http',
      })
      touchState(hid, 'capabilities', 'unavailable', 'host_direct_beap_unavailable')
      const code = !routeRes.ok ? routeRes.code : InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=${code} (no verified direct_http route)`)
      const epK = db ? p2pEndpointKind(db, record.p2p_endpoint) : 'missing'
      return {
        ok: false,
        reason: code,
        hostAiEndpointDiagnostics: {
          local_device_id: getInstanceId().trim(),
          peer_host_device_id: peerHost,
          selected_endpoint: null,
          selected_endpoint_owner: null,
          local_beap_endpoint: null,
          peer_advertised_beap_endpoint: null,
          rejection_reason: !routeRes.ok ? `${routeRes.code} (${routeRes.reason})` : 'no_verified_direct_http',
          webrtc_available: Boolean(
            dec?.preferredTransport === 'webrtc_p2p' || isP2pDataChannelUpForHandshake(hid),
          ),
          direct_http_available: Boolean(dec?.hostAiVerifiedDirectHttp),
          relay_available: epK === 'relay',
        },
      }
    }
    resolvedHttpIngestUrl = routeRes.route.endpoint.trim()
    logHostAiProbeRoute({
      handshake_id: hid,
      selected_route_kind: 'direct_http',
      selected_endpoint_source: routeRes.route.source,
      endpoint_owner_device_id: routeRes.route.ownerDeviceId,
      local_device_id: localSandbox,
      peer_host_device_id: peerHost,
      decision: 'allow',
      reason: 'http_capabilities_verified_direct',
    })
  }

  if (!resolvedHttpIngestUrl && ledgerRowNotSyntacticDirectIngest) {
    const p2pStackOn = f.p2pInferenceEnabled && f.p2pInferenceWebrtcEnabled && f.p2pInferenceSignalingEnabled
    /** Relay / signaling `p2p_endpoint` is not a BEAP HTTP POST target; WebRTC+DC (or P2P setup) is still valid. */
    if (p2pStackOn) {
      logHostAiRouteSelectFromDecider(
        {
          handshake_id: hid,
          local_device_id: localSandbox,
          peer_device_id: peerHost,
          local_role: cids.localRole,
          peer_role: cids.peerRole,
          webrtc_available: isP2pDataChannelUpForHandshake(hid),
          relay_available: p2pEndpointKind(db, record.p2p_endpoint) === 'relay',
          selected_route_kind: isP2pDataChannelUpForHandshake(hid)
            ? 'webrtc'
            : p2pEndpointKind(db, record.p2p_endpoint) === 'relay'
              ? 'relay'
              : 'none',
          failure_reason: null,
        },
        dec,
      )
      logHostAiStage({
        chain,
        stage: 'capabilities_request',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        failureCode: 'HTTP_INGEST_N_A_USE_P2P',
      })
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        failureCode: 'HTTP_INGEST_N_A_USE_P2P',
      })
      touchState(hid, 'capabilities', 'unavailable', 'relay_uses_p2p_not_direct_http')
      console.log(
        `[HOST_INFERENCE_CAPS] skip_direct_http_ingest handshake=${hid} p2p_stack_on=1 (relay or non-POST endpoint; use WebRTC)`,
      )
      return { ok: false, reason: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY }
    }
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
    logHostAiRouteSelectFromDecider(
      {
        handshake_id: hid,
        local_device_id: localSandbox,
        peer_device_id: peerHost,
        local_role: cids.localRole,
        peer_role: cids.peerRole,
        webrtc_available: isP2pDataChannelUpForHandshake(hid),
        relay_available: p2pEndpointKind(db, record.p2p_endpoint) === 'relay',
        selected_route_kind: 'none',
        failure_reason: 'http_ingest_requires_direct_beap',
      },
      dec,
    )
    console.log(
      `[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=http_ingest_requires_direct_beap`,
    )
    return { ok: false, reason: 'http_ingest_requires_direct_beap' }
  }
  if (!resolvedHttpIngestUrl) {
    return { ok: false, reason: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY }
  }

  if (!db) {
    return { ok: false, reason: 'http_ingest_requires_direct_beap' }
  }

  const currentDevice = getInstanceId().trim()
  const hostRecordOwnerId = (coordinationDeviceIdForHandshakeDeviceRole(record, 'host') ?? '').trim()
  const urlToUse = resolvedHttpIngestUrl
  const localBeapLog = getHostPublishedMvpDirectP2pIngestUrl(db as any)
  const peerAdLog = peekHostAdvertisedMvpDirectP2pEndpoint(hid)
  const endpointProv: HostAiSelectedEndpointProvenance =
    routeRes?.ok && routeRes.route.transport === 'direct_http'
      ? routeRes.route.source === 'server_attested_relay'
        ? 'relay_control_plane'
        : 'peer_advertised_header'
      : 'peer_advertised_header'

  {
    if (!hostRecordOwnerId) {
      logHostAiEndpointSelect({
        handshake_id: hid,
        current_device_id: currentDevice,
        local_derived_role: cids.localRole,
        peer_device_id: peerHost,
        peer_derived_role: cids.peerRole,
        selected_endpoint: urlToUse,
        selected_endpoint_provenance: endpointProv,
        host_ai_resolution_category: 'rejected_no_peer_host_beap',
        selected_endpoint_record_device_id: hostRecordOwnerId,
        selected_endpoint_record_role: 'unknown',
        local_beap_endpoint: localBeapLog,
        peer_advertised_beap_endpoint: peerAdLog,
        repaired_from_local_endpoint: false,
        endpoint_owner_device_id: peerHost,
        endpoint_owner_role: 'unknown',
        decision: 'deny',
        reason: 'HOST_DIRECT_ENDPOINT_MISSING',
      })
      logHostAiStage({
        chain,
        stage: 'capabilities_request',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        failureCode: 'HOST_DIRECT_ENDPOINT_MISSING',
      })
      touchState(hid, 'capabilities', 'unavailable', 'host_direct_endpoint_missing')
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=HOST_DIRECT_ENDPOINT_MISSING`)
      return {
        ok: false,
        reason: 'HOST_DIRECT_ENDPOINT_MISSING',
        hostAiEndpointDenyDetail: 'no_host_owner_on_row',
        hostAiEndpointDiagnostics: hostAiDiagnosticsFromDirectRowDeny({
          currentDevice,
          peerHost,
          selectedEndpoint: urlToUse,
          localBeap: localBeapLog,
          peerAdvertised: peerAdLog,
          code: 'HOST_DIRECT_ENDPOINT_MISSING',
          detail: 'no_host_owner_on_row',
        }),
      }
    }
    if (hostRecordOwnerId !== peerHost) {
      logHostAiEndpointSelect({
        handshake_id: hid,
        current_device_id: currentDevice,
        local_derived_role: cids.localRole,
        peer_device_id: peerHost,
        peer_derived_role: cids.peerRole,
        selected_endpoint: urlToUse,
        selected_endpoint_provenance: endpointProv,
        host_ai_resolution_category: 'rejected_owner_mismatch',
        host_ai_endpoint_deny_detail: 'host_owner_mismatch',
        selected_endpoint_record_device_id: hostRecordOwnerId,
        selected_endpoint_record_role: 'host',
        local_beap_endpoint: localBeapLog,
        peer_advertised_beap_endpoint: peerAdLog,
        repaired_from_local_endpoint: false,
        endpoint_owner_device_id: peerHost,
        endpoint_owner_role: 'host',
        decision: 'deny',
        reason: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
      })
      logHostAiStage({
        chain,
        stage: 'capabilities_request',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        failureCode: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
      })
      touchState(hid, 'capabilities', 'unavailable', 'host_ai_endpoint_owner_mismatch')
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=HOST_AI_ENDPOINT_OWNER_MISMATCH`)
      return {
        ok: false,
        reason: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
        hostAiEndpointDenyDetail: 'host_owner_mismatch',
        hostAiEndpointDiagnostics: hostAiDiagnosticsFromDirectRowDeny({
          currentDevice,
          peerHost,
          selectedEndpoint: urlToUse,
          localBeap: localBeapLog,
          peerAdvertised: peerAdLog,
          code: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
          detail: 'host_owner_mismatch',
        }),
      }
    }
    if (currentDevice === peerHost) {
      logHostAiEndpointSelect({
        handshake_id: hid,
        current_device_id: currentDevice,
        local_derived_role: cids.localRole,
        peer_device_id: peerHost,
        peer_derived_role: cids.peerRole,
        selected_endpoint: urlToUse,
        selected_endpoint_provenance: endpointProv,
        host_ai_resolution_category: 'rejected_self_endpoint',
        host_ai_endpoint_deny_detail: 'self_endpoint_selected',
        selected_endpoint_record_device_id: hostRecordOwnerId,
        selected_endpoint_record_role: 'host',
        local_beap_endpoint: localBeapLog,
        peer_advertised_beap_endpoint: peerAdLog,
        repaired_from_local_endpoint: false,
        endpoint_owner_device_id: peerHost,
        endpoint_owner_role: 'host',
        decision: 'deny',
        reason: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
      })
      logHostAiStage({
        chain,
        stage: 'capabilities_request',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        failureCode: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
      })
      touchState(hid, 'capabilities', 'unavailable', 'host_ai_endpoint_owner_mismatch')
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=HOST_AI_ENDPOINT_OWNER_MISMATCH`)
      return {
        ok: false,
        reason: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
        hostAiEndpointDenyDetail: 'self_endpoint_selected',
        hostAiEndpointDiagnostics: hostAiDiagnosticsFromDirectRowDeny({
          currentDevice,
          peerHost,
          selectedEndpoint: urlToUse,
          localBeap: localBeapLog,
          peerAdvertised: peerAdLog,
          code: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
          detail: 'self_endpoint_selected',
        }),
      }
    }
  }
  logHostAiEndpointSelect({
    handshake_id: hid,
    current_device_id: currentDevice,
    local_derived_role: cids.localRole,
    peer_device_id: peerHost,
    peer_derived_role: cids.peerRole,
    selected_endpoint: urlToUse,
    selected_endpoint_provenance: endpointProv,
    host_ai_resolution_category:
      endpointProv === 'relay_control_plane' ? 'accepted_relay_ad' : 'accepted_peer_header',
    selected_endpoint_record_device_id: hostRecordOwnerId,
    selected_endpoint_record_role: 'host',
    local_beap_endpoint: localBeapLog,
    peer_advertised_beap_endpoint: peerAdLog,
    repaired_from_local_endpoint: false,
    endpoint_owner_device_id: peerHost,
    endpoint_owner_role: 'host',
    decision: 'probe',
  })

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
    const res = await fetch(urlToUse, {
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
    const errText = !res.ok ? await res.text() : ''
    const ingestErrCode = !res.ok && errText ? parseBeapIngestErrorJsonCode(errText) : null
    if (ingestErrCode === InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE) {
      const fc = 'NO_ACTIVE_INTERNAL_HOST_HANDSHAKE'
      logHostAiStage({
        chain,
        stage: 'capabilities_response',
        reached: true,
        success: false,
        handshakeId: hid,
        buildStamp,
        flags: f,
        requestId: capHttpReqId,
        failureCode: fc,
      })
      console.log(
        `[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=${fc} (host_ledger_missing peer expects handshake)`,
      )
      return { ok: false, reason: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, responseStatus: res.status }
    }
    if (res.status === 401 || res.status === 403) {
      const reason = ingestErrCode?.trim() ? ingestErrCode.trim() : 'forbidden'
      const m = reason === 'forbidden' ? 'forbidden' : reason
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
        `[HOST_INFERENCE_P2P] request_failed code=${reason} message=${redactP2pLogLine(m)} handshake=${hid}`,
      )
      console.log(`[HOST_INFERENCE_CAPS] response_error handshake=${hid} code=${reason}`)
      return { ok: false, reason, responseStatus: res.status }
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
    console.log(
      `[SBX_AI_CAPS_WIRE_RECEIVED] ${JSON.stringify({
        route: 'direct_http_post_beap_ingest_json_body',
        raw_type:
          typeof (j as { type?: unknown }).type === 'string'
            ? (j as { type: string }).type
            : String((j as { type?: unknown }).type ?? ''),
        policy_enabled: w.policy_enabled === true,
        active_local_llm: w.active_local_llm ?? null,
        active_chat_model: w.active_chat_model ?? null,
        models_length: Array.isArray(w.models) ? w.models.length : 0,
        models_brief: summarizeCapsModelsBriefForLog(w.models),
        inference_error_code: w.inference_error_code ?? null,
        request_id: w.request_id,
        handshake_id: w.handshake_id,
        sender_device_id: w.sender_device_id,
        target_device_id: w.target_device_id,
      })}`,
    )
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
  const verifiedHttpUrl = (dec0?.hostAiVerifiedDirectIngestUrl ?? '').trim()
  if (!dbHttp || !verifiedHttpUrl) {
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
      failureCode: 'VERIFIED_DIRECT_HTTP_REQUIRED',
    })
    touchState(hid, 'request', 'unavailable', 'p2p_not_wired')
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE,
      error: 'verified_direct_http_required',
    }
  }
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
    verifiedHttpUrl,
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
  const decResult = db0
    ? decideInternalInferenceTransport(
        await buildHostAiTransportDeciderInputAsync({
          operationContext: 'result',
          db: db0,
          handshakeRecord: record,
          featureFlags: f0,
        }),
      )
    : null
  const endpointGateOk = decResult?.p2pTransportEndpointOpen ?? false
  const decision = decideHostAiIntentRoute(hid, 'result', endpointGateOk)
  emitTransportDiagnostics(hid, 'result', endpointGateOk, decision)
  let webrtcFailureHttpFallback = false
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
      webrtcFailureHttpFallback = true
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
      webrtcFailureHttpFallback = true
      touchState(hid, 'result', 'http_direct', 'p2p_not_wired')
    }
  } else {
    touchState(hid, 'result', d.selected, d.reason)
  }
  const dbRes = (await getHandshakeDbForInternalInference()) ?? db0
  const decForVerified =
    dbRes && dbRes !== db0
      ? decideInternalInferenceTransport(
          await buildHostAiTransportDeciderInputAsync({
            operationContext: 'result',
            db: dbRes,
            handshakeRecord: record,
            featureFlags: f0,
          }),
        )
      : decResult
  if (
    !dbRes ||
    !hostAiVerifiedHttpForHostSendResult({
      dec: decForVerified,
      db: dbRes,
      record,
      webrtcFailureHttpFallback,
    })
  ) {
    return {
      ok: false,
      code: InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED,
      error: 'verified_direct_http_required',
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
