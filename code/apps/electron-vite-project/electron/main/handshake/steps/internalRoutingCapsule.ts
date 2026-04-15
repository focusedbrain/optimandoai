/**
 * Internal handshake capsules must carry coordination device routing on wire so ingest
 * matches relay registration (no silent ACK with ambiguous same-principal routing).
 */

import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'
import { validateInternalInitiateCapsuleWire } from '../internalPersistence'
import { validateInternalCapsuleDeviceIds } from '../../../../../../packages/shared/src/handshake/internalEndpointValidation'

export const verifyInternalCapsuleRouting: PipelineStep = {
  name: 'verify_internal_capsule_routing',
  execute(ctx) {
    const { input, handshakeRecord } = ctx
    const isInternal =
      input.handshake_type === 'internal' || handshakeRecord?.handshake_type === 'internal'
    if (!isInternal) {
      return { passed: true }
    }

    if (input.capsuleType === 'handshake-initiate') {
      if (input.handshake_type !== 'internal') {
        return { passed: true }
      }
      const wire: Record<string, unknown> = {
        handshake_type: 'internal',
        sender_device_id: input.sender_device_id,
        sender_device_role: input.sender_device_role,
        sender_computer_name: input.sender_computer_name,
        receiver_device_id: input.receiver_device_id,
        receiver_device_role: input.receiver_device_role,
        receiver_computer_name: input.receiver_computer_name,
      }
      const w = validateInternalInitiateCapsuleWire(wire)
      if (!w.ok) {
        return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
      }
      return { passed: true }
    }

    const relayLike =
      input.capsuleType === 'handshake-accept' ||
      input.capsuleType === 'handshake-context-sync' ||
      input.capsuleType === 'handshake-refresh' ||
      input.capsuleType === 'handshake-revoke'

    if (!relayLike) {
      return { passed: true }
    }

    const idCheck = validateInternalCapsuleDeviceIds(input.sender_device_id, input.receiver_device_id)
    if (!idCheck.ok) {
      return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
    }
    const s = (input.sender_device_id ?? '').trim()
    const r = (input.receiver_device_id ?? '').trim()
    if (s === r) {
      return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
    }

    return { passed: true }
  },
}
