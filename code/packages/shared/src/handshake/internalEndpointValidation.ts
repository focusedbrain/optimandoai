/**
 * Internal handshake endpoint identity — single source of truth for validation (Electron + extension).
 *
 * Primary model: {@link InternalEndpointIdentity} (`device_id`, `device_role`, `computer_name`).
 * Legacy camelCase {@link InternalHandshakeEndpoint} remains for gradual migration.
 */

/** Role constraint for internal handshakes (host ↔ sandbox). */
export type InternalDeviceRole = 'host' | 'sandbox'

/**
 * Canonical internal endpoint record (snake_case — align with wire / DB column naming).
 */
export interface InternalEndpointIdentity {
  readonly device_id: string
  readonly device_role: InternalDeviceRole
  readonly computer_name: string
}

/**
 * @deprecated Prefer {@link InternalEndpointIdentity}. Kept for existing call sites.
 */
export interface InternalHandshakeEndpoint {
  readonly deviceId: string
  readonly deviceRole: InternalDeviceRole
  readonly computerName: string
}

/** Machine-readable validation / routing error codes for internal endpoints and relay capsules. */
export const INTERNAL_ENDPOINT_ERROR_CODES = {
  INTERNAL_ENDPOINT_INCOMPLETE: 'INTERNAL_ENDPOINT_INCOMPLETE',
  INTERNAL_ENDPOINT_ID_COLLISION: 'INTERNAL_ENDPOINT_ID_COLLISION',
  INTERNAL_ENDPOINT_ROLE_COLLISION: 'INTERNAL_ENDPOINT_ROLE_COLLISION',
  INTERNAL_COMPUTER_NAME_COLLISION: 'INTERNAL_COMPUTER_NAME_COLLISION',
  INTERNAL_CAPSULE_MISSING_DEVICE_ID: 'INTERNAL_CAPSULE_MISSING_DEVICE_ID',
  /** Internal relay envelope missing required routing fields (device ids, roles, names, handshake_type) */
  INTERNAL_RELAY_WIRE_INCOMPLETE: 'INTERNAL_RELAY_WIRE_INCOMPLETE',
  /** POST body sender_device_id does not match local orchestrator device id */
  INTERNAL_RELAY_SENDER_DEVICE_MISMATCH: 'INTERNAL_RELAY_SENDER_DEVICE_MISMATCH',
  /** Legacy / degraded internal row: identity incomplete after accept — coordination send blocked until repaired */
  INTERNAL_COORDINATION_REPAIR_NEEDED: 'INTERNAL_COORDINATION_REPAIR_NEEDED',
} as const

export type InternalEndpointErrorCode =
  (typeof INTERNAL_ENDPOINT_ERROR_CODES)[keyof typeof INTERNAL_ENDPOINT_ERROR_CODES]

export interface InternalEndpointPairValidationResult {
  readonly ok: boolean
  readonly code?: InternalEndpointErrorCode
  readonly message?: string
}

/**
 * Normalize `computer_name` for equality checks:
 * - trim
 * - Unicode NFKC normalization
 * - lowercase (ASCII-oriented case fold for comparison; not full Unicode SpecialCasing)
 */
export function normalizeComputerNameForHandshake(name: string | null | undefined): string {
  if (name == null || typeof name !== 'string') return ''
  try {
    return name.trim().normalize('NFKC').toLowerCase()
  } catch {
    return name.trim().toLowerCase()
  }
}

/** Build {@link InternalEndpointIdentity} from loose inputs (trim id/name; role must already be valid). */
export function internalEndpointIdentity(
  device_id: string,
  device_role: InternalDeviceRole,
  computer_name: string,
): InternalEndpointIdentity {
  return {
    device_id: device_id.trim(),
    device_role,
    computer_name,
  }
}

export function internalEndpointIdentityFromCamel(e: InternalHandshakeEndpoint): InternalEndpointIdentity {
  return {
    device_id: e.deviceId.trim(),
    device_role: e.deviceRole,
    computer_name: typeof e.computerName === 'string' ? e.computerName : '',
  }
}

export function internalEndpointIdentityToCamel(e: InternalEndpointIdentity): InternalHandshakeEndpoint {
  return {
    deviceId: e.device_id.trim(),
    deviceRole: e.device_role,
    computerName: e.computer_name,
  }
}

function isNonEmpty(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0
}

function validRole(r: unknown): r is InternalDeviceRole {
  return r === 'host' || r === 'sandbox'
}

/**
 * Validate one endpoint: non-empty `device_id`, valid `device_role`, non-empty `computer_name`.
 *
 * Invariants: all three fields required; role must be host | sandbox.
 */
export function validateInternalEndpointIdentity(
  label: 'sender' | 'receiver' | 'initiator' | 'acceptor' | string,
  partial: {
    device_id?: string | null
    device_role?: unknown
    computer_name?: string | null
  },
): InternalEndpointPairValidationResult {
  if (!isNonEmpty(partial.device_id)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message:
        "The other device's pairing code is missing or invalid. On your other device, open Settings → Orchestrator mode and read the 6-digit code.",
    }
  }
  if (!validRole(partial.device_role)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message:
        "The other device's role is missing. It should be the opposite of this device's role (host ↔ sandbox).",
    }
  }
  if (!isNonEmpty(partial.computer_name)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message:
        "The other device's name is missing. Restart the orchestrator on that device and try again.",
    }
  }
  return { ok: true }
}

/**
 * Full pair validation: each side complete, then
 * - device ids differ (trimmed)
 * - roles differ
 * - normalized computer names differ
 */
export function validateInternalEndpointPair(
  a: InternalEndpointIdentity,
  b: InternalEndpointIdentity,
  options?: { labelA?: string; labelB?: string },
): InternalEndpointPairValidationResult {
  const labelA = options?.labelA ?? 'endpoint_a'
  const labelB = options?.labelB ?? 'endpoint_b'

  const va = validateInternalEndpointIdentity(labelA, {
    device_id: a.device_id,
    device_role: a.device_role,
    computer_name: a.computer_name,
  })
  if (!va.ok) return va

  const vb = validateInternalEndpointIdentity(labelB, {
    device_id: b.device_id,
    device_role: b.device_role,
    computer_name: b.computer_name,
  })
  if (!vb.ok) return vb

  const idA = a.device_id.trim()
  const idB = b.device_id.trim()
  if (idA === idB) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_ID_COLLISION,
      message:
        'The pairing code resolved to this same device. Read the code from your other device.',
    }
  }
  if (a.device_role === b.device_role) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_ROLE_COLLISION,
      message:
        "Both devices have the same role. One must be 'host' and the other 'sandbox' — change the role in Settings → Orchestrator mode on one device, then try again.",
    }
  }

  // Both endpoints carry real `computer_name` values: the initiator side comes from
  // local orchestrator settings; the counterparty side is filled in by the
  // pairing-code resolve RPC, which returns the registered device_name. There is no
  // sentinel/placeholder path anymore (Phase 4).
  const na = normalizeComputerNameForHandshake(a.computer_name)
  const nb = normalizeComputerNameForHandshake(b.computer_name)
  if (!na || !nb) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message:
        'A device name is missing. Open Settings → Orchestrator mode on each device and make sure both have a name set.',
    }
  }
  if (na === nb) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_COMPUTER_NAME_COLLISION,
      message:
        'Both devices have the same name. Rename one device in Settings → Orchestrator mode, then try again.',
    }
  }
  return { ok: true }
}

/**
 * Relay / capsule wire: both routing device ids must be non-empty strings.
 * Use when rejecting incomplete same-principal or internal coordination payloads.
 */
export function validateInternalCapsuleDeviceIds(
  sender_device_id: unknown,
  receiver_device_id: unknown,
): InternalEndpointPairValidationResult {
  const s = typeof sender_device_id === 'string' ? sender_device_id.trim() : ''
  const r = typeof receiver_device_id === 'string' ? receiver_device_id.trim() : ''
  if (!s || !r) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID,
      message: 'sender_device_id and receiver_device_id are required for internal / same-principal relay capsules',
    }
  }
  return { ok: true }
}

/**
 * Validate one endpoint (legacy positional API).
 * @see validateInternalEndpointIdentity
 */
export function validateInternalEndpointFields(
  label: 'sender' | 'receiver' | 'initiator' | 'acceptor',
  deviceId: string | null | undefined,
  deviceRole: unknown,
  computerName: string | null | undefined,
): InternalEndpointPairValidationResult {
  return validateInternalEndpointIdentity(label, {
    device_id: deviceId,
    device_role: deviceRole,
    computer_name: computerName,
  })
}

/**
 * Cross-endpoint invariants (legacy camelCase API).
 * @see validateInternalEndpointPair
 */
export function validateInternalEndpointPairDistinct(
  a: InternalHandshakeEndpoint,
  b: InternalHandshakeEndpoint,
): InternalEndpointPairValidationResult {
  return validateInternalEndpointPair(internalEndpointIdentityFromCamel(a), internalEndpointIdentityFromCamel(b), {
    labelA: 'endpoint_a',
    labelB: 'endpoint_b',
  })
}
