/**
 * Sandbox-only: list Host Ollama models via LAN `ollama_direct` base URL (`GET /api/tags`).
 * Never calls Sandbox localhost Ollama — only URLs produced by {@link evaluateSandboxHostAiOllamaDirectFromCapabilitiesWire}.
 */

import { parseOllamaTagsBody } from './hostAiOllamaNativeDiscovery'
import {
  getSandboxOllamaDirectRouteCandidate,
  type SandboxOllamaDirectRouteCandidate,
} from './sandboxHostAiOllamaDirectCandidate'
import { classifyOllamaDirectFetchTransportFailure } from './sandboxOllamaDirectTransport'
import { refreshSandboxOllamaDirectFromHostCapabilities } from './sandboxOllamaDirectCapsRefresh'

export type SandboxOllamaDirectRemoteModelEntry = {
  id: string
  model: string
  label: string
  provider: 'ollama'
  transport: 'ollama_direct'
  source: 'remote_ollama_tags'
  endpoint_owner_device_id: string
}

export type SandboxOllamaDirectTagsClassification =
  | 'available'
  | 'no_models'
  | 'transport_unavailable'
  | 'unavailable_invalid_advertisement'

export type SandboxOllamaDirectTagsFetchResult = {
  classification: SandboxOllamaDirectTagsClassification
  models: SandboxOllamaDirectRemoteModelEntry[]
  ok: boolean
  http_status: number
  models_count: number
  error_code: string | null
  duration_ms: number
  cache_hit: boolean
  inflight_reused: boolean
}

type CachedPayload = Omit<SandboxOllamaDirectTagsFetchResult, 'cache_hit' | 'inflight_reused'>

type CacheEntry = {
  cachedAtMs: number
  ttlMs: number
  payload: CachedPayload
}

/** Same logical GET — dedupe refreshes / concurrent callers. */
export function buildOllamaDirectTagsCacheKey(
  handshakeId: string,
  peerHostDeviceId: string,
  ollamaDirectBaseUrl: string,
): string {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  const base = String(ollamaDirectBaseUrl ?? '').trim().replace(/\/$/, '')
  return `${hid}:${peer}:${base}:ollama_tags`
}

function ttlMsForClassification(c: SandboxOllamaDirectTagsClassification, modelsCount: number): number {
  if (c === 'available' && modelsCount > 0) return 30_000
  if (c === 'no_models') return 10_000
  if (c === 'transport_unavailable') return 5_000
  if (c === 'unavailable_invalid_advertisement') return 10_000
  return 5_000
}

const cacheByKey = new Map<string, CacheEntry>()
const inflightByKey = new Map<string, Promise<CachedPayload>>()

export function clearSandboxOllamaDirectTagsCacheForTests(): void {
  cacheByKey.clear()
  inflightByKey.clear()
}

/** Drop cached `/api/tags` entries for a handshake (e.g. after `ollama_direct` base URL changes). */
export function invalidateSandboxOllamaDirectTagsCacheForHandshake(handshakeId: string): void {
  const p = `${String(handshakeId ?? '').trim()}:`
  if (!p || p === ':') return
  for (const k of [...cacheByKey.keys()]) {
    if (k.startsWith(p)) cacheByKey.delete(k)
  }
  for (const k of [...inflightByKey.keys()]) {
    if (k.startsWith(p)) inflightByKey.delete(k)
  }
}

function mapTagsToRemoteModels(
  rawModels: Array<{ name?: string; model?: string }>,
  endpointOwner: string,
): SandboxOllamaDirectRemoteModelEntry[] {
  const out: SandboxOllamaDirectRemoteModelEntry[] = []
  for (const m of rawModels) {
    const id = String(m.model ?? m.name ?? '').trim()
    if (!id) continue
    const label = String(m.name ?? m.model ?? id).trim() || id
    out.push({
      id,
      model: id,
      label,
      provider: 'ollama',
      transport: 'ollama_direct',
      source: 'remote_ollama_tags',
      endpoint_owner_device_id: endpointOwner.trim(),
    })
  }
  return out
}

/** Outbound GET only — invoked once per cache miss / single-flight entry (logs TAGS here). */
async function fetchTagsPayloadOutbound(p: {
  handshakeId: string
  currentDeviceId: string
  peerHostDeviceId: string
  candidate: SandboxOllamaDirectRouteCandidate
  baseUrl: string
  endpointRefreshAttempted?: boolean
}): Promise<CachedPayload> {
  const t0 = Date.now()
  const owner = p.peerHostDeviceId.trim()
  const base = p.baseUrl.replace(/\/$/, '')
  const url = `${base}/api/tags`
  let http_status = 0
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    http_status = res.status
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const errCode = `http_${http_status}${text ? `:${text.slice(0, 64)}` : ''}`
      const duration_ms = Date.now() - t0
      logOutboundTags({
        handshake_id: p.handshakeId,
        current_device_id: p.currentDeviceId,
        peer_host_device_id: owner,
        base_url: base,
        ok: false,
        http_status,
        models_count: 0,
        cache_hit: false,
        inflight_reused: false,
        error_code: errCode,
        duration_ms,
      })
      return {
        classification: 'transport_unavailable',
        models: [],
        ok: false,
        http_status,
        models_count: 0,
        error_code: errCode,
        duration_ms,
      }
    }
    const json = await res.json().catch(() => null)
    const duration_ms = Date.now() - t0
    if (json == null || typeof json !== 'object') {
      logOutboundTags({
        handshake_id: p.handshakeId,
        current_device_id: p.currentDeviceId,
        peer_host_device_id: owner,
        base_url: base,
        ok: false,
        http_status,
        models_count: 0,
        cache_hit: false,
        inflight_reused: false,
        error_code: 'invalid_json_body',
        duration_ms,
      })
      return {
        classification: 'unavailable_invalid_advertisement',
        models: [],
        ok: false,
        http_status,
        models_count: 0,
        error_code: 'invalid_json_body',
        duration_ms,
      }
    }
    const parsed = parseOllamaTagsBody(json)
    const models = mapTagsToRemoteModels(parsed.rawModels, owner)
    const models_count = models.length
    const classification: SandboxOllamaDirectTagsClassification =
      models_count > 0 ? 'available' : 'no_models'
    logOutboundTags({
      handshake_id: p.handshakeId,
      current_device_id: p.currentDeviceId,
      peer_host_device_id: owner,
      base_url: base,
      ok: true,
      http_status,
      models_count,
      cache_hit: false,
      inflight_reused: false,
      error_code: null,
      duration_ms,
    })
    return {
      classification,
      models,
      ok: true,
      http_status,
      models_count,
      error_code: null,
      duration_ms,
    }
  } catch (e) {
    const trig = classifyOllamaDirectFetchTransportFailure(e)
    if (trig && !p.endpointRefreshAttempted) {
      const oldUrl = base
      const capOk = (await refreshSandboxOllamaDirectFromHostCapabilities({ handshakeId: p.handshakeId })).ok
      const nc = getSandboxOllamaDirectRouteCandidate(p.handshakeId)
      const refreshedCand =
        nc && typeof nc.base_url === 'string' && nc.base_url.trim() ? nc : p.candidate
      const newUrl = String(refreshedCand.base_url ?? '').trim().replace(/\/$/, '')
      console.log(
        `[SBX_HOST_AI_OLLAMA_DIRECT_ENDPOINT_REFRESH] ${JSON.stringify({
          handshake_id: p.handshakeId,
          old_url: oldUrl || null,
          new_url: newUrl || null,
          trigger_reason: trig,
          caps_refresh_ok: capOk,
          path: 'ollama_direct_tags',
        })}`,
      )
      return fetchTagsPayloadOutbound({
        handshakeId: p.handshakeId,
        currentDeviceId: p.currentDeviceId,
        peerHostDeviceId: p.peerHostDeviceId,
        candidate: refreshedCand,
        baseUrl: refreshedCand.base_url,
        endpointRefreshAttempted: true,
      })
    }
    const duration_ms = Date.now() - t0
    const msg = e instanceof Error ? e.message : String(e)
    logOutboundTags({
      handshake_id: p.handshakeId,
      current_device_id: p.currentDeviceId,
      peer_host_device_id: owner,
      base_url: base,
      ok: false,
      http_status,
      models_count: 0,
      cache_hit: false,
      inflight_reused: false,
      error_code: msg.slice(0, 128),
      duration_ms,
    })
    return {
      classification: 'transport_unavailable',
      models: [],
      ok: false,
      http_status,
      models_count: 0,
      error_code: msg.slice(0, 128),
      duration_ms,
    }
  }
}

function logOutboundTags(p: {
  handshake_id: string
  current_device_id: string
  peer_host_device_id: string
  base_url: string
  ok: boolean
  http_status: number
  models_count: number
  cache_hit: boolean
  inflight_reused: boolean
  error_code: string | null
  duration_ms: number
}): void {
  console.log(`[SBX_HOST_AI_OLLAMA_DIRECT_TAGS] ${JSON.stringify(p)}`)
}

function logCacheHit(p: {
  handshake_id: string
  peer_host_device_id: string
  base_url: string
  models_count: number
  classification: SandboxOllamaDirectTagsClassification
  ttl_remaining_ms: number
}): void {
  console.log(`[SBX_HOST_AI_OLLAMA_DIRECT_CACHE_HIT] ${JSON.stringify(p)}`)
}

function logInflightReuse(p: { handshake_id: string; peer_host_device_id: string; base_url: string }): void {
  console.log(`[SBX_HOST_AI_OLLAMA_DIRECT_INFLIGHT_REUSE] ${JSON.stringify(p)}`)
}

/**
 * GET `{candidate.base_url}/api/tags` on Sandbox — never localhost / Sandbox Ollama manager.
 */
export async function fetchSandboxOllamaDirectTags(p: {
  handshakeId: string
  currentDeviceId: string
  peerHostDeviceId: string
  candidate: SandboxOllamaDirectRouteCandidate
}): Promise<SandboxOllamaDirectTagsFetchResult> {
  const hid = String(p.handshakeId ?? '').trim()
  const peer = String(p.peerHostDeviceId ?? '').trim()
  const baseNorm = String(p.candidate.base_url ?? '').trim().replace(/\/$/, '')
  const cacheKey = buildOllamaDirectTagsCacheKey(hid, peer, baseNorm)

  const now = Date.now()
  const ent = cacheByKey.get(cacheKey)
  if (ent) {
    const expiresAt = ent.cachedAtMs + ent.ttlMs
    if (now < expiresAt) {
      const ttl_remaining_ms = Math.max(0, Math.floor(expiresAt - now))
      logCacheHit({
        handshake_id: hid,
        peer_host_device_id: peer,
        base_url: baseNorm,
        models_count: ent.payload.models_count,
        classification: ent.payload.classification,
        ttl_remaining_ms,
      })
      return { ...ent.payload, cache_hit: true, inflight_reused: false }
    }
    cacheByKey.delete(cacheKey)
  }

  const existing = inflightByKey.get(cacheKey)
  if (existing) {
    logInflightReuse({
      handshake_id: hid,
      peer_host_device_id: peer,
      base_url: baseNorm,
    })
    const payload = await existing
    return { ...payload, cache_hit: false, inflight_reused: true }
  }

  const started = fetchTagsPayloadOutbound({
    handshakeId: hid,
    currentDeviceId: p.currentDeviceId.trim(),
    peerHostDeviceId: peer,
    candidate: p.candidate,
    baseUrl: baseNorm,
  })
  inflightByKey.set(cacheKey, started)
  try {
    const payload = await started
    const ttlMs = ttlMsForClassification(payload.classification, payload.models_count)
    cacheByKey.set(cacheKey, {
      cachedAtMs: Date.now(),
      ttlMs,
      payload,
    })
    return { ...payload, cache_hit: false, inflight_reused: false }
  } finally {
    inflightByKey.delete(cacheKey)
  }
}
