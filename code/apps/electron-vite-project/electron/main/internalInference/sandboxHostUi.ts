/**
 * Sandbox renderer support: list internal Host handshakes, probe Host policy over direct P2P.
 * Prefers `internal_inference_capabilities_request` → `internal_inference_capabilities_result` (POST /beap/ingest,
 * not inbox, not a BEAP message). Falls back to GET /beap/internal-inference-policy.
 */

import { randomUUID } from 'crypto'
import { getHandshakeRecord, listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from './errors'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertLedgerRolesSandboxToHost,
  assertSandboxRequestToHost,
  coordinationDeviceIdForHandshakeDeviceRole,
  localCoordinationDeviceId,
  outboundP2pBearerToCounterpartyIngest,
  p2pEndpointKind,
  p2pEndpointKindForProbeLog,
  type P2pEndpointProbeLogKind,
  peerCoordinationDeviceId,
} from './policy'
import {
  hostAiPairingListBlock,
  recordHostAiLedgerAsymmetric,
  recordHostAiReciprocalCapabilitiesSuccess,
} from './hostAiPairingStateStore'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { ingestUrlMatchesThisDevicesMvpDirectBeap } from './p2pEndpointRepair'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { P2pSessionPhase, getSessionState } from './p2pSession/p2pInferenceSessionManager'
import {
  HOST_AI_CAPABILITY_DC_WAIT_MS,
  isP2pDataChannelUpForHandshake,
  p2pCapabilityDcWaitOutcomeLogReason,
  waitForP2pDataChannelOpenOrTerminal,
  type P2pCapabilityDcWaitOutcome,
} from './p2pSession/p2pSessionWait'
import { getHostAiBuildStamp, logHostAiStage, newHostAiCorrelationChain } from './hostAiStageLog'
import type { InternalInferenceCapabilitiesResultWire } from './types'
import { listHostCapabilities, parseBeapIngestErrorJsonCode } from './transport/internalInferenceTransport'
import { logHostAiProbeRoute } from './hostAiProbeRouteLog'
import { isHostAiProbeTerminalNoPolicyFallback } from './transport/hostAiRouteCandidate'
import {
  buildHostAiCanonicalRouteResolveInputForDecider,
  buildHostAiTransportDeciderInputAsync,
  decideHostAiTransport,
  decideInternalInferenceTransport,
  deriveHostAiHandshakeRoles,
} from './transport/decideInternalInferenceTransport'
import { resolveHostAiRoute } from './transport/hostAiRouteResolve'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import { fetchSandboxOllamaDirectTags } from './sandboxHostAiOllamaDirectTags'
import { logSbxHostAiRefreshDecision } from './sandboxHostAiListRefreshDecision'
import {
  buildSyntheticOkProbeFromOllamaDirectTags,
  hostComputerNameFromHandshakeRecord,
} from './sandboxHostAiOllamaDirectSyntheticProbe'

/** Throttle [HOST_AI_STAGE] selector_target while P2P is in starting/signaling (same handshake). */
const lastHostAiSelectorTargetStageByHandshake = new Map<string, number>()
const HOST_AI_SELECTOR_TARGET_STAGE_LOG_MIN_MS = 5_000

export interface SandboxHostInferenceCandidate {
  handshakeId: string
  /** Shown in UI (counterparty “computer name”). */
  hostDisplayName: string
  hostRoleLabel: 'Host orchestrator'
  /** Formatted e.g. 482-917 when 6 digits. */
  pairingCodeDisplay: string
  directP2pAvailable: boolean
  /** Hostname from direct URL when parseable. */
  endpointHostLabel: string | null
}

function peerHostComputerName(r: HandshakeRecord): string {
  if (r.local_role === 'initiator') {
    if (r.initiator_device_role === 'host') {
      return (r.initiator_device_name?.trim() || 'This computer (Host)').trim()
    }
    return (r.acceptor_device_name?.trim() || 'Host').trim()
  }
  if (r.acceptor_device_role === 'host') {
    return (r.acceptor_device_name?.trim() || 'This computer (Host)').trim()
  }
  return (r.initiator_device_name?.trim() || 'Host').trim()
}

function formatPairingCode(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '').trim()
  if (s.length === 6) {
    return `${s.slice(0, 3)}-${s.slice(3)}`
  }
  return s || '—'
}

function hostAiCapabilitiesAttemptTerminalNoPolicyGet(cap: {
  ok: boolean
  reason?: string
  hostAiEndpointDenyDetail?: string
}): cap is { ok: false; reason: string } {
  if (cap.ok) return false
  return isHostAiProbeTerminalNoPolicyFallback({
    ok: false,
    reason: typeof cap.reason === 'string' ? cap.reason : '',
    hostAiEndpointDenyDetail: cap.hostAiEndpointDenyDetail,
  })
}

export function policyProbeUrlFromP2pIngest(ingestUrl: string): string {
  const t = ingestUrl.trim()
  if (/\/beap\/ingest\/?$/i.test(t)) {
    return t.replace(/\/beap\/ingest\/?$/i, '/beap/internal-inference-policy')
  }
  try {
    const u = new URL(t)
    u.pathname = '/beap/internal-inference-policy'
    return u.href
  } catch {
    return t
  }
}

function endpointHostLabel(ingestUrl: string | null | undefined): string | null {
  const ep = typeof ingestUrl === 'string' ? ingestUrl.trim() : ''
  if (!ep) return null
  try {
    return new URL(ep).hostname
  } catch {
    return null
  }
}

/**
 * List ACTIVE internal handshakes where this device is Sandbox and peer is Host.
 */
export async function listSandboxHostInferenceCandidates(): Promise<SandboxHostInferenceCandidate[]> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return []
  }
  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  const out: SandboxHostInferenceCandidate[] = []
  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) {
      continue
    }
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      continue
    }
    const direct = assertP2pEndpointDirect(db, ar.record.p2p_endpoint)
    const directOk = direct.ok
    out.push({
      handshakeId: ar.record.handshake_id,
      hostDisplayName: peerHostComputerName(ar.record),
      hostRoleLabel: 'Host orchestrator',
      pairingCodeDisplay: formatPairingCode(ar.record.internal_peer_pairing_code),
      directP2pAvailable: directOk,
      endpointHostLabel: endpointHostLabel(ar.record.p2p_endpoint),
    })
  }
  return out
}

/** A–Q labels for `probeHostInferencePolicyFromSandbox` direct P2P capability diagnostics (`K` = catch-all). */
export type P2pCapabilityProbeLetter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'

export const P2P_CAPABILITY_PROBE = {
  ENDPOINT_MISSING: 'A' as const,
  ENDPOINT_IS_RELAY: 'B' as const,
  ENDPOINT_IS_LOCALHOST: 'C' as const,
  ENDPOINT_STALE_LAN_IP: 'D' as const,
  HOST_P2P_SERVER_NOT_RUNNING: 'E' as const,
  HOST_P2P_SERVER_BOUND_LOCAL_ONLY: 'F' as const,
  FIREWALL_OR_NETWORK_TIMEOUT: 'G' as const,
  /** HTTP 401/403 / missing token before probe (pairing). */
  AUTH_REJECTED: 'H' as const,
  HOST_HANDLER_NOT_REACHED: 'I' as const,
  HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL: 'J' as const,
  UNKNOWN: 'K' as const,
  /** HTTP 429 on capabilities / policy probe. */
  RATE_LIMITED: 'L' as const,
  /** HTTP 5xx / gateway error on probe path. */
  HOST_ERROR: 'M' as const,
  /** Network / DNS / generic transport failure (no specific HTTP status). */
  HOST_TRANSPORT_UNREACHABLE: 'N' as const,
  /** Body parse / unexpected JSON shape after HTTP success. */
  INVALID_RESPONSE: 'O' as const,
  /** Host’s local Ollama/provider unreachable (wire OLLAMA_UNAVAILABLE / PROBE_OLLAMA_UNAVAILABLE). */
  OLLAMA_LOCAL_DOWN: 'P' as const,
  /** Data channel / transport not ready — probe not sent (transient). */
  TRANSPORT_NOT_READY: 'Q' as const,
}

/**
 * Maps POST/GET capability probe outcomes to stable `InternalInferenceErrorCode` values
 * (so logs/UI never blame “Ollama” for gateway 429/5xx or auth failures).
 */
export function probeFailureInternalInferenceCodeFromCapabilityAttempt(args: {
  getHttpStatus?: number
  postReason: string
  postResponseStatus?: number
  getPhase?: 'none' | 'aborted' | 'http' | 'json' | 'parse'
  networkMessage?: string
}): InternalInferenceErrorCodeType {
  const { postReason: pr, postResponseStatus: fromPost, getHttpStatus: fromGet, getPhase, networkMessage } = args
  if (getPhase === 'aborted') {
    return InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE
  }
  const httpFromReason = /^http_(\d+)$/.exec(pr)
  const reasonNum = httpFromReason ? parseInt(httpFromReason[1], 10) : undefined
  const status =
    fromGet != null && fromGet > 0
      ? fromGet
      : fromPost != null && fromPost > 0
        ? fromPost
        : reasonNum

  if (pr === 'invalid_response' || pr === 'wrong_type') {
    return InternalInferenceErrorCode.PROBE_INVALID_RESPONSE
  }
  if (getPhase === 'parse') {
    return InternalInferenceErrorCode.PROBE_INVALID_RESPONSE
  }

  if (pr === 'forbidden' || status === 401 || status === 403) {
    return InternalInferenceErrorCode.PROBE_AUTH_REJECTED
  }
  if (status === 429) {
    return InternalInferenceErrorCode.PROBE_RATE_LIMITED
  }
  if (status != null && status >= 500 && status <= 599) {
    return InternalInferenceErrorCode.PROBE_HOST_ERROR
  }
  if (status != null && status >= 400 && status < 500) {
    return InternalInferenceErrorCode.PROBE_HOST_ERROR
  }

  if (pr === 'timeout') {
    return InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE
  }
  if (pr === 'network') {
    return InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE
  }

  const nm = (networkMessage ?? '').toLowerCase()
  const nmNorm = nm.replace(/_/g, ' ')
  if (nm.includes('aborterror') || nm.includes('the user aborted')) {
    return InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE
  }
  if (
    nm.includes('econnrefused') ||
    nm.includes('connection refused') ||
    nm.includes('enotfound') ||
    nm.includes('eai_again') ||
    nm.includes('ehostunreach') ||
    nm.includes('enetunreach') ||
    nm.includes('etimedout') ||
    nmNorm.includes('timed out')
  ) {
    return InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE
  }

  return InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE
}

function isPrivateIPv4Host(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false
  const p = hostname.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n > 255)) return false
  const [a, b] = p
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function hostFromP2pUrlForProbe(ep: string): string {
  const t = typeof ep === 'string' ? ep.trim() : ''
  if (!t) return ''
  try {
    return new URL(t).hostname
  } catch {
    return ''
  }
}

function safeP2pLogMessage(m: string | undefined | null): string {
  const s = (m ?? '')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return s.length > 200 ? `${s.slice(0, 197)}...` : s
}

/**
 * Heuristic A–Q classification for direct P2P capability-probe outcomes (client-side; complements
 * `probeFailureInternalInferenceCodeFromCapabilityAttempt` for Sandbox UI / logs).
 */
export function classifyP2pCapabilityProbeFailure(args: {
  endpoint: string
  endpointKind: P2pEndpointProbeLogKind
  postReason: string
  postResponseStatus?: number
  getResponseStatus?: number
  getPhase?: 'none' | 'aborted' | 'http' | 'json' | 'parse'
  networkMessage?: string
}): P2pCapabilityProbeLetter {
  const { endpointKind, postReason, postResponseStatus, getResponseStatus, getPhase, networkMessage } = args
  if (endpointKind === 'missing') return P2P_CAPABILITY_PROBE.ENDPOINT_MISSING
  if (endpointKind === 'relay') return P2P_CAPABILITY_PROBE.ENDPOINT_IS_RELAY
  if (endpointKind === 'localhost') {
    if (postReason === 'forbidden' || postResponseStatus === 401 || postResponseStatus === 403) {
      return P2P_CAPABILITY_PROBE.AUTH_REJECTED
    }
    return P2P_CAPABILITY_PROBE.ENDPOINT_IS_LOCALHOST
  }
  if (
    postReason === 'forbidden' ||
    postReason === 'invalid_response' ||
    postReason === 'wrong_type' ||
    postResponseStatus === 401 ||
    postResponseStatus === 403
  ) {
    if (postReason === 'invalid_response' || postReason === 'wrong_type') {
      return P2P_CAPABILITY_PROBE.INVALID_RESPONSE
    }
    return P2P_CAPABILITY_PROBE.AUTH_REJECTED
  }
  if (postReason === 'timeout') {
    return P2P_CAPABILITY_PROBE.FIREWALL_OR_NETWORK_TIMEOUT
  }
  if (getPhase === 'aborted' && (getResponseStatus == null || getResponseStatus === 0)) {
    return P2P_CAPABILITY_PROBE.FIREWALL_OR_NETWORK_TIMEOUT
  }
  const n = (networkMessage ?? '').toLowerCase()
  const nNorm = n.replace(/_/g, ' ')
  if (n.includes('aborterror') || n.includes('the user aborted')) {
    return P2P_CAPABILITY_PROBE.FIREWALL_OR_NETWORK_TIMEOUT
  }
  if (
    n.includes('ehostunreach') ||
    n.includes('host unreachable') ||
    n.includes('enetunreach') ||
    n.includes('no route to host') ||
    n.includes('network is unreachable')
  ) {
    const h = hostFromP2pUrlForProbe(args.endpoint)
    if (h && (isPrivateIPv4Host(h) || h.includes('.'))) {
      return P2P_CAPABILITY_PROBE.ENDPOINT_STALE_LAN_IP
    }
  }
  if (n.includes('econnrefused') || n.includes('connection refused')) {
    return P2P_CAPABILITY_PROBE.HOST_P2P_SERVER_NOT_RUNNING
  }
  if (getPhase === 'parse') {
    return P2P_CAPABILITY_PROBE.INVALID_RESPONSE
  }
  const httpN = (() => {
    const m = /^http_(\d+)$/.exec(postReason)
    return m ? parseInt(m[1], 10) : (postResponseStatus ?? (getResponseStatus && getResponseStatus > 0 ? getResponseStatus : undefined))
  })()
  if (httpN != null) {
    if (httpN === 401 || httpN === 403) return P2P_CAPABILITY_PROBE.AUTH_REJECTED
    if (httpN === 429) return P2P_CAPABILITY_PROBE.RATE_LIMITED
    if (httpN >= 500 && httpN <= 599) return P2P_CAPABILITY_PROBE.HOST_ERROR
    if (httpN === 404) return P2P_CAPABILITY_PROBE.HOST_HANDLER_NOT_REACHED
  }
  if (getResponseStatus === 404) {
    return P2P_CAPABILITY_PROBE.HOST_HANDLER_NOT_REACHED
  }
  if (getResponseStatus != null && getResponseStatus >= 500 && getResponseStatus <= 599) {
    return P2P_CAPABILITY_PROBE.HOST_ERROR
  }
  if (getResponseStatus === 429) {
    return P2P_CAPABILITY_PROBE.RATE_LIMITED
  }
  if (postReason === 'network' || getPhase === 'aborted' || n.length > 0) {
    if (postReason === 'network' && n.length < 1 && postResponseStatus == null) {
      return P2P_CAPABILITY_PROBE.HOST_P2P_SERVER_NOT_RUNNING
    }
    if (n.includes('econnrefused') || n.includes('connection refused')) {
      return P2P_CAPABILITY_PROBE.HOST_P2P_SERVER_NOT_RUNNING
    }
    if (n.includes('etimedout') || nNorm.includes('timed out')) {
      return P2P_CAPABILITY_PROBE.FIREWALL_OR_NETWORK_TIMEOUT
    }
    if (postReason === 'network' || n.includes('fetch') || n.includes('network')) {
      return P2P_CAPABILITY_PROBE.HOST_TRANSPORT_UNREACHABLE
    }
  }
  return P2P_CAPABILITY_PROBE.UNKNOWN
}

/** Host response from GET /beap/internal-inference-policy (direct P2P; STEP 6 metadata). */
export type HostInternalInferencePolicyPayload = {
  allowSandboxInference?: boolean
  defaultChatModel?: string
  provider?: string
  modelId?: string | null
  displayLabel?: string
  hostComputerName?: string
  hostOrchestratorRoleLabel?: string
  internalIdentifier6?: string
  internalIdentifierDisplay?: string
  directReachable?: boolean
  policyEnabled?: boolean
  inferenceErrorCode?: string
}

export type ProbeHostPolicyResult =
  | {
      ok: true
      allowSandboxInference: boolean
      defaultChatModel?: string
      /** Ollama chat model id (live on each probe). */
      modelId?: string | null
      displayLabelFromHost?: string
      hostComputerNameFromHost?: string
      providerFromHost?: 'ollama'
      hostOrchestratorRoleLabelFromHost?: string
      internalIdentifier6FromHost?: string
      internalIdentifierDisplayFromHost?: string
      directP2pPath?: boolean
      policyEnabledFromHost?: boolean
      inferenceErrorCode?: string
      /** Host caps wire valid but nothing selectable — never triggers immediate capability retry loops. */
      terminalNoModel?: boolean
      /** A–Q direct P2P capability-probe label (J = no active local model; P = Ollama down on Host; Q = transport not ready). */
      p2pProbeClassification?: P2pCapabilityProbeLetter
    }
  | {
      ok: false
      code: string
      message: string
      directP2pAvailable: boolean
      allowSandboxInference?: undefined
      p2pProbeClassification?: P2pCapabilityProbeLetter
      /** WebRTC: DC not up; do not treat as a terminal probe failure. */
      retryable?: boolean
      p2pNotReadyPhase?: string | null
      /** From `listHostCapabilities` when the failure is a terminal `HOST_*` endpoint-trust / provenance code. */
      hostAiEndpointDenyDetail?: string
      hostAiEndpointDiagnostics?: import('../../../src/lib/hostAiUiDiagnostics').HostAiEndpointDiagnostics
    }

/** At most one in-flight policy probe per handshake (renderer list polls share the same await). */
const probeHostInferencePolicyFromSandboxInFlight = new Map<string, Promise<ProbeHostPolicyResult>>()

/** @internal For unit tests only. */
export function resetProbeHostInferencePolicyInFlightForTests(): void {
  probeHostInferencePolicyFromSandboxInFlight.clear()
}

function probePolicyFailureFromDcWait(
  out: P2pCapabilityDcWaitOutcome,
  p2pPhase: string | null,
): Extract<ProbeHostPolicyResult, { ok: false }> {
  if (out.ok) {
    throw new Error('probePolicyFailureFromDcWait: unexpected ok')
  }
  if (out.reason === 'ice_failed') {
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      message: 'ice_failed',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }
  if (out.reason === 'dc_open_timeout') {
    return {
      ok: false,
      code: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY,
      message: 'dc_open_timeout',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.TRANSPORT_NOT_READY,
      retryable: true,
      p2pNotReadyPhase: p2pPhase,
    }
  }
  const raw = out.lastErrorCode
  const code: InternalInferenceErrorCodeType | string =
    raw && (Object.values(InternalInferenceErrorCode) as string[]).includes(raw)
      ? (raw as InternalInferenceErrorCodeType)
      : InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED
  return {
    ok: false,
    code,
    message: raw ?? 'p2p_session_failed',
    directP2pAvailable: true,
    p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
  }
}

function displayPairingFromDigits6(d: string): string {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 6) return `${s.slice(0, 3)}-${s.slice(3)}`
  return s ? s : '—'
}

/** Normalize legacy Host wire codes so Sandbox probe attribution stays stable (STEP 10). */
function normalizeCapabilityWireInferenceErrorCode(raw: string | undefined): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined
  const c = String(raw).trim()
  if (c === InternalInferenceErrorCode.OLLAMA_UNAVAILABLE) {
    return InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
  }
  if (c === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM) {
    return InternalInferenceErrorCode.PROBE_NO_MODELS
  }
  return c
}

export function mapCapabilitiesWireToProbe(
  w: InternalInferenceCapabilitiesResultWire,
): Extract<ProbeHostPolicyResult, { ok: true }> {
  const allow = w.policy_enabled === true
  const rawWireErr = typeof w.inference_error_code === 'string' ? w.inference_error_code.trim() : ''

  const activeChatTrim = typeof w.active_chat_model === 'string' ? w.active_chat_model.trim() : ''
  const fromActiveLocal = w.active_local_llm
  const activeLocalName =
    fromActiveLocal?.enabled && typeof fromActiveLocal.model === 'string'
      ? fromActiveLocal.model.trim()
      : ''
  /** Prefer active_chat_model, then enabled active_local_llm (matches Host ordering expectations). */
  const activeHint = activeChatTrim || activeLocalName

  const baseEnabledFromWire = (w.models ?? []).filter(
    (m) => m.enabled && typeof m.model === 'string' && m.model.trim(),
  )

  const terminalEmptyWireErr =
    rawWireErr === '' ||
    rawWireErr === InternalInferenceErrorCode.PROBE_PROVIDER_NOT_READY
  if (
    allow &&
    terminalEmptyWireErr &&
    baseEnabledFromWire.length === 0 &&
    !activeHint
  ) {
    console.log(`[HOST_CAPS] inference_ready=false reason=no_models_terminal provider=ollama models=0`)
    return {
      ok: true,
      allowSandboxInference: allow,
      defaultChatModel: undefined,
      modelId: null,
      displayLabelFromHost: 'Host AI · —',
      hostComputerNameFromHost: w.host_computer_name,
      providerFromHost: 'ollama',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifier6FromHost: w.host_pairing_code,
      internalIdentifierDisplayFromHost: displayPairingFromDigits6(w.host_pairing_code),
      directP2pPath: true,
      policyEnabledFromHost: allow,
      inferenceErrorCode: InternalInferenceErrorCode.PROBE_NO_MODELS,
      terminalNoModel: true,
    }
  }

  let enabledModels =
    allow && baseEnabledFromWire.length === 0 && activeHint
      ? [
          {
            provider: 'ollama' as const,
            model: activeHint,
            label: '',
            enabled: true,
          },
        ]
      : baseEnabledFromWire

  if (
    rawWireErr === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM ||
    rawWireErr === InternalInferenceErrorCode.PROBE_NO_MODELS
  ) {
    if (!allow || enabledModels.length === 0) {
      const enabledN = (w.models ?? []).filter((m) => m.enabled && typeof m.model === 'string' && m.model.trim()).length
      console.log(`[HOST_CAPS] inference_ready=false reason=no_models provider=ollama models=${enabledN}`)
      return {
        ok: true,
        allowSandboxInference: allow,
        defaultChatModel: undefined,
        modelId: null,
        displayLabelFromHost: 'Host AI · —',
        hostComputerNameFromHost: w.host_computer_name,
        providerFromHost: 'ollama',
        hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
        internalIdentifier6FromHost: w.host_pairing_code,
        internalIdentifierDisplayFromHost: displayPairingFromDigits6(w.host_pairing_code),
        directP2pPath: true,
        policyEnabledFromHost: allow,
        inferenceErrorCode: InternalInferenceErrorCode.PROBE_NO_MODELS,
        terminalNoModel: enabledModels.length === 0,
      }
    }
  }
  if (
    rawWireErr === InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE ||
    rawWireErr === InternalInferenceErrorCode.OLLAMA_UNAVAILABLE
  ) {
    const enabledN = (w.models ?? []).filter((m) => m.enabled && typeof m.model === 'string' && m.model.trim()).length
    console.log(`[HOST_CAPS] inference_ready=false reason=host_remote_ollama_unreachable provider=ollama models=${enabledN}`)
    return {
      ok: true,
      allowSandboxInference: allow,
      defaultChatModel: undefined,
      modelId: null,
      displayLabelFromHost: 'Host AI · —',
      hostComputerNameFromHost: w.host_computer_name,
      providerFromHost: 'ollama',
      hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
      internalIdentifier6FromHost: w.host_pairing_code,
      internalIdentifierDisplayFromHost: displayPairingFromDigits6(w.host_pairing_code),
      directP2pPath: true,
      policyEnabledFromHost: allow,
      inferenceErrorCode: InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE,
    }
  }
  const dcm =
    activeHint && (enabledModels.length === 0 || enabledModels.some((e) => e.model === activeHint))
      ? activeHint
      : enabledModels[0]?.model?.trim()
  const modelId = dcm != null && dcm.length > 0 ? dcm : null
  const displayLabel = !allow ? 'Host AI' : dcm ? `Host AI · ${dcm}` : 'Host AI · —'
  console.log(
    `[HOST_CAPS] inference_ready=${modelId ? 'true' : 'false'} provider=ollama models=${enabledModels.length}`,
  )
  const rawErr = w.inference_error_code
  const hostErrRaw = typeof rawErr === 'string' && rawErr.trim() ? rawErr.trim() : undefined
  const hostErr = normalizeCapabilityWireInferenceErrorCode(hostErrRaw)
  const recoveredEmptyWireWithHint =
    allow && baseEnabledFromWire.length === 0 && Boolean(activeHint) && modelId != null
  const inferenceErrorCode =
    modelId != null
      ? recoveredEmptyWireWithHint
        ? undefined
        : hostErr
      : hostErr ?? InternalInferenceErrorCode.PROBE_NO_MODELS
  return {
    ok: true,
    allowSandboxInference: allow,
    defaultChatModel: dcm,
    modelId,
    displayLabelFromHost: displayLabel,
    hostComputerNameFromHost: w.host_computer_name,
    providerFromHost: 'ollama',
    hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
    internalIdentifier6FromHost: w.host_pairing_code,
    internalIdentifierDisplayFromHost: displayPairingFromDigits6(w.host_pairing_code),
    directP2pPath: true,
    policyEnabledFromHost: allow,
    inferenceErrorCode,
  }
}

function p2pProbeLetterForOkInferenceCode(iec: string | undefined): P2pCapabilityProbeLetter | undefined {
  if (
    iec === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM ||
    iec === InternalInferenceErrorCode.PROBE_NO_MODELS
  ) {
    return P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL
  }
  if (iec === InternalInferenceErrorCode.OLLAMA_UNAVAILABLE || iec === InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE) {
    return P2P_CAPABILITY_PROBE.OLLAMA_LOCAL_DOWN
  }
  return undefined
}

/**
 * POST Host capabilities using the canonical Host AI route resolver (verified direct HTTP or WebRTC/DC).
 * Request body sets `transport_policy: 'direct_only'`.
 */
export async function postInternalInferenceCapabilitiesRequest(
  hid: string,
  record: HandshakeRecord,
  token: string,
  timeoutMs: number,
  correlationChain?: string,
  beapCorrelationId?: string,
): Promise<
  | { ok: true; wire: InternalInferenceCapabilitiesResultWire }
  | { ok: false; reason: string; responseStatus?: number; networkErrorMessage?: string }
> {
  return listHostCapabilities(hid, { record, token, timeoutMs, correlationChain, beapCorrelationId })
}

/**
 * Probes Host policy and live model metadata: POST capabilities (preferred), then GET /internal-inference-policy as fallback.
 * One concurrent probe per handshake: rapid UI polls await the same promise.
 */
export function probeHostInferencePolicyFromSandbox(
  handshakeId: string,
  opt?: { correlationChain?: string; beapCorrelationId?: string },
): Promise<ProbeHostPolicyResult> {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) {
    return probeHostInferencePolicyFromSandboxImpl(handshakeId, opt)
  }
  const inflight = probeHostInferencePolicyFromSandboxInFlight.get(hid)
  if (inflight) {
    return inflight
  }
  const started = probeHostInferencePolicyFromSandboxImpl(handshakeId, opt)
  probeHostInferencePolicyFromSandboxInFlight.set(hid, started)
  void started.finally(() => {
    if (probeHostInferencePolicyFromSandboxInFlight.get(hid) === started) {
      probeHostInferencePolicyFromSandboxInFlight.delete(hid)
    }
  })
  return started
}

async function probeHostInferencePolicyFromSandboxImpl(
  handshakeId: string,
  opt?: { correlationChain?: string; beapCorrelationId?: string },
): Promise<ProbeHostPolicyResult> {
  const p2p = (msg: string) => console.log(`[HOST_INFERENCE_P2P] ${msg}`)
  const probeDone = (ok: boolean) => p2p(`capability_probe_done ok=${ok ? 'true' : 'false'}`)

  const chain = (opt?.correlationChain && opt.correlationChain.trim() ? opt.correlationChain : null) || newHostAiCorrelationChain()
  const beapCorr =
    (opt?.beapCorrelationId && opt.beapCorrelationId.trim() ? opt.beapCorrelationId.trim() : null) || randomUUID()
  const p2pClassificationDetail = (detail: string) => p2p(`capability_probe_detail ${detail} chain=${chain}`)
  const buildStamp = getHostAiBuildStamp()
  const fProbe = getP2pInferenceFlags()

  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    logHostAiStage({
      chain,
      stage: 'feature_flags',
      reached: true,
      success: true,
      handshakeId: String(handshakeId ?? '').trim() || 'unknown',
      buildStamp,
      flags: fProbe,
    })
    logHostAiStage({
      chain,
      stage: 'selector_target',
      reached: true,
      success: false,
      handshakeId: String(handshakeId ?? '').trim() || 'unknown',
      buildStamp,
      flags: fProbe,
      phase: 'probe',
      failureCode: 'NO_HANDSHAKE_DB',
    })
    probeDone(false)
    p2pClassificationDetail('classification=K reason=NO_DB')
    return {
      ok: false,
      code: 'NO_DB',
      message: 'no database',
      directP2pAvailable: false,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }
  const hid = String(handshakeId ?? '').trim()
  const r = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) {
    logHostAiStage({
      chain,
      stage: 'handshake_role',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: fProbe,
      failureCode: 'ASSERT_RECORD',
    })
    probeDone(false)
    p2pClassificationDetail(`classification=K handshake=${hid} reason=assert_record`)
    return {
      ok: false,
      code: ar.code,
      message: 'handshake',
      directP2pAvailable: false,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }
  const rolesL = deriveHostAiHandshakeRoles(ar.record)
  const roleL =
    rolesL.ledgerSandboxToHost &&
    rolesL.samePrincipal &&
    rolesL.internalIdentityComplete &&
    rolesL.peerHostDeviceIdPresent
  logHostAiStage({
    chain,
    stage: 'handshake_role',
    reached: true,
    success: roleL,
    handshakeId: hid,
    buildStamp,
    flags: fProbe,
    failureCode: roleL ? null : 'TARGET_NOT_TRUSTED',
  })
  logHostAiStage({
    chain,
    stage: 'feature_flags',
    reached: true,
    success: true,
    handshakeId: hid,
    buildStamp,
    flags: fProbe,
  })
  const decInputL = await buildHostAiTransportDeciderInputAsync({
    /** Must match `listInferenceTargets` so the probe never diverges to legacy HTTP when the list row chose WebRTC. */
    operationContext: 'list_targets',
    db,
    handshakeRecord: ar.record,
    featureFlags: fProbe,
  })
  const decL = decideInternalInferenceTransport(decInputL)
  const canonicalProbe = buildHostAiCanonicalRouteResolveInputForDecider(
    db,
    ar.record,
    decInputL.sessionState,
    decInputL.relayHostAiP2pSignaling ?? 'na',
    decInputL.legacyEndpointInfo,
  )
  const routeResProbe = resolveHostAiRoute(canonicalProbe, { emitLog: false })
  {
    const localSandForLog = (localCoordinationDeviceId(ar.record) ?? '').trim()
    const peerHostForLog = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
    if (routeResProbe.ok) {
      logHostAiProbeRoute({
        handshake_id: hid,
        selected_route_kind: routeResProbe.route.transport,
        selected_endpoint_source: routeResProbe.route.source,
        endpoint_owner_device_id: routeResProbe.route.ownerDeviceId,
        local_device_id: localSandForLog,
        peer_host_device_id: peerHostForLog,
        decision: 'allow',
        reason: `ok:${routeResProbe.route.transport}`,
      })
    } else {
      logHostAiProbeRoute({
        handshake_id: hid,
        selected_route_kind: 'none',
        selected_endpoint_source: 'none',
        endpoint_owner_device_id: null,
        local_device_id: localSandForLog,
        peer_host_device_id: peerHostForLog,
        decision: 'deny',
        reason: `${routeResProbe.code}:${routeResProbe.reason}`,
      })
    }
  }
  const transportAuth = decideHostAiTransport(decL)
  const role = assertLedgerRolesSandboxToHost(ar.record)
  const stSel0 = decL.selectorPhase
  const webrtcRowInFlight =
    role.ok &&
    decL.preferredTransport === 'webrtc_p2p' &&
    (stSel0 === 'connecting' || stSel0 === 'ready' || stSel0 === 'detected')
  {
    const stP2pSel = getSessionState(hid)
    const p2pBusy =
      stP2pSel &&
      (stP2pSel.phase === P2pSessionPhase.starting || stP2pSel.phase === P2pSessionPhase.signaling)
    const tSt = Date.now()
    if (p2pBusy) {
      const lastSt = lastHostAiSelectorTargetStageByHandshake.get(hid)
      if (lastSt != null && tSt - lastSt < HOST_AI_SELECTOR_TARGET_STAGE_LOG_MIN_MS) {
        /* throttled: avoid new chain/selector_target spam on renderer poll */
      } else {
        lastHostAiSelectorTargetStageByHandshake.set(hid, tSt)
        logHostAiStage({
          chain,
          stage: 'selector_target',
          reached: true,
          success: role.ok,
          handshakeId: hid,
          buildStamp,
          flags: fProbe,
          phase: decL.selectorPhase,
          failureCode: !role.ok ? 'SANDBOX_HOST_ROLE' : webrtcRowInFlight ? null : decL.failureCode,
        })
      }
    } else {
      lastHostAiSelectorTargetStageByHandshake.delete(hid)
      logHostAiStage({
        chain,
        stage: 'selector_target',
        reached: true,
        success: role.ok,
        handshakeId: hid,
        buildStamp,
        flags: fProbe,
        phase: decL.selectorPhase,
        failureCode: !role.ok ? 'SANDBOX_HOST_ROLE' : webrtcRowInFlight ? null : decL.failureCode,
      })
    }
  }
  if (!role.ok) {
    probeDone(false)
    p2pClassificationDetail(`classification=K handshake=${hid} reason=role`)
    return {
      ok: false,
      code: role.code,
      message: 'role',
      directP2pAvailable: false,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }
  const peerHGate = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
  if (peerHGate) {
    const bPair = hostAiPairingListBlock(hid, peerHGate)
    if (bPair.block) {
      probeDone(false)
      p2p(`capability_probe_skipped reason=${bPair.code} handshake=${hid} (pairing_terminal)`)
      p2pClassificationDetail(`classification=${P2P_CAPABILITY_PROBE.UNKNOWN} reason=pairing_terminal`)
      return {
        ok: false,
        code: bPair.code,
        message: 'pairing_terminal',
        directP2pAvailable: true,
        p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
      }
    }
  }
  const fP2p = getP2pInferenceFlags()
  const token = outboundP2pBearerToCounterpartyIngest(ar.record)
  if (!token) {
    const hasLocal = !!(ar.record.local_p2p_auth_token && String(ar.record.local_p2p_auth_token).trim())
    probeDone(false)
    p2p(
      `capability_probe_auth_skip reason=${InternalInferenceErrorCode.HOST_AI_DIRECT_AUTH_MISSING} handshake=${hid} counterparty_p2p_token_set=no local_p2p_auth_token_set=${hasLocal ? 'yes' : 'no'}`,
    )
    p2pClassificationDetail(`classification=${P2P_CAPABILITY_PROBE.AUTH_REJECTED} reason=host_ai_direct_auth_missing`)
    logHostAiStage({
      chain,
      stage: 'capabilities_request',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: fP2p,
      failureCode: 'NO_COUNTERPARTY_P2P_TOKEN',
    })
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_AI_DIRECT_AUTH_MISSING,
      message: 'counterparty_p2p_token',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.AUTH_REJECTED,
    }
  }
  const { timeoutMs } = getHostInternalInferencePolicy()
  const tCap = Math.min(timeoutMs, 15_000)

  /** When WebRTC is the policy choice, do not POST/GET the relay (or any legacy) Host inference HTTP; use P2P/DC via `listHostCapabilities`. */
  if (transportAuth.kind === 'webrtc_p2p' && decL.preferredTransport === 'webrtc_p2p') {
    const odCandIpc = getSandboxOllamaDirectRouteCandidate(hid)
    if (
      odCandIpc &&
      peerHGate &&
      fP2p.p2pInferenceEnabled &&
      fP2p.p2pInferenceWebrtcEnabled &&
      fP2p.p2pInferenceSignalingEnabled &&
      fP2p.p2pInferenceCapsOverP2p
    ) {
      const odTagsIpc = await fetchSandboxOllamaDirectTags({
        handshakeId: hid,
        currentDeviceId: getInstanceId().trim(),
        peerHostDeviceId: peerHGate,
        candidate: odCandIpc,
      })
      const laneAuthoritative =
        odTagsIpc.cache_hit ||
        odTagsIpc.classification === 'available' ||
        odTagsIpc.classification === 'no_models' ||
        odTagsIpc.classification === 'transport_unavailable' ||
        odTagsIpc.classification === 'unavailable_invalid_advertisement'
      if (laneAuthoritative) {
        const hn = hostComputerNameFromHandshakeRecord(ar.record)
        const pairingDigits = String(ar.record.internal_peer_pairing_code ?? '')
          .replace(/\D/g, '')
          .slice(0, 6)
        const out = buildSyntheticOkProbeFromOllamaDirectTags(odTagsIpc, {
          hostComputerName: hn,
          pairingDigits,
        })
        const letterOk = p2pProbeLetterForOkInferenceCode(out.inferenceErrorCode)
        probeDone(true)
        logSbxHostAiRefreshDecision({
          handshake_id: hid,
          route_kind: 'ollama_direct',
          reason: 'ipc_probe_ollama_direct_lane_authoritative',
          caps_cache_hit: false,
          ollama_tags_cache_hit: odTagsIpc.cache_hit,
          will_request_caps: false,
          will_request_ollama_tags: !odTagsIpc.cache_hit && !odTagsIpc.inflight_reused,
          will_probe_policy: false,
          final_action: 'ipc_probe_short_circuit_ollama_direct',
        })
        if (letterOk) {
          p2pClassificationDetail(`classification=${letterOk}`)
        }
        return { ...out, p2pProbeClassification: letterOk }
      }
    }
    if (
      fP2p.p2pInferenceEnabled &&
      fP2p.p2pInferenceWebrtcEnabled &&
      fP2p.p2pInferenceSignalingEnabled &&
      fP2p.p2pInferenceCapsOverP2p
    ) {
      const st = getSessionState(hid)
      const dcReady =
        isP2pDataChannelUpForHandshake(hid) ||
        st?.phase === P2pSessionPhase.datachannel_open ||
        st?.phase === P2pSessionPhase.ready
      if (!dcReady) {
        const waitOut = await waitForP2pDataChannelOpenOrTerminal(hid, HOST_AI_CAPABILITY_DC_WAIT_MS)
        if (!waitOut.ok) {
          probeDone(false)
          const stAfter = getSessionState(hid)
          const phAfter = stAfter?.phase ?? 'none'
          const detail = p2pCapabilityDcWaitOutcomeLogReason(waitOut)
          p2p(`capability_probe_dc_wait handshake=${hid} outcome=${detail} p2p_phase=${phAfter}`)
          console.log(
            `[HOST_AI_CAPABILITY_PROBE] transport=webrtc_p2p ok=false reason=${detail} handshake=${hid} p2p_phase=${phAfter}`,
          )
          return probePolicyFailureFromDcWait(waitOut, phAfter === 'none' ? null : phAfter)
        }
      }
    }
    const capP2p = await listHostCapabilities(hid, {
      record: ar.record,
      token: token!,
      timeoutMs: tCap,
      correlationChain: chain,
      beapCorrelationId: beapCorr,
    })
    if (capP2p.ok) {
      const out = mapCapabilitiesWireToProbe(capP2p.wire)
      const letterOk = p2pProbeLetterForOkInferenceCode(out.inferenceErrorCode)
      probeDone(true)
      if (letterOk) {
        p2pClassificationDetail(`classification=${letterOk}`)
      }
      return { ...out, p2pProbeClassification: letterOk }
    }
    if (hostAiCapabilitiesAttemptTerminalNoPolicyGet(capP2p)) {
      const pr = 'reason' in capP2p ? String(capP2p.reason) : ''
      p2p(`capability_probe_terminated handshake=${hid} webrtc_listHost code=${pr} (no http fallback / policy get)`)
      probeDone(false)
      return {
        ok: false,
        code: pr,
        message: 'endpoint_provenance',
        directP2pAvailable: true,
        p2pProbeClassification: P2P_CAPABILITY_PROBE.ENDPOINT_STALE_LAN_IP,
        hostAiEndpointDenyDetail:
          'hostAiEndpointDenyDetail' in capP2p && typeof (capP2p as { hostAiEndpointDenyDetail?: string }).hostAiEndpointDenyDetail === 'string'
            ? (capP2p as { hostAiEndpointDenyDetail: string }).hostAiEndpointDenyDetail
            : undefined,
        hostAiEndpointDiagnostics: 'hostAiEndpointDiagnostics' in capP2p ? (capP2p as { hostAiEndpointDiagnostics?: import('../../../src/lib/hostAiUiDiagnostics').HostAiEndpointDiagnostics }).hostAiEndpointDiagnostics : undefined,
      }
    }
    if (!fP2p.p2pInferenceHttpFallback) {
      probeDone(false)
      p2p(`capability_probe_skip_http reason=webrtc_p2p_dc_or_caps_incomplete handshake=${hid} detail=${'reason' in capP2p ? String(capP2p.reason) : 'unknown'}`)
      return {
        ok: false,
        code: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY,
        message: 'p2p_still_connecting',
        directP2pAvailable: true,
        p2pProbeClassification: P2P_CAPABILITY_PROBE.TRANSPORT_NOT_READY,
      }
    }
    const dcfail = 'reason' in capP2p ? capP2p.reason : 'unknown'
    probeDone(false)
    p2p(`capability_probe_webrtc_exhausted handshake=${hid} reason=${String(dcfail)} (http_fallback_tried_in_listHost)`)
    const capReason = 'reason' in capP2p ? capP2p.reason : 'unknown'
    const capPhase: 'http' | 'parse' =
      capReason === 'wrong_type' || capReason === 'invalid_response' ? 'parse' : 'http'
    const letter = classifyP2pCapabilityProbeFailure({
      endpoint: decInputL.hostAiVerifiedDirectIngestUrl ?? '',
      endpointKind: p2pEndpointKindForProbeLog(db, decInputL.hostAiVerifiedDirectIngestUrl ?? ''),
      postReason: capReason,
      postResponseStatus: 'responseStatus' in capP2p ? capP2p.responseStatus : undefined,
      getResponseStatus: 'responseStatus' in capP2p ? capP2p.responseStatus : undefined,
      getPhase: capPhase,
      networkMessage: 'networkErrorMessage' in capP2p ? capP2p.networkErrorMessage : undefined,
    })
    const failCode = probeFailureInternalInferenceCodeFromCapabilityAttempt({
      postReason: capReason,
      postResponseStatus: 'responseStatus' in capP2p ? capP2p.responseStatus : undefined,
      getPhase: capPhase,
      networkMessage: 'networkErrorMessage' in capP2p ? capP2p.networkErrorMessage : undefined,
    })
    p2pClassificationDetail(`classification=${letter}`)
    return {
      ok: false,
      code: failCode,
      message: String(dcfail),
      directP2pAvailable: true,
      p2pProbeClassification: letter,
    }
  }

  /**
   * Failsafe: if the decider still prefers WebRTC, we must not POST to relay capsule or policy GET
   * (all WebRTC cases should have returned in the block above; listTargets can use `listHostCapabilities` on DC up).
   */
  if (decL.preferredTransport === 'webrtc_p2p') {
    probeDone(false)
    p2p(`capability_probe_legacy_blocked handshake=${hid} reason=webrtc_preferred_failsafe`)
    return {
      ok: false,
      code: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY,
      message: 'legacy_blocked_failsafe',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.TRANSPORT_NOT_READY,
    }
  }

  if (!routeResProbe.ok || routeResProbe.route.transport !== 'direct_http' || !routeResProbe.route.endpoint?.trim()) {
    probeDone(false)
    p2p(`capability_probe_skip handshake=${hid} reason=no_verified_direct_http_route`)
    p2pClassificationDetail(`classification=K reason=no_verified_direct_http_route`)
    return {
      ok: false,
      code: !routeResProbe.ok ? routeResProbe.code : InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
      message: 'no_verified_direct_http_route',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }

  const directEp = routeResProbe.route.endpoint.trim()
  const epK = p2pEndpointKindForProbeLog(db, directEp)

  p2p('capability_probe_begin')
  p2p(`handshake=${hid} endpoint=${directEp}`)
  p2p(`endpoint_kind=${epK}`)
  p2p(`request_timeout_ms=${tCap}`)

  const cap = await postInternalInferenceCapabilitiesRequest(hid, ar.record, token, tCap, chain, beapCorr)
  if (cap.ok) {
    const out = mapCapabilitiesWireToProbe(cap.wire)
    const letterOk = p2pProbeLetterForOkInferenceCode(out.inferenceErrorCode)
    const peerHostCoord = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
    if (peerHostCoord) {
      recordHostAiReciprocalCapabilitiesSuccess(hid, peerHostCoord)
    }
    probeDone(true)
    if (letterOk) {
      p2pClassificationDetail(`classification=${letterOk}`)
    }
    return { ...out, p2pProbeClassification: letterOk }
  }

  if (
    'reason' in cap &&
    String(cap.reason) === InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE
  ) {
    const peerH = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
    if (peerH) {
      recordHostAiLedgerAsymmetric(hid, peerH)
    }
    p2p(`capability_probe_ledger_asymmetric handshake=${hid} (host_beap_rejects_no_local_handshake)`)
    probeDone(false)
    p2pClassificationDetail(`classification=${P2P_CAPABILITY_PROBE.UNKNOWN} reason=ledger_asymmetric`)
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC,
      message: 'host_ledger_missing',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }

  if (hostAiCapabilitiesAttemptTerminalNoPolicyGet(cap)) {
    const pr = 'reason' in cap ? String(cap.reason) : ''
    p2p(`capability_probe_terminated handshake=${hid} code=${pr} (no policy GET / repair / fallback)`)
    probeDone(false)
    p2pClassificationDetail(`classification=${P2P_CAPABILITY_PROBE.UNKNOWN} reason=endpoint_provenance`)
    return {
      ok: false,
      code: pr,
      message: 'endpoint_provenance',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.ENDPOINT_STALE_LAN_IP,
      hostAiEndpointDenyDetail:
        'hostAiEndpointDenyDetail' in cap && typeof (cap as { hostAiEndpointDenyDetail?: string }).hostAiEndpointDenyDetail === 'string'
          ? (cap as { hostAiEndpointDenyDetail: string }).hostAiEndpointDenyDetail
          : undefined,
      hostAiEndpointDiagnostics: 'hostAiEndpointDiagnostics' in cap ? (cap as { hostAiEndpointDiagnostics?: import('../../../src/lib/hostAiUiDiagnostics').HostAiEndpointDiagnostics }).hostAiEndpointDiagnostics : undefined,
    }
  }

  const post429 =
    ('responseStatus' in cap && cap.responseStatus === 429) ||
    ('reason' in cap && String(cap.reason) === 'http_429')
  if (post429) {
    p2p(`capability_probe_skip_policy_get reason=post_429 handshake=${hid}`)
    const letter = P2P_CAPABILITY_PROBE.RATE_LIMITED
    const failCode = InternalInferenceErrorCode.PROBE_RATE_LIMITED
    probeDone(false)
    p2pClassificationDetail(`classification=${letter}`)
    return {
      ok: false,
      code: failCode,
      message: 'http_429',
      directP2pAvailable: true,
      p2pProbeClassification: letter,
    }
  }

  p2p(`policy_fallback_get url=${policyProbeUrlFromP2pIngest(directEp)} handshake=${hid}`)

  const url = policyProbeUrlFromP2pIngest(directEp)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), tCap)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        'X-BEAP-Handshake': hid,
        'X-BEAP-Host-AI-Chain': chain,
        'X-Correlation-Id': beapCorr,
      },
      signal: ac.signal,
    })
    clearTimeout(timer)
    p2p(`response_status=${res.status} phase=policy_get handshake=${hid}`)
    if (res.ok) {
      const adv = res.headers.get('x-beap-direct-p2p-endpoint')
      if (!ingestUrlMatchesThisDevicesMvpDirectBeap(db, directEp)) {
        const { tryRepairP2pEndpointFromHostAdvertisement } = await import('./p2pEndpointRepair')
        tryRepairP2pEndpointFromHostAdvertisement(db, hid, adv)
      } else {
        p2p(`capability_policy_get_skip_repair reason=policy_get_target_is_local_ingest handshake=${hid}`)
      }
    }
    if (res.status === 401 || res.status === 403) {
      const errText = await res.text()
      const typed = errText ? parseBeapIngestErrorJsonCode(errText) : null
      if (typed === InternalInferenceErrorCode.POLICY_FORBIDDEN) {
        p2p(`request_failed code=${typed} message=get policy role/policy terminal handshake=${hid}`)
        probeDone(false)
        p2pClassificationDetail(`classification=${P2P_CAPABILITY_PROBE.UNKNOWN} reason=policy_forbidden`)
        return {
          ok: false,
          code: InternalInferenceErrorCode.POLICY_FORBIDDEN,
          message: 'forbidden_host_role',
          directP2pAvailable: true,
          p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
        }
      }
      p2p(`request_failed code=forbidden message=get policy status handshake=${hid}`)
      probeDone(false)
      p2pClassificationDetail(`classification=${P2P_CAPABILITY_PROBE.AUTH_REJECTED}`)
      return {
        ok: false,
        code: InternalInferenceErrorCode.PROBE_AUTH_REJECTED,
        message: 'forbidden',
        directP2pAvailable: true,
        p2pProbeClassification: P2P_CAPABILITY_PROBE.AUTH_REJECTED,
      }
    }
    if (!res.ok) {
      const letter = classifyP2pCapabilityProbeFailure({
        endpoint: directEp,
        endpointKind: epK,
        postReason: cap.reason,
        postResponseStatus: cap.responseStatus,
        getResponseStatus: res.status,
        getPhase: 'http',
        networkMessage: `GET status ${res.status}`,
      })
      const failCode = probeFailureInternalInferenceCodeFromCapabilityAttempt({
        getHttpStatus: res.status,
        postReason: cap.reason,
        postResponseStatus: cap.responseStatus,
      })
      p2p(
        `request_failed code=http_get_${res.status} message=${safeP2pLogMessage(`get policy ${res.status}`)} handshake=${hid}`,
      )
      probeDone(false)
      p2pClassificationDetail(`classification=${letter}`)
      return {
        ok: false,
        code: failCode,
        message: `http ${res.status}`,
        directP2pAvailable: true,
        p2pProbeClassification: letter,
      }
    }
    const j = (await res.json()) as HostInternalInferencePolicyPayload
    const allow = j.allowSandboxInference === true
    const dcmFromLegacy = typeof j.defaultChatModel === 'string' && j.defaultChatModel.trim() ? j.defaultChatModel.trim() : undefined
    const dcmFromId = typeof j.modelId === 'string' && j.modelId.trim() ? j.modelId.trim() : undefined
    const dcm = dcmFromId ?? dcmFromLegacy
    let modelId: string | null | undefined
    if (j.modelId === null) {
      modelId = null
    } else if (typeof j.modelId === 'string' && j.modelId.trim()) {
      modelId = j.modelId.trim()
    } else if (dcm) {
      modelId = dcm
    }
    let infErr = typeof j.inferenceErrorCode === 'string' && j.inferenceErrorCode.trim() ? j.inferenceErrorCode.trim() : undefined
    const hasModel = !!(dcm || (modelId != null && String(modelId).trim().length > 0))
    if (allow && !hasModel && !infErr) {
      infErr = InternalInferenceErrorCode.PROBE_NO_MODELS
    }
    const letterOk = p2pProbeLetterForOkInferenceCode(infErr)
    p2p('policy_fallback_succeeded')
    probeDone(true)
    if (letterOk) {
      p2pClassificationDetail(`classification=${letterOk}`)
    }
    return {
      ok: true as const,
      allowSandboxInference: allow,
      defaultChatModel: dcm,
      modelId,
      displayLabelFromHost: typeof j.displayLabel === 'string' ? j.displayLabel : undefined,
      hostComputerNameFromHost: typeof j.hostComputerName === 'string' ? j.hostComputerName.trim() : undefined,
      providerFromHost: j.provider === 'ollama' ? 'ollama' : undefined,
      hostOrchestratorRoleLabelFromHost:
        typeof j.hostOrchestratorRoleLabel === 'string' ? j.hostOrchestratorRoleLabel : undefined,
      internalIdentifier6FromHost: typeof j.internalIdentifier6 === 'string' ? j.internalIdentifier6 : undefined,
      internalIdentifierDisplayFromHost:
        typeof j.internalIdentifierDisplay === 'string' ? j.internalIdentifierDisplay : undefined,
      directP2pPath: j.directReachable === true,
      policyEnabledFromHost: typeof j.policyEnabled === 'boolean' ? j.policyEnabled : undefined,
      inferenceErrorCode: infErr,
      p2pProbeClassification: letterOk,
    }
  } catch (e) {
    clearTimeout(timer)
    const name = (e as Error)?.name
    const em = (e as Error)?.message
    if (name === 'AbortError') {
      const letter = classifyP2pCapabilityProbeFailure({
        endpoint: directEp,
        endpointKind: epK,
        postReason: cap.reason,
        postResponseStatus: cap.responseStatus,
        getPhase: 'aborted',
        networkMessage: [cap.networkErrorMessage, 'GET AbortError'].filter(Boolean).join(' | '),
      })
      const failCode = probeFailureInternalInferenceCodeFromCapabilityAttempt({
        postReason: cap.reason,
        postResponseStatus: cap.responseStatus,
        getPhase: 'aborted',
        networkMessage: [cap.networkErrorMessage, 'GET AbortError'].filter(Boolean).join(' | '),
      })
      p2p(`request_failed code=timeout message=${safeP2pLogMessage('get policy timeout')} handshake=${hid}`)
      probeDone(false)
      p2pClassificationDetail(`classification=${letter}`)
      return {
        ok: false,
        code: failCode,
        message: 'timeout',
        directP2pAvailable: true,
        p2pProbeClassification: letter,
      }
    }
    const parsePhase = name === 'SyntaxError' ? ('parse' as const) : undefined
    const letter = classifyP2pCapabilityProbeFailure({
      endpoint: directEp,
      endpointKind: epK,
      postReason: cap.reason,
      postResponseStatus: cap.responseStatus,
      getPhase: parsePhase,
      networkMessage: [cap.networkErrorMessage, em].filter(Boolean).join(' | '),
    })
    const failCode = probeFailureInternalInferenceCodeFromCapabilityAttempt({
      postReason: cap.reason,
      postResponseStatus: cap.responseStatus,
      getPhase: parsePhase,
      networkMessage: [cap.networkErrorMessage, em].filter(Boolean).join(' | '),
    })
    p2p(`request_failed code=network message=${safeP2pLogMessage(em)} handshake=${hid}`)
    probeDone(false)
    p2pClassificationDetail(`classification=${letter}`)
    return {
      ok: false,
      code: failCode,
      message: em ?? 'fetch failed',
      directP2pAvailable: true,
      p2pProbeClassification: letter,
    }
  }
}
