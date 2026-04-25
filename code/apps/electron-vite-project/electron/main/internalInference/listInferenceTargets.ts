/**
 * IPC-backed list of selectable Host internal inference rows for Sandbox UIs.
 * See also: internal-inference:listTargets (same data; wire-oriented + logs).
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { isHostMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  handshakeSamePrincipal,
  peerCoordinationDeviceId,
} from './policy'
import { probeHostInferencePolicyFromSandbox } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'

const L = '[HOST_INFERENCE_TARGETS]'

export type HostTargetUnavailableCode =
  | 'HOST_DIRECT_P2P_UNAVAILABLE'
  | 'HOST_NO_ACTIVE_LOCAL_LLM'
  | 'HOST_POLICY_DISABLED'
  | 'CHECKING_CAPABILITIES'
  | 'HOST_INCOMPLETE_INTERNAL_HANDSHAKE'

export type HostInferenceListAvailability =
  | 'available'
  | 'host_offline'
  | 'direct_unreachable'
  | 'policy_disabled'
  | 'model_unavailable'
  | 'handshake_inactive'
  | 'not_configured'
  | 'identity_incomplete'

export interface HostInternalInferenceListItem {
  kind: 'host_internal'
  id: string
  label: string
  model: string
  model_id: string
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
}

const CAP_UNKNOWN = 'CAPABILITIES_UNKNOWN' as const

function buildHostTargetId(handshakeId: string, model: string): string {
  return `host-internal:${encodeURIComponent(handshakeId.trim())}:${encodeURIComponent(model.trim())}`
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

function peerNameForLog(r: HandshakeRecord): string {
  if (r.local_role === 'initiator') {
    if (r.acceptor_device_role === 'host') {
      return (r.acceptor_device_name || 'Host').trim()
    }
  }
  if (r.local_role === 'acceptor' && r.initiator_device_role === 'host') {
    return (r.initiator_device_name || 'Host').trim()
  }
  return (r.acceptor_device_name || r.initiator_device_name || '—').trim()
}

function peerRoleForLog(r: HandshakeRecord): 'host' | 'sandbox' {
  if (r.local_role === 'initiator') {
    return r.acceptor_device_role === 'host' ? 'host' : 'sandbox'
  }
  return r.initiator_device_role === 'host' ? 'host' : 'sandbox'
}

function finalizeItem(t: HostInternalInferenceListItem): HostInternalInferenceListItem {
  return {
    ...t,
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
  const mode: 'host' | 'sandbox' | 'other' = isHostMode() ? 'host' : isSandboxMode() ? 'sandbox' : 'other'
  console.log(`${L} list_begin mode=${mode}`)

  if (mode === 'host') {
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }
  if (mode !== 'sandbox') {
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }

  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    console.log(
      `${L} list_empty reason=handshake_db_unavailable (ledger or vault not available for handshake query)`,
    )
    console.log(`${L} list_done count=0`)
    return { ok: true, targets: [], refreshMeta: { hadCapabilitiesProbed: false } }
  }

  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  console.log(`${L} active_internal_count=${rows.length}`)

  let hostPairCount = 0
  for (const r0 of rows) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
    if (!handshakeSamePrincipal(r0)) continue
    if (!assertSandboxRequestToHost(r0).ok) continue
    hostPairCount += 1
  }
  console.log(`${L} active_internal_host_count=${hostPairCount}`)

  const targets: HostInternalInferenceListItem[] = []
  let hadCapabilitiesProbed = false

  for (const r0 of rows) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) {
      console.log(
        `${L} rejected handshake=${r0.handshake_id} reason=not_active_internal_row (defense — listHandshakeRecords should already filter)`,
      )
      continue
    }
    if (!handshakeSamePrincipal(r0)) {
      console.log(`${L} rejected handshake=${r0.handshake_id} reason=cross_principal_or_invalid`)
      continue
    }
    const roleGate = assertSandboxRequestToHost(r0)
    if (!roleGate.ok) {
      console.log(`${L} rejected handshake=${r0.handshake_id} reason=${roleGate.code} (not_sandbox_to_host)`)
      continue
    }

    const hid = r0.handshake_id
    const peerName = peerNameForLog(r0)
    const pr = peerRoleForLog(r0)
    const pc = r0.internal_peer_pairing_code
    const pairingDisplay = displayPairing(pc)
    console.log(
      `${L} candidate handshake=${hid} peer_role=${pr} peer_name=${JSON.stringify(peerName)} pairing=${pairingDisplay}`,
    )

    const ar = assertRecordForServiceRpc(r0)
    if (!ar.ok) {
      const ur: HostTargetUnavailableCode = 'HOST_INCOMPLETE_INTERNAL_HANDSHAKE'
      const ml = metaLocal(hostComputerNameFromRow(r0), r0.internal_peer_pairing_code ?? undefined)
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const t: HostInternalInferenceListItem = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'incomplete'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        model: '',
        model_id: '',
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: (peerCoordinationDeviceId(r0) ?? '').trim() || '',
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sec,
        secondaryLabel: sec,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'identity_incomplete',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(
        `${L} target_disabled reason=${ur} (assertRecord ${ar.code})`,
      )
      targets.push(finalizeItem(t))
      continue
    }

    const r = ar.record
    const direct = assertP2pEndpointDirect(db, r.p2p_endpoint)
    const directOk = direct.ok
    const displayName = hostComputerNameFromRow(r)
    const hostDevice = peerCoordinationDeviceId(r)?.trim() || ''
    const pcc = r.internal_peer_pairing_code ?? undefined

    if (!hostDevice) {
      const ml = metaLocal(displayName, pcc)
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const ur: HostTargetUnavailableCode = 'HOST_DIRECT_P2P_UNAVAILABLE'
      const t: HostInternalInferenceListItem = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unconfigured'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        model: '',
        model_id: '',
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: '',
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sec,
        secondaryLabel: sec,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled reason=${ur} (no_peer_device_id)`)
      targets.push(finalizeItem(t))
      continue
    }

    if (!directOk) {
      const ml = metaLocal(displayName, pcc)
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const ur: HostTargetUnavailableCode = 'HOST_DIRECT_P2P_UNAVAILABLE'
      const t: HostInternalInferenceListItem = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unreachable'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        model: '',
        model_id: '',
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sec,
        secondaryLabel: sec,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'direct_unreachable',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled reason=${ur} (relay_or_indirect_p2p)`)
      targets.push(finalizeItem(t))
      continue
    }

    console.log(`${L} capabilities_request handshake=${hid}`)
    hadCapabilitiesProbed = true
    const probe = await probeHostInferencePolicyFromSandbox(hid)
    if (!probe.ok) {
      const ml = metaLocal(displayName, pcc)
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
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const t: HostInternalInferenceListItem = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'offline'),
        label: 'Host AI unavailable',
        display_label: 'Host AI unavailable',
        model: '',
        model_id: '',
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        secondary_label: sec,
        secondaryLabel: sec,
        direct_reachable: !!probe.directP2pAvailable,
        policy_enabled: false,
        available: false,
        availability: av,
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(
        `${L} target_disabled reason=${ur} code=${String(code)} msg=${(probe as { message?: string }).message ?? ''}`,
      )
      targets.push(finalizeItem(t))
      continue
    }

    const hm = metaFromOkProbe(probe, displayName, pcc)

    if (!probe.allowSandboxInference) {
      const m = probe.defaultChatModel?.trim() || ''
      const label = probe.displayLabelFromHost?.trim() || (m ? `Host AI · ${m}` : 'Host AI')
      const sec = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const ur: HostTargetUnavailableCode = 'HOST_POLICY_DISABLED'
      const t: HostInternalInferenceListItem = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, m || '—'),
        label: 'Host AI unavailable',
        display_label: label,
        model: m,
        model_id: m,
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: sec,
        secondaryLabel: sec,
        direct_reachable: true,
        policy_enabled: false,
        available: false,
        availability: 'policy_disabled',
        unavailable_reason: ur,
        host_role: 'Host',
      }
      console.log(`${L} target_disabled reason=${ur} (host_policy_no_sandbox_inference)`)
      targets.push(finalizeItem(t))
      continue
    }

    const defaultChatModel = probe.defaultChatModel?.trim()
    if (!defaultChatModel) {
      const disp = probe.displayLabelFromHost?.trim() || 'Host AI · —'
      const sec = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      const ur: HostTargetUnavailableCode = 'HOST_NO_ACTIVE_LOCAL_LLM'
      const t: HostInternalInferenceListItem = {
        kind: 'host_internal',
        id: buildHostTargetId(hid, '—'),
        label: 'Host AI unavailable',
        display_label: disp,
        model: '',
        model_id: '',
        provider: 'host_internal',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.digits6,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        secondary_label: sec,
        secondaryLabel: sec,
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'model_unavailable',
        unavailable_reason: ur,
        host_role: 'Host',
        inference_error_code: probe.inferenceErrorCode || InternalInferenceErrorCode.MODEL_UNAVAILABLE,
      }
      console.log(`${L} target_disabled reason=${ur} (no_default_model)`)
      targets.push(finalizeItem(t))
      continue
    }

    const primaryLabel = probe.displayLabelFromHost?.trim() || `Host AI · ${defaultChatModel}`
    const secondary = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
    const t: HostInternalInferenceListItem = {
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
      secondaryLabel: secondary,
      direct_reachable: true,
      policy_enabled: true,
      available: true,
      availability: 'available',
      unavailable_reason: null,
      host_role: 'Host',
    }
    console.log(`${L} target_added model=${defaultChatModel} handshake=${hid}`)
    targets.push(finalizeItem(t))
  }

  if (targets.length === 0) {
    if (rows.length === 0) {
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
