/**
 * Structured audit log for Sandbox Host AI list refresh / probe bypass decisions (ollama_direct lane).
 */

export type SbxHostAiRefreshDecisionPayload = {
  handshake_id: string
  route_kind: 'ollama_direct' | 'webrtc_p2p' | 'http_policy' | 'cooldown_429'
  reason: string
  caps_cache_hit: boolean
  ollama_tags_cache_hit: boolean
  will_request_caps: boolean
  will_request_ollama_tags: boolean
  will_probe_policy: boolean
  final_action: string
}

export function logSbxHostAiRefreshDecision(p: SbxHostAiRefreshDecisionPayload): void {
  console.log(`[SBX_HOST_AI_REFRESH_DECISION] ${JSON.stringify(p)}`)
}
