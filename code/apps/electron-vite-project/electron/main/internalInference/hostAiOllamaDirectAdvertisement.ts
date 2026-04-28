/**
 * Host-side validation for advertising LAN Ollama (`ollama_direct`).
 * Requires successful GET on loopback **and** on the Host LAN bind — localhost alone is insufficient proof for Sandbox reachability.
 */

import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { InternalInferenceErrorCode } from './errors'
import { buildHostOllamaDirectBaseUrl, selectHostLanIpForPeer } from './hostAiOllamaDirectLanIp'
import {
  fetchOllamaApiTagsJson,
  normalizeHostLoopbackOllamaBaseUrl,
  parseOllamaTagsBody,
} from './hostAiOllamaNativeDiscovery'
import { ollamaManager } from '../llm/ollama-manager'

export type HostOllamaDirectAdvertisement = {
  transport: 'ollama_direct'
  available: boolean
  base_url: string | null
  host_lan_ip: string | null
  endpoint_owner_device_id: string
  models_count: number
  error_code: string | null
  source: 'host_network_interfaces'
  created_at: string
  /** When LAN responds OK but `/api/tags` has zero models — not policy_disabled. */
  classification?: 'no_models'
}

export type HostOllamaDirectAdvertisementOpts = {
  peer_device_id?: string | null
  /**
   * When set (e.g. after Host loopback `/api/tags` for caps build), reused so we do not duplicate the localhost probe.
   * Must correspond to `GET` against {@link normalizeHostLoopbackOllamaBaseUrl}(manager URL) — i.e. `127.0.0.1:<port>/api/tags`.
   */
  localTagsPrefetch?: { ok: boolean; json: unknown | null }
}

function isoNow(): string {
  return new Date().toISOString()
}

export function logHostAiOllamaDirectAdvertisement(payload: {
  current_device_id: string
  peer_device_id: string | null
  selected_host_lan_ip: string | null
  base_url: string | null
  local_ollama_ok: boolean
  lan_ollama_ok: boolean
  local_models_count: number
  lan_models_count: number
  advertised: boolean
  error_code: string | null
  reason: string
}): void {
  console.log(`[HOST_AI_OLLAMA_DIRECT_ADVERTISEMENT] ${JSON.stringify(payload)}`)
}

/**
 * Validates loopback Ollama (`127.0.0.1`) **and** LAN-bound Ollama (`http://<selected Host LAN IPv4>:port`).
 * Sets `available` only when the LAN URL succeeds — localhost success alone never implies Sandbox-reachable LAN Ollama.
 */
export async function buildHostOllamaDirectAdvertisement(
  peerIp?: string | null,
  opts?: HostOllamaDirectAdvertisementOpts,
): Promise<HostOllamaDirectAdvertisement> {
  const currentDeviceId = getInstanceId().trim()
  const peerDeviceId =
    opts?.peer_device_id != null && String(opts.peer_device_id).trim()
      ? String(opts.peer_device_id).trim()
      : null

  const loopBase = normalizeHostLoopbackOllamaBaseUrl(ollamaManager.getBaseUrl())

  const localFetch = opts?.localTagsPrefetch
    ? { ok: opts.localTagsPrefetch.ok, json: opts.localTagsPrefetch.json }
    : await fetchOllamaApiTagsJson(loopBase)

  const localParsed = parseOllamaTagsBody(localFetch.ok ? localFetch.json : null)
  const localModelsCount = localParsed.rawCount
  const localOk = Boolean(localFetch.ok && localFetch.json != null)

  if (!localOk) {
    const adv: HostOllamaDirectAdvertisement = {
      transport: 'ollama_direct',
      available: false,
      base_url: null,
      host_lan_ip: null,
      endpoint_owner_device_id: currentDeviceId,
      models_count: 0,
      error_code: InternalInferenceErrorCode.OLLAMA_LOCAL_UNREACHABLE,
      source: 'host_network_interfaces',
      created_at: isoNow(),
    }
    logHostAiOllamaDirectAdvertisement({
      current_device_id: currentDeviceId,
      peer_device_id: peerDeviceId,
      selected_host_lan_ip: null,
      base_url: null,
      local_ollama_ok: false,
      lan_ollama_ok: false,
      local_models_count: localModelsCount,
      lan_models_count: 0,
      advertised: false,
      error_code: InternalInferenceErrorCode.OLLAMA_LOCAL_UNREACHABLE,
      reason: 'ollama_local_unreachable',
    })
    return adv
  }

  const hostLanIp = selectHostLanIpForPeer(peerIp)
  const lanBase = buildHostOllamaDirectBaseUrl(peerIp)

  if (!hostLanIp || !lanBase) {
    const adv: HostOllamaDirectAdvertisement = {
      transport: 'ollama_direct',
      available: false,
      base_url: null,
      host_lan_ip: null,
      endpoint_owner_device_id: currentDeviceId,
      models_count: 0,
      error_code: InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
      source: 'host_network_interfaces',
      created_at: isoNow(),
    }
    logHostAiOllamaDirectAdvertisement({
      current_device_id: currentDeviceId,
      peer_device_id: peerDeviceId,
      selected_host_lan_ip: null,
      base_url: null,
      local_ollama_ok: true,
      lan_ollama_ok: false,
      local_models_count: localModelsCount,
      lan_models_count: 0,
      advertised: false,
      error_code: InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
      reason: 'no_host_lan_ipv4_candidate',
    })
    return adv
  }

  const lanFetch = await fetchOllamaApiTagsJson(lanBase)
  const lanParsed = parseOllamaTagsBody(lanFetch.ok ? lanFetch.json : null)
  const lanModelsCount = lanParsed.rawCount
  const lanOk = Boolean(lanFetch.ok && lanFetch.json != null)

  if (!lanOk) {
    const adv: HostOllamaDirectAdvertisement = {
      transport: 'ollama_direct',
      available: false,
      base_url: null,
      host_lan_ip: hostLanIp,
      endpoint_owner_device_id: currentDeviceId,
      models_count: 0,
      error_code: InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
      source: 'host_network_interfaces',
      created_at: isoNow(),
    }
    logHostAiOllamaDirectAdvertisement({
      current_device_id: currentDeviceId,
      peer_device_id: peerDeviceId,
      selected_host_lan_ip: hostLanIp,
      base_url: lanBase,
      local_ollama_ok: true,
      lan_ollama_ok: false,
      local_models_count: localModelsCount,
      lan_models_count: 0,
      advertised: false,
      error_code: InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
      reason: 'ollama_lan_bind_unreachable_or_bad_response',
    })
    return adv
  }

  const classification: 'no_models' | undefined = lanModelsCount === 0 ? 'no_models' : undefined

  const adv: HostOllamaDirectAdvertisement = {
    transport: 'ollama_direct',
    available: true,
    base_url: lanBase,
    host_lan_ip: hostLanIp,
    endpoint_owner_device_id: currentDeviceId,
    models_count: lanModelsCount,
    error_code: null,
    source: 'host_network_interfaces',
    created_at: isoNow(),
    ...(classification ? { classification } : {}),
  }

  logHostAiOllamaDirectAdvertisement({
    current_device_id: currentDeviceId,
    peer_device_id: peerDeviceId,
    selected_host_lan_ip: hostLanIp,
    base_url: lanBase,
    local_ollama_ok: true,
    lan_ollama_ok: true,
    local_models_count: localModelsCount,
    lan_models_count: lanModelsCount,
    advertised: true,
    error_code: null,
    reason:
      classification === 'no_models'
        ? 'ollama_direct_ready_empty_tags'
        : 'ollama_direct_ready',
  })

  return adv
}
