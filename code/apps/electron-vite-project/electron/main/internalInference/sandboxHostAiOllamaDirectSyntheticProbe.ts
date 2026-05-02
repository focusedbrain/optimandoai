/**
 * Synthetic Host AI policy probe derived from LAN `ollama_direct` `/api/tags` when WebRTC caps / HTTP policy probe should be skipped.
 */

import type { HandshakeRecord } from '../handshake/types'
import type { ProbeHostPolicyResult } from './sandboxHostUi'
import { InternalInferenceErrorCode } from './errors'
import type { SandboxOllamaDirectTagsFetchResult } from './sandboxHostAiOllamaDirectTags'
import type { HostAiPeerAdvertisedOllamaRoster } from './p2pEndpointRepair'

export function hostComputerNameFromHandshakeRecord(r: HandshakeRecord): string {
  if (r.local_role === 'initiator') {
    if (r.initiator_device_role === 'host') {
      return (r.initiator_device_name?.trim() || 'This computer (Host)').trim()
    }
    return (r.acceptor_device_name?.trim() || 'Host').trim()
  }
  if (r.acceptor_device_role === 'host') {
    return (r.acceptor_device_name?.trim() || 'This computer (Host)').trim()
  }
  return (r.initiator_device_name?.trim() || 'Host').trim()
}

function displayPairingFromDigits6(pairing6: string | null | undefined): string {
  const s = (pairing6 ?? '').replace(/\D/g, '')
  if (s.length === 6) return `${s.slice(0, 3)}-${s.slice(3)}`
  return s ? s : '—'
}

export function buildSyntheticOkProbeFromOllamaDirectTags(
  tags: SandboxOllamaDirectTagsFetchResult,
  meta: {
    hostComputerName: string
    pairingDigits?: string
    /** From relay BEAP `host_ai_route.capabilities` — Host active model (not Ollama /api/tags order). */
    peerAdvertisedOllamaRoster?: HostAiPeerAdvertisedOllamaRoster | null
  },
): Extract<ProbeHostPolicyResult, { ok: true }> {
  const hn = meta.hostComputerName.trim() || 'Host'
  const d6 = String(meta.pairingDigits ?? '').replace(/\D/g, '').slice(0, 6)
  const disp = displayPairingFromDigits6(d6 || meta.pairingDigits)
  const cls = tags.classification

  const base = {
    ok: true as const,
    allowSandboxInference: true,
    hostComputerNameFromHost: hn,
    providerFromHost: 'ollama' as const,
    hostOrchestratorRoleLabelFromHost: 'Host orchestrator',
    internalIdentifier6FromHost: d6,
    internalIdentifierDisplayFromHost: disp,
    directP2pPath: true,
    policyEnabledFromHost: true,
  }

  if (cls === 'available' && tags.models_count > 0) {
    const tagNames = tags.models.map((m) => String(m.model ?? '').trim()).filter(Boolean)
    const advActive = meta.peerAdvertisedOllamaRoster?.active_model_id?.trim() || null
    let chosen = tagNames[0] ?? ''
    let hostDefaultModelSource: 'peer_relay_active_model' | 'ollama_tags_primary_order' = 'ollama_tags_primary_order'
    let hostOllamaSyntheticFallbackUsed = !advActive
    if (advActive && tagNames.includes(advActive)) {
      chosen = advActive
      hostDefaultModelSource = 'peer_relay_active_model'
      hostOllamaSyntheticFallbackUsed = false
    } else if (advActive && !tagNames.includes(advActive)) {
      chosen = tagNames[0] ?? ''
      hostDefaultModelSource = 'ollama_tags_primary_order'
      hostOllamaSyntheticFallbackUsed = true
    }
    return {
      ...base,
      defaultChatModel: chosen,
      modelId: chosen,
      displayLabelFromHost: chosen ? `Host AI · ${chosen}` : 'Host AI · —',
      inferenceErrorCode: undefined,
      hostDefaultModelSource,
      hostOllamaSyntheticFallbackUsed,
    }
  }

  if (cls === 'no_models') {
    return {
      ...base,
      defaultChatModel: undefined,
      modelId: null,
      displayLabelFromHost: 'Host AI · —',
      inferenceErrorCode: InternalInferenceErrorCode.PROBE_NO_MODELS,
      terminalNoModel: true,
    }
  }

  if (cls === 'transport_unavailable') {
    return {
      ...base,
      defaultChatModel: undefined,
      modelId: null,
      displayLabelFromHost: 'Host AI · —',
      inferenceErrorCode: InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE,
    }
  }

  return {
    ...base,
    defaultChatModel: undefined,
    modelId: null,
    displayLabelFromHost: 'Host AI · —',
    inferenceErrorCode: InternalInferenceErrorCode.PROBE_INVALID_RESPONSE,
  }
}
