/**
 * Host: build `internal_inference_capabilities_result` (metadata only — no prompts, no user files).
 * Uses Ollama list / effective model resolution shared with internal inference and GET /internal-inference-policy.
 * (No `os` import — keeps Vitest ESM happy; `getOrchestratorMode` supplies display name, same idea as policy GET.)
 */

import type { HandshakeRecord } from '../handshake/types'
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { ollamaManager } from '../llm/ollama-manager'
import { resolveModelForInternalInference } from '../llm/internalHostInferenceOllama'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { InternalInferenceErrorCode } from './errors'
import { localCoordinationDeviceId, peerCoordinationDeviceId } from './policy'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceCapabilitiesResultWire } from './types'

function digits6FromPairing(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '')
  return s.length === 6 ? s : ''
}

/**
 * Synchronous response body for `internal_inference_capabilities_request` on Host (direct P2P only).
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

  try {
    if (capabilitiesExposeAllInstalledOllama) {
      const installed = await ollamaManager.listModels()
      base.models = installed.map((m) => {
        const name = m.name?.trim() || ''
        return {
          provider: 'ollama' as const,
          model: name,
          label: name,
          enabled: name.length > 0,
        }
      })
      if (base.models.length === 0) {
        base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
      }
      return base
    }

    const resolved = await resolveModelForInternalInference(undefined, modelAllowlist ?? [])
    if (!('model' in resolved)) {
      base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
      return base
    }
    const m = resolved.model.trim()
    base.models = [
      { provider: 'ollama', model: m, label: m, enabled: true },
    ]
  } catch {
    base.inference_error_code = InternalInferenceErrorCode.OLLAMA_UNAVAILABLE
  }

  return base
}
