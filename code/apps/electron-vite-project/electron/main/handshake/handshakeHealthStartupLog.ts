/**
 * One-line-per-ACTIVE-handshake health at startup ([HANDSHAKE_HEALTH]), emitted as soon as the
 * handshake ledger is available (see `tryP2PStartup` in main). Plain-English classification for
 * half-paired / missing-token / relay repair cases.
 */

import { redactIdForLog } from '../internalInference/internalInferenceLogRedact'
import {
  deriveInternalHostAiPeerRoles,
  localDeviceRole,
  p2pEndpointKind,
  peerCoordinationDeviceId,
  peerDeviceRole,
} from '../internalInference/policy'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import {
  classifyActiveHandshakeHealth,
  coordinationCompleteForLog,
  counterpartyP2pTokenSetForLog,
  hasP2pTokenForLog,
  peerDisplayNameForHealth,
} from './activeHandshakeHealth'
import { listHandshakeRecords } from './db'
import { HandshakeState } from './types'
import type { HandshakeRecord } from './types'

const TAG = '[HANDSHAKE_HEALTH]'

function yn(v: boolean): 'yes' | 'no' {
  return v ? 'yes' : 'no'
}

/**
 * @param db Open handshake ledger (same object as `getHandshakeDb()` in main).
 */
export function logHandshakeHealthStartupLines(db: unknown): void {
  try {
    if (db == null || typeof (db as { prepare?: unknown }).prepare !== 'function') {
      console.log(`${TAG} ledger_db=invalid skipping`)
      return
    }
    const d = db as Parameters<typeof listHandshakeRecords>[0]
    const active = listHandshakeRecords(d, { state: HandshakeState.ACTIVE })
    if (active.length === 0) {
      console.log(`${TAG} no_active_handshakes`)
      return
    }
    const localId = getInstanceId().trim()
    for (const r of active) {
      const coordC = coordinationCompleteForLog(r)
      const authSet = hasP2pTokenForLog(r)
      const cpSet = counterpartyP2pTokenSetForLog(r)
      const epKind = p2pEndpointKind(d, r.p2p_endpoint)

      let localRole: string
      let peerRole: string
      let peerDev: string
      if (r.handshake_type === 'internal') {
        const dr = deriveInternalHostAiPeerRoles(r, localId)
        if (dr.ok) {
          localRole = dr.localRole
          peerRole = dr.peerRole
          peerDev = redactIdForLog(dr.peerCoordinationDeviceId)
        } else {
          localRole = localDeviceRole(r) ?? 'unknown'
          peerRole = peerDeviceRole(r) ?? 'unknown'
          const ip = (r.internal_peer_device_id ?? '').trim()
          peerDev = ip ? redactIdForLog(ip) : '(unknown)'
        }
      } else {
        localRole = localDeviceRole(r) ?? 'unknown'
        peerRole = peerDeviceRole(r) ?? 'unknown'
        const pc = (peerCoordinationDeviceId(r) ?? '').trim()
        peerDev = pc ? redactIdForLog(pc) : '(unknown)'
      }

      const h = classifyActiveHandshakeHealth(d, r, localId)
      const peerName = peerDisplayNameForHealth(r)
      let line =
        `${TAG} handshake=${r.handshake_id} role=${r.local_role} local_device_role=${localRole} peer_device_role=${peerRole} peer_device=${peerDev} peer_name=${peerName} ` +
        `p2p_endpoint_kind=${epKind} p2p_auth_token_set=${yn(authSet)} counterparty_p2p_token_set=${yn(cpSet)} coordination_complete=${coordC ? 'true' : 'false'}`
      if (!h.ok) {
        line += ` health=${h.health} reason=${h.reason}`
      }
      console.log(line)
    }
  } catch (e) {
    console.warn(`${TAG} failed`, (e as Error)?.message ?? e)
  }
}
