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

/** Dev-facing preview when Host begins populating `ollama_direct_*` on caps wire (behavior still default paths). */
export function logHostAiOllamaDirectCapabilitiesWireHint(
  handshakeId: string,
  w: Partial<InternalInferenceCapabilitiesResultWire>,
): void {
  if (!wireIncludesOllamaDirectPreviewFields(w)) return
  console.log(
    `[HOST_AI_OLLAMA_DIRECT_WIRE] ${JSON.stringify({
      route_kind: HOST_AI_ROUTE_KIND_OLLAMA_DIRECT,
      provider: HOST_AI_OLLAMA_PROVIDER,
      handshake_id: String(handshakeId ?? '').trim() || null,
      ollama_direct_available: w.ollama_direct_available ?? null,
      ollama_direct_base_url: w.ollama_direct_base_url ?? null,
      ollama_direct_host_ip: w.ollama_direct_host_ip ?? null,
      ollama_direct_models_count: w.ollama_direct_models_count ?? null,
      ollama_direct_source: w.ollama_direct_source ?? null,
      endpoint_owner_device_id: w.endpoint_owner_device_id ?? null,
    })}`,
  )
}
