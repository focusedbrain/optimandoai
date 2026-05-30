/**
 * Ledger pairing checks for internal same-principal Host ↔ Sandbox (Host AI).
 * Kept separate from listInferenceTargets to avoid circular imports with policy resolution.
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { deriveInternalHostAiPeerRoles, handshakeSamePrincipal } from './policy'

/** This instance is Host and peer is Sandbox (same account). */
export function rowProvesLocalHostPeerSandboxForHostAi(r: HandshakeRecord): boolean {
  if (!handshakeSamePrincipal(r)) return false
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  return dr.ok && dr.localRole === 'host' && dr.peerRole === 'sandbox'
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
