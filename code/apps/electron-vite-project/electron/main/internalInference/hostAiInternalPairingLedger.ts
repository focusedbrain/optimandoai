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

/** Any ACTIVE internal row proves local Host with peer Sandbox. */
export function hostHasActiveInternalLedgerHostPeerSandboxFromDb(db: unknown): boolean {
  const rows = listHandshakeRecords(db as any, { state: HandshakeState.ACTIVE })
  for (const r0 of rows) {
    if (r0.handshake_type !== 'internal' || r0.state !== HandshakeState.ACTIVE) continue
    if (rowProvesLocalHostPeerSandboxForHostAi(r0)) {
      return true
    }
  }
  return false
}
