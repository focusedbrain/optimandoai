import { describe, test, expect } from 'vitest'
import {
  describeOutboundPayloadForLogs,
  extractTopLevelKeysFromJsonBody,
  detectBodyLooksDoubleEncoded,
  buildOutboundRequestDebugSnapshot,
} from '../p2pTransport'

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

  test('extractTopLevelKeysFromJsonBody — normal object', () => {
    const keys = extractTopLevelKeysFromJsonBody(JSON.stringify({ a: 1, b: 2 }))
    expect(keys).toContain('a')
    expect(keys).toContain('b')
  })

  test('detectBodyLooksDoubleEncoded — true when JSON string wraps JSON object', () => {
    const inner = JSON.stringify({ handshake_id: 'x' })
    const wire = JSON.stringify(inner)
    expect(detectBodyLooksDoubleEncoded(wire)).toBe(true)
  })

  test('buildOutboundRequestDebugSnapshot — includes safe fields only', () => {
    const cap = { handshake_id: 'hs', capsule_type: 'context_sync' }
    const body = JSON.stringify(cap)
    const s = buildOutboundRequestDebugSnapshot(
      'direct',
      'https://peer/beap',
      cap,
      body,
      'application/json',
      400,
      '{"error":"Bad request"}',
    )
    expect(s.route).toBe('direct')
    expect(s.url).toBe('https://peer/beap')
    expect(s.content_type).toBe('application/json')
    expect(s.content_length_bytes).toBeGreaterThan(0)
    expect(s.body_type).toBe('json_string')
    expect(s.top_level_keys).toContain('handshake_id')
    expect(s.body_looks_double_encoded).toBe(false)
    expect(s.http_status).toBe(400)
    expect(s.response_body_snippet).toContain('Bad request')
  })
})
