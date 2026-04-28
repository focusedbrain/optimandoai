/**
 * Sandbox-side validation of Host `ollama_direct_*` capability fields — candidate metadata only (no HTTP fetch).
 */

import { HOST_AI_ROUTE_KIND_OLLAMA_DIRECT } from './hostAiOllamaDirect'
import { getHostLanIpCandidates } from './hostAiOllamaDirectLanIp'
import type { InternalInferenceCapabilitiesResultWire } from './types'

const DEFAULT_ALLOWED_PORTS = new Set([11434])

function readAllowedPortsFromEnv(): Set<number> {
  const raw = (process.env.WRDESK_HOST_AI_OLLAMA_DIRECT_ALLOWED_PORTS ?? '').trim()
  if (!raw) return new Set(DEFAULT_ALLOWED_PORTS)
  const next = new Set<number>()
  for (const part of raw.split(',')) {
    const n = parseInt(part.trim(), 10)
    if (Number.isFinite(n) && n > 0 && n <= 65535) next.add(n)
  }
  return next.size > 0 ? next : new Set(DEFAULT_ALLOWED_PORTS)
}

function portExplicitlyAllowed(port: number): boolean {
  return readAllowedPortsFromEnv().has(port)
}

/** Canonical LAN IPv4 addresses on this machine (Sandbox); reused from Host LAN helper — same OS semantics. */
function sandboxLanIpv4Set(): Set<string> {
  return new Set(getHostLanIpCandidates().map((s) => s.trim().toLowerCase()))
}

function normalizeHostname(raw: string): string {
  let h = raw.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1)
  }
  return h
}

function isForbiddenLoopbackHostname(h: string): boolean {
  const n = normalizeHostname(h)
  if (n === 'localhost') return true
  if (n === '127.0.0.1') return true
  if (n === '::1') return true
  return false
}

export type SandboxOllamaDirectRouteCandidate = {
  route_kind: typeof HOST_AI_ROUTE_KIND_OLLAMA_DIRECT
  handshake_id: string
  base_url: string
  endpoint_owner_device_id: string
  peer_host_device_id: string
  validated_at_ms: number
}

const candidatesByHandshake = new Map<string, SandboxOllamaDirectRouteCandidate>()

export function getSandboxOllamaDirectRouteCandidate(handshakeId: string): SandboxOllamaDirectRouteCandidate | undefined {
  return candidatesByHandshake.get(String(handshakeId ?? '').trim())
}

export function clearSandboxOllamaDirectRouteCandidatesForTests(): void {
  candidatesByHandshake.clear()
}

export type SbxHostAiOllamaDirectSelectedLogPayload = {
  handshake_id: string
  current_device_id: string
  peer_host_device_id: string
  endpoint_owner_device_id: string | undefined
  base_url: string | undefined
  accepted: boolean
  rejected_reason: string | null
  reason: string
}

function logSbxHostAiOllamaDirectSelected(p: SbxHostAiOllamaDirectSelectedLogPayload): void {
  console.log(`[SBX_HOST_AI_OLLAMA_DIRECT_SELECTED] ${JSON.stringify(p)}`)
}

function parseAndValidateDirectBaseUrl(
  baseUrlRaw: string,
  sandboxLan: Set<string>,
): { ok: true; normalizedUrl: string } | { ok: false; rejected_reason: string; reason: string } {
  let u: URL
  try {
    u = new URL(baseUrlRaw)
  } catch {
    return { ok: false, rejected_reason: 'invalid_url', reason: 'url_parse_failed' }
  }
  const proto = u.protocol.toLowerCase()
  if (proto !== 'http:' && proto !== 'https:') {
    return { ok: false, rejected_reason: 'invalid_protocol', reason: `protocol_${proto.replace(':', '') || 'empty'}` }
  }
  const host = u.hostname
  if (!host?.trim()) {
    return { ok: false, rejected_reason: 'missing_host', reason: 'empty_hostname' }
  }
  if (isForbiddenLoopbackHostname(host)) {
    return { ok: false, rejected_reason: 'localhost_or_loopback_host', reason: `host_${normalizeHostname(host)}` }
  }
  const hostNorm = normalizeHostname(host)
  if (hostNorm.includes(':')) {
    /** IPv6 — only block ::1; other v6 not compared to sandbox LAN v4 list without v6 enumeration. */
    if (hostNorm === '::1') {
      return { ok: false, rejected_reason: 'localhost_or_loopback_host', reason: 'ipv6_loopback' }
    }
  } else {
    /** IPv4 or hostname: reject if IPv4 equals a sandbox LAN address from interfaces. */
    if (sandboxLan.has(hostNorm)) {
      return { ok: false, rejected_reason: 'base_url_host_is_sandbox_lan_ip', reason: `host_matches_sandbox_lan_${hostNorm}` }
    }
  }
  let port = u.port ? parseInt(u.port, 10) : NaN
  if (!Number.isFinite(port) || port <= 0) {
    port = proto === 'https:' ? 443 : 80
  }
  if (!portExplicitlyAllowed(port)) {
    return {
      ok: false,
      rejected_reason: 'port_not_allowed',
      reason: `port_${port}_not_in_allowed_set`,
    }
  }
  return { ok: true, normalizedUrl: baseUrlRaw.trim() }
}

/**
 * Validates Host `ollama_direct_*` fields and stores an internal route candidate when accepted.
 * Does not GET Ollama; does not affect chat execution.
 */
export function evaluateSandboxHostAiOllamaDirectFromCapabilitiesWire(p: {
  handshakeId: string
  currentDeviceId: string
  peerHostDeviceId: string
  wire: InternalInferenceCapabilitiesResultWire
}): void {
  const hid = String(p.handshakeId ?? '').trim()
  const cur = String(p.currentDeviceId ?? '').trim()
  const peer = String(p.peerHostDeviceId ?? '').trim()
  const w = p.wire

  const ownerRaw = typeof w.endpoint_owner_device_id === 'string' ? w.endpoint_owner_device_id.trim() : ''
  const baseUrlRaw = typeof w.ollama_direct_base_url === 'string' ? w.ollama_direct_base_url.trim() : ''
  const avail = w.ollama_direct_available === true

  const emit = (
    accepted: boolean,
    rejected_reason: string | null,
    reason: string,
    cand?: SandboxOllamaDirectRouteCandidate,
  ): void => {
    if (accepted && cand) {
      candidatesByHandshake.set(hid, cand)
    } else {
      candidatesByHandshake.delete(hid)
    }
    logSbxHostAiOllamaDirectSelected({
      handshake_id: hid,
      current_device_id: cur,
      peer_host_device_id: peer || '(missing)',
      endpoint_owner_device_id: ownerRaw || undefined,
      base_url: baseUrlRaw || undefined,
      accepted,
      rejected_reason,
      reason,
    })
  }

  if (!peer) {
    candidatesByHandshake.delete(hid)
    emit(false, 'missing_peer_host_device_id', 'reject_missing_peer_host_device_id')
    return
  }

  if (!avail || !baseUrlRaw || ownerRaw !== peer) {
    candidatesByHandshake.delete(hid)
    const rr =
      !avail ? 'ollama_direct_not_available' : !baseUrlRaw ? 'missing_ollama_direct_base_url' : 'endpoint_owner_not_peer_host'
    const rs =
      !avail ? 'advertisement_off' : !baseUrlRaw ? 'no_base_url' : `owner_${ownerRaw || 'empty'}_neq_peer_${peer}`
    logSbxHostAiOllamaDirectSelected({
      handshake_id: hid,
      current_device_id: cur,
      peer_host_device_id: peer,
      endpoint_owner_device_id: ownerRaw || undefined,
      base_url: baseUrlRaw || undefined,
      accepted: false,
      rejected_reason: rr,
      reason: rs,
    })
    return
  }

  const lan = sandboxLanIpv4Set()
  const parsed = parseAndValidateDirectBaseUrl(baseUrlRaw, lan)
  if (!parsed.ok) {
    emit(false, parsed.rejected_reason, parsed.reason)
    return
  }

  const cand: SandboxOllamaDirectRouteCandidate = {
    route_kind: HOST_AI_ROUTE_KIND_OLLAMA_DIRECT,
    handshake_id: hid,
    base_url: parsed.normalizedUrl,
    endpoint_owner_device_id: ownerRaw,
    peer_host_device_id: peer,
    validated_at_ms: Date.now(),
  }
  emit(true, null, 'ollama_direct_candidate_accepted', cand)
}
