/**
 * One-line structured log for Host AI capability P2P role checks (ledger-authoritative; not configured_mode).
 */

export function logHostAiCapsRoleGate(p: {
  handshake_id: string
  request_type: 'internal_inference_capabilities_request'
  current_device_id: string
  sender_device_id: string
  receiver_device_id: string
  local_derived_role: 'host' | 'sandbox' | 'unknown' | null
  peer_derived_role: 'host' | 'sandbox' | 'unknown' | null
  requester_role: 'host' | 'sandbox' | 'unknown' | null
  receiver_role: 'host' | 'sandbox' | 'unknown' | null
  decision: 'allow' | 'deny'
  reason: string
}): void {
  console.log(`[HOST_AI_CAPS_ROLE_GATE] ${JSON.stringify(p)}`)
}
