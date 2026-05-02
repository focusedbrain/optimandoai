/**
 * IPC-backed list of selectable Host internal inference rows for Sandbox UIs.
 * See also: internal-inference:listTargets (same data; wire-oriented + logs).
 */

import { randomUUID } from 'crypto'
import {
  deriveInternalHandshakeRoles,
  type InternalHandshakeRoleSource,
} from '../../../../../packages/shared/src/handshake/internalIdentityUi'
import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getInstanceId, getOrchestratorMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { logInternalHostHandshakeP2pInspect } from './internalP2pHandshakeInspect'
import { newHostAiCorrelationChain } from './hostAiStageLog'
import {
  getP2pInferenceFlags,
  isHostAiP2pUxEnabled,
  isWebRtcHostAiArchitectureEnabled,
  logHostAiP2pFlagsAndSource,
} from './p2pInferenceFlags'
import {
  ensureHostAiP2pSession,
  evictHostAiP2pSessionForStuckListCache,
  getSessionState,
  P2pSessionPhase,
} from './p2pSession/p2pInferenceSessionManager'
import {
  HOST_AI_CAPABILITY_DC_WAIT_MS,
  isP2pDataChannelUpForHandshake,
  p2pCapabilityDcWaitOutcomeLogReason,
  waitForP2pDataChannelOpenOrTerminal,
} from './p2pSession/p2pSessionWait'
import {
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
  handshakeSamePrincipal,
  outboundP2pBearerToCounterpartyIngest,
  p2pEndpointKind,
} from './policy'
import {
  buildHostAiTransportDeciderInputAsync,
  decideHostAiTransport,
  decideInternalInferenceTransport,
  type HostAiSelectorPhase,
  type HostAiTransportDeciderResult,
} from './transport/decideInternalInferenceTransport'
import type { P2pInferenceFlagSnapshot } from './p2pInferenceFlags'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import {
  mapCapabilitiesWireToProbe,
  P2P_CAPABILITY_PROBE,
  probeHostInferencePolicyFromSandbox,
  resetProbeHostInferencePolicyInFlightForTests,
} from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'
import { clearHostAiTransportDecideDedupeCache, logHostAiTransportDecideListLine } from './hostAiTransportDecideLog'
import { hostHasActiveInternalLedgerHostPeerSandboxFromDb } from './hostAiInternalPairingLedger'
import { peekHostAdvertisedMvpDirectEntry, registerP2pEnsureCacheInvalidator, type HostAiPeerAdvertisedOllamaRoster } from './p2pEndpointRepair'
import {
  hostAiPairingListBlock,
  recordHostAiLedgerAsymmetric,
  recordHostAiReciprocalCapabilitiesSuccess,
  reconcileHostAiPairingEntry,
  refreshHostAiPairingStaleByTtl,
} from './hostAiPairingStateStore'
import { getP2pRelaySignalingCircuitOpenUntilMs } from './p2pSignalRelayCircuit'
import { invalidateSbxAiCapsTerminalCache } from './p2pDc/p2pDcCapabilities'
import { listHostCapabilities } from './transport/internalInferenceTransport'
import { isHostAiProbeTerminalNoPolicyFallback } from './transport/hostAiRouteCandidate'
import type { InternalInferenceCapabilitiesResultWire } from './types'
import { isHostAiListTransportProven } from './hostAiTransportMatrix'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import {
  fetchSandboxOllamaDirectTags,
  type SandboxOllamaDirectTagsFetchResult,
} from './sandboxHostAiOllamaDirectTags'
import { logSbxHostAiRefreshDecision } from './sandboxHostAiListRefreshDecision'
import {
  buildSyntheticOkProbeFromOllamaDirectTags,
  hostComputerNameFromHandshakeRecord,
} from './sandboxHostAiOllamaDirectSyntheticProbe'
import type { HostAiEndpointDiagnostics } from '../../../src/lib/hostAiUiDiagnostics'
import { hostAiUserFacingMessageFromTarget } from '../../../src/lib/hostAiUiDiagnostics'
import type { HostAiTargetStatus } from './hostAiTargetStatus'

const L = '[HOST_INFERENCE_TARGETS]'
/** Log fields: `beap_target_available` = BEAP / top-chat path trusted and ready; `ollama_direct_available` = LAN Ollama tags path usable (do not conflate the two). */

function hostOllamaDirectSyntheticProbeMeta(
  handshakeId: string,
  meta: { hostName: string; digits6: string },
): {
  hostComputerName: string
  pairingDigits: string
  peerAdvertisedOllamaRoster: HostAiPeerAdvertisedOllamaRoster | null
} {
  const peek = peekHostAdvertisedMvpDirectEntry(handshakeId)
  return {
    hostComputerName: meta.hostName,
    pairingDigits: meta.digits6,
    peerAdvertisedOllamaRoster: peek?.ollamaRoster ?? null,
  }
}

/**
 * `/api/tags` classification allows skipping BEAP/WebRTC policy work for model listing — LAN ODL is not gated by the BEAP transport selector.
 */
function sandboxOllamaDirectTagsAllowListTransportBypass(tags: SandboxOllamaDirectTagsFetchResult): boolean {
  return (
    tags.cache_hit === true ||
    tags.classification === 'available' ||
    tags.classification === 'no_models' ||
    tags.classification === 'transport_unavailable' ||
    tags.classification === 'unavailable_invalid_advertisement'
  )
}

function logHostAiLedgerView(
  mainMode: string,
  activeInternal: number,
  s2h: number,
  rows: HandshakeRecord[],
  source: 'sandbox' | 'list_targets_common',
): void {
  const currentDevice = getInstanceId().trim()
  const firstInternal = rows.find((r) => r.handshake_type === 'internal' && r.state === HandshakeState.ACTIVE)
  const handshakes = rows
    .filter((r) => r.handshake_type === 'internal' && r.state === HandshakeState.ACTIVE)
    .map((r) => {
      const d = deriveFromRecord(r)
      const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
      const peerDev = dr.ok ? dr.peerCoordinationDeviceId.trim() : ''
      return {
        handshake_id: r.handshake_id,
        local_device_id: currentDevice,
        peer_device_id: peerDev,
        local_derived_role: d.localDeviceRole,
        peer_derived_role: d.peerDeviceRole,
        state: r.state,
        last_seen_at: (r as { last_seen_at?: string }).last_seen_at ?? (r.activated_at ?? r.created_at ?? null),
        source,
      }
    })
  const payload = {
    current_device_id: currentDevice,
    configured_mode: mainMode,
    is_sandbox_persisted: isSandboxMode(),
    local_derived_role: firstInternal ? deriveFromRecord(firstInternal).localDeviceRole : 'unknown',
    active_internal_count: activeInternal,
    active_internal_sandbox_to_host_count: s2h,
    handshakes,
  }
  console.log(`[HOST_AI_LEDGER_VIEW] ${JSON.stringify(payload)}`)
}

/** While P2P is in offer/signaling, reuse one correlation chain per handshake for list/probe (avoid new chain every poll). */
const stableListProbeChainByHandshake = new Map<string, string>()

const P2P_LIST_ENSURE_THROTTLE_MS = 5_000
/** If signaling/starting persists longer than this, drop cached ensure and force a fresh session attempt. */
const P2P_LIST_MAX_STUCK_SIGNALING_CACHE_MS = 15_000
/** Throttle background ensure for internal+relay+no-DC (decider fails closed; P2P still needs a nudge to start). */
const RELAY_DATA_CHANNEL_NUDGE_THROTTLE_MS = 3_000
const lastP2pEnsureByHandshake = new Map<
  string,
  { t: number; state: Awaited<ReturnType<typeof ensureHostAiP2pSession>> }
>()
const lastRelayP2pNudgeByHandshake = new Map<string, number>()

/** After HTTP 429 on a Host AI direct probe, skip re-POST/GET to the same host briefly (global BEAP rate limit). */
const HOST_AI_DIRECT_PROBE_429_COOLDOWN_MS = 45_000
const hostAiDirectProbe429CooldownUntil = new Map<string, number>()

registerP2pEnsureCacheInvalidator((handshakeId) => {
  const h = String(handshakeId ?? '').trim()
  if (h) {
    lastP2pEnsureByHandshake.delete(h)
    invalidateProbeCache(h)
  }
})

const COPY_OFFER_START_NOT_OBSERVED =
  'Host AI P2P setup did not start correctly. Check logs for OFFER_START_NOT_OBSERVED.'

const WEBRTC_LIST_CAPS_CACHE_TTL_MS = 5_000
/** Collapse duplicate capability probes from rapid list_inference_targets / UI refresh (per handshake). */
const LIST_PROBE_COALESCE_MS = 1500

type ListHostCapResult =
  | { ok: true; wire: InternalInferenceCapabilitiesResultWire }
  | {
      ok: false
      reason: string
      responseStatus?: number
      networkErrorMessage?: string
      hostAiEndpointDenyDetail?: string
      hostAiEndpointDiagnostics?: HostAiEndpointDiagnostics
    }
const webrtcListHostCapsCache = new Map<string, { at: number; result: ListHostCapResult }>()

type ProbeHostPolicyResult = Awaited<ReturnType<typeof probeHostInferencePolicyFromSandbox>>

const PROBE_TTL_MS = 5000
const probeCache = new Map<string, { result: ProbeHostPolicyResult; ts: number }>()
const inflightProbes = new Map<string, Promise<ProbeHostPolicyResult>>()

/** Drop capability-probe debounce (e.g. after role / transport change). */
export function invalidateProbeCache(handshakeId?: string): void {
  invalidateSbxAiCapsTerminalCache(handshakeId)
  if (handshakeId) {
    const h = String(handshakeId).trim()
    if (!h) {
      return
    }
    probeCache.delete(h)
    inflightProbes.delete(h)
    webrtcListHostCapsCache.delete(h)
    listHostCapsProbeLast.delete(h)
  } else {
    probeCache.clear()
    inflightProbes.clear()
    webrtcListHostCapsCache.clear()
    listHostCapsProbeLast.clear()
  }
}

const listHostCapsProbeInflight = new Map<string, Promise<ListHostCapResult>>()
const listHostCapsProbeLast = new Map<string, { at: number; result: ListHostCapResult }>()
/** In-flight only (no TTL cache): sequential list runs must observe updated Host probe mocks / policy. */
const policyProbeInflight = new Map<string, Promise<ProbeHostPolicyResult>>()

async function coalescedListHostCapabilitiesProbe(hid: string, run: () => Promise<ListHostCapResult>): Promise<ListHostCapResult> {
  const h = hid.trim()
  const now = Date.now()
  const last = listHostCapsProbeLast.get(h)
  if (last && now - last.at < LIST_PROBE_COALESCE_MS) {
    console.log(`${L} probe_coalesced handshake=${h} age_ms=${now - last.at}`)
    return last.result
  }
  const fly = listHostCapsProbeInflight.get(h)
  if (fly) {
    console.log(`${L} probe_coalesced handshake=${h} age_ms=0 joining_inflight=1`)
    return fly
  }
  const p = run()
    .then((r) => {
      listHostCapsProbeLast.set(h, { at: Date.now(), result: r })
      return r
    })
    .finally(() => {
      if (listHostCapsProbeInflight.get(h) === p) {
        listHostCapsProbeInflight.delete(h)
      }
    })
  listHostCapsProbeInflight.set(h, p)
  return p
}

async function coalescedProbeHostPolicyForList(
  hid: string,
  rowChain: string | undefined,
  rowBeapCorrelationId: string,
): Promise<ProbeHostPolicyResult> {
  const h = hid.trim()
  const fly = policyProbeInflight.get(h)
  if (fly) {
    console.log(`${L} probe_coalesced handshake=${h} age_ms=0 joining_inflight=1`)
    return fly
  }
  const p = probeHostInferencePolicyFromSandbox(h, { correlationChain: rowChain, beapCorrelationId: rowBeapCorrelationId }).finally(() => {
    if (policyProbeInflight.get(h) === p) {
      policyProbeInflight.delete(h)
    }
  })
  policyProbeInflight.set(h, p)
  return p
}

/**
 * Throttles `coalescedProbeHostPolicyForList` (Host capability policy probe) for rapid list refreshes.
 * Logs `probe_capabilities_start` only on a fresh run; cache / outer inflight reuse are skipped lines.
 */
async function runDebouncedPolicyProbeForList(
  hid: string,
  rowChain: string | undefined,
  rowBeapCorrelationId: string,
): Promise<ProbeHostPolicyResult> {
  const h = hid.trim()
  const now = Date.now()
  const hit = probeCache.get(h)
  if (hit && now - hit.ts < PROBE_TTL_MS) {
    const age = now - hit.ts
    console.log(`${L} probe_capabilities_skipped handshake=${h} reason=cache_hit_age_ms=${age}`)
    return hit.result
  }
  const ex = inflightProbes.get(h)
  if (ex) {
    console.log(`${L} probe_capabilities_skipped handshake=${h} reason=inflight_reuse`)
    return ex
  }
  console.log(`${L} probe_capabilities_start handshake=${h}`)
  const p = coalescedProbeHostPolicyForList(h, rowChain, rowBeapCorrelationId)
    .then((r) => {
      probeCache.set(h, { result: r, ts: Date.now() })
      return r
    })
    .finally(() => {
      if (inflightProbes.get(h) === p) {
        inflightProbes.delete(h)
      }
    })
  inflightProbes.set(h, p)
  return p
}

/** Clears the short TTL WebRTC list caps cache. Used by unit tests to avoid order-dependent state. */
export function resetWebrtcListHostCapsCacheForTests(): void {
  invalidateSbxAiCapsTerminalCache()
  webrtcListHostCapsCache.clear()
  listHostCapsProbeInflight.clear()
  listHostCapsProbeLast.clear()
  policyProbeInflight.clear()
  probeCache.clear()
  inflightProbes.clear()
  hostAiDirectProbe429CooldownUntil.clear()
}

/** Clears ensure-session throttle cache (module singleton). For unit tests only. */
export function resetP2pEnsureThrottleCacheForTests(): void {
  lastP2pEnsureByHandshake.clear()
  lastRelayP2pNudgeByHandshake.clear()
}

/** After orchestrator build bump: drop cached list/probe state so Host AI is re-derived fresh. */
export function clearHostAiListTransientStateForOrchestratorBuildChange(): void {
  invalidateSbxAiCapsTerminalCache()
  stableListProbeChainByHandshake.clear()
  lastP2pEnsureByHandshake.clear()
  lastRelayP2pNudgeByHandshake.clear()
  webrtcListHostCapsCache.clear()
  listHostCapsProbeInflight.clear()
  listHostCapsProbeLast.clear()
  policyProbeInflight.clear()
  probeCache.clear()
  inflightProbes.clear()
  hostAiDirectProbe429CooldownUntil.clear()
  resetProbeHostInferencePolicyInFlightForTests()
  clearHostAiTransportDecideDedupeCache()
}

/** UI phase for Host AI selector (from transport policy + probe); do not infer from p2p_endpoint_kind alone. */
export type HostP2pUiPhase =
  | 'connecting'
  | 'relay_reconnecting'
  | 'ready'
  | 'p2p_unavailable'
  | 'legacy_http_invalid'
  | 'policy_disabled'
  | 'no_model'
  | 'hidden'
  /** Capability probe: HTTP 401/403 / token rejected on Host or gateway. */
  | 'probe_access_denied'
  /** Capability probe: HTTP 429 on Host or gateway. */
  | 'probe_rate_limited'
  /** Capability probe: HTTP 5xx or invalid success response on probe path. */
  | 'probe_gateway_error'
  /** Capability probe: transport/DNS/refused or probe timeout. */
  | 'probe_unreachable'
  /** Capability probe: HTTP 200 but body was not valid capabilities JSON/shape. */
  | 'probe_invalid_response'
  /**
   * Host’s remote Ollama (on the **paired host machine**) unreachable — not sandbox-local Ollama.
   * Legacy alias: `probe_local_ollama` (misleading name; kept in renderer for one release).
   */
  | 'probe_host_ollama'
  | 'probe_local_ollama'
  /** Peer has not published a resolvable direct endpoint / missing provenance (terminal `HOST_*` codes). */
  | 'host_endpoint_not_advertised'
  | 'host_endpoint_rejected_self'
  /** Endpoint URL does not match the paired host (not the self-owns-endpoint case). */
  | 'host_endpoint_mismatch'
  | 'host_auth_rejected'
  | 'host_transport_unavailable'
  | 'host_provider_unavailable'
  /** Roles, ledger, or route identity do not match Sandbox→Host pairing (not a transport timeout). */
  | 'host_internal_identity_mismatch'

export type HostListTransportMode = 'webrtc_p2p' | 'legacy_http' | 'none'
export type HostListLegacyEndpointKind = 'direct' | 'relay' | 'missing' | 'invalid'

function p2pStackEnabledForList(f: P2pInferenceFlagSnapshot): boolean {
  return f.p2pInferenceEnabled && f.p2pInferenceWebrtcEnabled && f.p2pInferenceSignalingEnabled
}

/** Full signaling stack, or WebRTC intent + relay (signaling URL — session can still be ensured). */
function p2pEnsureEligibleForList(
  f: P2pInferenceFlagSnapshot,
  endpointKind: 'direct' | 'relay' | 'missing' | 'invalid',
): boolean {
  return p2pStackEnabledForList(f) || (isWebRtcHostAiArchitectureEnabled(f) && endpointKind === 'relay')
}

function legacyHttpStatusForDecideLog(
  d: HostAiTransportDeciderResult,
  endpointKind: 'direct' | 'relay' | 'missing' | 'invalid',
): 'valid' | 'invalid' | 'not_checked' {
  if (!d.targetDetected) return 'not_checked'
  // Internal Sandbox→Host: `legacyHttpFallbackViable` is false without `hostAiVerifiedDirectHttp` (decider).
  if (d.legacyHttpFallbackViable) return 'valid'
  /** Relay never supports legacy HTTP POST to p2p_endpoint — invalid for fallback regardless of env default for httpFallback. */
  if (endpointKind === 'relay') return 'invalid'
  if (d.mayUseLegacyHttpFallback) return 'invalid'
  return 'not_checked'
}

/**
 * Map authoritative selector phase to a stable p2pUiPhase for renderer (list targets).
 * `legacy_http_available` is still "resolving" before probe returns — treat as connecting.
 */
export function mapHostAiSelectorPhaseToP2pUiPhase(phase: HostAiSelectorPhase): HostP2pUiPhase {
  switch (phase) {
    case 'hidden':
      return 'hidden'
    case 'detected':
    case 'connecting':
    case 'legacy_http_available':
      /** Transport policy alone must not surface "Host AI · connecting…" — only a probed-ready row may. */
      return 'hidden'
    case 'ready':
      return 'ready'
    case 'p2p_unavailable':
      return 'p2p_unavailable'
    case 'legacy_http_invalid':
      return 'legacy_http_invalid'
    case 'policy_disabled':
      return 'policy_disabled'
    case 'no_model':
      return 'no_model'
    case 'blocked':
      return 'host_transport_unavailable'
  }
}

function primaryLabelForP2pUiPhase(phase: HostP2pUiPhase, readyModelName?: string | null): string {
  switch (phase) {
    case 'connecting':
      return 'Host AI · connecting…'
    case 'relay_reconnecting':
      return 'Host AI · reconnecting to relay…'
    case 'ready':
      return (readyModelName && readyModelName.trim()) || 'Host AI · ready'
    case 'p2p_unavailable':
      return 'Host transport is unavailable'
    case 'legacy_http_invalid':
      return 'Host AI · legacy endpoint unavailable'
    case 'policy_disabled':
      return 'Host AI · disabled by Host'
    case 'no_model':
      return 'Host AI · no active model'
    case 'probe_access_denied':
    case 'host_auth_rejected':
      return 'Host authentication was rejected. Re-pair to refresh access.'
    case 'probe_rate_limited':
      return 'Host is throttling requests. Try again in a moment.'
    case 'probe_gateway_error':
      return 'Host orchestrator returned an error.'
    case 'probe_unreachable':
      return "Host machine isn't reachable on the network."
    case 'probe_invalid_response':
      return "Host responded but the format wasn't recognized."
    case 'probe_host_ollama':
    case 'probe_local_ollama':
    case 'host_provider_unavailable':
      return "The host's local model provider is not available."
    case 'host_endpoint_not_advertised':
      return 'Host has not published a direct endpoint for this pairing.'
    case 'host_endpoint_rejected_self':
      return "Host endpoint points to this device; use the Host computer's advertised address."
    case 'host_endpoint_mismatch':
      return 'The stored host address does not match the paired host.'
    case 'host_transport_unavailable':
      return 'Host transport is unavailable. Check network, relay, and P2P settings.'
    case 'host_internal_identity_mismatch':
      return 'Host AI pairing or roles do not match this handshake. Re-check Sandbox and Host are linked correctly.'
    case 'hidden':
      return 'Host AI unavailable'
  }
}

/** Log token after `detail=probe_` — strips `PROBE_` prefix; transport-not-ready → TRANSPORT_NOT_READY. */
function capabilityProbeLogDetailToken(code: string): string {
  const c = String(code)
  if (c === InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY) return 'TRANSPORT_NOT_READY'
  if (c.startsWith('PROBE_')) return c.slice('PROBE_'.length)
  return c
}

function isHostAiHttpEndpointProvenanceClassFailure(code: string): boolean {
  return (
    code === InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING ||
    code === InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING ||
    code === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING ||
    code === InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH ||
    code === InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING
  )
}

function hostTargetUnavailableCodeForTerminalIdentityProbe(code: string): HostTargetUnavailableCode {
  switch (code) {
    case InternalInferenceErrorCode.POLICY_FORBIDDEN:
      return 'HOST_POLICY_DISABLED'
    case InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED:
      return 'HOST_AI_CAPABILITY_ROLE_REJECTED'
    case InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH:
      return 'HOST_AI_ROUTE_OWNER_MISMATCH'
    case InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH:
      return 'HOST_AI_ENDPOINT_OWNER_MISMATCH'
    case InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST:
      return 'HOST_AI_LOCAL_BEAP_NOT_PEER_HOST'
    case InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING:
    case InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING:
      return 'HOST_AI_PEER_ENDPOINT_MISSING'
    case InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE:
      return 'HOST_AI_NO_VERIFIED_PEER_ROUTE'
    case InternalInferenceErrorCode.HOST_AI_NO_ROUTE:
      return 'HOST_AI_NO_ROUTE'
    case InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING:
    case InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING:
      return 'HOST_AI_ENDPOINT_PROVENANCE'
    case InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC:
    case InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE:
      return 'HOST_AI_LEDGER_ASYMMETRIC'
    case InternalInferenceErrorCode.HOST_AI_PAIRING_STALE:
      return 'HOST_AI_PAIRING_STALE'
    default:
      return 'CAPABILITY_PROBE_FAILED'
  }
}

function hostP2pUiPhaseForTerminalIdentityProbe(code: string, hostAiEndpointDenyDetail: string | undefined): HostP2pUiPhase {
  if (code === InternalInferenceErrorCode.POLICY_FORBIDDEN) {
    return 'policy_disabled'
  }
  if (isHostAiHttpEndpointProvenanceClassFailure(code)) {
    return hostP2pUiPhaseForHostEndpointProvenance(code, hostAiEndpointDenyDetail)
  }
  if (code === InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH) {
    return 'host_endpoint_mismatch'
  }
  if (code === InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST) {
    return 'host_endpoint_rejected_self'
  }
  if (code === InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE || code === InternalInferenceErrorCode.HOST_AI_NO_ROUTE) {
    return 'host_endpoint_not_advertised'
  }
  if (
    code === InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED ||
    code === InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC ||
    code === InternalInferenceErrorCode.HOST_AI_PAIRING_STALE ||
    code === InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE
  ) {
    return 'host_internal_identity_mismatch'
  }
  return hostP2pUiPhaseForProbeFailureCode(code)
}

function hostAiStructuredReasonForTerminalIdentityProbe(
  code: string,
  hostAiEndpointDenyDetail: string | undefined,
): HostAiStructuredUnavailableReason {
  if (code === InternalInferenceErrorCode.POLICY_FORBIDDEN) {
    return 'host_policy_forbidden'
  }
  if (isHostAiHttpEndpointProvenanceClassFailure(code)) {
    return hostAiStructuredForEndpointProvenanceUiPhase(
      hostP2pUiPhaseForHostEndpointProvenance(code, hostAiEndpointDenyDetail),
    )
  }
  switch (code) {
    case InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH:
      return 'host_route_owner_mismatch'
    case InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST:
      return 'host_local_beap_not_peer_host'
    case InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE:
      return 'host_no_verified_peer_route'
    case InternalInferenceErrorCode.HOST_AI_NO_ROUTE:
      return 'host_no_route'
    case InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED:
      return 'host_capability_role_rejected'
    case InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC:
    case InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE:
      return 'ledger_asymmetric'
    case InternalInferenceErrorCode.HOST_AI_PAIRING_STALE:
      return 'pairing_stale'
    default:
      return 'capability_probe_failed'
  }
}

function hostP2pUiPhaseForHostEndpointProvenance(
  code: string,
  hostAiEndpointDenyDetail: string | undefined,
): HostP2pUiPhase {
  if (code === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING) {
    return 'host_endpoint_not_advertised'
  }
  if (
    code === InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING ||
    code === InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING ||
    code === InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING
  ) {
    return 'host_endpoint_not_advertised'
  }
  if (code === InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH) {
    const d = (hostAiEndpointDenyDetail ?? '').trim()
    if (d === 'self_endpoint_selected' || d === 'self_local_beap_selected') {
      return 'host_endpoint_rejected_self'
    }
    return 'host_endpoint_mismatch'
  }
  return 'p2p_unavailable'
}

function hostAiStructuredForEndpointProvenanceUiPhase(phase: HostP2pUiPhase): HostAiStructuredUnavailableReason {
  if (phase === 'host_endpoint_not_advertised') return 'host_endpoint_not_advertised'
  if (phase === 'host_endpoint_rejected_self') return 'host_endpoint_rejected_self'
  if (phase === 'host_endpoint_mismatch') return 'host_endpoint_mismatch'
  return 'capability_probe_failed'
}

function hostP2pUiPhaseForProbeFailureCode(code: string): HostP2pUiPhase {
  switch (code) {
    case InternalInferenceErrorCode.HOST_AI_DIRECT_AUTH_MISSING:
    case InternalInferenceErrorCode.PROBE_AUTH_REJECTED:
      return 'host_auth_rejected'
    case InternalInferenceErrorCode.PROBE_RATE_LIMITED:
      return 'probe_rate_limited'
    case InternalInferenceErrorCode.PROBE_HOST_ERROR:
      return 'probe_gateway_error'
    case InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE:
    case InternalInferenceErrorCode.PROVIDER_TIMEOUT:
      return 'probe_unreachable'
    case InternalInferenceErrorCode.PROBE_INVALID_RESPONSE:
      return 'probe_invalid_response'
    case InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE:
    case InternalInferenceErrorCode.OLLAMA_UNAVAILABLE:
      return 'probe_host_ollama'
    case InternalInferenceErrorCode.PROBE_NO_MODELS:
      return 'no_model'
    case InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC:
    case InternalInferenceErrorCode.HOST_AI_PAIRING_STALE:
      return 'host_internal_identity_mismatch'
    case InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY:
      return 'host_transport_unavailable'
    case InternalInferenceErrorCode.HOST_AI_NO_ROUTE:
      return 'host_endpoint_not_advertised'
    case InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED:
      return 'host_internal_identity_mismatch'
    default:
      return 'p2p_unavailable'
  }
}

function hostAiStructuredReasonForProbeCode(code: string): HostAiStructuredUnavailableReason {
  switch (code) {
    case InternalInferenceErrorCode.HOST_AI_DIRECT_AUTH_MISSING:
    case InternalInferenceErrorCode.PROBE_AUTH_REJECTED:
      return 'host_auth_rejected'
    case InternalInferenceErrorCode.PROBE_RATE_LIMITED:
      return 'rate_limited'
    case InternalInferenceErrorCode.PROBE_HOST_ERROR:
      return 'gateway_error'
    case InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE:
    case InternalInferenceErrorCode.PROVIDER_TIMEOUT:
      return 'host_unreachable'
    case InternalInferenceErrorCode.PROBE_INVALID_RESPONSE:
      return 'invalid_response'
    case InternalInferenceErrorCode.OLLAMA_UNAVAILABLE:
    case InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE:
      return 'host_remote_ollama_down'
    case InternalInferenceErrorCode.PROVIDER_UNAVAILABLE:
      return 'provider_not_ready'
    case InternalInferenceErrorCode.PROBE_NO_MODELS:
      return 'no_models'
    case InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC:
      return 'ledger_asymmetric'
    case InternalInferenceErrorCode.HOST_AI_PAIRING_STALE:
      return 'pairing_stale'
    case InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING:
    case InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING:
    case InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING:
    case InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING:
      return 'host_endpoint_not_advertised'
    case InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH:
      return 'endpoint_provenance_missing'
    case InternalInferenceErrorCode.HOST_AI_NO_ROUTE:
      return 'host_no_route'
    case InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH:
      return 'host_route_owner_mismatch'
    case InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST:
      return 'host_local_beap_not_peer_host'
    case InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE:
      return 'host_no_verified_peer_route'
    case InternalInferenceErrorCode.POLICY_FORBIDDEN:
      return 'host_policy_forbidden'
    case InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED:
      return 'host_capability_role_rejected'
    default:
      return 'capability_probe_failed'
  }
}

/**
 * User-visible copy for disabled rows: use `displayTitle` / `primaryLabelForP2pUiPhase` / `p2pUiPhase` (STEP 7–9).
 * Legacy “direct P2P / MVP endpoint” subtitle blobs were removed; they collided with WebRTC + relay signaling.
 */
/**
 * Rejection / disable reasons for internal Host target discovery (aligned logging only).
 * See: STEP 3 — Make active internal Host handshake discovery reliable.
 */
export type HostInternalInferenceRejectReason =
  | 'DB_UNAVAILABLE'
  | 'NOT_SANDBOX_MODE'
  | 'NOT_ACTIVE'
  | 'NOT_INTERNAL'
  | 'NOT_SAME_PRINCIPAL'
  | 'PEER_NOT_HOST'
  | 'LOCAL_NOT_SANDBOX'
  | 'IDENTITY_INCOMPLETE'
  | 'MISSING_P2P_ENDPOINT'
  | 'ENDPOINT_NOT_DIRECT'
  | 'POLICY_DISABLED'
  | 'CAPABILITY_PROBE_FAILED'
  | 'HOST_NO_ACTIVE_LOCAL_LLM'
  | 'UNKNOWN'

type DerivedInternalRoles = ReturnType<typeof deriveInternalHandshakeRoles>

function recordToInternalRoleSource(r: HandshakeRecord): InternalHandshakeRoleSource {
  return {
    handshake_type: r.handshake_type,
    state: r.state,
    local_role: r.local_role,
    initiator_device_role: r.initiator_device_role,
    acceptor_device_role: r.acceptor_device_role,
    initiator_device_name: r.initiator_device_name,
    acceptor_device_name: r.acceptor_device_name,
    initiator_coordination_device_id: r.initiator_coordination_device_id,
    acceptor_coordination_device_id: r.acceptor_coordination_device_id,
    internal_peer_device_id: r.internal_peer_device_id,
    internal_peer_device_role: r.internal_peer_device_role,
    internal_peer_computer_name: r.internal_peer_computer_name,
    internal_peer_pairing_code: r.internal_peer_pairing_code,
    internal_coordination_identity_complete: r.internal_coordination_identity_complete,
    internal_coordination_repair_needed: r.internal_coordination_repair_needed,
  }
}

function deriveFromRecord(r: HandshakeRecord): DerivedInternalRoles {
  return deriveInternalHandshakeRoles(recordToInternalRoleSource(r))
}

/** This instance (coordination id) is Sandbox and peer is Host, same account — the Host AI target shape. */
function rowProvesLocalSandboxToHostForHostAi(r: HandshakeRecord): boolean {
  if (!handshakeSamePrincipal(r)) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  return dr.ok && dr.localRole === 'sandbox' && dr.peerRole === 'host'
}

function mapRoleGateFromDerived(d: DerivedInternalRoles): HostInternalInferenceRejectReason {
  if (d.localDeviceRole !== 'sandbox') return 'LOCAL_NOT_SANDBOX'
  if (d.peerDeviceRole !== 'host') return 'PEER_NOT_HOST'
  return 'UNKNOWN'
}

/**
 * When `assertLedgerRolesSandboxToHost` fails and we cannot use the "checking" placeholder (no host+sandbox
 * device role pair in metadata), still emit one **disabled** Host row so the selector is never empty.
 */
function draftDisabledSandboxHostRoleMetadata(
  r0: HandshakeRecord,
  rr: HostInternalInferenceRejectReason,
  db: unknown,
): HostTargetDraft {
  const hid = r0.handshake_id
  const ml = metaLocal(hostComputerNameFromHandshakeRecord(r0), r0.internal_peer_pairing_code ?? undefined)
  const lek = epKindToListKind(p2pEndpointKind(db, r0.p2p_endpoint))
  return {
    kind: 'host_internal',
    id: buildHostTargetId(hid, 'unavailable'),
    label: primaryLabelForP2pUiPhase('hidden'),
    display_label: primaryLabelForP2pUiPhase('hidden'),
    displayTitle: primaryLabelForP2pUiPhase('hidden'),
    displaySubtitle: secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay),
    model: null,
    model_id: null,
    provider: 'host_internal',
    handshake_id: hid,
    host_device_id: (coordinationDeviceIdForHandshakeDeviceRole(r0, 'host') ?? '').trim() || '',
    host_computer_name: ml.hostName,
    host_pairing_code: ml.digits6,
    host_orchestrator_role: 'host',
    host_orchestrator_role_label: ml.roleLabel,
    internal_identifier_6: ml.digits6,
    secondary_label: secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay),
    direct_reachable: false,
    policy_enabled: false,
    available: false,
    availability: 'not_configured',
    unavailable_reason: 'SANDBOX_HOST_ROLE_METADATA',
    host_role: 'Host',
    inference_error_code: InternalInferenceErrorCode.HOST_AI_ROLE_MISMATCH,
    host_ai_target_status: 'untrusted',
    canChat: false,
    canUseTopChatTools: false,
    canUseOllamaDirect: false,
    trusted: false,
    selector_phase: 'blocked',
    p2pUiPhase: mapHostAiSelectorPhaseToP2pUiPhase('blocked'),
    failureCode: InternalInferenceErrorCode.HOST_AI_ROLE_MISMATCH,
    transportMode: 'none',
    legacyEndpointKind: lek,
  }
}

function peerDeviceRoleForLogD(d: DerivedInternalRoles): 'host' | 'sandbox' | 'unknown' {
  const p = d.peerDeviceRole
  if (p === 'host' || p === 'sandbox') return p
  return 'unknown'
}

function configuredModeForLog(m: string): 'host' | 'sandbox' | 'unknown' {
  if (m === 'host' || m === 'sandbox') return m
  return 'unknown'
}

function logInternalCandidate(
  r: HandshakeRecord,
  db: any,
  mainMode: string,
  d: DerivedInternalRoles,
): void {
  const sp = handshakeSamePrincipal(r)
  const idc = r.internal_coordination_identity_complete === true
  const epKind = p2pEndpointKind(db, r.p2p_endpoint)
  const peerName = hostComputerNameFromHandshakeRecord(r)
  const digits6 = digits6Only(r.internal_peer_pairing_code ?? undefined)
  const ldr = d.localDeviceRole
  const pdr = peerDeviceRoleForLogD(d)
  const lr = d.localDeviceRole == null ? 'null' : d.localDeviceRole
  const pr = d.peerDeviceRole == null ? 'null' : d.peerDeviceRole
  console.log(
    `${L} role_source=handshake configured_mode=${configuredModeForLog(mainMode)} local_role=${lr} peer_role=${pr}`,
  )
  const cm = configuredModeForLog(mainMode)
  if (cm === 'host' && d.localDeviceRole === 'sandbox') {
    console.log(
      `${L} mode_mismatch configured_mode=${cm} handshake_local_role=${lr} handshake=${r.handshake_id}`,
    )
  } else if (cm === 'sandbox' && d.localDeviceRole === 'host') {
    console.log(
      `${L} mode_mismatch configured_mode=${cm} handshake_local_role=${lr} handshake=${r.handshake_id}`,
    )
  }
  console.log(
    `${L} candidate handshake=${r.handshake_id} local_mode=${mainMode} ledger_local_role=${r.local_role} local_device_role=${
      ldr ?? 'unknown'
    } peer_device_role=${pdr} same_principal=${sp} internal_coordination_identity_complete=${idc} p2p_endpoint_kind=${epKind} peer_display_name=${peerName} pairing_6=${digits6 || '—'}`,
  )
}

/** Exposed on disabled Host AI rows; aligned with product failure taxonomy (STEP 3). */
export type HostTargetUnavailableCode =
  | 'IDENTITY_INCOMPLETE'
  | 'MISSING_P2P_ENDPOINT'
  | 'ENDPOINT_NOT_DIRECT'
  /** Stored endpoint is not valid direct-LAN (relay, localhost, 127.0.0.1, invalid URL) for MVP. */
  | 'MVP_P2P_ENDPOINT_INVALID'
  | 'HOST_DIRECT_P2P_UNREACHABLE'
  | 'HOST_POLICY_DISABLED'
  | 'HOST_NO_ACTIVE_LOCAL_LLM'
  | 'CAPABILITY_PROBE_FAILED'
  | 'UNKNOWN'
  | 'CHECKING_CAPABILITIES'
  | 'SANDBOX_HOST_ROLE_METADATA'
  | 'INTERNAL_RELAY_P2P_NOT_READY'
  | 'HOST_AI_CAPABILITY_ROLE_REJECTED'
  | 'HOST_AI_ROUTE_OWNER_MISMATCH'
  | 'HOST_AI_ENDPOINT_OWNER_MISMATCH'
  | 'HOST_AI_LOCAL_BEAP_NOT_PEER_HOST'
  | 'HOST_AI_PEER_ENDPOINT_MISSING'
  | 'HOST_AI_NO_VERIFIED_PEER_ROUTE'
  | 'HOST_AI_NO_ROUTE'
  | 'HOST_AI_ENDPOINT_PROVENANCE'
  | 'HOST_AI_LEDGER_ASYMMETRIC'
  | 'HOST_AI_PAIRING_STALE'

export type HostInferenceListAvailability =
  | 'available'
  | 'host_offline'
  | 'direct_unreachable'
  | 'policy_disabled'
  | 'model_unavailable'
  /** Listing runs on `ollama_direct` only — BEAP/top-chat gated (distinct from `model_unavailable` hard failure). */
  | 'ollama_direct_lane'
  | 'handshake_inactive'
  | 'not_configured'
  | 'identity_incomplete'
  /** Resolving: ACTIVE internal same-principal host↔sandbox row seen; still resolving labels / P2P. */
  | 'checking_host'

/** Strict gating: Host AI is selectable only when probe + provider + transport are all ready. */
export type HostAiStructuredUnavailableReason =
  | 'provider_not_ready'
  | 'no_models'
  | 'transport_not_ready'
  | 'capability_probe_failed'
  | 'auth_rejected'
  | 'rate_limited'
  | 'gateway_error'
  | 'host_unreachable'
  | 'invalid_response'
  /** Paired **host** machine Ollama unreachable (capabilities wire) — not sandbox-local Ollama. */
  | 'host_remote_ollama_down'
  /** @deprecated use host_remote_ollama_down */
  | 'local_ollama_down'
  | 'ledger_asymmetric'
  | 'pairing_stale'
  | 'endpoint_provenance_missing'
  | 'host_endpoint_not_advertised'
  | 'host_endpoint_rejected_self'
  | 'host_endpoint_mismatch'
  | 'host_auth_rejected'
  | 'host_transport_unavailable'
  | 'host_provider_unavailable'
  /** Host policy / role gate (`POLICY_FORBIDDEN`, `forbidden_host_role`). */
  | 'host_policy_forbidden'
  /** Ledger says Sandbox→Host roles are wrong for capability RPC. */
  | 'host_capability_role_rejected'
  /** Resolved route owner ≠ handshake peer Host coordination id. */
  | 'host_route_owner_mismatch'
  /** Local BEAP selected where peer-Host BEAP was required. */
  | 'host_local_beap_not_peer_host'
  /** No verified peer-Host-owned route candidate. */
  | 'host_no_verified_peer_route'
  /** No WebRTC, relay session, or verified direct BEAP — distinct from generic probe failure. */
  | 'host_no_route'
  /** Sandbox→Host ledger/endpoint pointed at local BEAP or resolve denied — transport/trust misrouting (not Host policy). */
  | 'host_transport_trust_misrouting'
  /** LAN `ollama_direct`: `/api/tags` could not reach Host Ollama from Sandbox. */
  | 'ollama_direct_tags_unreachable'
  /** LAN `ollama_direct`: Host advertisement failed validation / tags parse. */
  | 'ollama_direct_invalid_advertisement'
  /** LAN `ollama_direct`: reachable via `/api/tags` but zero models. */
  | 'ollama_direct_no_models_installed'

export interface HostInternalInferenceListItem {
  /** Same as `kind`; preferred for new IPC/selector consumers. */
  type: 'host_internal'
  kind: 'host_internal'
  id: string
  label: string
  model: string | null
  model_id: string | null
  display_label: string
  /** Primary title for selectors (duplicates `label` / `display_label` when unset at draft time). */
  displayTitle: string
  /** One-line pairing / host identity (duplicates `secondary_label`). */
  displaySubtitle: string
  provider: 'host_internal' | 'ollama' | ''
  handshake_id: string
  host_device_id: string
  host_computer_name: string
  host_pairing_code?: string
  host_orchestrator_role: 'host'
  host_orchestrator_role_label: string
  internal_identifier_6: string
  secondary_label: string
  /** Camel-case duplicate for IPC consumers (UI / logging). */
  secondaryLabel: string
  direct_reachable: boolean
  policy_enabled: boolean
  available: boolean
  /** Same as `available` — whether the user can target this Host for inference. */
  hostTargetAvailable: boolean
  availability: HostInferenceListAvailability
  /**
   * When `available` is true, must be `null` / omitted.
   * When false, one of the normalized Host-target reasons (or legacy prose for debugging).
   */
  unavailable_reason: string | null
  host_role: 'Host'
  inference_error_code?: string
  /** Legacy aggregate; omit when lanes use {@link HostInternalInferenceListItem.beapFailureCode} / {@link HostInternalInferenceListItem.ollamaDirectFailureCode}. */
  failureCode: string | null
  /**
   * BEAP ingest / peer top-chat lane only — does not indict LAN `ollama_direct` when tags succeeded.
   * e.g. `HOST_AI_DIRECT_PEER_BEAP_MISSING` while `ollamaDirectFailureCode=null` and models listed.
   */
  beapFailureCode?: string | null
  /** LAN `/api/tags` or ODL execution readiness — orthogonal to BEAP */
  ollamaDirectFailureCode?: string | null
  /**
   * Preferred transport for this row: WebRTC, legacy HTTP, or none.
   * In relay+WebRTC mode the signaling URL may be relay while the data plane is P2P.
   */
  transportMode: HostListTransportMode
  /**
   * Classified p2p_endpoint (ledger); relay is valid for WebRTC signaling and must not block the row when P2P is on.
   */
  legacyEndpointKind: HostListLegacyEndpointKind
  /** Stable UI phase for labels — prefer this over inferring from `legacyEndpointKind` alone. */
  p2pUiPhase: HostP2pUiPhase
  /** From `decideInternalInferenceTransport` — raw policy phase. */
  selector_phase?: HostAiSelectorPhase
  /** UI tri-state: available vs in-flight check vs not selectable. */
  host_selector_state: 'available' | 'checking' | 'unavailable'
  /** Camel-case alias of `host_selector_state` for new consumers. */
  hostSelectorState: 'available' | 'checking' | 'unavailable'
  /** Normalized reason when Host AI is not selectable (strict readiness gating). */
  hostAiStructuredUnavailableReason?: HostAiStructuredUnavailableReason
  /**
   * Always `host_remote` for this list: inference runs on the paired host, independent of sandbox-local providers.
   */
  inferenceTargetContext: 'host_remote'
  host_ai_endpoint_diagnostics?: HostAiEndpointDiagnostics
  hostWireOllamaReachable?: boolean
  /** When set, Sandbox chat targets Host Ollama via LAN `ollama_direct` only (no BEAP/P2P). */
  execution_transport?: 'ollama_direct'
  /** BEAP readiness vs LAN `ollama_direct` only vs trust gap (`host_ai_*` matches diagnostics naming). */
  host_ai_target_status?: HostAiTargetStatus
  /** Host top-chat via trusted BEAP / ingest lane — independent of LAN Ollama reachability. */
  canChat?: boolean
  canUseTopChatTools?: boolean
  /** Sandbox may use LAN Host Ollama (`ollama_direct`) while `canChat` is false. */
  canUseOllamaDirect?: boolean
  /** Mirrors handshake transport trust resolution (`inferenceHandshakeTrusted`). */
  trusted?: boolean
  /** Trusted peer-hosted BEAP ingest — top-chat / BEAP-backed tools. */
  beapReady?: boolean
  /** LAN Ollama `/api/tags` probe succeeded (`ollama_direct` execution lane). */
  ollamaDirectReady?: boolean
  /** Host's active/default model when the policy/caps probe supplied it. */
  hostActiveModel?: string | null
  /** Selector should show at least one model row when true (OR of BEAP + Ollama-direct lanes); independent of legacy `available`. */
  visibleInModelSelector?: boolean
  /** BEAP-route trust (distinct from ledger same-principal `trusted`). */
  trustedForBeap?: boolean
}

export type HostInferenceHostTargetDraft = Omit<
  HostInternalInferenceListItem,
  'host_selector_state' | 'secondaryLabel' | 'hostSelectorState' | 'type' | 'inferenceTargetContext'
>
type HostTargetDraft = HostInferenceHostTargetDraft

function epKindToListKind(
  k: ReturnType<typeof p2pEndpointKind>,
): HostListLegacyEndpointKind {
  if (k === 'missing' || k === 'invalid' || k === 'relay' || k === 'direct') return k
  return 'invalid'
}

/**
 * Runtime diagnostic: one summarized line per paired Host handshake — makes transport/trust regressions searchable in logs.
 */
async function logHostAiTargetSummaryLines(targets: HostInternalInferenceListItem[]): Promise<void> {
  if (targets.length === 0) return
  const hidSet = new Set<string>()
  for (const t of targets) {
    const h = String(t.handshake_id ?? '').trim()
    if (h) hidSet.add(h)
  }
  const modelsCountByHid = new Map<string, number>()
  for (const h of hidSet) {
    modelsCountByHid.set(
      h,
      targets.filter(
        (x) =>
          String(x.handshake_id ?? '').trim() === h &&
          x.model != null &&
          String(x.model ?? '').trim() !== '',
      ).length,
    )
  }
  const endpointAdvertisedByHid = new Map<string, boolean>()
  for (const hid of hidSet) {
    const peek = peekHostAdvertisedMvpDirectEntry(hid)
    endpointAdvertisedByHid.set(hid, Boolean(peek?.url && String(peek.url).trim() !== ''))
  }
  /** One stable row per handshake (prefer ODL lane row over duplicates). */
  function pickSummaryRow(rows: HostInternalInferenceListItem[]): HostInternalInferenceListItem {
    const od = rows.find((r) => r.host_ai_target_status === 'ollama_direct_only')
    if (od) return od
    return rows[0]!
  }
  for (const hid of hidSet) {
    const rowsForHid = targets.filter((x) => String(x.handshake_id ?? '').trim() === hid)
    const t = pickSummaryRow(rowsForHid)
    const peer = String(t.host_device_id ?? '').trim()
    const status = t.host_ai_target_status != null ? String(t.host_ai_target_status) : 'n/a'
    const mc = modelsCountByHid.get(hid) ?? 0
    const epOk = endpointAdvertisedByHid.get(hid) ?? false
    const br = typeof t.beapReady === 'boolean' ? Boolean(t.beapReady) : false
    const odR = typeof t.ollamaDirectReady === 'boolean' ? Boolean(t.ollamaDirectReady) : false
    const visMerged = rowsForHid.some((r) => r.visibleInModelSelector === true)
    console.log(
      `[HOST_AI_TARGET_SUMMARY] handshake=${hid} peer=${peer} status=${status} trusted=${Boolean(
        t.trusted,
      )} beapReady=${br} ollamaDirectReady=${odR} canUseTopChatTools=${Boolean(
        t.canUseTopChatTools,
      )} canUseOllamaDirect=${Boolean(t.canUseOllamaDirect)} modelsCount=${mc} visibleInModelSelector=${visMerged} endpointAdvertised=${epOk}`,
    )
  }
}

function baseMetaFromDec(
  dec: HostAiTransportDeciderResult,
  epK: HostListLegacyEndpointKind,
): Pick<HostTargetDraft, 'p2pUiPhase' | 'failureCode' | 'transportMode' | 'legacyEndpointKind' | 'selector_phase'> {
  return {
    p2pUiPhase: mapHostAiSelectorPhaseToP2pUiPhase(dec.selectorPhase),
    failureCode: dec.failureCode,
    transportMode: dec.preferredTransport,
    legacyEndpointKind: epK,
    selector_phase: dec.selectorPhase,
  }
}

const CAP_UNKNOWN = 'CAPABILITIES_UNKNOWN' as const

/**
 * @param tail - `checking` / `unavailable` (unencoded), or the Host’s active local model name (URL-encoded when not special).
 */
function buildHostTargetId(handshakeId: string, tail: 'checking' | 'unavailable' | string): string {
  const hid = encodeURIComponent(handshakeId.trim())
  if (tail === 'checking' || tail === 'unavailable') {
    return `host-internal:${hid}:${tail}`
  }
  return `host-internal:${hid}:${encodeURIComponent(String(tail).trim())}`
}

function displayPairing(pairing6: string | null | undefined): string {
  const s = (pairing6 ?? '').replace(/\D/g, '')
  if (s.length === 6) return `${s.slice(0, 3)}-${s.slice(3)}`
  return s ? s : '—'
}

function digits6Only(pairing6: string | null | undefined): string {
  const s = (pairing6 ?? '').replace(/\D/g, '')
  return s.length === 6 ? s : ''
}

function metaLocal(displayName: string, pc: string | null | undefined) {
  return {
    hostName: displayName,
    pairingDisplay: displayPairing(pc),
    digits6: digits6Only(pc),
    roleLabel: 'Host orchestrator' as const,
  }
}

function metaFromOkProbe(
  probe: {
    hostComputerNameFromHost?: string
    internalIdentifierDisplayFromHost?: string
    internalIdentifier6FromHost?: string
    hostOrchestratorRoleLabelFromHost?: string
  },
  localName: string,
  pc: string | null | undefined,
) {
  return {
    hostName: probe.hostComputerNameFromHost?.trim() || localName,
    pairingDisplay: probe.internalIdentifierDisplayFromHost || displayPairing(pc),
    digits6: probe.internalIdentifier6FromHost || digits6Only(pc),
    roleLabel: probe.hostOrchestratorRoleLabelFromHost?.trim() || 'Host orchestrator',
  }
}

/** Phase 8 compact selector: one ID line, no role label in the secondary row. */
function secondaryLabelFromMeta(hostName: string, _roleLabel: string, pairingDisplay: string): string {
  return `${hostName.trim() || 'Host'} · ID ${pairingDisplay}`
}

const COPY_HOST_AI_CONNECTING_SUB = 'Checking secure P2P connection to your Host…'
const COPY_HOST_AI_RELAY_RECONNECTING_SUB =
  'Relay rate limits were hit; pausing new connections briefly. Retrying automatically…'
const COPY_HOST_AI_P2P_UNAVAILABLE_SUB =
  'Secure P2P connection could not be established. Try refresh or check the Host.'

function hostAiSubtitleForPhase(phase: HostP2pUiPhase, ml: { hostName: string; roleLabel: string; pairingDisplay: string }): string {
  if (phase === 'connecting') {
    return COPY_HOST_AI_CONNECTING_SUB
  }
  if (phase === 'relay_reconnecting') {
    return COPY_HOST_AI_RELAY_RECONNECTING_SUB
  }
  if (phase === 'p2p_unavailable') {
    return COPY_HOST_AI_P2P_UNAVAILABLE_SUB
  }
  return secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
}

function draftCheckingPlaceholderForHostPair(r0: HandshakeRecord, db: unknown): HostTargetDraft {
  const hid = r0.handshake_id
  const name = hostComputerNameFromHandshakeRecord(r0)
  const pcc = r0.internal_peer_pairing_code ?? undefined
  const ml = metaLocal(name, pcc)
  const lek = epKindToListKind(p2pEndpointKind(db, r0.p2p_endpoint))
  const title = primaryLabelForP2pUiPhase('hidden')
  return {
    kind: 'host_internal',
    id: buildHostTargetId(hid, 'unavailable'),
    label: title,
    display_label: title,
    displayTitle: title,
    displaySubtitle: secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay),
    model: null,
    model_id: null,
    provider: 'host_internal',
    handshake_id: hid,
    host_device_id: (coordinationDeviceIdForHandshakeDeviceRole(r0, 'host') ?? '').trim() || '',
    host_computer_name: ml.hostName,
    host_pairing_code: ml.digits6,
    host_orchestrator_role: 'host',
    host_orchestrator_role_label: ml.roleLabel,
    internal_identifier_6: ml.digits6,
    secondary_label: secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay),
    direct_reachable: false,
    policy_enabled: false,
    available: false,
    availability: 'not_configured',
    unavailable_reason: 'transport_not_ready',
    hostAiStructuredUnavailableReason: 'transport_not_ready',
    host_role: 'Host',
    p2pUiPhase: 'hidden',
    failureCode: 'transport_not_ready',
    transportMode: 'none',
    legacyEndpointKind: lek,
  }
}

/** Lenient: initiator/acceptor device roles are host + sandbox (local_role can be wrong or legacy). */
function isHostSandboxDeviceRoles(r: HandshakeRecord): boolean {
  const a = r.initiator_device_role
  const b = r.acceptor_device_role
  return (a === 'host' && b === 'sandbox') || (a === 'sandbox' && b === 'host')
}

function hostSelectorStateForItem(
  t: Pick<
    HostInternalInferenceListItem,
    'available' | 'availability' | 'unavailable_reason'
  > & {
    visibleInModelSelector?: boolean
  },
): 'available' | 'checking' | 'unavailable' {
  if (t.visibleInModelSelector === true || t.available) return 'available'
  return 'unavailable'
}

/**
 * Mirrors production finalize path for regression tests only — do not call from bundled app code paths.
 */
export function finalizeHostInferenceRowForRegressionTest(
  t: HostInferenceHostTargetDraft,
): HostInternalInferenceListItem {
  return finalizeItem(t as HostTargetDraft)
}

function finalizeItem(t: HostTargetDraft): HostInternalInferenceListItem {
  const resolvedBeapReady =
    typeof t.beapReady === 'boolean'
      ? t.beapReady
      : Boolean(
          t.host_ai_target_status === 'beap_ready' ||
            ((t.available === true || t.canUseTopChatTools === true) &&
              !(
                t.host_ai_target_status === 'ollama_direct_only' ||
                (t.execution_transport === 'ollama_direct' && t.canChat === false)
              )),
        )
  const resolvedOllamaDirectReady =
    typeof t.ollamaDirectReady === 'boolean'
      ? t.ollamaDirectReady
      : Boolean(
          t.host_ai_target_status === 'ollama_direct_only' ||
            (t.execution_transport === 'ollama_direct' &&
              (t.canUseOllamaDirect === true || t.hostWireOllamaReachable === true)),
        )
  const inferredVisible =
    typeof t.visibleInModelSelector === 'boolean'
      ? t.visibleInModelSelector
      : resolvedBeapReady || resolvedOllamaDirectReady
  const hss = hostSelectorStateForItem({ ...t, visibleInModelSelector: inferredVisible })
  const subtitle = t.secondary_label
  const resolvedCanChat =
    typeof t.canChat === 'boolean' ? t.canChat : Boolean(t.available && resolvedBeapReady)
  const resolvedTopChat =
    typeof t.canUseTopChatTools === 'boolean'
      ? t.canUseTopChatTools
      : Boolean(resolvedCanChat && resolvedBeapReady)
  const resolvedOllamaDirect =
    typeof t.canUseOllamaDirect === 'boolean'
      ? t.canUseOllamaDirect
      : Boolean(
          resolvedOllamaDirectReady ||
            (t.hostWireOllamaReachable && t.execution_transport === 'ollama_direct'),
        )
  const resolvedHostTargetAvailable =
    typeof t.hostTargetAvailable === 'boolean'
      ? t.hostTargetAvailable
      : inferredVisible && (resolvedCanChat === true || resolvedOllamaDirect === true)

  /** OD-only with tags: `host_endpoint_not_advertised` must not mark selection definitively invalid for restore */
  let hostAiStructuredUnavailableReasonOut = t.hostAiStructuredUnavailableReason
  if (inferredVisible && resolvedOllamaDirectReady && !resolvedBeapReady) {
    if (hostAiStructuredUnavailableReasonOut === 'host_endpoint_not_advertised') {
      hostAiStructuredUnavailableReasonOut = undefined
    }
  }

  return {
    ...t,
    type: 'host_internal',
    inferenceTargetContext: 'host_remote',
    displayTitle: t.displayTitle ?? t.label,
    displaySubtitle: t.displaySubtitle ?? subtitle,
    beapReady: resolvedBeapReady,
    ollamaDirectReady: resolvedOllamaDirectReady,
    visibleInModelSelector: inferredVisible,
    trustedForBeap:
      typeof t.trustedForBeap === 'boolean'
        ? t.trustedForBeap
        : Boolean(resolvedBeapReady && t.trusted !== false),
    hostTargetAvailable: resolvedHostTargetAvailable,
    canChat: resolvedCanChat,
    canUseTopChatTools: resolvedTopChat,
    canUseOllamaDirect: resolvedOllamaDirect,
    host_selector_state: hss,
    hostSelectorState: hss,
    secondaryLabel: subtitle,
    unavailable_reason: t.available ? null : t.unavailable_reason == null ? null : String(t.unavailable_reason),
    hostAiStructuredUnavailableReason: hostAiStructuredUnavailableReasonOut,
  }
}

/**
 * At least one ACTIVE internal row: same account + handshake-derived Sandbox→Host.
 */
function anyActiveRowProvesLocalSandboxToHostFromDb(db: unknown): boolean {
  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE })
  for (const r0 of rows) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
    if (rowProvesLocalSandboxToHostForHostAi(r0)) return true
  }
  return false
}

/**
 * `handshake:getAvailableModels`: merge `host_internal` rows when the persisted file says sandbox **or**
 * the ACTIVE internal ledger proves this device is the Sandbox side of a Sandbox↔Host pair.
 * Do not use `isSandboxMode()` alone — `orchestrator-mode.json` can remain "host" while the ledger is authoritative.
 */
export function shouldMergeHostInternalRowsForGetAvailableModels(
  isSandboxFromPersistedFile: boolean,
  ledgerProvesInternalSandboxToHost: boolean,
): boolean {
  return isSandboxFromPersistedFile || ledgerProvesInternalSandboxToHost
}

/**
 * Exposed for `orchestrator:getMode` / `handshake:getAvailableModels` — main asks the ledger, not only the persisted host/sandbox file.
 */
export async function hasActiveInternalLedgerSandboxToHostForHostAi(): Promise<boolean> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) return false
  return anyActiveRowProvesLocalSandboxToHostFromDb(db)
}

/**
 * `orchestrator:getMode`: this device is the Host side of an ACTIVE internal same-principal row (hide Host AI ↻ in UI).
 */
export async function hasActiveInternalLedgerLocalHostPeerSandboxForHostUi(): Promise<boolean> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return false
  }
  return hostHasActiveInternalLedgerHostPeerSandboxFromDb(db)
}

/**
 * Last resort: the ledger has an ACTIVE internal Sandbox→Host (same account) row but the pipeline
 * produced zero list entries — add one disabled `UNKNOWN` row so the selector is never empty.
 */
function ensureAtLeastOneHostTargetWhenLedgerProvesSandboxToHost(
  targets: HostInternalInferenceListItem[],
  ledgerActive: HandshakeRecord[],
  handshakeProvesSandboxToHost: boolean,
  mainMode: string,
  db: unknown,
): void {
  if (!handshakeProvesSandboxToHost || targets.length > 0) {
    return
  }
  for (const r0 of ledgerActive) {
    if (!rowProvesLocalSandboxToHostForHostAi(r0)) {
      continue
    }
    const hid = r0.handshake_id
    const pcc = r0.internal_peer_pairing_code ?? undefined
    const displayName = hostComputerNameFromHandshakeRecord(r0)
    const ml = metaLocal(displayName, pcc)
    const secondary = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay) // id line; reasons are tooltips
    const lek = epKindToListKind(p2pEndpointKind(db, r0.p2p_endpoint))
    const title = primaryLabelForP2pUiPhase('p2p_unavailable')
    console.error(
      `${L} list_invariant ledger_proved_sandbox_to_host but_pipeline_emitted_zero_rows handshake=${hid} configured_mode=${configuredModeForLog(
        mainMode,
      )} (adding disabled UNKNOWN)`,
    )
    const t: HostTargetDraft = {
      kind: 'host_internal',
      id: buildHostTargetId(hid, 'unavailable'),
      label: title,
      display_label: title,
      displayTitle: title,
      displaySubtitle: secondary,
      model: null,
      model_id: null,
      provider: 'host_internal',
      handshake_id: hid,
      host_device_id: (coordinationDeviceIdForHandshakeDeviceRole(r0, 'host') ?? '').trim() || '',
      host_computer_name: ml.hostName,
      host_pairing_code: ml.digits6,
      host_orchestrator_role: 'host',
      host_orchestrator_role_label: ml.roleLabel,
      internal_identifier_6: ml.digits6,
      secondary_label: secondary,
      direct_reachable: false,
      policy_enabled: false,
      available: false,
      availability: 'not_configured',
      unavailable_reason: 'UNKNOWN',
      host_role: 'Host',
      inference_error_code: 'UNKNOWN',
      p2pUiPhase: 'p2p_unavailable',
      failureCode: 'UNKNOWN',
      transportMode: 'none',
      legacyEndpointKind: lek,
    }
    targets.push(finalizeItem(t))
    return
  }
  console.error(
    `${L} list_invariant_broken count_says_sandbox_to_host_but_no_matching_row in ledgerActive`,
  )
}

/**
 * Returns Host AI targets for Sandbox: ACTIVE internal, same principal, this device Sandbox ↔ peer Host.
 * When persisted mode is "host" but the ledger still shows an ACTIVE internal Sandbox↔Host row (mis-set file), lists anyway.
 * Real Host machines with no such ledger row get an empty list.
 * Never returns empty when at least one qualifying row exists in the ledger (one row per handshake: available, or disabled with reason).
 */
export async function listSandboxHostInternalInferenceTargets(): Promise<{
  ok: true
  targets: HostInternalInferenceListItem[]
  /** Set when at least one target row called Host (direct P2P capabilities) this run. */
  refreshMeta: { hadCapabilitiesProbed: boolean }
}> {
  const mainMode = getOrchestratorMode().mode
  console.log(
    `${L} list_begin configured_mode=${configuredModeForLog(mainMode)} (orchestrator file is a hint, not a hard block)`,
  )
  if (!isHostAiP2pUxEnabled()) {
    console.log(
      `${L} list_skip reason=host_ai_p2p_ux_disabled (WRDESK_HOST_AI_DISABLED or bundle without Host AI P2P) — no Host AI list rows`,
    )
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }
  logHostAiP2pFlagsAndSource()

  const db = await getHandshakeDbForInternalInference()
  const dbOk = db != null
  console.log(`${L} db_available=${dbOk}`)
  if (db) {
    const hEff = getHostAiLedgerRoleSummaryFromDb(db, getInstanceId().trim(), String(mainMode))
    console.log(
      `${L} host_ai_ledger_effective ` +
        `role=${hEff.effective_host_ai_role} can_probe_host_endpoint=${hEff.can_probe_host_endpoint} ` +
        `can_publish_host_endpoint=${hEff.can_publish_host_endpoint} ` +
        `orchestrator_mismatch=${hEff.any_orchestrator_mismatch} (handshake is authoritative)`,
    )
  }

  if (!db) {
    console.log(`${L} rejected reason=DB_UNAVAILABLE (ledger not open; check SSO / session)`)
    console.log(`${L} list_empty reason=handshake_db_unavailable`)
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }

  {
    const fList = getP2pInferenceFlags()
    const skipListRepair =
      fList.p2pInferenceWebrtcEnabled && fList.p2pInferenceEnabled && !fList.p2pInferenceHttpFallback
    if (!skipListRepair) {
      const repair = await import('./p2pEndpointRepair')
      repair.runP2pEndpointRepairPass(db, 'list_inference_targets')
      const { sandboxMaybeRequestHostDirectBeapAdvertisement } = await import('./sandboxHostAiDirectBeapAdRequest')
      await sandboxMaybeRequestHostDirectBeapAdvertisement(db, 'list_inference_targets').catch(() => {})
    }
  }

  /** 1) ACTIVE rows first, then 2) derive roles, 3) count handshake Sandbox→Host. */
  const ledgerActive = listHandshakeRecords(db, { state: HandshakeState.ACTIVE })
  const activeInternalCount = ledgerActive.filter((r) => r.handshake_type === 'internal').length
  let activeInternalSandboxToHostCount = 0
  let handshakeProvesSandboxToHost = false
  for (const r0 of ledgerActive) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
    if (rowProvesLocalSandboxToHostForHostAi(r0)) {
      activeInternalSandboxToHostCount += 1
      handshakeProvesSandboxToHost = true
    }
  }
  console.log(`${L} active_internal_count=${activeInternalCount}`)
  console.log(`${L} active_internal_sandbox_to_host_count=${activeInternalSandboxToHostCount}`)

  logHostAiLedgerView(
    mainMode,
    activeInternalCount,
    activeInternalSandboxToHostCount,
    ledgerActive,
    'list_targets_common',
  )

  if (!handshakeProvesSandboxToHost && mainMode !== 'sandbox') {
    console.log(
      `${L} list_done count=0 reason=no_sandbox_to_host_for_this_instance_and_configured_mode_not_sandbox (Host AI not needed)`,
    )
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }

  const targets: HostInternalInferenceListItem[] = []
  let hadCapabilitiesProbed = false

  for (const r0 of ledgerActive) {
    if (r0.handshake_type !== 'internal') {
      console.log(`${L} rejected handshake=${r0.handshake_id} reason=NOT_INTERNAL`)
      continue
    }
    if (r0.state !== HandshakeState.ACTIVE) {
      console.log(`${L} rejected handshake=${r0.handshake_id} reason=NOT_ACTIVE`)
      continue
    }

    const derived = deriveFromRecord(r0)
    logInternalCandidate(r0, db, mainMode, derived)
    if (!handshakeSamePrincipal(r0)) {
      console.log(`${L} rejected handshake=${r0.handshake_id} reason=NOT_SAME_PRINCIPAL`)
      continue
    }
    const drInst = deriveInternalHostAiPeerRoles(r0, getInstanceId().trim())
    const roleGateOk = drInst.ok && drInst.localRole === 'sandbox' && drInst.peerRole === 'host'
    if (!roleGateOk) {
      const rr = mapRoleGateFromDerived(derived)
      if (isHostSandboxDeviceRoles(r0)) {
        console.log(
          `${L} target_placeholder handshake=${r0.handshake_id} reason=handshake_sandbox_to_host_mismatch detail=${rr}`,
        )
        targets.push(finalizeItem(draftCheckingPlaceholderForHostPair(r0, db)))
        continue
      }
      console.log(
        `${L} target_disabled handshake=${r0.handshake_id} reason=SANDBOX_HOST_ROLE_METADATA detail=${rr}`,
      )
      targets.push(finalizeItem(draftDisabledSandboxHostRoleMetadata(r0, rr, db)))
      continue
    }

    const hid = r0.handshake_id
    const ar = assertRecordForServiceRpc(r0)
    if (!ar.ok) {
      const ur: HostTargetUnavailableCode = 'IDENTITY_INCOMPLETE'
      const ml = metaLocal(hostComputerNameFromHandshakeRecord(r0), r0.internal_peer_pairing_code ?? undefined)
      const sub = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const tle = epKindToListKind(p2pEndpointKind(db, r0.p2p_endpoint))
      const ht = primaryLabelForP2pUiPhase('hidden')
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: ht,
        display_label: ht,
        displayTitle: ht,
        displaySubtitle: sub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: (coordinationDeviceIdForHandshakeDeviceRole(r0, 'host') ?? '').trim() || '',
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sub,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'identity_incomplete',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: 'IDENTITY_INCOMPLETE',
        p2pUiPhase: 'hidden',
        failureCode: 'IDENTITY_INCOMPLETE',
        transportMode: 'none',
        legacyEndpointKind: tle,
      }
      console.log(`${L} target_disabled handshake=${hid} reason=IDENTITY_INCOMPLETE detail=assertRecord_${ar.code}`)
      targets.push(finalizeItem(t))
      continue
    }

    const r = ar.record
    logInternalHostHandshakeP2pInspect(db, r)
    const displayName = hostComputerNameFromHandshakeRecord(r)
    const hostDevice = (coordinationDeviceIdForHandshakeDeviceRole(r, 'host') ?? '').trim() || ''
    const pcc = r.internal_peer_pairing_code ?? undefined
    if (hostDevice) {
      reconcileHostAiPairingEntry(hid, hostDevice)
      refreshHostAiPairingStaleByTtl(hid, hostDevice)
    }
    const pairBlock = hostDevice ? hostAiPairingListBlock(hid, hostDevice) : { block: false as const }
    if (pairBlock.block) {
      const mlB = metaLocal(displayName, pcc)
      const subB = secondaryLabelFromMeta(mlB.hostName, mlB.roleLabel, mlB.pairingDisplay)
      const lekB = epKindToListKind(p2pEndpointKind(db, r.p2p_endpoint))
      const tPair: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        displayTitle: 'Host AI unavailable',
        displaySubtitle: `${pairBlock.userMessage} — ${subB}`,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: mlB.hostName,
        host_pairing_code: mlB.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: mlB.roleLabel,
        internal_identifier_6: mlB.digits6,
        secondary_label: subB,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: 'pairing_ledger_terminal',
        host_role: 'Host',
        inference_error_code: pairBlock.code,
        hostAiStructuredUnavailableReason:
          pairBlock.code === InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC
            ? 'ledger_asymmetric'
            : 'pairing_stale',
        p2pUiPhase: 'p2p_unavailable',
        failureCode: pairBlock.code,
        transportMode: 'none',
        legacyEndpointKind: lekB,
      }
      console.log(`${L} target_pairing_terminal handshake=${hid} code=${pairBlock.code} (no_probe_no_repair)`)
      targets.push(finalizeItem(tPair))
      continue
    }
    const fRow = getP2pInferenceFlags()
    /** Cooldown for BEAP/policy HTTP probes — Ollama LAN tags may still bypass listing when already enumerated. */
    const until429 = hostAiDirectProbe429CooldownUntil.get(hid) ?? 0
    /**
     * Ollama-direct `/api/tags` — runs before `decideInternalInferenceTransport` so BEAP trust / P2P selector
     * cannot block LAN model discovery (`list_targets` is not gated on BEAP transport alone).
     */
    let odCandPrefetch = getSandboxOllamaDirectRouteCandidate(hid)
    let odTagsPrefetch: SandboxOllamaDirectTagsFetchResult | null = null
    if (odCandPrefetch && hostDevice) {
      odTagsPrefetch = await fetchSandboxOllamaDirectTags({
        handshakeId: hid,
        currentDeviceId: getInstanceId().trim(),
        peerHostDeviceId: hostDevice,
        candidate: odCandPrefetch,
      })
    }

    {
      const epKindForNudge = p2pEndpointKind(db, r.p2p_endpoint)
      if (
        r.handshake_type === 'internal' &&
        epKindForNudge === 'relay' &&
        !isP2pDataChannelUpForHandshake(hid)
      ) {
        const nowN = Date.now()
        const prevN = lastRelayP2pNudgeByHandshake.get(hid) ?? 0
        if (nowN - prevN >= RELAY_DATA_CHANNEL_NUDGE_THROTTLE_MS) {
          lastRelayP2pNudgeByHandshake.set(hid, nowN)
          void ensureHostAiP2pSession(hid, 'model_selector').catch(() => {})
        }
      }
    }
    const dec = decideInternalInferenceTransport(
      await buildHostAiTransportDeciderInputAsync({
        operationContext: 'list_targets',
        db,
        handshakeRecord: r,
        featureFlags: fRow,
      }),
    )
    const sProbe = getSessionState(hid)
    const p2pProbeBusy =
      sProbe?.phase === P2pSessionPhase.starting || sProbe?.phase === P2pSessionPhase.signaling
    let rowChain: string
    if (p2pProbeBusy) {
      let c = stableListProbeChainByHandshake.get(hid)
      if (!c) {
        c = newHostAiCorrelationChain()
        stableListProbeChainByHandshake.set(hid, c)
      }
      rowChain = c
    } else {
      stableListProbeChainByHandshake.delete(hid)
      rowChain = newHostAiCorrelationChain()
    }
    const rowBeapCorrelationId = randomUUID()
    const epK = p2pEndpointKind(db, r.p2p_endpoint)
    const leK = epKindToListKind(epK)

    const listDec: HostAiTransportDeciderResult = dec
    const ml0 = metaLocal(displayName, pcc)
    /** LAN ODL already classified — skip BEAP-only “transport down” exits that would hide reachable Host Ollama. */
    const sandboxLanOdlPrefetchedBypassesBrokenBeapTransport =
      odCandPrefetch != null &&
      hostDevice.trim() !== '' &&
      odTagsPrefetch != null &&
      Date.now() >= until429 &&
      sandboxOllamaDirectTagsAllowListTransportBypass(odTagsPrefetch)
    const inferenceTrusted = listDec.inferenceHandshakeTrusted === true
    const handshakeTrustReason = listDec.inferenceHandshakeTrustReason ?? null
    const transportDecideLogReason: string = (() => {
      if (listDec.preferredTransport === 'legacy_http' && epK === 'direct') {
        return 'internal_direct_http_preferred'
      }
      if (listDec.preferredTransport === 'webrtc_p2p' && epK === 'relay') {
        return 'relay_signaling_webrtc'
      }
      if (String(listDec.failureCode) === 'P2P_SIGNAL_SCHEMA_REJECTED') {
        return 'p2p_signaling_schema_rejected_recovering'
      }
      if (listDec.selectorPhase === 'p2p_unavailable' && listDec.preferredTransport === 'none' && listDec.failureCode) {
        return `p2p_unavailable_${String(listDec.failureCode)}`
      }
      return 'policy'
    })()
    const transportAuthRow = decideHostAiTransport(listDec)
    const bm = baseMetaFromDec(listDec, leK)
    const legacyHttpSt = legacyHttpStatusForDecideLog(listDec, epK)
    const decideFingerprint = `${listDec.targetDetected}|${listDec.preferredTransport}|${listDec.selectorPhase}|${legacyHttpSt}|${epK}|${transportDecideLogReason}|${listDec.failureCode ?? 'null'}`
    logHostAiTransportDecideListLine({
      handshakeId: hid,
      decisionFingerprint: decideFingerprint,
      line: `[HOST_AI_TRANSPORT_DECIDE] handshake=${hid} chain=${rowChain} corr=${rowBeapCorrelationId} target_detected=${listDec.targetDetected} preferred=${listDec.preferredTransport} selector_phase=${listDec.selectorPhase} legacy_http_status=${legacyHttpSt} p2p_endpoint_kind=${epK} reason=${transportDecideLogReason} failureCode=${listDec.failureCode ?? 'null'}`,
    })

    if (!listDec.targetDetected) {
      const ml = metaLocal(displayName, pcc)
      const sub = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const ht = primaryLabelForP2pUiPhase('hidden')
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: ht,
        display_label: ht,
        displayTitle: ht,
        displaySubtitle: sub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sub,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: 'UNKNOWN',
        host_role: 'Host',
        inference_error_code: listDec.failureCode ?? 'TARGET_NOT_TRUSTED',
        ...bm,
        p2pUiPhase: 'hidden',
        failureCode: listDec.failureCode ?? 'TARGET_NOT_TRUSTED',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=TARGET_NOT_TRUSTED detail=${listDec.failureCode ?? ''}`)
      targets.push(finalizeItem(t))
      continue
    }

    if (listDec.selectorPhase === 'p2p_unavailable' && !sandboxLanOdlPrefetchedBypassesBrokenBeapTransport) {
      const ml = metaLocal(displayName, pcc)
      const miss = listDec.failureCode === 'MISSING_P2P_ENDPOINT'
      const inv = listDec.failureCode === 'INVALID_P2P_ENDPOINT'
      const relaySig = listDec.failureCode === 'RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE'
      const internalRelayNoDc = listDec.failureCode === 'INTERNAL_RELAY_P2P_NOT_READY'
      const ur: HostTargetUnavailableCode = miss
        ? 'MISSING_P2P_ENDPOINT'
        : inv
          ? 'ENDPOINT_NOT_DIRECT'
          : relaySig
            ? 'UNKNOWN'
            : internalRelayNoDc
              ? 'INTERNAL_RELAY_P2P_NOT_READY'
              : 'HOST_DIRECT_P2P_UNREACHABLE'
      const sub0 = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const sub =
        relaySig && listDec.userSafeReason?.trim()
          ? `${sub0} — ${listDec.userSafeReason.trim()}`
          : internalRelayNoDc && listDec.userSafeReason?.trim()
            ? `${sub0} — ${listDec.userSafeReason.trim()}`
            : sub0
      const internalRelayLine = internalRelayNoDc
        ? hostAiUserFacingMessageFromTarget({
            inference_error_code: 'INTERNAL_RELAY_P2P_NOT_READY',
            failureCode: 'INTERNAL_RELAY_P2P_NOT_READY',
            unavailable_reason: 'INTERNAL_RELAY_P2P_NOT_READY',
          })
        : null
      const ht = internalRelayLine?.primary ?? primaryLabelForP2pUiPhase('p2p_unavailable')
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: ht,
        display_label: ht,
        displayTitle: ht,
        displaySubtitle: sub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sub,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: miss || inv ? 'not_configured' : 'direct_unreachable',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: listDec.failureCode ?? ur,
        ...bm,
        p2pUiPhase: 'p2p_unavailable',
        failureCode: listDec.failureCode ?? ur,
      }
      console.log(`${L} target_disabled handshake=${hid} reason=${String(listDec.failureCode)} p2p_endpoint_kind=${epK}`)
      targets.push(finalizeItem(t))
      continue
    }

    if (
      listDec.selectorPhase === 'legacy_http_invalid' &&
      !isWebRtcHostAiArchitectureEnabled(fRow) &&
      !sandboxLanOdlPrefetchedBypassesBrokenBeapTransport
    ) {
      const ml = metaLocal(displayName, pcc)
      const ur: HostTargetUnavailableCode = 'MVP_P2P_ENDPOINT_INVALID'
      const sub = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const ht = primaryLabelForP2pUiPhase('legacy_http_invalid')
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: ht,
        display_label: ht,
        displayTitle: ht,
        displaySubtitle: sub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sub,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'direct_unreachable',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: 'MVP_P2P_ENDPOINT_INVALID',
        ...bm,
        p2pUiPhase: 'legacy_http_invalid',
        failureCode: listDec.failureCode ?? 'MVP_P2P_ENDPOINT_INVALID',
      }
      console.log(
        `${L} target_disabled handshake=${hid} reason=legacy_http_invalid failureCode=${listDec.failureCode ?? 'MVP_P2P_ENDPOINT_INVALID'} p2p_endpoint_kind=${epK} (legacy_http_mvp_p2p_stack_off)`,
      )
      targets.push(finalizeItem(t))
      continue
    }

    if (
      listDec.selectorPhase !== 'detected' &&
      listDec.selectorPhase !== 'connecting' &&
      listDec.selectorPhase !== 'ready' &&
      listDec.selectorPhase !== 'legacy_http_available' &&
      listDec.selectorPhase !== 'blocked'
    ) {
      const ml = metaLocal(displayName, pcc)
      const sub = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const up = mapHostAiSelectorPhaseToP2pUiPhase(listDec.selectorPhase)
      const ht = primaryLabelForP2pUiPhase(up)
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: ht,
        display_label: ht,
        displayTitle: ht,
        displaySubtitle: sub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sub,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: 'UNKNOWN',
        host_role: 'Host',
        inference_error_code: `unexpected_selector_${listDec.selectorPhase}`,
        ...bm,
        p2pUiPhase: up,
        failureCode: listDec.failureCode ?? 'UNEXPECTED_SELECTOR_PHASE',
        transportMode: listDec.preferredTransport,
        legacyEndpointKind: leK,
      }
      console.warn(
        `${L} unexpected_selector_phase handshake=${hid} phase=${String(listDec.selectorPhase)} (emitting row to preserve list_invariant)`,
      )
      targets.push(finalizeItem(t))
      continue
    }

    const capsPrevForDecision = webrtcListHostCapsCache.get(hid)
    const capsCacheHitEarly = Boolean(
      capsPrevForDecision && Date.now() - capsPrevForDecision.at < WEBRTC_LIST_CAPS_CACHE_TTL_MS,
    )
    const tagsCacheHitEarly = odTagsPrefetch?.cache_hit === true
    const bypassOllamaDirectLan = sandboxLanOdlPrefetchedBypassesBrokenBeapTransport

    const webrtcListPath =
      listDec.preferredTransport === 'webrtc_p2p' &&
      p2pEnsureEligibleForList(fRow, epK) &&
      listDec.p2pTransportEndpointOpen

    if (!bypassOllamaDirectLan && webrtcListPath) {
      let sState: Awaited<ReturnType<typeof ensureHostAiP2pSession>> | null = null
      const tList = Date.now()
      let ensureCached = lastP2pEnsureByHandshake.get(hid)
      if (
        ensureCached &&
        tList - ensureCached.t >= P2P_LIST_MAX_STUCK_SIGNALING_CACHE_MS &&
        (ensureCached.state.phase === P2pSessionPhase.starting ||
          ensureCached.state.phase === P2pSessionPhase.signaling ||
          ensureCached.state.phase === P2pSessionPhase.connecting) &&
        !isP2pDataChannelUpForHandshake(hid)
      ) {
        const expAge = tList - ensureCached.t
        lastP2pEnsureByHandshake.delete(hid)
        ensureCached = undefined
        console.log(`${L} p2p_ensure_cache_expired handshake=${hid} reason=stuck_signaling age_ms=${expAge}`)
        evictHostAiP2pSessionForStuckListCache(hid, expAge)
      } else {
        ensureCached = lastP2pEnsureByHandshake.get(hid)
      }
      const useCached =
        ensureCached &&
        tList - ensureCached.t < P2P_LIST_ENSURE_THROTTLE_MS &&
        (ensureCached.state.phase === P2pSessionPhase.starting ||
          ensureCached.state.phase === P2pSessionPhase.signaling) &&
        !isP2pDataChannelUpForHandshake(hid)
      try {
        if (useCached) {
          sState = ensureCached.state
          console.log(
            `${L} p2p_ensure_cached handshake=${hid} session=${sState.sessionId ?? 'null'} phase=${sState.phase} age_ms=${tList - ensureCached.t}`,
          )
        } else {
          sState = await ensureHostAiP2pSession(hid, 'model_selector')
          lastP2pEnsureByHandshake.set(hid, { t: tList, state: sState })
          console.log(
            `${L} p2p_ensure model_selector handshake=${hid} session=${sState.sessionId ?? 'null'} phase=${sState.phase}`,
          )
        }
      } catch (e) {
        console.warn(`${L} p2p_ensure_error handshake=${hid}`, e)
        sState = null
      }
      if (
        sState?.lastErrorCode === InternalInferenceErrorCode.RELAY_429_CIRCUIT_OPEN ||
        sState?.lastErrorCode === InternalInferenceErrorCode.HOST_AI_SESSION_TERMINAL_STORM
      ) {
        const stormCode = sState!.lastErrorCode!
        const ml0 = metaLocal(displayName, pcc)
        const psub0 = hostAiSubtitleForPhase('relay_reconnecting', ml0)
        const htR = primaryLabelForP2pUiPhase('relay_reconnecting')
        const tRec: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: htR,
          display_label: htR,
          displayTitle: htR,
          displaySubtitle: psub0,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: psub0,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: 'host_offline',
          unavailable_reason: 'transport_not_ready',
          hostAiStructuredUnavailableReason: 'transport_not_ready',
          host_role: 'Host',
          inference_error_code: stormCode,
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'relay_reconnecting',
          failureCode: stormCode,
        }
        if (stormCode === InternalInferenceErrorCode.RELAY_429_CIRCUIT_OPEN) {
          console.log(
            `${L} target_relay_circuit handshake=${hid} open_until_ms=${getP2pRelaySignalingCircuitOpenUntilMs()} transport=webrtc_p2p`,
          )
        } else {
          console.log(`${L} target_session_storm_pause handshake=${hid} transport=webrtc_p2p`)
        }
        targets.push(finalizeItem(tRec))
        continue
      }
      if (sState?.phase === P2pSessionPhase.failed) {
        const ml0 = metaLocal(displayName, pcc)
        const psub0 =
          sState.lastErrorCode === InternalInferenceErrorCode.OFFER_START_NOT_OBSERVED
            ? COPY_OFFER_START_NOT_OBSERVED
            : hostAiSubtitleForPhase('p2p_unavailable', ml0)
        const failCode0 = sState.lastErrorCode ? String(sState.lastErrorCode) : 'P2P_SESSION_FAILED'
        const iceOrFailLine = hostAiUserFacingMessageFromTarget({
          inference_error_code: failCode0,
          failureCode: failCode0,
        })
        const ht0 = iceOrFailLine?.primary ?? primaryLabelForP2pUiPhase('p2p_unavailable')
        const tFailed: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: ht0,
          display_label: ht0,
          displayTitle: ht0,
          displaySubtitle: psub0,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: psub0,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: 'host_offline',
          unavailable_reason: 'HOST_DIRECT_P2P_UNREACHABLE',
          host_role: 'Host',
          inference_error_code: failCode0,
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'p2p_unavailable',
          failureCode: failCode0,
        }
        console.log(
          `${L} target_disabled handshake=${hid} reason=p2p_session_failed detail=${failCode0} [HOST_AI_TARGET_STATE] handshake=${hid} phase=p2p_unavailable transport=webrtc_p2p source=fresh`,
        )
        targets.push(finalizeItem(tFailed))
        continue
      }
      const dcReady =
        isP2pDataChannelUpForHandshake(hid) ||
        sState?.phase === P2pSessionPhase.datachannel_open ||
        sState?.phase === P2pSessionPhase.ready
      if (!dcReady) {
        const waitOut = await waitForP2pDataChannelOpenOrTerminal(hid, HOST_AI_CAPABILITY_DC_WAIT_MS)
        if (!waitOut.ok) {
          const ml0 = metaLocal(displayName, pcc)
          const psub0 = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
          const hHidden = primaryLabelForP2pUiPhase('hidden')
          const tConn: HostTargetDraft = {
            kind: 'host_internal',
            id: buildHostTargetId(hid, 'unavailable'),
            label: hHidden,
            display_label: hHidden,
            displayTitle: hHidden,
            displaySubtitle: psub0,
            model: null,
            model_id: null,
            provider: 'host_internal',
            handshake_id: hid,
            host_device_id: hostDevice,
            host_computer_name: ml0.hostName,
            host_pairing_code: ml0.digits6,
            host_orchestrator_role: 'host',
            host_orchestrator_role_label: ml0.roleLabel,
            internal_identifier_6: ml0.digits6,
            secondary_label: psub0,
            direct_reachable: false,
            policy_enabled: false,
            available: false,
            availability: 'host_offline',
            unavailable_reason: 'transport_not_ready',
            hostAiStructuredUnavailableReason: 'transport_not_ready',
            host_role: 'Host',
            inference_error_code: 'P2P_SESSION_IN_PROGRESS',
            ...baseMetaFromDec(listDec, leK),
            p2pUiPhase: 'hidden',
            failureCode: 'transport_not_ready',
          }
          const phProbe = getSessionState(hid)?.phase ?? sState?.phase ?? 'none'
          const pr = p2pCapabilityDcWaitOutcomeLogReason(waitOut)
          console.log(
            `[HOST_AI_CAPABILITY_PROBE] transport=webrtc_p2p ok=false reason=${pr} handshake=${hid} p2p_phase=${phProbe}`,
          )
          console.log(
            `${L} beap_target_available=false reason=transport_not_ready handshake=${hid} session=${sState?.sessionId ?? 'null'} transport=webrtc_p2p`,
          )
          targets.push(finalizeItem(tConn))
          continue
        }
      }
    }

    if (!bypassOllamaDirectLan && listDec.preferredTransport === 'webrtc_p2p' && !isP2pDataChannelUpForHandshake(hid)) {
      const waitOut = await waitForP2pDataChannelOpenOrTerminal(hid, HOST_AI_CAPABILITY_DC_WAIT_MS)
      if (!waitOut.ok) {
        const ml0 = metaLocal(displayName, pcc)
        const psub0 = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
        const hHidden = primaryLabelForP2pUiPhase('hidden')
        const tConn: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: hHidden,
          display_label: hHidden,
          displayTitle: hHidden,
          displaySubtitle: psub0,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: psub0,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: 'host_offline',
          unavailable_reason: 'transport_not_ready',
          hostAiStructuredUnavailableReason: 'transport_not_ready',
          host_role: 'Host',
          inference_error_code: 'P2P_SESSION_IN_PROGRESS',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'hidden',
          failureCode: 'transport_not_ready',
        }
        const phProbe = getSessionState(hid)?.phase ?? 'none'
        const pr = p2pCapabilityDcWaitOutcomeLogReason(waitOut)
        console.log(`[HOST_AI_CAPABILITY_PROBE] transport=webrtc_p2p ok=false reason=${pr} handshake=${hid} p2p_phase=${phProbe}`)
        console.log(`${L} beap_target_available=false reason=transport_not_ready handshake=${hid} transport=webrtc_p2p (precap_guard)`)
        targets.push(finalizeItem(tConn))
        continue
      }
    }

    let probe: Awaited<ReturnType<typeof probeHostInferencePolicyFromSandbox>>
    const webrtcP2pListDirect =
      listDec.preferredTransport === 'webrtc_p2p' &&
      !fRow.p2pInferenceHttpFallback &&
      isP2pDataChannelUpForHandshake(hid) &&
      transportAuthRow.kind === 'webrtc_p2p'

    const on429 = Date.now() < until429
    const routeKind: 'ollama_direct' | 'webrtc_p2p' | 'http_policy' | 'cooldown_429' = on429
      ? 'cooldown_429'
      : bypassOllamaDirectLan
        ? 'ollama_direct'
        : webrtcP2pListDirect
          ? 'webrtc_p2p'
          : 'http_policy'
    logSbxHostAiRefreshDecision({
      handshake_id: hid,
      route_kind: routeKind,
      reason: on429
        ? 'probe_429_cooldown'
        : bypassOllamaDirectLan
          ? 'ollama_direct_lane_authoritative_skip_caps_and_policy_probe'
          : 'standard_list_probe_path',
      caps_cache_hit: capsCacheHitEarly,
      ollama_tags_cache_hit: tagsCacheHitEarly,
      will_request_caps: !on429 && !bypassOllamaDirectLan && webrtcP2pListDirect && !capsCacheHitEarly,
      will_request_ollama_tags: Boolean(
        odCandPrefetch &&
          hostDevice &&
          odTagsPrefetch &&
          !odTagsPrefetch.cache_hit &&
          !odTagsPrefetch.inflight_reused,
      ),
      will_probe_policy: !on429 && !bypassOllamaDirectLan && !webrtcP2pListDirect,
      final_action: on429
        ? 'probe_skipped_rate_limit'
        : bypassOllamaDirectLan
          ? 'ollama_direct_lane_short_circuit'
          : webrtcP2pListDirect
            ? 'webrtc_dc_capabilities'
            : 'debounced_http_policy_probe',
    })

    if (on429) {
      console.log(`${L} probe_skipped_429_cooldown handshake=${hid} until_ms=${until429}`)
      if (
        odCandPrefetch &&
        odTagsPrefetch &&
        hostDevice.trim() !== '' &&
        sandboxOllamaDirectTagsAllowListTransportBypass(odTagsPrefetch)
      ) {
        /** BEAP/policy HTTP on cooldown — Ollama LAN tags already enumerated ⇒ list via `ollama_direct` only. */
        probe = buildSyntheticOkProbeFromOllamaDirectTags(
          odTagsPrefetch,
          hostOllamaDirectSyntheticProbeMeta(hid, { hostName: ml0.hostName, digits6: ml0.digits6 }),
        )
        hadCapabilitiesProbed = false
      } else {
        probe = {
          ok: false,
          code: InternalInferenceErrorCode.PROBE_RATE_LIMITED,
          message: 'probe_rate_limited_cooldown',
          directP2pAvailable: true,
          p2pProbeClassification: P2P_CAPABILITY_PROBE.RATE_LIMITED,
        }
        hadCapabilitiesProbed = true
      }
    } else if (bypassOllamaDirectLan && odTagsPrefetch) {
      probe = buildSyntheticOkProbeFromOllamaDirectTags(
        odTagsPrefetch,
        hostOllamaDirectSyntheticProbeMeta(hid, { hostName: ml0.hostName, digits6: ml0.digits6 }),
      )
      hadCapabilitiesProbed = false
    } else if (webrtcP2pListDirect) {
      try {
        const tCap = Math.min(getHostInternalInferencePolicy().timeoutMs, 15_000)
        const tok = outboundP2pBearerToCounterpartyIngest(r)
        if (!tok) {
          probe = {
            ok: false,
            code: InternalInferenceErrorCode.HOST_AI_DIRECT_AUTH_MISSING,
            message: 'counterparty_p2p_token',
            directP2pAvailable: true,
          }
        } else {
          const now = Date.now()
          const prev = webrtcListHostCapsCache.get(hid)
          let fromCache = false
          let capP2p: ListHostCapResult
          if (prev && now - prev.at < WEBRTC_LIST_CAPS_CACHE_TTL_MS) {
            capP2p = prev.result
            fromCache = true
          } else {
            capP2p = await coalescedListHostCapabilitiesProbe(hid, () =>
              listHostCapabilities(hid, {
                record: r,
                token: tok,
                timeoutMs: tCap,
                correlationChain: rowChain,
                beapCorrelationId: rowBeapCorrelationId,
              }) as Promise<ListHostCapResult>,
            )
            webrtcListHostCapsCache.set(hid, { at: Date.now(), result: capP2p })
          }
          if (capP2p.ok) {
            if (hostDevice) {
              recordHostAiReciprocalCapabilitiesSuccess(hid, hostDevice)
            }
            probe = mapCapabilitiesWireToProbe(capP2p.wire)
          } else {
            const rsn = String('reason' in capP2p ? capP2p.reason : 'unknown')
            if (rsn === InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE && hostDevice) {
              recordHostAiLedgerAsymmetric(hid, hostDevice)
            }
            if (rsn === InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE) {
              probe = {
                ok: false,
                code: InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC,
                message: rsn,
                directP2pAvailable: true,
              }
            } else if (
              isHostAiProbeTerminalNoPolicyFallback({
                ok: false,
                reason: rsn,
                hostAiEndpointDenyDetail:
                  'hostAiEndpointDenyDetail' in capP2p ? capP2p.hostAiEndpointDenyDetail : undefined,
              })
            ) {
              probe = {
                ok: false,
                code: rsn,
                message: rsn,
                directP2pAvailable: true,
                hostAiEndpointDenyDetail:
                  'hostAiEndpointDenyDetail' in capP2p ? capP2p.hostAiEndpointDenyDetail : undefined,
                hostAiEndpointDiagnostics:
                  'hostAiEndpointDiagnostics' in capP2p ? capP2p.hostAiEndpointDiagnostics : undefined,
              }
            } else {
              const still =
                rsn === 'p2p_not_ready_no_fallback' || rsn.includes('P2P') || rsn === 'P2P_UNAVAILABLE'
              probe = {
                ok: false,
                code: still
                  ? InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY
                  : InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
                message: rsn,
                directP2pAvailable: true,
              }
            }
          }
          console.log(
            `[HOST_AI_TARGET_STATE] handshake=${hid} phase=${capP2p.ok ? 'ready' : 'p2p_unavailable'} transport=webrtc_p2p source=${fromCache ? 'cache' : 'fresh'}`,
          )
        }
        hadCapabilitiesProbed = true
      } catch (err) {
        console.warn(`${L} target_disabled handshake=${hid} reason=webrtc_listHost_throw`, err)
        const ur: HostTargetUnavailableCode = 'CAPABILITY_PROBE_FAILED'
        const psub = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
        const pht = primaryLabelForP2pUiPhase('probe_gateway_error')
        const t: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: pht,
          display_label: pht,
          displayTitle: pht,
          displaySubtitle: psub,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: psub,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: 'host_offline',
          unavailable_reason: ur,
          host_role: 'Host',
          inference_error_code: InternalInferenceErrorCode.PROBE_HOST_ERROR,
          hostAiStructuredUnavailableReason: 'gateway_error',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'probe_gateway_error',
          failureCode: InternalInferenceErrorCode.PROBE_HOST_ERROR,
        }
        hadCapabilitiesProbed = true
        targets.push(finalizeItem(t))
        continue
      }
    } else {
      hadCapabilitiesProbed = true
      try {
        probe = await runDebouncedPolicyProbeForList(hid, rowChain, rowBeapCorrelationId)
      } catch (err) {
        console.warn(`${L} target_disabled handshake=${hid} reason=probe_throw`, err)
        const ur: HostTargetUnavailableCode = 'CAPABILITY_PROBE_FAILED'
        const psub = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
        const pht = primaryLabelForP2pUiPhase('probe_gateway_error')
        const t: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: pht,
          display_label: pht,
          displayTitle: pht,
          displaySubtitle: psub,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: psub,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: 'host_offline',
          unavailable_reason: ur,
          host_role: 'Host',
          inference_error_code: InternalInferenceErrorCode.PROBE_HOST_ERROR,
          hostAiStructuredUnavailableReason: 'gateway_error',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'probe_gateway_error',
          failureCode: InternalInferenceErrorCode.PROBE_HOST_ERROR,
        }
        targets.push(finalizeItem(t))
        continue
      }
    }

    if (
      !probe.ok &&
      odCandPrefetch &&
      odTagsPrefetch &&
      hostDevice.trim() !== '' &&
      sandboxOllamaDirectTagsAllowListTransportBypass(odTagsPrefetch)
    ) {
      /** BEAP/caps/policy failed — LAN `/api/tags` already classified — keep Host Ollama models (not BEAP gated). */
      probe = buildSyntheticOkProbeFromOllamaDirectTags(
        odTagsPrefetch,
        hostOllamaDirectSyntheticProbeMeta(hid, { hostName: ml0.hostName, digits6: ml0.digits6 }),
      )
      hadCapabilitiesProbed = false
    }

    if (
      !probe.ok &&
      odCandPrefetch &&
      hostDevice.trim() !== '' &&
      String((probe as { code?: unknown }).code) === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING
    ) {
      /**
       * Prefetch occasionally misses `available`/`no_models`; refetch `/api/tags` before treating peer-BEAP-missing as terminal —
       * `HOST_AI_DIRECT_PEER_BEAP_MISSING` must not wipe ODL enumeration when LAN tags can succeed on retry.
       */
      let tagsRecover: SandboxOllamaDirectTagsFetchResult | null = odTagsPrefetch
      if (
        !tagsRecover ||
        !sandboxOllamaDirectTagsAllowListTransportBypass(tagsRecover)
      ) {
        tagsRecover = await fetchSandboxOllamaDirectTags({
          handshakeId: hid,
          currentDeviceId: getInstanceId().trim(),
          peerHostDeviceId: hostDevice,
          candidate: odCandPrefetch,
        })
        odTagsPrefetch = tagsRecover
      }
      if (
        tagsRecover &&
        sandboxOllamaDirectTagsAllowListTransportBypass(tagsRecover) &&
        (tagsRecover.classification === 'available' || tagsRecover.classification === 'no_models')
      ) {
        probe = buildSyntheticOkProbeFromOllamaDirectTags(
          tagsRecover,
          hostOllamaDirectSyntheticProbeMeta(hid, { hostName: ml0.hostName, digits6: ml0.digits6 }),
        )
        hadCapabilitiesProbed = false
      }
    }

    if (!probe.ok) {
      const code = probe.code
      if (
        code === InternalInferenceErrorCode.PROBE_RATE_LIMITED &&
        (typeof probe !== 'object' || !('message' in probe) || (probe as { message?: string }).message !== 'probe_rate_limited_cooldown')
      ) {
        hostAiDirectProbe429CooldownUntil.set(hid, Date.now() + HOST_AI_DIRECT_PROBE_429_COOLDOWN_MS)
      }
      const hostAiEndpointDenyDetailProbe =
        'hostAiEndpointDenyDetail' in probe && typeof (probe as { hostAiEndpointDenyDetail?: string }).hostAiEndpointDenyDetail === 'string'
          ? (probe as { hostAiEndpointDenyDetail: string }).hostAiEndpointDenyDetail
          : undefined
      if (
        isHostAiProbeTerminalNoPolicyFallback({
          ok: false,
          reason: String(code),
          hostAiEndpointDenyDetail: hostAiEndpointDenyDetailProbe,
        })
      ) {
        const codeStr = String(code)
        const isPol = codeStr === InternalInferenceErrorCode.POLICY_FORBIDDEN
        const eph = hostP2pUiPhaseForTerminalIdentityProbe(codeStr, hostAiEndpointDenyDetailProbe)
        const structE = hostAiStructuredReasonForTerminalIdentityProbe(codeStr, hostAiEndpointDenyDetailProbe)
        const ur = hostTargetUnavailableCodeForTerminalIdentityProbe(codeStr)
        const subE = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
        const fromProbe = hostAiUserFacingMessageFromTarget({
          inference_error_code: codeStr,
          hostAiEndpointDenyDetail: hostAiEndpointDenyDetailProbe,
          hostAiStructuredUnavailableReason: structE,
        })
        const unLabE = fromProbe?.primary ?? primaryLabelForP2pUiPhase(eph)
        const diagE =
          'hostAiEndpointDiagnostics' in probe && (probe as { hostAiEndpointDiagnostics?: HostAiEndpointDiagnostics }).hostAiEndpointDiagnostics
            ? (probe as { hostAiEndpointDiagnostics: HostAiEndpointDiagnostics }).hostAiEndpointDiagnostics
            : undefined
        const av: HostInferenceListAvailability = isPol ? 'policy_disabled' : 'not_configured'
        const tE: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: unLabE,
          display_label: unLabE,
          displayTitle: unLabE,
          displaySubtitle: subE,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: subE,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: av,
          unavailable_reason: ur,
          hostAiStructuredUnavailableReason: structE,
          host_role: 'Host',
          inference_error_code: isPol ? 'HOST_POLICY_DISABLED' : codeStr,
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: eph,
          failureCode: isPol ? 'HOST_POLICY_DISABLED' : codeStr,
          host_ai_endpoint_diagnostics: diagE,
        }
        console.log(
          `${L} beap_target_available=false reason=${structE} handshake=${hid} detail=probe_terminal_identity code=${codeStr} deny=${hostAiEndpointDenyDetailProbe ?? 'n/a'}`,
        )
        targets.push(finalizeItem(tE))
        continue
      }
      if (
        code === InternalInferenceErrorCode.P2P_STILL_CONNECTING ||
        code === InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY
      ) {
        const psubC = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
        const hH = primaryLabelForP2pUiPhase('hidden')
        const tStill: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: hH,
          display_label: hH,
          displayTitle: hH,
          displaySubtitle: psubC,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: ml0.hostName,
          host_pairing_code: ml0.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: ml0.roleLabel,
          internal_identifier_6: ml0.digits6,
          secondary_label: psubC,
          direct_reachable: false,
          policy_enabled: false,
          available: false,
          availability: 'host_offline',
          unavailable_reason: 'capability_probe_failed',
          hostAiStructuredUnavailableReason: 'transport_not_ready',
          host_role: 'Host',
          inference_error_code: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY,
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'hidden',
          failureCode: InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY,
        }
        console.log(
          `[HOST_AI_CAPABILITY_PROBE] transport=webrtc_p2p ok=false reason=transport_not_ready handshake=${hid}`,
        )
        console.log(
          `${L} beap_target_available=false reason=transport_not_ready handshake=${hid} detail=probe_${capabilityProbeLogDetailToken(InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY)}`,
        )
        targets.push(finalizeItem(tStill))
        continue
      }
      const isPolicyForbid = code === InternalInferenceErrorCode.POLICY_FORBIDDEN
      const stackOnForRelay = p2pStackEnabledForList(fRow) || (isWebRtcHostAiArchitectureEnabled(fRow) && epK === 'relay')
      const relaySig = epK === 'relay'
      // Relay is valid for WebRTC signaling; a false "direct HTTP" probe flag must not be the only reason we hide the row.
      const p2pFail =
        !isPolicyForbid &&
        !isHostAiHttpEndpointProvenanceClassFailure(String(code)) &&
        (code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE ||
          (!probe.directP2pAvailable && !(stackOnForRelay && relaySig)))
      const ur: HostTargetUnavailableCode = isPolicyForbid
        ? 'HOST_POLICY_DISABLED'
        : p2pFail
          ? 'HOST_DIRECT_P2P_UNREACHABLE'
          : 'CAPABILITY_PROBE_FAILED'
      let av: HostInferenceListAvailability = 'host_offline'
      if (isPolicyForbid) {
        av = 'policy_disabled'
      } else if (p2pFail) {
        av = 'direct_unreachable'
      }
      const p2pCompact = p2pFail
      const failPhase: HostP2pUiPhase = isPolicyForbid
        ? 'policy_disabled'
        : p2pCompact
          ? 'p2p_unavailable'
          : hostP2pUiPhaseForProbeFailureCode(code)
      const p2pUiProbe: HostP2pUiPhase = failPhase
      const sub = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
      const fromCodeProbe = hostAiUserFacingMessageFromTarget({
        inference_error_code: String(code),
        hostAiStructuredUnavailableReason: isPolicyForbid ? undefined : hostAiStructuredReasonForProbeCode(code),
      })
      const unLab = fromCodeProbe?.primary ?? primaryLabelForP2pUiPhase(failPhase)
      const structured: HostAiStructuredUnavailableReason | undefined = isPolicyForbid
        ? undefined
        : hostAiStructuredReasonForProbeCode(code)
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: unLab,
        display_label: unLab,
        displayTitle: unLab,
        displaySubtitle: sub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml0.hostName,
        host_pairing_code: ml0.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml0.roleLabel,
        internal_identifier_6: ml0.digits6,
        secondary_label: sub,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: av,
        unavailable_reason: ur,
        hostAiStructuredUnavailableReason: structured,
        host_role: 'Host',
        inference_error_code: isPolicyForbid ? ur : String(code),
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: p2pUiProbe,
        failureCode: isPolicyForbid ? 'HOST_POLICY_DISABLED' : String(code),
        transportMode: listDec.preferredTransport,
        legacyEndpointKind: leK,
        host_ai_endpoint_diagnostics:
          'hostAiEndpointDiagnostics' in probe &&
          (probe as { hostAiEndpointDiagnostics?: HostAiEndpointDiagnostics }).hostAiEndpointDiagnostics
            ? (probe as { hostAiEndpointDiagnostics: HostAiEndpointDiagnostics }).hostAiEndpointDiagnostics
            : undefined,
      }
      const pr = isPolicyForbid ? 'POLICY_DISABLED' : 'CAPABILITY_PROBE_FAILED'
      if (structured) {
        console.log(`${L} beap_target_available=false reason=${structured} handshake=${hid} probe_code=${String(code)}`)
      }
      console.log(`${L} target_disabled handshake=${hid} reason=${pr} detail=probe_${capabilityProbeLogDetailToken(String(code))}`)
      targets.push(finalizeItem(t))
      continue
    }

    hostAiDirectProbe429CooldownUntil.delete(hid)
    const hm = metaFromOkProbe(probe, displayName, pcc)

    const odCand = odCandPrefetch ?? getSandboxOllamaDirectRouteCandidate(hid)
    let odTags: SandboxOllamaDirectTagsFetchResult | null = odTagsPrefetch
    if (!odTags && odCand && hostDevice) {
      odTags = await fetchSandboxOllamaDirectTags({
        handshakeId: hid,
        currentDeviceId: getInstanceId().trim(),
        peerHostDeviceId: hostDevice,
        candidate: odCand,
      })
    }

    const explicitPolicyForbidden =
      probe.inferenceErrorCode === InternalInferenceErrorCode.POLICY_FORBIDDEN

    /**
     * Valid `ollama_direct` advertisement + Sandbox LAN `/api/tags` probe ran — must not surface stale caps
     * `policy_enabled`/role rows unless Host explicitly forbids ({@link InternalInferenceErrorCode.POLICY_FORBIDDEN}).
     */
    const ollamaDirectSkipsStaleCapsPolicyDenyUi =
      odCand != null && odTags != null && !explicitPolicyForbidden

    /** Remote LAN `/api/tags` succeeded with models or confirmed empty tags — legacy caps `models[]` must not suppress listing. */
    const ollamaDirectRemoteTagsEnumeratedOk =
      odTags != null &&
      !explicitPolicyForbidden &&
      (odTags.classification === 'available' || odTags.classification === 'no_models')

    if (!probe.allowSandboxInference && !ollamaDirectSkipsStaleCapsPolicyDenyUi) {
      const ur: HostTargetUnavailableCode = 'HOST_POLICY_DISABLED'
      const polT = primaryLabelForP2pUiPhase('policy_disabled')
      const psub = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: polT,
        display_label: polT,
        displayTitle: polT,
        displaySubtitle: psub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: psub,
        direct_reachable: true,
        policy_enabled: false,
        available: false,
        availability: 'policy_disabled',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: 'HOST_POLICY_DISABLED',
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'policy_disabled',
        failureCode: 'HOST_POLICY_DISABLED',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=POLICY_DISABLED detail=host_policy_no_sandbox_inference`)
      targets.push(finalizeItem(t))
      continue
    }

    /**
     * BEAP-list transport proven **or** we have (or will use) the LAN `ollama_direct` lane.
     * Missing peer BEAP must not fail-closed here if `/api/tags` can still classify the Host Ollama path.
     */
    const listTransportProvenForSelection =
      isHostAiListTransportProven(listDec, hid) ||
      Boolean(getSandboxOllamaDirectRouteCandidate(hid)) ||
      Boolean(odCand && odTags != null)
    if (!listTransportProvenForSelection) {
      const ml0 = metaLocal(displayName, pcc)
      const psub0 = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
      const hFail = primaryLabelForP2pUiPhase('host_transport_unavailable')
      const trustReason = listDec.inferenceHandshakeTrustReason
      const trustMis =
        trustReason === 'peer_host_endpoint_missing' ||
        trustReason === 'self_loop_detected'
      const structuredTrust: HostAiStructuredUnavailableReason = trustMis
        ? 'host_transport_trust_misrouting'
        : 'host_transport_unavailable'
      const hUser = hostAiUserFacingMessageFromTarget({
        inference_error_code: trustReason ?? undefined,
        hostAiStructuredUnavailableReason: structuredTrust,
        failureCode: 'LIST_TRANSPORT_NOT_PROVEN',
      })
      const primaryLine = hUser?.primary ?? hFail
      const mode = getOrchestratorMode().mode
      const cur = getInstanceId().trim()
      const ledgerSummary = getHostAiLedgerRoleSummaryFromDb(db, cur, String(mode))
      const peerRoles = deriveInternalHostAiPeerRoles(r, cur)
      const peerEnt = peekHostAdvertisedMvpDirectEntry(hid)
      console.log(
        `[HOST_AI_TARGET_TRUST_DECISION] ${JSON.stringify({
          current_device_id: cur,
          peer_device_id: hostDevice,
          endpoint: typeof r.p2p_endpoint === 'string' ? r.p2p_endpoint.trim() : null,
          endpoint_owner_device_id: peerEnt?.ownerDeviceId != null ? String(peerEnt.ownerDeviceId).trim() : null,
          local_derived_role: deriveFromRecord(r).localDeviceRole,
          peer_derived_role: peerRoles.ok ? peerRoles.peerRole : 'unknown',
          configured_mode: String(mode),
          effective_host_ai_role: ledgerSummary.effective_host_ai_role,
          can_publish_host_endpoint: ledgerSummary.can_publish_host_endpoint,
          can_probe_host_endpoint: ledgerSummary.can_probe_host_endpoint,
          trusted: listDec.inferenceHandshakeTrusted === true,
          trust_reason: trustReason ?? null,
          disabled_ui_reason: primaryLine,
        })}`,
      )
      const tProto: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: primaryLine,
        display_label: primaryLine,
        displayTitle: primaryLine,
        displaySubtitle: psub0,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml0.hostName,
        host_pairing_code: ml0.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml0.roleLabel,
        internal_identifier_6: ml0.digits6,
        secondary_label: psub0,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'host_offline',
        unavailable_reason: 'CAPABILITY_PROBE_FAILED',
        hostAiStructuredUnavailableReason: structuredTrust,
        host_role: 'Host',
        inference_error_code: trustMis
          ? String(trustReason ?? 'LIST_TRANSPORT_NOT_PROVEN')
          : InternalInferenceErrorCode.PROBE_TRANSPORT_NOT_READY,
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'host_transport_unavailable',
        failureCode: 'LIST_TRANSPORT_NOT_PROVEN',
      }
      console.warn(
        `${L} list_guard_fail_closed handshake=${hid} selector_phase=${listDec.selectorPhase} preferred=${listDec.preferredTransport} dc_up=${isP2pDataChannelUpForHandshake(hid)}`,
      )
      targets.push(finalizeItem(tProto))
      continue
    }

    if (odCand && odTags?.classification === 'transport_unavailable') {
      const psub = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const lab = 'Host Ollama is not reachable from this device.'
      const tOd: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: lab,
        display_label: lab,
        displayTitle: lab,
        displaySubtitle: psub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: psub,
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'host_offline',
        unavailable_reason: 'CAPABILITY_PROBE_FAILED',
        hostAiStructuredUnavailableReason: 'ollama_direct_tags_unreachable',
        host_role: 'Host',
        inference_error_code: InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE,
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'host_transport_unavailable',
        failureCode: InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE,
      }
      console.log(
        `${L} beap_target_available=false ollama_direct_available=false reason=ollama_direct_transport_unavailable handshake=${hid}`,
      )
      targets.push(finalizeItem(tOd))
      continue
    }

    if (odCand && odTags?.classification === 'unavailable_invalid_advertisement') {
      const psub = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const lab = 'Host Ollama endpoint advertisement is invalid.'
      const tInv: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: lab,
        display_label: lab,
        displayTitle: lab,
        displaySubtitle: psub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: psub,
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'model_unavailable',
        unavailable_reason: 'CAPABILITY_PROBE_FAILED',
        hostAiStructuredUnavailableReason: 'ollama_direct_invalid_advertisement',
        host_role: 'Host',
        inference_error_code: InternalInferenceErrorCode.PROBE_INVALID_RESPONSE,
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'probe_invalid_response',
        failureCode: InternalInferenceErrorCode.PROBE_INVALID_RESPONSE,
      }
      console.log(
        `${L} beap_target_available=false ollama_direct_available=false reason=ollama_direct_invalid_advertisement handshake=${hid}`,
      )
      targets.push(finalizeItem(tInv))
      continue
    }

    if (odCand && odTags?.classification === 'available' && odTags.models.length > 0) {
      const secondary = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const transportProbeLabel = listDec.preferredTransport === 'legacy_http' ? 'direct_http' : 'webrtc_p2p'
      const peerEndpointMissingUntrusted =
        !inferenceTrusted && handshakeTrustReason === 'peer_host_endpoint_missing'
      /** BEAP ingest missing/untrusted — Ollama tags still enumerate ⇒ `ollama_direct_only` lane (not `handshake_active_but_endpoint_missing`, which disables selector). */
      const laneStatusUntrusted: HostAiTargetStatus = 'ollama_direct_only'

      let pushed = 0
      const hostActiveModel = probe.defaultChatModel?.trim() || null
      const orderedOdModels =
        hostActiveModel && odTags.models.some((rm) => rm.model.trim() === hostActiveModel)
          ? [
              ...odTags.models.filter((rm) => rm.model.trim() === hostActiveModel),
              ...odTags.models.filter((rm) => rm.model.trim() !== hostActiveModel),
            ]
          : odTags.models
      if (inferenceTrusted) {
        for (const rm of orderedOdModels) {
          const dm = rm.model.trim()
          if (!dm) continue
          pushed += 1
          const primaryLabel = `Host AI · ${dm}`
          const t: HostTargetDraft = {
            kind: 'host_internal',
            id: buildHostTargetId(hid, dm),
            label: primaryLabel,
            display_label: primaryLabel,
            displayTitle: primaryLabel,
            displaySubtitle: secondary,
            model: dm,
            model_id: dm,
            provider: 'host_internal',
            handshake_id: hid,
            host_device_id: hostDevice,
            host_computer_name: hm.hostName,
            host_pairing_code: hm.digits6,
            host_orchestrator_role: 'host',
            host_orchestrator_role_label: hm.roleLabel,
            internal_identifier_6: hm.digits6,
            secondary_label: secondary,
            direct_reachable: true,
            policy_enabled: true,
            available: true,
            availability: 'available',
            unavailable_reason: null,
            host_role: 'Host',
            selector_phase:
              listDec.selectorPhase === 'legacy_http_available' ? 'legacy_http_available' : 'ready',
            ...baseMetaFromDec(listDec, leK),
            p2pUiPhase: 'ready',
            failureCode: null,
            hostWireOllamaReachable: true,
            execution_transport: 'ollama_direct',
            host_ai_target_status: 'beap_ready',
            beapReady: true,
            ollamaDirectReady: true,
            hostActiveModel,
            visibleInModelSelector: true,
            trustedForBeap: true,
            canChat: true,
            canUseTopChatTools: true,
            canUseOllamaDirect: true,
            trusted: true,
          }
          targets.push(finalizeItem(t))
        }
        console.log(
          `[HOST_AI_CAPABILITY_PROBE] transport=${transportProbeLabel} ok=true handshake=${hid} source=ollama_direct tags_models=${pushed}`,
        )
        console.log(
          `${L} beap_target_available=true ollama_direct_available=true transport=${transportProbeLabel} handshake=${hid} ollama_direct_models=${pushed} beap_lane=trusted`,
        )
      } else {
        /** BEAP/top-chat gated; OD tags succeeded — stash BEAP warning only (see `beapFailureCode`). */
        const beapFc: string | null = peerEndpointMissingUntrusted
          ? InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING
          : String(listDec.hostAiRouteResolveFailureCode ?? listDec.failureCode ?? '').trim() || null
        /** BEAP gated; OD tags ok — omit `host_endpoint_not_advertised` (restore/UI treats it as definitive failure). */
        const ucStructuredTrust: HostAiStructuredUnavailableReason | undefined =
          peerEndpointMissingUntrusted ? undefined : 'host_transport_trust_misrouting'
        for (const rm of orderedOdModels) {
          const dm = rm.model.trim()
          if (!dm) continue
          pushed += 1
          const primaryLabel = `Host AI · ${dm}`
          /** Exactly one logical `available` row per handshake avoids double-count in `list_done`; extra model rows remain selector-visible via `visibleInModelSelector`. */
          const laneRowAvailable = pushed === 1
          const t: HostTargetDraft = {
            kind: 'host_internal',
            id: buildHostTargetId(hid, dm),
            label: primaryLabel,
            display_label: primaryLabel,
            displayTitle: primaryLabel,
            displaySubtitle: secondary,
            model: dm,
            model_id: dm,
            provider: 'host_internal',
            handshake_id: hid,
            host_device_id: hostDevice,
            host_computer_name: hm.hostName,
            host_pairing_code: hm.digits6,
            host_orchestrator_role: 'host',
            host_orchestrator_role_label: hm.roleLabel,
            internal_identifier_6: hm.digits6,
            secondary_label: secondary,
            direct_reachable: true,
            policy_enabled: true,
            available: laneRowAvailable,
            availability: 'ollama_direct_lane',
            unavailable_reason: null,
            hostAiStructuredUnavailableReason: ucStructuredTrust,
            host_role: 'Host',
            ...baseMetaFromDec(listDec, leK),
            selector_phase: 'ready',
            p2pUiPhase: 'ready',
            inference_error_code: null,
            failureCode: null,
            beapFailureCode: beapFc,
            ollamaDirectFailureCode: null,
            hostWireOllamaReachable: true,
            execution_transport: 'ollama_direct',
            host_ai_target_status: laneStatusUntrusted,
            beapReady: false,
            ollamaDirectReady: true,
            hostActiveModel,
            visibleInModelSelector: true,
            trustedForBeap: false,
            canChat: false,
            canUseTopChatTools: false,
            canUseOllamaDirect: true,
            trusted: false,
          }
          targets.push(finalizeItem(t))
        }
        console.log(
          `[HOST_AI_CAPABILITY_PROBE] transport=${transportProbeLabel} ok=tags_only handshake=${hid} source=ollama_direct tags_models=${pushed} beap_lane=untrusted_direct_only status=${laneStatusUntrusted}`,
        )
        console.log(
          `${L} beap_target_available=false ollama_direct_available=true transport=${transportProbeLabel} handshake=${hid} ollama_direct_models=${pushed} reason=${peerEndpointMissingUntrusted ? 'peer_host_endpoint_missing' : 'trust_misrouting'}`,
        )
      }
      const visibleModels = orderedOdModels.map((rm) => rm.model.trim()).filter(Boolean)
      const pOk = probe && typeof probe === 'object' && 'ok' in probe && (probe as { ok: boolean }).ok
      const selectedHostModelSource =
        pOk && 'hostDefaultModelSource' in probe
          ? String((probe as { hostDefaultModelSource?: string }).hostDefaultModelSource ?? '')
          : ''
      const fallbackUsed =
        pOk && 'hostOllamaSyntheticFallbackUsed' in probe
          ? Boolean((probe as { hostOllamaSyntheticFallbackUsed?: boolean }).hostOllamaSyntheticFallbackUsed)
          : false
      console.log(
        `[HOST_AI_MODEL_SELECTOR_MERGE] ${JSON.stringify({
          handshakeId: hid,
          hostDeviceId: hostDevice,
          visibleModels,
          selectedHostModelId: hostActiveModel || visibleModels[0] || null,
          selectedHostModelSource: selectedHostModelSource || 'capabilities_or_policy_probe',
          fallbackUsed,
        })}`,
      )
      continue
    }

    const defaultChatModel = probe.defaultChatModel?.trim()
    if (!defaultChatModel) {
      if (ollamaDirectRemoteTagsEnumeratedOk && odTags?.classification === 'no_models') {
        const ur: HostTargetUnavailableCode = 'HOST_NO_ACTIVE_LOCAL_LLM'
        const psub = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
        const nmT = 'Host Ollama reachable, but no models are installed.'
        const structuredNoModel: HostAiStructuredUnavailableReason = 'ollama_direct_no_models_installed'
        const t: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'unavailable'),
          label: nmT,
          display_label: nmT,
          displayTitle: nmT,
          displaySubtitle: psub,
          model: null,
          model_id: null,
          provider: 'host_internal',
          handshake_id: hid,
          host_device_id: hostDevice,
          host_computer_name: hm.hostName,
          host_pairing_code: hm.digits6,
          host_orchestrator_role: 'host',
          host_orchestrator_role_label: hm.roleLabel,
          internal_identifier_6: hm.digits6,
          secondary_label: psub,
          direct_reachable: true,
          policy_enabled: true,
          available: false,
          availability: 'model_unavailable',
          unavailable_reason: ur,
          hostAiStructuredUnavailableReason: structuredNoModel,
          host_role: 'Host',
          inference_error_code: InternalInferenceErrorCode.PROBE_NO_MODELS,
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'no_model',
          failureCode: InternalInferenceErrorCode.PROBE_NO_MODELS,
        }
        console.log(
          `${L} beap_target_available=false ollama_direct_available=false reason=ollama_direct_no_models ollama_direct_models=0 handshake=${hid}`,
        )
        targets.push(finalizeItem(t))
        continue
      }

      const ur: HostTargetUnavailableCode = 'HOST_NO_ACTIVE_LOCAL_LLM'
      const psub = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const iec0 = probe.inferenceErrorCode
      const rowFailure = iec0 ?? InternalInferenceErrorCode.MODEL_UNAVAILABLE
      /** Paired host’s Ollama (remote), from capabilities wire — never sandbox-local Ollama. */
      const hostRemoteOllamaDown =
        rowFailure === InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE ||
        rowFailure === InternalInferenceErrorCode.OLLAMA_UNAVAILABLE
      const nmT = hostRemoteOllamaDown
        ? primaryLabelForP2pUiPhase('host_provider_unavailable')
        : rowFailure === InternalInferenceErrorCode.PROBE_NO_MODELS
          ? 'Host has no AI models installed.'
          : primaryLabelForP2pUiPhase('no_model')
      const noModelPhase: HostP2pUiPhase = hostRemoteOllamaDown ? 'host_provider_unavailable' : 'no_model'
      const structuredNoModel: HostAiStructuredUnavailableReason = hostRemoteOllamaDown
        ? 'host_provider_unavailable'
        : 'no_models'
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: nmT,
        display_label: nmT,
        displayTitle: nmT,
        displaySubtitle: psub,
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: psub,
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'model_unavailable',
        unavailable_reason: ur,
        hostAiStructuredUnavailableReason: structuredNoModel,
        host_role: 'Host',
        inference_error_code: rowFailure,
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: noModelPhase,
        failureCode: rowFailure,
      }
      console.log(
        `[HOST_CAPS] inference_ready=false reason=${hostRemoteOllamaDown ? 'host_remote_ollama_unreachable' : 'no_models'} handshake=${hid}`,
      )
      console.log(`${L} beap_target_available=false reason=no_models handshake=${hid}`)
      console.log(
        `${L} target_disabled handshake=${hid} reason=HOST_NO_ACTIVE_LOCAL_LLM detail=probe_${capabilityProbeLogDetailToken(String(rowFailure))} (row_kept for discovery)`,
      )
      targets.push(finalizeItem(t))
      continue
    }

    const secondary = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
    const pProbe = probe as {
      inferenceErrorCode?: string
      providerFromHost?: string
      hostAvailableModelIds?: string[]
      displayLabelFromHost?: string
    }
    const ollamaWireHostReachable =
      pProbe.providerFromHost === 'ollama' &&
      pProbe.inferenceErrorCode !== InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE &&
      String(pProbe.inferenceErrorCode ?? '') !== 'OLLAMA_UNAVAILABLE'
    const fromProbe = Array.isArray(pProbe.hostAvailableModelIds)
      ? [...new Set(pProbe.hostAvailableModelIds.map((x) => String(x ?? '').trim()).filter(Boolean))]
      : []
    const rosterSet = new Set(fromProbe)
    if (defaultChatModel) rosterSet.add(defaultChatModel)
    const rosterSorted = [...rosterSet].sort((a, b) => a.localeCompare(b))
    const hostActiveModelForRows = defaultChatModel
    const orderedPolicyModels =
      hostActiveModelForRows && rosterSorted.includes(hostActiveModelForRows)
        ? [hostActiveModelForRows, ...rosterSorted.filter((m) => m !== hostActiveModelForRows)]
        : rosterSorted
    const displayFromHost = pProbe.displayLabelFromHost?.trim()
    const transportProbeLabel = listDec.preferredTransport === 'legacy_http' ? 'direct_http' : 'webrtc_p2p'
    let pushedPolicy = 0
    for (const dm of orderedPolicyModels) {
      if (!dm) continue
      pushedPolicy += 1
      const primaryLabel =
        displayFromHost && dm === hostActiveModelForRows ? displayFromHost : `Host AI · ${dm}`
      /** Successful WebRTC/policy probe — authoritative BEAP path (distinct from LAN `ollama_direct` `/api/tags`). */
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, dm),
        label: primaryLabel,
        display_label: primaryLabel,
        displayTitle: primaryLabel,
        displaySubtitle: secondary,
        model: dm,
        model_id: dm,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: secondary,
        direct_reachable: true,
        policy_enabled: true,
        available: true,
        availability: 'available',
        unavailable_reason: null,
        host_role: 'Host',
        selector_phase: listDec.selectorPhase === 'legacy_http_available' ? 'legacy_http_available' : 'ready',
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'ready',
        failureCode: null,
        hostWireOllamaReachable: ollamaWireHostReachable,
        host_ai_target_status: 'beap_ready',
        hostActiveModel: hostActiveModelForRows,
        canChat: true,
        canUseTopChatTools: true,
        canUseOllamaDirect: ollamaWireHostReachable,
        trusted: true,
      }
      console.log(
        `[HOST_AI_TARGET_MODEL_ADD] ${JSON.stringify({
          handshakeId: hid,
          modelId: dm,
          modelSource: 'host_policy_or_caps_probe',
          activeModel: hostActiveModelForRows,
          visibleInModelSelector: true,
        })}`,
      )
      targets.push(
        finalizeItem({
          ...t,
          beapReady: true,
          ollamaDirectReady: ollamaWireHostReachable,
          visibleInModelSelector: true,
          trustedForBeap: true,
        }),
      )
    }
    console.log(`[HOST_AI_CAPABILITY_PROBE] transport=${transportProbeLabel} ok=true handshake=${hid}`)
    console.log(
      `${L} beap_target_available=true ollama_direct_available=${ollamaWireHostReachable} transport=${transportProbeLabel} models=${pushedPolicy} handshake=${hid} model=${hostActiveModelForRows}`,
    )
    console.log(`${L} target_added handshake=${hid} model=${hostActiveModelForRows} rows=${pushedPolicy}`)
  }

  /**
   * Only ACTIVE internal **Sandbox→Host** (handshake-derived, same account) can populate an empty
   * selector: checking row while the pipeline is still unable to build a more specific item.
   */
  if (targets.length === 0 && db && handshakeProvesSandboxToHost) {
    for (const r0 of ledgerActive) {
      if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) {
        continue
      }
      if (!rowProvesLocalSandboxToHostForHostAi(r0)) {
        continue
      }
      const hid = r0.handshake_id
      console.log(
        `${L} target_placeholder_added handshake=${hid} reason=fallback_no_rows_after_pipeline_sandbox_to_host`,
      )
      targets.push(finalizeItem(draftCheckingPlaceholderForHostPair(r0, db)))
      break
    }
  }

  ensureAtLeastOneHostTargetWhenLedgerProvesSandboxToHost(
    targets,
    ledgerActive,
    handshakeProvesSandboxToHost,
    mainMode,
    db,
  )

  if (targets.length === 0) {
    if (activeInternalCount === 0) {
      console.log(`${L} list_empty reason=no_active_internal_rows_in_ledger`)
    } else if (activeInternalSandboxToHostCount === 0) {
      console.log(`${L} list_empty reason=no_sandbox_to_host_host_pairs_after_filter`)
    } else {
      console.log(
        `${L} list_empty reason=unexpected (active_internal_sandbox_to_host_count>0 but no target rows — bug)`,
      )
    }
  }
  const availableCount = targets.filter((t) => t.available === true).length
  const handshakeIds = [
    ...new Set(targets.map((t) => String(t.handshake_id ?? '').trim()).filter((h) => h.length > 0)),
  ]
  const handshakeCount = handshakeIds.length
  const ollamaDirectHandshakeCount = handshakeIds.filter((hid) =>
    targets.some(
      (t) => String(t.handshake_id ?? '').trim() === hid && t.execution_transport === 'ollama_direct',
    ),
  ).length
  const modelRows = targets.filter((t) => t.model != null && String(t.model ?? '').trim() !== '')
  const beapReadyCount = modelRows.filter((t) => t.beapReady === true).length
  await logHostAiTargetSummaryLines(targets)
  console.log(
    `${L} list_done count=${handshakeCount} available_count=${availableCount} ollama_direct_count=${ollamaDirectHandshakeCount} beap_ready_count=${beapReadyCount}`,
  )

  return { ok: true, targets, refreshMeta: { hadCapabilitiesProbed } }
}
