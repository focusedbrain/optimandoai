/**
 * Unified pairing-role gate log for Host AI (inference RPC over BEAP/HTTP + caps over DC).
 * `sender_device_id` / `receiver_device_id` are coordination ids (requester / host side), same semantics as caps frames.
 */
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'

export type HostAiPairingRoleGateInput = {
  gate: 'inference_rpc' | 'caps_rpc'
  handshake_id: string
  request_type: string
  current_device_id: string
  sender_device_id: string
  receiver_device_id: string
  local_derived_role: 'host' | 'sandbox' | 'unknown' | null
  peer_derived_role: 'host' | 'sandbox' | 'unknown' | null
  receiver_role: 'host' | 'sandbox' | 'unknown' | null
  requester_role: 'host' | 'sandbox' | 'unknown' | null
  /** Persisted orchestrator file mode — hint only; never a sole source of allow/deny. */
  orchestrator_mode_hint?: string
  decision: 'allow' | 'deny'
  reason: string
}

export function logHostAiPairingRoleGate(p: HostAiPairingRoleGateInput): void {
  let cfg: string
  try {
    cfg = getOrchestratorMode().mode
  } catch {
    cfg = 'unknown'
  }
  const line = {
    ...p,
    orchestrator_mode_hint:
      p.orchestrator_mode_hint !== undefined && p.orchestrator_mode_hint !== '' ? p.orchestrator_mode_hint : cfg,
  }
  try {
    console.log(`[HOST_AI_PAIRING_ROLE_GATE] ${JSON.stringify(line)}`)
  } catch {
    console.log(
      `[HOST_AI_PAIRING_ROLE_GATE] decision=${p.decision} reason=${p.reason} handshake_id=${p.handshake_id} gate=${p.gate} request_type=${p.request_type}`,
    )
  }
}
