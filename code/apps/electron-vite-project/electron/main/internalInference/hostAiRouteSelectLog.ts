/**
 * [HOST_AI_ROUTE_SELECT] — one line per route decision in `listHostCapabilities` (no BEAP body auth changes).
 */
export function logHostAiRouteSelect(p: {
  handshake_id: string
  local_device_id: string
  peer_device_id: string
  local_role: 'sandbox' | 'host' | 'unknown'
  peer_role: 'sandbox' | 'host' | 'unknown'
  webrtc_available: boolean
  relay_available: boolean
  direct_http_available: boolean
  /** Best-effort label: webrtc | relay | direct_http | none */
  selected_route_kind: 'webrtc' | 'relay' | 'direct_http' | 'none'
  failure_reason: string | null
}): void {
  console.log(`[HOST_AI_ROUTE_SELECT] ${JSON.stringify(p)}`)
}
