import { describe, test, expect } from 'vitest'
import {
  coordinationDevicePairForInternalRecord,
  internalRelayCapsuleWireOptsFromRecord,
} from '../internalCoordinationWire'

const completeInternal = {
  handshake_type: 'internal' as const,
  internal_coordination_identity_complete: true as const,
  initiator_device_role: 'host' as const,
  acceptor_device_role: 'sandbox' as const,
  initiator_device_name: 'HostPC',
  acceptor_device_name: 'SandboxPC',
}

describe('coordinationDevicePairForInternalRecord', () => {
  test('returns null for non-internal', () => {
    expect(
      coordinationDevicePairForInternalRecord(
        {
          handshake_type: 'standard',
          local_role: 'initiator',
          initiator_coordination_device_id: 'a',
          acceptor_coordination_device_id: 'b',
          internal_coordination_identity_complete: true,
        },
        'a',
      ),
    ).toBeNull()
  })

  test('returns null when internal identity incomplete (degraded legacy)', () => {
    expect(
      coordinationDevicePairForInternalRecord(
        {
          handshake_type: 'internal',
          local_role: 'initiator',
          initiator_coordination_device_id: 'a',
          acceptor_coordination_device_id: 'b',
          internal_coordination_identity_complete: false,
        },
        'a',
      ),
    ).toBeNull()
  })

  test('initiator role maps peer to acceptor device id', () => {
    expect(
      coordinationDevicePairForInternalRecord(
        {
          ...completeInternal,
          local_role: 'initiator',
          initiator_coordination_device_id: 'host-dev',
          acceptor_coordination_device_id: 'sandbox-dev',
        },
        'host-dev',
      ),
    ).toEqual({
      coordinationSenderDeviceId: 'host-dev',
      coordinationReceiverDeviceId: 'sandbox-dev',
    })
  })

  test('acceptor role maps peer to initiator device id', () => {
    expect(
      coordinationDevicePairForInternalRecord(
        {
          ...completeInternal,
          local_role: 'acceptor',
          initiator_coordination_device_id: 'host-dev',
          acceptor_coordination_device_id: 'sandbox-dev',
        },
        'sandbox-dev',
      ),
    ).toEqual({
      coordinationSenderDeviceId: 'sandbox-dev',
      coordinationReceiverDeviceId: 'host-dev',
    })
  })

  test('missing peer id yields null', () => {
    expect(
      coordinationDevicePairForInternalRecord(
        {
          ...completeInternal,
          local_role: 'initiator',
          initiator_coordination_device_id: 'host-dev',
          acceptor_coordination_device_id: null,
        },
        'host-dev',
      ),
    ).toBeNull()
  })
})

describe('internalRelayCapsuleWireOptsFromRecord', () => {
  test('initiator local maps sender metadata to initiator columns', () => {
    expect(
      internalRelayCapsuleWireOptsFromRecord(
        {
          ...completeInternal,
          local_role: 'initiator',
          initiator_coordination_device_id: 'host-dev',
          acceptor_coordination_device_id: 'sandbox-dev',
        },
        'host-dev',
      ),
    ).toEqual({
      isInternalHandshake: true,
      coordinationSenderDeviceId: 'host-dev',
      coordinationReceiverDeviceId: 'sandbox-dev',
      senderDeviceRole: 'host',
      receiverDeviceRole: 'sandbox',
      senderComputerName: 'HostPC',
      receiverComputerName: 'SandboxPC',
    })
  })

  test('acceptor local maps sender metadata to acceptor columns', () => {
    expect(
      internalRelayCapsuleWireOptsFromRecord(
        {
          ...completeInternal,
          local_role: 'acceptor',
          initiator_coordination_device_id: 'host-dev',
          acceptor_coordination_device_id: 'sandbox-dev',
        },
        'sandbox-dev',
      ),
    ).toEqual({
      isInternalHandshake: true,
      coordinationSenderDeviceId: 'sandbox-dev',
      coordinationReceiverDeviceId: 'host-dev',
      senderDeviceRole: 'sandbox',
      receiverDeviceRole: 'host',
      senderComputerName: 'SandboxPC',
      receiverComputerName: 'HostPC',
    })
  })
})
