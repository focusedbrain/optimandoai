/**
 * Public transport kinds for internal Host ↔ Sandbox AI (inference service RPC), not BEAP relay.
 */

export type HostAiTransport = 'http_direct' | 'webrtc_p2p' | 'unavailable'

export type HostAiTransportPreference = 'p2p' | 'http'

/** Stable reason tokens for [HOST_AI_TRANSPORT] logs. */
export type HostAiTransportLogReason =
  | 'http_default'
  | 'p2p_chosen'
  | 'p2p_not_implemented'
  | 'p2p_not_ready_fallback_http'
  | 'p2p_not_ready_no_fallback'
  | 'p2p_await_data_channel'
  | 'non_direct_endpoint'
  | 'missing_coordination_ids'
  | 'http_direct'
  | 'p2p_not_wired'
  | 'p2p_dc_error_fallback_http'

export type HostAiTransportIntent = 'capabilities' | 'request' | 'result'
