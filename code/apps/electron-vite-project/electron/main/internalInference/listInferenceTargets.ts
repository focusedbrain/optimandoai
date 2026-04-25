/**
 * IPC-backed list of selectable Host internal inference rows for Sandbox UIs.
 * See also: internal-inference:listTargets (same data; wire-oriented + logs).
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getOrchestratorMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  handshakeSamePrincipal,
  localDeviceRole,
  p2pEndpointKind,
  peerDeviceRole,
  peerCoordinationDeviceId,
} from './policy'
import { probeHostInferencePolicyFromSandbox } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'

const L = '[HOST_INFERENCE_TARGETS]'

/** User-facing subtitle for disabled Host rows (not transport codes; see `handshake:getAvailableModels`). */
const HR = {
  p2p: 'Host is paired but direct P2P is not reachable.',
  /** Relay / BEAP service URL in `p2p_endpoint` is not a direct local endpoint for service RPC. */
  endpointNotDirect: 'Direct (non-relay) P2P to the Host is required. This endpoint is not a direct address.',
  missingP2p: 'No direct P2P endpoint on this internal handshake. Set a local Host address in the ledger.',
  policy: 'Host AI is disabled on the Host.',
  noModel: 'Host has no active local model.',
  identity: 'Internal handshake identity is incomplete.',
  capabilities: 'Host capabilities could not be fetched (request failed or timed out).',
  ledger: 'Unlock or refresh the handshake ledger.',
  localNotSandbox: 'This device is not recorded as the Sandbox in this internal handshake. Check device roles in Settings.',
  peerNotHost: 'The peer in this internal handshake is not recorded as a Host. Check pairing metadata.',
  roleGate: 'This internal row is not a Sandbox–Host internal pair. Fix local / peer device roles, or re-pair.',
} as const

const CHECKING_SECONDARY = 'Active internal Host handshake found'

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

function mapRoleGateReason(r: HandshakeRecord): HostInternalInferenceRejectReason {
  if (!isSandboxMode()) return 'NOT_SANDBOX_MODE'
  if (localDeviceRole(r) !== 'sandbox') return 'LOCAL_NOT_SANDBOX'
  if (peerDeviceRole(r) !== 'host') return 'PEER_NOT_HOST'
  return 'UNKNOWN'
}

function secondaryForRoleMetadataReject(_r: HandshakeRecord, rr: HostInternalInferenceRejectReason): string {
  if (rr === 'LOCAL_NOT_SANDBOX') {
    return HR.localNotSandbox
  }
  if (rr === 'PEER_NOT_HOST') {
    return HR.peerNotHost
  }
  return HR.roleGate
}

/**
 * When `assertSandboxRequestToHost` fails and we cannot use the "checking" placeholder (no host+sandbox
 * device role pair in metadata), still emit one **disabled** Host row so the selector is never empty.
 */
function draftDisabledSandboxHostRoleMetadata(
  r0: HandshakeRecord,
  rr: HostInternalInferenceRejectReason,
): HostTargetDraft {
  const hid = r0.handshake_id
  const ml = metaLocal(hostComputerNameFromRow(r0), r0.internal_peer_pairing_code ?? undefined)
  return {
    kind: 'host_internal',
    id: buildHostTargetId(hid, 'unavailable'),
    label: 'Host AI unavailable',
    display_label: 'Host AI unavailable',
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
    secondary_label: secondaryForRoleMetadataReject(r0, rr),
    direct_reachable: false,
    policy_enabled: false,
    available: false,
    availability: 'not_configured',
    unavailable_reason: 'SANDBOX_HOST_ROLE_METADATA',
    host_role: 'Host',
    inference_error_code: `SANDBOX_HOST_ROLE_${rr}`,
  }
}

function peerDeviceRoleForLog(r: HandshakeRecord): 'host' | 'sandbox' | 'unknown' {
  const p = peerDeviceRole(r)
  if (p === 'host' || p === 'sandbox') return p
  return 'unknown'
}

function logInternalCandidate(
  r: HandshakeRecord,
  db: any,
  mainMode: string,
): void {
  const sp = handshakeSamePrincipal(r)
  const idc = r.internal_coordination_identity_complete === true
  const epKind = p2pEndpointKind(db, r.p2p_endpoint)
  const peerName = hostComputerNameFromRow(r)
  const digits6 = digits6Only(r.internal_peer_pairing_code ?? undefined)
  const ldr = localDeviceRole(r)
  const pdr = peerDeviceRoleForLog(r)
  console.log(
    `${L} candidate handshake=${r.handshake_id} local_mode=${mainMode} local_role=${r.local_role} local_device_role=${
      ldr ?? 'unknown'
    } peer_device_role=${pdr} same_principal=${sp} internal_coordination_identity_complete=${idc} p2p_endpoint_kind=${epKind} peer_display_name=${peerName} pairing_6=${digits6 || '—'}`,
  )
}

export type HostTargetUnavailableCode =
  | 'HOST_DIRECT_P2P_UNAVAILABLE'
  | 'HOST_NO_ACTIVE_LOCAL_LLM'
  | 'HOST_POLICY_DISABLED'
  | 'CHECKING_CAPABILITIES'
  | 'HOST_INCOMPLETE_INTERNAL_HANDSHAKE'
  | 'CAPABILITY_PROBE_FAILED'
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
  kind: 'host_internal'
  id: string
  label: string
  model: string | null
  model_id: string | null
  display_label: string
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
  availability: HostInferenceListAvailability
  /**
   * When `available` is true, must be `null` / omitted.
   * When false, one of the normalized Host-target reasons (or legacy prose for debugging).
   */
  unavailable_reason: string | null
  host_role: 'Host'
  inference_error_code?: string
  /** UI tri-state: available vs in-flight check vs not selectable. */
  host_selector_state: 'available' | 'checking' | 'unavailable'
}

type HostTargetDraft = Omit<HostInternalInferenceListItem, 'host_selector_state' | 'secondaryLabel'>

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

function secondaryLabelFromMeta(hostName: string, roleLabel: string, pairingDisplay: string): string {
  return `${hostName} — ${roleLabel} · ID ${pairingDisplay}`
}

function draftCheckingPlaceholderForHostPair(r0: HandshakeRecord): HostTargetDraft {
  const hid = r0.handshake_id
  const name = hostComputerNameFromRow(r0)
  const pcc = r0.internal_peer_pairing_code ?? undefined
  const ml = metaLocal(name, pcc)
  return {
    kind: 'host_internal',
    id: buildHostTargetId(hid, 'checking'),
    label: 'Host AI · checking Host…',
    display_label: 'Host AI · checking Host…',
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
    secondary_label: CHECKING_SECONDARY,
    direct_reachable: false,
    policy_enabled: false,
    available: false,
    availability: 'checking_host',
    unavailable_reason: 'CHECKING_CAPABILITIES',
    host_role: 'Host',
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
  return {
    ...t,
    host_selector_state: hostSelectorStateForItem(t),
    secondaryLabel: t.secondary_label,
    unavailable_reason: t.available ? null : t.unavailable_reason == null ? null : String(t.unavailable_reason),
  }
}

/**
 * Returns Host AI targets for Sandbox: ACTIVE internal, same principal, this device Sandbox ↔ peer Host.
 * Host orchestrator (local mode Host) always gets an empty list.
 * Never returns empty when at least one qualifying row exists in the ledger (one row per handshake: available, or disabled with reason).
 */
export async function listSandboxHostInternalInferenceTargets(): Promise<{
  ok: true
  targets: HostInternalInferenceListItem[]
  /** Set when at least one target row called Host (direct P2P capabilities) this run. */
  refreshMeta: { hadCapabilitiesProbed: boolean }
}> {
  /** Same persisted value as `orchestrator:getMode` / `handshake:getAvailableModels` (orchestrator-mode.json). */
  const mainMode = getOrchestratorMode().mode
  console.log(`${L} list_begin mode=${mainMode}`)

  if (mainMode === 'host') {
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }
  // `OrchestratorModeConfig.mode` is host|sandbox; at this point we are sandbox.

  const db = await getHandshakeDbForInternalInference()
  const dbOk = db != null
  console.log(`${L} db_available=${dbOk}`)
  if (!db) {
    console.log(`${L} rejected reason=DB_UNAVAILABLE (ledger not open; check SSO / session)`)
    console.log(`${L} list_empty reason=handshake_db_unavailable`)
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }

  /** Same Tier-1 ledger as `handshake.list` (no per-request filter) — all ACTIVE rows, then split by type in-process. */
  const ledgerActive = listHandshakeRecords(db, { state: HandshakeState.ACTIVE })
  const activeInternalCount = ledgerActive.filter((r) => r.handshake_type === 'internal').length
  console.log(`${L} active_internal_count=${activeInternalCount}`)

  let hostPairCount = 0
  for (const r0 of ledgerActive) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
    if (!handshakeSamePrincipal(r0)) continue
    if (!assertSandboxRequestToHost(r0).ok) continue
    hostPairCount += 1
  }
  console.log(`${L} active_internal_host_count=${hostPairCount}`)

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

    logInternalCandidate(r0, db, mainMode)
    if (!handshakeSamePrincipal(r0)) {
      console.log(`${L} rejected handshake=${r0.handshake_id} reason=NOT_SAME_PRINCIPAL`)
      continue
    }
    const roleGate = assertSandboxRequestToHost(r0)
    if (!roleGate.ok) {
      const rr = mapRoleGateReason(r0)
      if (isHostSandboxDeviceRoles(r0)) {
        console.log(
          `${L} target_placeholder handshake=${r0.handshake_id} reason=assertSandboxRequestToHost_failed detail=${rr}`,
        )
        targets.push(finalizeItem(draftCheckingPlaceholderForHostPair(r0)))
        continue
      }
      console.log(
        `${L} target_disabled handshake=${r0.handshake_id} reason=SANDBOX_HOST_ROLE_METADATA detail=${rr}`,
      )
      targets.push(finalizeItem(draftDisabledSandboxHostRoleMetadata(r0, rr)))
      continue
    }

    const hid = r0.handshake_id
    const ar = assertRecordForServiceRpc(r0)
    if (!ar.ok) {
      const ur: HostTargetUnavailableCode = 'HOST_INCOMPLETE_INTERNAL_HANDSHAKE'
      const ml = metaLocal(hostComputerNameFromRow(r0), r0.internal_peer_pairing_code ?? undefined)
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
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
        secondary_label: HR.identity,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'identity_incomplete',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=IDENTITY_INCOMPLETE detail=assertRecord_${ar.code}`)
      targets.push(finalizeItem(t))
      continue
    }

    const r = ar.record
    const direct = assertP2pEndpointDirect(db, r.p2p_endpoint)
    const directOk = direct.ok
    const epK = p2pEndpointKind(db, r.p2p_endpoint)
    const displayName = hostComputerNameFromRow(r)
    const hostDevice = peerCoordinationDeviceId(r)?.trim() || ''
    const pcc = r.internal_peer_pairing_code ?? undefined

    if (epK === 'missing') {
      const ml = metaLocal(displayName, pcc)
      const ur: HostTargetUnavailableCode = 'HOST_DIRECT_P2P_UNAVAILABLE'
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: (peerCoordinationDeviceId(r) ?? '').trim() || '',
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: HR.p2p,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=MISSING_P2P_ENDPOINT`)
      targets.push(finalizeItem(t))
      continue
    }

    if (!hostDevice) {
      const ml = metaLocal(displayName, pcc)
      const ur: HostTargetUnavailableCode = 'HOST_DIRECT_P2P_UNAVAILABLE'
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        model: null,
        model_id: null,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: '',
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: HR.ledger,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=UNKNOWN detail=no_peer_coordination_device_id`)
      targets.push(finalizeItem(t))
      continue
    }

    if (!directOk) {
      const ur: HostTargetUnavailableCode = 'HOST_DIRECT_P2P_UNAVAILABLE'
      const ml = metaLocal(displayName, pcc)
      const sub =
        epK === 'relay'
          ? HR.endpointNotDirect
          : epK === 'missing' || epK === 'invalid'
            ? HR.missingP2p
            : HR.p2p
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
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
        inference_error_code: epK === 'relay' ? 'ENDPOINT_NOT_DIRECT' : 'HOST_DIRECT_P2P_UNAVAILABLE',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=ENDPOINT_NOT_DIRECT detail=${epK}`)
      targets.push(finalizeItem(t))
      continue
    }

    console.log(`${L} probe_capabilities_start handshake=${hid}`)
    hadCapabilitiesProbed = true
    const ml0 = metaLocal(displayName, pcc)
    let probe: Awaited<ReturnType<typeof probeHostInferencePolicyFromSandbox>>
    try {
      probe = await probeHostInferencePolicyFromSandbox(hid)
    } catch (err) {
      console.warn(`${L} target_disabled handshake=${hid} reason=probe_throw`, err)
      const ur: HostTargetUnavailableCode = 'CAPABILITY_PROBE_FAILED'
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
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
        secondary_label: HR.capabilities,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'host_offline',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: 'CAPABILITY_PROBE_FAILED',
      }
      targets.push(finalizeItem(t))
      continue
    }
    if (!probe.ok) {
      const code = probe.code
      const ur: HostTargetUnavailableCode =
        code === InternalInferenceErrorCode.POLICY_FORBIDDEN
          ? 'HOST_POLICY_DISABLED'
          : 'HOST_DIRECT_P2P_UNAVAILABLE'
      let av: HostInferenceListAvailability = 'host_offline'
      if (code === InternalInferenceErrorCode.POLICY_FORBIDDEN) {
        av = 'policy_disabled'
      } else if (code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE || !probe.directP2pAvailable) {
        av = 'direct_unreachable'
      }
      const sub =
        code === InternalInferenceErrorCode.POLICY_FORBIDDEN
          ? HR.policy
          : code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE || !probe.directP2pAvailable
            ? HR.p2p
            : HR.capabilities
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
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
      }
      const pr =
        code === InternalInferenceErrorCode.POLICY_FORBIDDEN
          ? 'POLICY_DISABLED'
          : 'CAPABILITY_PROBE_FAILED'
      console.log(`${L} target_disabled handshake=${hid} reason=${pr} detail=probe_${String(code)}`)
      targets.push(finalizeItem(t))
      continue
    }

    const hm = metaFromOkProbe(probe, displayName, pcc)

    if (!probe.allowSandboxInference) {
      const ur: HostTargetUnavailableCode = 'HOST_POLICY_DISABLED'
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
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
        secondary_label: HR.policy,
        direct_reachable: true,
        policy_enabled: false,
        available: false,
        availability: 'policy_disabled',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=POLICY_DISABLED detail=host_policy_no_sandbox_inference`)
      targets.push(finalizeItem(t))
      continue
    }

    const defaultChatModel = probe.defaultChatModel?.trim()
    if (!defaultChatModel) {
      const ur: HostTargetUnavailableCode = 'HOST_NO_ACTIVE_LOCAL_LLM'
      const t: HostTargetDraft = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unavailable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
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
        secondary_label: HR.noModel,
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'model_unavailable',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: probe.inferenceErrorCode || InternalInferenceErrorCode.MODEL_UNAVAILABLE,
      }
      console.log(`${L} target_disabled handshake=${hid} reason=HOST_NO_ACTIVE_LOCAL_LLM detail=no_default_model`)
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
    }
    console.log(`${L} target_added handshake=${hid} model=${defaultChatModel}`)
    targets.push(finalizeItem(t))
  }

  /**
   * Invariant: if at least one ACTIVE same-principal internal Host handshake row exists, the
   * selector is never left empty (checking placeholder if the pipeline could not build a more specific row).
   */
  if (targets.length === 0 && mainMode === 'sandbox' && db) {
    for (const r0 of ledgerActive) {
      if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
      if (!handshakeSamePrincipal(r0)) continue
      const hid = r0.handshake_id
      console.log(`${L} target_placeholder_added handshake=${hid} reason=fallback_no_rows_after_pipeline`)
      targets.push(finalizeItem(draftCheckingPlaceholderForHostPair(r0)))
      break
    }
  }

  if (targets.length === 0) {
    if (activeInternalCount === 0) {
      console.log(`${L} list_empty reason=no_active_internal_rows_in_ledger`)
    } else if (hostPairCount === 0) {
      console.log(`${L} list_empty reason=no_sandbox_to_host_host_pairs_after_filter`)
    } else {
      console.log(`${L} list_empty reason=unexpected (hostPairCount>0 but no target rows — bug)`)
    }
  }
  console.log(`${L} list_done count=${targets.length}`)

  return { ok: true, targets, refreshMeta: { hadCapabilitiesProbed } }
}
