/**
 * Resolve peer LAN `/beap/ingest` URLs for outbound queue delivery and host→sandbox triggers.
 * Prefer port-correct direct ingest over stale ledger rows that still carry coordination/default ports.
 */

import { getHandshakeRecord } from './db'
import {
  ingestUrlMatchesThisDevicesMvpDirectBeap,
  normalizeP2pIngestUrl,
  peekHostAdvertisedMvpDirectEntry,
} from '../internalInference/p2pEndpointRepair'
import { p2pEndpointMvpClass } from '../internalInference/policy'
import { DEFAULT_P2P_CONFIG, getP2PConfig } from '../p2p/p2pConfig'

export function isDirectBeapIngestEndpoint(endpoint: string): boolean {
  const u = endpoint.trim().toLowerCase()
  return u.includes('/beap/ingest')
}

function tryNormalizeDirectIngest(raw: string | null | undefined, seen: Set<string>): string | null {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t || !isDirectBeapIngestEndpoint(t)) return null
  const n = normalizeP2pIngestUrl(t)
  if (seen.has(n)) return null
  seen.add(n)
  return n
}

function portFromUrl(url: string): number | null {
  try {
    const u = new URL(url)
    if (u.port) return parseInt(u.port, 10)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

function coordinationPortFromConfig(db: unknown): number | null {
  if (!db) return null
  try {
    const cfg = getP2PConfig(db as never)
    const base = cfg.coordination_url?.trim()
    if (!base) return null
    return portFromUrl(base.replace(/\/$/, ''))
  } catch {
    return null
  }
}

/**
 * When the ledger stored the coordination listener port (or pre-migration default) instead of the
 * live P2P ingest port, rewrite to the deployment-canonical ingest port while keeping peer hostname.
 */
export function repairStalePeerDirectBeapIngestPort(db: unknown, ledgerUrl: string): string | null {
  if (!db) return null
  let norm: string
  try {
    norm = normalizeP2pIngestUrl(ledgerUrl.trim())
  } catch {
    return null
  }
  if (!isDirectBeapIngestEndpoint(norm)) return null

  const cfg = getP2PConfig(db as never)
  const canonicalPort = cfg.port
  let peerHost: string
  let ledgerPort: number | null
  try {
    const u = new URL(norm)
    peerHost = u.hostname
    ledgerPort = portFromUrl(norm)
  } catch {
    return null
  }
  if (!peerHost || ledgerPort == null) return null

  const coordPort = coordinationPortFromConfig(db)
  const staleCoordPort = coordPort != null && ledgerPort === coordPort && ledgerPort !== canonicalPort
  const staleDefaultPort =
    ledgerPort === DEFAULT_P2P_CONFIG.port && canonicalPort !== DEFAULT_P2P_CONFIG.port

  if (!staleCoordPort && !staleDefaultPort) return null

  const proto = norm.startsWith('https') ? 'https' : 'http'
  const hostPart = peerHost.includes(':') && !peerHost.startsWith('[') ? `[${peerHost}]` : peerHost
  return normalizeP2pIngestUrl(`${proto}://${hostPart}:${canonicalPort}/beap/ingest`)
}

function isViablePeerDirectIngest(db: unknown, url: string): boolean {
  if (!db) return true
  const dbAny = db as never
  if (p2pEndpointMvpClass(dbAny, url) !== 'direct_lan') return false
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(dbAny, url)) return false
  return true
}

/** Sandbox→host outbound queue: resolve peer LAN `/beap/ingest` when the row still points at coordination relay. */
export function resolvePeerDirectBeapIngestEndpoint(
  db: unknown,
  handshakeId: string,
  queueTargetEndpoint: string,
): string | null {
  const seen = new Set<string>()
  for (const raw of [
    queueTargetEndpoint,
    peekHostAdvertisedMvpDirectEntry(handshakeId)?.url,
    getHandshakeRecord(db as never, handshakeId)?.p2p_endpoint,
  ]) {
    const u = tryNormalizeDirectIngest(raw, seen)
    if (u) return u
  }
  return null
}

/** Host→sandbox ingestion poll trigger: resolve sandbox peer direct ingest; repair stale coordination/default port. */
export function resolveSandboxPeerDirectBeapIngestEndpoint(
  db: unknown,
  handshakeId: string,
  ledgerP2pEndpoint: string | null | undefined,
): string | null {
  const ledger = typeof ledgerP2pEndpoint === 'string' ? ledgerP2pEndpoint.trim() : ''
  const repaired = ledger && db ? repairStalePeerDirectBeapIngestPort(db, ledger) : null
  const seen = new Set<string>()
  for (const raw of [repaired, ledger]) {
    const u = tryNormalizeDirectIngest(raw, seen)
    if (!u) continue
    if (!isViablePeerDirectIngest(db, u)) continue
    return u
  }
  return null
}
