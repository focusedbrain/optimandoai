/**
 * Host: build `internal_inference_capabilities_result` (metadata only — no prompts, no user files).
 * Active local LLM is **only** from `ollamaManager.getEffectiveChatModelName()` (uses `activeOllamaModelStore` + /api/tags).
 * Model enumeration follows the same HTTP path as `[HOST_PROVIDER] ollama_probe`: `probeHttpTagsWithLogging` + `listModels()`.
 */

import { createHash } from 'node:crypto'
import type { HandshakeRecord } from '../handshake/types'
import type { InstalledModel } from '../llm/types'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { ollamaManager } from '../llm/ollama-manager'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { InternalInferenceErrorCode } from './errors'
import { coordinationDeviceIdForHandshakeDeviceRole, deriveInternalHostAiPeerRoles } from './policy'
import {
  INTERNAL_INFERENCE_SCHEMA_VERSION,
  type InternalInferenceCapabilitiesModelEntry,
  type InternalInferenceCapabilitiesResultWire,
} from './types'

function digits6FromPairing(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '')
  return s.length === 6 ? s : ''
}

function hashModelNameForLog(name: string): string {
  const n = name.trim()
  if (!n) return '(empty)'
  return createHash('sha256').update(n).digest('hex').slice(0, 16)
}

export interface HostInferenceCapabilitiesBuildMeta {
  raw_models_count: number
  mapped_models_count: number
  probe_http_model_count: number
  provider_probe_ok: boolean
  endpoint: string
  /** True only when {@link InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL} applies. */
  mapping_fatal: boolean
}

/**
 * HTTP 200 body for `internal_inference_capabilities_request` on Host (direct P2P only; validated in p2pServiceDispatch).
 */
export async function buildInternalInferenceCapabilitiesResult(
  record: HandshakeRecord,
  request: { request_id: string; created_at: string },
): Promise<{ wire: InternalInferenceCapabilitiesResultWire; meta: HostInferenceCapabilitiesBuildMeta }> {
  const hostPolicy = getHostInternalInferencePolicy()
  const { allowSandboxInference, modelAllowlist } = hostPolicy
  const { deviceName: orchName } = getOrchestratorMode()
  const hostComputerName = (orchName || '').trim() || 'This computer (Host)'
  const hostPairingCode = digits6FromPairing(record.internal_peer_pairing_code)

  const dr = deriveInternalHostAiPeerRoles(record, getInstanceId().trim())
  const localHostId = (
    dr.ok && dr.localRole === 'host' && dr.peerRole === 'sandbox'
      ? dr.localCoordinationDeviceId
      : coordinationDeviceIdForHandshakeDeviceRole(record, 'host') ?? ''
  ).trim()
  const peerSandboxId = (
    dr.ok && dr.localRole === 'host' && dr.peerRole === 'sandbox'
      ? dr.peerCoordinationDeviceId
      : coordinationDeviceIdForHandshakeDeviceRole(record, 'sandbox') ?? ''
  ).trim()

  const allow = modelAllowlist ?? []

  const meta: HostInferenceCapabilitiesBuildMeta = {
    raw_models_count: 0,
    mapped_models_count: 0,
    probe_http_model_count: 0,
    provider_probe_ok: false,
    endpoint: ollamaManager.getBaseUrl(),
    mapping_fatal: false,
  }

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
    return { wire: base, meta }
  }

  try {
    const probeResult = await ollamaManager.probeHttpTagsWithLogging()
    meta.provider_probe_ok = probeResult.ok
    meta.probe_http_model_count = probeResult.modelCount
    meta.endpoint = probeResult.baseUrl || ollamaManager.getBaseUrl()

    let installed: InstalledModel[] = []
    try {
      installed = await ollamaManager.listModels()
    } catch {
      installed = []
    }

    meta.raw_models_count = installed.length

    const hashedNames = installed.map((m) => hashModelNameForLog(m.name ?? ''))
    console.log(
      `[HOST_AI_CAPS_PROVIDER_RAW] ${JSON.stringify({
        provider: 'ollama',
        endpoint: meta.endpoint,
        provider_ok: probeResult.ok,
        raw_models_count: meta.raw_models_count,
        raw_model_names_redacted_or_hashed: hashedNames,
      })}`,
    )

    if (probeResult.ok && probeResult.modelCount > 0 && installed.length === 0) {
      console.warn(
        `[HOST_AI_CAPS] probe_ok_but_listModels_empty probe_http_model_count=${probeResult.modelCount} listed=0`,
      )
    }
    if (probeResult.ok && probeResult.modelCount !== installed.length) {
      console.warn(
        `[HOST_AI_CAPS] probe_vs_list_count_mismatch probe_http_model_count=${probeResult.modelCount} listed=${installed.length}`,
      )
    }

    const dropReasons: Array<{ name_hash: string; reason: string }> = []
    const mappedWireModels: InternalInferenceCapabilitiesModelEntry[] = []

    for (const m of installed) {
      const modelName = (m.name ?? '').trim()
      if (!modelName) {
        dropReasons.push({ name_hash: '(empty)', reason: 'empty_name' })
        continue
      }
      const enabled = allow.length === 0 || allow.includes(modelName)
      mappedWireModels.push({
        provider: 'ollama',
        model: modelName,
        label: modelName,
        enabled,
      })
    }

    meta.mapped_models_count = mappedWireModels.length

    const filtered_models_count = mappedWireModels.filter((x) => !x.enabled).length
    console.log(
      `[HOST_AI_CAPS_MODEL_MAP] ${JSON.stringify({
        raw_models_count: meta.raw_models_count,
        mapped_models_count: meta.mapped_models_count,
        filtered_models_count,
        dropped_count: dropReasons.length,
        drop_reasons: dropReasons.slice(0, 64),
      })}`,
    )

    if (meta.raw_models_count > 0 && meta.mapped_models_count === 0) {
      meta.mapping_fatal = true
      base.inference_error_code = InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL
      base.models = []
      base.active_local_llm = { provider: 'ollama', model: '', label: '', enabled: false }
      return { wire: base, meta }
    }

    base.models = mappedWireModels

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

    if (name && mappedWireModels.some((w) => w.model === name)) {
      base.models.sort((a, b) => {
        if (a.model === name) return -1
        if (b.model === name) return 1
        return 0
      })
    }

    if (!probeResult.ok) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
    } else if (probeResult.modelCount > 0 && installed.length === 0) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_INVALID_RESPONSE
      base.models = []
    } else if (mappedWireModels.length === 0) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_NO_MODELS
    } else if (!name) {
      console.warn('[HOST_AI_CAPS] effective_model_null_despite_installed_tags')
    } else if (!inAllow) {
      base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
    }

    return { wire: base, meta }
  } catch {
    meta.provider_probe_ok = false
    base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
    base.active_local_llm = { provider: 'ollama', model: '', label: '', enabled: false }
    base.models = []
    return { wire: base, meta }
  }
}
