import { describe, test, expect } from 'vitest'
import {
  parseCoordinationRelayErrorSnippet,
  terminalRelayIdentityInvariant,
  isCoordinationStaleRegistry403,
} from '../relayOutboundClassification'

describe('relayOutboundClassification', () => {
  test('parses JSON relay body', () => {
    const s = JSON.stringify({
      error: 'RELAY_RECEIVER_DEVICE_MISMATCH',
      code: 'RELAY_RECEIVER_DEVICE_MISMATCH',
      detail: 'receiver_device_id does not match',
    })
    const p = parseCoordinationRelayErrorSnippet(s)
    expect(p.code).toBe('RELAY_RECEIVER_DEVICE_MISMATCH')
    expect(p.error).toBe('RELAY_RECEIVER_DEVICE_MISMATCH')
    expect(p.detail).toContain('receiver_device_id')
  })

  test('terminal invariant from structured 400 internal_capsule', () => {
    const s = JSON.stringify({
      error: 'internal_capsule',
      code: 'INTERNAL_CAPSULE_MISSING_DEVICE_ID',
      detail: 'sender_device_id is required',
    })
    expect(terminalRelayIdentityInvariant(s)).toBe('INTERNAL_CAPSULE_MISSING_DEVICE_ID')
  })

  test.each([
    ['RELAY_RECIPIENT_RESOLUTION_FAILED'],
    ['RELAY_RECEIVER_DEVICE_MISMATCH'],
    ['INTERNAL_ENDPOINT_INCOMPLETE'],
    ['INTERNAL_RELAY_ROUTING_AMBIGUOUS'],
  ])('terminal invariant: %s', (code) => {
    const s = JSON.stringify({ code, error: code })
    expect(terminalRelayIdentityInvariant(s)).toBe(code)
  })

  test('stale registry 403', () => {
    const s = JSON.stringify({ error: 'RELAY_SENDER_UNAUTHORIZED' })
    expect(isCoordinationStaleRegistry403(s)).toBe(true)
    expect(terminalRelayIdentityInvariant(s)).toBe(null)
  })

  test('non-JSON snippet falls back to substring for terminal codes', () => {
    expect(terminalRelayIdentityInvariant('upstream said RELAY_RECEIVER_DEVICE_MISMATCH')).toBe(
      'RELAY_RECEIVER_DEVICE_MISMATCH',
    )
  })
})
