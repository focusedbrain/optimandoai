/**
 * IPC-backed list of selectable Host internal inference rows for Sandbox UIs.
 */

import { listHandshakeRecords } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { assertP2pEndpointDirect, assertRecordForServiceRpc, assertSandboxRequestToHost, peerCoordinationDeviceId } from './policy'
import { probeHostInferencePolicyFromSandbox } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'

export type HostInferenceListAvailability =
  | 'available'
  | 'host_offline'
  | 'direct_unreachable'
  | 'policy_disabled'
  | 'model_unavailable'
  | 'handshake_inactive'
  | 'not_configured'

export interface HostInternalInferenceListItem {
  kind: 'host_internal'
  id: string
  label: string
  model: string
  /** Ollama model id (name); empty when none. */
  model_id: string
  /** Selector / primary line (mirrors `label` for fresh Host GET metadata when present). */
  display_label: string
  /** Inference runtime is Ollama on the Host. */
  provider: 'ollama' | ''
  handshake_id: string
  host_device_id: string
  host_computer_name: string
  host_pairing_code?: string
  host_orchestrator_role: 'host'
  host_orchestrator_role_label: string
  /** Raw 6 digits when known (internal handshake identifier). */
  internal_identifier_6: string
  direct_reachable: boolean
  policy_enabled: boolean
  available: boolean
  availability: HostInferenceListAvailability
  unavailable_reason?: string
  host_role: 'Host'
  /** When `availability` is `model_unavailable` and Host reported no resolvable model. */
  inference_error_code?: string
}

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

/** Prefer live fields from Host GET /beap/internal-inference-policy when `probe.ok`. */
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
    roleLabel: (probe.hostOrchestratorRoleLabelFromHost?.trim() || 'Host orchestrator') as const,
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

/**
 * Returns Host AI targets for Sandbox with internal active Host handshakes (same rules as
 * listSandboxHostInferenceCandidates) plus per-row availability and model from Host policy.
 */
export async function listSandboxHostInternalInferenceTargets(): Promise<{
  ok: true
  targets: HostInternalInferenceListItem[]
}> {
  if (!isSandboxMode()) {
    return { ok: true, targets: [] }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: true, targets: [] }
  }
  const rows = listHandshakeRecords(db, { state: 'ACTIVE', handshake_type: 'internal' })
  const targets: HostInternalInferenceListItem[] = []

  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) {
      continue
    }
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      continue
    }
    const rec = ar.record
    const direct = assertP2pEndpointDirect(db, rec.p2p_endpoint)
    const directOk = direct.ok
    const hid = rec.handshake_id
    const displayName = hostComputerNameFromRow(rec)
    const hostDevice = peerCoordinationDeviceId(rec)?.trim() || ''
    const pc = rec.internal_peer_pairing_code ?? undefined
    if (!hostDevice) {
      const ml = metaLocal(displayName, pc)
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unconfigured'),
        label: 'Host AI',
        display_label: 'Host AI',
        model: '',
        model_id: '',
        provider: '',
        handshake_id: hid,
        host_device_id: '',
        host_computer_name: ml.hostName,
        host_pairing_code: ml.pairingDisplay,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: `${ml.hostName} — ${ml.roleLabel} · ID ${ml.pairingDisplay}`,
        host_role: 'Host',
      })
      continue
    }

    if (!directOk) {
      const ml = metaLocal(displayName, pc)
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unreachable'),
        label: 'Host AI',
        display_label: 'Host AI',
        model: '',
        model_id: '',
        provider: '',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.pairingDisplay,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'direct_unreachable',
        unavailable_reason: `${ml.hostName} — ${ml.roleLabel} · ID ${ml.pairingDisplay}`,
        host_role: 'Host',
      })
      continue
    }

    const probe = await probeHostInferencePolicyFromSandbox(hid)
    if (!probe.ok) {
      const ml = metaLocal(displayName, pc)
      const code = probe.code
      let av: HostInferenceListAvailability = 'host_offline'
      if (code === InternalInferenceErrorCode.POLICY_FORBIDDEN) {
        av = 'policy_disabled'
      } else if (code === InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE || !probe.directP2pAvailable) {
        av = 'direct_unreachable'
      }
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'offline'),
        label: 'Host AI',
        display_label: 'Host AI',
        model: '',
        model_id: '',
        provider: '',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: ml.hostName,
        host_pairing_code: ml.pairingDisplay,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: ml.roleLabel,
        internal_identifier_6: ml.digits6,
        direct_reachable: !!probe.directP2pAvailable,
        policy_enabled: false,
        available: false,
        availability: av,
        unavailable_reason: `${ml.hostName} — ${ml.roleLabel} · ID ${ml.pairingDisplay}`,
        host_role: 'Host',
      })
      continue
    }

    const hm = metaFromOkProbe(probe, displayName, pc)

    if (!probe.allowSandboxInference) {
      const m = probe.defaultChatModel?.trim() || ''
      const label = probe.displayLabelFromHost?.trim() || (m ? `Host AI · ${m}` : 'Host AI')
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, m || '—'),
        label,
        display_label: label,
        model: m,
        model_id: m,
        provider: 'ollama',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.pairingDisplay,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        direct_reachable: true,
        policy_enabled: false,
        available: false,
        availability: 'policy_disabled',
        unavailable_reason: `${hm.hostName} — ${hm.roleLabel} · ID ${hm.pairingDisplay}`,
        host_role: 'Host',
      })
      continue
    }

    const defaultChatModel = probe.defaultChatModel?.trim()
    if (!defaultChatModel) {
      const disp = probe.displayLabelFromHost?.trim() || 'Host AI · —'
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, '—'),
        label: disp,
        display_label: disp,
        model: '',
        model_id: '',
        provider: 'ollama',
        handshake_id: hid,
        host_device_id: hostDevice,
        host_computer_name: hm.hostName,
        host_pairing_code: hm.pairingDisplay,
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: hm.roleLabel,
        internal_identifier_6: hm.digits6,
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'model_unavailable',
        unavailable_reason: `${hm.hostName} — ${hm.roleLabel} · ID ${hm.pairingDisplay}`,
        host_role: 'Host',
        inference_error_code: probe.inferenceErrorCode || InternalInferenceErrorCode.MODEL_UNAVAILABLE,
      })
      continue
    }

    const primaryLabel = probe.displayLabelFromHost?.trim() || `Host AI · ${defaultChatModel}`
    const secondary = `${hm.hostName} — ${hm.roleLabel} · ID ${hm.pairingDisplay}`
    targets.push({
      kind: 'host_internal',
      id: buildHostTargetId(hid, defaultChatModel),
      label: primaryLabel,
      display_label: primaryLabel,
      model: defaultChatModel,
      model_id: defaultChatModel,
      provider: 'ollama',
      handshake_id: hid,
      host_device_id: hostDevice,
      host_computer_name: hm.hostName,
      host_pairing_code: hm.pairingDisplay,
      host_orchestrator_role: 'host',
      host_orchestrator_role_label: hm.roleLabel,
      internal_identifier_6: hm.digits6,
      direct_reachable: true,
      policy_enabled: true,
      available: true,
      availability: 'available',
      unavailable_reason: secondary,
      host_role: 'Host',
    })
  }

  return { ok: true, targets }
}
