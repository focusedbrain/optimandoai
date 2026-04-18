/**
 * Belt-and-suspenders validation for internal same-principal relay capsules:
 * enqueue-time and coordination pre-HTTP checks so doomed /beap/capsule POSTs are not sent.
 */

import { isCoordinationRelayNativeBeap } from '../../../../../packages/ingestion-core/src/beapDetection.ts'
import {
  INTERNAL_ENDPOINT_ERROR_CODES,
} from '../../../../../packages/shared/src/handshake/internalEndpointValidation'
import { getHandshakeRecord } from './db'
import { internalRelayCapsuleWireOptsFromRecord } from './internalCoordinationWire'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'

export const LOCAL_INTERNAL_RELAY_VALIDATION_FAILED = 'LOCAL_INTERNAL_RELAY_VALIDATION_FAILED'

// Phase 3: `initiate` is now sent via the coordination relay for internal handshakes
// (previously file/email/USB only). Include it so the enqueue-time guard also rejects
// internal initiate capsules that lack receiver_device_id — defense-in-depth.
const RELAY_ENVELOPE_INTERNAL_WIRE_TYPES = new Set([
  'initiate',
  'accept',
  'context_sync',
  'refresh',
  'revoke',
])

function nz(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  return t.length > 0 ? t : null
}

export function isInternalRelayCapsuleEnvelope(o: Record<string, unknown>): boolean {
  const ct = o.capsule_type
  return typeof ct === 'string' && RELAY_ENVELOPE_INTERNAL_WIRE_TYPES.has(ct.trim())
}

/** Fields missing for coordination internal relay (same-principal) on handshake capsule envelopes. */
export function collectInternalRelayWireGaps(o: Record<string, unknown>): string[] {
  const missing: string[] = []
  if (o.handshake_type !== 'internal') missing.push('handshake_type')
  if (!nz(o.sender_device_id)) missing.push('sender_device_id')
  if (!nz(o.receiver_device_id)) missing.push('receiver_device_id')
  const sr = o.sender_device_role
  const rr = o.receiver_device_role
  if (sr !== 'host' && sr !== 'sandbox') missing.push('sender_device_role')
  if (rr !== 'host' && rr !== 'sandbox') missing.push('receiver_device_role')
  if (!nz(o.sender_computer_name)) missing.push('sender_computer_name')
  if (!nz(o.receiver_computer_name)) missing.push('receiver_computer_name')
  return missing
}

export function shouldValidateInternalRelayWire(
  record: { handshake_type?: string | null } | null | undefined,
  o: Record<string, unknown>,
): boolean {
  if (!record || record.handshake_type !== 'internal') return false
  if (isCoordinationRelayNativeBeap(o)) return false
  return isInternalRelayCapsuleEnvelope(o)
}

export type EnqueueOutboundCapsuleResult =
  | { enqueued: true }
  | {
      enqueued: false
      phase: 'enqueue_guard'
      invariant: string
      message: string
      missing_fields: string[]
    }

export function formatLocalInternalRelayValidationJson(args: {
  phase: 'enqueue_guard' | 'coordination_pre_http'
  invariant: string
  message: string
  missing_fields: string[]
}): string {
  return JSON.stringify({
    code: LOCAL_INTERNAL_RELAY_VALIDATION_FAILED,
    phase: args.phase,
    invariant: args.invariant,
    message: args.message,
    missing_fields: args.missing_fields,
  })
}

/**
 * Before persisting to outbound_capsule_queue: internal handshake + relay envelope must carry full wire.
 */
export function validateInternalCapsuleBeforeEnqueue(
  db: any,
  handshakeId: string,
  capsule: object,
): EnqueueOutboundCapsuleResult {
  if (!handshakeId?.trim()) {
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: 'handshake_id is required to validate internal relay capsule before enqueue',
      missing_fields: ['handshake_id'],
    }
  }
  if (!db) {
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: 'Database unavailable — cannot validate internal relay capsule before enqueue',
      missing_fields: [],
    }
  }
  const record = getHandshakeRecord(db, handshakeId.trim())
  const o = capsule as Record<string, unknown>
  if (!shouldValidateInternalRelayWire(record, o)) return { enqueued: true }

  if (record?.internal_coordination_repair_needed) {
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_COORDINATION_REPAIR_NEEDED,
      message:
        'Internal handshake coordination identity is incomplete (legacy or degraded). Repair device metadata in the vault before sending relay capsules.',
      missing_fields: [],
    }
  }

  const missing = collectInternalRelayWireGaps(o)
  const sid = nz(o.sender_device_id)
  const rid = nz(o.receiver_device_id)
  if (sid && rid && sid === rid) {
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID,
      message: 'sender_device_id and receiver_device_id must differ for internal relay',
      missing_fields: ['sender_device_id', 'receiver_device_id'],
    }
  }
  if (missing.length > 0) {
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_WIRE_INCOMPLETE,
      message: `Internal relay capsule (${String(o.capsule_type)}) missing required routing fields`,
      missing_fields: missing,
    }
  }
  return { enqueued: true }
}

export type CoordinationPreHttpValidation =
  | { ok: true }
  | {
      ok: false
      invariant: string
      message: string
      missing_fields: string[]
    }

/**
 * For internal context_sync, overwrite routing fields from the handshake record so receiver_device_id
 * always matches the stored counterparty coordination device id.
 */
export function applyContextSyncInternalRoutingFromRecord(
  db: any,
  handshakeId: string,
  payload: Record<string, unknown>,
): void {
  if (!db || !handshakeId?.trim()) return
  const ct = typeof payload.capsule_type === 'string' ? payload.capsule_type.trim() : ''
  if (ct !== 'context_sync') return
  const record = getHandshakeRecord(db, handshakeId.trim())
  if (!record || record.handshake_type !== 'internal') return

  let localId = ''
  try {
    localId = getInstanceId()?.trim() ?? ''
  } catch {
    localId = ''
  }
  const opts = internalRelayCapsuleWireOptsFromRecord(record, localId)
  if (!opts) return

  payload.handshake_type = 'internal'
  payload.sender_device_id = opts.coordinationSenderDeviceId
  payload.receiver_device_id = opts.coordinationReceiverDeviceId
  payload.sender_device_role = opts.senderDeviceRole
  payload.receiver_device_role = opts.receiverDeviceRole
  payload.sender_computer_name = opts.senderComputerName
  payload.receiver_computer_name = opts.receiverComputerName
}

/**
 * After building the coordination POST body (including sender_device_id injection), verify internal relay invariants.
 */
export function validateCoordinationInternalPayloadBeforePost(
  db: any,
  handshakeId: string,
  payload: Record<string, unknown>,
): CoordinationPreHttpValidation {
  if (!db || !handshakeId?.trim()) return { ok: true }
  const record = getHandshakeRecord(db, handshakeId.trim())
  if (!shouldValidateInternalRelayWire(record, payload)) return { ok: true }

  if (record?.internal_coordination_repair_needed) {
    return {
      ok: false,
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_COORDINATION_REPAIR_NEEDED,
      message:
        'Internal handshake coordination identity is incomplete — repair in vault before POST (coordination pre-http guard).',
      missing_fields: [],
    }
  }

  let localId = ''
  try {
    localId = getInstanceId()?.trim() ?? ''
  } catch {
    localId = ''
  }

  const ctEarly = typeof payload.capsule_type === 'string' ? payload.capsule_type.trim() : ''
  if (ctEarly === 'context_sync' && record) {
    if (!internalRelayCapsuleWireOptsFromRecord(record, localId)) {
      return {
        ok: false,
        invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
        message:
          'This handshake is missing pairing details. Create it again with a valid pairing code.',
        missing_fields: [],
      }
    }
  }

  const postSid = nz(payload.sender_device_id)
  if (localId && postSid && postSid !== localId) {
    return {
      ok: false,
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_SENDER_DEVICE_MISMATCH,
      message: 'sender_device_id on coordination POST must match local orchestrator device id',
      missing_fields: ['sender_device_id'],
    }
  }

  const missing = collectInternalRelayWireGaps(payload)
  const sid = nz(payload.sender_device_id)
  const rid = nz(payload.receiver_device_id)
  if (sid && rid && sid === rid) {
    return {
      ok: false,
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID,
      message: 'sender_device_id and receiver_device_id must differ for internal relay',
      missing_fields: ['sender_device_id', 'receiver_device_id'],
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_WIRE_INCOMPLETE,
      message: `Internal relay coordination POST missing required routing fields (capsule_type=${String(payload.capsule_type)})`,
      missing_fields: missing,
    }
  }

  if (ctEarly === 'context_sync' && record) {
    const opts = internalRelayCapsuleWireOptsFromRecord(record, localId)
    if (opts && rid && rid !== opts.coordinationReceiverDeviceId) {
      return {
        ok: false,
        invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_WIRE_INCOMPLETE,
        message: 'context_sync receiver_device_id must match stored counterparty coordination device id',
        missing_fields: ['receiver_device_id'],
      }
    }
  }

  return { ok: true }
}
