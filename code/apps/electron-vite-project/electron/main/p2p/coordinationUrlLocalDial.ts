/**
 * Same-machine coordination relay dial normalization.
 *
 * Persisted coordination_url / coordination_ws_url may use a LAN IP (session bootstrap).
 * When the relay process is co-located on this machine, outbound dials use 127.0.0.1.
 * Remote peers (sandbox → host relay) keep the network URL unchanged.
 */

import { networkInterfaces } from 'os'
import { isP2pPublishedHostLoopback } from './p2pConfig'

const KNOWN_PUBLIC_COORDINATION_HOSTS = new Set([
  'relay.wrdesk.com',
  'coordination.wrdesk.com',
  'relay.optirando.com',
  'coordination.optirando.com',
])

function normalizeHostname(hostname: string): string {
  const h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.includes(']')) {
    return h.slice(1, h.indexOf(']')).toLowerCase()
  }
  return h
}

function parseUrlHostname(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null
  try {
    const withScheme =
      raw.startsWith('ws://') || raw.startsWith('wss://') || raw.startsWith('http://') || raw.startsWith('https://')
        ? raw
        : `http://${raw}`
    return normalizeHostname(new URL(withScheme).hostname)
  } catch {
    return null
  }
}

function collectThisMachineHostnames(): Set<string> {
  const out = new Set<string>(['127.0.0.1', 'localhost', '::1'])
  try {
    const nets = networkInterfaces()
    for (const addrs of Object.values(nets)) {
      if (!addrs) continue
      for (const addr of addrs) {
        const isV4 = addr.family === 'IPv4' || addr.family === 4
        if (isV4) {
          out.add(addr.address.toLowerCase())
        }
      }
    }
  } catch {
    /* non-fatal */
  }
  return out
}

let cachedLocalHostnames: Set<string> | null = null
let localHostnamesOverrideForTests: Set<string> | null = null

/** Test hook: reset cached NIC list between cases. */
export function resetCoordinationLocalHostnameCacheForTests(): void {
  cachedLocalHostnames = null
  localHostnamesOverrideForTests = null
}

/** Test hook: inject local hostnames (bypasses os.networkInterfaces). */
export function setCoordinationLocalHostnamesForTests(hostnames: string[] | null): void {
  localHostnamesOverrideForTests = hostnames
    ? new Set(hostnames.map((h) => h.trim().toLowerCase()))
    : null
  cachedLocalHostnames = null
}

function localMachineHostnames(): Set<string> {
  if (localHostnamesOverrideForTests) {
    return localHostnamesOverrideForTests
  }
  if (!cachedLocalHostnames) {
    cachedLocalHostnames = collectThisMachineHostnames()
  }
  return cachedLocalHostnames
}

/**
 * Co-location signal: persisted coordination hostname matches loopback or a local
 * NIC IPv4 from os.networkInterfaces(). Known public relay hostnames are never
 * co-located (sandbox / cloud paths stay on the network URL).
 */
export function isCoordinationRelayColocated(coordinationUrl: string): boolean {
  const host = parseUrlHostname(coordinationUrl)
  if (!host) return false
  if (KNOWN_PUBLIC_COORDINATION_HOSTS.has(host)) return false
  if (isP2pPublishedHostLoopback(host)) return true
  return localMachineHostnames().has(host)
}

function rewriteHostnameToLoopback(url: string): string {
  const raw = url.trim()
  if (!raw) return raw
  try {
    const u = new URL(raw)
    u.hostname = '127.0.0.1'
    const out = u.toString()
    if (out.endsWith('/') && u.pathname === '/') {
      return out.slice(0, -1)
    }
    return out
  } catch {
    return raw
  }
}

/** HTTP(S) coordination base URL for outbound dial (POST /beap/capsule, /beap/p2p-signal, …). */
export function normalizeCoordinationUrlForLocalDial(url: string): string {
  const trimmed = url?.trim() ?? ''
  if (!trimmed) return trimmed
  if (!isCoordinationRelayColocated(trimmed)) return trimmed
  return rewriteHostnameToLoopback(trimmed)
}

/** WebSocket coordination URL for outbound dial (ws/wss preserved). */
export function normalizeCoordinationWsUrlForLocalDial(url: string): string {
  return normalizeCoordinationUrlForLocalDial(url)
}
