/**
 * IPC-backed list of selectable Host internal inference rows for Sandbox UIs.
 * See also: internal-inference:listTargets (same data; logged + wire-oriented fields).
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { isHostMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { assertP2pEndpointDirect, assertRecordForServiceRpc, assertSandboxRequestToHost, peerCoordinationDeviceId } from './policy'
import { probeHostInferencePolicyFromSandbox } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'

const L = '[HOST_INFERENCE_TARGETS]'
const CAP_UNKNOWN = 'CAPABILITIES_UNKNOWN' as const

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
  /**
   * Logical provider for the selector: Host-routed AI (not local Sandbox Ollama).
   * Legacy rows may have used 'ollama' for the runtime on the Host; prefer 'host_internal'.
   */
  provider: 'host_internal' | 'ollama' | ''
  handshake_id: string
  /** For routing; not intended for end-user display (avoid in compact UI). */
  host_device_id: string
  host_computer_name: string
  /** 6 decimal digits, no dash (e.g. "123456"). */
  host_pairing_code?: string
  host_orchestrator_role: 'host'
  host_orchestrator_role_label: string
  /** Raw 6 digits when known (internal handshake identifier). */
  internal_identifier_6: string
  /** One human-readable line: "<host> — Host orchestrator · ID 123-456" (no raw device UUID in normal copy). */
  secondary_label: string
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

/**
 * Returns Host AI targets for Sandbox with internal active Host handshakes (same rules as
 * listSandboxHostInferenceCandidates) plus per-row availability and model from Host policy.
 */
export async function listSandboxHostInternalInferenceTargets(): Promise<{
  ok: true
  targets: HostInternalInferenceListItem[]
}> {
  console.log(`${L} list_begin`)
  if (!isSandboxMode()) {
    if (isHostMode()) {
      console.log(`${L} list_empty reason=host_orchestrator (Host machine — no Host AI entries in this list)`)
    } else {
      console.log(`${L} list_empty reason=orchestrator_mode_not_sandbox (mode unset or not Sandbox)`)
    }
    console.log(`${L} list_done 0`)
    return { ok: true, targets: [] }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    console.log(`${L} list_empty reason=handshake_db_unavailable (ledger or vault DB not open — cannot read handshake table)`)
    console.log(`${L} list_done 0`)
    return { ok: true, targets: [] }
  }
  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  console.log(`${L} active_internal_host_handshakes ${rows.length}`)

  const targets: HostInternalInferenceListItem[] = []
  let skippedIneligible = 0

  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) {
      skippedIneligible += 1
      continue
    }
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      skippedIneligible += 1
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
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unconfigured'),
        label: 'Host AI',
        display_label: 'Host AI',
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
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'not_configured',
        unavailable_reason: sec,
        host_role: 'Host',
      })
      console.log(`${L} target_added (unconfigured) - ${ml.hostName}`)
      continue
    }

    if (!directOk) {
      const ml = metaLocal(displayName, pc)
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      const reachCopy = 'Host not directly reachable'
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'unreachable'),
        label: 'Host AI',
        display_label: 'Host AI',
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
        direct_reachable: false,
        policy_enabled: false,
        available: false,
        availability: 'direct_unreachable',
        unavailable_reason: `${reachCopy} — ${sec}`,
        host_role: 'Host',
      })
      console.log(`${L} target_added (no_direct_endpoint) - ${ml.hostName}`)
      continue
    }

    console.log(`${L} capabilities_request ${hid}`)
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
      const sec = secondaryLabelFromMeta(ml.hostName, ml.roleLabel, ml.pairingDisplay)
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, 'offline'),
        label: 'Host AI',
        display_label: 'Host AI',
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
        direct_reachable: !!probe.directP2pAvailable,
        policy_enabled: false,
        available: false,
        availability: av,
        unavailable_reason: CAP_UNKNOWN,
        host_role: 'Host',
      })
      console.log(
        `${L} target_added (probe_not_ok) model=- host=${ml.hostName} code=${String(code ?? 'n/a')} directP2p=${String(probe.directP2pAvailable)} msg=${(probe as { message?: string }).message ?? ''}`,
      )
      continue
    }

    const hm = metaFromOkProbe(probe, displayName, pc)

    if (!probe.allowSandboxInference) {
      const m = probe.defaultChatModel?.trim() || ''
      const label = probe.displayLabelFromHost?.trim() || (m ? `Host AI · ${m}` : 'Host AI')
      const sec = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, m || '—'),
        label,
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
        direct_reachable: true,
        policy_enabled: false,
        available: false,
        availability: 'policy_disabled',
        unavailable_reason: sec,
        host_role: 'Host',
      })
      console.log(`${L} target_added ${m || 'policy-off'} ${hm.hostName}`)
      continue
    }

    const defaultChatModel = probe.defaultChatModel?.trim()
    if (!defaultChatModel) {
      const disp = probe.displayLabelFromHost?.trim() || 'Host AI · —'
      const sec = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
      targets.push({
        kind: 'host_internal',
        id: buildHostTargetId(hid, '—'),
        label: disp,
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
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'model_unavailable',
        unavailable_reason: sec,
        host_role: 'Host',
        inference_error_code: probe.inferenceErrorCode || InternalInferenceErrorCode.MODEL_UNAVAILABLE,
      })
      console.log(`${L} target_added (no_default_model) - ${hm.hostName}`)
      continue
    }

    const primaryLabel = probe.displayLabelFromHost?.trim() || `Host AI · ${defaultChatModel}`
    const secondary = secondaryLabelFromMeta(hm.hostName, hm.roleLabel, hm.pairingDisplay)
    targets.push({
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
      unavailable_reason: secondary,
      host_role: 'Host',
    })
    console.log(`${L} target_added ${defaultChatModel} ${hm.hostName}`)
  }

  if (targets.length === 0) {
    if (rows.length === 0) {
      console.log(`${L} list_empty reason=no_active_internal_rows_in_ledger (query state=ACTIVE handshake_type=internal)`)
    } else if (skippedIneligible > 0 && skippedIneligible === rows.length) {
      console.log(
        `${L} list_empty reason=all_rows_failed_record_or_sandbox_to_host_gate skipped=${skippedIneligible} (not same-principal, wrong role, or non-internal)`,
      )
    } else {
      console.log(
        `${L} list_empty reason=no_target_rows_built (ledger_rows=${rows.length} skipped_ineligible=${skippedIneligible} — all branches exhausted without adding a target)`,
      )
    }
  }
  console.log(`${L} list_done ${targets.length}`)

  return { ok: true, targets }
}
