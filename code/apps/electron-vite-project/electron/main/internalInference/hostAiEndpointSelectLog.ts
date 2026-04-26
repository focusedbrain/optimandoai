import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'

/**
 * One-line structured log before outbound Host AI direct HTTP capability probe.
 * `endpoint_owner_*` reflect coordination ids for the **Host** side of the S→H pair, not the URL socket owner;
 * `selected_endpoint_source` and `local_beap_endpoint` are the **provenance** for where the URL came from.
 */
export function logHostAiEndpointSelect(p: {
  handshake_id: string
  current_device_id: string
  local_derived_role: 'sandbox' | 'host' | 'unknown'
  peer_device_id: string
  peer_derived_role: 'sandbox' | 'host' | 'unknown'
  selected_endpoint: string
  selected_endpoint_source?: 'peer_advertised_header' | 'internal_handshake_ledger' | 'none'
  selected_endpoint_record_device_id?: string
  selected_endpoint_record_role?: 'host' | 'unknown'
  local_beap_endpoint?: string | null
  peer_advertised_beap_endpoint?: string | null
  repaired_from_local_endpoint?: boolean
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
