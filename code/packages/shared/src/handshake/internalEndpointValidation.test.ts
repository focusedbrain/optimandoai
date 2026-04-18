import { describe, test, expect } from 'vitest'
import {
  INTERNAL_ENDPOINT_ERROR_CODES,
  normalizeComputerNameForHandshake,
  validateInternalEndpointFields,
  validateInternalEndpointIdentity,
  validateInternalEndpointPair,
  validateInternalEndpointPairDistinct,
  validateInternalCapsuleDeviceIds,
  internalEndpointIdentity,
} from './internalEndpointValidation'

describe('internalEndpointValidation', () => {
  test('INTERNAL_ENDPOINT_ERROR_CODES are stable string literals', () => {
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE).toBe('INTERNAL_ENDPOINT_INCOMPLETE')
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_ID_COLLISION).toBe('INTERNAL_ENDPOINT_ID_COLLISION')
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_ROLE_COLLISION).toBe('INTERNAL_ENDPOINT_ROLE_COLLISION')
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_COMPUTER_NAME_COLLISION).toBe('INTERNAL_COMPUTER_NAME_COLLISION')
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID).toBe('INTERNAL_CAPSULE_MISSING_DEVICE_ID')
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_WIRE_INCOMPLETE).toBe('INTERNAL_RELAY_WIRE_INCOMPLETE')
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_SENDER_DEVICE_MISMATCH).toBe(
      'INTERNAL_RELAY_SENDER_DEVICE_MISMATCH',
    )
    expect(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_COORDINATION_REPAIR_NEEDED).toBe(
      'INTERNAL_COORDINATION_REPAIR_NEEDED',
    )
  })

  test('normalizeComputerNameForHandshake trims, NFKC, and lowercases', () => {
    expect(normalizeComputerNameForHandshake('  MY-HOST  ')).toBe('my-host')
    // é as NFC vs NFD
    expect(normalizeComputerNameForHandshake('\u00e9cole')).toBe(normalizeComputerNameForHandshake('e\u0301cole'))
  })

  test('validateInternalEndpointIdentity rejects empty device id', () => {
    const r = validateInternalEndpointIdentity('sender', {
      device_id: '',
      device_role: 'host',
      computer_name: 'PC',
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE)
  })

  test('validateInternalEndpointFields rejects empty device id (legacy API)', () => {
    const r = validateInternalEndpointFields('sender', '', 'host', 'PC')
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_INCOMPLETE)
  })

  test('validateInternalEndpointPair rejects same device id', () => {
    const r = validateInternalEndpointPair(
      internalEndpointIdentity('d1', 'host', 'A'),
      internalEndpointIdentity('d1', 'sandbox', 'B'),
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_ID_COLLISION)
  })

  test('validateInternalEndpointPair rejects same role', () => {
    const r = validateInternalEndpointPair(
      internalEndpointIdentity('d1', 'host', 'A'),
      internalEndpointIdentity('d2', 'host', 'B'),
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_ENDPOINT_ROLE_COLLISION)
  })

  test('validateInternalEndpointPair rejects same normalized computer name', () => {
    const r = validateInternalEndpointPair(
      internalEndpointIdentity('d1', 'host', 'WORKSTATION'),
      internalEndpointIdentity('d2', 'sandbox', 'workstation'),
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_COMPUTER_NAME_COLLISION)
  })

  test('validateInternalEndpointPair accepts valid host/sandbox pair', () => {
    const r = validateInternalEndpointPair(
      internalEndpointIdentity('d1', 'host', 'Host-PC'),
      internalEndpointIdentity('d2', 'sandbox', 'Sandbox-VM'),
    )
    expect(r.ok).toBe(true)
  })

  test('validateInternalEndpointPairDistinct (camelCase) matches pair behavior', () => {
    const r = validateInternalEndpointPairDistinct(
      { deviceId: 'd1', deviceRole: 'host', computerName: 'A' },
      { deviceId: 'd2', deviceRole: 'sandbox', computerName: 'B' },
    )
    expect(r.ok).toBe(true)
  })

  test('validateInternalCapsuleDeviceIds rejects missing sender', () => {
    const r = validateInternalCapsuleDeviceIds('', 'peer')
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID)
  })

  test('validateInternalCapsuleDeviceIds rejects missing receiver', () => {
    const r = validateInternalCapsuleDeviceIds('self', null)
    expect(r.ok).toBe(false)
    expect(r.code).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_CAPSULE_MISSING_DEVICE_ID)
  })

  test('validateInternalCapsuleDeviceIds accepts two non-empty ids', () => {
    expect(validateInternalCapsuleDeviceIds('a', 'b').ok).toBe(true)
  })

  describe('per-field diagnostics (missing_field + side)', () => {
    test("local 'initiator' missing device_id maps to side=local, field=device_id", () => {
      const r = validateInternalEndpointIdentity('initiator', {
        device_id: '',
        device_role: 'host',
        computer_name: 'PC',
      })
      expect(r.ok).toBe(false)
      expect(r.missing_field).toBe('device_id')
      expect(r.side).toBe('local')
      expect(r.message).toMatch(/Settings → Orchestrator mode/)
      expect(r.message).not.toMatch(/Restart the app/i)
    })

    test("counterparty 'receiver' missing device_id maps to side=counterparty (resolve gap)", () => {
      const r = validateInternalEndpointIdentity('receiver', {
        device_id: '',
        device_role: 'host',
        computer_name: 'PC',
      })
      expect(r.ok).toBe(false)
      expect(r.missing_field).toBe('device_id')
      expect(r.side).toBe('counterparty')
      expect(r.message).toMatch(/pairing code didn't resolve/)
    })

    test("counterparty missing device_role flagged as internal error (programmer bug)", () => {
      const r = validateInternalEndpointIdentity('receiver', {
        device_id: 'peer-id',
        device_role: undefined,
        computer_name: 'PC',
      })
      expect(r.ok).toBe(false)
      expect(r.missing_field).toBe('device_role')
      expect(r.side).toBe('counterparty')
      expect(r.message).toMatch(/Internal error/)
    })

    test("counterparty missing computer_name flagged as internal error (programmer bug)", () => {
      const r = validateInternalEndpointIdentity('sender', {
        device_id: 'peer-id',
        device_role: 'sandbox',
        computer_name: '',
      })
      expect(r.ok).toBe(false)
      expect(r.missing_field).toBe('computer_name')
      expect(r.side).toBe('counterparty')
      expect(r.message).toMatch(/Internal error/)
    })

    test("local 'acceptor' missing computer_name asks the user to set a device name", () => {
      const r = validateInternalEndpointIdentity('acceptor', {
        device_id: 'self-id',
        device_role: 'sandbox',
        computer_name: '   ',
      })
      expect(r.ok).toBe(false)
      expect(r.missing_field).toBe('computer_name')
      expect(r.side).toBe('local')
      expect(r.message).toMatch(/Give this device a name/)
    })

    test("local missing device_role asks the user to pick host/sandbox", () => {
      const r = validateInternalEndpointIdentity('initiator', {
        device_id: 'self-id',
        device_role: 'invalid' as unknown,
        computer_name: 'PC',
      })
      expect(r.ok).toBe(false)
      expect(r.missing_field).toBe('device_role')
      expect(r.side).toBe('local')
      expect(r.message).toMatch(/Pick Host or Sandbox/)
    })
  })
})
