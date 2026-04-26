/**
 * Safe, non-secret field dump for internal Host handshake P2P (STEP 2 diagnostics).
 * Does not log private keys, signing keys, or full bearer tokens.
 */

import { getHandshakeRecord, listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getHandshakeDbForInternalInference } from './dbAccess'
import {
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  p2pEndpointMvpClass,
} from './policy'
import {
  deriveInternalHandshakeRoles,
  type InternalHandshakeRoleSource,
} from '../../../../../packages/shared/src/handshake/internalIdentityUi'
import { getP2pInferenceFlags } from './p2pInferenceFlags'

const TAG = '[INTERNAL_HOST_P2P_INSPECT]'

function first8(s: string | null | undefined): string {
  const t = (s ?? '').trim()
  if (!t) return '—'
  return t.length <= 8 ? t : `${t.slice(0, 8)}…`
}

function mvpKindDisplay(
  c: 'direct_lan' | 'localhost' | 'relay' | 'missing' | 'invalid',
): 'direct LAN' | 'localhost' | 'relay' | 'missing' | 'invalid' {
  if (c === 'direct_lan') return 'direct LAN'
  return c
}

function recordToInternalRoleSource(r: HandshakeRecord): InternalHandshakeRoleSource {
  return {
    handshake_type: r.handshake_type,
    state: r.state,
    local_role: r.local_role,
    initiator_device_role: r.initiator_device_role,
    acceptor_device_role: r.acceptor_device_role,
    initiator_device_name: r.initiator_device_name,
    acceptor_device_name: r.acceptor_device_name,
    initiator_coordination_device_id: r.initiator_coordination_device_id,
    acceptor_coordination_device_id: r.acceptor_coordination_device_id,
    internal_peer_device_id: r.internal_peer_device_id,
    internal_peer_device_role: r.internal_peer_device_role,
    internal_peer_computer_name: r.internal_peer_computer_name,
    internal_peer_pairing_code: r.internal_peer_pairing_code,
    internal_coordination_identity_complete: r.internal_coordination_identity_complete,
    internal_coordination_repair_needed: r.internal_coordination_repair_needed,
  }
}

export type InternalHostHandshakeP2pSafeDump = {
  handshake_id: string
  local_role: 'initiator' | 'acceptor'
  handshake_type: 'internal' | 'standard' | null | undefined
  state: string
  local_derived_role: 'host' | 'sandbox' | 'unknown' | null
  peer_derived_role: 'host' | 'sandbox' | 'unknown' | null
  p2p_endpoint: string | null
  p2p_endpoint_kind: 'direct LAN' | 'localhost' | 'relay' | 'missing' | 'invalid'
  /** Inbound: token we expect peers to use when calling this device’s ingest (`local_p2p_auth_token` / server `counterparty_p2p` check). */
  p2p_auth_token_set: 'no' | 'yes'
  /** Outbound: token we use when calling the peer’s ingest (must match; see `outboundP2pBearerToCounterpartyIngest`). */
  counterparty_p2p_token_set: 'no' | 'yes'
  internal_coordination_identity_complete: boolean
  initiator_coordination_device_id_first8: string
  acceptor_coordination_device_id_first8: string
}

export function buildInternalHostHandshakeP2pSafeDump(
  db: any,
  r: HandshakeRecord,
): InternalHostHandshakeP2pSafeDump {
  const d = deriveInternalHandshakeRoles(recordToInternalRoleSource(r))
  const mvp = p2pEndpointMvpClass(db, r.p2p_endpoint)
  const localTok = typeof r.local_p2p_auth_token === 'string' && r.local_p2p_auth_token.trim().length > 0
  const cp = typeof r.counterparty_p2p_token === 'string' && r.counterparty_p2p_token.trim().length > 0
  return {
    handshake_id: r.handshake_id,
    local_role: r.local_role,
    handshake_type: r.handshake_type,
    state: r.state,
    local_derived_role: d.localDeviceRole ?? 'unknown',
    peer_derived_role: d.peerDeviceRole ?? 'unknown',
    p2p_endpoint: r.p2p_endpoint,
    p2p_endpoint_kind: mvpKindDisplay(mvp),
    p2p_auth_token_set: localTok ? 'yes' : 'no',
    counterparty_p2p_token_set: cp ? 'yes' : 'no',
    internal_coordination_identity_complete: r.internal_coordination_identity_complete === true,
    initiator_coordination_device_id_first8: first8(r.initiator_coordination_device_id),
    acceptor_coordination_device_id_first8: first8(r.acceptor_coordination_device_id),
  }
}

export function logInternalHostHandshakeP2pInspect(db: any, r: HandshakeRecord): void {
  if (!getP2pInferenceFlags().p2pInferenceVerboseLogs) {
    return
  }
  try {
    const dump = buildInternalHostHandshakeP2pSafeDump(db, r)
    console.log(`${TAG} ${JSON.stringify(dump)}`)
  } catch (e) {
    console.warn(`${TAG} dump_failed`, (e as Error)?.message)
  }
}

/**
 * Returns a safe P2P field dump for the active internal Sandbox→Host handshake (or a specific `handshakeId` when set).
 */
export async function getInternalHostHandshakeP2pInspect(
  handshakeId: string | undefined,
): Promise<{ ok: true; dump: InternalHostHandshakeP2pSafeDump } | { ok: false; error: string }> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, error: 'no_database' }
  }
  if (typeof handshakeId === 'string' && handshakeId.trim().length > 0) {
    const hid = handshakeId.trim()
    const r0 = getHandshakeRecord(db, hid)
    if (!r0 || r0.state !== HandshakeState.ACTIVE || r0.handshake_type !== 'internal') {
      return { ok: false, error: 'handshake_not_found_or_not_active_internal' }
    }
    const ar = assertRecordForServiceRpc(r0)
    if (!ar.ok) {
      return { ok: false, error: 'assert_record' }
    }
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      return { ok: false, error: 'not_sandbox_to_host' }
    }
    return { ok: true, dump: buildInternalHostHandshakeP2pSafeDump(db, ar.record) }
  }

  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  for (const r0 of rows) {
    const ar = assertRecordForServiceRpc(r0)
    if (!ar.ok) {
      continue
    }
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      continue
    }
    const dump = buildInternalHostHandshakeP2pSafeDump(db, ar.record)
    return { ok: true, dump }
  }
  return { ok: false, error: 'no_active_sandbox_to_host_internal_handshake' }
}
