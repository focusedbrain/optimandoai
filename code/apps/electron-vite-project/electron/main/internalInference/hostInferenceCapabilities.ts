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
import {
  INTERNAL_INFERENCE_SCHEMA_VERSION,
  type ActiveLocalLlmWire,
  type InternalInferenceCapabilitiesResultWire,
} from './types'

function digits6FromPairing(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '')
  return s.length === 6 ? s : ''
}

/**
 * Source of truth for the Host’s “active” local model name: `getEffectiveChatModelName()` (uses
 * `activeOllamaModelStore` + installed tags). `getStatus` / `listModels` are supporting.
 */
async function buildActiveLocalLlmWire(modelAllowlist: string[]): Promise<{
  active_local_llm: ActiveLocalLlmWire
  eff: string | null
}> {
  let eff: string | null = null
  try {
    eff = await ollamaManager.getEffectiveChatModelName()
  } catch {
    /* supporting path */
  }
  if (!eff) {
    try {
      const st = await ollamaManager.getStatus()
      const a = st.activeModel?.trim()
      if (a) {
        const names = new Set((await ollamaManager.listModels()).map((m) => m.name))
        if (names.has(a)) {
          eff = a
        }
      }
    } catch {
      /* ignore */
    }
  }
  const allow = modelAllowlist
  const inAllow = eff != null && (allow.length === 0 || allow.includes(eff))
  const active_local_llm: ActiveLocalLlmWire = {
    provider: 'ollama',
    model: eff ?? '',
    label: eff ?? '',
    enabled: Boolean(eff && inAllow),
  }
  return { active_local_llm, eff }
}

/** Same “active Ollama” as Backend Config / llm getStatus — when `active_local_llm` is empty, fill active_chat_model. */
async function attachActiveChatModelFromHostStatusIfNeeded(target: InternalInferenceCapabilitiesResultWire): Promise<void> {
  if (target.active_local_llm?.model?.trim()) {
    const m = target.active_local_llm.model.trim()
    target.active_chat_model = m
    return
  }
  try {
    const st = await ollamaManager.getStatus()
    const a = st.activeModel?.trim()
    if (a) {
      target.active_chat_model = a
    }
  } catch {
    /* ignore */
  }
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

  const allow = modelAllowlist ?? []

  let effForSort: string | null = null
  try {
    const { active_local_llm, eff } = await buildActiveLocalLlmWire(allow)
    effForSort = eff
    base.active_local_llm = active_local_llm
    if (active_local_llm.model.trim()) {
      base.active_chat_model = active_local_llm.model.trim()
    } else {
      await attachActiveChatModelFromHostStatusIfNeeded(base)
    }

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
      } else {
        const act = effForSort ?? base.active_chat_model
        if (act) {
          base.models.sort((a, b) => {
            if (a.model === act) return -1
            if (b.model === act) return 1
            return 0
          })
        }
      }
      return base
    }

    let resolved = await resolveModelForInternalInference(undefined, allow)
    if (!('model' in resolved)) {
      const st = await ollamaManager.getStatus()
      const active = st.activeModel?.trim()
      const nameSet = new Set((await ollamaManager.listModels()).map((x) => x.name))
      if (active && nameSet.has(active) && (allow.length === 0 || allow.includes(active))) {
        resolved = { model: active }
      }
    }
    if (!('model' in resolved)) {
      base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
      if (!base.active_chat_model) {
        await attachActiveChatModelFromHostStatusIfNeeded(base)
      }
      return base
    }
    const m = resolved.model.trim()
    base.models = [{ provider: 'ollama' as const, model: m, label: m, enabled: true }]
    if (!base.active_chat_model) {
      base.active_chat_model = m
    }
  } catch {
    base.inference_error_code = InternalInferenceErrorCode.OLLAMA_UNAVAILABLE
    try {
      const { active_local_llm, eff } = await buildActiveLocalLlmWire(allow)
      base.active_local_llm = active_local_llm
      effForSort = eff
      if (!base.active_local_llm.model.trim()) {
        await attachActiveChatModelFromHostStatusIfNeeded(base)
      } else {
        base.active_chat_model = base.active_local_llm.model.trim()
      }
    } catch {
      /* ignore */
    }
  }

  return base
}
