/**
 * Host ↔ Sandbox topology discriminator (Prompt 0).
 *
 * Distinguishes co-located inner-VM sandbox (single_machine) from a separate-machine
 * dedicated sandbox. Consumed by later host-initiated sync prompts — does NOT alter
 * ingestion ownership in this module.
 */

import { hostname, networkInterfaces } from 'os'
import type { HandshakeRecord } from './types'
import { getOrchestratorMode, getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig } from '../p2p/p2pConfig'
import { listActiveInternalHandshakesForHostAi } from '../internalInference/hostAiInternalPairingLedger'
import { deriveInternalHostAiPeerRoles, handshakeSamePrincipal } from '../internalInference/policy'

/** Persisted marker: co-located inner VM vs remote dedicated sandbox pair. */
export type SandboxPairingKind = 'local_inner_vm' | 'remote_dedicated'

/** Resolved topology for sync gating. */
export type SandboxTopologyKind = 'single_machine' | 'dedicated' | 'none'

export function pairingKindToTopologyKind(
  kind: SandboxPairingKind,
): Exclude<SandboxTopologyKind, 'none'> {
  return kind === 'local_inner_vm' ? 'single_machine' : 'dedicated'
}

export function isLoopbackP2pHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

export function hostnameFromP2pUrl(url: string | null | undefined): string | null {
  const ep = typeof url === 'string' ? url.trim() : ''
  if (!ep) return null
  try {
    return new URL(ep).hostname
  } catch {
    return null
  }
}

/** True when `host` names this machine (loopback, os hostname, or a local NIC address). */
export function isHostLocalP2pTarget(
  host: string,
  opts?: { localHostName?: string; localAddresses?: readonly string[] },
): boolean {
  const h = host.trim().toLowerCase()
  if (!h) return false
  if (isLoopbackP2pHost(h)) return true
  const localHost = (opts?.localHostName ?? hostname()).trim().toLowerCase()
  if (localHost && h === localHost) return true
  const addrs =
    opts?.localAddresses ??
    (() => {
      const out: string[] = []
      try {
        for (const ifaces of Object.values(networkInterfaces())) {
          for (const iface of ifaces ?? []) {
            if (iface?.address) out.push(iface.address.toLowerCase())
          }
        }
      } catch {
        /* never crash on NIC enumeration */
      }
      return out
    })()
  return addrs.includes(h)
}

function usesLocalRelayStack(db: unknown): boolean {
  if (!db) return false
  try {
    const p2p = getP2PConfig(db as Parameters<typeof getP2PConfig>[0])
    if (p2p.relay_mode !== 'local') return false
    const coord = (p2p.coordination_url ?? p2p.relay_url ?? '').trim()
    if (!coord) return false
    const host = hostnameFromP2pUrl(coord)
    return host != null && isHostLocalP2pTarget(host)
  } catch {
    return false
  }
}

/**
 * Infer pairing kind from handshake + optional persisted marker.
 * Never throws; defaults to `remote_dedicated` when signals are ambiguous.
 */
export function inferSandboxPairingKindFromHandshake(
  record: HandshakeRecord,
  opts?: {
    db?: unknown
    explicitKind?: SandboxPairingKind | null
    localHostName?: string
    localAddresses?: readonly string[]
  },
): SandboxPairingKind {
  const explicit = opts?.explicitKind ?? record.topology_pairing_kind ?? null
  if (explicit === 'local_inner_vm' || explicit === 'remote_dedicated') {
    return explicit
  }

  const peerHost = hostnameFromP2pUrl(record.p2p_endpoint)
  if (peerHost && isHostLocalP2pTarget(peerHost, opts)) {
    return 'local_inner_vm'
  }

  if (usesLocalRelayStack(opts?.db)) {
    return 'local_inner_vm'
  }

  return 'remote_dedicated'
}

function getLinkedPairingKindForHandshake(handshakeId: string): SandboxPairingKind | null {
  try {
    const linked = getOrchestratorMode().linked ?? []
    const entry = linked.find((e) => e.handshakeId === handshakeId)
    if (entry?.pairingKind === 'local_inner_vm' || entry?.pairingKind === 'remote_dedicated') {
      return entry.pairingKind
    }
  } catch {
    /* missing/parse-failed config → infer */
  }
  return null
}

/** ACTIVE same-principal internal Host↔Sandbox row involving this device, or null. */
export function findActiveInternalHostSandboxHandshake(db: unknown): HandshakeRecord | null {
  if (!db) return null
  const localId = getInstanceId().trim()
  if (!localId) return null
  for (const r of listActiveInternalHandshakesForHostAi(db)) {
    if (!handshakeSamePrincipal(r)) continue
    if (!r.internal_coordination_identity_complete) continue
    const dr = deriveInternalHostAiPeerRoles(r, localId)
    if (!dr.ok) continue
    const isHostSandboxPair =
      (dr.localRole === 'host' && dr.peerRole === 'sandbox') ||
      (dr.localRole === 'sandbox' && dr.peerRole === 'host')
    if (isHostSandboxPair) return r
  }
  return null
}

/**
 * Single helper for later prompts: co-located inner-VM vs dedicated vs unpaired.
 */
export function resolveSandboxTopologyKind(db?: unknown): SandboxTopologyKind {
  const record = findActiveInternalHostSandboxHandshake(db)
  if (!record) return 'none'
  const linkedKind = getLinkedPairingKindForHandshake(record.handshake_id)
  const pairingKind = inferSandboxPairingKindFromHandshake(record, {
    db,
    explicitKind: linkedKind ?? record.topology_pairing_kind ?? undefined,
  })
  return pairingKindToTopologyKind(pairingKind)
}
