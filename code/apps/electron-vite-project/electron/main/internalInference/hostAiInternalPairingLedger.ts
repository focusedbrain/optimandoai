/**
 * Ledger pairing checks for internal same-principal Host ↔ Sandbox (Host AI).
 * Kept separate from listInferenceTargets to avoid circular imports with policy resolution.
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { deriveInternalHostAiPeerRoles, handshakeSamePrincipal } from './policy'

/**
 * Permanent Host↔Sandbox pair eligibility from the ACTIVE internal handshake ledger only.
 * Never gated by presence TTL, relay-ad freshness, transport readiness, or Date.now().
 */
export function isHostSandboxPairEligible(r: HandshakeRecord): boolean {
  if (r.state !== HandshakeState.ACTIVE) return false
  if (r.handshake_type !== 'internal') return false
  if (!handshakeSamePrincipal(r)) return false
  const ini = (r.initiator_coordination_device_id ?? '').trim()
  const acc = (r.acceptor_coordination_device_id ?? '').trim()
  if (!ini || !acc) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  if (!dr.ok) return false
  const rolePairOk =
    (dr.localRole === 'sandbox' && dr.peerRole === 'host') ||
    (dr.localRole === 'host' && dr.peerRole === 'sandbox')
  if (!rolePairOk) return false
  if (r.internal_coordination_identity_complete !== true) return false
  return true
}

/** This instance is Host and peer is Sandbox (same account). */
export function rowProvesLocalHostPeerSandboxForHostAi(r: HandshakeRecord): boolean {
  if (!isHostSandboxPairEligible(r)) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  return dr.ok && dr.localRole === 'host' && dr.peerRole === 'sandbox'
}

/** This instance is Sandbox and peer is Host (same account). */
export function rowProvesLocalSandboxToHostForHostAi(r: HandshakeRecord): boolean {
  if (!isHostSandboxPairEligible(r)) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  return dr.ok && dr.localRole === 'sandbox' && dr.peerRole === 'host'
}

/**
 * ACTIVE `internal` handshakes for Host-AI ledger derivation. The host-side scan
 * ({@link hostHasActiveInternalLedgerHostPeerSandboxFromDb}) and the sandbox-side scans
 * (`anyActiveRowProvesLocalSandboxToHostFromDb`, `resolveActiveSandboxToHostHandshakeId`, the
 * list-targets pass) MUST share this helper so the directional pair `host_peer_sandbox` /
 * `sandbox_to_host` derives **symmetrically** across the post-split host & sandbox processes.
 *
 * It deliberately does NOT apply `filterHandshakeRecordsForCurrentSession`: the ledger DB is already
 * SSO-key encrypted, so only the current identity's rows are present — the extra session filter was
 * redundant for Concern B and was the sole cause of the host(unfiltered)/sandbox(filtered) asymmetry.
 * The §2 boundary is per-row eligibility (`handshakeSamePrincipal` + role derivation) plus the
 * per-handshake publisher assert and credential possession on the serve/consume paths — never this
 * enumeration. UI / routing visibility keeps `filterHandshakeRecordsForCurrentSession` (Concern A).
 */
export function listActiveInternalHandshakesForHostAi(db: unknown): HandshakeRecord[] {
  if (!db) return []
  const rows = listHandshakeRecords(db as Parameters<typeof listHandshakeRecords>[0], {
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
  })
  return rows.filter((r) => r.handshake_type === 'internal' && r.state === HandshakeState.ACTIVE)
}

/** Any ACTIVE internal row proves local Host with peer Sandbox. */
export function hostHasActiveInternalLedgerHostPeerSandboxFromDb(db: unknown): boolean {
  for (const r0 of listActiveInternalHandshakesForHostAi(db)) {
    if (rowProvesLocalHostPeerSandboxForHostAi(r0)) {
      return true
    }
  }
  return false
}

/**
 * Synchronous, db-based ledger-authoritative Sandbox→Host signal: any ACTIVE
 * internal row proves this device is the Sandbox side of a same-principal
 * Sandbox↔Host pair. Shared with `sandbox/sandboxOutboundPolicy.ts` so the
 * outbound-egress lockdown reuses the exact same proof as Host AI /
 * `orchestrator:getMode`. Returns `false` (never throws) when the ledger
 * cannot be read. Lives in this leaf module (no `listInferenceTargets` /
 * `p2pEndpointRepair` side effects) so lightweight egress call sites can import it.
 */
export function ledgerProvesLocalSandboxToHostFromDb(db: unknown): boolean {
  try {
    for (const r0 of listActiveInternalHandshakesForHostAi(db)) {
      if (rowProvesLocalSandboxToHostForHostAi(r0)) return true
    }
  } catch {
    /* fail-closed to "not proven" */
  }
  return false
}
