/**
 * Host AI `ollama_direct` route — metadata and wire scaffolding only.
 * Host advertises a reachable LAN Ollama base URL; Sandbox uses that URL for listing/chat (future behavior).
 * Does not participate in P2P/BEAP/signaling/policy resolution yet.
 */

import type { InternalInferenceCapabilitiesResultWire } from './types'

/** Resolver / UX route kind when Host publishes direct LAN Ollama for Sandbox dial (future selection). */
export const HOST_AI_ROUTE_KIND_OLLAMA_DIRECT = 'ollama_direct' as const
export type HostAiRouteKindOllamaDirect = typeof HOST_AI_ROUTE_KIND_OLLAMA_DIRECT

/** Model/provider identity for Host Ollama on this route. */
export const HOST_AI_OLLAMA_PROVIDER = 'ollama' as const

/** Optional capability-wire fields carrying Host advertisement preview (no Sandbox localhost). */
export type HostAiOllamaDirectWireFields = Pick<
  InternalInferenceCapabilitiesResultWire,
  | 'ollama_direct_available'
  | 'ollama_direct_base_url'
  | 'ollama_direct_host_ip'
  | 'ollama_direct_models_count'
  | 'ollama_direct_source'
  | 'endpoint_owner_device_id'
>

export function wireIncludesOllamaDirectPreviewFields(w: Partial<HostAiOllamaDirectWireFields>): boolean {
  return (
    w.ollama_direct_available !== undefined ||
    typeof w.ollama_direct_base_url === 'string' ||
    typeof w.ollama_direct_host_ip === 'string' ||
    typeof w.ollama_direct_models_count === 'number' ||
    typeof w.ollama_direct_source === 'string' ||
    typeof w.endpoint_owner_device_id === 'string'
  )
}

export type OllamaDirectCapsSnapshotChannel = 'http' | 'p2p_dc'

/** Single log line for ollama_direct fields on a capabilities wire (HTTP merge path or DC send). */
export type LogOllamaDirectCapsSnapshotInput = {
  channel: OllamaDirectCapsSnapshotChannel
  route_kind: typeof HOST_AI_ROUTE_KIND_OLLAMA_DIRECT
  provider: typeof HOST_AI_OLLAMA_PROVIDER
  handshake_id: string | null
  session_id?: string | null
  correlation_id?: string | null
  current_device_id?: string | null
  sender_device_id?: string | null
  target_device_id?: string | null
  endpoint_owner_device_id?: string | null
  ollama_direct_available: boolean | null
  ollama_direct_base_url?: string | null
  ollama_direct_host_ip?: string | null
  ollama_direct_models_count?: number | null
  ollama_direct_source?: string | null
  legacy_models_array_length?: number | null
  inference_error_code?: string | null
}

export function logOllamaDirectCapsSnapshot(p: LogOllamaDirectCapsSnapshotInput): void {
  console.log(`[HOST_AI_OLLAMA_DIRECT_ON_CAPS] ${JSON.stringify(p)}`)
}

/** After Sandbox merges HTTP caps wire — delegates to {@link logOllamaDirectCapsSnapshot} with `channel=http`. */
export function logOllamaDirectCapsSnapshotHttpPreviewIfPresent(
  handshakeId: string,
  w: Partial<InternalInferenceCapabilitiesResultWire>,
): void {
  if (!wireIncludesOllamaDirectPreviewFields(w)) return
  logOllamaDirectCapsSnapshot({
    channel: 'http',
    route_kind: HOST_AI_ROUTE_KIND_OLLAMA_DIRECT,
    provider: HOST_AI_OLLAMA_PROVIDER,
    handshake_id: String(handshakeId ?? '').trim() || null,
    ollama_direct_available: w.ollama_direct_available ?? null,
    ollama_direct_base_url: w.ollama_direct_base_url ?? null,
    ollama_direct_host_ip: w.ollama_direct_host_ip ?? null,
    ollama_direct_models_count: w.ollama_direct_models_count ?? null,
    ollama_direct_source: w.ollama_direct_source ?? null,
    endpoint_owner_device_id: w.endpoint_owner_device_id ?? null,
  })
}
