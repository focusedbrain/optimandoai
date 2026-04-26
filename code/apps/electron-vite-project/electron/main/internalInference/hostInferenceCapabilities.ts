/**
 * Host: build `internal_inference_capabilities_result` (metadata only — no prompts, no user files).
 * Active local LLM is **only** from `ollamaManager.getEffectiveChatModelName()` (uses `activeOllamaModelStore` + /api/tags).
 * No second path that might disagree with Backend Config / WR Chat.
 */

import type { HandshakeRecord } from '../handshake/types'
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { ollamaManager } from '../llm/ollama-manager'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { InternalInferenceErrorCode } from './errors'
import { localCoordinationDeviceId, peerCoordinationDeviceId } from './policy'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceCapabilitiesResultWire } from './types'

function digits6FromPairing(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '')
  return s.length === 6 ? s : ''
}

/**
 * HTTP 200 body for `internal_inference_capabilities_request` on Host (direct P2P only; validated in p2pServiceDispatch).
 */
export async function buildInternalInferenceCapabilitiesResult(
  record: HandshakeRecord,
  request: { request_id: string; created_at: string },
): Promise<InternalInferenceCapabilitiesResultWire> {
  const hostPolicy = getHostInternalInferencePolicy()
  const { allowSandboxInference, modelAllowlist, capabilitiesExposeAllInstalledOllama } = hostPolicy
  const { deviceName: orchName } = getOrchestratorMode()
  const hostComputerName = (orchName || '').trim() || 'This computer (Host)'
  const hostPairingCode = digits6FromPairing(record.internal_peer_pairing_code)

  const localHostId = (localCoordinationDeviceId(record) ?? '').trim()
  const peerSandboxId = (peerCoordinationDeviceId(record) ?? '').trim()

  const base: InternalInferenceCapabilitiesResultWire = {
    type: 'internal_inference_capabilities_result',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: request.request_id,
    handshake_id: record.handshake_id,
    sender_device_id: localHostId,
    target_device_id: peerSandboxId,
    created_at: new Date().toISOString(),
    transport_policy: 'direct_only',
    host_computer_name: hostComputerName,
    host_pairing_code: hostPairingCode,
    models: [],
    policy_enabled: allowSandboxInference,
  }

  if (!allowSandboxInference) {
    return base
  }

  const allow = modelAllowlist ?? []

  try {
    const eff = await ollamaManager.getEffectiveChatModelName()
    const name = (eff ?? '').trim()
    const inAllow = name.length > 0 && (allow.length === 0 || allow.includes(name))
    base.active_local_llm = {
      provider: 'ollama',
      model: name,
      label: name,
      enabled: Boolean(inAllow),
    }
    if (name && inAllow) {
      base.active_chat_model = name
    }

    if (capabilitiesExposeAllInstalledOllama) {
      const installed = await ollamaManager.listModels()
      base.models = installed.map((m) => {
        const modelName = m.name?.trim() || ''
        return {
          provider: 'ollama' as const,
          model: modelName,
          label: modelName,
          enabled: modelName.length > 0,
        }
      })
      if (base.models.length === 0) {
        base.inference_error_code = InternalInferenceErrorCode.PROBE_NO_MODELS
      } else {
        if (name && inAllow) {
          base.models.sort((a, b) => {
            if (a.model === name) return -1
            if (b.model === name) return 1
            return 0
          })
        }
        if (!name) {
          base.inference_error_code = InternalInferenceErrorCode.PROBE_NO_MODELS
        } else if (!inAllow) {
          base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
        }
      }
      return base
    }

    if (name && inAllow) {
      base.models = [{ provider: 'ollama', model: name, label: name, enabled: true }]
    } else {
      base.models = []
      if (!name) {
        base.inference_error_code = InternalInferenceErrorCode.PROBE_NO_MODELS
      } else {
        base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
      }
    }
  } catch {
    base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
    base.active_local_llm = { provider: 'ollama', model: '', label: '', enabled: false }
    if (!capabilitiesExposeAllInstalledOllama) {
      base.models = []
    } else {
      try {
        const installed = await ollamaManager.listModels()
        base.models = installed.map((m) => {
          const modelName = m.name?.trim() || ''
          return {
            provider: 'ollama' as const,
            model: modelName,
            label: modelName,
            enabled: modelName.length > 0,
          }
        })
      } catch {
        base.models = []
      }
    }
  }

  return base
}
