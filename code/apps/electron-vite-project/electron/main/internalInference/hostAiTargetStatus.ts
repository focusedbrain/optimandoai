/**
 * Sandbox Host AI list row readiness — distinguishes raw LAN Ollama reachability (`ollama_direct` /tags)
 * from BEAP-ingest-backed top-chat readiness (trusted peer-Host BEAP advertisement + transport).
 */

export type HostAiTargetStatus =
  | 'beap_ready'
  | 'ollama_direct_only'
  | 'handshake_active_but_endpoint_missing'
  | 'untrusted'
  | 'offline'
