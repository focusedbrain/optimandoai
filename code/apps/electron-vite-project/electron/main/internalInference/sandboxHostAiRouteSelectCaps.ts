/**
 * Sandbox Host AI route selection after Host capabilities wire — priority: ollama_direct → WebRTC DC → verified HTTP.
 */

import { fetchSandboxOllamaDirectTags } from './sandboxHostAiOllamaDirectTags'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import type { InternalInferenceCapabilitiesResultWire } from './types'
import type { HostAiTransportDeciderResult } from './transport/decideInternalInferenceTransport'
import {
  computeBeapMissingForHostAiRouteSelect,
  logHostAiRouteSelect,
  type HostAiRouteSelectKind,
} from './hostAiRouteSelectLog'

/**
 * Emit `[HOST_AI_ROUTE_SELECT]` after Sandbox receives caps wire and evaluates `ollama_direct` + `/api/tags` (cached).
 *
 * Priority: (1) valid `ollama_direct` + remote `/api/tags` success (`available` / `no_models`) → **ollama_direct**;
 * (2) caps transport WebRTC DC; (3) verified HTTP BEAP ingest; (4) unavailable.
 *
 * When tier 1 wins, {@link InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING} does not apply to this route selection.
 */
export async function logHostAiRouteSelectAfterSandboxCapabilitiesWire(p: {
  handshake_id: string
  local_device_id: string
  peer_device_id: string
  local_role: 'sandbox' | 'host' | 'unknown'
  peer_role: 'sandbox' | 'host' | 'unknown'
  relay_available: boolean
  webrtc_available: boolean
  direct_http_available: boolean
  dec: HostAiTransportDeciderResult | null
  caps_transport: 'webrtc_dc' | 'http_direct'
  wire: InternalInferenceCapabilitiesResultWire
}): Promise<void> {
  const hid = p.handshake_id.trim()
  const odCand = getSandboxOllamaDirectRouteCandidate(hid)
  let odTags: Awaited<ReturnType<typeof fetchSandboxOllamaDirectTags>> | null = null
  if (odCand) {
    odTags = await fetchSandboxOllamaDirectTags({
      handshakeId: hid,
      currentDeviceId: p.local_device_id,
      peerHostDeviceId: p.peer_device_id,
      candidate: odCand,
    })
  }

  const beapMissing = computeBeapMissingForHostAiRouteSelect(p.dec)

  const odBaseUrl =
    (typeof p.wire.ollama_direct_base_url === 'string' ? p.wire.ollama_direct_base_url.trim() : '') ||
    odCand?.base_url ||
    null

  const odAvailWire = p.wire.ollama_direct_available === true
  const odAdvertisedOk =
    odAvailWire ||
    Boolean(odCand) ||
    (typeof odBaseUrl === 'string' && odBaseUrl.length > 0)

  const tier1Locked =
    odCand &&
    odTags &&
    (odTags.classification === 'available' || odTags.classification === 'no_models')

  /** When tier-1 LAN tags succeed, legacy `policy_enabled: false` on the caps wire must not imply an explicit Host deny. */
  const policyEnabledForLog: boolean | null =
    tier1Locked && p.wire.policy_enabled === false
      ? null
      : p.wire.policy_enabled === true
        ? true
        : false

  let selected_route_kind: HostAiRouteSelectKind = 'none'
  let selected_endpoint_source: string | null = null
  let final_classification = 'unavailable'
  let reason = 'none'

  if (tier1Locked && odTags) {
    selected_route_kind = 'ollama_direct'
    selected_endpoint_source = 'ollama_direct_remote_tags'
    if (odTags.classification === 'available' && odTags.models_count > 0) {
      final_classification = 'available'
      reason = 'tier1_ollama_direct_remote_tags_models'
    } else {
      final_classification = 'no_models'
      reason = 'tier1_ollama_direct_remote_tags_empty'
    }
  } else if (p.caps_transport === 'webrtc_dc') {
    selected_route_kind = p.relay_available ? 'relay' : 'webrtc'
    selected_endpoint_source = 'webrtc_data_channel'
    final_classification = 'webrtc_caps_transport'
    reason =
      odCand && odTags?.classification === 'transport_unavailable'
        ? 'tier2_webrtc_caps_after_ollama_tags_unreachable'
        : odCand && odTags?.classification === 'unavailable_invalid_advertisement'
          ? 'tier2_webrtc_caps_after_ollama_tags_invalid_body'
          : 'tier2_webrtc_caps'
  } else {
    selected_route_kind = 'direct_http'
    selected_endpoint_source = 'verified_beap_http_ingest'
    final_classification = 'http_caps_transport'
    reason =
      odCand && odTags?.classification === 'transport_unavailable'
        ? 'tier3_http_caps_after_ollama_tags_unreachable'
        : 'tier3_http_caps'
  }

  const ollama_direct_available =
    odAdvertisedOk &&
    Boolean(
      odAvailWire ||
        (odTags?.classification === 'available' || odTags?.classification === 'no_models'),
    )

  logHostAiRouteSelect({
    handshake_id: hid,
    local_device_id: p.local_device_id,
    peer_device_id: p.peer_device_id,
    local_role: p.local_role,
    peer_role: p.peer_role,
    webrtc_available: p.webrtc_available,
    relay_available: p.relay_available,
    direct_http_available: p.direct_http_available,
    selected_route_kind,
    selected_endpoint_source,
    ollama_direct_available,
    ollama_direct_base_url: odBaseUrl,
    beap_missing: tier1Locked ? false : beapMissing,
    policy_enabled: policyEnabledForLog,
    final_classification,
    reason,
    failure_reason: null,
    route_resolve_code: p.direct_http_available ? null : p.dec?.hostAiRouteResolveFailureCode ?? null,
    route_resolve_reason: p.direct_http_available ? null : p.dec?.hostAiRouteResolveFailureReason ?? null,
  })
}
