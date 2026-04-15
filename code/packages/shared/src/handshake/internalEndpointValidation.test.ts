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
})
