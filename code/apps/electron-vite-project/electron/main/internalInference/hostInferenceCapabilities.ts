/**
 * Host: build `internal_inference_capabilities_result` (metadata only — no prompts, no user files).
 * Active local LLM is **only** from `ollamaManager.getEffectiveChatModelName()` (uses `activeOllamaModelStore` + /api/tags).
 * Model enumeration aligns with `[HOST_PROVIDER] ollama_probe`: {@link ollamaManager.probeHttpTagsWithLogging}
 * then {@link ollamaManager.fetchTagsInstalledModelsFresh} so cached empty lists cannot stale-read before base URL resolves.
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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

/** Same probe path as `[HOST_PROVIDER] ollama_probe` HTTP discovery; caps skip stale listModels TTL cache after probe. */
async function probeAndFreshInstalledModels(): Promise<{
  probeResult: { ok: boolean; baseUrl: string; modelCount: number }
  installed: InstalledModel[]
  providerSource: string
}> {
  const probeResult = await ollamaManager.probeHttpTagsWithLogging()
  /** {@link fetchTagsInstalledModelsFresh} invalidates TTL cache then reads `/api/tags` at probe-resolved {@link OllamaManager} base URL. */
  let installed = await ollamaManager.fetchTagsInstalledModelsFresh()
  let providerSource = 'probe_then_fetchTagsInstalledModelsFresh'

  if (probeResult.ok && probeResult.modelCount > 0 && installed.length === 0) {
    console.warn(
      `[HOST_AI_CAPS] probe_tags_positive_list_empty_retry probe_http_model_count=${probeResult.modelCount} listed=${installed.length}`,
    )
    await sleepMs(750)
    ollamaManager.invalidateModelsCache()
    installed = await ollamaManager.fetchTagsInstalledModelsFresh()
    providerSource = 'probe_then_fetch_after_retry_ms_750'
  }

  return { probeResult, installed, providerSource }
}

function enforcePolicyCapabilityInvariant(p: {
  policyEnabled: boolean
  probeOk: boolean
  probeModelCount: number
  wire: InternalInferenceCapabilitiesResultWire
}): void {
  const { policyEnabled, probeOk, probeModelCount, wire } = p
  if (!policyEnabled || !probeOk) return
  const mc = Array.isArray(wire.models) ? wire.models.length : 0
  const ie = wire.inference_error_code
  if (mc === 0 && !ie) {
    wire.inference_error_code =
      probeModelCount > 0
        ? InternalInferenceErrorCode.PROBE_PROVIDER_NOT_READY
        : InternalInferenceErrorCode.PROBE_NO_MODELS
  }
}

function logHostAiCapsModelSource(p: {
  handshake_id: string
  current_device_id: string
  local_derived_role: string
  provider_ok: boolean
  provider_source: string
  provider_models_count: number
  provider_model_names: string[]
  active_local_llm: InternalInferenceCapabilitiesResultWire['active_local_llm']
  active_chat_model: string | undefined
  raw_models_count: number
  mapped_models_count: number
  wire_models_count: number
  inference_error_code: string | undefined
}): void {
  console.log(`[HOST_AI_CAPS_MODEL_SOURCE] ${JSON.stringify(p)}`)
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

  const localDerivedRole =
    dr.ok && dr.localRole === 'host' ? 'host' : dr.ok ? dr.localRole : 'unknown'

  if (!allowSandboxInference) {
    return { wire: base, meta }
  }

  try {
    const { probeResult, installed, providerSource } = await probeAndFreshInstalledModels()
    meta.provider_probe_ok = probeResult.ok
    meta.probe_http_model_count = probeResult.modelCount
    meta.endpoint = probeResult.baseUrl || ollamaManager.getBaseUrl()

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
        `[HOST_AI_CAPS] probe_ok_but_listModels_empty_after_probe_alignment probe_http_model_count=${probeResult.modelCount} listed=0`,
      )
    }

    const dropReasons: Array<{ name_hash: string; reason: string }> = []
    let mappedWireModels: InternalInferenceCapabilitiesModelEntry[] = []

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

    /** Host-side fallback: enumeration empty but active chat model is known — advertise single enabled tag (same machine). */
    let syntheticActiveFallback = false
    if (mappedWireModels.length === 0 && probeResult.ok) {
      const eff = ((await ollamaManager.getEffectiveChatModelName()) ?? '').trim()
      if (eff && (allow.length === 0 || allow.includes(eff))) {
        mappedWireModels = [
          { provider: 'ollama', model: eff, label: eff, enabled: true },
        ]
        meta.mapped_models_count = 1
        syntheticActiveFallback = true
        console.log(
          `[HOST_AI_CAPS_ACTIVE_FALLBACK] ${JSON.stringify({
            handshake_id: record.handshake_id,
            model: eff,
            reason: 'empty_enumeration_used_effective_chat_model',
          })}`,
        )
      }
    }

    meta.mapped_models_count = mappedWireModels.length

    const filtered_models_count = mappedWireModels.filter((x) => !x.enabled).length
    console.log(
      `[HOST_AI_CAPS_MODEL_MAP] ${JSON.stringify({
        raw_models_count: meta.raw_models_count,
        mapped_models_count: meta.mapped_models_count,
        filtered_models_count,
        dropped_count: dropReasons.length,
        synthetic_active_fallback: syntheticActiveFallback,
        drop_reasons: dropReasons.slice(0, 64),
      })}`,
    )

    if (meta.raw_models_count > 0 && meta.mapped_models_count === 0 && !syntheticActiveFallback) {
      meta.mapping_fatal = true
      base.inference_error_code = InternalInferenceErrorCode.MODEL_MAPPING_DROPPED_ALL
      base.models = []
      base.active_local_llm = { provider: 'ollama', model: '', label: '', enabled: false }
      logHostAiCapsModelSource({
        handshake_id: record.handshake_id,
        current_device_id: getInstanceId().trim(),
        local_derived_role: localDerivedRole,
        provider_ok: probeResult.ok,
        provider_source: providerSource,
        provider_models_count: probeResult.modelCount,
        provider_model_names: installed.map((m) => (m.name ?? '').trim()).filter(Boolean).slice(0, 32),
        active_local_llm: base.active_local_llm,
        active_chat_model: undefined,
        raw_models_count: meta.raw_models_count,
        mapped_models_count: meta.mapped_models_count,
        wire_models_count: 0,
        inference_error_code: base.inference_error_code,
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

    if (!probeResult.ok) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
    } else if (probeResult.modelCount > 0 && installed.length === 0 && !syntheticActiveFallback) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_INVALID_RESPONSE
      base.models = []
    } else if (mappedWireModels.length === 0) {
      base.inference_error_code = InternalInferenceErrorCode.PROBE_NO_MODELS
    } else if (!name) {
      console.warn('[HOST_AI_CAPS] effective_model_null_despite_installed_tags')
    } else if (!inAllow) {
      base.inference_error_code = InternalInferenceErrorCode.MODEL_UNAVAILABLE
    }

    enforcePolicyCapabilityInvariant({
      policyEnabled: base.policy_enabled === true,
      probeOk: probeResult.ok,
      probeModelCount: probeResult.modelCount,
      wire: base,
    })

    logHostAiCapsModelSource({
      handshake_id: record.handshake_id,
      current_device_id: getInstanceId().trim(),
      local_derived_role: localDerivedRole,
      provider_ok: probeResult.ok,
      provider_source: providerSource,
      provider_models_count: probeResult.modelCount,
      provider_model_names: installed.map((m) => (m.name ?? '').trim()).filter(Boolean).slice(0, 32),
      active_local_llm: base.active_local_llm,
      active_chat_model: base.active_chat_model,
      raw_models_count: meta.raw_models_count,
      mapped_models_count: meta.mapped_models_count,
      wire_models_count: Array.isArray(base.models) ? base.models.length : 0,
      inference_error_code: base.inference_error_code,
    })

    return { wire: base, meta }
  } catch {
    meta.provider_probe_ok = false
    base.inference_error_code = InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE
    base.active_local_llm = { provider: 'ollama', model: '', label: '', enabled: false }
    base.models = []
    logHostAiCapsModelSource({
      handshake_id: record.handshake_id,
      current_device_id: getInstanceId().trim(),
      local_derived_role: localDerivedRole,
      provider_ok: false,
      provider_source: 'catch_throw',
      provider_models_count: 0,
      provider_model_names: [],
      active_local_llm: base.active_local_llm,
      active_chat_model: undefined,
      raw_models_count: meta.raw_models_count,
      mapped_models_count: meta.mapped_models_count,
      wire_models_count: 0,
      inference_error_code: base.inference_error_code,
    })
    return { wire: base, meta }
  }
}
