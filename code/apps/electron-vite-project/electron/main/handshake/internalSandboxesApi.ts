/**
 * List internal handshakes where this device is Host and the peer is Sandbox (usable send targets).
 * Used for BEAP inbox and dashboard to enable “send to sandbox” when coordination is available.
 */

import { listHandshakeRecords } from './db'
import { getQueueStatus } from './outboundQueue'
import { getP2PHealth } from '../p2p/p2pHealth'
import { HandshakeState, type HandshakeRecord, type SSOSession } from './types'

/** P2P-ingested inbox rows (no IMAP `account_id`); see `beapEmailIngestion`. */
export const P2P_BEAP_INBOX_ACCOUNT_ID = '__p2p_beap__'

export interface InternalSandboxListEntry {
  handshake_id: string
  relationship_id: string
  state: string
  peer_role: 'sandbox'
  peer_label: string
  peer_device_id: string
  peer_device_name: string | null
  /** 6-digit internal pairing code when set (not a UUID; preferred human id). */
  peer_pairing_code_six: string | null
  internal_coordination_identity_complete: boolean
  p2p_endpoint_set: boolean
  last_known_delivery_status: 'idle' | 'queue_pending' | 'queue_failed' | 'queue_sent' | 'unknown'
  live_status_optional?: 'relay_connected' | 'relay_disconnected' | 'coordination_disabled'
  /**
   * Local + peer qBEAP key material and P2P endpoint present — handshake is “real” for this Host,
   * independent of whether the relay WebSocket is up (`sandbox_connected_now` / `beap_clone_eligible`).
   */
  sandbox_keying_complete: boolean
  /**
   * True when the relay is connected, P2P endpoint + local + peer qBEAP material exist.
   * This is the **live send now** path (best available proxy: coordination relay + same checks as keying).
   */
  beap_clone_eligible: boolean
}

export interface InternalSandboxListIncompleteEntry {
  handshake_id: string
  relationship_id: string
  reason: 'identity_incomplete'
}

/**
 * Aggregate UI + IPC: whether a Sandbox can be used for immediate clone-send vs “exists but offline” vs not set up.
 * - `connected` — at least one row `beap_clone_eligible` (relay up + keying).
 * - `exists_but_offline` — at least one row `sandbox_keying_complete` but none clone-eligible (relay down / coordination off).
 * - `not_configured` — no row with full keying (no live path possible even if relay returned).
 */
export type SandboxOrchestratorAvailabilityStatus = 'connected' | 'exists_but_offline' | 'not_configured'

export interface SandboxOrchestratorAvailability {
  status: SandboxOrchestratorAvailabilityStatus
  /** Same source as per-row `live_status`: coordination relay WebSocket (see `p2pHealth.ts`). */
  relay_connected: boolean
  use_coordination: boolean
}

/**
 * From persisted ACTIVE `internal` handshakes for the current account.
 * - `host` — this device is Host (peer is Sandbox) on at least one row
 * - `sandbox` — this device is Sandbox (peer is Host) on at least one row; Host-only UI must not show
 * - `none` — no qualifying internal rows for this session
 */
export type AuthoritativeDeviceInternalRole = 'host' | 'sandbox' | 'none'

/**
 * Scans ACTIVE internal handshakes: cross-principal rows are ignored via `accountMatchesRecord`.
 * If the device is Sandbox on any row, returns `sandbox` (stricter than `host`).
 */
export function computeAuthoritativeDeviceInternalRole(
  db: any,
  session: SSOSession | null | undefined,
): AuthoritativeDeviceInternalRole {
  if (!db || !session) return 'none'
  const rows = listHandshakeRecords(db, {
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
  })
  let host = false
  let sand = false
  for (const record of rows) {
    if (!accountMatchesRecord(record, session)) continue
    if (isLocalHostPeerSandbox(record)) host = true
    if (isLocalSandboxPeerHost(record)) sand = true
  }
  if (sand) return 'sandbox'
  if (host) return 'host'
  return 'none'
}

function computeSandboxOrchestratorAvailability(
  sandboxes: InternalSandboxListEntry[],
): SandboxOrchestratorAvailability {
  const h = getP2PHealth()
  const relay_connected = h.coordination_connected
  const use_coordination = h.use_coordination
  if (sandboxes.some((s) => s.beap_clone_eligible)) {
    return { status: 'connected', relay_connected, use_coordination }
  }
  if (sandboxes.some((s) => s.sandbox_keying_complete)) {
    return { status: 'exists_but_offline', relay_connected, use_coordination }
  }
  return { status: 'not_configured', relay_connected, use_coordination }
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim()
}

function accountMatchesRecord(record: HandshakeRecord, session: SSOSession): boolean {
  const wid = norm(session.wrdesk_user_id) || norm(session.sub)
  if (!wid) return false
  const ie = record.initiator?.wrdesk_user_id?.trim()
  const ae = record.acceptor?.wrdesk_user_id?.trim()
  if (ie && ie === wid) return true
  if (ae && ae === wid) return true
  const em = (session.email ?? '').toLowerCase()
  if (em) {
    if ((record.initiator?.email ?? '').toLowerCase() === em) return true
    if ((record.acceptor?.email ?? '').toLowerCase() === em) return true
  }
  return false
}

function isLocalHostPeerSandbox(record: HandshakeRecord): boolean {
  if (record.local_role === 'initiator') {
    return record.initiator_device_role === 'host' && record.acceptor_device_role === 'sandbox'
  }
  return record.acceptor_device_role === 'host' && record.initiator_device_role === 'sandbox'
}

/**
 * This device is the Sandbox side of an internal Host↔Sandbox pairing (local sandbox, remote host).
 * Used to suppress Host-only Sandbox UI even when `orchestratorMode` is mis-set to "host".
 */
function isLocalSandboxPeerHost(record: HandshakeRecord): boolean {
  if (record.local_role === 'initiator') {
    return record.initiator_device_role === 'sandbox' && record.acceptor_device_role === 'host'
  }
  return record.acceptor_device_role === 'sandbox' && record.initiator_device_role === 'host'
}

function peerCoordinationOrLegacyId(record: HandshakeRecord): string {
  if (record.local_role === 'initiator') {
    return norm(record.acceptor_coordination_device_id) || record.internal_peer_device_id?.trim() || 'unknown / pending repair'
  }
  return norm(record.initiator_coordination_device_id) || record.internal_peer_device_id?.trim() || 'unknown / pending repair'
}

function peerDeviceName(record: HandshakeRecord): string | null {
  const n =
    record.local_role === 'initiator' ? record.acceptor_device_name : record.initiator_device_name
  return n?.trim() || null
}

function deriveDeliveryStatus(db: any, handshakeId: string): InternalSandboxListEntry['last_known_delivery_status'] {
  const q = getQueueStatus(db, handshakeId)
  if (q.pending > 0) return 'queue_pending'
  if (q.failed > 0) return 'queue_failed'
  if (q.sent > 0) return 'queue_sent'
  return 'idle'
}

function deriveLiveStatus(): InternalSandboxListEntry['live_status_optional'] {
  const h = getP2PHealth()
  if (!h.use_coordination) return 'coordination_disabled'
  return h.coordination_connected ? 'relay_connected' : 'relay_disconnected'
}

/** Peer public keys required for qBEAP encrypt to the sandbox orchestrator. */
export function hasPeerQbeapPublicKeyMaterial(record: HandshakeRecord): boolean {
  return Boolean(
    record.peer_x25519_public_key_b64?.trim() && record.peer_mlkem768_public_key_b64?.trim(),
  )
}

/**
 * “Sandbox exists” (cryptographic + addressing): internal host↔sandbox row can target qBEAP
 * when the relay is up — i.e. same preconditions as live send, **except** live relay presence.
 * Proxy: P2P endpoint from handshake + local X25519 + peer ML-KEM + peer X25519.
 */
export function isInternalHostSandboxKeyingComplete(record: HandshakeRecord): boolean {
  if (!record.p2p_endpoint?.trim()) return false
  if (!record.local_x25519_public_key_b64?.trim()) return false
  return hasPeerQbeapPublicKeyMaterial(record)
}

/**
 * `true` when clone UI may offer “Sandbox”: relay up, P2P path, full handshake crypto.
 * Does not relax account or role rules — caller still uses `isEligibleActiveInternalHostSandboxRecord`.
 * **Live presence proxy:** `getP2PHealth().coordination_connected` (coordination / relay WebSocket).
 */
export function isBeapCloneEligibleForRecord(
  record: HandshakeRecord,
  live: InternalSandboxListEntry['live_status_optional'],
): boolean {
  if (live !== 'relay_connected') return false
  return isInternalHostSandboxKeyingComplete(record)
}

/**
 * Exported for `beapInbox` sandbox clone: ACTIVE internal host↔sandbox, same account, identity complete.
 */
export function isEligibleActiveInternalHostSandboxRecord(
  record: HandshakeRecord,
  session: SSOSession,
): boolean {
  if (record.state !== HandshakeState.ACTIVE) return false
  if (record.handshake_type !== 'internal') return false
  if (!accountMatchesRecord(record, session)) return false
  if (!isLocalHostPeerSandbox(record)) return false
  if (!record.internal_coordination_identity_complete) return false
  return true
}

/**
 * Active internal handshakes: this account as Host, peer as Sandbox, identity complete.
 * `incomplete` lists host↔sandbox rows that are not coordination-complete yet (repair UX).
 */
export function listAvailableInternalSandboxes(
  db: any,
  session: SSOSession | null | undefined,
): {
  success: boolean
  error?: string
  sandboxes: InternalSandboxListEntry[]
  incomplete: InternalSandboxListIncompleteEntry[]
  sandbox_availability: SandboxOrchestratorAvailability
  authoritative_device_internal_role: AuthoritativeDeviceInternalRole
} {
  if (!db) {
    const h0 = getP2PHealth()
    return {
      success: false,
      error: 'Database unavailable',
      sandboxes: [],
      incomplete: [],
      sandbox_availability: {
        status: 'not_configured',
        relay_connected: h0.coordination_connected,
        use_coordination: h0.use_coordination,
      },
      authoritative_device_internal_role: 'none',
    }
  }
  if (!session) {
    const h0 = getP2PHealth()
    return {
      success: false,
      error: 'Not logged in',
      sandboxes: [],
      incomplete: [],
      sandbox_availability: {
        status: 'not_configured',
        relay_connected: h0.coordination_connected,
        use_coordination: h0.use_coordination,
      },
      authoritative_device_internal_role: 'none',
    }
  }

  const rows = listHandshakeRecords(db, {
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
  })
  const sandboxes: InternalSandboxListEntry[] = []
  const incomplete: InternalSandboxListIncompleteEntry[] = []

  for (const record of rows) {
    if (!accountMatchesRecord(record, session)) continue
    if (!isLocalHostPeerSandbox(record)) continue
    if (!record.internal_coordination_identity_complete) {
      incomplete.push({
        handshake_id: record.handshake_id,
        relationship_id: record.relationship_id,
        reason: 'identity_incomplete',
      })
      continue
    }

    const delivery = deriveDeliveryStatus(db, record.handshake_id)
    const live = deriveLiveStatus()
    const code = record.internal_peer_pairing_code?.trim() ?? null
    const pairingSix =
      code && /^\d{6}$/.test(code) ? code : null
    const sandbox_keying_complete = isInternalHostSandboxKeyingComplete(record)
    const beap_clone_eligible = isBeapCloneEligibleForRecord(record, live)
    sandboxes.push({
      handshake_id: record.handshake_id,
      relationship_id: record.relationship_id,
      state: record.state,
      peer_role: 'sandbox',
      peer_label: 'Sandbox orchestrator',
      peer_device_id: peerCoordinationOrLegacyId(record),
      peer_device_name: peerDeviceName(record),
      peer_pairing_code_six: pairingSix,
      internal_coordination_identity_complete: true,
      p2p_endpoint_set: Boolean(record.p2p_endpoint?.trim()),
      last_known_delivery_status: delivery,
      live_status_optional: live,
      sandbox_keying_complete,
      beap_clone_eligible,
    })
  }

  const sandbox_availability = computeSandboxOrchestratorAvailability(sandboxes)
  const authoritative_device_internal_role = computeAuthoritativeDeviceInternalRole(db, session)
  return {
    success: true,
    sandboxes,
    incomplete,
    sandbox_availability,
    authoritative_device_internal_role,
  }
}
