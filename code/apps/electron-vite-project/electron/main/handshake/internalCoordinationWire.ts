/**
 * Coordination relay wire: sender_device_id + receiver_device_id for same-principal internal caps.
 */

import type { HandshakeRecord } from './types'

/** Options to spread into refresh / context_sync / revoke / similar builders. */
export type InternalRelayCapsuleWireOpts = {
  isInternalHandshake: true
  coordinationSenderDeviceId: string
  coordinationReceiverDeviceId: string
  senderDeviceRole: 'host' | 'sandbox'
  receiverDeviceRole: 'host' | 'sandbox'
  senderComputerName: string
  receiverComputerName: string
}

type InternalRelayRecordSlice = Pick<
  HandshakeRecord,
  | 'handshake_type'
  | 'local_role'
  | 'initiator_coordination_device_id'
  | 'acceptor_coordination_device_id'
  | 'internal_coordination_identity_complete'
  | 'initiator_device_role'
  | 'acceptor_device_role'
  | 'initiator_device_name'
  | 'acceptor_device_name'
>

/**
 * Full relay wire metadata for the current device, when the handshake is internal and identity is complete.
 */
export function internalRelayCapsuleWireOptsFromRecord(
  record: InternalRelayRecordSlice,
  localDeviceId: string | undefined,
): InternalRelayCapsuleWireOpts | null {
  if (record.handshake_type !== 'internal') return null
  if (record.internal_coordination_identity_complete !== true) return null
  const loc = localDeviceId?.trim()
  if (!loc) return null
  const peer =
    record.local_role === 'initiator'
      ? record.acceptor_coordination_device_id?.trim()
      : record.initiator_coordination_device_id?.trim()
  if (!peer) return null

  const senderRole =
    record.local_role === 'initiator' ? record.initiator_device_role : record.acceptor_device_role
  const senderName =
    record.local_role === 'initiator' ? record.initiator_device_name : record.acceptor_device_name
  const receiverRole =
    record.local_role === 'initiator' ? record.acceptor_device_role : record.initiator_device_role
  const receiverName =
    record.local_role === 'initiator' ? record.acceptor_device_name : record.initiator_device_name

  if (!senderRole || !receiverRole || !senderName?.trim() || !receiverName?.trim()) {
    return null
  }

  return {
    isInternalHandshake: true,
    coordinationSenderDeviceId: loc,
    coordinationReceiverDeviceId: peer,
    senderDeviceRole: senderRole,
    receiverDeviceRole: receiverRole,
    senderComputerName: senderName.trim(),
    receiverComputerName: receiverName.trim(),
  }
}

export function coordinationDevicePairForInternalRecord(
  record: InternalRelayRecordSlice,
  localDeviceId: string | undefined,
): { coordinationSenderDeviceId: string; coordinationReceiverDeviceId: string } | null {
  const o = internalRelayCapsuleWireOptsFromRecord(record, localDeviceId)
  if (!o) return null
  return {
    coordinationSenderDeviceId: o.coordinationSenderDeviceId,
    coordinationReceiverDeviceId: o.coordinationReceiverDeviceId,
  }
}
