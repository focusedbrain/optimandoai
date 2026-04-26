import type {
  ActiveHandshakeHealthIssue,
  HandshakeHealthReason,
  HandshakeHealthTier,
} from '@shared/handshake/activeHandshakeHealthIssue'
import { peekHostAdvertisedMvpDirectP2pEndpoint } from '../internalInference/p2pEndpointRepair'
import {
  assertLedgerRolesSandboxToHost,
  deriveInternalHostAiPeerRoles,
  p2pEndpointKind,
  p2pEndpointMvpClass,
} from '../internalInference/policy'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { listHandshakeRecords } from './db'
import { HandshakeState } from './types'
import type { HandshakeRecord } from './types'

export type HandshakeHealthClassification =
  | { ok: true }
  | { ok: false; health: HandshakeHealthTier; reason: HandshakeHealthReason }

export function hasP2pTokenForLog(r: HandshakeRecord): boolean {
  return typeof r.local_p2p_auth_token === 'string' && r.local_p2p_auth_token.trim().length > 0
}

export function coordinationCompleteForLog(r: HandshakeRecord): boolean {
  if (r.handshake_type === 'internal') {
    return r.internal_coordination_identity_complete === true
  }
  return true
}

export function counterpartyP2pTokenSetForLog(r: HandshakeRecord): boolean {
  return typeof r.counterparty_p2p_token === 'string' && r.counterparty_p2p_token.trim().length > 0
}

export function peerDisplayNameForHealth(r: HandshakeRecord): string {
  const a = (r.acceptor_device_name ?? '').trim()
  const i = (r.initiator_device_name ?? '').trim()
  const legacy = (r.internal_peer_computer_name ?? '').trim()
  if (r.local_role === 'initiator') {
    if (a) return a
  } else {
    if (i) return i
  }
  if (legacy) return legacy
  if (i) return i
  if (a) return a
  return '(unknown)'
}

function pairingDigits6(r: HandshakeRecord): string | null {
  const c = r.internal_peer_pairing_code?.trim() ?? ''
  if (/^\d{6}$/.test(c)) return c
  return null
}

/**
 * Same classification rules as `[HANDSHAKE_HEALTH]` startup lines (first match wins).
 */
export function classifyActiveHandshakeHealth(
  db: unknown,
  r: HandshakeRecord,
  localId: string,
): HandshakeHealthClassification {
  const coordOk = coordinationCompleteForLog(r)
  if (!coordOk) {
    return { ok: false, health: 'BROKEN', reason: 'coordination_incomplete' }
  }

  const epKind = p2pEndpointKind(db, r.p2p_endpoint)
  if (epKind === 'missing' || epKind === 'invalid') {
    return { ok: false, health: 'BROKEN', reason: 'endpoint_invalid' }
  }

  if (!hasP2pTokenForLog(r)) {
    return { ok: false, health: 'DEGRADED', reason: 'missing_self_token' }
  }

  if (!counterpartyP2pTokenSetForLog(r)) {
    return { ok: false, health: 'DEGRADED', reason: 'missing_counterparty_token' }
  }

  if (epKind === 'relay') {
    const dr = deriveInternalHostAiPeerRoles(r, localId)
    const sandboxToHost =
      dr.ok &&
      assertLedgerRolesSandboxToHost(r).ok &&
      dr.localRole === 'sandbox' &&
      dr.peerRole === 'host'
    if (sandboxToHost) {
      const adv = peekHostAdvertisedMvpDirectP2pEndpoint(r.handshake_id)
      if (adv && p2pEndpointMvpClass(db, adv) === 'direct_lan') {
        return { ok: false, health: 'SUBOPTIMAL', reason: 'endpoint_repair_pending' }
      }
    }
  }

  return { ok: true }
}

export function listActiveHandshakeHealthIssues(db: unknown): ActiveHandshakeHealthIssue[] {
  if (db == null || typeof (db as { prepare?: unknown }).prepare !== 'function') {
    return []
  }
  const d = db as Parameters<typeof listHandshakeRecords>[0]
  const active = listHandshakeRecords(d, { state: HandshakeState.ACTIVE })
  const localId = getInstanceId().trim()
  const out: ActiveHandshakeHealthIssue[] = []
  for (const r of active) {
    const h = classifyActiveHandshakeHealth(d, r, localId)
    if (h.ok) continue
    out.push({
      handshake_id: r.handshake_id,
      health: h.health,
      reason: h.reason,
      peer_name: peerDisplayNameForHealth(r),
      pairing_code_6: pairingDigits6(r),
    })
  }
  return out
}
