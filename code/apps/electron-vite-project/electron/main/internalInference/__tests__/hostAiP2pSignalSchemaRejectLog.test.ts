import { afterEach, describe, expect, it, vi } from 'vitest'
import { logHostAiSignalSchemaRejected } from '../hostAiP2pSignalSchemaRejectLog'
import { P2P_SIGNAL_WIRE_SCHEMA_VERSION } from '../p2pSignalWireSchemaVersion'

describe('logHostAiSignalSchemaRejected', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a parseable [HOST_AI_SIGNAL_SCHEMA_REJECTED] line with expected fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const req = JSON.stringify({
      schema_version: 1,
      signal_type: 'p2p_inference_offer',
      foo: 1,
    })
    const res = JSON.stringify({ error: 'P2P_SIGNAL_REJECTED', reason: 'field_x_invalid' })
    logHostAiSignalSchemaRejected({
      handshake_id: 'hs-a',
      local_device_id: 'dev-local',
      peer_device_id: 'dev-peer',
      source: 'p2p_signal_coordination_post',
      request_body_json: req,
      response_body_text: res,
      kind: 'offer',
    })
    const line = String(spy.mock.calls[0]?.[0] ?? '')
    expect(line).toContain('[HOST_AI_SIGNAL_SCHEMA_REJECTED]')
    const jsonPart = line.replace(/^\[HOST_AI_SIGNAL_SCHEMA_REJECTED\]\s*/, '')
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>
    expect(parsed.handshake_id).toBe('hs-a')
    expect(parsed.local_device_id).toBe('dev-local')
    expect(parsed.source).toBe('p2p_signal_coordination_post')
    expect(parsed.kind).toBe('offer')
    expect(parsed.expected_schema_version).toBe(P2P_SIGNAL_WIRE_SCHEMA_VERSION)
    expect(parsed.received_type).toBe('p2p_inference_offer')
    expect(parsed.received_version).toBe(1)
    expect(Array.isArray(parsed.received_keys)).toBe(true)
    expect((parsed.received_keys as string[]).length).toBeGreaterThan(0)
    expect(parsed.rejection_path).toBe('field_x_invalid')
  })
})
