/**
 * Structured diagnostics for Host AI inbound role validation (not BEAP auth; receiver-side handshake only).
 */
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'

export type HostAiRoleGateLogInput = {
  handshake_id: string
  request_type: string
  current_device_id: string
  endpoint_owner_device_id: string
  requester_device_id: string
  local_derived_role: 'host' | 'sandbox' | 'unknown' | null
  peer_derived_role: 'host' | 'sandbox' | 'unknown' | null
  receiver_role: 'host' | 'sandbox' | 'unknown' | null
  requester_role: 'host' | 'sandbox' | 'unknown' | null
  /** Hint only — never a sole source of allow/deny. */
  configured_mode: string
  decision: 'allow' | 'deny'
  reason: string
}

/**
 * One JSON line for grep; do not use as security telemetry without redaction of ids.
 */
export function logHostAiRoleGate(p: HostAiRoleGateLogInput): void {
  let cfg: string
  try {
    cfg = getOrchestratorMode().mode
  } catch {
    cfg = 'unknown'
  }
  const line = {
    ...p,
    configured_mode: p.configured_mode || cfg,
  }
  try {
    console.log(`[HOST_AI_ROLE_GATE] ${JSON.stringify(line)}`)
  } catch {
    console.log(
      `[HOST_AI_ROLE_GATE] decision=${p.decision} reason=${p.reason} handshake_id=${p.handshake_id} request_type=${p.request_type}`,
    )
  }
}
