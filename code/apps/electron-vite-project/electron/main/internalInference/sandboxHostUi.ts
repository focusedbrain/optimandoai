/**
 * Sandbox renderer support: list internal Host handshakes, probe Host policy over direct P2P.
 * Prefers `internal_inference_capabilities_request` → `internal_inference_capabilities_result` (POST /beap/ingest,
 * not inbox, not a BEAP message). Falls back to GET /beap/internal-inference-policy.
 */

import { getHandshakeRecord, listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { InternalInferenceErrorCode } from './errors'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertLedgerRolesSandboxToHost,
  assertSandboxRequestToHost,
  internalInferenceEndpointGateOk,
  localCoordinationDeviceId,
  p2pEndpointKind,
  p2pEndpointKindForProbeLog,
  type P2pEndpointProbeLogKind,
  peerCoordinationDeviceId,
} from './policy'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { getHostAiBuildStamp, logHostAiStage, newHostAiCorrelationChain } from './hostAiStageLog'
import type { InternalInferenceCapabilitiesResultWire } from './types'
import { listHostCapabilities } from './transport/internalInferenceTransport'
import {
  buildHostAiTransportDeciderInput,
  decideHostAiTransport,
  decideInternalInferenceTransport,
  deriveHostAiHandshakeRoles,
} from './transport/decideInternalInferenceTransport'

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

/** A–K labels for `probeHostInferencePolicyFromSandbox` direct P2P capability diagnostics. */
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

export const P2P_CAPABILITY_PROBE = {
  ENDPOINT_MISSING: 'A' as const,
  ENDPOINT_IS_RELAY: 'B' as const,
  ENDPOINT_IS_LOCALHOST: 'C' as const,
  ENDPOINT_STALE_LAN_IP: 'D' as const,
  HOST_P2P_SERVER_NOT_RUNNING: 'E' as const,
  HOST_P2P_SERVER_BOUND_LOCAL_ONLY: 'F' as const,
  FIREWALL_OR_NETWORK_TIMEOUT: 'G' as const,
  TOKEN_OR_AUTH_REJECTED: 'H' as const,
  HOST_HANDLER_NOT_REACHED: 'I' as const,
  HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL: 'J' as const,
  UNKNOWN: 'K' as const,
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
 * Heuristic A–K classification for direct P2P capability-probe outcomes (client-side; F may stay K
 * here unless the Host advertises bind mode).
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
      return P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED
    }
    return P2P_CAPABILITY_PROBE.ENDPOINT_IS_LOCALHOST
  }
  if (postReason === 'forbidden' || postResponseStatus === 401 || postResponseStatus === 403) {
    return P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED
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
  if (postReason === 'wrong_type') {
    return P2P_CAPABILITY_PROBE.HOST_HANDLER_NOT_REACHED
  }
  const httpN = (() => {
    const m = /^http_(\d+)$/.exec(postReason)
    return m ? parseInt(m[1], 10) : (postResponseStatus ?? (getResponseStatus && getResponseStatus > 0 ? getResponseStatus : undefined))
  })()
  if (httpN != null) {
    if (httpN === 401 || httpN === 403) return P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED
    if (httpN === 404 || httpN === 502 || httpN === 503 || httpN === 504) {
      return P2P_CAPABILITY_PROBE.HOST_HANDLER_NOT_REACHED
    }
  }
  if (getResponseStatus === 404 || getResponseStatus === 502) {
    return P2P_CAPABILITY_PROBE.HOST_HANDLER_NOT_REACHED
  }
  if (postReason === 'network' || getPhase === 'aborted' || n.length > 0) {
    if (postReason === 'network' && n.length < 1 && (postResponseStatus == null)) {
      return P2P_CAPABILITY_PROBE.HOST_P2P_SERVER_NOT_RUNNING
    }
    if (n.includes('econnrefused') || n.includes('connection refused')) {
      return P2P_CAPABILITY_PROBE.HOST_P2P_SERVER_NOT_RUNNING
    }
    if (n.includes('etimedout') || nNorm.includes('timed out')) {
      return P2P_CAPABILITY_PROBE.FIREWALL_OR_NETWORK_TIMEOUT
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
      /** A–K direct P2P capability-probe label (J = Host reachable, no active local model). */
      p2pProbeClassification?: P2pCapabilityProbeLetter
    }
  | {
      ok: false
      code: string
      message: string
      directP2pAvailable: boolean
      allowSandboxInference?: undefined
      p2pProbeClassification?: P2pCapabilityProbeLetter
    }

function displayPairingFromDigits6(d: string): string {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 6) return `${s.slice(0, 3)}-${s.slice(3)}`
  return s ? s : '—'
}

export function mapCapabilitiesWireToProbe(
  w: InternalInferenceCapabilitiesResultWire,
): Extract<ProbeHostPolicyResult, { ok: true }> {
  const allow = w.policy_enabled === true
  if (w.inference_error_code === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM) {
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
      inferenceErrorCode: InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM,
    }
  }
  const enabledModels = w.models.filter((m) => m.enabled && typeof m.model === 'string' && m.model.trim())
  const fromActiveLocal = w.active_local_llm
  const activeLocalName =
    fromActiveLocal?.enabled && typeof fromActiveLocal.model === 'string'
      ? fromActiveLocal.model.trim()
      : ''
  const activeHint =
    activeLocalName || (typeof w.active_chat_model === 'string' ? w.active_chat_model.trim() : '')
  const dcm =
    activeHint && (enabledModels.length === 0 || enabledModels.some((e) => e.model === activeHint))
      ? activeHint
      : enabledModels[0]?.model?.trim()
  const modelId = dcm != null && dcm.length > 0 ? dcm : null
  const displayLabel = !allow ? 'Host AI' : dcm ? `Host AI · ${dcm}` : 'Host AI · —'
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
    inferenceErrorCode: w.inference_error_code,
  }
}

/**
 * Direct P2P POST to the peer `p2p_endpoint` only (asserted direct before call). Request body sets
 * `transport_policy: 'direct_only'`. Relay / shared BEAP ingest URLs are not used for inference MVP.
 */
export async function postInternalInferenceCapabilitiesRequest(
  hid: string,
  record: HandshakeRecord,
  ingestUrl: string,
  token: string,
  timeoutMs: number,
  correlationChain?: string,
): Promise<
  | { ok: true; wire: InternalInferenceCapabilitiesResultWire }
  | { ok: false; reason: string; responseStatus?: number; networkErrorMessage?: string }
> {
  return listHostCapabilities(hid, { record, ingestUrl, token, timeoutMs, correlationChain })
}

/**
 * Probes Host policy and live model metadata: POST capabilities (preferred), then GET /internal-inference-policy as fallback.
 */
export async function probeHostInferencePolicyFromSandbox(
  handshakeId: string,
  opt?: { correlationChain?: string },
): Promise<ProbeHostPolicyResult> {
  const p2p = (msg: string) => console.log(`[HOST_INFERENCE_P2P] ${msg}`)
  const probeDone = (ok: boolean) => p2p(`capability_probe_done ok=${ok ? 'true' : 'false'}`)

  const chain = (opt?.correlationChain && opt.correlationChain.trim() ? opt.correlationChain : null) || newHostAiCorrelationChain()
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
    p2p('capability_probe_detail classification=K reason=NO_DB')
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
    p2p(`capability_probe_detail classification=K handshake=${hid} reason=assert_record`)
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
  const decL = decideInternalInferenceTransport(
    buildHostAiTransportDeciderInput({
      /** Must match `listInferenceTargets` so the probe never diverges to legacy HTTP when the list row chose WebRTC. */
      operationContext: 'list_targets',
      db,
      handshakeRecord: ar.record,
      featureFlags: fProbe,
    }),
  )
  const transportAuth = decideHostAiTransport(decL)
  const role = assertLedgerRolesSandboxToHost(ar.record)
  logHostAiStage({
    chain,
    stage: 'selector_target',
    reached: true,
    success: role.ok,
    handshakeId: hid,
    buildStamp,
    flags: fProbe,
    phase: decL.selectorPhase,
    failureCode: role.ok ? null : 'SANDBOX_HOST_ROLE',
  })
  if (!role.ok) {
    probeDone(false)
    p2p(`capability_probe_detail classification=K handshake=${hid} reason=role`)
    return {
      ok: false,
      code: role.code,
      message: 'role',
      directP2pAvailable: false,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }
  const fP2p = getP2pInferenceFlags()
  if (!internalInferenceEndpointGateOk(db, ar.record.p2p_endpoint, fP2p)) {
    const direct = assertP2pEndpointDirect(db, ar.record.p2p_endpoint)
    const rawEp0 = ar.record.p2p_endpoint?.trim() ?? ''
    const epK0 = p2pEndpointKindForProbeLog(db, ar.record.p2p_endpoint)
    p2p(`endpoint=${rawEp0 || '(empty)'}`)
    p2p(`endpoint_kind=${epK0}`)
    const k = p2pEndpointKind(db, ar.record.p2p_endpoint)
    const letter: P2pCapabilityProbeLetter =
      k === 'missing'
        ? P2P_CAPABILITY_PROBE.ENDPOINT_MISSING
        : k === 'relay'
          ? P2P_CAPABILITY_PROBE.ENDPOINT_IS_RELAY
          : P2P_CAPABILITY_PROBE.UNKNOWN
    probeDone(false)
    p2p(`capability_probe_detail classification=${letter} reason=not_direct_p2p`)
    logHostAiStage({
      chain,
      stage: 'selector_target',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: fP2p,
      phase: epK0,
      failureCode: 'ENDPOINT_GATE_NOT_OK',
    })
    return {
      ok: false,
      code: direct.code,
      message: 'Host AI path not reachable (direct ingest required for this probe).',
      directP2pAvailable: false,
      p2pProbeClassification: letter,
    }
  }
  const ep = ar.record.p2p_endpoint?.trim() ?? ''
  const epK = p2pEndpointKindForProbeLog(db, ar.record.p2p_endpoint)
  const token = ar.record.counterparty_p2p_token
  if (!token?.trim()) {
    probeDone(false)
    p2p(`capability_probe_detail classification=${P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED} reason=no_p2p_token`)
    logHostAiStage({
      chain,
      stage: 'capabilities_request',
      reached: true,
      success: false,
      handshakeId: hid,
      buildStamp,
      flags: fP2p,
      failureCode: 'NO_P2P_TOKEN',
    })
    return {
      ok: false,
      code: 'POLICY_FORBIDDEN',
      message: 'token',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED,
    }
  }
  const { timeoutMs } = getHostInternalInferencePolicy()
  const tCap = Math.min(timeoutMs, 15_000)

  /** When WebRTC is the policy choice, do not POST/GET the relay (or any legacy) Host inference HTTP; use P2P/DC via `listHostCapabilities`. */
  if (transportAuth.kind === 'webrtc_p2p' && decL.preferredTransport === 'webrtc_p2p') {
    if (
      fP2p.p2pInferenceEnabled &&
      fP2p.p2pInferenceWebrtcEnabled &&
      fP2p.p2pInferenceSignalingEnabled &&
      fP2p.p2pInferenceCapsOverP2p
    ) {
      const { ensureSessionSingleFlight } = await import('./p2pSession/p2pInferenceSessionManager')
      const { waitForP2pDataChannelOrTimeout } = await import('./p2pSession/p2pSessionWait')
      await ensureSessionSingleFlight(hid, 'capability_probe')
      await waitForP2pDataChannelOrTimeout(hid, 10_000)
    }
    const { listHostCapabilities } = await import('./transport/internalInferenceTransport')
    const capP2p = await listHostCapabilities(hid, {
      record: ar.record,
      ingestUrl: ep,
      token: token!,
      timeoutMs: tCap,
      correlationChain: chain,
    })
    if (capP2p.ok) {
      const out = mapCapabilitiesWireToProbe(capP2p.wire)
      const isJ = out.inferenceErrorCode === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM
      probeDone(true)
      if (isJ) {
        p2p(`capability_probe_detail classification=${P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL}`)
      }
      return { ...out, p2pProbeClassification: isJ ? P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL : undefined }
    }
    if (!fP2p.p2pInferenceHttpFallback) {
      probeDone(false)
      p2p(`capability_probe_skip_http reason=webrtc_p2p_dc_or_caps_incomplete handshake=${hid} detail=${'reason' in capP2p ? String(capP2p.reason) : 'unknown'}`)
      return {
        ok: false,
        code: InternalInferenceErrorCode.P2P_STILL_CONNECTING,
        message: 'p2p_still_connecting',
        directP2pAvailable: true,
        p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
      }
    }
    const dcfail = 'reason' in capP2p ? capP2p.reason : 'unknown'
    probeDone(false)
    p2p(`capability_probe_webrtc_exhausted handshake=${hid} reason=${String(dcfail)} (http_fallback_tried_in_listHost)`)
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      message: String(dcfail),
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.FIREWALL_OR_NETWORK_TIMEOUT,
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
      code: InternalInferenceErrorCode.P2P_STILL_CONNECTING,
      message: 'legacy_blocked_failsafe',
      directP2pAvailable: true,
      p2pProbeClassification: P2P_CAPABILITY_PROBE.UNKNOWN,
    }
  }

  p2p('capability_probe_begin')
  p2p(`handshake=${hid} endpoint=${ep}`)
  p2p(`endpoint_kind=${epK}`)
  p2p(`request_timeout_ms=${tCap}`)

  const cap = await postInternalInferenceCapabilitiesRequest(hid, ar.record, ep, token, tCap, chain)
  if (cap.ok) {
    const out = mapCapabilitiesWireToProbe(cap.wire)
    const isJ = out.inferenceErrorCode === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM
    probeDone(true)
    if (isJ) {
      p2p(`capability_probe_detail classification=${P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL}`)
    }
    return { ...out, p2pProbeClassification: isJ ? P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL : undefined }
  }

  p2p(`policy_fallback_get url=${policyProbeUrlFromP2pIngest(ep)} handshake=${hid}`)

  const url = policyProbeUrlFromP2pIngest(ep)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), tCap)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        'X-BEAP-Handshake': hid,
      },
      signal: ac.signal,
    })
    clearTimeout(timer)
    p2p(`response_status=${res.status} phase=policy_get handshake=${hid}`)
    if (res.ok) {
      const adv = res.headers.get('x-beap-direct-p2p-endpoint')
      const { tryRepairP2pEndpointFromHostAdvertisement } = await import('./p2pEndpointRepair')
      tryRepairP2pEndpointFromHostAdvertisement(db, hid, adv)
    }
    if (res.status === 401 || res.status === 403) {
      p2p(`request_failed code=forbidden message=get policy status handshake=${hid}`)
      probeDone(false)
      p2p(`capability_probe_detail classification=${P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED}`)
      return {
        ok: false,
        code: InternalInferenceErrorCode.POLICY_FORBIDDEN,
        message: 'forbidden',
        directP2pAvailable: true,
        p2pProbeClassification: P2P_CAPABILITY_PROBE.TOKEN_OR_AUTH_REJECTED,
      }
    }
    if (!res.ok) {
      const letter = classifyP2pCapabilityProbeFailure({
        endpoint: ep,
        endpointKind: epK,
        postReason: cap.reason,
        postResponseStatus: cap.responseStatus,
        getResponseStatus: res.status,
        getPhase: 'http',
        networkMessage: `GET status ${res.status}`,
      })
      p2p(
        `request_failed code=http_get_${res.status} message=${safeP2pLogMessage(`get policy ${res.status}`)} handshake=${hid}`,
      )
      probeDone(false)
      p2p(`capability_probe_detail classification=${letter}`)
      return {
        ok: false,
        code: InternalInferenceErrorCode.OLLAMA_UNAVAILABLE,
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
    const infErr = typeof j.inferenceErrorCode === 'string' ? j.inferenceErrorCode : undefined
    const isJ = infErr === InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM
    p2p('policy_fallback_succeeded')
    probeDone(true)
    if (isJ) {
      p2p(`capability_probe_detail classification=${P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL}`)
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
      p2pProbeClassification: isJ ? P2P_CAPABILITY_PROBE.HOST_HANDLER_REACHED_BUT_NO_ACTIVE_MODEL : undefined,
    }
  } catch (e) {
    clearTimeout(timer)
    const name = (e as Error)?.name
    const em = (e as Error)?.message
    if (name === 'AbortError') {
      const letter = classifyP2pCapabilityProbeFailure({
        endpoint: ep,
        endpointKind: epK,
        postReason: cap.reason,
        postResponseStatus: cap.responseStatus,
        getPhase: 'aborted',
        networkMessage: [cap.networkErrorMessage, 'GET AbortError'].filter(Boolean).join(' | '),
      })
      p2p(`request_failed code=timeout message=${safeP2pLogMessage('get policy timeout')} handshake=${hid}`)
      probeDone(false)
      p2p(`capability_probe_detail classification=${letter}`)
      return {
        ok: false,
        code: InternalInferenceErrorCode.PROVIDER_TIMEOUT,
        message: 'timeout',
        directP2pAvailable: true,
        p2pProbeClassification: letter,
      }
    }
    const letter = classifyP2pCapabilityProbeFailure({
      endpoint: ep,
      endpointKind: epK,
      postReason: cap.reason,
      postResponseStatus: cap.responseStatus,
      getPhase: 'parse',
      networkMessage: [cap.networkErrorMessage, em].filter(Boolean).join(' | '),
    })
    p2p(`request_failed code=network message=${safeP2pLogMessage(em)} handshake=${hid}`)
    probeDone(false)
    p2p(`capability_probe_detail classification=${letter}`)
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
      message: em ?? 'fetch failed',
      directP2pAvailable: true,
      p2pProbeClassification: letter,
    }
  }
}
