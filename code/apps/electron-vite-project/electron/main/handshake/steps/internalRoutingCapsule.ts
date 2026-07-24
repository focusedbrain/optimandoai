/**
 * Same-principal handshake capsules must carry coordination device routing on wire so
 * ingest matches relay registration (no silent ACK with ambiguous same-principal routing).
 *
 * Phase 4 (Q9): the gate is the profile parameter `same_principal` (persisted record) or
 * the wire declaration read through `wireDeclaresSamePrincipal` — this is wire-shape
 * validation for a routing requirement that is profile-record DATA (internal_device
 * requires device-pair routing), not a `handshake_type` semantic branch.
 */

import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'
import { validateInternalInitiateCapsuleWire } from '../internalPersistence'
import { wireDeclaresSamePrincipal, legacyWireHandshakeType } from '../samePrincipalWire'
import { validateInternalCapsuleDeviceIds } from '../../../../../../packages/shared/src/handshake/internalEndpointValidation'

export const verifyInternalCapsuleRouting: PipelineStep = {
  name: 'verify_internal_capsule_routing',
  execute(ctx) {
    const { input, handshakeRecord } = ctx
    const isSamePrincipal =
      wireDeclaresSamePrincipal(input) || handshakeRecord?.same_principal === true
    if (!isSamePrincipal) {
      return { passed: true }
    }

    if (input.capsuleType === 'handshake-initiate') {
      if (!wireDeclaresSamePrincipal(input)) {
        return { passed: true }
      }
      // Pass `receiver_pairing_code` through so pairing-code initiates (the new
      // routing model) survive validation. Without this, the validator falls back
      // to the legacy full-pair shape and rejects every pairing-code initiate
      // that arrives via the coordination relay (file-import path bypasses the
      // pipeline and was unaffected, masking the bug).
      const wire: Record<string, unknown> = {
        handshake_type: legacyWireHandshakeType(true),
        sender_device_id: input.sender_device_id,
        sender_device_role: input.sender_device_role,
        sender_computer_name: input.sender_computer_name,
        receiver_device_id: input.receiver_device_id,
        receiver_device_role: input.receiver_device_role,
        receiver_computer_name: input.receiver_computer_name,
        ...(input.receiver_pairing_code
          ? { receiver_pairing_code: input.receiver_pairing_code }
          : {}),
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
