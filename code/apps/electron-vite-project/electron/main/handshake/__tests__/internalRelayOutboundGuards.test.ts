import { describe, test, expect } from 'vitest'
import {
  collectInternalRelayWireGaps,
  formatLocalInternalRelayValidationJson,
  isInternalRelayCapsuleEnvelope,
  LOCAL_INTERNAL_RELAY_VALIDATION_FAILED,
} from '../internalRelayOutboundGuards'
import { INTERNAL_ENDPOINT_ERROR_CODES } from '../../../../../../packages/shared/src/handshake/internalEndpointValidation'

describe('internalRelayOutboundGuards', () => {
  test('isInternalRelayCapsuleEnvelope', () => {
    expect(isInternalRelayCapsuleEnvelope({ capsule_type: 'context_sync' })).toBe(true)
    expect(isInternalRelayCapsuleEnvelope({ capsule_type: 'initiate' })).toBe(false)
  })

  test('collectInternalRelayWireGaps lists missing internal wire fields', () => {
    const missing = collectInternalRelayWireGaps({ capsule_type: 'context_sync' })
    expect(missing).toContain('handshake_type')
    expect(missing).toContain('sender_device_id')
    expect(missing).toContain('receiver_device_id')
  })

  test('formatLocalInternalRelayValidationJson is stable machine-readable shape', () => {
    const s = formatLocalInternalRelayValidationJson({
      phase: 'coordination_pre_http',
      invariant: INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_WIRE_INCOMPLETE,
      message: 'test',
      missing_fields: ['receiver_device_id'],
    })
    const j = JSON.parse(s) as Record<string, unknown>
    expect(j.code).toBe(LOCAL_INTERNAL_RELAY_VALIDATION_FAILED)
    expect(j.phase).toBe('coordination_pre_http')
    expect(j.invariant).toBe(INTERNAL_ENDPOINT_ERROR_CODES.INTERNAL_RELAY_WIRE_INCOMPLETE)
    expect(j.missing_fields).toEqual(['receiver_device_id'])
  })
})
