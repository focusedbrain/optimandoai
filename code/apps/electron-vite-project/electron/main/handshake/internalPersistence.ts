/**
 * Internal handshake — DB-facing routing key + completeness flags (no device id invention).
 */

import type { HandshakeRecord } from './types'
import { HandshakeState } from './types'
import {
  validateInternalEndpointFields,
  validateInternalEndpointPairDistinct,
  isValidPairingCodeFormat,
  INTERNAL_ENDPOINT_ERROR_CODES,
} from '../../../../../packages/shared/src/handshake/internalEndpointValidation'

/** Canonical ordered pair: internal:{owner_user_id}:{min(device_ids)}:{max(device_ids)} */
export function computeInternalRoutingKey(
  ownerWrdeskUserId: string | undefined,
  deviceIdA: string | undefined,
  deviceIdB: string | undefined,
): string | null {
  const owner = ownerWrdeskUserId?.trim() ?? ''
  const a = deviceIdA?.trim() ?? ''
  const b = deviceIdB?.trim() ?? ''
  if (!owner || !a || !b || a === b) return null
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return `internal:${owner}:${lo}:${hi}`
}

/**
 * Full internal endpoint symmetry for coordination / relay: both coordination ids,
 * both roles, both computer names (initiator_* + acceptor_* columns).
 */
export function isInternalCoordinationIdentityComplete(record: HandshakeRecord): boolean {
  if (record.handshake_type !== 'internal') return false
  const iid = record.initiator_coordination_device_id?.trim() ?? ''
  const aid = record.acceptor_coordination_device_id?.trim() ?? ''
  if (!iid || !aid) return false
  if (!record.initiator_device_role || !record.acceptor_device_role) return false
  if (!record.initiator_device_name?.trim() || !record.acceptor_device_name?.trim()) return false
  return true
}

/**
 * Merge internal routing metadata for persistence. Never fabricates device ids.
 * - internal_routing_key: set when owner + both coordination ids exist (lexicographic min/max).
 * - internal_coordination_identity_complete: strict symmetry (ids + roles + names).
 */
export function finalizeInternalHandshakePersistence(record: HandshakeRecord): HandshakeRecord {
  if (record.handshake_type !== 'internal') {
    return {
      ...record,
      internal_routing_key: null,
      internal_coordination_identity_complete: false,
      internal_coordination_repair_needed: false,
    }
  }
  const owner = record.initiator?.wrdesk_user_id?.trim() ?? ''
  const complete = isInternalCoordinationIdentityComplete(record)
  const key = computeInternalRoutingKey(
    owner,
    record.initiator_coordination_device_id ?? undefined,
    record.acceptor_coordination_device_id ?? undefined,
  )
  const needsRepairAfterLifecycle =
    !complete &&
    (record.state === HandshakeState.ACCEPTED || record.state === HandshakeState.ACTIVE)
  return {
    ...record,
    internal_routing_key: key,
    internal_coordination_identity_complete: complete,
    internal_coordination_repair_needed: complete
      ? false
      : needsRepairAfterLifecycle
        ? true
        : !!record.internal_coordination_repair_needed,
  }
}

/**
 * Fail-fast for internal initiate capsule wire.
 *
 * Two acceptable shapes:
 *   1. NEW (pairing-code-routed): sender_device_id + sender_device_role +
 *      sender_computer_name + receiver_pairing_code (6 digits). Receiver-side
 *      device id / role / computer name are NOT required and MAY be absent.
 *   2. LEGACY (UUID-routed, pre-pairing-code-refactor): full
 *      initiator + receiver endpoint identity (both ids, both roles, both
 *      computer names, all distinct).
 *
 * The validator tries shape 1 first and only falls back to shape 2 if no
 * `receiver_pairing_code` is present, so existing legacy capsules from older
 * peers continue to import without changes.
 */
export function validateInternalInitiateCapsuleWire(c: Record<string, unknown>): {
  ok: boolean
  error?: string
  code?: string
} {
  if (c?.handshake_type !== 'internal') return { ok: true }
  const initiatorId =
    typeof c.sender_device_id === 'string' && c.sender_device_id.trim().length > 0
      ? c.sender_device_id.trim()
      : null
  const vInit = validateInternalEndpointFields(
    'initiator',
    initiatorId,
    c.sender_device_role,
    c.sender_computer_name,
  )
  if (!vInit.ok) return { ok: false, error: vInit.message, code: vInit.code }

  const pairingCodeRaw = typeof c.receiver_pairing_code === 'string' ? c.receiver_pairing_code.trim() : ''
  if (pairingCodeRaw) {
    if (!isValidPairingCodeFormat(pairingCodeRaw)) {
      return {
        ok: false,
        error: 'receiver_pairing_code must be exactly 6 decimal digits',
        code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_PAIRING_CODE_INVALID,
      }
    }
    return { ok: true }
  }

  // Legacy shape — preserved for capsules created before the pairing-code refactor.
  const vRecv = validateInternalEndpointFields(
    'receiver',
    typeof c.receiver_device_id === 'string' ? c.receiver_device_id : null,
    c.receiver_device_role,
    c.receiver_computer_name,
  )
  if (!vRecv.ok) return { ok: false, error: vRecv.message, code: vRecv.code }
  const pair = validateInternalEndpointPairDistinct(
    {
      deviceId: initiatorId!,
      deviceRole: c.sender_device_role as 'host' | 'sandbox',
      computerName: String(c.sender_computer_name),
    },
    {
      deviceId: String(c.receiver_device_id).trim(),
      deviceRole: c.receiver_device_role as 'host' | 'sandbox',
      computerName: String(c.receiver_computer_name),
    },
  )
  if (!pair.ok) return { ok: false, error: pair.message, code: pair.code }
  return { ok: true }
}
