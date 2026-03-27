import { describe, test, expect } from 'vitest'
import { describeOutboundPayloadForLogs } from '../p2pTransport'

describe('describeOutboundPayloadForLogs', () => {
  test('context_sync capsule envelope', () => {
    const d = describeOutboundPayloadForLogs({
      schema_version: 1,
      capsule_type: 'context_sync',
      handshake_id: 'hs-1',
      seq: 1,
    })
    expect(d.value_kind).toBe('object')
    expect(d.top_level_keys).toContain('capsule_type')
    expect(d.looks_like_relay_capsule_envelope).toBe(true)
    expect(d.looks_like_beap_message_package).toBe(false)
    expect(d.has_top_level_handshake_id).toBe(true)
  })

  test('BEAP message package shape (no top-level capsule_type)', () => {
    const d = describeOutboundPayloadForLogs({
      header: { metadata: {}, receiver_binding: { handshake_id: 'hs-2' } },
      metadata: {},
      envelope: {},
    })
    expect(d.looks_like_beap_message_package).toBe(true)
    expect(d.has_message_header_receiver_binding_handshake_id).toBe(true)
  })
})
