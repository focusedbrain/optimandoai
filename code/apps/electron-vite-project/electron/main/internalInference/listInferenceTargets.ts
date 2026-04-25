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
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { logInternalHostHandshakeP2pInspect } from './internalP2pHandshakeInspect'
import {
  assertRecordForServiceRpc,
  handshakeSamePrincipal,
  p2pEndpointKind,
  p2pEndpointMvpClass,
  peerCoordinationDeviceId,
} from './policy'
import { probeHostInferencePolicyFromSandbox } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'

const L = '[HOST_INFERENCE_TARGETS]'

/** User-facing subtitle for disabled Host rows (not transport codes; see `handshake:getAvailableModels`). */
const HR = {
  /**
   * STEP 8 / MVP: capability probe + inference are direct P2P only; relay is not used for those paths.
   * `HR.p2p` for generic direct P2P failures; `HR.mvpP2p` when the stored `p2p_endpoint` is not direct-LAN (STEP 2).
   */
  p2p: 'Host is paired, but direct P2P is not reachable.',
  /** Dev / comments only; `p2p` is used in the model row for non-direct relay endpoints. */
  endpointNotDirect: 'Direct (non-relay) P2P to the Host is required. This endpoint is not a direct address.',
  /** STEP 2: stored `p2p_endpoint` is not a valid direct-LAN URL for Host inference (relay, localhost, or invalid). */
  mvpP2p: 'The Host handshake is active, but the stored direct P2P endpoint is not reachable.',
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

/** Handshake says this device is Sandbox and peer is Host, same account — the Host AI target shape. */
function rowProvesLocalSandboxToHostForHostAi(r: HandshakeRecord): boolean {
  if (!handshakeSamePrincipal(r)) return false
  return deriveFromRecord(r).isLocalSandboxPeerHost
}

/** This device is Host and peer is Sandbox (same account) — not the Host AI discovery client role. */
function rowProvesLocalHostPeerSandboxForHostAi(r: HandshakeRecord): boolean {
  if (!handshakeSamePrincipal(r)) return false
  return deriveFromRecord(r).isLocalHostPeerSandbox
}

function mapRoleGateFromDerived(d: DerivedInternalRoles): HostInternalInferenceRejectReason {
  if (d.localDeviceRole !== 'sandbox') return 'LOCAL_NOT_SANDBOX'
  if (d.peerDeviceRole !== 'host') return 'PEER_NOT_HOST'
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
 * When `assertLedgerRolesSandboxToHost` fails and we cannot use the "checking" placeholder (no host+sandbox
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
    const secondary = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
    console.error(
      `${L} list_invariant ledger_proved_sandbox_to_host but_pipeline_emitted_zero_rows handshake=${hid} configured_mode=${configuredModeForLog(
        mainMode,
      )} (adding disabled UNKNOWN)`,
    )
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
      secondary_label: secondary,
      direct_reachable: false,
      policy_enabled: false,
      available: false,
      availability: 'not_configured',
      unavailable_reason: 'UNKNOWN',
      host_role: 'Host',
      inference_error_code: 'UNKNOWN',
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

  const db = await getHandshakeDbForInternalInference()
  const dbOk = db != null
  console.log(`${L} db_available=${dbOk}`)

  if (!db) {
    console.log(`${L} rejected reason=DB_UNAVAILABLE (ledger not open; check SSO / session)`)
    console.log(`${L} list_empty reason=handshake_db_unavailable`)
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }

  void import('./p2pEndpointRepair')
    .then((m) => m.runP2pEndpointRepairPass(db, 'list_inference_targets'))
    .catch(() => {})

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
      `${L} list_done count=0 reason=no_handshake_sandbox_to_host_and_configured_mode_not_sandbox (Host AI not needed)`,
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
    const roleGateOk = derived.isLocalSandboxPeerHost
    if (!roleGateOk) {
      const rr = mapRoleGateFromDerived(derived)
      if (isHostSandboxDeviceRoles(r0)) {
        console.log(
          `${L} target_placeholder handshake=${r0.handshake_id} reason=handshake_sandbox_to_host_mismatch detail=${rr}`,
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
      const ur: HostTargetUnavailableCode = 'IDENTITY_INCOMPLETE'
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
        inference_error_code: 'IDENTITY_INCOMPLETE',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=IDENTITY_INCOMPLETE detail=assertRecord_${ar.code}`)
      targets.push(finalizeItem(t))
      continue
    }

    const r = ar.record
    logInternalHostHandshakeP2pInspect(db, r)
    const epK = p2pEndpointKind(db, r.p2p_endpoint)
    const mvp = p2pEndpointMvpClass(db, r.p2p_endpoint)
    const displayName = hostComputerNameFromRow(r)
    const hostDevice = peerCoordinationDeviceId(r)?.trim() || ''
    const pcc = r.internal_peer_pairing_code ?? undefined

    if (epK === 'missing') {
      const ml = metaLocal(displayName, pcc)
      const ur: HostTargetUnavailableCode = 'MISSING_P2P_ENDPOINT'
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
        secondary_label: HR.missingP2p,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: 'MISSING_P2P_ENDPOINT',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=MISSING_P2P_ENDPOINT`)
      targets.push(finalizeItem(t))
      continue
    }

    if (mvp !== 'direct_lan' && mvp !== 'missing') {
      const ur: HostTargetUnavailableCode = 'MVP_P2P_ENDPOINT_INVALID'
      const ml = metaLocal(displayName, pcc)
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
        secondary_label: HR.mvpP2p,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'direct_unreachable',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: 'MVP_P2P_ENDPOINT_INVALID',
      }
      console.log(
        `${L} target_disabled handshake=${hid} reason=MVP_P2P_ENDPOINT_INVALID mvp_class=${mvp} p2p_endpoint_kind=${epK}`,
      )
      targets.push(finalizeItem(t))
      continue
    }

    if (!hostDevice) {
      const ml = metaLocal(displayName, pcc)
      const ur: HostTargetUnavailableCode = 'UNKNOWN'
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
        inference_error_code: 'UNKNOWN',
      }
      console.log(`${L} target_disabled handshake=${hid} reason=UNKNOWN detail=no_peer_coordination_device_id`)
      targets.push(finalizeItem(t))
      continue
    }

    console.log(`[HOST_INFERENCE_P2P] from_listInferenceTargets handshake=${hid}`)
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
          : code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE || !probe.directP2pAvailable
            ? 'HOST_DIRECT_P2P_UNREACHABLE'
            : 'CAPABILITY_PROBE_FAILED'
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
        inference_error_code: ur,
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
        inference_error_code: 'HOST_POLICY_DISABLED',
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
   * Only ACTIVE internal **Sandbox→Host** (handshake-derived, same account) can populate an empty
   * selector: checking row while the pipeline is still unable to build a more specific item.
   */
  if (targets.length === 0 && db && (mainMode === 'sandbox' || handshakeProvesSandboxToHost)) {
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
      targets.push(finalizeItem(draftCheckingPlaceholderForHostPair(r0)))
      break
    }
  }

  ensureAtLeastOneHostTargetWhenLedgerProvesSandboxToHost(
    targets,
    ledgerActive,
    handshakeProvesSandboxToHost,
    mainMode,
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
