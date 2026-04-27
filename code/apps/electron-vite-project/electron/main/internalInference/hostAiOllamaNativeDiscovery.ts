/**
 * Host AI model discovery from native Ollama HTTP API (`GET /api/tags`).
 * Host builds enumerations only from Host-local Ollama; Sandbox may merge peer LAN `/api/tags`
 * after verified peer-owned BEAP ingest (never sandbox localhost).
 */

import type { HandshakeRecord } from '../handshake/types'
import type { InternalInferenceCapabilitiesModelEntry, InternalInferenceCapabilitiesResultWire } from './types'
import { InternalInferenceErrorCode } from './errors'
import { deriveInternalHostAiPeerRoles } from './policy'
import { ingestUrlMatchesThisDevicesMvpDirectBeap, peekHostAdvertisedMvpDirectEntry } from './p2pEndpointRepair'

/** Default Host-local listener when resolving base URL fails. */
export const HOST_AI_DEFAULT_LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434'

export type HostAiOllamaTagsDiscoveryLog = {
  current_device_id: string
  peer_device_id: string
  role: 'host' | 'sandbox_peer_fetch'
  endpoint_owner_device_id: string | null
  ollama_base_url: string
  source: 'host_local_api_tags' | 'sandbox_peer_lan_api_tags'
  ok: boolean
  models_count: number
  error: string | null
}

export function normalizeHostLoopbackOllamaBaseUrl(resolvedBase: string): string {
  const raw = typeof resolvedBase === 'string' ? resolvedBase.trim() : ''
  if (!raw) return HOST_AI_DEFAULT_LOCAL_OLLAMA_BASE
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    u.hostname = '127.0.0.1'
    if (!u.port || u.port === '') u.port = '11434'
    u.pathname = ''
    u.search = ''
    u.hash = ''
    return `${u.protocol}//${u.hostname}:${u.port}`
  } catch {
    return HOST_AI_DEFAULT_LOCAL_OLLAMA_BASE
  }
}

function parseTagsModels(raw: unknown): Array<{ name?: string; model?: string }> {
  if (!raw || typeof raw !== 'object') return []
  const models = (raw as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const out: Array<{ name?: string; model?: string }> = []
  for (const m of models) {
    if (!m || typeof m !== 'object') continue
    const o = m as { name?: unknown; model?: unknown }
    const id =
      typeof o.model === 'string'
        ? o.model.trim()
        : typeof o.name === 'string'
          ? o.name.trim()
          : ''
    if (!id) continue
    out.push({ name: id, model: id })
  }
  return out
}

/**
 * Maps Ollama `/api/tags` `models[]` entries into Host AI wire rows (provider + source host_ollama).
 */
export function hostAiModelsFromOllamaTagsModels(
  rawModels: Array<{ name?: string; model?: string }>,
  modelAllowlist: string[],
): InternalInferenceCapabilitiesModelEntry[] {
  const allow = modelAllowlist ?? []
  const wire: InternalInferenceCapabilitiesModelEntry[] = []
  for (const m of rawModels) {
    const id = String(m.model ?? m.name ?? '').trim()
    if (!id) continue
    const label = String(m.name ?? m.model ?? id).trim() || id
    const enabled = allow.length === 0 || allow.includes(id)
    wire.push({
      provider: 'ollama',
      model: id,
      label,
      enabled,
      source: 'host_ollama',
    })
  }
  return wire
}

export function parseOllamaTagsBody(body: unknown): {
  rawModels: Array<{ name?: string; model?: string }>
  rawCount: number
} {
  const rawModels = parseTagsModels(body)
  return { rawModels, rawCount: rawModels.length }
}

export async function fetchOllamaApiTagsJson(baseUrlNoTrailingSlash: string): Promise<{
  ok: boolean
  httpStatus: number
  json: unknown | null
  error: string | null
}> {
  const base = baseUrlNoTrailingSlash.replace(/\/$/, '')
  const url = `${base}/api/tags`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    const httpStatus = res.status
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return {
        ok: false,
        httpStatus,
        json: null,
        error: `http_${httpStatus}${t ? `:${t.slice(0, 128)}` : ''}`,
      }
    }
    const json = await res.json().catch(() => null)
    return { ok: true, httpStatus, json, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, httpStatus: 0, json: null, error: msg }
  }
}

export function logHostAiOllamaDiscovery(payload: HostAiOllamaTagsDiscoveryLog): void {
  console.log(`[HOST_AI_OLLAMA_DISCOVERY] ${JSON.stringify(payload)}`)
}

export function logSbxHostAiModelSource(payload: {
  current_device_id: string
  peer_device_id: string
  selected_endpoint: string | null
  endpoint_owner_device_id: string | null
  model_source: 'capabilities_wire' | 'peer_lan_ollama_tags' | 'merged_peer_tags_priority'
  models_count: number
  rejected_reason: string | null
}): void {
  console.log(`[SBX_HOST_AI_MODEL_SOURCE] ${JSON.stringify(payload)}`)
}

/** Derive `http://<lan-host>:11434` from a verified direct BEAP ingest URL (same hostname as Host LAN listener). */
export function peerLanOllamaBaseUrlFromDirectBeapIngestUrl(ingestUrl: string, ollamaPort = '11434'): string | null {
  const t = typeof ingestUrl === 'string' ? ingestUrl.trim() : ''
  if (!t) return null
  try {
    const u = new URL(t)
    const host = u.hostname.trim()
    if (!host || host === 'localhost' || host === '127.0.0.1') return null
    return `http://${host}:${ollamaPort}`
  } catch {
    return null
  }
}

/**
 * Sandbox direct LAN: after verified peer-owned BEAP ingest, optionally replace wire.models with
 * `GET http://<peer_lan_host>:11434/api/tags` so enumeration matches Host Ollama (never sandbox localhost).
 */
export async function mergeSandboxCapabilitiesWireWithPeerLanOllamaTags(
  db: unknown,
  handshakeId: string,
  record: HandshakeRecord,
  wire: InternalInferenceCapabilitiesResultWire,
  selectedDirectBeapIngestUrl: string,
  currentDeviceId: string,
  peerHostDeviceId: string,
): Promise<InternalInferenceCapabilitiesResultWire> {
  const hidForPeek = String(handshakeId ?? '').trim()
  const dr = deriveInternalHostAiPeerRoles(record, currentDeviceId.trim())
  const peerOk =
    dr.ok && dr.localRole === 'sandbox' && dr.peerRole === 'host' && peerHostDeviceId.trim().length > 0
  const endpointPeek = peekHostAdvertisedMvpDirectEntry(hidForPeek)
  const endpointOwner =
    (endpointPeek?.ownerDeviceId != null ? String(endpointPeek.ownerDeviceId).trim() : '') || peerHostDeviceId.trim()

  const reject = (
    reason: string,
    source: 'capabilities_wire' | 'peer_lan_ollama_tags' | 'merged_peer_tags_priority',
    mc: number,
  ): InternalInferenceCapabilitiesResultWire => {
    logSbxHostAiModelSource({
      current_device_id: currentDeviceId.trim(),
      peer_device_id: peerHostDeviceId.trim(),
      selected_endpoint: selectedDirectBeapIngestUrl.trim(),
      endpoint_owner_device_id: endpointOwner || null,
      model_source: source,
      models_count: mc,
      rejected_reason: reason,
    })
    return wire
  }

  if (!peerOk) {
    return reject('not_sandbox_to_host_roles', 'capabilities_wire', wire.models?.length ?? 0)
  }
  if (currentDeviceId.trim() === endpointOwner) {
    return reject('endpoint_owner_equals_current_device', 'capabilities_wire', wire.models?.length ?? 0)
  }
  if (endpointOwner !== peerHostDeviceId.trim()) {
    return reject('endpoint_owner_not_peer_host', 'capabilities_wire', wire.models?.length ?? 0)
  }
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db as any, selectedDirectBeapIngestUrl)) {
    return reject('ingest_matches_local_sandbox_beap', 'capabilities_wire', wire.models?.length ?? 0)
  }

  const peerBase = peerLanOllamaBaseUrlFromDirectBeapIngestUrl(selectedDirectBeapIngestUrl)
  if (!peerBase) {
    return reject('no_peer_lan_hostname_for_ollama', 'capabilities_wire', wire.models?.length ?? 0)
  }

  const fetchRes = await fetchOllamaApiTagsJson(peerBase)
  logHostAiOllamaDiscovery({
    current_device_id: currentDeviceId.trim(),
    peer_device_id: peerHostDeviceId.trim(),
    role: 'sandbox_peer_fetch',
    endpoint_owner_device_id: endpointOwner,
    ollama_base_url: peerBase,
    source: 'sandbox_peer_lan_api_tags',
    ok: fetchRes.ok && fetchRes.json != null,
    models_count: fetchRes.ok && fetchRes.json != null ? parseOllamaTagsBody(fetchRes.json).rawCount : 0,
    error: fetchRes.ok ? null : fetchRes.error,
  })

  if (!fetchRes.ok || fetchRes.json == null) {
    return reject(fetchRes.error ?? 'peer_ollama_tags_fetch_failed', 'capabilities_wire', wire.models?.length ?? 0)
  }

  const parsed = parseOllamaTagsBody(fetchRes.json)
  const mergedModels = hostAiModelsFromOllamaTagsModels(parsed.rawModels, [])
  const wireMc = wire.models?.length ?? 0
  logSbxHostAiModelSource({
    current_device_id: currentDeviceId.trim(),
    peer_device_id: peerHostDeviceId.trim(),
    selected_endpoint: selectedDirectBeapIngestUrl.trim(),
    endpoint_owner_device_id: endpointOwner || null,
    model_source: 'merged_peer_tags_priority',
    models_count: mergedModels.length,
    rejected_reason:
      mergedModels.length > 0 ? null : wireMc > 0 ? 'peer_tags_empty_kept_capabilities_wire' : 'peer_tags_empty',
  })

  if (mergedModels.length === 0 && wireMc > 0) {
    return wire
  }
  const eff =
    typeof wire.active_chat_model === 'string'
      ? wire.active_chat_model.trim()
      : wire.active_local_llm?.model?.trim() ?? ''
  const next: InternalInferenceCapabilitiesResultWire = {
    ...wire,
    models: mergedModels,
    inference_error_code:
      mergedModels.length > 0 && wire.inference_error_code === InternalInferenceErrorCode.PROBE_NO_MODELS
        ? undefined
        : wire.inference_error_code,
  }
  if (eff && mergedModels.some((x) => x.model === eff)) {
    next.models = [...mergedModels].sort((a, b) => {
      if (a.model === eff) return -1
      if (b.model === eff) return 1
      return 0
    })
  }
  return next
}

