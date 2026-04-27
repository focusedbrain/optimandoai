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

/** Caps wire models truncated for logs (`InternalInferenceCapabilitiesModelEntry` has no `id`). */
export function summarizeCapsModelsBriefForLog(
  models: InternalInferenceCapabilitiesModelEntry[] | undefined,
  max = 16,
): Array<{ model: string; enabled: boolean; provider: string; source: string }> {
  return (models ?? []).slice(0, max).map((m) => ({
    model: typeof m.model === 'string' ? m.model : '',
    enabled: m.enabled === true,
    provider: m.provider,
    source: 'host_build_enumeration',
  }))
}

/** Canonical Host capability JSON immediately before HTTP ingest serializes it or before DC wraps `built`. */
export function logHostAiCapsFinalWire(p: {
  wire: InternalInferenceCapabilitiesResultWire
  meta: HostInferenceCapabilitiesBuildMeta
  exit: string
  policy_enabled_reason: string
  models_array_reason: string
  selected_local_model_from_host_state: string | null
}): void {
  const w = p.wire
  console.log(
    `[HOST_AI_CAPS_FINAL_WIRE] ${JSON.stringify({
      transport: 'internal_inference_capabilities_result_body_from_buildInternalInferenceCapabilitiesResult',
      exit: p.exit,
      policy_enabled: w.policy_enabled,
      policy_enabled_reason: p.policy_enabled_reason,
      models_array_reason: p.models_array_reason,
      active_local_llm: w.active_local_llm ?? null,
      active_chat_model: w.active_chat_model ?? null,
      models_length: Array.isArray(w.models) ? w.models.length : 0,
      models_brief: summarizeCapsModelsBriefForLog(w.models),
      inference_error_code: w.inference_error_code ?? null,
      request_id: w.request_id,
      handshake_id: w.handshake_id,
      sender_device_id: w.sender_device_id,
      target_device_id: w.target_device_id,
      selected_local_model_from_host_state: p.selected_local_model_from_host_state,
      meta_probe_http_model_count: p.meta.probe_http_model_count,
      meta_raw_models_count: p.meta.raw_models_count,
      meta_mapped_models_count: p.meta.mapped_models_count,
    })}`,
  )
}

/** One-line diagnostic before every return from `buildInternalInferenceCapabilitiesResult`. */
function logHostAiCapsBuildState(p: {
  exit: 'policy_disabled' | 'mapping_fatal' | 'success' | 'catch'
  wire: InternalInferenceCapabilitiesResultWire
  meta: HostInferenceCapabilitiesBuildMeta
  policy_decision_source_reason: string
  model_enumeration_source_reason: string
  inference_error_set_reason?: string | null
  local_inference_active_model_present: boolean
}): void {
  const w = p.wire
  const al = w.active_local_llm
  console.log(
    `[HOST_AI_CAPS_BUILD_STATE] ${JSON.stringify({
      exit: p.exit,
      policy_enabled: w.policy_enabled,
      active_local_llm: al
        ? { provider: al.provider, model_len: (al.model ?? '').length, enabled: al.enabled }
        : null,
      active_chat_model: w.active_chat_model ?? null,
      models_length: Array.isArray(w.models) ? w.models.length : 0,
      raw_models_count: p.meta.raw_models_count,
      mapped_models_count: p.meta.mapped_models_count,
      probe_http_model_count: p.meta.probe_http_model_count,
      provider_probe_ok: p.meta.provider_probe_ok,
      inference_error_code: w.inference_error_code ?? null,
      mapping_fatal: p.meta.mapping_fatal,
      policy_decision_source_reason: p.policy_decision_source_reason,
      model_enumeration_source_reason: p.model_enumeration_source_reason,
      inference_error_set_reason: p.inference_error_set_reason ?? null,
      local_inference_active_model_present: p.local_inference_active_model_present,
    })}`,
  )
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
    let localActive: string | null = null
    try {
      const eff = await ollamaManager.getEffectiveChatModelName()
      localActive = (eff ?? '').trim() || null
    } catch {
      localActive = null
    }
    logHostAiCapsBuildState({
      exit: 'policy_disabled',
      wire: base,
      meta,
      policy_decision_source_reason: 'allowSandboxInference_false_from_getHostInternalInferencePolicy',
      model_enumeration_source_reason: 'skipped_sandbox_inference_not_allowed',
      inference_error_set_reason: null,
      local_inference_active_model_present: Boolean(localActive),
    })
    logHostAiCapsFinalWire({
      wire: base,
      meta,
      exit: 'policy_disabled',
      policy_enabled_reason: 'getHostInternalInferencePolicy_allowSandboxInference_false',
      models_array_reason: 'enumeration_skipped_policy_gate',
      selected_local_model_from_host_state: localActive,
    })
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
      logHostAiCapsBuildState({
        exit: 'mapping_fatal',
        wire: base,
        meta,
        policy_decision_source_reason: 'allowSandboxInference_true',
        model_enumeration_source_reason:
          allow.length > 0
            ? 'all_installed_models_filtered_by_allowlist'
            : 'unexpected_zero_mapped_with_nonzero_raw',
        inference_error_set_reason: InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL,
        local_inference_active_model_present: false,
      })
      logHostAiCapsFinalWire({
        wire: base,
        meta,
        exit: 'mapping_fatal',
        policy_enabled_reason: 'getHostInternalInferencePolicy_allowSandboxInference_true',
        models_array_reason:
          allow.length > 0 ? 'allowlist_filtered_all_models_disabled_on_wire' : 'mapping_fatal_non_allowlist',
        selected_local_model_from_host_state: null,
      })
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

    let inferenceErrorSetReason: string | null = null
    if (!probeResult.ok) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
      inferenceErrorSetReason = 'provider_probe_not_ok'
    } else if (probeResult.modelCount > 0 && installed.length === 0) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_INVALID_RESPONSE
      base.models = []
      inferenceErrorSetReason = 'probe_tags_count_positive_but_listModels_empty'
    } else if (mappedWireModels.length === 0) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_NO_MODELS
      inferenceErrorSetReason = 'no_installed_models_after_enumeration'
    } else if (!name) {
      console.warn('[HOST_AI_CAPS] effective_model_null_despite_installed_tags')
      inferenceErrorSetReason = 'effective_name_empty_despite_mapped_models'
    } else if (!inAllow) {
      base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
      inferenceErrorSetReason = 'effective_model_not_in_allowlist'
    }

    logHostAiCapsBuildState({
      exit: 'success',
      wire: base,
      meta,
      policy_decision_source_reason: 'allowSandboxInference_true',
      model_enumeration_source_reason: 'probeHttpTagsWithLogging_plus_listModels_same_as_host_ui_paths',
      inference_error_set_reason: inferenceErrorSetReason,
      local_inference_active_model_present: Boolean(name),
    })
    logHostAiCapsFinalWire({
      wire: base,
      meta,
      exit: 'success',
      policy_enabled_reason: 'getHostInternalInferencePolicy_allowSandboxInference_true',
      models_array_reason: inferenceErrorSetReason
        ? `post_build_inference_error:${inferenceErrorSetReason}`
        : 'enumeration_populated_models_array',
      selected_local_model_from_host_state: name.length > 0 ? name : null,
    })

    return { wire: base, meta }
  } catch {
    meta.provider_probe_ok = false
    base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
    base.active_local_llm = { provider: 'ollama', model: '', label: '', enabled: false }
    base.models = []
    logHostAiCapsBuildState({
      exit: 'catch',
      wire: base,
      meta,
      policy_decision_source_reason: 'allowSandboxInference_true',
      model_enumeration_source_reason: 'exception_during_probe_or_enumeration',
      inference_error_set_reason: InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE,
      local_inference_active_model_present: false,
    })
    logHostAiCapsFinalWire({
      wire: base,
      meta,
      exit: 'catch',
      policy_enabled_reason: 'getHostInternalInferencePolicy_allowSandboxInference_true',
      models_array_reason: 'exception_cleared_models',
      selected_local_model_from_host_state: null,
    })
    return { wire: base, meta }
  }
}
