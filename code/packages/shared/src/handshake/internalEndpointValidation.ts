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
  /** Internal initiate capsule missing or malformed `receiver_pairing_code` (6 decimal digits required) */
  INTERNAL_PAIRING_CODE_INVALID: 'INTERNAL_PAIRING_CODE_INVALID',
  /** Internal initiate capsule's `receiver_pairing_code` equals the sender's own pairing code */
  INTERNAL_PAIRING_CODE_SELF: 'INTERNAL_PAIRING_CODE_SELF',
  /** Receiver-side acceptance: capsule.receiver_pairing_code does not match this device's own code */
  INTERNAL_PEER_DEVICE_MISMATCH: 'INTERNAL_PEER_DEVICE_MISMATCH',
  /** Internal relay envelope missing required routing fields (device ids, roles, names, handshake_type) */
  INTERNAL_RELAY_WIRE_INCOMPLETE: 'INTERNAL_RELAY_WIRE_INCOMPLETE',
  /** POST body sender_device_id does not match local orchestrator device id */
  INTERNAL_RELAY_SENDER_DEVICE_MISMATCH: 'INTERNAL_RELAY_SENDER_DEVICE_MISMATCH',
  /** Legacy / degraded internal row: identity incomplete after accept — coordination send blocked until repaired */
  INTERNAL_COORDINATION_REPAIR_NEEDED: 'INTERNAL_COORDINATION_REPAIR_NEEDED',
} as const

export type InternalEndpointErrorCode =
  (typeof INTERNAL_ENDPOINT_ERROR_CODES)[keyof typeof INTERNAL_ENDPOINT_ERROR_CODES]

/**
 * Discriminator for the specific field that failed validation. Lets call sites
 * (currently the Electron IPC and the renderer pre-flight) render a per-field,
 * user-actionable message instead of the legacy generic "this device isn't ready"
 * string. Only set on `ok: false` results that come from a single-field check.
 *
 * `side` distinguishes whether the missing field belongs to the local device
 * (Settings → Orchestrator mode misconfiguration) or the counterparty (resolved
 * via the pairing code → coordination service). The IPC uses this to choose
 * between the user-actionable message and the "internal error, please report"
 * message for fields the renderer is supposed to populate automatically.
 */
export type InternalEndpointMissingField =
  | 'device_id'
  | 'device_role'
  | 'computer_name'

export type InternalEndpointSide = 'local' | 'counterparty'

export interface InternalEndpointPairValidationResult {
  readonly ok: boolean
  readonly code?: InternalEndpointErrorCode
  readonly message?: string
  /** Which field tripped the validator (only set for single-field failures). */
  readonly missing_field?: InternalEndpointMissingField
  /** Which side (local vs counterparty) the missing field belongs to. */
  readonly side?: InternalEndpointSide
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
 * Map a label to a side (local vs counterparty). The IPC labels are
 * `'initiator'` / `'acceptor'` for the local device and `'sender'` / `'receiver'`
 * for the counterparty in the initiate flow. Anything unrecognised defaults to
 * `'counterparty'` — the safer default since "internal error, please report"
 * pages a developer rather than misdirecting the user to Settings.
 */
function sideFromLabel(label: string): InternalEndpointSide {
  if (label === 'initiator' || label === 'acceptor') return 'local'
  return 'counterparty'
}

/**
 * Build the user-facing message for a specific missing field on a specific side.
 * Three of these (counterparty role/name, local device_id) are programmer bugs
 * because the renderer / resolve step is responsible for filling them; the rest
 * are real Settings misconfigurations the user can act on.
 */
function messageForMissingField(
  field: InternalEndpointMissingField,
  side: InternalEndpointSide,
): string {
  if (side === 'counterparty') {
    if (field === 'device_id') {
      return "The pairing code didn't resolve to a device. Check that the code was read correctly from the other device's Settings → Orchestrator mode, and that the other device is online."
    }
    if (field === 'device_role') {
      return "Internal error: counterparty role not set. Please report this — your handshake wasn't sent."
    }
    return "Internal error: counterparty device name missing from resolve. Please report this — your handshake wasn't sent."
  }
  if (field === 'device_id') {
    return 'This device has no coordination identity. Open Settings → Orchestrator mode to check the device configuration.'
  }
  if (field === 'device_role') {
    return 'Pick Host or Sandbox for this device in Settings → Orchestrator mode, then try again.'
  }
  return 'Give this device a name in Settings → Orchestrator mode, then try again.'
}

/**
 * Validate one endpoint: non-empty `device_id`, valid `device_role`, non-empty `computer_name`.
 *
 * Invariants: all three fields required; role must be host | sandbox.
 *
 * The `label` is used both for human-readable diagnostics and to discriminate
 * between local (`'initiator'` / `'acceptor'`) and counterparty (`'sender'` /
 * `'receiver'`) sides so the returned `side` field can drive per-field messages.
 */
export function validateInternalEndpointIdentity(
  label: 'sender' | 'receiver' | 'initiator' | 'acceptor' | string,
  partial: {
    device_id?: string | null
    device_role?: unknown
    computer_name?: string | null
  },
): InternalEndpointPairValidationResult {
  const side = sideFromLabel(label)
  if (!isNonEmpty(partial.device_id)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: messageForMissingField('device_id', side),
      missing_field: 'device_id',
      side,
    }
  }
  if (!validRole(partial.device_role)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: messageForMissingField('device_role', side),
      missing_field: 'device_role',
      side,
    }
  }
  if (!isNonEmpty(partial.computer_name)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: messageForMissingField('computer_name', side),
      missing_field: 'computer_name',
      side,
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
    // Both individual validateInternalEndpointIdentity passes already accepted these
    // strings as non-empty above; getting here means a name was whitespace-only and
    // collapsed during normalization. Treat as a local Settings issue (the user can
    // act on it) rather than a programmer bug.
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message:
        'A device name is missing. Open Settings → Orchestrator mode on each device and make sure both have a name set.',
      missing_field: 'computer_name',
      side: !na ? 'local' : 'counterparty',
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

// ── Pairing-code-based internal initiate validation ───────────────────────────

/** Strict 6-decimal-digit format check (no dash, no whitespace). */
export function isValidPairingCodeFormat(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code)
}

/** Strip non-digit characters and re-check 6-digit format. Used to normalize
 *  user-typed input (e.g. `482-917` → `482917`) before comparison or storage. */
export function normalizePairingCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const digits = input.replace(/\D+/g, '')
  return digits.length === 6 ? digits : null
}

/**
 * Validate the internal-initiate contract under the new pairing-code model.
 *
 * Required:
 *  - `sender_device_id` non-empty
 *  - `sender_device_role` ∈ {host, sandbox}
 *  - `sender_computer_name` non-empty
 *  - `receiver_pairing_code` is 6 decimal digits and ≠ sender's own pairing code
 *
 * Notably NOT required (the prior model demanded these for routing — now obsolete):
 *  - `receiver_device_id`
 *  - `receiver_device_role`
 *  - `receiver_computer_name`
 */
export function validateInternalInitiateContract(input: {
  sender_device_id?: string | null
  sender_device_role?: unknown
  sender_computer_name?: string | null
  receiver_pairing_code?: string | null
  /** This device's own pairing code (from orchestratorModeStore.getPairingCode()), used for self-pair check. */
  local_pairing_code?: string | null
}): InternalEndpointPairValidationResult {
  if (!isNonEmpty(input.sender_device_id)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: 'This device has no coordination identity. Check Settings → Orchestrator mode.',
      missing_field: 'device_id',
      side: 'local',
    }
  }
  if (!validRole(input.sender_device_role)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: 'Pick Host or Sandbox for this device in Settings → Orchestrator mode, then try again.',
      missing_field: 'device_role',
      side: 'local',
    }
  }
  if (!isNonEmpty(input.sender_computer_name)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE,
      message: 'Give this device a name in Settings → Orchestrator mode, then try again.',
      missing_field: 'computer_name',
      side: 'local',
    }
  }
  if (!isValidPairingCodeFormat(input.receiver_pairing_code)) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_PAIRING_CODE_INVALID,
      message:
        "The pairing code is missing or invalid. Enter the 6-digit code from the other device's Settings → Orchestrator mode.",
    }
  }
  const local = typeof input.local_pairing_code === 'string' ? input.local_pairing_code.trim() : ''
  if (local && local === input.receiver_pairing_code) {
    return {
      ok: false,
      code: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_PAIRING_CODE_SELF,
      message: "That's this device's own pairing code. Enter the code from your other device.",
    }
  }
  return { ok: true }
}

/** Format a 6-digit code as `XXX-XXX` for display. Returns the input unchanged if not 6 digits. */
export function formatPairingCodeForDisplay(code: string | null | undefined): string {
  if (typeof code !== 'string') return ''
  const digits = code.replace(/\D+/g, '')
  if (digits.length !== 6) return code ?? ''
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}
