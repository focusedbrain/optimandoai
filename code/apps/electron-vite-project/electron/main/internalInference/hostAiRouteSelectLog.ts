/**
 * [HOST_AI_ROUTE_SELECT] — Sandbox Host AI route priority + diagnostics (capabilities / transport).
 */

import { InternalInferenceErrorCode } from './errors'
import type { HostAiTransportDeciderResult } from './transport/decideInternalInferenceTransport'

export type HostAiRouteSelectKind = 'ollama_direct' | 'webrtc' | 'relay' | 'direct_http' | 'none'

export function logHostAiRouteSelect(p: {
  handshake_id: string
  local_device_id: string
  peer_device_id: string
  local_role: 'sandbox' | 'host' | 'unknown'
  peer_role: 'sandbox' | 'host' | 'unknown'
  webrtc_available: boolean
  relay_available: boolean
  /** Verified sandbox→Host peer-attested direct BEAP (not syntactic ledger URL / canPost alone). */
  direct_http_available: boolean
  selected_route_kind: HostAiRouteSelectKind
  /** Where the winning route’s traffic or listing authority comes from (e.g. DC vs verified HTTP vs LAN Ollama). */
  selected_endpoint_source: string | null
  /** Host-advertised `ollama_direct` preview when known from caps wire / validation. */
  ollama_direct_available?: boolean | null
  ollama_direct_base_url?: string | null
  /** Resolver/trust indicates peer-Host BEAP missing — ignored when `selected_route_kind === 'ollama_direct'`. */
  beap_missing?: boolean
  /** Legacy caps wire policy flag — must not override tier-1 `ollama_direct` classification. */
  policy_enabled?: boolean | null
  /** Resolved UX/listing classification for this handshake pass. */
  final_classification?: string | null
  /** Primary routing rationale / tier token. */
  reason?: string | null
  failure_reason?: string | null
  route_resolve_code?: string | null
  route_resolve_reason?: string | null
}): void {
  console.log(`[HOST_AI_ROUTE_SELECT] ${JSON.stringify(p)}`)
}

export function computeBeapMissingForHostAiRouteSelect(dec: HostAiTransportDeciderResult | null): boolean {
  if (!dec) return false
  if (dec.hostAiRouteResolveFailureCode === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING) return true
  if (dec.inferenceHandshakeTrustReason === 'peer_host_endpoint_missing') return true
  return false
}
