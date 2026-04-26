/**
 * IPC-backed list of selectable Host internal inference rows for Sandbox UIs.
 * See also: internal-inference:listTargets (same data; wire-oriented + logs).
 */

import {
  deriveInternalHandshakeRoles,
  type InternalHandshakeRoleSource,
} from '../../../../../packages/shared/src/handshake/internalIdentityUi'
import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { logInternalHostHandshakeP2pInspect } from './internalP2pHandshakeInspect'
import { newHostAiCorrelationChain } from './hostAiStageLog'
import {
  getP2pInferenceFlags,
  isHostAiP2pUxEnabled,
  isWebRtcHostAiArchitectureEnabled,
  logHostAiP2pFlagsAndSource,
} from './p2pInferenceFlags'
import { ensureHostAiP2pSession, getSessionState, P2pSessionPhase } from './p2pSession/p2pInferenceSessionManager'
import { isP2pDataChannelUpForHandshake } from './p2pSession/p2pSessionWait'
import {
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
  handshakeSamePrincipal,
  p2pEndpointKind,
  peerCoordinationDeviceId,
} from './policy'
import {
  buildHostAiTransportDeciderInput,
  decideHostAiTransport,
  decideInternalInferenceTransport,
  type HostAiSelectorPhase,
  type HostAiTransportDeciderResult,
} from './transport/decideInternalInferenceTransport'
import type { P2pInferenceFlagSnapshot } from './p2pInferenceFlags'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { mapCapabilitiesWireToProbe, probeHostInferencePolicyFromSandbox } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'
import { listHostCapabilities } from './transport/internalInferenceTransport'
import type { InternalInferenceCapabilitiesResultWire } from './types'

const L = '[HOST_INFERENCE_TARGETS]'

/** While P2P is in offer/signaling, reuse one correlation chain per handshake for list/probe (avoid new chain every poll). */
const stableListProbeChainByHandshake = new Map<string, string>()

const P2P_LIST_ENSURE_THROTTLE_MS = 5_000
const lastP2pEnsureByHandshake = new Map<
  string,
  { t: number; state: Awaited<ReturnType<typeof ensureHostAiP2pSession>> }
>()

const COPY_OFFER_START_NOT_OBSERVED =
  'Host AI P2P setup did not start correctly. Check logs for OFFER_START_NOT_OBSERVED.'

const WEBRTC_LIST_CAPS_CACHE_TTL_MS = 5_000
type ListHostCapResult =
  | { ok: true; wire: InternalInferenceCapabilitiesResultWire }
  | { ok: false; reason: string; responseStatus?: number; networkErrorMessage?: string }
const webrtcListHostCapsCache = new Map<string, { at: number; result: ListHostCapResult }>()

/** Clears the short TTL WebRTC list caps cache. Used by unit tests to avoid order-dependent state. */
export function resetWebrtcListHostCapsCacheForTests(): void {
  webrtcListHostCapsCache.clear()
}

/** UI phase for Host AI selector (from transport policy + probe); do not infer from p2p_endpoint_kind alone. */
export type HostP2pUiPhase =
  | 'connecting'
  | 'ready'
  | 'p2p_unavailable'
  | 'legacy_http_invalid'
  | 'policy_disabled'
  | 'no_model'
  | 'hidden'

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
      return 'connecting'
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
  }
}

function primaryLabelForP2pUiPhase(phase: HostP2pUiPhase, readyModelName?: string | null): string {
  switch (phase) {
    case 'connecting':
      return 'Host AI · connecting…'
    case 'ready':
      return (readyModelName && readyModelName.trim()) || 'Host AI · ready'
    case 'p2p_unavailable':
      return 'Host AI · P2P unavailable'
    case 'legacy_http_invalid':
      return 'Host AI · legacy endpoint unavailable'
    case 'policy_disabled':
      return 'Host AI · disabled by Host'
    case 'no_model':
      return 'Host AI · no active model'
    case 'hidden':
      return 'Host AI unavailable'
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

/** This instance is Host and peer is Sandbox (same account) — not the Host AI discovery client role. */
function rowProvesLocalHostPeerSandboxForHostAi(r: HandshakeRecord): boolean {
  if (!handshakeSamePrincipal(r)) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  return dr.ok && dr.localRole === 'host' && dr.peerRole === 'sandbox'
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
  const ml = metaLocal(hostComputerNameFromRow(r0), r0.internal_peer_pairing_code ?? undefined)
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
    host_device_id: (peerCoordinationDeviceId(r0) ?? '').trim() || '',
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
    inference_error_code: `SANDBOX_HOST_ROLE_${rr}`,
    p2pUiPhase: 'hidden',
    failureCode: `SANDBOX_HOST_ROLE_${rr}`,
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
  const peerName = hostComputerNameFromRow(r)
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

export type HostInferenceListAvailability =
  | 'available'
  | 'host_offline'
  | 'direct_unreachable'
  | 'policy_disabled'
  | 'model_unavailable'
  | 'handshake_inactive'
  | 'not_configured'
  | 'identity_incomplete'
  /** Resolving: ACTIVE internal same-principal host↔sandbox row seen; still resolving labels / P2P. */
  | 'checking_host'

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
  /** Policy / transport / probe failure for diagnostics (not user-facing copy). */
  failureCode: string | null
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
}

type HostTargetDraft = Omit<HostInternalInferenceListItem, 'host_selector_state' | 'secondaryLabel' | 'hostSelectorState' | 'type'>

function epKindToListKind(
  k: ReturnType<typeof p2pEndpointKind>,
): HostListLegacyEndpointKind {
  if (k === 'missing' || k === 'invalid' || k === 'relay' || k === 'direct') return k
  return 'invalid'
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
const COPY_HOST_AI_P2P_UNAVAILABLE_SUB =
  'Secure P2P connection could not be established. Try refresh or check the Host.'

function hostAiSubtitleForPhase(phase: HostP2pUiPhase, ml: { hostName: string; roleLabel: string; pairingDisplay: string }): string {
  if (phase === 'connecting') {
    return COPY_HOST_AI_CONNECTING_SUB
  }
  if (phase === 'p2p_unavailable') {
    return COPY_HOST_AI_P2P_UNAVAILABLE_SUB
  }
  return secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
}

function draftCheckingPlaceholderForHostPair(r0: HandshakeRecord, db: unknown): HostTargetDraft {
  const hid = r0.handshake_id
  const name = hostComputerNameFromRow(r0)
  const pcc = r0.internal_peer_pairing_code ?? undefined
  const ml = metaLocal(name, pcc)
  const lek = epKindToListKind(p2pEndpointKind(db, r0.p2p_endpoint))
  const title = primaryLabelForP2pUiPhase('connecting')
  return {
    kind: 'host_internal',
    id: buildHostTargetId(hid, 'checking'),
    label: title,
    display_label: title,
    displayTitle: title,
    displaySubtitle: hostAiSubtitleForPhase('connecting', ml),
    model: null,
    model_id: null,
    provider: 'host_internal',
    handshake_id: hid,
    host_device_id: (peerCoordinationDeviceId(r0) ?? '').trim() || '',
    host_computer_name: ml.hostName,
    host_pairing_code: ml.digits6,
    host_orchestrator_role: 'host',
    host_orchestrator_role_label: ml.roleLabel,
    internal_identifier_6: ml.digits6,
    secondary_label: secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay),
    direct_reachable: false,
    policy_enabled: false,
    available: false,
    availability: 'checking_host',
    unavailable_reason: 'CHECKING_CAPABILITIES',
    host_role: 'Host',
    p2pUiPhase: 'connecting',
    failureCode: null,
    transportMode: 'none',
    legacyEndpointKind: lek,
  }
}

function hostComputerNameFromRow(r: HandshakeRecord): string {
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

/** Lenient: initiator/acceptor device roles are host + sandbox (local_role can be wrong or legacy). */
function isHostSandboxDeviceRoles(r: HandshakeRecord): boolean {
  const a = r.initiator_device_role
  const b = r.acceptor_device_role
  return (a === 'host' && b === 'sandbox') || (a === 'sandbox' && b === 'host')
}

function hostSelectorStateForItem(
  t: Pick<HostInternalInferenceListItem, 'available' | 'availability' | 'unavailable_reason'>,
): 'available' | 'checking' | 'unavailable' {
  if (t.available) return 'available'
  if (t.availability === 'checking_host' || t.unavailable_reason === 'CHECKING_CAPABILITIES') return 'checking'
  return 'unavailable'
}

function finalizeItem(t: HostTargetDraft): HostInternalInferenceListItem {
  const hss = hostSelectorStateForItem(t)
  const subtitle = t.secondary_label
  return {
    ...t,
    type: 'host_internal',
    displayTitle: t.displayTitle ?? t.label,
    displaySubtitle: t.displaySubtitle ?? subtitle,
    hostTargetAvailable: t.available,
    host_selector_state: hss,
    hostSelectorState: hss,
    secondaryLabel: subtitle,
    unavailable_reason: t.available ? null : t.unavailable_reason == null ? null : String(t.unavailable_reason),
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

function anyActiveRowProvesLocalHostPeerSandboxFromDb(db: unknown): boolean {
  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE })
  for (const r0 of rows) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
    if (rowProvesLocalHostPeerSandboxForHostAi(r0)) {
      return true
    }
  }
  return false
}

/**
 * `orchestrator:getMode`: this device is the Host side of an ACTIVE internal same-principal row (hide Host AI ↻ in UI).
 */
export async function hasActiveInternalLedgerLocalHostPeerSandboxForHostUi(): Promise<boolean> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return false
  }
  return anyActiveRowProvesLocalHostPeerSandboxFromDb(db)
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
    const displayName = hostComputerNameFromRow(r0)
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
      host_device_id: (peerCoordinationDeviceId(r0) ?? '').trim() || '',
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
      void import('./p2pEndpointRepair')
        .then((m) => m.runP2pEndpointRepairPass(db, 'list_inference_targets'))
        .catch(() => {})
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
      const ml = metaLocal(hostComputerNameFromRow(r0), r0.internal_peer_pairing_code ?? undefined)
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
        host_device_id: (peerCoordinationDeviceId(r0) ?? '').trim() || '',
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
    const displayName = hostComputerNameFromRow(r)
    const hostDevice = peerCoordinationDeviceId(r)?.trim() || ''
    const pcc = r.internal_peer_pairing_code ?? undefined
    const fRow = getP2pInferenceFlags()
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
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
    const epK = p2pEndpointKind(db, r.p2p_endpoint)
    const leK = epKindToListKind(epK)

    // MVP / legacy_http_invalid is legacy-HTTP only. WRDESK_P2P_INFERENCE_ENABLED + WEBRTC: relay is signaling; do not disable Host AI.
    let listDec: HostAiTransportDeciderResult = dec
    let transportDecideLogReason: string = 'policy'
    if (dec.selectorPhase === 'legacy_http_invalid' && isWebRtcHostAiArchitectureEnabled(fRow)) {
      console.warn(
        `${L} transport_repair handshake=${hid} raw_phase=legacy_http_invalid p2p_endpoint_kind=${epK} -> connecting (MVP not applied; WebRTC intent)`,
      )
      transportDecideLogReason = 'p2p_enabled_legacy_repaired'
      listDec = {
        ...dec,
        selectorPhase: 'connecting',
        preferredTransport: 'webrtc_p2p',
        p2pTransportEndpointOpen: true,
        mayUseLegacyHttpFallback: dec.mayUseLegacyHttpFallback,
        legacyHttpFallbackViable: false,
        failureCode: null,
        userSafeReason: null,
      }
    } else if (
      isWebRtcHostAiArchitectureEnabled(fRow) &&
      epK === 'relay' &&
      listDec.preferredTransport === 'webrtc_p2p'
    ) {
      transportDecideLogReason = 'p2p_enabled_legacy_endpoint_ignored'
    }
    const transportAuthRow = decideHostAiTransport(listDec)
    const bm = baseMetaFromDec(listDec, leK)
    console.log(
      `[HOST_AI_TRANSPORT_DECIDE] handshake=${hid} target_detected=${listDec.targetDetected} preferred=${listDec.preferredTransport} selector_phase=${listDec.selectorPhase} legacy_http_status=${legacyHttpStatusForDecideLog(listDec, epK)} p2p_endpoint_kind=${epK} reason=${transportDecideLogReason}`,
    )

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

    if (listDec.selectorPhase === 'p2p_unavailable') {
      const ml = metaLocal(displayName, pcc)
      const miss = listDec.failureCode === 'MISSING_P2P_ENDPOINT'
      const inv = listDec.failureCode === 'INVALID_P2P_ENDPOINT'
      const ur: HostTargetUnavailableCode = miss
        ? 'MISSING_P2P_ENDPOINT'
        : inv
          ? 'ENDPOINT_NOT_DIRECT'
          : 'HOST_DIRECT_P2P_UNREACHABLE'
      const sub = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const ht = primaryLabelForP2pUiPhase('p2p_unavailable')
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

    if (listDec.selectorPhase === 'legacy_http_invalid' && !isWebRtcHostAiArchitectureEnabled(fRow)) {
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
      listDec.selectorPhase !== 'legacy_http_available'
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

    const webrtcListPath =
      listDec.preferredTransport === 'webrtc_p2p' &&
      p2pEnsureEligibleForList(fRow, epK) &&
      listDec.p2pTransportEndpointOpen

    if (webrtcListPath) {
      let sState: Awaited<ReturnType<typeof ensureHostAiP2pSession>> | null = null
      const tList = Date.now()
      const ensureCached = lastP2pEnsureByHandshake.get(hid)
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
      if (sState?.phase === P2pSessionPhase.failed) {
        const ml0 = metaLocal(displayName, pcc)
        const psub0 =
          sState.lastErrorCode === InternalInferenceErrorCode.OFFER_START_NOT_OBSERVED
            ? COPY_OFFER_START_NOT_OBSERVED
            : hostAiSubtitleForPhase('p2p_unavailable', ml0)
        const ht0 = primaryLabelForP2pUiPhase('p2p_unavailable')
        const failCode0 = sState.lastErrorCode ? String(sState.lastErrorCode) : 'P2P_SESSION_FAILED'
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
        const ml0 = metaLocal(displayName, pcc)
        const psub0 = hostAiSubtitleForPhase('connecting', ml0)
        const hConn = primaryLabelForP2pUiPhase('connecting')
        const tConn: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'connecting'),
          label: hConn,
          display_label: hConn,
          displayTitle: hConn,
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
          direct_reachable: true,
          policy_enabled: false,
          available: false,
          availability: 'checking_host',
          unavailable_reason: 'CHECKING_CAPABILITIES',
          host_role: 'Host',
          inference_error_code: 'P2P_SESSION_IN_PROGRESS',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'connecting',
          failureCode: 'P2P_SESSION_IN_PROGRESS',
        }
        console.log(
          `${L} target_p2p_connecting handshake=${hid} session=${sState?.sessionId ?? 'null'} row_emitted=true probe_deferred=dc [HOST_AI_TARGET_STATE] handshake=${hid} phase=connecting transport=webrtc_p2p source=fresh`,
        )
        targets.push(finalizeItem(tConn))
        continue
      }
    }

    if (listDec.preferredTransport === 'webrtc_p2p' && !isP2pDataChannelUpForHandshake(hid)) {
      const ml0 = metaLocal(displayName, pcc)
      const psub0 = hostAiSubtitleForPhase('connecting', ml0)
      const hConn = primaryLabelForP2pUiPhase('connecting')
      const tConn: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'connecting'),
        label: hConn,
        display_label: hConn,
        displayTitle: hConn,
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
        direct_reachable: true,
        policy_enabled: false,
        available: false,
        availability: 'checking_host',
        unavailable_reason: 'CHECKING_CAPABILITIES',
        host_role: 'Host',
        inference_error_code: 'P2P_SESSION_IN_PROGRESS',
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'connecting',
        failureCode: 'P2P_SESSION_IN_PROGRESS',
      }
      console.log(
        `[HOST_AI_TARGET_STATE] handshake=${hid} phase=connecting transport=webrtc_p2p source=fresh (precap_guard)`,
      )
      targets.push(finalizeItem(tConn))
      continue
    }

    const ml0 = metaLocal(displayName, pcc)
    let probe: Awaited<ReturnType<typeof probeHostInferencePolicyFromSandbox>>
    const webrtcP2pListDirect =
      listDec.preferredTransport === 'webrtc_p2p' &&
      !fRow.p2pInferenceHttpFallback &&
      isP2pDataChannelUpForHandshake(hid) &&
      transportAuthRow.kind === 'webrtc_p2p'

    if (webrtcP2pListDirect) {
      try {
        const tCap = Math.min(getHostInternalInferencePolicy().timeoutMs, 15_000)
        const ep = r.p2p_endpoint?.trim() ?? ''
        const tok = (r.counterparty_p2p_token ?? '').trim()
        if (!tok) {
          probe = {
            ok: false,
            code: InternalInferenceErrorCode.POLICY_FORBIDDEN,
            message: 'token',
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
            capP2p = (await listHostCapabilities(hid, {
              record: r,
              ingestUrl: ep,
              token: tok,
              timeoutMs: tCap,
              correlationChain: rowChain,
            })) as ListHostCapResult
            webrtcListHostCapsCache.set(hid, { at: now, result: capP2p })
          }
          if (capP2p.ok) {
            probe = mapCapabilitiesWireToProbe(capP2p.wire)
          } else {
            const rsn = String('reason' in capP2p ? capP2p.reason : 'unknown')
            const still =
              rsn === 'p2p_not_ready_no_fallback' || rsn.includes('P2P') || rsn === 'P2P_UNAVAILABLE'
            probe = {
              ok: false,
              code: still
                ? InternalInferenceErrorCode.P2P_STILL_CONNECTING
                : InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
              message: rsn,
              directP2pAvailable: true,
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
        const pht = primaryLabelForP2pUiPhase('p2p_unavailable')
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
          inference_error_code: 'CAPABILITY_PROBE_FAILED',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'p2p_unavailable',
          failureCode: 'CAPABILITY_PROBE_FAILED',
        }
        hadCapabilitiesProbed = true
        targets.push(finalizeItem(t))
        continue
      }
    } else {
      console.log(`${L} probe_capabilities_start handshake=${hid}`)
      hadCapabilitiesProbed = true
      try {
        probe = await probeHostInferencePolicyFromSandbox(hid, { correlationChain: rowChain })
      } catch (err) {
        console.warn(`${L} target_disabled handshake=${hid} reason=probe_throw`, err)
        const ur: HostTargetUnavailableCode = 'CAPABILITY_PROBE_FAILED'
        const psub = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
        const pht = primaryLabelForP2pUiPhase('p2p_unavailable')
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
          inference_error_code: 'CAPABILITY_PROBE_FAILED',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'p2p_unavailable',
          failureCode: 'CAPABILITY_PROBE_FAILED',
        }
        targets.push(finalizeItem(t))
        continue
      }
    }
    if (!probe.ok) {
      const code = probe.code
      if (code === InternalInferenceErrorCode.P2P_STILL_CONNECTING) {
        const psubC = hostAiSubtitleForPhase('connecting', ml0)
        const hConn = primaryLabelForP2pUiPhase('connecting')
        const tStill: HostTargetDraft = {
          kind: 'host_internal',
          id: buildHostTargetId(hid, 'connecting'),
          label: hConn,
          display_label: hConn,
          displayTitle: hConn,
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
          direct_reachable: true,
          policy_enabled: false,
          available: false,
          availability: 'checking_host',
          unavailable_reason: 'CHECKING_CAPABILITIES',
          host_role: 'Host',
          inference_error_code: 'P2P_SESSION_IN_PROGRESS',
          ...baseMetaFromDec(listDec, leK),
          p2pUiPhase: 'connecting',
          failureCode: 'P2P_STILL_CONNECTING',
        }
        console.log(
          `${L} target_p2p_connecting handshake=${hid} reason=p2p_still_connecting [HOST_AI_TARGET_STATE] handshake=${hid} phase=connecting transport=webrtc_p2p source=fresh`,
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
        (code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE ||
          (!probe.directP2pAvailable && !(stackOnForRelay && relaySig)))
      const ur: HostTargetUnavailableCode = isPolicyForbid
        ? 'HOST_POLICY_DISABLED'
        : p2pFail
          ? 'HOST_DIRECT_P2P_UNREACHABLE'
          : 'CAPABILITY_PROBE_FAILED'
      const p2pUiProbe: HostP2pUiPhase = isPolicyForbid ? 'policy_disabled' : 'p2p_unavailable'
      let av: HostInferenceListAvailability = 'host_offline'
      if (isPolicyForbid) {
        av = 'policy_disabled'
      } else if (p2pFail) {
        av = 'direct_unreachable'
      }
      const p2pCompact = p2pFail
      const sub = secondaryLabelFromMeta(ml0.hostName, ml0.roleLabel, ml0.pairingDisplay)
      const unLab = p2pCompact
        ? primaryLabelForP2pUiPhase('p2p_unavailable')
        : isPolicyForbid
          ? primaryLabelForP2pUiPhase('policy_disabled')
          : primaryLabelForP2pUiPhase('p2p_unavailable')
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
        direct_reachable: !!probe.directP2pAvailable,
        policy_enabled: false,
        available: false,
        availability: av,
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: ur,
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: p2pUiProbe,
        failureCode: isPolicyForbid ? 'HOST_POLICY_DISABLED' : String(code),
        transportMode: listDec.preferredTransport,
        legacyEndpointKind: leK,
      }
      const pr = isPolicyForbid ? 'POLICY_DISABLED' : 'CAPABILITY_PROBE_FAILED'
      console.log(`${L} target_disabled handshake=${hid} reason=${pr} detail=probe_${String(code)}`)
      targets.push(finalizeItem(t))
      continue
    }

    const hm = metaFromOkProbe(probe, displayName, pcc)

    if (!probe.allowSandboxInference) {
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

    const defaultChatModel = probe.defaultChatModel?.trim()
    if (!defaultChatModel) {
      const ur: HostTargetUnavailableCode = 'HOST_NO_ACTIVE_LOCAL_LLM'
      const nmT = primaryLabelForP2pUiPhase('no_model')
      const psub = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
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
        host_role: 'Host',
        inference_error_code: probe.inferenceErrorCode || InternalInferenceErrorCode.MODEL_UNAVAILABLE,
        ...baseMetaFromDec(listDec, leK),
        p2pUiPhase: 'no_model',
        failureCode: listDec.failureCode ?? 'HOST_NO_ACTIVE_LOCAL_LLM',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=HOST_NO_ACTIVE_LOCAL_LLM detail=no_default_model (row_kept for discovery)`)
      targets.push(finalizeItem(t))
      continue
    }

    const primaryLabel = probe.displayLabelFromHost?.trim() || `Host AI · ${defaultChatModel}`
    const secondary = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
    const t: HostTargetDraft = {
      kind: 'host_internal',
      id: buildHostTargetId(hid, defaultChatModel),
      label: primaryLabel,
      display_label: primaryLabel,
      displayTitle: primaryLabel,
      displaySubtitle: secondary,
      model: defaultChatModel,
      model_id: defaultChatModel,
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
    }
    console.log(`${L} target_added handshake=${hid} model=${defaultChatModel}`)
    targets.push(finalizeItem(t))
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
  console.log(`${L} list_done count=${targets.length}`)

  return { ok: true, targets, refreshMeta: { hadCapabilitiesProbed } }
}
