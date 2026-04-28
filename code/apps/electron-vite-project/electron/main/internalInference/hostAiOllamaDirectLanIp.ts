/**
 * Host LAN IPv4 discovery for future `ollama_direct` advertisement (Host machine interfaces only — never Sandbox IPs).
 */

import { networkInterfaces } from 'node:os'
import { ollamaManager } from '../llm/ollama-manager'

function parseIpv4Octets(ip: string): number[] | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  const o = parts.map((x) => Number(x))
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return o
}

function isRfc1918PrivateIpv4(ip: string): boolean {
  const o = parseIpv4Octets(ip)
  if (!o) return false
  const [a, b] = o
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** Excludes loopback / link-local ranges regardless of interface name. */
function isExcludedIpv4SpecialRanges(ip: string): boolean {
  const o = parseIpv4Octets(ip)
  if (!o) return true
  const [a, b] = o
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  return false
}

function ipv4SameSlash24(a: string, b: string): boolean {
  const pa = parseIpv4Octets(a)
  const pb = parseIpv4Octets(b)
  if (!pa || !pb) return false
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2]
}

/** Prefer 192.168/16, then 10/8, then 172.16–31/12; then numeric order. */
function privateLanPreferenceScore(ip: string): [number, number, number, number, number] {
  const o = parseIpv4Octets(ip)
  if (!o) return [99, 999, 999, 999, 999]
  const [a, b, c, d] = o
  let tier = 9
  if (a === 192 && b === 168) tier = 0
  else if (a === 10) tier = 1
  else if (a === 172 && b >= 16 && b <= 31) tier = 2
  return [tier, a, b, c, d]
}

function comparePrivateLanCandidates(a: string, b: string): number {
  const ka = privateLanPreferenceScore(a)
  const kb = privateLanPreferenceScore(b)
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i]
  }
  return 0
}

export function sortPrivateLanCandidates(ips: readonly string[]): string[] {
  return [...ips].sort(comparePrivateLanCandidates)
}

function interfaceNameExcluded(name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n === 'lo' || n === 'lo0') return true
  if (n.startsWith('docker')) return true
  if (n.startsWith('br-')) return true
  if (n.startsWith('veth')) return true
  if (n.includes('virtualbox')) return true
  if (n.includes('vmware')) return true
  return false
}

function normalizeOptionalIpv4(peerIp?: string | null): string | null {
  const s = typeof peerIp === 'string' ? peerIp.trim() : ''
  if (!s) return null
  return parseIpv4Octets(s) ? s : null
}

/**
 * RFC1918 IPv4 addresses from this Host's interfaces (IPv4 only).
 * Excludes loopback/link-local ranges, loopback/internal NICs, docker/bridge/vm patterns.
 */
export function getHostLanIpCandidates(): string[] {
  const nets = networkInterfaces()
  const found = new Set<string>()
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs?.length || interfaceNameExcluded(name)) continue
    for (const a of addrs) {
      const fam = a.family
      if (fam !== 'IPv4' && fam !== 4) continue
      if (a.internal) continue
      const ip = typeof a.address === 'string' ? a.address.trim() : ''
      if (!ip || isExcludedIpv4SpecialRanges(ip)) continue
      if (!isRfc1918PrivateIpv4(ip)) continue
      found.add(ip)
    }
  }
  return sortPrivateLanCandidates([...found])
}

function computeLanIpSelection(peerIp?: string | null): {
  selected: string | null
  candidates: string[]
  reason: string
} {
  const candidates = getHostLanIpCandidates()
  if (candidates.length === 0) {
    return { selected: null, candidates: [], reason: 'no_private_lan_candidates' }
  }
  const peer = normalizeOptionalIpv4(peerIp ?? undefined)
  if (peer && isRfc1918PrivateIpv4(peer)) {
    const same24 = candidates.filter((c) => ipv4SameSlash24(c, peer))
    if (same24.length > 0) {
      const sortedSub = sortPrivateLanCandidates(same24)
      return {
        selected: sortedSub[0],
        candidates,
        reason: 'same_slash24_as_peer',
      }
    }
    return {
      selected: candidates[0],
      candidates,
      reason: 'peer_ip_no_shared_slash24_first_sorted_private',
    }
  }
  return {
    selected: candidates[0],
    candidates,
    reason: peer ? 'peer_ip_invalid_or_non_private_first_sorted_private' : 'no_peer_ip_first_sorted_private',
  }
}

/** Prefer Host LAN IPv4 in same /24 as peer when peer is a usable RFC1918 address; otherwise first sorted private candidate. */
export function selectHostLanIpForPeer(peerIp?: string | null): string | null {
  return computeLanIpSelection(peerIp).selected
}

/** TCP port Host Ollama listens on (from orchestrator config / manager). */
export function hostOllamaListenPort(): number {
  try {
    const u = new URL(ollamaManager.getBaseUrl())
    const p = parseInt(u.port || '11434', 10)
    return Number.isFinite(p) && p > 0 ? p : 11434
  } catch {
    return 11434
  }
}

/** `http://<host-lan-ipv4>:<ollama-port>` from Host config — null if no LAN candidate. */
export function buildHostOllamaDirectBaseUrl(peerIp?: string | null): string | null {
  const ip = selectHostLanIpForPeer(peerIp)
  if (!ip) return null
  const port = hostOllamaListenPort()
  return `http://${ip}:${port}`
}

/** Extract IPv4 hostname from an http(s) URL (e.g. ledger BEAP ingest) as optional Sandbox/LAN peer hint — never trusts path. */
export function extractPeerLanIpv4HintFromHttpUrl(raw: string | null | undefined): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s || !/^https?:\/\//i.test(s)) return null
  try {
    const host = new URL(s).hostname
    if (!parseIpv4Octets(host)) return null
    if (isExcludedIpv4SpecialRanges(host)) return null
    if (!isRfc1918PrivateIpv4(host)) return null
    return host
  } catch {
    return null
  }
}

export function logHostAiOllamaDirectIpSelect(payload: {
  current_device_id: string
  peer_device_id: string | null
  peer_ip: string | null
  candidates: string[]
  selected_host_lan_ip: string | null
  reason: string
}): void {
  console.log(`[HOST_AI_OLLAMA_DIRECT_IP_SELECT] ${JSON.stringify(payload)}`)
}

/** Runs LAN selection once and emits `[HOST_AI_OLLAMA_DIRECT_IP_SELECT]` (advertisement wiring comes later). */
export function recordHostAiOllamaDirectLanProbeLine(input: {
  current_device_id: string
  peer_device_id: string | null
  peer_ip_hint: string | null
}): void {
  const { selected, candidates, reason } = computeLanIpSelection(input.peer_ip_hint)
  logHostAiOllamaDirectIpSelect({
    current_device_id: input.current_device_id,
    peer_device_id: input.peer_device_id,
    peer_ip: input.peer_ip_hint,
    candidates,
    selected_host_lan_ip: selected,
    reason,
  })
}
