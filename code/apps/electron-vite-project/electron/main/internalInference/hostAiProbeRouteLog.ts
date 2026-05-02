/**
 * [HOST_AI_PROBE_ROUTE] — resolver snapshot before Host AI HTTP/DC probes (no BEAP path changes).
 */

export type HostAiProbeRouteLogPayload = {
  handshake_id: string
  selected_route_kind: 'webrtc_dc' | 'direct_http' | 'relay_tunnel' | 'none'
  selected_endpoint_source: string
  /** Layer-2 resolver: whether the peer BEAP URL came from the in-memory map or a ledger fallback. */
  peer_ad_source: 'memory_map' | 'ledger_fallback' | 'none'
  endpoint_owner_device_id: string | null
  local_device_id: string
  peer_host_device_id: string
  decision: 'allow' | 'deny'
  reason: string
}

export function logHostAiProbeRoute(p: HostAiProbeRouteLogPayload): void {
  console.log(`[HOST_AI_PROBE_ROUTE] ${JSON.stringify(p)}`)
}
