import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'

/**
 * One-line structured log before outbound Host AI direct HTTP capability probe.
 */
export function logHostAiEndpointSelect(p: {
  handshake_id: string
  current_device_id: string
  local_derived_role: 'sandbox' | 'host' | 'unknown'
  peer_device_id: string
  peer_derived_role: 'sandbox' | 'host' | 'unknown'
  selected_endpoint: string
  endpoint_owner_device_id: string
  endpoint_owner_role: 'host' | 'sandbox' | 'unknown'
  decision: 'probe' | 'deny' | 'skip'
  reason?: string
}): void {
  const mode = getOrchestratorMode().mode
  const line = {
    ...p,
    configured_mode: mode,
  }
  try {
    console.log(`HOST_AI_ENDPOINT_SELECT: ${JSON.stringify(line)}`)
  } catch {
    /* no-op */
  }
}
